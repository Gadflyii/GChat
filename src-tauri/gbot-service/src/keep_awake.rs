//! Keeps the service computer awake while a bot task is running, so work is not cut off by the
//! computer's idle sleep. It cannot wake a sleeping or switched-off computer, and it never blocks
//! a person pressing the sleep button or closing the lid. The hold ends as soon as the task stops.
//!
//! Linux asks systemd-logind through `systemd-inhibit` (a child process that is killed when the
//! hold ends); Windows uses `SetThreadExecutionState` on a dedicated thread. Elsewhere, or when the
//! system offers no way, it quietly does nothing.

/// Dropping this ends the hold.
pub struct Awake(Inner);

#[cfg(unix)]
struct Inner(Option<std::process::Child>);

#[cfg(windows)]
struct Inner(Option<(std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>)>);

#[cfg(not(any(unix, windows)))]
struct Inner;

const WHY: &str = "A Gbot task is running";

pub fn hold() -> Awake {
    #[cfg(target_os = "linux")]
    {
        // Blocking idle and sleep needs an active desktop session; blocking idle alone is allowed more widely,
        // so fall back to it. Either one stops the computer sleeping because nobody touched it.
        let why = format!("--why={WHY}");
        let both = ["--what=idle:sleep", "--who=GChat", why.as_str(), "--mode=block", "sleep", "infinity"];
        let idle = ["--what=idle", "--who=GChat", why.as_str(), "--mode=block", "sleep", "infinity"];
        return Awake(Inner(start_first(&[("systemd-inhibit", &both), ("systemd-inhibit", &idle)])));
    }
    #[cfg(windows)]
    {
        return Awake(Inner(start_windows()));
    }
    #[allow(unreachable_code)]
    Awake(Inner(
        #[cfg(unix)]
        None,
        #[cfg(windows)]
        None,
    ))
}

/// Starts the first holder that is still running a moment later (one refused by the system exits at once).
#[cfg(unix)]
fn start_first(candidates: &[(&str, &[&str])]) -> Option<std::process::Child> {
    for (program, args) in candidates {
        if let Some(mut child) = start_linux(program, args) {
            std::thread::sleep(std::time::Duration::from_millis(300));
            if matches!(child.try_wait(), Ok(None)) {
                return Some(child);
            }
            let _ = child.wait();
        }
    }
    None
}

#[cfg(unix)]
fn start_linux(program: &str, args: &[&str]) -> Option<std::process::Child> {
    std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()
}

#[cfg(windows)]
fn start_windows() -> Option<(std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>)> {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    let (stop, wait) = std::sync::mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
        .name("gbot-keep-awake".into())
        .spawn(move || {
            // SAFETY: plain Win32 call; the state belongs to this thread and is cleared before it ends.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            let _ = wait.recv();
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        })
        .ok()?;
    Some((stop, thread))
}

impl Drop for Awake {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(mut child) = self.0 .0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        if let Some((stop, thread)) = self.0 .0.take() {
            let _ = stop.send(());
            let _ = thread.join();
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn alive(pid: u32) -> bool {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
            && std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|s| !s.contains(") Z "))
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_hold_lasts_exactly_as_long_as_the_guard_and_a_missing_tool_is_harmless() {
        let child = start_linux("sleep", &["infinity"]).expect("sleep is available");
        let pid = child.id();
        assert!(alive(pid));
        drop(Awake(Inner(Some(child))));
        assert!(!alive(pid), "the holder is stopped when the guard is dropped");
        assert!(start_linux("/nonexistent/systemd-inhibit", &[]).is_none());
        // A holder the system refuses (exits at once) is skipped for the next candidate.
        let fallback = start_first(&[("false", &[]), ("/nonexistent/x", &[]), ("sleep", &["infinity"])]).expect("fallback holds");
        let fallback_pid = fallback.id();
        assert!(alive(fallback_pid));
        drop(Awake(Inner(Some(fallback))));
        assert!(!alive(fallback_pid));
        assert!(start_first(&[("false", &[])]).is_none());
        drop(Awake(Inner(None)));
        // The public entry point never panics, with or without systemd.
        drop(hold());
    }
}
