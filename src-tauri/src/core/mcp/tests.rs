use super::commands::{collect_mcp_server_statuses, is_extension_not_connected_error};
use super::helpers::{
    add_server_config, add_server_config_with_path, append_bounded_stderr, ensure_mcp_config_exists,
    extract_command_args, format_mcp_start_error, is_process_already_gone, run_mcp_commands,
};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::state::{AppState, SharedMcpServers};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{test::mock_app, Manager};
use tokio::sync::Mutex;

#[test]
fn test_remote_config_does_not_require_stdio_fields() {
    let config = serde_json::json!({
        "type": "http",
        "url": "https://example.com/mcp"
    });

    let parsed = extract_command_args(&config).expect("remote config should parse");

    assert_eq!(parsed.transport_type.as_deref(), Some("http"));
    assert_eq!(parsed.url.as_deref(), Some("https://example.com/mcp"));
    assert!(parsed.command.is_empty());
    assert!(parsed.args.is_empty());
}

#[test]
fn test_mcp_start_error_preserves_transport_error_and_stderr_context() {
    let error = format_mcp_start_error(
        "Failed to start MCP server test: connection closed",
        "[123] Using automatically selected callback port: 12198",
    );

    assert!(error.contains("connection closed"));
    assert!(error.contains("stderr (context)"));
    assert!(error.contains("Using automatically selected callback port"));
}

#[test]
fn test_mcp_stderr_context_is_byte_bounded() {
    let mut captured = VecDeque::new();
    append_bounded_stderr(&mut captured, &vec![b'a'; 20 * 1024]);

    assert_eq!(captured.len(), 16 * 1024);
}

#[tokio::test]
async fn test_mcp_server_status_exposes_runtime_error() {
    let state = AppState::default();
    state
        .mcp_server_errors
        .lock()
        .await
        .insert("broken-server".to_string(), "Transport closed".to_string());

    let statuses = collect_mcp_server_statuses(&state).await;

    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].name, "broken-server");
    assert_eq!(
        statuses[0].status,
        super::models::McpServerStatusKind::Error
    );
    assert_eq!(statuses[0].error.as_deref(), Some("Transport closed"));
}

#[tokio::test]
async fn test_run_mcp_commands() {
    let app = mock_app();

    // Register AppState so state::<AppState>() calls succeed
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    // Get the app path where the config should be created
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create a mock mcp_config.json file at the correct location
    let mut file: File = File::create(&config_path).expect("Failed to create config file");
    file.write_all(b"{\"mcpServers\":{}}")
        .expect("Failed to write to config file");

    // Call the run_mcp_commands function
    let result = run_mcp_commands(app.handle(), servers_state).await;

    // Assert that the function returns Ok(())
    assert!(result.is_ok());

    // Clean up the mock config file
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
fn test_add_server_config_new_file() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config_test_new.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create initial config file with empty mcpServers
    let mut file = File::create(&config_path).expect("Failed to create config file");
    file.write_all(b"{\"mcpServers\":{}}")
        .expect("Failed to write to config file");
    drop(file);

    // Test adding a new server config
    let server_value = serde_json::json!({
        "command": "npx",
        "args": ["-y", "test-server"],
        "env": { "TEST_API_KEY": "test_key" },
        "active": false
    });

    let result = add_server_config_with_path(
        app.handle().clone(),
        "test_server".to_string(),
        server_value.clone(),
        Some("mcp_config_test_new.json"),
    );

    assert!(result.is_ok(), "Failed to add server config: {result:?}");

    // Verify the config was added correctly
    let config_content = std::fs::read_to_string(&config_path).expect("Failed to read config file");
    let config: serde_json::Value =
        serde_json::from_str(&config_content).expect("Failed to parse config");

    assert!(config["mcpServers"]["test_server"].is_object());
    assert_eq!(config["mcpServers"]["test_server"]["command"], "npx");
    assert_eq!(config["mcpServers"]["test_server"]["args"][0], "-y");
    assert_eq!(
        config["mcpServers"]["test_server"]["args"][1],
        "test-server"
    );

    // Clean up
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
fn test_add_server_config_existing_servers() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());
    let config_path = app_path.join("mcp_config_test_existing.json");

    // Ensure the directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create parent directory");
    }

    // Create config file with existing server
    let initial_config = serde_json::json!({
        "mcpServers": {
            "existing_server": {
                "command": "existing_command",
                "args": ["arg1"],
                "active": true
            }
        }
    });

    let mut file = File::create(&config_path).expect("Failed to create config file");
    file.write_all(
        serde_json::to_string_pretty(&initial_config)
            .unwrap()
            .as_bytes(),
    )
    .expect("Failed to write to config file");
    drop(file);

    // Add new server
    let new_server_value = serde_json::json!({
        "command": "new_command",
        "args": ["new_arg"],
        "active": false
    });

    let result = add_server_config_with_path(
        app.handle().clone(),
        "new_server".to_string(),
        new_server_value,
        Some("mcp_config_test_existing.json"),
    );

    assert!(result.is_ok(), "Failed to add server config: {result:?}");

    // Verify both servers exist
    let config_content = std::fs::read_to_string(&config_path).expect("Failed to read config file");
    let config: serde_json::Value =
        serde_json::from_str(&config_content).expect("Failed to parse config");

    // Check existing server is still there
    assert!(config["mcpServers"]["existing_server"].is_object());
    assert_eq!(
        config["mcpServers"]["existing_server"]["command"],
        "existing_command"
    );

    // Check new server was added
    assert!(config["mcpServers"]["new_server"].is_object());
    assert_eq!(config["mcpServers"]["new_server"]["command"], "new_command");

    // Clean up
    std::fs::remove_file(&config_path).expect("Failed to remove config file");
}

