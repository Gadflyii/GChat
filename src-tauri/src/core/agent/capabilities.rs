//! Shared Chat/Agent capability identity and desktop IPC boundary.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime};
use tauri_plugin_ginfer::state::GinferState;
use tokio::sync::{oneshot, Notify};
use tokio_util::sync::CancellationToken;

use super::approval::ApprovalGate;
use super::commands::{self, AgentDesktopServices};
use super::definitions;
use super::folder_access::FolderAccessGate;
use super::ginfer_client::{
    find_session_by_model_id, tool_parameters, wire_tool_name, GinferClient,
};
use super::path_policy::EditableRoots;
use super::prompt::ITERATION_ONE_TOOLS;
use super::resource_class::connector_tool;
use super::skills::{self, loaded::LoadedSkills};
use super::tools::{self, tool_view::LoadedTools, ToolContext};
use super::types::{
    AgentAttachment, AgentEvent, AgentExternalRoot, AgentTurnRequest, ToolCallPayload,
    ToolExecution, ToolStatus,
};
use crate::core::app::commands::get_jan_data_folder_path;
use crate::core::mcp::{
    commands as mcp,
    models::{McpServerStatus, McpToolsResponse},
};
use crate::core::state::AppState;

pub const NATIVE_SERVER: &str = "gchat-native";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityTool {
    pub name: String,
    pub identity: String,
    pub description: String,
    pub input_schema: Value,
    pub server: String,
    pub origin: &'static str,
}

#[derive(Clone, Debug)]
pub enum CapabilityTarget {
    Native(String),
    Mcp { server: String, tool: String },
}

#[derive(Clone, Debug, Default)]
pub struct CapabilityCatalog {
    pub tools: Vec<CapabilityTool>,
    targets: BTreeMap<String, CapabilityTarget>,
    pub servers: Vec<McpServerStatus>,
}

impl CapabilityCatalog {
    pub fn target(&self, name: &str) -> Option<&CapabilityTarget> {
        self.targets.get(name)
    }

    fn insert(&mut self, tool: CapabilityTool, target: CapabilityTarget) -> Result<(), String> {
        if self.targets.insert(tool.name.clone(), target).is_some() {
            return Err(format!(
                "Capability wire-name collision for `{}`",
                tool.name
            ));
        }
        self.tools.push(tool);
        Ok(())
    }

    pub fn disabled(&self, disabled: &BTreeSet<String>, name: &str) -> bool {
        self.tools
            .iter()
            .find(|tool| tool.name == name)
            .is_some_and(|tool| disabled.contains(&format!("{}::{}", tool.server, tool.name)))
    }

    pub fn visible(&self, disabled: &BTreeSet<String>) -> Vec<CapabilityTool> {
        self.tools
            .iter()
            .filter(|tool| !self.disabled(disabled, &tool.name))
            .cloned()
            .collect()
    }

    pub fn search(&self, query: &str, disabled: &BTreeSet<String>) -> Vec<CapabilityTool> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        self.tools
            .iter()
            .filter(|tool| {
                (tool.origin == "mcp" || connector_tool(&tool.identity).is_some())
                    && !self.disabled(disabled, &tool.name)
            })
            .filter(|tool| {
                format!("{}\n{}", tool.name, tool.description)
                    .to_lowercase()
                    .contains(&needle)
            })
            .cloned()
            .collect()
    }

    pub fn available_mcp_tool(
        &self,
        name: &str,
        disabled: &BTreeSet<String>,
    ) -> Option<&CapabilityTool> {
        self.tools.iter().find(|tool| {
            tool.origin == "mcp" && tool.name == name && !self.disabled(disabled, name)
        })
    }

    pub fn available_connected_tool(
        &self,
        name: &str,
        disabled: &BTreeSet<String>,
    ) -> Option<&CapabilityTool> {
        self.tools.iter().find(|tool| {
            tool.name == name
                && (tool.origin == "mcp" || connector_tool(&tool.identity).is_some())
                && !self.disabled(disabled, name)
        })
    }

    pub fn available_agent_tool_names(&self, disabled: &BTreeSet<String>) -> BTreeSet<String> {
        let mut names: BTreeSet<String> = self
            .tools
            .iter()
            .filter(|tool| !self.disabled(disabled, &tool.name))
            .filter_map(
                |tool| match self.target(&tool.name).expect("catalog target") {
                    CapabilityTarget::Native(name)
                        if ITERATION_ONE_TOOLS.iter().any(|entry| entry.name == name)
                            || connector_tool(name).is_some() =>
                    {
                        Some(name.clone())
                    }
                    CapabilityTarget::Native(_) => None,
                    CapabilityTarget::Mcp { .. } => Some(tool.name.clone()),
                },
            )
            .collect();
        names.extend(["reply".to_owned(), "finish".to_owned()]);
        names
    }

    pub fn agent_mcp_functions(&self, disabled: &BTreeSet<String>) -> Vec<Value> {
        let mut functions: Vec<Value> = [
            ("capability_search", "Search enabled connected tools by name or purpose.", json!({"type":"object","properties":{"query":{"type":"string","minLength":1}},"required":["query"],"additionalProperties":false})),
            ("capability_read", "Read the exact argument schema for an enabled connected tool.", json!({"type":"object","properties":{"name":{"type":"string","minLength":1}},"required":["name"],"additionalProperties":false})),
            ("mcp_call", "Call an enabled connected MCP tool by exact name and schema-conforming arguments.", json!({"type":"object","properties":{"name":{"type":"string","minLength":1},"arguments":{"type":"object"}},"required":["name","arguments"],"additionalProperties":false})),
        ].into_iter().map(|(name, description, parameters)| json!({"type":"function","function":{"name":name,"description":description,"parameters":parameters,"strict":false}})).collect();
        if self.tools.iter().any(|tool| {
            connector_tool(&tool.identity).is_some() && !self.disabled(disabled, &tool.name)
        }) {
            functions.push(json!({"type":"function","function":{
                "name":"connector_call",
                "description":"Call an enabled Workspace connector by the exact name and arguments discovered with capability_search and capability_read. Uses the selected or explicitly named account and the caller's permissions.",
                "parameters":{"type":"object","properties":{"name":{"type":"string","minLength":1},"arguments":{"type":"object"}},"required":["name","arguments"],"additionalProperties":false},
                "strict":false
            }}));
        }
        functions
    }

    fn insert_connectors(
        &mut self,
        descriptors: Vec<crate::core::connectors::ConnectedTool>,
    ) -> Result<(), String> {
        for descriptor in descriptors {
            let provider = crate::core::connectors::provider_for(descriptor.name)?;
            self.insert(
                CapabilityTool {
                    name: wire_tool_name(descriptor.name),
                    identity: descriptor.name.into(),
                    description: descriptor.description,
                    input_schema: descriptor.input_schema,
                    server: provider.as_str().into(),
                    origin: "native",
                },
                CapabilityTarget::Native(descriptor.name.into()),
            )?;
        }
        self.tools.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(())
    }
}

