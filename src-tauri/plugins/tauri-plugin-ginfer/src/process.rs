use crate::state::{GinferState, SessionInfo, SessionOwner};
use tauri::{Manager, Runtime, State};

pub async fn is_process_running_by_pid<R: Runtime>(
    app: tauri::AppHandle<R>,
    handle: i32,
) -> Result<bool, String> {
    let state: State<GinferState> = app.state();
    let map = state.ginfer_process.lock().await;
    let Some(session) = map.get(&handle) else {
        return Ok(false);
    };
    let SessionOwner { connection, .. } = &session.owner;
    let connection = connection.clone();
    drop(map);
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap()
    });
    let ready = client
        .get(format!("http://127.0.0.1:{}/v1/models", connection.port))
        .bearer_auth(&connection.api_key)
        .send()
        .await
        .map_err(|e| format!("local host session is unavailable: {e}"))?
        .status()
        .is_success();
    if !ready {
        state.ginfer_process.lock().await.remove(&handle);
    }
    Ok(ready)
}

pub async fn find_session_by_model_id<R: Runtime>(
    app: tauri::AppHandle<R>,
    model_id: &str,
) -> Result<Option<SessionInfo>, String> {
    Ok(get_all_active_sessions(app)
        .await?
        .into_iter()
        .find(|s| s.model_id == model_id))
}
pub async fn get_all_loaded_model_ids<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    Ok(get_all_active_sessions(app)
        .await?
        .into_iter()
        .map(|s| s.model_id)
        .collect())
}
pub async fn get_all_active_sessions<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<SessionInfo>, String> {
    let state: State<GinferState> = app.state();
    let sessions: Vec<_> = state
        .ginfer_process
        .lock()
        .await
        .values()
        .map(|s| s.info.clone())
        .collect();
    let mut active = Vec::new();
    for session in sessions {
        if is_process_running_by_pid(app.clone(), session.pid).await? {
            active.push(session);
        }
    }
    Ok(active)
}

/// Closing a client never stops host-owned serving.
#[tauri::command]
pub async fn cleanup_ginfer_processes<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(state) = app.try_state::<GinferState>() {
        state.ginfer_process.lock().await.clear();
    }
    Ok(())
}
