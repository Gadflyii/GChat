use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
pub mod process;
pub mod state;

pub use commands::{load_ginfer_model_impl, GinferConfig};
pub use process::cleanup_ginfer_processes;
pub use state::GinferState;

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ginfer")
        .invoke_handler(tauri::generate_handler![
            // Cleanup command
            process::cleanup_ginfer_processes,
            // GInfer server commands
            commands::load_ginfer_model,
            commands::unload_ginfer_model,
            commands::is_process_running,
            commands::get_random_port,
            commands::find_session_by_model,
            commands::get_loaded_models,
            commands::get_all_sessions,
        ])
        .setup(|app, _api| {
            // Initialize and manage the plugin state
            app.manage(GinferState::default());
            Ok(())
        })
        .build()
}
