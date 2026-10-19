//! Per-bot MCP link. The MCP servers a user already added in GChat (`mcp_config.json`,
//! local command or URL) can be linked to a bot like an account. Linked servers' tools are
//! offered to the bot's brain and every call needs the same approval as other changing tools.
//! Servers run on the computer that runs the Gbot service, not inside the bot's computer.
use std::{collections::BTreeMap, path::PathBuf, process::Stdio, time::Duration};

use gbot_service::connectors::{ConnectorAccount, ConnectorTool, PreparedConnector};
use rmcp::{
    model::{
        CallToolRequestParam, ClientCapabilities, ClientInfo, Implementation,
        InitializeRequestParam,
    },
    service::RunningService,
    transport::TokioChildProcess,
    RoleClient, ServiceExt,
};
use serde_json::{Map, Value};
use tokio::{process::Command, sync::Mutex, time::timeout};

use crate::core::mcp::{
    constants::{DEFAULT_MCP_HANDSHAKE_TIMEOUT_SECS, DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS},
    helpers::{connect_remote_mcp, extract_command_args, redact_mcp_config_values},
};

pub const ACCOUNT_PREFIX: &str = "mcp:";
pub const TOOL_PREFIX: &str = "mcp__";

type Client = RunningService<RoleClient, InitializeRequestParam>;

struct Live {
    config: Value,
    client: Client,
    tools: Vec<rmcp::model::Tool>,
}

pub struct McpLinks {
    root: PathBuf,
    live: Mutex<BTreeMap<String, Live>>,
}

pub fn is_link(account_id: &str) -> bool {
    account_id.starts_with(ACCOUNT_PREFIX)
}

fn tool_name(server: &str, tool: &str) -> String {
    let clean = |text: &str| -> String {
        text.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect()
    };
    let mut name = format!("{TOOL_PREFIX}{}__{}", clean(server), clean(tool));
    name.truncate(64);
    name
}

impl McpLinks {
    pub fn new(root: PathBuf) -> Self {
        Self { root, live: Mutex::new(BTreeMap::new()) }
    }

