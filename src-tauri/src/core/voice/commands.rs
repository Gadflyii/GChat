use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use super::{assets, capture::Recorder, speak, stt};
use crate::core::app::commands::get_jan_data_folder_path;

static RECORDER: Mutex<Option<Recorder>> = Mutex::new(None);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct VoiceStatus {
    pub model_ready: bool,
    pub download_bytes: u64,
    pub can_speak: bool,
    pub listening: bool,
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn voice_status<R: Runtime>(app: AppHandle<R>) -> Result<VoiceStatus, String> {
    let path = assets::model_path(&get_jan_data_folder_path(app));
    let model_ready = tokio::task::spawn_blocking(move || assets::verified(&path, &assets::SPEECH_MODEL))
        .await
        .map_err(|_| "Voice status is unavailable.".to_string())?;
    Ok(VoiceStatus {
        model_ready,
        download_bytes: assets::SPEECH_MODEL.bytes,
        can_speak: tokio::task::spawn_blocking(speak::available).await.unwrap_or(false),
        listening: RECORDER.lock().map(|r| r.is_some()).unwrap_or(false),
    })
}

/// One-time download of the speech model. Progress arrives as `voice-download` events.
#[tauri::command]
pub async fn voice_prepare<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if DOWNLOADING.swap(true, Ordering::AcqRel) {
        return Err("The speech model is already downloading.".into());
    }
    let path = assets::model_path(&get_jan_data_folder_path(app.clone()));
    let events = app.clone();
    let result = assets::download(&assets::SPEECH_MODEL, assets::SPEECH_MODEL.url, &path, move |done, total| {
        let _ = events.emit("voice-download", Progress { done, total });
    })
    .await;
    DOWNLOADING.store(false, Ordering::Release);
    result
}

#[tauri::command]
pub fn voice_listen_start() -> Result<(), String> {
    let mut slot = RECORDER.lock().map_err(|_| "Voice input is unavailable.".to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    speak::stop();
    *slot = Some(Recorder::start()?);
    Ok(())
}

/// Stops recording and returns what was said as text for the user to review before running it.
#[tauri::command]
pub async fn voice_listen_stop<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let recorder = RECORDER
        .lock()
        .map_err(|_| "Voice input is unavailable.".to_string())?
        .take()
        .ok_or("Voice input was not listening.")?;
    let model = assets::model_path(&get_jan_data_folder_path(app));
    tokio::task::spawn_blocking(move || {
        if !assets::verified(&model, &assets::SPEECH_MODEL) {
            return Err("Download the speech model first.".to_string());
        }
        stt::transcribe(&model, &recorder.finish())
    })
    .await
    .map_err(|_| "Speech recognition stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub fn voice_listen_cancel() {
    if let Ok(mut slot) = RECORDER.lock() {
        slot.take();
    }
}

#[tauri::command]
pub async fn voice_speak(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || speak::speak_reply(&text))
        .await
        .map_err(|_| "Reading aloud stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub fn voice_speak_stop() {
    speak::stop();
}
