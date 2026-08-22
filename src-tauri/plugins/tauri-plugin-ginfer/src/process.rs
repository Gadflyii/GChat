use std::collections::HashSet;
use tauri::{Manager, Runtime, State};

use crate::state::{GinferState, SessionInfo};
use jan_utils::generate_random_port;

/// Check if a process is running by PID
pub async fn is_process_running_by_pid<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    let state: State<GinferState> = app_handle.state();
    let mut map = state.ginfer_process.lock().await;

    if let Some(session) = map.get_mut(&pid) {
        match session.child.try_wait() {
            Ok(None) => Ok(true),
            Ok(Some(status)) => {
                log::info!(
                    "ginfer process {} exited (status {}); dropping stale session",
                    pid,
                    status
                );
                map.remove(&pid);
                Ok(false)
            }
            Err(e) => Err(format!("failed to query state of process {}: {}", pid, e)),
        }
    } else {
        // Not tracked (already reaped, or never loaded by this app instance):
        // probe the OS so a process that outlived its session is reported honestly.
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            // A `None` signal is signal 0: error checking only, nothing is sent.
            match kill(Pid::from_raw(pid), None::<Signal>) {
                Ok(()) => Ok(true),
                Err(nix::errno::Errno::ESRCH) => Ok(false),
                // Exists but we lack permission to signal it: still alive.
                Err(nix::errno::Errno::EPERM) => Ok(true),
                Err(e) => Err(format!("failed to probe process {}: {}", pid, e)),
            }
        }
        #[cfg(not(unix))]
        {
            log::warn!(
                "PID {} is not tracked and cannot be probed on this platform; reporting as not running",
                pid
            );
            Ok(false)
        }
    }
}

/// Get a random available port, avoiding ports used by existing sessions
pub async fn get_random_available_port<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<u16, String> {
    // Get all active ports from sessions
    let state: State<GinferState> = app_handle.state();
    let map = state.ginfer_process.lock().await;

    let used_ports: HashSet<u16> = map.values().map(|session| session.info.port).collect();

    drop(map); // unlock early

    generate_random_port(&used_ports)
}

/// Gracefully terminate a process on Unix systems
#[cfg(unix)]
pub async fn graceful_terminate_process(child: &mut tokio::process::Child) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    use std::time::Duration;
    use tokio::time::timeout;

    if let Some(raw_pid) = child.id() {
        let raw_pid = raw_pid as i32;
        log::info!("Sending SIGTERM to PID {}", raw_pid);
        let _ = kill(Pid::from_raw(raw_pid), Signal::SIGTERM);

        match timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(status)) => log::info!("Process exited gracefully: {}", status),
            Ok(Err(e)) => log::error!("Error waiting after SIGTERM: {}", e),
            Err(_) => {
                log::warn!("SIGTERM timed out; sending SIGKILL to PID {}", raw_pid);
                let _ = kill(Pid::from_raw(raw_pid), Signal::SIGKILL);
                match child.wait().await {
                    Ok(s) => log::info!("Force-killed process exited: {}", s),
                    Err(e) => log::error!("Error waiting after SIGKILL: {}", e),
                }
            }
        }
    }
}

/// Force terminate a process on Windows
#[cfg(all(windows, target_arch = "x86_64"))]
pub async fn force_terminate_process(child: &mut tokio::process::Child) {
    if let Some(raw_pid) = child.id() {
        log::warn!(
            "gracefully killing is unsupported on Windows, force-killing PID {}",
            raw_pid
        );

        // Since we know a graceful shutdown doesn't work and there are no child processes
        // to worry about, we can use `child.kill()` directly. On Windows, this is
        // a forceful termination via the `TerminateProcess` API.
        if let Err(e) = child.kill().await {
            log::error!(
                "Failed to send kill signal to PID {}: {}. It may have already terminated.",
                raw_pid,
                e
            );
        }

        match child.wait().await {
            Ok(status) => log::info!(
                "process {} has been terminated. Final exit status: {}",
                raw_pid,
                status
            ),
            Err(e) => log::error!(
                "Error waiting on child process {} after kill: {}",
                raw_pid,
                e
            ),
        }
    }
}

/// Find a session by model ID
pub async fn find_session_by_model_id<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: &str,
) -> Result<Option<SessionInfo>, String> {
    let state: State<GinferState> = app_handle.state();
    let map = state.ginfer_process.lock().await;

    let session_info = map
        .values()
        .find(|session| session.info.model_id == model_id)
        .map(|session| session.info.clone());

    Ok(session_info)
}

/// Get all loaded model IDs
pub async fn get_all_loaded_model_ids<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let state: State<GinferState> = app_handle.state();
    let map = state.ginfer_process.lock().await;

    let model_ids = map
        .values()
        .map(|session| session.info.model_id.clone())
        .collect();

    Ok(model_ids)
}

/// Get all active sessions
pub async fn get_all_active_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    let state: State<GinferState> = app_handle.state();
    let map = state.ginfer_process.lock().await;
    let sessions: Vec<SessionInfo> = map.values().map(|s| s.info.clone()).collect();
    Ok(sessions)
}

/// Terminate every tracked ginfer session. Called both as a command
/// (`plugin:ginfer|cleanup_ginfer_processes`) and from the app's exit path.
#[tauri::command]
pub async fn cleanup_ginfer_processes<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state = match app_handle.try_state::<GinferState>() {
        Some(state) => state,
        None => {
            log::warn!("GinferState not found in app_handle");
            return Ok(());
        }
    };

    let mut map = state.ginfer_process.lock().await;
    let pids: Vec<i32> = map.keys().cloned().collect();
    for pid in pids {
        if let Some(session) = map.remove(&pid) {
            let mut child = session.child;
            log::info!("Terminating ginfer session (model {}) during cleanup", session.info.model_id);

            #[cfg(unix)]
            {
                graceful_terminate_process(&mut child).await;
            }

            #[cfg(all(windows, target_arch = "x86_64"))]
            {
                force_terminate_process(&mut child).await;
            }
        }
    }

    Ok(())
}
