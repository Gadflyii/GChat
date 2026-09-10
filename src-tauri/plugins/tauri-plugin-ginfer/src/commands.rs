use crate::{
    process,
    state::{GinferSession, GinferState, SessionInfo, SessionOwner},
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, Runtime, State};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct GinferConfig {
    pub vision: bool,
    pub spec: String,
    pub draft_tokens: u32,
    pub draft_tp: u32,
    pub kv_dtype: String,
    pub max_context: u32,
    pub kv_arena_bytes: String,
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
            draft_tp: 0,
            kv_dtype: "auto".into(),
            max_context: 0,
            kv_arena_bytes: "auto".into(),
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

/// CLI endpoint settings do not change ownership of the inference process.
pub async fn load_ginfer_model_impl(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    binary_path: &str,
    host_directory: PathBuf,
    model_id: String,
    model_path: String,
    port: u16,
    config: GinferConfig,
    api_key: String,
    is_embedding: bool,
    timeout: u64,
) -> Result<SessionInfo, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("cannot bind CLI endpoint: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let host_binary = executable
        .parent()
        .ok_or("CLI executable has no parent")?
        .join(if cfg!(windows) {
            "ginfer-host.exe"
        } else {
            "ginfer-host"
        });
    let mut info = crate::managed::load(
        sessions.clone(),
        host_binary,
        Path::new(binary_path).to_path_buf(),
        host_directory,
        model_id,
        model_path,
        config,
        is_embedding,
        timeout,
    )
    .await?;
    let endpoint = crate::cli_endpoint::CliEndpoint::start(
        listener,
        info.port,
        info.api_key.clone(),
        api_key.clone(),
    )?;
    info.port = port;
    info.api_key = api_key;
    let mut map = sessions.lock().await;
    let session = map
        .get_mut(&info.pid)
        .ok_or("loaded host session disappeared")?;
    session.endpoint = Some(endpoint);
    session.info = info.clone();
    Ok(info)
}

#[tauri::command]
pub async fn load_ginfer_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    binary_path: &str,
    host_directory: String,
    model_id: String,
    model_path: String,
    config: GinferConfig,
    is_embedding: bool,
    timeout: u64,
) -> Result<SessionInfo, String> {
    let state: State<GinferState> = app_handle.state();
    let host_binary = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/bin")
        .join(if cfg!(windows) {
            "ginfer-host.exe"
        } else {
            "ginfer-host"
        });
    crate::managed::load(
        state.ginfer_process.clone(),
        host_binary,
        Path::new(binary_path).to_path_buf(),
        host_directory.into(),
        model_id,
        model_path,
        config,
        is_embedding,
        timeout,
    )
    .await
}

pub async fn stop_session(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    handle: i32,
) -> Result<(), String> {
    let session = sessions.lock().await.remove(&handle);
    if let Some(session) = session {
        let SessionOwner {
            control,
            connection,
        } = &session.owner;
        if let Err(error) = control.stop_session(connection).await {
            sessions.lock().await.insert(handle, session);
            return Err(error);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn unload_ginfer_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<UnloadResult, String> {
    let state: State<GinferState> = app_handle.state();
    stop_session(state.ginfer_process.clone(), pid).await?;
    Ok(UnloadResult {
        success: true,
        error: None,
    })
}
#[tauri::command]
pub async fn is_process_running<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    pid: i32,
) -> Result<bool, String> {
    process::is_process_running_by_pid(app_handle, pid).await
}
#[tauri::command]
pub async fn find_session_by_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    model_id: String,
) -> Result<Option<SessionInfo>, String> {
    process::find_session_by_model_id(app_handle, &model_id).await
}
#[tauri::command]
pub async fn get_loaded_models<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    process::get_all_loaded_model_ids(app_handle).await
}
#[tauri::command]
pub async fn get_all_sessions<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    process::get_all_active_sessions(app_handle).await
}