#[test]
fn test_add_server_config_missing_config_file() {
    let app = mock_app();
    let app_path = get_jan_data_folder_path(app.handle().clone());

    // Ensure the directory exists
    if let Some(parent) = app_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::create_dir_all(&app_path).ok();

    let config_path = app_path.join("mcp_config.json");

    // Ensure the file doesn't exist
    if config_path.exists() {
        std::fs::remove_file(&config_path).ok();
    }

    let server_value = serde_json::json!({
        "command": "test",
        "args": [],
        "active": false
    });

    let result = add_server_config(app.handle().clone(), "test".to_string(), server_value);

    assert!(
        result.is_err(),
        "Expected error when config file doesn't exist"
    );
    assert!(result.unwrap_err().contains("Failed to read config file"));
}

#[test]
fn test_ensure_mcp_config_exists_bootstraps_clean_install() {
    let app = mock_app();
    let data_root = tempfile::tempdir().expect("Failed to create temp data root");
    app.manage(crate::test_support::TestDataRoot(
        data_root.path().to_path_buf(),
    ));

    let config_path =
        ensure_mcp_config_exists(app.handle().clone()).expect("Failed to bootstrap MCP config");

    assert!(config_path.exists(), "Default MCP config was not created");

    // The startup migrations run straight after and must not fail with os error 2.
    let result = add_server_config(
        app.handle().clone(),
        "exa".to_string(),
        serde_json::json!({ "command": "npx", "args": [], "active": false }),
    );

    assert!(
        result.is_ok(),
        "Migration should succeed on a clean install: {result:?}"
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn test_bin_path_construction_with_join() {
    // Test that PathBuf::join properly constructs paths
    let bin_path = PathBuf::from("/usr/local/bin");
    let bun_path = bin_path.join("bun");

    assert_eq!(bun_path.to_string_lossy(), "/usr/local/bin/bun");

    // Test conversion to String via display()
    let bun_path_str = bun_path.display().to_string();
    assert_eq!(bun_path_str, "/usr/local/bin/bun");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn test_uv_path_construction_with_join() {
    // Test that PathBuf::join properly constructs paths for uv
    let bin_path = PathBuf::from("/usr/local/bin");
    let uv_path = bin_path.join("uv");

    assert_eq!(uv_path.to_string_lossy(), "/usr/local/bin/uv");

    // Test conversion to String via display()
    let uv_path_str = uv_path.display().to_string();
    assert_eq!(uv_path_str, "/usr/local/bin/uv");
}

#[cfg(target_os = "windows")]
#[test]
fn test_bin_path_construction_windows() {
    // Test Windows-style paths
    let bin_path = PathBuf::from(r"C:\Program Files\bin");
    let bun_path = bin_path.join("bun.exe");

    assert_eq!(bun_path.to_string_lossy(), r"C:\Program Files\bin\bun.exe");

    let bun_path_str = bun_path.display().to_string();
    assert_eq!(bun_path_str, r"C:\Program Files\bin\bun.exe");
}

// ============================================================================
// Shutdown Context Tests
// ============================================================================

use super::helpers::ShutdownContext;
use std::time::Duration;

#[test]
fn test_shutdown_context_app_exit_timeouts() {
    let context = ShutdownContext::AppExit;
    assert_eq!(context.per_server_timeout(), Duration::from_millis(500));
    assert_eq!(context.overall_timeout(), Duration::from_millis(1500));
}

#[test]
fn test_shutdown_context_manual_restart_timeouts() {
    let context = ShutdownContext::ManualRestart;
    assert_eq!(context.per_server_timeout(), Duration::from_secs(2));
    assert_eq!(context.overall_timeout(), Duration::from_secs(5));
}

#[test]
fn test_shutdown_context_factory_reset_timeouts() {
    let context = ShutdownContext::FactoryReset;
    assert_eq!(context.per_server_timeout(), Duration::from_secs(5));
    assert_eq!(context.overall_timeout(), Duration::from_secs(10));
}

#[test]
fn test_shutdown_context_overall_greater_than_per_server() {
    for context in [
        ShutdownContext::AppExit,
        ShutdownContext::ManualRestart,
        ShutdownContext::FactoryReset,
    ] {
        assert!(
            context.overall_timeout() > context.per_server_timeout(),
            "Overall timeout should be greater than per-server timeout for {:?}",
            context
        );
    }
}

#[test]
fn test_shutdown_context_is_copy() {
    let context = ShutdownContext::AppExit;
    let copied = context;
    assert!(matches!(context, ShutdownContext::AppExit));
    assert!(matches!(copied, ShutdownContext::AppExit));
}

#[tokio::test]
async fn test_background_cleanup_with_empty_state() {
    use super::helpers::background_cleanup_mcp_servers;

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();
    background_cleanup_mcp_servers(app.handle(), &state).await;

    let servers = state.mcp_servers.lock().await;
    assert!(servers.is_empty());

    let active = state.mcp_active_servers.lock().await;
    assert!(active.is_empty());
}

#[tokio::test]
async fn test_stop_mcp_servers_with_context_empty_servers() {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();
    let result =
        stop_mcp_servers_with_context(app.handle(), &state, ShutdownContext::AppExit).await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn test_stop_mcp_servers_prevents_concurrent_shutdown() {
    use super::helpers::{stop_mcp_servers_with_context, ShutdownContext};

    let app = mock_app();
    let servers_state: SharedMcpServers = Arc::new(Mutex::new(HashMap::new()));
    app.manage(AppState {
        mcp_servers: servers_state.clone(),
        ..Default::default()
    });

    let state = app.state::<AppState>();

    {
        let mut shutdown_flag = state.mcp_shutdown_in_progress.lock().await;
        *shutdown_flag = true;
    }

    let result =
        stop_mcp_servers_with_context(app.handle(), &state, ShutdownContext::AppExit).await;

    assert!(result.is_ok());

    {
        let shutdown_flag = state.mcp_shutdown_in_progress.lock().await;
        assert!(*shutdown_flag);
    }
}

// ============================================================================
// Extension Connection Error Detection Tests
// ============================================================================

#[test]
fn test_extension_disconnected_error_detection() {
    // Real error messages from GChat Browser MCP server when extension is not connected
    let disconnected_errors = [
        // Direct error messages from MCP server
        "Browser extension not connected to bridge",
        "Browser extension not responding to ping",
        "extension not connected",
        // Error with different casing (case insensitive)
        "BROWSER EXTENSION NOT CONNECTED TO BRIDGE",
        // Tool not found errors (older extension without ping tool)
        "tool ping not found",
        "Tool 'browser_snapshot' not found in available tools",
        // Wrapped error messages
        "Error: Browser extension not connected to bridge. Please retry.",
        "[MCP] extension not connected - check browser",
    ];

    for msg in disconnected_errors {
        assert!(
            is_extension_not_connected_error(msg),
            "Should detect as disconnected: {msg}"
        );
    }
}

#[test]
fn test_extension_connected_response_detection() {
    // Valid responses when extension IS connected - should NOT trigger error detection
    let connected_responses = [
        "pong",                   // Successful ping response
        "Success",                // Generic success
        "Connected successfully", // Connection confirmation
        "",                       // Empty response (not an error)
        "Screenshot captured",    // Successful browser_snapshot
        "Page loaded",            // Browser action success
        "browser",                // Single keyword (not an error pattern)
        "tool",                   // Single keyword (not an error pattern)
    ];

    for msg in connected_responses {
        assert!(
            !is_extension_not_connected_error(msg),
            "Should NOT detect as disconnected: {msg}"
        );
    }
}

/// The MCP shutdown sweep runs after the servers have already been stopped, so
/// most PIDs it revisits are gone. Windows' `taskkill` calls that an error, and
/// reporting it as one filed a crash per PID on every app exit (the noisiest
/// pair of issues in the desktop project).
#[test]
fn taskkill_saying_the_process_is_gone_is_not_a_failure() {
    assert!(is_process_already_gone(
        "ERROR: The process \"6188\" not found."
    ));
    assert!(is_process_already_gone(
        "ERROR: The process with PID 7060 could not be terminated.\r\n\
         Reason: There is no running instance of the task."
    ));
}

#[test]
fn a_real_taskkill_failure_is_still_reported() {
    assert!(!is_process_already_gone(
        "ERROR: The process with PID 4242 could not be terminated.\r\n\
         Reason: Access is denied."
    ));
    assert!(!is_process_already_gone(""));
}

#[test]
fn test_mcp_config_rejects_malformed_fields_without_echoing_credentials() {
    use serde_json::json;
    let valid = json!({"command":"fixture", "args":[], "env":{}, "active":false});
    for (field, invalid) in [
        ("command", json!(7)),
        ("command", json!("")),
        ("args", json!(["valid", 7])),
        ("args", json!("credential-never-log")),
        ("env", json!({"TOKEN":7})),
        ("env", json!({"BAD=NAME":"credential-never-log"})),
        ("env", json!({"TOKEN":"bad\u{0}value"})),
        ("headers", json!({"Authorization":7})),
        ("headers", json!({"bad header":"credential-never-log"})),
        (
            "headers",
            json!({"Authorization":"credential-never-log\r\nOther: injected"}),
        ),
        ("type", json!("credential-never-log")),
        ("type", json!(7)),
        ("url", json!(7)),
        ("cwd", json!(7)),
        ("timeout", json!(0)),
        ("timeout", json!(u64::MAX)),
        ("timeout", json!("credential-never-log")),
        ("active", json!("credential-never-log")),
    ] {
        let mut config = valid.clone();
        config[field] = invalid;
        let error = extract_command_args(&config).expect_err(field);
        assert!(!error.contains("credential-never-log"), "{field}: {error}");
    }
    for url in [
        "file:///tmp/mcp",
        "not-a-url",
        "https://user:credential-never-log@example.com/mcp",
        "https://example.com/mcp#fragment",
    ] {
        let error = extract_command_args(&json!({"type":"http", "url":url})).unwrap_err();
        assert!(!error.contains("credential-never-log"));
    }
    assert!(
        extract_command_args(&json!({"url":"https://example.com/mcp", "command":"fixture"}))
            .is_err()
    );
    for settings in [
        json!(null),
        json!({"toolCallTimeoutSeconds":0}),
        json!({"toolCallTimeoutSeconds":"credential-never-log"}),
        json!({"toolCallTimeoutSeconds":u64::MAX}),
    ] {
        let error =
            super::helpers::validate_mcp_config(&json!({"mcpSettings":settings})).unwrap_err();
        assert!(!error.contains("credential-never-log"));
    }
    assert!(super::helpers::validate_mcp_config(&json!({"mcpServers":[]})).is_err());
    super::helpers::validate_mcp_config(
        &serde_json::from_str::<serde_json::Value>(&super::constants::default_mcp_config())
            .unwrap(),
    )
    .unwrap();
}

#[test]
fn test_mcp_static_credentials_are_preserved_but_startup_diagnostics_are_redacted() {
    use serde_json::json;
    let config = json!({
        "type":"http", "url":"https://example.com/mcp?key=url-secret",
        "headers":{"Authorization":"Bearer header-secret"},
        "env":{"API_TOKEN":"env-secret"}, "timeout":5
    });
    let parsed = extract_command_args(&config).unwrap();
    assert_eq!(parsed.headers["Authorization"], "Bearer header-secret");
    assert_eq!(parsed.envs["API_TOKEN"], "env-secret");
    assert_eq!(parsed.timeout, Some(std::time::Duration::from_secs(5)));
    let mut captured = VecDeque::new();
    append_bounded_stderr(&mut captured, b"connection failed env-sec");
    append_bounded_stderr(&mut captured, b"ret header-secret url-secret");
    let text = String::from_utf8(captured.into_iter().collect()).unwrap();
    let diagnostic = super::helpers::redact_mcp_config_values(
        &format_mcp_start_error(
            "request https://example.com/mcp?key=url-secret failed",
            &text,
        ),
        &config,
    );
    assert!(diagnostic.contains("connection failed"));
    assert!(diagnostic.contains("stderr (context)"));
    for secret in ["env-secret", "header-secret", "url-secret"] {
        assert!(!diagnostic.contains(secret), "{diagnostic}");
    }
}

#[tokio::test]
async fn test_invalid_mcp_save_and_activation_preserve_saved_and_live_state() {
    use serde_json::json;
    let app = mock_app();
    let root = tempfile::tempdir().unwrap();
    app.manage(crate::test_support::TestDataRoot(root.path().to_path_buf()));
    app.manage(AppState::default());
    let path = get_jan_data_folder_path(app.handle().clone()).join("mcp_config.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let original = r#"{"mcpServers":{},"mcpSettings":{"toolCallTimeoutSeconds":30}}"#;
    std::fs::write(&path, original).unwrap();
    let invalid = json!({"mcpServers":{"bad":{"command":"fixture", "args":[7]}}});
    assert!(
        super::commands::save_mcp_configs(app.handle().clone(), invalid.to_string())
            .await
            .is_err()
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    let state = app.state::<AppState>();
    assert!(super::helpers::start_mcp_server(
        app.handle().clone(),
        state.mcp_servers.clone(),
        "bad".into(),
        invalid["mcpServers"]["bad"].clone()
    )
    .await
    .is_err());
    assert!(state.mcp_active_servers.lock().await.is_empty());
    assert!(state.mcp_servers.lock().await.is_empty());
    assert!(state.mcp_server_pids.lock().await.is_empty());
    std::fs::write(&path, "{invalid-json").unwrap();
    assert!(super::commands::get_mcp_configs(app.handle().clone())
        .await
        .is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{invalid-json");
}

/// Exercise the actual rmcp client and newline-delimited JSON-RPC transport in
/// process. Live stdio/HTTP server qualification is a separate native gate.
struct McpWireFixture {
    state: Arc<AppState>,
    incoming: tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>,
    server: tokio::task::JoinHandle<()>,
}

impl McpWireFixture {
    async fn connected(hang_method: Option<&'static str>) -> Self {
        use rmcp::ServiceExt;
        use serde_json::json;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let (client_io, server_io) = tokio::io::duplex(16 * 1024);
        let (sender, incoming) = tokio::sync::mpsc::unbounded_channel();
        let server = tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server_io);
            let mut lines = BufReader::new(read).lines();
            while let Some(line) = lines.next_line().await.unwrap() {
                let request: serde_json::Value = serde_json::from_str(&line).unwrap();
                let _ = sender.send(request.clone());
                let Some(id) = request.get("id") else {
                    continue;
                };
                let method = request["method"].as_str().unwrap();
                if hang_method == Some(method) {
                    continue;
                }
                if method == "tools/call" && request["params"]["arguments"]["fixtureError"] == true
                {
                    write.write_all(format!("{}\n", json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"failed env-secret header-secret url-secret"}})).as_bytes()).await.unwrap();
                    write.flush().await.unwrap();
                    continue;
                }
                let result = match method {
                    "initialize" => {
                        json!({"protocolVersion":request["params"]["protocolVersion"], "capabilities":{"tools":{}}, "serverInfo":{"name":"wire-fixture","version":"1"}})
                    }
                    "tools/list" => {
                        json!({"tools":[{"name":"echo","description":"Fixture echo","inputSchema":{"type":"object"}}]})
                    }
                    "tools/call" if request["params"]["arguments"]["fixtureToolError"] == true => {
                        json!({"content":[{"type":"text","text":"failed text env-secret header-secret url-secret", "_meta":{"diagnostic":"env-secret"}}], "structuredContent":{"diagnostic":"header-secret"}, "_meta":{"diagnostic":"url-secret"}, "isError":true})
                    }
                    "tools/call" => {
                        json!({"content":[{"type":"text","text":request["params"]["arguments"].to_string()}], "isError":false})
                    }
                    _ => panic!("Unexpected MCP fixture request: {method}"),
                };
                write
                    .write_all(
                        format!("{}\n", json!({"jsonrpc":"2.0","id":id,"result":result}))
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                write.flush().await.unwrap();
            }
        });
        let service = ().serve(client_io).await.unwrap();
        let state = Arc::new(AppState::default());
        state.mcp_servers.lock().await.insert(
            "fixture".into(),
            crate::core::state::RunningServiceEnum::NoInit(service),
        );
        Self {
            state,
            incoming,
            server,
        }
    }

    async fn receive(&mut self, method: &str) -> serde_json::Value {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let message = self
                    .incoming
                    .recv()
                    .await
                    .expect("MCP fixture disconnected");
                if message["method"] == method {
                    return message;
                }
            }
        })
        .await
        .expect("MCP fixture request deadline")
    }

    async fn stop(self) {
        let service = self
            .state
            .mcp_servers
            .lock()
            .await
            .remove("fixture")
            .unwrap();
        match service {
            crate::core::state::RunningServiceEnum::NoInit(service) => {
                service.cancel().await.unwrap();
            }
            crate::core::state::RunningServiceEnum::WithInit(_) => unreachable!(),
        }
        self.server.await.unwrap();
    }
}

