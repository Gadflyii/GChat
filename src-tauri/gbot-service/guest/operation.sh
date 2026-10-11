#!/bin/bash
# Durable receipts for SSH commands/files; Cua remains a separate MCP process.
set -eu
umask 077
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
mode=$1; workspace=$2; session=$3; shift 3
[[ $workspace =~ ^[0-9a-f-]{36}$ && $session =~ ^[0-9a-f-]{36}$ ]] || exit 64
root=$HOME/.local/state/gbot/$workspace/$session
live=$(systemctl --user show gbot-desktop.service --property=InvocationID --value)
[[ $live =~ ^[0-9a-f]{32}$ ]] || exit 69
systemctl --user is-active --quiet gbot-desktop.service || exit 69
mkdir -p "$root"
# Bind once to this desktop lifetime; a changed desktop needs a new session.
if (set -C; printf '%s' "$live" > "$root/desktop") 2>/dev/null; then :; fi
[[ $(cat "$root/desktop") == "$live" ]] || exit 65
if [ "$mode" = hello ]; then
  printf 'GBOT-SSH-1\n%s\n%s\n' "$workspace" "$session"
  exit 0
fi
operation=$1; shift
[[ $operation =~ ^[0-9a-f-]{36}$ ]] || exit 64
record=$root/$operation
unit=gbot-op-$operation.service
receipt() {
  if [ -f "$record/exit" ]; then
    printf 'completed\n%s\n%s\n' "$(cat "$record/exit")" "$(wc -c < "$record/stdout")"
    cat "$record/stdout" "$record/stderr"
  elif [ -f "$record/cancelled" ]; then printf 'cancelled\n';
  elif systemctl --user is-active --quiet "$unit"; then printf 'running\n';
  else printf 'unknown\n'; fi
}
case "$mode" in
  status) receipt; exit 0 ;;
  cancel)
    if [ ! -f "$record/exit" ] && [ ! -f "$record/cancelled" ]; then
      # Cua actions cannot be undone or safely declared cancelled in mid-flight.
      [ -f "$record/desktop" ] && { receipt; exit 0; }
      if systemctl --user is-active --quiet "$unit"; then
        systemctl --user stop "$unit"
        systemctl --user is-active --quiet "$unit" && exit 70
        : > "$record/cancelled"
      fi
    fi
    receipt; exit 0 ;;
  finish)
    [ -f "$record/desktop" ] && [ ! -f "$record/exit" ] || exit 66
    cat > "$record/stdout.tmp"
    mv "$record/stdout.tmp" "$record/stdout"
    : > "$record/stderr"
    printf '%s' "$1" > "$record/exit.tmp"
    mv "$record/exit.tmp" "$record/exit"
    receipt; exit 0 ;;
esac
# Atomic claim survives lost replies and forbids a second dispatch.
mkdir "$record" || exit 66
: > "$record/stdout"; : > "$record/stderr"
if [ "$mode" = desktop ]; then : > "$record/desktop"; printf 'claimed\n'; exit 0; fi
case "$mode" in
  exec) cwd=$1; shift; command=(env -- "$@") ;;
  read) cwd=$HOME; command=(dd "if=$1" "skip=$2" "count=$3" iflag=skip_bytes,count_bytes bs=65536 status=none) ;;
  write)
    cwd=$HOME
    cat > "$record/input"
    if [ "$3" = true ]; then command=(dd "if=$record/input" "of=$1" "seek=$2" oflag=seek_bytes bs=65536 status=none);
    else command=(dd "if=$record/input" "of=$1" "seek=$2" oflag=seek_bytes bs=65536 conv=notrunc status=none); fi ;;
  *) exit 64 ;;
esac
# The transient unit owns the child group independently of the SSH channel.
systemd-run --user --quiet --collect --wait --unit="$unit" --property=KillMode=control-group \
  /bin/bash -c 'record=$1; cwd=$2; shift 2; cd -- "$cwd" && "$@" > "$record/stdout" 2> "$record/stderr"; code=$?; printf "%s" "$code" > "$record/exit.tmp"; mv "$record/exit.tmp" "$record/exit"' \
  gbot "$record" "$cwd" "${command[@]}" >/dev/null 2>&1 || true
receipt
