const COMMANDS: &[&str] = &[
    // Cleanup command
    "cleanup_ginfer_processes",
    // GInfer server commands
    "load_ginfer_model",
    "unload_ginfer_model",
    "is_process_running",
    "get_random_port",
    "find_session_by_model",
    "get_loaded_models",
    "get_all_sessions",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