#[tokio::test]
async fn test_mcp_restart_reconciles_saved_active_servers_before_starting() {
    use hyper::{
        service::{make_service_fn, service_fn},
        Body, Method, Request, Response, Server, StatusCode,
    };
    use serde_json::json;
    use std::{convert::Infallible, time::Duration};
    use tokio_util::sync::CancellationToken;

    let fixture = McpWireFixture::connected(None).await;
    let app = mock_app();
    let root = tempfile::tempdir().unwrap();
    app.manage(crate::test_support::TestDataRoot(root.path().to_path_buf()));
    app.manage(AppState {
        mcp_servers: fixture.state.mcp_servers.clone(),
        mcp_active_servers: fixture.state.mcp_active_servers.clone(),
        ..Default::default()
    });
    let state = app.state::<AppState>();
    let original = json!({"command":"fixture", "env":{"TOKEN":"old-secret"}});
    for name in ["fixture", "removed", "disabled", "GChat Browser MCP"] {
        state
            .mcp_active_servers
            .lock()
            .await
            .insert(name.into(), original.clone());
        state
            .mcp_server_errors
            .lock()
            .await
            .insert(name.into(), "old diagnostic".into());
    }
    let path = get_jan_data_folder_path(app.handle().clone()).join("mcp_config.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();

    // Even an externally edited invalid file must be checked before Stop.
    std::fs::write(
        &path,
        json!({"mcpServers":{"bad":{"command":7}}}).to_string(),
    )
    .unwrap();
    assert!(
        super::commands::restart_mcp_servers(app.handle().clone(), state.clone())
            .await
            .is_err()
    );
    assert_eq!(state.mcp_active_servers.lock().await.len(), 4);
    assert!(super::commands::call_tool_exact(
        &state,
        "fixture",
        "echo",
        json!({"text":"old connection retained"})
            .as_object()
            .unwrap()
            .clone(),
        &CancellationToken::new(),
    )
    .await
    .is_ok());

    // A real HTTP transport, with distinct credentials, proves both the edited
    // and newly saved server are initialized from disk rather than old state.
    let requests = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
    let captured = requests.clone();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let service = make_service_fn(move |_| {
        let captured = captured.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |request: Request<Body>| {
                let captured = captured.clone();
                async move {
                    if request.method() != Method::POST {
                        return Ok::<_, Infallible>(
                            Response::builder()
                                .status(StatusCode::METHOD_NOT_ALLOWED)
                                .body(Body::empty())
                                .unwrap(),
                        );
                    }
                    let authorization = request.headers()["authorization"]
                        .to_str()
                        .unwrap()
                        .to_owned();
                    let body = hyper::body::to_bytes(request.into_body()).await.unwrap();
                    let message: serde_json::Value = serde_json::from_slice(&body).unwrap();
                    let method = message["method"].as_str().unwrap().to_owned();
                    captured.lock().await.push((authorization, method.clone()));
                    if message.get("id").is_none() {
                        return Ok(Response::builder()
                            .status(StatusCode::ACCEPTED)
                            .body(Body::empty())
                            .unwrap());
                    }
                    let result = match method.as_str() {
                        "initialize" => json!({
                            "protocolVersion":message["params"]["protocolVersion"],
                            "capabilities":{"tools":{}},
                            "serverInfo":{"name":"saved-config-fixture","version":"1"}
                        }),
                        "tools/list" => {
                            json!({"tools":[{"name":"echo", "inputSchema":{"type":"object"}}]})
                        }
                        "tools/call" => {
                            json!({"content":[{"type":"text", "text":"saved server invoked"}], "isError":false})
                        }
                        _ => panic!("Unexpected fixture request: {method}"),
                    };
                    Ok(Response::builder()
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({"jsonrpc":"2.0", "id":message["id"], "result":result})
                                .to_string(),
                        ))
                        .unwrap())
                }
            }))
        }
    });
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(
        Server::from_tcp(listener)
            .unwrap()
            .serve(service)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            }),
    );
    let desired = json!({
        "mcpSettings":{"toolCallTimeoutSeconds":7},
        "mcpServers":{
            "fixture":{"type":"http", "url":url, "headers":{"Authorization":"Bearer edited-secret"}, "active":true, "timeout":2},
            // Omitted active follows the same enabled-by-default policy as startup.
            "added":{"type":"http", "url":url, "headers":{"Authorization":"Bearer added-secret"}, "timeout":2},
            "disabled":{"command":"must-not-run", "active":false},
            "GChat Browser MCP":{"command":"must-not-run-browser", "active":false}
        }
    });
    super::commands::save_mcp_configs(app.handle().clone(), desired.to_string())
        .await
        .unwrap();
    super::commands::restart_mcp_servers(app.handle().clone(), state.clone())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state.mcp_servers.lock().await.len() == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("saved HTTP servers must become connected");
    assert_eq!(state.mcp_active_servers.lock().await.len(), 2);
    assert_eq!(
        state.mcp_active_servers.lock().await.get("fixture"),
        Some(&desired["mcpServers"]["fixture"])
    );
    assert_eq!(
        state.mcp_active_servers.lock().await.get("added"),
        Some(&desired["mcpServers"]["added"])
    );
    assert!(state.mcp_server_errors.lock().await.is_empty());
    assert_eq!(state.mcp_settings.lock().await.tool_call_timeout_seconds, 7);
    for (name, credential) in [
        ("fixture", "Bearer edited-secret"),
        ("added", "Bearer added-secret"),
    ] {
        let result = super::commands::call_tool_exact(
            &state,
            name,
            "echo",
            Default::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            result.content[0].as_text().unwrap().text,
            "saved server invoked"
        );
        let requests = requests.lock().await;
        assert!(requests
            .iter()
            .any(|(auth, method)| auth == credential && method == "initialize"));
        assert!(requests
            .iter()
            .any(|(auth, method)| auth == credential && method == "tools/call"));
    }
    tokio::time::timeout(Duration::from_secs(3), fixture.server)
        .await
        .unwrap()
        .unwrap();
    super::helpers::stop_mcp_servers_with_context(
        app.handle(),
        &state,
        super::helpers::ShutdownContext::ManualRestart,
    )
    .await
    .unwrap();
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn test_failed_live_mcp_replacement_retires_old_credential_peer() {
    use serde_json::json;
    use tokio_util::sync::CancellationToken;
    let fixture = McpWireFixture::connected(None).await;
    let app = mock_app();
    let root = tempfile::tempdir().unwrap();
    app.manage(crate::test_support::TestDataRoot(root.path().to_path_buf()));
    app.manage(AppState {
        mcp_servers: fixture.state.mcp_servers.clone(),
        mcp_active_servers: fixture.state.mcp_active_servers.clone(),
        ..Default::default()
    });
    let original = json!({
        "command":"fixture",
        "env":{"TOKEN":"env-secret", "HEADER":"header-secret", "URL":"url-secret"}
    });
    fixture
        .state
        .mcp_active_servers
        .lock()
        .await
        .insert("fixture".into(), original.clone());
    let state = app.state::<AppState>();

    // Validation failure must not retire a working peer or change its secrets.
    assert!(super::helpers::start_mcp_server(
        app.handle().clone(),
        state.mcp_servers.clone(),
        "fixture".into(),
        json!({"command":"fixture", "args":[7]})
    )
    .await
    .is_err());
    assert_eq!(
        state.mcp_active_servers.lock().await.get("fixture"),
        Some(&original)
    );
    let arguments = json!({"fixtureError":true}).as_object().unwrap().clone();
    let error = super::commands::call_tool_exact(
        &state,
        "fixture",
        "echo",
        arguments.clone(),
        &CancellationToken::new(),
    )
    .await
    .unwrap_err();
    assert!(error.contains("failed"), "{error}");
    for secret in ["env-secret", "header-secret", "url-secret"] {
        assert!(!error.contains(secret), "{error}");
    }

    // A valid replacement whose executable does not exist must not leave the
    // old peer callable using this new configuration's unrelated redactor.
    let replacement = json!({
        "command":root.path().join("missing-mcp-executable"),
        "env":{"TOKEN":"replacement-secret"}
    });
    assert!(super::helpers::start_mcp_server(
        app.handle().clone(),
        state.mcp_servers.clone(),
        "fixture".into(),
        replacement.clone()
    )
    .await
    .is_err());
    assert_eq!(
        state.mcp_active_servers.lock().await.get("fixture"),
        Some(&replacement)
    );
    assert!(state.mcp_servers.lock().await.is_empty());
    assert!(state.mcp_server_pids.lock().await.is_empty());
    let exact = super::commands::call_tool_exact(
        &state,
        "fixture",
        "echo",
        arguments.clone(),
        &CancellationToken::new(),
    )
    .await
    .unwrap_err();
    let legacy = super::commands::call_tool_inner(
        &state,
        "echo".into(),
        Some("fixture".into()),
        Some(arguments),
        Some("replacement-call".into()),
    )
    .await
    .unwrap_err();
    for error in [exact, legacy] {
        assert!(error.contains("not connected"), "{error}");
        for secret in [
            "env-secret",
            "header-secret",
            "url-secret",
            "replacement-secret",
        ] {
            assert!(!error.contains(secret), "{error}");
        }
    }
    assert!(state.tool_call_cancellations.lock().await.is_empty());
    tokio::time::timeout(std::time::Duration::from_secs(3), fixture.server)
        .await
        .expect("replaced peer must disconnect")
        .unwrap();
}

