fail() { printf '%s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail 'Run this command with sudo on the bot computer.'
[ "${SUDO_USER:-}" = "$bot_user" ] || fail 'Run sudo from the selected bot SSH account.'
. /etc/os-release
[ "$ID:$VERSION_ID" = debian:13 ] || fail 'This installer supports Debian 13.'
bot_uid=$(id -u "$bot_user")
bot_group=$(id -gn "$bot_user")
bot_home=$(getent passwd "$bot_user" | cut -d: -f6)
[ -d "$bot_home" ] || fail 'The bot account has no home folder.'
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for session in $(loginctl list-sessions --no-legend | awk '{print $1}'); do
  type=$(loginctl show-session "$session" -p Type --value)
  case $type in x11|wayland) fail 'Sign out of graphical sessions before preparing this dedicated computer.';; esac
done
owned=false
if [ -f /var/lib/gbot/lan-owner ]; then
  [ "$(cat /var/lib/gbot/lan-owner)" = "$workspace:$bot_user" ] || fail 'Another Gbot setup owns the existing tools.'
  owned=true
fi
check_owned() {
  [ ! -L "$1" ] || fail "Refusing to replace a symlink: $1"
  if [ -e "$1" ] && [ "$owned" != true ]; then fail "Existing file belongs to another setup: $1"; fi
}
check_owned /opt/gbot
check_owned /var/lib/gbot/installed
