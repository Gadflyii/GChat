//! Desktop lifetime on Windows and Linux.
//!
//! Rule: whenever any GChat or GInfer process runs on a desktop, its system
//! tray icon is visible, and nothing keeps running unseen.
//! - Closing the window quits everything unless a model is loaded or a Gbot
//!   background feature is on; then GChat hides to the tray (once-only notice).
//! - The tray menu has Open GChat, Open Server Manager and Quit GChat. Quit
//!   stops chats, the Gbot service, the model, the Host, then exits.
//! - A tray that cannot be created never leaves a hidden process behind: a
//!   background start exits, and closing the window always quits everything.
//!
//! Headless servers are decided from the session ([`ginfer_host::tray_probe`]),
//! never from a tray failure.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// How long Quit waits for the whole shutdown before the process leaves anyway.
pub const QUIT_DEADLINE: std::time::Duration = std::time::Duration::from_secs(900);

pub const CLOSE_TO_TRAY_NOTICE: &str = "GChat is still running in the system tray because {reason}. Right-click the tray icon and choose Quit to close it.";

#[derive(Default)]
pub struct Lifecycle {
    tray_ready: AtomicBool,
    quitting: AtomicBool,
}

impl Lifecycle {
    pub fn tray_ready(&self) -> bool {
        self.tray_ready.load(Ordering::SeqCst)
    }
    pub fn quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
    /// Marks Quit under way; true only for the first caller.
    pub fn begin_quit(&self) -> bool {
        !self.quitting.swap(true, Ordering::SeqCst)
    }
}

/// True when GChat was started hidden (sign-in startup) and must live in the tray.
pub fn background_launch() -> bool {
    std::env::args().any(|argument| argument == "--background")
}

/// Why the window should hide instead of quitting, or None to quit everything.
pub async fn background_reason<R: Runtime>(app: &AppHandle<R>) -> Option<&'static str> {
    if crate::core::gbot::background_work_active(app).await {
        return Some("Gbot tasks are on");
    }
    #[cfg(any(windows, target_os = "linux"))]
    {
        if crate::core::system::autostart::is_launch_at_startup_enabled(app.clone())
            .await
            .unwrap_or(false)
        {
            return Some("GChat starts when you sign in");
        }
        match crate::core::engine_hosts::configured_local_host_has_models(app).await {
            Ok(true) => return Some("a model is still loaded"),
            Ok(false) => {}
            Err(error) => log::warn!("Could not check for a loaded model on close: {error}"),
        }
    }
    None
}

/// Creates the tray. Returns whether a visible tray exists.
pub fn install_tray(app: &tauri::App) -> bool {
    #[cfg(target_os = "linux")]
    {
        if ginfer_host::tray_probe::headless_session() {
            log::info!("No graphical session: running headless without a tray");
            return false;
        }
        if !tauri::async_runtime::block_on(ginfer_host::tray_probe::status_notifier_watcher_available()) {
            log::warn!("No StatusNotifierWatcher on the session bus: a tray icon would be invisible, so none is created");
            return false;
        }
    }
    match crate::core::setup::setup_tray(app) {
        Ok(_) => {
            app.state::<Lifecycle>().tray_ready.store(true, Ordering::SeqCst);
            true
        }
        Err(error) => {
            log::warn!("System tray icon could not be created: {error}");
            false
        }
    }
}

/// Shows the main window again (tray Open, a second launch).
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Main window close on Windows and Linux. The close is always taken over here
/// so the decision is made once: hide to the tray, or quit everything.
pub fn on_main_close_requested<R: Runtime>(app: &AppHandle<R>, api: &tauri::CloseRequestApi) {
    if app.state::<Lifecycle>().quitting() {
        return;
    }
    api.prevent_close();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let reason = if app.state::<Lifecycle>().tray_ready() {
            background_reason(&app).await
        } else {
            None
        };
        match reason {
            Some(reason) => hide_to_tray(&app, reason),
            None => {
                log::info!("Window closed with no background work: quitting GChat");
                app.exit(0);
            }
        }
    });
}

fn hide_to_tray<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("Main window is gone while hiding to the tray: quitting GChat");
        app.exit(0);
        return;
    };
    if let Err(error) = window.hide() {
        log::warn!("Could not hide the window ({error}): quitting GChat");
        app.exit(0);
        return;
    }
    log::info!("Window closed to the tray because {reason}");
    notice_once(app, reason);
}

fn notice_once<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    let marker = crate::core::app::commands::get_jan_data_folder_path(app.clone())
        .join("close-to-tray-notice.json");
    if marker.exists() {
        return;
    }
    let text = CLOSE_TO_TRAY_NOTICE.replace("{reason}", reason);
    use tauri_plugin_notification::NotificationExt;
    match app.notification().builder().title("GChat").body(&text).show() {
        Ok(()) => {
            let _ = std::fs::write(&marker, b"true");
        }
        Err(error) => log::warn!("Close-to-tray notice could not be shown: {error}"),
    }
}

/// Quit order after chats and the local API: Gbot service, model, Host.
#[cfg(any(windows, target_os = "linux"))]
pub async fn stop_services<R: Runtime>(app: &AppHandle<R>) {
    log::info!("Quit: stopping the Gbot service");
    if let Err(error) = crate::core::gbot::stop_service_for_quit(app).await {
        log::warn!("Gbot service did not stop on Quit: {error}");
    }
    log::info!("Quit: stopping the model and Host");
    match crate::core::engine_hosts::stop_configured_local_host_and_models(app).await {
        Ok(true) => log::info!("Model and Host stopped"),
        Ok(false) => log::info!("No desktop Host was attached; nothing to stop"),
        Err(error) => log::warn!("Model and Host stop was not confirmed: {error}"),
    }
}

/// Last resort: no shutdown step may leave a process with no window and no tray.
pub fn exit_after_deadline() {
    std::thread::spawn(|| {
        std::thread::sleep(QUIT_DEADLINE);
        log::warn!("Shutdown exceeded {QUIT_DEADLINE:?}; leaving now");
        std::process::exit(0);
    });
}
