const COMMANDS: &[&str] = &[
    // Cleanup command
    "cleanup_ginfer_processes",
    // GInfer server commands
    "load_ginfer_model",
    "unload_ginfer_model",
    "is_process_running",
    "find_session_by_model",
    "get_loaded_models",
    "get_all_sessions",
    "run_ginfer_benchmark",
    "cancel_ginfer_benchmark",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
