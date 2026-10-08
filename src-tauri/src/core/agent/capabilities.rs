//! Shared Chat/Agent capability identity and desktop IPC boundary.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime};
use tauri_plugin_ginfer::state::GinferState;
use tokio::sync::oneshot;
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

    pub fn available_agent_tool_names(&self, disabled: &BTreeSet<String>) -> BTreeSet<String> {
        let mut names: BTreeSet<String> = self
            .tools
            .iter()
            .filter(|tool| !self.disabled(disabled, &tool.name))
            .filter_map(
                |tool| match self.target(&tool.name).expect("catalog target") {
                    CapabilityTarget::Native(name)
                        if ITERATION_ONE_TOOLS.iter().any(|entry| entry.name == name) =>
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
        self.tools
            .iter()
            .filter(|tool| tool.origin == "mcp" && !self.disabled(disabled, &tool.name))
            .map(|tool| {
                json!({"type":"function","function":{
                    "name":tool.name,"description":tool.description,
                    "parameters":tool.input_schema,"strict":false
                }})
            })
            .collect()
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
    catalog_from_mcp(response)
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

fn active_delegations() -> &'static Mutex<BTreeMap<String, (String, bool)>> {
    static ACTIVE: OnceLock<Mutex<BTreeMap<String, (String, bool)>>> = OnceLock::new();
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
        "skill.invoke" | "agent.run" => return run_delegated(app, request, &identity, emit).await,
        "skill.list" | "agent.list" | "agent.monitor" | "agent.cancel" => {
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
        "agent.monitor" | "agent.cancel" => {
            let run_id = required(&request.arguments, "runId")?;
            let active_entry = active_delegations()
                .lock()
                .map_err(|error| error.to_string())?
                .get(run_id)
                .cloned();
            let owned = active_entry
                .as_ref()
                .is_some_and(|(owner, _)| owner == &request.session_id)
                || super::runs::list_runs(&data)?.iter().any(|run| {
                    run.run_id == run_id
                        && run.origin_session_id.as_deref() == Some(&request.session_id)
                });
            if !owned {
                return Err("Delegated run does not belong to this conversation".into());
            }
            if identity == "agent.cancel" {
                commands::agent_cancel_turn(app.state(), run_id.into()).await?;
                json!({"cancelled":true,"runId":run_id})
            } else {
                let record = super::runs::list_runs(&data)?
                    .into_iter()
                    .find(|run| run.run_id == run_id);
                let active = active_entry.is_some_and(|(_, active)| active);
                let events = if active {
                    super::studio::operation(app.clone(), "monitor", json!({})).await?["active"]
                        [run_id]
                        .clone()
                } else {
                    Value::Null
                };
                json!({"runId":run_id,"active":active,"events":events,"record":record})
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
        runs.insert(request.run_id.clone(), (request.session_id, true));
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
        entry.1 = false;
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
    let status = match reason.as_str() {
        "cancelled" => "cancelled",
        "failed" => "failed",
        "max_steps" | "max_cycles" => "incomplete",
        _ => "finished",
    };
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
        assert!(catalog
            .agent_mcp_functions(&disabled)
            .iter()
            .all(|tool| tool["function"]["name"] != one));
        assert!(catalog
            .agent_mcp_functions(&disabled)
            .iter()
            .any(|tool| tool["function"]["name"] == two));
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
            model_id: None,
            tool_name: read.name.clone(),
            arguments: json!({"path":"note.txt"}),
            working_dir: Some(root.path().to_string_lossy().into()),
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
            model_id: None,
            tool_name: "os_fs_read".into(),
            arguments: json!({"path":"note.txt"}),
            working_dir: Some(root.path().to_string_lossy().into()),
            external_roots: vec![],
            auto_approve: false,
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
            assert!(events.iter().any(|event| matches!(event, AgentEvent::FolderAccessRequested { tool, .. } if tool == "os.fs.read_document")));
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
}
