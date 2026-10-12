"""Read popup ownership in the private X11 session; never focus or inject input."""
import ctypes as c
import ctypes.util
import json
import sys


class Attributes(c.Structure):
    _fields_ = [
        ("x", c.c_int), ("y", c.c_int), ("width", c.c_int), ("height", c.c_int),
        ("border_width", c.c_int), ("depth", c.c_int), ("visual", c.c_void_p),
        ("root", c.c_ulong), ("window_class", c.c_int), ("bit_gravity", c.c_int),
        ("win_gravity", c.c_int), ("backing_store", c.c_int),
        ("backing_planes", c.c_ulong), ("backing_pixel", c.c_ulong),
        ("save_under", c.c_int), ("colormap", c.c_ulong), ("map_installed", c.c_int),
        ("map_state", c.c_int), ("all_event_masks", c.c_long),
        ("your_event_mask", c.c_long), ("do_not_propagate_mask", c.c_long),
        ("override_redirect", c.c_int), ("screen", c.c_void_p),
    ]


class ClientInfo(c.Structure):
    _fields_ = [("resource_base", c.c_ulong), ("resource_mask", c.c_ulong)]


def binding(window):
    x = c.CDLL("libX11.so.6")
    signatures = {
        "XOpenDisplay": ([c.c_char_p], c.c_void_p),
        "XDefaultRootWindow": ([c.c_void_p], c.c_ulong),
        "XInternAtom": ([c.c_void_p, c.c_char_p, c.c_int], c.c_ulong),
        "XGetWindowAttributes": ([c.c_void_p, c.c_ulong, c.POINTER(Attributes)], c.c_int),
        "XGetTransientForHint": ([c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong)], c.c_int),
        "XGetWindowProperty": ([c.c_void_p, c.c_ulong, c.c_ulong, c.c_long,
            c.c_long, c.c_int, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_int),
            c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.c_void_p)], c.c_int),
        "XFree": ([c.c_void_p], c.c_int),
        "XCloseDisplay": ([c.c_void_p], c.c_int),
    }
    for name, (args, result) in signatures.items():
        getattr(x, name).argtypes, getattr(x, name).restype = args, result
    errors = []
    handler_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
    handler = handler_type(lambda *_: errors.append(True) or 0)
    x.XSetErrorHandler.argtypes = [handler_type]
    x.XSetErrorHandler(handler)
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError("private X11 display unavailable")

    def property_value(target, name):
        atom = x.XInternAtom(display, name.encode("ascii"), 1)
        if not atom:
            return None
        actual, count, remaining = c.c_ulong(), c.c_ulong(), c.c_ulong()
        fmt, data = c.c_int(), c.c_void_p()
        status = x.XGetWindowProperty(display, target, atom, 0, 1, 0, 0,
            c.byref(actual), c.byref(fmt), c.byref(count), c.byref(remaining), c.byref(data))
        try:
            if status == 0 and fmt.value == 32 and count.value == 1 and data.value:
                return c.cast(data, c.POINTER(c.c_ulong))[0]
            return None
        finally:
            if data.value:
                x.XFree(data)

    try:
        active = property_value(x.XDefaultRootWindow(display), "_NET_ACTIVE_WINDOW") or 0
        attrs = Attributes()
        if not x.XGetWindowAttributes(display, window, c.byref(attrs)):
            raise RuntimeError("target window unavailable")
        transient = c.c_ulong()
        x.XGetTransientForHint(display, window, c.byref(transient))
        same_client = False
        library = ctypes.util.find_library("XRes")
        if library:
            res = c.CDLL(library)
            res.XResQueryClients.argtypes = [c.c_void_p, c.POINTER(c.c_int),
                c.POINTER(c.POINTER(ClientInfo))]
            res.XResQueryClients.restype = c.c_int
            count, clients = c.c_int(), c.POINTER(ClientInfo)()
            try:
                if res.XResQueryClients(display, c.byref(count), c.byref(clients)):
                    same_client = any(
                        (window & ~client.resource_mask) == client.resource_base
                        and (active & ~client.resource_mask) == client.resource_base
                        for client in clients[:count.value]
                    )
            finally:
                if clients:
                    x.XFree(clients)
        result = {
            "target_window": window, "active_window": active,
            "target_pid": property_value(window, "_NET_WM_PID"),
            "active_pid": property_value(active, "_NET_WM_PID") if active else None,
            "override_redirect": bool(attrs.override_redirect),
            "mapped": attrs.map_state == 2, "transient_for": transient.value or None,
            "same_client": same_client,
        }
        if errors:
            raise RuntimeError("X11 window changed during ownership query")
        return result
    finally:
        x.XCloseDisplay(display)


if __name__ == "__main__":
    print(json.dumps(binding(int(sys.argv[1]))))