    /// Servers from GChat's own MCP settings that have a valid configuration.
    fn configured(&self) -> BTreeMap<String, Value> {
        let Ok(text) = std::fs::read_to_string(self.root.join("mcp_config.json")) else {
            return BTreeMap::new();
        };
        let Ok(config) = serde_json::from_str::<Value>(&text).or_else(|_| json5::from_str(&text))
        else {
            return BTreeMap::new();
        };
        config
            .get("mcpServers")
            .and_then(Value::as_object)
            .map(|servers| {
                servers
                    .iter()
                    .filter(|(_, value)| extract_command_args(value).is_ok())
                    .map(|(name, value)| (name.clone(), value.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn accounts(&self) -> Vec<ConnectorAccount> {
        self.configured()
            .into_iter()
            .map(|(name, config)| ConnectorAccount {
                id: format!("{ACCOUNT_PREFIX}{name}"),
                provider: "mcp".into(),
                display_name: name,
                email: None,
                services: vec![
                    if config.get("url").is_some() { "remote tool server" } else { "local tool server" }
                        .into(),
                ],
                access: "read_write".into(),
                granted_scopes: Vec::new(),
                needs_reconnect: false,
            })
            .collect()
    }

    async fn connect(config: &Value) -> Result<Client, String> {
        let params = extract_command_args(config)?;
        let handshake = params
            .timeout
            .unwrap_or_else(|| Duration::from_secs(DEFAULT_MCP_HANDSHAKE_TIMEOUT_SECS));
        let remote = matches!(params.transport_type.as_deref(), Some("http" | "sse"));
        let result = if remote {
            let first = params.transport_type.as_deref().unwrap_or("http");
            let second = if first == "http" { "sse" } else { "http" };
            match connect_remote_mcp(&params, first).await {
                Ok(client) => Ok(client),
                Err(_) => connect_remote_mcp(&params, second).await,
            }
        } else {
            let mut command = Command::new(&params.command);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            #[cfg(unix)]
            command.process_group(0);
            command.kill_on_drop(true);
            if let Some(cwd) = &params.cwd {
                command.current_dir(cwd);
            }
            for arg in params.args.iter().filter_map(Value::as_str) {
                command.arg(arg);
            }
            for (key, value) in params.envs.iter().filter_map(|(k, v)| Some((k, v.as_str()?))) {
                command.env(key, value);
            }
            let (process, _stderr) = TokioChildProcess::builder(command)
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("Could not start the tool server: {error}"))?;
            let info = ClientInfo {
                protocol_version: Default::default(),
                capabilities: ClientCapabilities::default(),
                client_info: Implementation {
                    name: "GChat MCP Client".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    title: Some("GChat".to_string()),
                    website_url: None,
                    icons: None,
                },
            };
            match timeout(handshake, info.serve(process)).await {
                Ok(Ok(client)) => Ok(client),
                Ok(Err(error)) => Err(format!("The tool server did not start: {error}")),
                Err(_) => Err("The tool server did not answer in time".to_string()),
            }
        };
        result.map_err(|error| redact_mcp_config_values(&error, config))
    }

    /// Connects (or reuses the connection) and returns the server's tools.
    async fn tools_of(&self, name: &str, config: &Value) -> Result<Vec<rmcp::model::Tool>, String> {
        let mut live = self.live.lock().await;
        if live.get(name).is_some_and(|entry| &entry.config != config || entry.client.peer().is_transport_closed()) {
            if let Some(old) = live.remove(name) {
                let _ = old.client.cancel().await;
            }
        }
        if !live.contains_key(name) {
            let client = Self::connect(config).await?;
            let tools = timeout(
                Duration::from_secs(DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS),
                client.peer().list_all_tools(),
            )
            .await
            .map_err(|_| "The tool server did not list its tools in time".to_string())?
            .map_err(|error| redact_mcp_config_values(&error.to_string(), config))?;
            live.insert(name.to_owned(), Live { config: config.clone(), client, tools });
        }
        Ok(live[name].tools.clone())
    }

    fn linked_servers(&self, linked: &[String]) -> Vec<(String, Value)> {
        let configured = self.configured();
        linked
            .iter()
            .filter_map(|id| id.strip_prefix(ACCOUNT_PREFIX))
            .filter_map(|name| configured.get(name).map(|config| (name.to_owned(), config.clone())))
            .collect()
    }

    /// A server that cannot start is left out so the bot's other tools still work.
    pub async fn catalog(&self, linked: &[String]) -> Vec<ConnectorTool> {
        let mut catalog = Vec::new();
        for (server, config) in self.linked_servers(linked) {
            match self.tools_of(&server, &config).await {
                Ok(tools) => {
                    for tool in tools {
                        catalog.push(ConnectorTool {
                            name: tool_name(&server, &tool.name),
                            description: format!(
                                "[Tool server {server}] {} Runs on the computer that runs the Gbot service, not on the bot's computer. Needs approval.",
                                tool.description.as_deref().unwrap_or("")
                            ),
                            input_schema: Value::Object((*tool.input_schema).clone()),
                            write: true,
                        });
                    }
                }
                Err(error) => log::warn!("Gbot MCP link {server} unavailable: {error}"),
            }
        }
        catalog
    }

    pub async fn prepare(
        &self,
        linked: &[String],
        name: &str,
        mut arguments: Value,
    ) -> Result<PreparedConnector, String> {
        let object = arguments.as_object_mut().ok_or("Tool arguments must be an object")?;
        for (server, config) in self.linked_servers(linked) {
            let Ok(tools) = self.tools_of(&server, &config).await else { continue };
            if tools.iter().any(|tool| tool_name(&server, &tool.name) == name) {
                let account_id = format!("{ACCOUNT_PREFIX}{server}");
                object.insert("account_id".into(), Value::String(account_id.clone()));
                return Ok(PreparedConnector {
                    name: name.into(),
                    account_id,
                    arguments,
                    write: true,
                });
            }
        }
        Err("This tool server is not linked to this bot".into())
    }

    pub async fn execute(&self, request: &PreparedConnector) -> Result<Value, String> {
        let server = request
            .account_id
            .strip_prefix(ACCOUNT_PREFIX)
            .ok_or("Not a tool server link")?;
        let live = self.live.lock().await;
        let entry = live.get(server).ok_or("The tool server is not connected; try the task again")?;
        let tool = entry
            .tools
            .iter()
            .find(|tool| tool_name(server, &tool.name) == request.name)
            .ok_or("The tool server no longer offers this tool")?
            .name
            .to_string();
        let mut arguments: Map<String, Value> = request.arguments.as_object().cloned().unwrap_or_default();
        arguments.remove("account_id");
        let config = entry.config.clone();
        let seconds = config
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_MCP_TOOL_CALL_TIMEOUT_SECS)
            .max(1);
        let peer = entry.client.peer().clone();
        drop(live);
        let outcome = timeout(
            Duration::from_secs(seconds),
            peer.call_tool(CallToolRequestParam { name: tool.into(), arguments: Some(arguments) }),
        )
        .await;
        match outcome {
            Ok(Ok(result)) => {
                let text = serde_json::to_string(&result).map_err(|_| "Unreadable tool result")?;
                serde_json::from_str(&redact_mcp_config_values(&text, &config))
                    .map_err(|_| "Unreadable tool result".into())
            }
            other => {
                // A broken connection is rebuilt by the next call.
                if let Some(old) = self.live.lock().await.remove(server) {
                    let _ = old.client.cancel().await;
                }
                Err(match other {
                    Ok(Err(error)) => redact_mcp_config_values(&error.to_string(), &config),
                    _ => format!("The tool server did not answer within {seconds} seconds"),
                })
            }
        }
    }

    pub async fn close(&self) {
        for (_, entry) in std::mem::take(&mut *self.live.lock().await) {
            let _ = entry.client.cancel().await;
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;

    const SERVER: &str = r#"
import json, os, sys
for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg:
        continue
    m = msg["method"]
    if m == "initialize":
        r = {"protocolVersion": msg["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}}
    elif m == "tools/list":
        r = {"tools": [
            {"name": "echo.text", "description": "Echo the text", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}},
            {"name": "leak", "description": "Returns a secret", "inputSchema": {"type": "object"}}]}
    elif m == "tools/call":
        p = msg["params"]
        if p["name"] == "leak":
            text = "value " + os.environ["FIXTURE_SECRET"]
        else:
            text = "echo:" + json.dumps(p["arguments"], sort_keys=True)
        r = {"content": [{"type": "text", "text": text}], "isError": False}
    else:
        r = {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": r}), flush=True)
"#;

    fn setup(dir: &std::path::Path) -> McpLinks {
        std::fs::write(dir.join("fixture_server.py"), SERVER).unwrap();
        let config = json!({"mcpServers": {
            "fixture": {"command": "python3", "args": [dir.join("fixture_server.py")], "env": {"FIXTURE_SECRET": "s3cret-token"}},
            "broken": {"command": "/nonexistent/server"},
            "other": {"command": "python3", "args": [dir.join("fixture_server.py")], "env": {"FIXTURE_SECRET": "x"}},
            "invalid": {"command": 7}
        }});
        std::fs::write(dir.join("mcp_config.json"), config.to_string()).unwrap();
        McpLinks::new(dir.to_path_buf())
    }

    #[tokio::test]
    async fn a_linked_tool_server_offers_its_tools_and_runs_them_after_preparation() {
        let dir = tempfile::tempdir().unwrap();
        let links = setup(dir.path());
        let accounts = links.accounts();
        assert_eq!(
            accounts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["mcp:broken", "mcp:fixture", "mcp:other"]
        );
        assert!(accounts.iter().all(|a| a.provider == "mcp" && a.access == "read_write"));

        // Only the linked server is offered; a server that cannot start is left out quietly.
        let linked = vec!["mcp:fixture".to_owned(), "mcp:broken".to_owned()];
        let catalog = links.catalog(&linked).await;
        let names: Vec<_> = catalog.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["mcp__fixture__echo_text", "mcp__fixture__leak"]);
        assert!(catalog.iter().all(|t| t.write && t.description.contains("Needs approval")));
        assert_eq!(catalog[0].input_schema["properties"]["text"]["type"], "string");

        let prepared = links
            .prepare(&linked, "mcp__fixture__echo_text", json!({"text": "hi"}))
            .await
            .unwrap();
        assert!(prepared.write && prepared.account_id == "mcp:fixture");
        assert_eq!(prepared.arguments["account_id"], "mcp:fixture");
        let result = links.execute(&prepared).await.unwrap();
        // The server sees only the tool's own arguments, never the account link.
        assert_eq!(result["content"][0]["text"], r#"echo:{"text": "hi"}"#);

        // A secret from the server's own settings never reaches the brain.
        let leak = links.prepare(&linked, "mcp__fixture__leak", json!({})).await.unwrap();
        let leaked = links.execute(&leak).await.unwrap().to_string();
        assert!(!leaked.contains("s3cret-token"), "{leaked}");

        // Unlinked servers are not offered or runnable.
        assert!(links.prepare(&linked, "mcp__other__leak", json!({})).await.is_err());
        assert!(links.prepare(&[], "mcp__fixture__leak", json!({})).await.is_err());
        links.close().await;
    }

    #[tokio::test]
    async fn changed_tool_server_settings_reconnect_and_missing_settings_offer_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let links = McpLinks::new(dir.path().to_path_buf());
        assert!(links.accounts().is_empty());
        assert!(links.catalog(&["mcp:fixture".into()]).await.is_empty());
        let links = setup(dir.path());
        let linked = vec!["mcp:other".to_owned()];
        assert_eq!(links.catalog(&linked).await.len(), 2);
        // Editing the server in GChat's settings applies on the next catalog.
        let config = json!({"mcpServers": {"other": {"command": "/nonexistent/server"}}});
        std::fs::write(dir.path().join("mcp_config.json"), config.to_string()).unwrap();
        assert!(links.catalog(&linked).await.is_empty());
        links.close().await;
    }
}
