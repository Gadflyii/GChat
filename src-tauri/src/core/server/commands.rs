use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_ginfer::state::GinferState;

use crate::core::server::proxy;
use crate::core::server::state_file;
use crate::core::state::AppState;

#[derive(serde::Deserialize)]
pub struct StartServerConfig {
    pub host: String,
    pub port: u16,
    pub prefix: String,
    pub api_key: String,
    pub trusted_hosts: Vec<String>,
    pub proxy_timeout: u64,
}

#[tauri::command]
pub async fn start_server<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, AppState>,
    config: StartServerConfig,
) -> Result<u16, String> {
    let StartServerConfig {
        host,
        port,
        prefix,
        api_key,
        trusted_hosts,
        proxy_timeout,
    } = config;
    // The CLI is headless and cannot read these settings out of the webview's
    // localStorage, so mirror the effective address to disk for `server status`.
    let requires_api_key = !api_key.is_empty();
    let mirror_host = host.clone();
    let mirror_prefix = prefix.clone();
    let server_handle = state.server_handle.clone();
    let ginfer_state: State<GinferState> = app_handle.state();
    let ginfer_sessions = ginfer_state.ginfer_process.clone();

    let actual_port = proxy::start_server(
        app_handle.clone(),
        server_handle,
        ginfer_sessions,
        host,
        port,
        prefix,
        api_key,
        vec![trusted_hosts],
        proxy_timeout,
        state.provider_configs.clone(),
    )
    .await
    .map_err(|e| e.to_string())?;

    state_file::mark_running(&mirror_host, actual_port, &mirror_prefix, requires_api_key);

    Ok(actual_port)
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    let server_handle = state.server_handle.clone();

    proxy::stop_server(server_handle)
        .await
        .map_err(|e| e.to_string())?;

    state_file::mark_stopped();

    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let server_handle = state.server_handle.clone();

    Ok(proxy::is_server_running(server_handle).await)
}
