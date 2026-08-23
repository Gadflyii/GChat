use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio::time::Instant;

use crate::process::{
    find_session_by_model_id, get_all_active_sessions, get_all_loaded_model_ids,
    get_random_available_port, is_process_running_by_pid,
};
use crate::state::{GinferSession, GinferState, SessionInfo};
use jan_utils::{add_cuda_paths, setup_library_path, setup_windows_process_flags};

#[cfg(unix)]
use crate::process::graceful_terminate_process;

#[cfg(all(windows, target_arch = "x86_64"))]
use crate::process::force_terminate_process;

/// Startup capability configuration for a ginfer-serve session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct GinferConfig {
    pub vision: bool,
    pub spec: String,
    pub draft_tokens: u32,
    pub kv_dtype: String,
    pub lm_head_draft: bool,
    pub max_context: u32,
    pub kv_capacity: String,
    pub prefill_chunk: u32,
    pub max_concurrency: u32,
    pub no_cuda_graph: bool,
}

impl Default for GinferConfig {
    fn default() -> Self {
        Self {
            vision: true,
            spec: "auto".into(),
            draft_tokens: 0,
            kv_dtype: String::new(),
            lm_head_draft: false,
            max_context: 0,
            kv_capacity: String::new(),
            prefill_chunk: 0,
            max_concurrency: 0,
            no_cuda_graph: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UnloadResult {
    success: bool,
    error: Option<String>,
}

/// Trailing slice of the captured output, bounded to `max_chars` so error
/// messages stay readable even when the server dumped a large startup log.
fn tail_output(stderr: &str, stdout: &str, max_chars: usize) -> String {
    let mut combined = String::new();
    if !stderr.trim().is_empty() {
        combined.push_str(stderr);
    }
    if !stdout.trim().is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(stdout);
    }
    if combined.len() <= max_chars {
        return combined;
    }
    let start = combined.floor_char_boundary(combined.len() - max_chars);
    format!("...[truncated]...\n{}", &combined[start..])
}

/// Build the error string for a non-ready ginfer-serve exit. The server
/// rejects an invalid artifact before binding its port, so the tail of its
/// stderr/stdout is the actionable part of the message.
fn exit_error(status: &std::process::ExitStatus, stderr: &str, stdout: &str) -> String {
    format!(
        "ginfer-serve exited with status {:?} before it became ready. The model artifact may be invalid or the server may have failed to start. Server output:\n{}",
        status,
        tail_output(stderr, stdout, 2000)
    )
}

/// Core model loading logic usable without an AppHandle (CLI / test support).
pub async fn load_ginfer_model_impl(
    process_map_arc: Arc<Mutex<HashMap<i32, GinferSession>>>,
    binary_path: &str,
    model_id: String,
    model_path: String,
    port: u16,
    config: GinferConfig,
    api_key: String,
    is_embedding: bool,
    timeout: u64,
) -> Result<SessionInfo, String> {
    log::info!("Attempting to launch ginfer-serve at path: {:?}", binary_path);
    log::info!("Using configuration: {:?}", config);

    let bin_path = Path::new(binary_path);
    if !bin_path.is_file() {
        return Err(format!("ginfer-serve binary not found at: {}", binary_path));
    }

    let model_path_buf = Path::new(&model_path);
    if !model_path_buf.is_file() {
        return Err(format!("ginfer model not found at: {}", model_path));
    }

    // Build the argument vector. The model path is the single positional
    // argument and must come last.
    let mut args: Vec<String> = vec![
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--api-key".into(),
        api_key.clone(),
    ];

    if config.vision {
        args.push("--vision".into());
    }
    if !config.spec.is_empty() && config.spec != "auto" {
        args.push("--spec".into());
        args.push(config.spec.clone());
        if config.draft_tokens > 0 {
            args.push("--draft-tokens".into());
            args.push(config.draft_tokens.to_string());
        }
    }
    if !config.kv_dtype.is_empty() {
        args.push("--kv-dtype".into());
        args.push(config.kv_dtype.clone());
    }
    if config.lm_head_draft {
        args.push("--lm-head-draft".into());
    }
    if config.max_context > 0 {
        args.push("--max-context".into());
        args.push(config.max_context.to_string());
    }
    if !config.kv_capacity.is_empty() {
        args.push("--kv-capacity".into());
        args.push(config.kv_capacity.clone());
    }
    if config.prefill_chunk > 0 {
        args.push("--prefill-chunk".into());
        args.push(config.prefill_chunk.to_string());
    }
    if config.max_concurrency > 0 {
        let clamped = config.max_concurrency.clamp(1, 8);
        if clamped != config.max_concurrency {
            log::warn!(
                "max_concurrency {} is outside the valid range 1..=8; clamping to {}",
                config.max_concurrency,
                clamped
            );
        }
        args.push("--max-concurrency".into());
        args.push(clamped.to_string());
    }
    if config.no_cuda_graph {
        args.push("--no-cuda-graph".into());
    }

    args.push(model_path.clone());

    log::info!("Generated arguments: {:?}", args);

    // Configure the command to run the server
    let mut command = Command::new(bin_path);
    command.args(&args);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    // Kill the spawned ginfer-serve if this load future is dropped before the
    // child is handed off to the tracked process map (e.g. a rapid model
    // switch supersedes/cancels an in-flight load), so it cannot be orphaned.
    command.kill_on_drop(true);
    setup_windows_process_flags(&mut command);

    // Try to add CUDA paths (works on both Windows and Linux)
    let _cuda_found = add_cuda_paths(&mut command);

    // Add the binary's directory to library path
    setup_library_path(bin_path.parent(), &mut command);

    // Spawn the child process
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn ginfer-serve at {}: {}", binary_path, e))?;

    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout = child.stdout.take().expect("stdout was piped");

    // Create channels for communication between tasks
    let (ready_tx, mut ready_rx) = mpsc::channel::<bool>(1);

    // Spawn task to monitor stdout
    let stdout_ready_tx = ready_tx.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut byte_buffer = Vec::new();
        let mut stdout_buffer = String::new();

        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        stdout_buffer.push_str(line);
                        stdout_buffer.push('\n');
                        log::info!("[ginfer] {}", line);

                        // Check for readiness indicator
                        if line.to_lowercase().contains("listening on") {
                            log::info!(
                                "ginfer-serve appears to be ready based on stdout: '{}'",
                                line
                            );
                            let _ = stdout_ready_tx.send(true).await;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading stdout: {}", e);
                    break;
                }
            }
        }

