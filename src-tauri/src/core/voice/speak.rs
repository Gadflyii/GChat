//! Hearing replies with the operating system's own speech service: Windows SAPI (through the
//! .NET speech synthesizer) and speech-dispatcher on Linux, loaded at run time from libspeechd
//! (LGPL, dynamic loading only). Nothing is bundled and no cloud service is used.
pub const NO_SERVICE: &str = "Install a speech service to hear replies.";

#[cfg(target_os = "linux")]
mod platform {
    use std::{
        ffi::{c_char, c_int, c_void, CString},
        sync::Mutex,
    };

    type Open = unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, c_int) -> *mut c_void;
    type Say = unsafe extern "C" fn(*mut c_void, c_int, *const c_char) -> c_int;
    type Cancel = unsafe extern "C" fn(*mut c_void) -> c_int;

    struct Connection {
        _library: libloading::Library,
        handle: *mut c_void,
        say: Say,
        cancel: Cancel,
    }
    // The handle is only used while the lock is held.
    unsafe impl Send for Connection {}

    static CONNECTION: Mutex<Option<Connection>> = Mutex::new(None);
    const SPD_MODE_SINGLE: c_int = 0;
    const SPD_TEXT: c_int = 3;

    fn connect() -> Result<Connection, String> {
        let name = CString::new("gchat").unwrap();
        // SAFETY: the library is the system's speech-dispatcher client; symbols are looked up by name
        // with their documented C signatures and used only through this module.
        unsafe {
            let library = ["libspeechd.so.2", "libspeechd.so"]
                .iter()
                .find_map(|name| libloading::Library::new(name).ok())
                .ok_or(super::NO_SERVICE)?;
            let open: Open = *library.get::<Open>(b"spd_open\0").map_err(|_| super::NO_SERVICE)?;
            let say: Say = *library.get::<Say>(b"spd_say\0").map_err(|_| super::NO_SERVICE)?;
            let cancel: Cancel = *library.get::<Cancel>(b"spd_cancel\0").map_err(|_| super::NO_SERVICE)?;
            let handle = open(name.as_ptr(), name.as_ptr(), std::ptr::null(), SPD_MODE_SINGLE);
            if handle.is_null() {
                return Err(super::NO_SERVICE.into());
            }
            Ok(Connection { _library: library, handle, say, cancel })
        }
    }

    pub fn available() -> bool {
        let mut slot = CONNECTION.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = connect().ok();
        }
        slot.is_some()
    }

    pub fn speak(text: &str) -> Result<(), String> {
        let text = CString::new(text.replace('\0', " ")).map_err(|_| "The reply could not be read aloud.".to_string())?;
        let mut slot = CONNECTION.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = Some(connect()?);
        }
        let connection = slot.as_ref().unwrap();
        // SAFETY: handle came from spd_open and is used under the lock.
        unsafe {
            (connection.cancel)(connection.handle);
            if (connection.say)(connection.handle, SPD_TEXT, text.as_ptr()) < 0 {
                *slot = None;
                return Err(super::NO_SERVICE.into());
            }
        }
        Ok(())
    }

    pub fn stop() {
        if let Some(connection) = CONNECTION.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            // SAFETY: see speak.
            unsafe { (connection.cancel)(connection.handle) };
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::{io::Write, process::{Child, Command, Stdio}, sync::Mutex};

    static CURRENT: Mutex<Option<Child>> = Mutex::new(None);

    pub fn available() -> bool {
        true
    }

    pub fn speak(text: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        stop();
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd())",
            ])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| super::NO_SERVICE.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }

    pub fn stop() {
        if let Some(mut child) = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    pub fn available() -> bool {
        false
    }
    pub fn speak(_: &str) -> Result<(), String> {
        Err(super::NO_SERVICE.into())
    }
    pub fn stop() {}
}

pub use platform::{available, speak, stop};

/// Reads `text` aloud, trimmed to a length a speech service handles comfortably.
pub fn speak_reply(text: &str) -> Result<(), String> {
    let text: String = text.chars().take(4_000).collect();
    if text.trim().is_empty() {
        return Ok(());
    }
    speak(&text)
}