const CONTROL_TOOLS: &[(&str, &str, &str)] = &[
    (
        "skill.list",
        "List enabled available GChat skills.",
        r#"{"type":"object","additionalProperties":false}"#,
    ),
    (
        "skill.invoke",
        "Apply an enabled GChat skill to a task using the existing Agent runtime.",
        r#"{"type":"object","properties":{"name":{"type":"string"},"task":{"type":"string"}},"required":["name","task"],"additionalProperties":false}"#,
    ),
    (
        "agent.list",
        "List saved GChat agents and worker-pool assignments.",
        r#"{"type":"object","additionalProperties":false}"#,
    ),
    (
        "agent.run",
        "Run a saved GChat agent or worker team and wait for its result.",
        r#"{"type":"object","properties":{"definitionId":{"type":"string"},"task":{"type":"string"}},"required":["definitionId","task"],"additionalProperties":false}"#,
    ),
    (
        "agent.spawn",
        "Start an independent General Agent worker for a task and return its runId immediately. Inherits this conversation's model placement, tools, permissions and folders. Include all context the worker needs in task. Use agent.wait or agent.monitor to collect the result; agent.cancel stops it. Optional assignment uses an exact instance or pool from agent.list.",
        r#"{"type":"object","properties":{"task":{"type":"string"},"assignment":{"type":"object","properties":{"target":{"oneOf":[{"type":"object","properties":{"kind":{"const":"current"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"const":"fleet"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"enum":["instance","pool"]},"id":{"type":"string"}},"required":["kind","id"],"additionalProperties":false}]},"vision":{"type":"boolean"},"minimumContext":{"type":"integer","minimum":0}},"additionalProperties":false}},"required":["task"],"additionalProperties":false}"#,
    ),
    (
        "agent.wait",
        "Wait for a delegated worker in this conversation and collect its terminal result and durable record. Cancelling the wait does not cancel the worker; use agent.cancel to stop it.",
        r#"{"type":"object","properties":{"runId":{"type":"string"}},"required":["runId"],"additionalProperties":false}"#,
    ),
    (
        "agent.monitor",
        "Inspect a delegated run in this conversation.",
        r#"{"type":"object","properties":{"runId":{"type":"string"}},"required":["runId"],"additionalProperties":false}"#,
    ),
    (
        "agent.cancel",
        "Cancel a delegated run in this conversation.",
        r#"{"type":"object","properties":{"runId":{"type":"string"}},"required":["runId"],"additionalProperties":false}"#,
    ),
];

pub fn mcp_wire_name(server: &str, tool: &str) -> String {
    let digest =
        Sha256::digest(format!("{}:{}:{server}:{tool}", server.len(), tool.len()).as_bytes());
    // OpenAI function names permit at most 64 ASCII letters, digits, `_` and
    // `-`. Keep a readable hint while the hash and catalog map own identity.
    let prefix = tool
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .take(27)
        .collect::<String>();
    let prefix = prefix.trim_matches('_');
    let prefix = if prefix.is_empty() { "tool" } else { prefix };
    format!("mcp_{prefix}_{}", hex::encode(&digest[..16]))
}

pub fn catalog_from_mcp(response: McpToolsResponse) -> Result<CapabilityCatalog, String> {
    let mut catalog = CapabilityCatalog {
        servers: response.servers,
        ..Default::default()
    };
    for descriptor in ITERATION_ONE_TOOLS {
        if matches!(descriptor.name, "reply" | "finish") {
            continue;
        }
        let wire = wire_tool_name(descriptor.name);
        catalog.insert(
            CapabilityTool {
                name: wire,
                identity: descriptor.name.into(),
                description: format!(
                    "{} Arguments: {}",
                    descriptor.summary, descriptor.args_schema
                ),
                input_schema: tool_parameters(descriptor.name, false),
                server: NATIVE_SERVER.into(),
                origin: "native",
            },
            CapabilityTarget::Native(descriptor.name.into()),
        )?;
    }
    for (identity, description, schema) in CONTROL_TOOLS {
        catalog.insert(
            CapabilityTool {
                name: wire_tool_name(identity),
                identity: (*identity).into(),
                description: (*description).into(),
                input_schema: serde_json::from_str(schema).expect("static control schema"),
                server: NATIVE_SERVER.into(),
                origin: "native",
            },
            CapabilityTarget::Native((*identity).into()),
        )?;
    }
    for tool in response.tools {
        let wire = mcp_wire_name(&tool.server, &tool.name);
        catalog.insert(
            CapabilityTool {
                name: wire,
                identity: format!(
                    "mcp:{}:{}:{}:{}",
                    tool.server.len(),
                    tool.server,
                    tool.name.len(),
                    tool.name
                ),
                description: format!(
                    "MCP server `{}` tool `{}`: {}",
                    tool.server,
                    tool.name,
                    tool.description
                        .unwrap_or_else(|| "No description provided".into())
                ),
                input_schema: tool.input_schema,
                server: tool.server.clone(),
                origin: "mcp",
            },
            CapabilityTarget::Mcp {
                server: tool.server,
                tool: tool.name,
            },
        )?;
    }
    catalog.tools.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(catalog)
}

pub async fn load_catalog<R: Runtime>(app: AppHandle<R>) -> Result<CapabilityCatalog, String> {
    let response = mcp::get_tools(app.clone(), app.state()).await?;
    let mut catalog = catalog_from_mcp(response)?;
    catalog.insert_connectors(crate::core::connectors::catalog(&app)?)?;
    Ok(catalog)
}

#[derive(Serialize)]
pub struct CapabilityList {
    tools: Vec<CapabilityTool>,
    skills: Vec<skills::SkillListEntry>,
    servers: Vec<McpServerStatus>,
}

#[tauri::command]
pub async fn capability_list<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<CapabilityList, String> {
    let catalog = load_catalog(app_handle.clone()).await?;
    let data = get_jan_data_folder_path(app_handle);
    let registry = skills::load_registry_with_tools(
        &data,
        &catalog.available_agent_tool_names(&BTreeSet::new()),
    )?;
    Ok(CapabilityList {
        tools: catalog.tools,
        skills: registry.list_all(),
        servers: catalog.servers,
    })
}