#[tokio::test]
async fn test_mcp_exact_call_preserves_server_tool_and_arguments() {
    use serde_json::json;
    use tokio_util::sync::CancellationToken;
    let mut fixture = McpWireFixture::connected(None).await;
    let arguments = json!({"text":"retained payload", "number":7})
        .as_object()
        .unwrap()
        .clone();
    let result = super::commands::call_tool_exact(
        &fixture.state,
        "fixture",
        "echo",
        arguments.clone(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    let request = fixture.receive("tools/call").await;
    assert_eq!(request["params"]["name"], "echo");
    assert_eq!(request["params"]["arguments"], json!(arguments));
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["content"][0]["text"], json!(arguments).to_string());
    assert!(super::commands::call_tool_exact(
        &fixture.state,
        "missing",
        "echo",
        arguments,
        &CancellationToken::new()
    )
    .await
    .unwrap_err()
    .contains("not connected"));
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_call_errors_redact_configured_credentials() {
    use serde_json::json;
    let fixture = McpWireFixture::connected(None).await;
    fixture.state.mcp_active_servers.lock().await.insert(
        "fixture".into(),
        json!({
            "type":"http", "url":"https://example.com/mcp?key=url-secret",
            "headers":{"Authorization":"Bearer header-secret"}, "env":{"TOKEN":"env-secret"}
        }),
    );
    let arguments = json!({"fixtureError":true}).as_object().unwrap().clone();
    let exact = super::commands::call_tool_exact(
        &fixture.state,
        "fixture",
        "echo",
        arguments.clone(),
        &tokio_util::sync::CancellationToken::new(),
    )
    .await
    .unwrap_err();
    let legacy = super::commands::call_tool_inner(
        &fixture.state,
        "echo".into(),
        Some("fixture".into()),
        Some(arguments),
        Some("redacted".into()),
    )
    .await
    .unwrap_err();
    for error in [exact, legacy] {
        assert!(error.contains("failed"), "{error}");
        for secret in ["env-secret", "header-secret", "url-secret"] {
            assert!(!error.contains(secret), "{error}");
        }
    }
    assert!(fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_tool_error_payload_redacts_credentials_but_success_preserves_output() {
    use serde_json::json;
    use tokio_util::sync::CancellationToken;
    let fixture = McpWireFixture::connected(None).await;
    fixture.state.mcp_active_servers.lock().await.insert(
        "fixture".into(),
        json!({
            "type":"http", "url":"https://example.com/mcp?key=url-secret",
            "headers":{"Authorization":"Bearer header-secret"},
            "env":{"TOKEN":"env-secret", "TAG_SECRET":"text"}
        }),
    );
    let arguments = json!({"fixtureToolError":true})
        .as_object()
        .unwrap()
        .clone();
    let exact = super::commands::call_tool_exact(
        &fixture.state,
        "fixture",
        "echo",
        arguments.clone(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    let legacy = super::commands::call_tool_inner(
        &fixture.state,
        "echo".into(),
        Some("fixture".into()),
        Some(arguments),
        Some("tool-error-redacted".into()),
    )
    .await
    .unwrap();
    for result in [exact, legacy] {
        let result = serde_json::to_value(result).unwrap();
        assert_eq!(result["isError"], true);
        assert_eq!(result["content"][0]["type"], "text");
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("failed"));
        assert!(!result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("text"));
        for secret in ["env-secret", "header-secret", "url-secret"] {
            assert!(!result.to_string().contains(secret), "{result}");
        }
    }
    let successful_arguments = json!({"text":"env-secret header-secret url-secret"})
        .as_object()
        .unwrap()
        .clone();
    let success = super::commands::call_tool_exact(
        &fixture.state,
        "fixture",
        "echo",
        successful_arguments.clone(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    let success = serde_json::to_value(success).unwrap();
    assert_eq!(success["isError"], false);
    assert_eq!(
        success["content"][0]["text"],
        json!(successful_arguments).to_string()
    );
    assert!(fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .is_empty());
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_exact_stop_notifies_remote_request_and_releases_server_lock() {
    let mut fixture = McpWireFixture::connected(Some("tools/call")).await;
    let cancellation = tokio_util::sync::CancellationToken::new();
    let call = {
        let state = fixture.state.clone();
        let cancellation = cancellation.clone();
        tokio::spawn(async move {
            super::commands::call_tool_exact(
                &state,
                "fixture",
                "echo",
                Default::default(),
                &cancellation,
            )
            .await
        })
    };
    let request = fixture.receive("tools/call").await;
    drop(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            fixture.state.mcp_servers.lock(),
        )
        .await
        .expect("call retained global MCP lock"),
    );
    cancellation.cancel();
    assert!(call.await.unwrap().unwrap_err().contains("cancelled"));
    let notification = fixture.receive("notifications/cancelled").await;
    assert_eq!(notification["params"]["requestId"], request["id"]);
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_legacy_discovery_stop_notifies_and_cleans_token() {
    let mut fixture = McpWireFixture::connected(Some("tools/list")).await;
    let call = {
        let state = fixture.state.clone();
        tokio::spawn(async move {
            super::commands::call_tool_inner(
                &state,
                "echo".into(),
                Some("fixture".into()),
                None,
                Some("legacy-stop".into()),
            )
            .await
        })
    };
    let request = fixture.receive("tools/list").await;
    drop(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            fixture.state.mcp_servers.lock(),
        )
        .await
        .expect("discovery retained global MCP lock"),
    );
    fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .remove("legacy-stop")
        .unwrap()
        .send(())
        .unwrap();
    assert!(call.await.unwrap().unwrap_err().contains("cancelled"));
    assert!(fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .is_empty());
    let notification = fixture.receive("notifications/cancelled").await;
    assert_eq!(notification["params"]["requestId"], request["id"]);
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_legacy_discovery_timeout_notifies_and_cleans_token() {
    let mut fixture = McpWireFixture::connected(Some("tools/list")).await;
    fixture
        .state
        .mcp_settings
        .lock()
        .await
        .tool_call_timeout_seconds = 1;
    let call = {
        let state = fixture.state.clone();
        tokio::spawn(async move {
            super::commands::call_tool_inner(
                &state,
                "echo".into(),
                Some("fixture".into()),
                None,
                Some("legacy-timeout".into()),
            )
            .await
        })
    };
    let request = fixture.receive("tools/list").await;
    let error = tokio::time::timeout(std::time::Duration::from_secs(3), call)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(error.contains("timed out"), "{error}");
    assert!(fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .is_empty());
    let notification = fixture.receive("notifications/cancelled").await;
    assert_eq!(notification["params"]["requestId"], request["id"]);
    fixture.stop().await;
}

#[tokio::test]
async fn test_mcp_legacy_missing_server_tool_and_duplicate_token_cleanup() {
    let fixture = McpWireFixture::connected(None).await;
    for server in ["missing", "fixture"] {
        let error = super::commands::call_tool_inner(
            &fixture.state,
            "missing-tool".into(),
            Some(server.into()),
            None,
            Some("missing".into()),
        )
        .await
        .unwrap_err();
        assert!(
            error.contains("not connected") || error.contains("not found"),
            "{error}"
        );
        assert!(fixture
            .state
            .tool_call_cancellations
            .lock()
            .await
            .is_empty());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .insert("duplicate".into(), sender);
    assert!(super::commands::call_tool_inner(
        &fixture.state,
        "echo".into(),
        None,
        None,
        Some("duplicate".into())
    )
    .await
    .unwrap_err()
    .contains("already in use"));
    fixture
        .state
        .tool_call_cancellations
        .lock()
        .await
        .remove("duplicate")
        .unwrap()
        .send(())
        .unwrap();
    receiver.await.unwrap();
    fixture.stop().await;
}