        stdout_buffer
    });

    // Spawn task to capture stderr and monitor for readiness. ginfer-serve
    // writes all of its console logs — including the "listening on" line —
    // to stderr, so this is the primary log-based readiness signal.
    let stderr_ready_tx = ready_tx.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut byte_buffer = Vec::new();
        let mut stderr_buffer = String::new();

        loop {
            byte_buffer.clear();
            match reader.read_until(b'\n', &mut byte_buffer).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let line = String::from_utf8_lossy(&byte_buffer);
                    let line = line.trim_end();

                    if !line.is_empty() {
                        stderr_buffer.push_str(line);
                        stderr_buffer.push('\n');
                        log::info!("[ginfer] {}", line);

                        // Check for readiness indicator
                        if line.to_lowercase().contains("listening on") {
                            log::info!(
                                "ginfer-serve appears to be ready based on logs: '{}'",
                                line
                            );
                            let _ = stderr_ready_tx.send(true).await;
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error reading logs: {}", e);
                    break;
                }
            }
        }

        stderr_buffer
    });

    // Poll the /health endpoint as a wording-independent readiness signal,
    // complementing the log-line matcher above. GET /health is unauthenticated
    // and returns success only once the HTTP server is up.
    let health_ready_tx = ready_tx.clone();
    let health_task: tokio::task::JoinHandle<()> = tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to build health-check HTTP client: {}", e);
                return;
            }
        };
        let url = format!("http://127.0.0.1:{}/health", port);

        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    log::info!("ginfer-serve appears to be ready based on /health check");
                    let _ = health_ready_tx.send(true).await;
                    break;
                }
            }
        }
    });

    // Check if process exited early (e.g. the server rejected the artifact)
    match child.try_wait() {
        Ok(Some(status)) => {
            if !status.success() {
                health_task.abort();
                let stderr_output = stderr_task.await.unwrap_or_default();
                let stdout_output = stdout_task.await.unwrap_or_default();
                log::warn!("ginfer-serve failed early with code {:?}", status);
                log::warn!("{}", stderr_output);
                return Err(exit_error(&status, &stderr_output, &stdout_output));
            }
        }
        Ok(None) => {}
        Err(e) => {
            health_task.abort();
            return Err(format!("failed to check ginfer-serve status: {}", e));
        }
    }

    // Wait for server to be ready or timeout
    let timeout_duration = Duration::from_secs(timeout);
    let start_time = Instant::now();
    log::info!("Waiting for ginfer session to be ready...");

    loop {
        tokio::select! {
            // Server is ready
            Some(true) = ready_rx.recv() => {
                log::info!("ginfer-serve is ready to accept requests!");
                health_task.abort();
                break;
            }
            // Check for process exit more frequently
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                // Check if process exited
                match child.try_wait() {
                    Ok(Some(status)) => {
                        health_task.abort();
                        let stderr_output = stderr_task.await.unwrap_or_default();
                        if !status.success() {
                            let stdout_output = stdout_task.await.unwrap_or_default();
                            log::warn!("ginfer-serve exited with error code {:?}", status);
                            return Err(exit_error(&status, &stderr_output, &stdout_output));
                        } else {
                            let stdout_output = stdout_task.await.unwrap_or_default();
                            log::warn!("ginfer-serve exited successfully but without ready signal");
                            return Err(exit_error(&status, &stderr_output, &stdout_output));
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        health_task.abort();
                        return Err(format!("failed to check ginfer-serve status: {}", e));
                    }
                }

                // Timeout check
                if start_time.elapsed() > timeout_duration {
                    log::error!("Timeout waiting for ginfer-serve to be ready");
                    health_task.abort();
                    let _ = child.kill().await;
                    let stderr_output = stderr_task.await.unwrap_or_default();
                    let stdout_output = stdout_task.await.unwrap_or_default();
                    return Err(format!(
                        "ginfer-serve timed out after {}s while loading model {} (port {}). Server output:\n{}",
                        timeout_duration.as_secs(),
                        model_path,
                        port,
                        tail_output(&stderr_output, &stdout_output, 2000)
                    ));
                }
            }
        }
    }

    // Get the PID to use as session ID
    let pid = child.id().map(|id| id as i32).unwrap_or(-1);

    log::info!("ginfer-serve process started with PID {} and is ready", pid);

    let session_info = SessionInfo {
        pid,
        port,
        model_id,
        model_path,
        is_embedding,
        api_key,
    };

    {
        let mut process_map = process_map_arc.lock().await;
        process_map.insert(
            pid,
            GinferSession {
                child,
                info: session_info.clone(),
            },
        );
    }

    Ok(session_info)
}

