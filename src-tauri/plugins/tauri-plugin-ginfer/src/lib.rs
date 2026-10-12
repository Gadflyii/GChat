use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};
use std::{future::Future, pin::Pin};

pub mod benchmark;
mod cli_endpoint;
mod commands;
mod managed;
pub mod process;
pub mod state;

pub use commands::{
    load_ginfer_model_impl, stop_session, CliEndpointSettings, GinferConfig, GinferLoadRequest,
};
pub use process::cleanup_ginfer_processes;
pub use state::GinferState;

type LoadFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;
struct LoadPreparation(Box<dyn Fn() -> LoadFuture + Send + Sync>);

pub fn init<R, F, Fut>(prepare_load: F) -> TauriPlugin<R>
where
    R: Runtime,
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), String>> + Send + 'static,
{
    let preparation = LoadPreparation(Box::new(move || Box::pin(prepare_load())));
    Builder::new("ginfer")
        .invoke_handler(tauri::generate_handler![
            // Cleanup command
            process::cleanup_ginfer_processes,
            // GInfer server commands
            commands::load_ginfer_model,
            commands::unload_ginfer_model,
            commands::is_process_running,
            commands::find_session_by_model,
            commands::get_loaded_models,
            commands::get_all_sessions,
            benchmark::run_ginfer_benchmark,
            benchmark::cancel_ginfer_benchmark,
        ])
        .setup(move |app, _api| {
            app.manage(preparation);
            app.manage(GinferState::default());
            Ok(())
        })
        .build()
}