#[derive(Debug, Deserialize)]
pub struct CapabilityExecuteRequest {
    pub run_id: String,
    pub session_id: String,
    #[serde(default)]
    pub parent_run_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    pub tool_name: String,
    pub arguments: Value,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub external_roots: Vec<AgentExternalRoot>,
    #[serde(default)]
    pub auto_approve: bool,
    #[serde(default)]
    pub selected_skill: Option<String>,
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<AgentAttachment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedRunSummary {
    pub run_id: String,
    pub status: String,
    pub reason: String,
    pub result: Option<String>,
    pub step_count: u32,
}

#[derive(Debug, Serialize)]
pub struct CapabilityExecuteResult {
    pub content: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<DelegatedRunSummary>,
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn delegated_session_id(thread: &str, identity: &str) -> String {
    let digest = Sha256::digest(
        format!("{}:{}:{thread}:{identity}", thread.len(), identity.len()).as_bytes(),
    );
    format!("chat-delegate-{}", hex::encode(&digest[..16]))
}

struct Delegation {
    owner: String,
    state: Mutex<(bool, Option<String>)>,
    finished: Notify,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Delegation {
    fn new(owner: String) -> Self {
        Self {
            owner,
            state: Mutex::new((true, None)),
            finished: Notify::new(),
            task: Mutex::new(None),
        }
    }

    fn finish(&self, error: Option<String>) {
        if let Ok(mut state) = self.state.lock() {
            *state = (false, error);
        }
        self.finished.notify_waiters();
    }
}

fn active_delegations() -> &'static Mutex<BTreeMap<String, Arc<Delegation>>> {
    static ACTIVE: OnceLock<Mutex<BTreeMap<String, Arc<Delegation>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[tauri::command]
pub async fn capability_execute<R: Runtime>(
    app_handle: AppHandle<R>,
    request: CapabilityExecuteRequest,
    on_event: Channel<AgentEvent>,
) -> Result<CapabilityExecuteResult, String> {
    execute_with_sink(
        app_handle,
        request,
        Arc::new(move |event| on_event.send(event).map_err(|error| error.to_string())),
    )
    .await
}

pub async fn execute_with_sink<R: Runtime>(
    app: AppHandle<R>,
    request: CapabilityExecuteRequest,
    emit: Arc<dyn Fn(AgentEvent) -> Result<(), String> + Send + Sync>,
) -> Result<CapabilityExecuteResult, String> {
    super::session::validate_session_id(&request.session_id)?;
    if request.run_id.trim().is_empty() {
        return Err("run_id is required".into());
    }
    if !request.arguments.is_object() {
        return Err("Capability arguments must be an object".into());
    }
    let catalog = load_catalog(app.clone()).await?;
    let target = catalog
        .target(&request.tool_name)
        .cloned()
        .ok_or_else(|| format!("Unknown capability `{}`", request.tool_name))?;
    let disabled = request
        .disabled_tools
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if catalog.disabled(&disabled, &request.tool_name) {
        return Err(format!(
            "Capability `{}` is disabled for this conversation",
            request.tool_name
        ));
    }
    let identity = match &target {
        CapabilityTarget::Native(name) => name.clone(),
        CapabilityTarget::Mcp { .. } => request.tool_name.clone(),
    };
    let mcp_content = matches!(target, CapabilityTarget::Mcp { .. });
    match identity.as_str() {
        "agent.spawn" => return spawn_worker(app, request, emit).await,
        "skill.invoke" | "agent.run" => return run_delegated(app, request, &identity, emit).await,
        "skill.list" | "agent.list" | "agent.wait" | "agent.monitor" | "agent.cancel" => {
            emit(AgentEvent::TurnStarted {
                run_id: request.run_id.clone(),
                session_id: request.session_id.clone(),
            })?;
            let call = ToolCallPayload {
                tool: identity.clone(),
                args: request.arguments.clone(),
            };
            emit(AgentEvent::ToolCallParsed {
                call: call.clone(),
                batch_index: 0,
                batch_size: 1,
            })?;
            let result = execute_control(app, request, &identity).await;
            let outcome = match &result {
                Ok(value) => super::types::ToolOutcome {
                    status: ToolStatus::Ok,
                    summary: "Capability completed".into(),
                    details: Some(value.content.clone()),
                },
                Err(error) => super::types::ToolOutcome::error(error.clone()),
            };
            emit(AgentEvent::ToolCallExecuted {
                result: ToolExecution {
                    call,
                    outcome,
                    batch_index: 0,
                    batch_size: 1,
                },
            })?;
            emit(AgentEvent::TurnFinished {
                reason: if result.is_ok() { "reply" } else { "failed" }.into(),
                step_count: 1,
            })?;
            return result;
        }
        _ => {}
    }
    let state = app.state::<AppState>();
    let data = get_jan_data_folder_path(app.clone());
    state
        .agent_approval_allowlist
        .lock()
        .await
        .load_for_data_folder(&data)?;
    let working_dir = commands::resolve_working_dir(request.working_dir.as_deref(), &data).await?;
    let (editable, trusted) = commands::resolve_external_roots(&request.external_roots).await?;
    let editable_roots = EditableRoots::new(&working_dir, &editable).await?;
    let registry =
        skills::load_registry_with_tools(&data, &catalog.available_agent_tool_names(&disabled))?;
    let loaded_tools = LoadedTools::default();
    let loaded_skills = LoadedSkills::default();
    let client = if identity == "vision.describe" {
        if let Some(model_id) = request.model_id.as_deref() {
            let target = find_session_by_model_id(model_id, &app.state::<GinferState>())
                .await
                .map_err(|error| error.to_string())?;
            Some(GinferClient::new(&target).map_err(|error| error.to_string())?)
        } else {
            None
        }
    } else {
        None
    };
    let cancellation = CancellationToken::new();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut cancellations = state.tool_call_cancellations.lock().await;
        if cancellations.contains_key(&request.run_id) {
            return Err(format!(
                "Capability run `{}` is already active",
                request.run_id
            ));
        }
        cancellations.insert(request.run_id.clone(), cancel_tx);
    }
    let cancel_bridge = cancellation.clone();
    tokio::spawn(async move {
        if cancel_rx.await.is_ok() {
            cancel_bridge.cancel();
        }
    });
    let force_confirmation =
        identity == "studio.manage" && request.arguments["action"] == "save_definition";
    let approval = ApprovalGate::new(
        request.run_id.clone(),
        request.auto_approve && !force_confirmation,
        state.agent_pending_approvals.clone(),
        state.agent_approval_allowlist.clone(),
        emit.clone(),
        cancellation.clone(),
    );
    let approval = super::permissions::DisabledApproval {
        disabled: &disabled,
        catalog: &catalog,
        inner: &approval,
    };
    let folder = FolderAccessGate::new(
        request.run_id.clone(),
        state.agent_pending_folder_access.clone(),
        emit.clone(),
        cancellation.clone(),
    );
    let desktop = AgentDesktopServices {
        app_handle: app.clone(),
        memory_workspace: working_dir.clone(),
        memory_source: format!("chat:{}", request.session_id),
        disabled_tools: disabled.clone(),
    };
    let bundled_runtime = commands::resolve_bundled_script_runtime(&app);
    let context = ToolContext {
        working_dir: &working_dir,
        editable_roots: &editable_roots,
        trusted_read_roots: &trusted,
        client: client.as_ref(),
        reasoning_effort: None,
        inference: None,
        approval: &approval,
        folder_access: &folder,
        cancellation: &cancellation,
        loaded_tools: &loaded_tools,
        loaded_skills: &loaded_skills,
        skill_registry: &registry,
        bundled_script_runtime: bundled_runtime.as_deref(),
        desktop: &desktop,
    };
    let call = ToolCallPayload {
        tool: identity,
        args: request.arguments,
    };
    let result = async {
        emit(AgentEvent::TurnStarted {
            run_id: request.run_id.clone(),
            session_id: request.session_id.clone(),
        })?;
        emit(AgentEvent::ToolCallParsed {
            call: call.clone(),
            batch_index: 0,
            batch_size: 1,
        })?;
        let outcome = tools::execute(&call, &context).await;
        emit(AgentEvent::ToolCallExecuted {
            result: ToolExecution {
                call,
                outcome: outcome.clone(),
                batch_index: 0,
                batch_size: 1,
            },
        })?;
        emit(AgentEvent::TurnFinished {
            reason: if cancellation.is_cancelled() {
                "cancelled"
            } else if outcome.status == ToolStatus::Ok {
                "reply"
            } else {
                "failed"
            }
            .into(),
            step_count: 1,
        })?;
        Ok(CapabilityExecuteResult {
            content: match outcome.details {
                Some(details) if mcp_content => details,
                Some(details) => json!({ "summary": outcome.summary, "details": details }),
                None => Value::String(outcome.summary.clone()),
            },
            error: (outcome.status != ToolStatus::Ok).then_some(outcome.summary),
            run: None,
        })
    }
    .await;
    state
        .tool_call_cancellations
        .lock()
        .await
        .remove(&request.run_id);
    commands::clear_pending_approvals_for_run(&state, &request.run_id).await;
    commands::clear_pending_folder_access_for_run(&state, &request.run_id).await;
    result
}

async fn execute_control<R: Runtime>(
    app: AppHandle<R>,
    request: CapabilityExecuteRequest,
    identity: &str,
) -> Result<CapabilityExecuteResult, String> {
    let data = get_jan_data_folder_path(app.clone());
    let value = match identity {
        "skill.list" => {
            let catalog = load_catalog(app.clone()).await?;
            let disabled = request.disabled_tools.iter().cloned().collect();
            json!(skills::load_registry_with_tools(
                &data,
                &catalog.available_agent_tool_names(&disabled)
            )?
            .list_all()
            .into_iter()
            .filter(|skill| skill.enabled
                && skill.compatible
                && skill.unavailable_reasons.is_empty())
            .collect::<Vec<_>>())
        }
        "agent.list" => {
            let pools = super::worker_pools::catalog(&app, &data).await?;
            let usable = pools
                .pools
                .iter()
                .filter(|pool| {
                    pools
                        .available_pool_ids
                        .as_ref()
                        .map_or(true, |ids| ids.contains(&pool.id))
                })
                .collect::<Vec<_>>();
            json!({"definitions": definitions::list_definitions(&data)?, "pools": usable,
                "fleet":pools.fleet,"assignment":pools.assignment})
        }
        "agent.wait" | "agent.monitor" | "agent.cancel" => {
            let run_id = required(&request.arguments, "runId")?;
            let active_entry = active_delegations()
                .lock()
                .map_err(|error| error.to_string())?
                .get(run_id)
                .cloned();
            let owned = active_entry
                .as_ref()
                .is_some_and(|entry| entry.owner == request.session_id)
                || super::runs::list_runs(&data)?.iter().any(|run| {
                    run.run_id == run_id
                        && run.origin_session_id.as_deref() == Some(&request.session_id)
                });
            if !owned {
                return Err("Delegated run does not belong to this conversation".into());
            }
            if identity == "agent.wait" {
                if let Some(entry) = &active_entry {
                    wait_delegation(&app, &request.run_id, entry).await?;
                }
            }
            let (active, error) = active_entry
                .as_ref()
                .map(|entry| {
                    entry
                        .state
                        .lock()
                        .map(|state| state.clone())
                        .map_err(|error| error.to_string())
                })
                .transpose()?
                .unwrap_or((false, None));
            if identity == "agent.cancel" {
                if active {
                    commands::agent_cancel_turn(app.state(), run_id.into()).await?;
                }
                json!({"cancelled":active,"runId":run_id})
            } else {
                let record = super::runs::list_runs(&data)?
                    .into_iter()
                    .find(|run| run.run_id == run_id);
                let events = if active {
                    super::studio::operation(app.clone(), "monitor", json!({})).await?["active"]
                        [run_id]
                        .clone()
                } else {
                    Value::Null
                };
                json!({"runId":run_id,"active":active,"events":events,"record":record,"error":error})
            }
        }
        _ => return Err("Unknown control capability".into()),
    };
    Ok(CapabilityExecuteResult {
        content: value,
        error: None,
        run: None,
    })
}

async fn wait_delegation<R: Runtime>(
    app: &AppHandle<R>,
    wait_id: &str,
    entry: &Delegation,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    state
        .tool_call_cancellations
        .lock()
        .await
        .insert(wait_id.into(), cancel_tx);
    let result = async {
        loop {
            let notified = entry.finished.notified();
            tokio::pin!(notified);
            // Register before checking state so completion cannot race this wait.
            notified.as_mut().enable();
            if !entry.state.lock().map_err(|error| error.to_string())?.0 {
                return Ok(());
            }
            tokio::select! {
                _ = &mut notified => {},
                _ = &mut cancel_rx => return Err("Worker wait cancelled".into()),
            }
        }
    }
    .await;
    state.tool_call_cancellations.lock().await.remove(wait_id);
    result
}

async fn spawn_worker<R: Runtime>(
    app: AppHandle<R>,
    request: CapabilityExecuteRequest,
    emit: Arc<dyn Fn(AgentEvent) -> Result<(), String> + Send + Sync>,
) -> Result<CapabilityExecuteResult, String> {
    let task = required(&request.arguments, "task")?.to_owned();
    let parent_run_id = request
        .parent_run_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .ok_or("A parent Chat turn is required to dispatch a worker")?;
    let data = get_jan_data_folder_path(app.clone());
    let mut definition = definitions::general_agent();
    if let Some(assignment) = request.arguments.get("assignment") {
        let assignment: super::worker_pools::RoleAssignment =
            serde_json::from_value(assignment.clone())
                .map_err(|error| format!("Invalid worker assignment: {error}"))?;
        definition
            .role_assignments
            .insert("agent".into(), assignment);
    }
    definitions::validate_role_assignments(&definition, &definition.role_assignments)?;
    let model_id =
        crate::core::code_bridge::select_model(&app, &definition, &data, request.model_id.clone())
            .await
            .map_err(|error| format!("No ready GInfer instance for worker task: {error}"))?;
    let session_id = format!("chat-worker-{}", uuid::Uuid::new_v4());
    let agent_request = AgentTurnRequest {
        run_id: request.run_id.clone(),
        session_id: session_id.clone(),
        origin_session_id: Some(request.session_id.clone()),
        parent_run_id: Some(parent_run_id.clone()),
        model_id,
        user_message: task,
        definition_id: Some("general".into()),
        role_assignments: definition.role_assignments,
        selected_skill: request.selected_skill,
        attachments: request.attachments,
        working_dir: request.working_dir,
        external_roots: request.external_roots,
        max_steps: None,
        auto_approve: request.auto_approve,
        disabled_tools: request.disabled_tools,
    };
    let entry = Arc::new(Delegation::new(request.session_id.clone()));
    {
        let mut runs = active_delegations()
            .lock()
            .map_err(|error| error.to_string())?;
        if runs.contains_key(&request.run_id)
            || super::runs::list_runs(&data)?
                .iter()
                .any(|run| run.run_id == request.run_id)
        {
            return Err(format!("Delegated run `{}` already exists", request.run_id));
        }
        runs.insert(request.run_id.clone(), entry.clone());
    }
    let (ready_tx, ready_rx) = oneshot::channel();
    let ready_cell = Arc::new(Mutex::new(Some(ready_tx)));
    let task_entry = entry.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let terminal = Arc::new(Mutex::new(false));
        let terminal_sink = terminal.clone();
        let event_emit = emit.clone();
        let sink = Arc::new(move |event: AgentEvent| {
            if matches!(event, AgentEvent::TurnFinished { .. }) {
                if let Ok(mut finished) = terminal_sink.lock() {
                    *finished = true;
                }
            }
            // A worker remains owned by the runtime when its Chat view closes.
            let _ = event_emit(event);
            Ok(())
        });
        let ready = ready_cell.clone();
        let registered = Arc::new(move || {
            if let Ok(mut sender) = ready.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(());
                }
            }
        });
        let result =
            commands::run_turn_with_sink_ready(app, agent_request, sink, Some(registered)).await;
        if let Err(error) = &result {
            if !terminal.lock().map(|finished| *finished).unwrap_or(false) {
                let _ = emit(AgentEvent::StepError {
                    message: error.clone(),
                    category: "delegation".into(),
                });
                let _ = emit(AgentEvent::TurnFinished {
                    reason: "failed".into(),
                    step_count: 0,
                });
            }
        }
        task_entry.finish(result.err());
    });
    *entry.task.lock().map_err(|error| error.to_string())? = Some(handle);
    if ready_rx.await.is_err() {
        let error = entry
            .state
            .lock()
            .map_err(|error| error.to_string())?
            .1
            .clone()
            .unwrap_or_else(|| "Worker could not register with the shared runtime".into());
        active_delegations()
            .lock()
            .map_err(|error| error.to_string())?
            .remove(&request.run_id);
        return Err(error);
    }
    Ok(CapabilityExecuteResult {
        content: json!({"runId":request.run_id,"sessionId":session_id,"originSessionId":request.session_id,
            "parentRunId":parent_run_id,"status":"running"}),
        error: None,
        run: None,
    })
}