/// Load a ginfer model and start the server
#[tauri::command]
pub async fn load_ginfer_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    binary_path: &str,
    model_id: String,
    model_path: String,
    port: u16,
    config: GinferConfig,
    api_key: String,
    is_embedding: bool,
    timeout: u64,
) -> Result<SessionInfo, String> {
    let state: State<GinferState> = app_handle.state();
    load_ginfer_model_impl(
        state.ginfer_process.clone(),
        binary_path,
        model_id,
        model_path,
        port,
        config,
        api_key,
        is_embedding,
        timeout,
    )
    .await
}

/// Unload a ginfer model by terminating its process
#[tauri::command]
pub async fn unload_ginfer_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<UnloadResult, String> {
    let state: State<GinferState> = app_handle.state();
    let mut map = state.ginfer_process.lock().await;

    if let Some(session) = map.remove(&pid) {
        let mut child = session.child;

        #[cfg(unix)]
        {
            graceful_terminate_process(&mut child).await;
        }

        #[cfg(all(windows, target_arch = "x86_64"))]
        {
            force_terminate_process(&mut child).await;
        }

        Ok(UnloadResult {
            success: true,
            error: None,
        })
    } else {
        log::warn!("No ginfer server with PID '{}' found", pid);
        Ok(UnloadResult {
            success: true,
            error: None,
        })
    }
}

/// Check if a process is still running
#[tauri::command]
pub async fn is_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    is_process_running_by_pid(app_handle, pid).await
}

/// Get a random available port
#[tauri::command]
pub async fn get_random_port<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<u16, String> {
    get_random_available_port(app_handle).await
}

/// Find session information by model ID
#[tauri::command]
pub async fn find_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    find_session_by_model_id(app_handle, &model_id).await
}

/// Get all loaded model IDs
#[tauri::command]
pub async fn get_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    get_all_loaded_model_ids(app_handle).await
}

/// Get all active sessions
#[tauri::command]
pub async fn get_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    get_all_active_sessions(app_handle).await
}
