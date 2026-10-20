//! Desktop-session facts that decide whether a system tray can be shown.
//! Headless is decided from the session itself, never from a tray failure.

/// True when this process has no graphical session to show a tray in: a
/// Linux server, SSH login or service. Windows always has a desktop here;
/// the Windows Host service is a separate service-mode process.
pub fn headless_session() -> bool {
    #[cfg(target_os = "linux")]
    {
        no_display(
            std::env::var_os("DISPLAY").as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg(any(target_os = "linux", test))]
fn no_display(x11: Option<&std::ffi::OsStr>, wayland: Option<&std::ffi::OsStr>) -> bool {
    [x11, wayland].iter().all(|value| value.is_none_or(|value| value.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::no_display;
    use std::ffi::OsStr;

    #[test]
    fn a_session_is_headless_only_when_neither_display_is_set() {
        assert!(no_display(None, None));
        assert!(no_display(Some(OsStr::new("")), Some(OsStr::new(""))));
        assert!(!no_display(Some(OsStr::new(":0")), None));
        assert!(!no_display(None, Some(OsStr::new("wayland-0"))));
    }
}

/// AppIndicator construction can succeed without a desktop watcher, which would
/// leave a running process with an invisible icon. Ask the session bus whether a
/// StatusNotifierWatcher owns its name before trusting a tray (one second bound).
#[cfg(target_os = "linux")]
pub async fn status_notifier_watcher_available() -> bool {
    use tokio::io::AsyncReadExt;

    let mut child = match tokio::process::Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--timeout",
            "1",
            "--dest",
            "org.freedesktop.DBus",
            "--object-path",
            "/org/freedesktop/DBus",
            "--method",
            "org.freedesktop.DBus.NameHasOwner",
            "org.kde.StatusNotifierWatcher",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let mut stdout = child.stdout.take().expect("piped watcher probe output");
    let mut output = Vec::new();
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        let (_, status) = tokio::try_join!(stdout.read_to_end(&mut output), child.wait())?;
        Ok::<_, std::io::Error>(status.success() && output == b"(true,)\n")
    })
    .await;
    match result {
        Ok(Ok(available)) => available,
        _ => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(std::time::Duration::from_millis(250), child.wait()).await;
            false
        }
    }
}