/// Normal application exit cancels and joins Chat workers before model shutdown.
pub async fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let entries = active_delegations()
        .lock()
        .map(|runs| {
            runs.iter()
                .map(|(id, entry)| (id.clone(), entry.clone()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut handles = Vec::new();
    for (run_id, entry) in entries {
        let handle = entry.task.lock().ok().and_then(|mut task| task.take());
        if let Some(handle) = handle {
            let _ = commands::agent_cancel_turn(app.state(), run_id).await;
            handles.push(handle);
        }
    }
    let joined = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        for handle in &mut handles {
            let _ = handle.await;
        }
    })
    .await;
    if joined.is_err() {
        for handle in handles {
            handle.abort();
        }
        log::warn!("Chat worker shutdown exceeded the shared runtime exit grace period");
    }
}

async fn run_delegated<R: Runtime>(
    app: AppHandle<R>,
    request: CapabilityExecuteRequest,
    identity: &str,
    emit: Arc<dyn Fn(AgentEvent) -> Result<(), String> + Send + Sync>,
) -> Result<CapabilityExecuteResult, String> {
    let data = get_jan_data_folder_path(app.clone());
    let (definition_id, selected_skill, task) = if identity == "skill.invoke" {
        let name = required(&request.arguments, "name")?;
        let catalog = load_catalog(app.clone()).await?;
        let disabled = request.disabled_tools.iter().cloned().collect();
        if skills::load_registry_with_tools(&data, &catalog.available_agent_tool_names(&disabled))?
            .get_enabled(name)
            .is_none()
        {
            return Err(format!("Skill `{name}` is not enabled or available"));
        }
        (
            "general".to_owned(),
            Some(name.to_owned()),
            required(&request.arguments, "task")?.to_owned(),
        )
    } else {
        let definition_id = required(&request.arguments, "definitionId")?.to_owned();
        definitions::get_definition(&data, &definition_id)?;
        (
            definition_id,
            None,
            required(&request.arguments, "task")?.to_owned(),
        )
    };
    let definition = definitions::get_definition(&data, &definition_id)?;
    let model_id =
        crate::core::code_bridge::select_model(&app, &definition, &data, request.model_id.clone())
            .await
            .map_err(|error| format!("No ready GInfer instance for delegated task: {error}"))?;
    find_session_by_model_id(&model_id, &app.state::<GinferState>()).await
        .map_err(|_| format!("Model `{model_id}` is not a ready GInfer instance; load a local model before delegating this task"))?;
    let run_session = delegated_session_id(
        &request.session_id,
        &format!(
            "{definition_id}:{}",
            selected_skill.as_deref().unwrap_or("")
        ),
    );
    let agent_request = AgentTurnRequest {
        run_id: request.run_id.clone(),
        session_id: run_session,
        origin_session_id: Some(request.session_id.clone()),
        parent_run_id: request.parent_run_id,
        model_id,
        user_message: task,
        definition_id: Some(definition_id),
        role_assignments: Default::default(),
        selected_skill,
        attachments: request.attachments,
        working_dir: request.working_dir,
        external_roots: request.external_roots,
        max_steps: None,
        auto_approve: request.auto_approve,
        disabled_tools: request.disabled_tools,
    };
    {
        let mut runs = active_delegations()
            .lock()
            .map_err(|error| error.to_string())?;
        if runs.contains_key(&request.run_id) {
            return Err(format!("Delegated run `{}` already exists", request.run_id));
        }
        runs.insert(
            request.run_id.clone(),
            Arc::new(Delegation::new(request.session_id)),
        );
    }
    let summary = Arc::new(Mutex::new((None::<String>, None::<String>, 0u32)));
    let captured = summary.clone();
    let original = emit.clone();
    let sink = Arc::new(move |event: AgentEvent| {
        if let Ok(mut state) = captured.lock() {
            match &event {
                AgentEvent::AssistantReply { text } => state.0 = Some(text.clone()),
                AgentEvent::TurnFinished { reason, step_count } => {
                    state.1 = Some(reason.clone());
                    state.2 = *step_count;
                }
                _ => {}
            }
        }
        original(event)
    });
    let result = commands::run_turn_with_sink(app, agent_request, sink).await;
    if let Some(entry) = active_delegations()
        .lock()
        .map_err(|error| error.to_string())?
        .get_mut(&request.run_id)
    {
        entry.finish(result.as_ref().err().cloned());
    }
    let (reply, reason, step_count) = summary.lock().map_err(|error| error.to_string())?.clone();
    let error = result.err();
    if let Some(message) = error.as_ref().filter(|_| reason.is_none()) {
        emit(AgentEvent::StepError {
            message: message.clone(),
            category: "delegation".into(),
        })?;
        emit(AgentEvent::TurnFinished {
            reason: "failed".into(),
            step_count,
        })?;
    }
    let reason = reason.unwrap_or_else(|| {
        if error.is_some() {
            "failed".into()
        } else {
            "reply".into()
        }
    });
    let status = super::runner::turn_status(&reason);
    let run = DelegatedRunSummary {
        run_id: request.run_id,
        status: status.into(),
        reason,
        result: reply,
        step_count,
    };
    Ok(CapabilityExecuteResult {
        content: json!(&run),
        error,
        run: Some(run),
    })
}

/// Called by both Chat and native Agent tools. Wire names are resolved against
/// the current exact server/tool catalog; disconnected or replaced tools fail.
pub async fn execute_mcp_wire<R: Runtime>(
    app: AppHandle<R>,
    wire: &str,
    args: Value,
    cancellation: &CancellationToken,
) -> Result<Value, String> {
    let catalog = load_catalog(app.clone()).await?;
    let Some(CapabilityTarget::Mcp { server, tool }) = catalog.target(wire) else {
        return Err(format!("MCP capability `{wire}` is unavailable"));
    };
    let arguments = args
        .as_object()
        .cloned()
        .ok_or("MCP arguments must be an object")?;
    let result = mcp::call_tool_exact(
        &app.state::<AppState>(),
        server,
        tool,
        arguments,
        cancellation,
    )
    .await?;
    let value = serde_json::to_value(result).map_err(|error| error.to_string())?;
    if value["isError"] == true {
        return Err(format!(
            "MCP tool `{tool}` on `{server}` returned an error: {}",
            value["content"]
        ));
    }
    let rendered = value.to_string();
    if rendered.chars().count() > tools::MAX_TOOL_OUTPUT_CHARS {
        return Ok(
            json!({"truncated":true,"excerpt":tools::truncate(rendered, tools::MAX_TOOL_OUTPUT_CHARS)}),
        );
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::permissions::{
        Capability, DefinitionApproval, DisabledApproval, Permission,
    };
    use crate::core::agent::test_support::RecordingApproval;
    use crate::core::agent::tools::ApprovalHook;
    use crate::core::mcp::models::ToolWithServer;

    #[test]
    fn workspace_connectors_share_exact_catalog_and_compact_discovery() {
        let mut catalog = catalog_from_mcp(McpToolsResponse {
            servers: vec![],
            tools: vec![],
        })
        .unwrap();
        let names = [
            "google.gmail.search",
            "google.gmail.send",
            "microsoft.outlook.read",
        ];
        let descriptors = crate::core::connectors::tools()
            .iter()
            .filter(|tool| names.contains(&tool.name))
            .cloned()
            .map(crate::core::connectors::ConnectedTool::from)
            .collect();
        catalog.insert_connectors(descriptors).unwrap();
        let disabled = BTreeSet::from(["google::google_gmail_send".into()]);
        let read = catalog
            .available_connected_tool("google_gmail_search", &disabled)
            .unwrap();
        assert_eq!(read.identity, "google.gmail.search");
        assert_eq!(read.server, "google");
        assert_eq!(
            read.input_schema["properties"]["account_id"]["type"],
            "string"
        );
        assert!(
            matches!(catalog.target(&read.name), Some(CapabilityTarget::Native(name)) if name == "google.gmail.search")
        );
        assert!(catalog
            .available_connected_tool("google_gmail_send", &disabled)
            .is_none());
        assert!(catalog
            .search("gmail", &disabled)
            .iter()
            .all(|tool| tool.identity != "google.gmail.send"));
        let available = catalog.available_agent_tool_names(&disabled);
        assert!(available.contains("google.gmail.search"));
        assert!(available.contains("microsoft.outlook.read"));
        assert!(!available.contains("google.gmail.send"));
        let functions = catalog.agent_mcp_functions(&disabled);
        assert_eq!(functions.len(), 4);
        assert_eq!(functions[3]["function"]["name"], "connector_call");
        assert!(functions.iter().all(|function| !names
            .iter()
            .any(|name| function["function"]["name"] == wire_tool_name(name))));
        let all_disabled = BTreeSet::from([
            "google::google_gmail_search".into(),
            "google::google_gmail_send".into(),
            "microsoft::microsoft_outlook_read".into(),
        ]);
        assert_eq!(catalog.agent_mcp_functions(&all_disabled).len(), 3);
        let approval = RecordingApproval::allow();
        let scoped = DisabledApproval {
            disabled: &disabled,
            catalog: &catalog,
            inner: &approval,
        };
        assert_eq!(scoped.permission("google.gmail.send"), Permission::Deny);
    }

    #[test]
    fn exact_mcp_identity_is_unique_and_disabled_by_server() {
        let catalog = catalog_from_mcp(McpToolsResponse {
            servers: vec![],
            tools: vec![
                ToolWithServer {
                    name: "read".into(),
                    description: None,
                    input_schema: json!({"type":"object"}),
                    server: "one".into(),
                },
                ToolWithServer {
                    name: "read".into(),
                    description: None,
                    input_schema: json!({"type":"object"}),
                    server: "two".into(),
                },
            ],
        })
        .unwrap();
        let one = mcp_wire_name("one", "read");
        let two = mcp_wire_name("two", "read");
        assert_ne!(one, two);
        assert!(one.starts_with("mcp_read_"));
        for name in [
            one.clone(),
            two.clone(),
            mcp_wire_name("one", "⚡/."),
            mcp_wire_name("one", "A very-long external tool name with punctuation!"),
        ] {
            assert!(name.len() <= 64, "{name}");
            assert!(
                name.bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'),
                "{name}"
            );
            assert_eq!(name.rsplit('_').next().unwrap().len(), 32);
        }
        assert!(mcp_wire_name("one", "⚡/.").starts_with("mcp_tool_"));
        assert_ne!(
            mcp_wire_name("one", "read-name"),
            mcp_wire_name("one", "read_name")
        );
        assert!(
            matches!(catalog.target(&one), Some(CapabilityTarget::Mcp { server, tool }) if server == "one" && tool == "read")
        );
        let disabled = BTreeSet::from([format!("one::{one}")]);
        assert!(catalog.disabled(&disabled, &one));
        assert!(!catalog.disabled(&disabled, &two));
        let advertised = catalog.agent_mcp_functions(&disabled);
        assert_eq!(advertised.len(), 3);
        assert_eq!(
            advertised
                .iter()
                .map(|tool| tool["function"]["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["capability_search", "capability_read", "mcp_call"]
        );
        assert!(catalog
            .search("read", &disabled)
            .iter()
            .all(|tool| tool.name != one));
        assert!(catalog
            .search("read", &disabled)
            .iter()
            .any(|tool| tool.name == two));
        assert!(catalog.available_mcp_tool(&one, &disabled).is_none());
        assert!(catalog.available_mcp_tool(&two, &disabled).is_some());
        let approval = RecordingApproval::allow();
        let permissions = [(Capability::Network, Permission::Deny)]
            .into_iter()
            .collect();
        let definition = DefinitionApproval {
            permissions: &permissions,
            inner: &approval,
        };
        let scoped = DisabledApproval {
            disabled: &disabled,
            catalog: &catalog,
            inner: &definition,
        };
        assert_eq!(scoped.permission(&one), Permission::Deny);
        assert_eq!(scoped.permission(&two), Permission::Deny);
        assert_eq!(scoped.permission("os.fs.read"), Permission::Default);
    }

    #[tokio::test]
    async fn ipc_catalog_and_native_read_share_policy_and_terminal_events() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("note.txt"), "visible result").unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        app.manage(crate::test_support::TestDataRoot(root.path().join("data")));
        let catalog = capability_list(app.handle().clone()).await.unwrap();
        let read = catalog
            .tools
            .iter()
            .find(|tool| tool.identity == "os.fs.read")
            .unwrap();
        assert_eq!(read.name, "os_fs_read");
        assert_eq!(read.server, NATIVE_SERVER);
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = events.clone();
        let request = CapabilityExecuteRequest {
            run_id: "test-capability-read".into(),
            session_id: "test-thread".into(),
            parent_run_id: None,
            model_id: None,
            tool_name: read.name.clone(),
            arguments: json!({"path":"note.txt"}),
            working_dir: Some(root.path().to_string_lossy().into()),
            external_roots: vec![],
            auto_approve:false,
            selected_skill: None,
            disabled_tools: vec![],
            attachments: vec![],
        };
        let result = execute_with_sink(
            app.handle().clone(),
            request,
            Arc::new(move |event| {
                sink_events.lock().unwrap().push(event);
                Ok(())
            }),
        )
        .await
        .unwrap();
        assert!(result.content.to_string().contains("visible result"));
        {
            let events = events.lock().unwrap();
            assert!(matches!(
                events.first(),
                Some(AgentEvent::TurnStarted { .. })
            ));
            assert!(
                matches!(events.last(), Some(AgentEvent::TurnFinished { reason, .. }) if reason == "reply")
            );
        }
        let disabled = CapabilityExecuteRequest {
            run_id: "test-capability-denied".into(),
            session_id: "test-thread".into(),
            parent_run_id: None,
            model_id: None,
            tool_name: "os_fs_read".into(),
            arguments: json!({"path":"note.txt"}),
            working_dir: Some(root.path().to_string_lossy().into()),
            external_roots: vec![],
            auto_approve:false,
            selected_skill: None,
            disabled_tools: vec!["gchat-native::os_fs_read".into()],
            attachments: vec![],
        };
        assert!(
            execute_with_sink(app.handle().clone(), disabled, Arc::new(|_| Ok(())))
                .await
                .unwrap_err()
                .contains("disabled")
        );
    }

    #[tokio::test]
    async fn chat_excel_read_preserves_extracted_cells_after_external_folder_approval() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        let desktop = root.path().join("Desktop");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&desktop).unwrap();
        let workbook = desktop.join("Quarterly budget.xlsx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&workbook).unwrap());
        for (name, xml) in [
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42000</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Expenses</t></is></c><c r="B2"><v>12000</v></c></row></sheetData></worksheet>"#,
            ),
        ] {
            zip.start_file(name, zip::write::FileOptions::default())
                .unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        app.manage(crate::test_support::TestDataRoot(root.path().join("data")));
        let pending = app.state::<AppState>().agent_pending_folder_access.clone();
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = events.clone();
        let request = CapabilityExecuteRequest {
            run_id: "chat-excel-read".into(),
            session_id: "ordinary-chat".into(),
            parent_run_id: None,
            model_id: None,
            tool_name: "os_fs_read_document".into(),
            arguments: json!({"path":workbook}),
            working_dir: Some(workspace.to_string_lossy().into()),
            external_roots: vec![],
            auto_approve: false,
            selected_skill: None,
            disabled_tools: vec![],
            attachments: vec![],
        };
        let result = execute_with_sink(
            app.handle().clone(),
            request,
            Arc::new(move |event| {
                if let AgentEvent::FolderAccessRequested { access_id, .. } = &event {
                    let access_id = access_id.clone();
                    let pending = pending.clone();
                    tokio::spawn(async move {
                        pending
                            .lock()
                            .await
                            .remove(&access_id)
                            .unwrap()
                            .sender
                            .send(true)
                            .unwrap();
                    });
                }
                sink_events.lock().unwrap().push(event);
                Ok(())
            }),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{:?}", result.error);
        let text = result.content["summary"]
            .as_str()
            .expect("Chat must receive parsed content, not only metadata");
        for cell in ["Budget", "Revenue", "42000", "Expenses", "12000"] {
            assert!(text.contains(cell), "Missing {cell}: {text}");
        }
        assert_eq!(result.content["details"]["truncated"], false);
        {
            let events = events.lock().unwrap();
            assert!(events.iter().any(|event| matches!(event, AgentEvent::FolderAccessRequested {tool, .. } if tool == "os.fs.read_document")));
            assert!(
                matches!(events.last(), Some(AgentEvent::TurnFinished { reason, .. }) if reason == "reply")
            );
        }
        assert!(app
            .state::<AppState>()
            .agent_pending_folder_access
            .lock()
            .await
            .is_empty());
        assert!(app
            .state::<AppState>()
            .tool_call_cancellations
            .lock()
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn missing_vision_model_does_not_register_a_cancellation() {
        let root = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        app.manage(GinferState::default());
        app.manage(crate::test_support::TestDataRoot(root.path().join("data")));
        let request = CapabilityExecuteRequest {
            run_id: "missing-vision-model".into(),
            session_id: "test-thread".into(),
            parent_run_id: None,
            model_id: Some("not-ready".into()),
            tool_name: "vision_describe".into(),
            arguments: json!({"path":"image.png"}),
            working_dir: Some(root.path().to_string_lossy().into()),
            external_roots: vec![],
            auto_approve: false,
            selected_skill: None,
            disabled_tools: vec![],
            attachments: vec![],
        };
        let error = execute_with_sink(app.handle().clone(), request, Arc::new(|_| Ok(())))
            .await
            .unwrap_err();
        assert!(error.contains("not-ready"), "{error}");
        assert!(app
            .state::<AppState>()
            .tool_call_cancellations
            .lock()
            .await
            .is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_general_workers_collect_cancel_and_reopen_with_parent_policy() {
        use super::super::ginfer_client::GinferConnection;
        use super::super::test_support::{ScriptedGinferServer, ScriptedResponse, TestFleet};
        use std::time::Duration;
        use tauri_plugin_ginfer::state::{GinferSession, SessionInfo, SessionOwner};
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let server = ScriptedGinferServer::start(vec![
            ScriptedResponse::tool_call(
                "os_fs_write",
                json!({"path":"disabled.txt","content":"forbidden"}),
            ),
            ScriptedResponse::tool_call("os_shell_run", json!({"cmd":"/bin/true"})),
            ScriptedResponse::tool_call("reply", json!({"text":"Second independent result"})),
        ])
        .await;
        let GinferConnection::Local { port, .. } = server.client().target().connection else {
            unreachable!()
        };
        let fleet = TestFleet::start().await;
        let owner = SessionOwner {
            control: Arc::new(
                ginfer_host::launcher::LocalControl::open(
                    &fleet.directory.path().join("host"),
                    &fleet.origin,
                )
                .unwrap(),
            ),
            connection: ginfer_host::launcher::LocalConnection {
                instance_id: uuid::Uuid::new_v4(),
                session_id: uuid::Uuid::new_v4(),
                model_id: "scripted-test-model".into(),
                port: port.try_into().unwrap(),
                api_key: String::new(),
            },
        };
        let model = ginfer_host::engine_registry::InstanceRef {
            host_id: owner.control.host_id(),
            instance_id: owner.connection.instance_id,
        }
        .model_alias();
        let info: SessionInfo = serde_json::from_value(json!({"pid":1,"port":port,"model_id":"scripted-test-model",
            "model_path":"test.ginfer","is_embedding":false,"vision":true,"api_key":"","max_concurrency":3,"max_context":32768})).unwrap();
        let state = GinferState::default();
        state.ginfer_process.lock().await.insert(
            1,
            GinferSession {
                owner,
                info,
                endpoint: None,
            },
        );
        let pool = super::super::worker_pools::WorkerPool {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Chat workers".into(),
            members: vec![super::super::worker_pools::PoolMember {
                instance_id: model.clone(),
                worker_limit: 2,
            }],
        };
        std::fs::write(
            data.join("agent-worker-pools.json"),
            serde_json::to_vec(&vec![pool.clone()]).unwrap(),
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(state)
            .manage(fleet.client.clone())
            .manage(AppState::default())
            .manage(crate::test_support::TestDataRoot(data.clone()))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let parent = format!("parent-{}", uuid::Uuid::new_v4());
        let request = |id: &str, tool: &str, arguments: Value| CapabilityExecuteRequest {
            run_id: id.into(),
            session_id: parent.clone(),
            parent_run_id: Some("user-turn-1".into()),
            model_id: Some(model.clone()),
            tool_name: tool.into(),
            arguments,
            working_dir: Some(root.path().to_string_lossy().into()),
            external_roots: vec![],
            auto_approve: false,
            selected_skill: None,
            disabled_tools: vec!["gchat-native::os_fs_write".into()],
            attachments: vec![],
        };
        let first = format!("worker-first-{}", uuid::Uuid::new_v4());
        let second = format!("worker-second-{}", uuid::Uuid::new_v4());
        let first_events = Arc::new(Mutex::new(Vec::new()));
        let captured = first_events.clone();
        let approval_arrived = Arc::new(Notify::new());
        let arrival = approval_arrived.clone();
        let first_result = execute_with_sink(
            app.handle().clone(),
            request(
                &first,
                "agent_spawn",
                json!({"task":"First independent task",
            "assignment":{"target":{"kind":"pool","id":pool.id}}}),
            ),
            Arc::new(move |event| {
                if matches!(event, AgentEvent::ApprovalRequested { .. }) {
                    arrival.notify_one();
                }
                captured.lock().unwrap().push(event);
                Ok(())
            }),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(3), approval_arrived.notified())
            .await
            .unwrap();
        let second_result = execute_with_sink(
            app.handle().clone(),
            request(
                &second,
                "agent_spawn",
                json!({"task":"Second independent task"}),
            ),
            Arc::new(|_| Ok(())),
        )
        .await
        .unwrap();
        assert_ne!(
            first_result.content["sessionId"],
            second_result.content["sessionId"]
        );
        assert_eq!(first_result.content["parentRunId"], "user-turn-1");
        let collect =
            |run: &str| request(&format!("wait-{run}"), "agent_wait", json!({"runId":run}));
        let second_done = tokio::time::timeout(
            Duration::from_secs(4),
            execute_with_sink(app.handle().clone(), collect(&second), Arc::new(|_| Ok(()))),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            second_done.content["record"]["finalReply"],
            "Second independent result"
        );
        let captured = first_events.lock().unwrap();
        assert!(captured.iter().any(|event| {
            let event = match event {
                AgentEvent::StageActivity { event, .. } => event.as_ref(),
                event => event,
            };
            matches!(event, AgentEvent::ToolCallExecuted { result }
                if result.call.tool == "os.fs.write" && result.outcome.status == ToolStatus::Denied)
        }), "Worker events: {captured:?}");
        drop(captured);
        assert!(!root.path().join("disabled.txt").exists());
        execute_with_sink(
            app.handle().clone(),
            request("cancel-control", "agent_cancel", json!({"runId":first})),
            Arc::new(|_| Ok(())),
        )
        .await
        .unwrap();
        let cancelled_done = tokio::time::timeout(
            Duration::from_secs(3),
            execute_with_sink(
                app.handle().clone(),
                collect(&first),
                Arc::new(|_| Ok(())),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(cancelled_done.content["record"]["status"], "cancelled");
        assert_eq!(
            cancelled_done.content["record"]["roleAssignments"]["agent"]["target"]["id"],
            pool.id
        );
        assert!(!root.path().join("disabled.txt").exists());
        assert!(app
            .state::<AppState>()
            .tool_call_cancellations
            .lock()
            .await
            .is_empty());
        for id in [&first, &second] {
            active_delegations().lock().unwrap().remove(id);
        }
        let reopened = tauri::test::mock_app();
        reopened.manage(AppState::default());
        reopened.manage(crate::test_support::TestDataRoot(data.clone()));
        let restored = execute_with_sink(
            reopened.handle().clone(),
            collect(&first),
            Arc::new(|_| Ok(())),
        )
        .await
        .unwrap();
        assert_eq!(restored.content["record"]["originSessionId"], parent);
        assert_eq!(restored.content["record"]["parentRunId"], "user-turn-1");
        assert_eq!(
            restored.content["record"]["status"],
            "cancelled"
        );
        let restored_result = execute_with_sink(
            reopened.handle().clone(), collect(&second), Arc::new(|_| Ok(())),
        ).await.unwrap();
        assert_eq!(restored_result.content["record"]["finalReply"], "Second independent result");
        assert_eq!(restored_result.content["record"]["parentRunId"], "user-turn-1");
        let mut foreign = collect(&first);
        foreign.session_id = "another-conversation".into();
        assert!(
            execute_with_sink(reopened.handle().clone(), foreign, Arc::new(|_| Ok(())))
                .await
                .unwrap_err()
                .contains("does not belong")
        );
    }
}
