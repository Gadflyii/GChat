//! Scoped, local MCP access to shared capabilities and Agent Studio for Code.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use hyper::{
    body::HttpBody,
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server, StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    agent::{
        capabilities, commands, definitions, runs, skills,
        types::{AgentEvent, AgentExternalRoot, AgentTurnRequest},
    },
    app::commands::get_jan_data_folder_path,
    state::AppState,
};

const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_BRIDGE_RUNS: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnection {
    pub url: String,
    pub token: String,
    pub session_id: String,
}

/// Policy is supplied by GChat's saved Code session, never MCP tool arguments.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct BridgePolicy {
    #[serde(default)]
    pub origin_session_id: Option<String>,
    #[serde(default)]
    pub auto_approve: bool,
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub external_roots: Vec<AgentExternalRoot>,
}

struct Session {
    policy: BridgePolicy,
    default_model: Option<String>,
    connected: bool,
    server: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRun {
    pub run_id: String,
    pub definition_name: String,
    pub status: String,
    pub stage: Option<String>,
    pub cycle: Option<u32>,
    pub max_cycles: Option<u32>,
    pub summary: Option<String>,
    pub result: Option<String>,
    pub artifacts: Vec<String>,
    pub approvals: Vec<Value>,
    pub workspace: String,
    pub updated_at_ms: u64,
    #[serde(skip)]
    terminal_reason: Option<String>,
}

#[derive(Default)]
struct BridgeRegistry {
    shutting_down: bool,
    sessions: HashMap<String, Session>,
    runs: BTreeMap<String, BridgeRun>,
    retry_keys: HashMap<(String, String), (String, String)>,
    run_tasks: HashMap<String, tauri::async_runtime::JoinHandle<()>>,
    tool_requests: HashMap<(String, String), (String, CancellationToken)>,
}
static REGISTRY: OnceLock<Mutex<BridgeRegistry>> = OnceLock::new();
fn registry() -> &'static Mutex<BridgeRegistry> {
    REGISTRY.get_or_init(|| Mutex::new(BridgeRegistry::default()))
}
fn lock_registry() -> Result<std::sync::MutexGuard<'static, BridgeRegistry>, String> {
    registry()
        .lock()
        .map_err(|_| "Code bridge state is unavailable".into())
}

pub fn prepare_session<R: Runtime>(
    app: &AppHandle<R>,
    cwd: &Path,
    default_model: Option<String>,
    policy: BridgePolicy,
) -> Result<BridgeConnection, String> {
    if let Some(id) = &policy.origin_session_id {
        super::agent::session::validate_session_id(id)?;
    }
    let project = cwd
        .canonicalize()
        .map_err(|e| format!("Cannot open Code project '{}': {e}", cwd.display()))?;
    if !project.is_dir() {
        return Err("Code project must be a directory".into());
    }
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .map_err(|e| format!("Cannot bind local Code bridge: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let session_id = format!("code-{}", Uuid::new_v4());
    let token = Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string();
    let connection = BridgeConnection {
        url: format!("http://127.0.0.1:{}/mcp/{}", addr.port(), session_id),
        token: token.clone(),
        session_id: session_id.clone(),
    };
    let app_for_server = app.clone();
    let project_for_server = project.clone();
    let session_for_server = session_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let server = match Server::from_tcp(listener) {
            Ok(server) => server.serve(make_service_fn(move |_| {
                let app = app_for_server.clone();
                let project = project_for_server.clone();
                let token = token.clone();
                let session_id = session_for_server.clone();
                async move {
                    Ok::<_, Infallible>(service_fn(move |request| {
                        let app = app.clone();
                        let project = project.clone();
                        let token = token.clone();
                        let session_id = session_id.clone();
                        async move {
                            Ok::<_, Infallible>(
                                handle_http(app, project, session_id, token, request).await,
                            )
                        }
                    }))
                }
            })),
            Err(error) => {
                log::error!("Code bridge could not serve bound port: {error}");
                return;
            }
        };
        if let Err(error) = server.await {
            log::warn!("Code bridge stopped: {error}");
        }
    });
    let mut state = lock_registry()?;
    if state.shutting_down {
        task.abort();
        return Err("GChat is shutting down".into());
    }
    state.sessions.insert(
        session_id,
        Session {
            policy,
            default_model,
            connected: false,
            server: task,
        },
    );
    Ok(connection)
}

/// Apply the saved Code session policy to future calls on this endpoint.
pub fn update_session_policy(session_id: &str, policy: BridgePolicy) -> Result<(), String> {
    if let Some(id) = &policy.origin_session_id {
        super::agent::session::validate_session_id(id)?;
    }
    lock_registry()?
        .sessions
        .get_mut(session_id)
        .ok_or("Code session is closing")?
        .policy = policy;
    Ok(())
}

fn session_policy(session_id: &str) -> Result<BridgePolicy, String> {
    lock_registry()?
        .sessions
        .get(session_id)
        .map(|session| session.policy.clone())
        .ok_or_else(|| "Code session is closing".into())
}

/// Release the endpoint and cancel direct calls. Delegated runs remain app-owned.
pub fn close_session(session_id: &str) {
    if let Ok(mut state) = lock_registry() {
        if let Some(session) = state.sessions.remove(session_id) {
            session.server.abort();
        }
        for ((owner, _), (_, cancellation)) in &state.tool_requests {
            if owner == session_id {
                cancellation.cancel();
            }
        }
    }
}

fn response(status: StatusCode, value: Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Body::from(value.to_string()))
        .expect("valid response")
}
fn rpc_ok(id: Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}
fn rpc_err(id: Value, code: i32, message: impl Into<String>) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message.into()}})
}

async fn read_body(mut body: Body) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = body.data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len().saturating_add(chunk.len()) > MAX_REQUEST_BYTES {
            return Err("MCP request is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn handle_http<R: Runtime>(
    app: AppHandle<R>,
    project: PathBuf,
    session_id: String,
    token: String,
    request: Request<Body>,
) -> Response<Body> {
    let history = request.uri().path() == format!("/mcp/{session_id}/history");
    if request.uri().path() != format!("/mcp/{session_id}") && !history {
        return response(StatusCode::NOT_FOUND, json!({"error":"not found"}));
    }
    if request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        != Some(format!("Bearer {token}").as_str())
    {
        return response(StatusCode::UNAUTHORIZED, json!({"error":"unauthorized"}));
    }
    if request.method() == Method::GET {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            json!({"error":"POST required"}),
        );
    }
    if request.method() != Method::POST {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            json!({"error":"method not allowed"}),
        );
    }
    let body = match read_body(request.into_body()).await {
        Ok(body) => body,
        Err(error) => return response(StatusCode::PAYLOAD_TOO_LARGE, json!({"error":error})),
    };
    let rpc: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return response(
                StatusCode::BAD_REQUEST,
                rpc_err(Value::Null, -32700, "Invalid JSON"),
            )
        }
    };
    if history {
        return match super::code_sessions::record_event(&app, &project, &session_id, rpc).await {
            Ok(value) => response(StatusCode::OK, value),
            Err(error) => response(StatusCode::BAD_REQUEST, json!({"error":error})),
        };
    }
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    let method = rpc.get("method").and_then(Value::as_str).unwrap_or("");
    if method == "notifications/cancelled" {
        if let Some(request_id) = rpc.get("params").and_then(|params| params.get("requestId")) {
            if let Ok(state) = lock_registry() {
                if let Some((_, cancellation)) = state
                    .tool_requests
                    .get(&(session_id.clone(), request_id.to_string()))
                {
                    cancellation.cancel();
                }
            }
        }
    }
    if method == "notifications/initialized" || method == "notifications/cancelled" {
        return Response::builder()
            .status(StatusCode::ACCEPTED)
            .body(Body::empty())
            .expect("valid response");
    }
    let result = match method {
        "initialize" => {
            if let Ok(mut state) = lock_registry() {
                if let Some(session) = state.sessions.get_mut(&session_id) {
                    session.connected = true;
                }
            }
            Ok(
                json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"gchat-agent-studio","version":env!("CARGO_PKG_VERSION")},"instructions":"GChat native tools and configured connectors use GChat project permissions and human approvals. Delegated GChat skills and saved agents run in GChat's Agent Studio runtime, including worker-pool placement. Discover skills/agents, then delegate with gchat_start_run. For project edits, wait for a delegated run to finish before editing the same files in OpenCode. Use gchat_get_run to check progress without busy polling. Human approvals appear in GChat; OpenCode must not approve its own delegated actions."}),
            )
        }
        "ping" => Ok(json!({})),
        "tools/list" => bridge_tools(&app, &session_id)
            .await
            .map(|tools| json!({"tools":tools})),
        "tools/call" => Ok(
            match call_tool(
                &app,
                &project,
                &session_id,
                id.clone(),
                rpc.get("params").cloned().unwrap_or_default(),
            )
            .await
            {
                Ok(value) => value,
                Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
            },
        ),
        _ => Err(format!("Unknown MCP method `{method}`")),
    };
    match result {
        Ok(value) => response(StatusCode::OK, rpc_ok(id, value)),
        Err(error) => response(StatusCode::OK, rpc_err(id, -32602, error)),
    }
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false}})
}
fn control_tools() -> Vec<Value> {
    vec![
    tool("gchat_list_skills", "List enabled GChat skills available under this Code session policy. Use their tools directly or delegate through gchat_start_run.", json!({}), &[]),
    tool("gchat_read_skill", "Read instructions for an enabled GChat skill. Use the shared tools or delegate through gchat_start_run.", json!({"name":{"type":"string"}}), &["name"]),
    tool("gchat_list_agents", "List saved GChat agents, Goal Loops, teams, and workflows with their worker-pool assignments.", json!({}), &[]),
    tool("gchat_start_run", "Start an asynchronous GChat Agent Studio run in this Code project. Saved worker-pool assignments apply. Use a stable requestId to make retries safe. Wait for project-writing runs before editing the same files. Human approvals are handled in GChat.", json!({"task":{"type":"string"},"requestId":{"type":"string"},"definitionId":{"type":"string"},"skillName":{"type":"string"},"modelId":{"type":"string","description":"Optional exact ready GChat model instance ID after switching models in Code"}}), &["task","requestId"]),
    tool("gchat_list_runs", "List delegated runs for this Code project, including runs from earlier Code sessions. Follow or cancel by runId.", json!({}), &[]),
    tool("gchat_get_run", "Get current status, progress, approval requests, result and artifacts for a delegated run. Poll only when useful; approvals require a human in GChat.", json!({"runId":{"type":"string"}}), &["runId"]),
    tool("gchat_cancel_run", "Cancel an active delegated GChat run.", json!({"runId":{"type":"string"}}), &["runId"]),
]
}

// Keep one asynchronous delegation surface: shared synchronous control tools
// are represented by the existing Code wrappers rather than a second run path.
fn operational_tool(identity: &str) -> bool {
    !matches!(
        identity,
        "skill.list"
            | "skill.invoke"
            | "agent.list"
            | "agent.run"
            | "agent.monitor"
            | "agent.cancel"
    )
}

fn control_identity(name: &str, args: &Value) -> Option<&'static str> {
    match name {
        "gchat_list_skills" | "gchat_read_skill" => Some("skill_list"),
        "gchat_list_agents" => Some("agent_list"),
        "gchat_start_run" if args.get("skillName").and_then(Value::as_str).is_some() => {
            Some("skill_invoke")
        }
        "gchat_start_run" => Some("agent_run"),
        "gchat_list_runs" | "gchat_get_run" => Some("agent_monitor"),
        "gchat_cancel_run" => Some("agent_cancel"),
        _ => None,
    }
}

fn check_control_policy(policy: &BridgePolicy, name: &str, args: &Value) -> Result<(), String> {
    if name == "gchat_read_skill"
        && policy
            .disabled_tools
            .contains(&format!("{}::skill_view", capabilities::NATIVE_SERVER))
    {
        return Err("Capability `skill_view` is disabled for this conversation".into());
    }
    if let Some(identity) = control_identity(name, args) {
        if policy
            .disabled_tools
            .contains(&format!("{}::{identity}", capabilities::NATIVE_SERVER))
        {
            return Err(format!(
                "Capability `{identity}` is disabled for this conversation"
            ));
        }
    }
    Ok(())
}

async fn bridge_tools<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<Vec<Value>, String> {
    let policy = session_policy(session_id)?;
    let mut tools = control_tools()
        .into_iter()
        .filter(|tool| {
            check_control_policy(
                &policy,
                tool["name"].as_str().unwrap_or_default(),
                &json!({}),
            )
            .is_ok()
        })
        .collect::<Vec<_>>();
    let disabled = policy.disabled_tools.into_iter().collect();
    tools.extend(capabilities::load_catalog(app.clone()).await?.visible(&disabled).into_iter()
        .filter(|tool| operational_tool(&tool.identity))
        .map(|tool| json!({"name":tool.name,"description":tool.description,"inputSchema":tool.input_schema})));
    Ok(tools)
}

async fn call_tool<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    session_id: &str,
    rpc_id: Value,
    params: Value,
) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or("Tool name required")?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let policy = session_policy(session_id)?;
    check_control_policy(&policy, name, &args)?;
    let disabled = policy.disabled_tools.iter().cloned().collect();
    let data = get_jan_data_folder_path(app.clone());
    let result = match name {
        "gchat_list_skills" => {
            let catalog = capabilities::load_catalog(app.clone()).await?;
            json!(skills::load_registry_with_tools(
                &data,
                &catalog.available_agent_tool_names(&disabled)
            )?
            .list_all()
            .into_iter()
            .filter(|entry| entry.enabled
                && entry.compatible
                && entry.unavailable_reasons.is_empty())
            .collect::<Vec<_>>())
        }
        "gchat_read_skill" => {
            let name = arg(&args, "name")?;
            let catalog = capabilities::load_catalog(app.clone()).await?;
            let registry = skills::load_registry_with_tools(
                &data,
                &catalog.available_agent_tool_names(&disabled),
            )?;
            let record = registry
                .get_enabled(name)
                .ok_or_else(|| format!("Skill `{name}` is not enabled or available"))?;
            json!({"name":record.manifest.name,"description":record.manifest.description,"requiresTools":record.manifest.requires_tools,"requiresScripts":record.manifest.requires_scripts,"body":record.body,"execution":"use shared GChat tools or delegate with gchat_start_run"})
        }
        "gchat_list_agents" => json!(definitions::list_definitions(&data)?
            .iter()
            .map(agent_summary)
            .collect::<Vec<_>>()),
        "gchat_start_run" => start_run(app, project, session_id, &args).await?,
        "gchat_list_runs" => json!(list_runs_for_project(app, project).await?),
        "gchat_get_run" => json!(get_run(app, project, arg(&args, "runId")?).await?),
        "gchat_cancel_run" => {
            let run_id = arg(&args, "runId")?;
            ensure_run_project(project, run_id)?;
            cancel_bridge_run(app.state(), run_id.into()).await?;
            json!({"cancelled":true,"runId":run_id})
        }
        _ => return execute_tool(app, project, session_id, rpc_id, name, args, policy).await,
    };
    Ok(json!({"content":[{"type":"text","text":result.to_string()}]}))
}
async fn execute_tool<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    session_id: &str,
    rpc_id: Value,
    name: &str,
    arguments: Value,
    policy: BridgePolicy,
) -> Result<Value, String> {
    let catalog = capabilities::load_catalog(app.clone()).await?;
    let descriptor = catalog
        .tools
        .iter()
        .find(|tool| tool.name == name && operational_tool(&tool.identity))
        .ok_or_else(|| format!("Unknown GChat tool `{name}`"))?;
    let disabled = policy.disabled_tools.iter().cloned().collect();
    if catalog.disabled(&disabled, name) {
        return Err(format!(
            "Capability `{name}` is disabled for this conversation"
        ));
    }
    let configured_model = lock_registry()?
        .sessions
        .get(session_id)
        .and_then(|session| session.default_model.clone());
    let model_id = if descriptor.identity == "vision.describe" {
        Some(
            select_model(
                app,
                &definitions::general_agent(),
                &get_jan_data_folder_path(app.clone()),
                configured_model,
            )
            .await?,
        )
    } else {
        None
    };
    let run_id = format!("code-tool-{}", Uuid::new_v4());
    let request_key = (session_id.to_owned(), rpc_id.to_string());
    let cancellation = CancellationToken::new();
    let (finished_tx, finished_rx) = oneshot::channel();
    let (registered_tx, registered_rx) = oneshot::channel();
    let registered = Arc::new(Mutex::new(Some(registered_tx)));
    let request = capabilities::CapabilityExecuteRequest {
        run_id: run_id.clone(),
        session_id: policy
            .origin_session_id
            .unwrap_or_else(|| session_id.into()),
        model_id,
        tool_name: name.into(),
        arguments,
        working_dir: Some(project.to_string_lossy().into_owned()),
        external_roots: policy.external_roots,
        auto_approve: policy.auto_approve,
        selected_skill: None,
        disabled_tools: policy.disabled_tools,
    };
    {
        let mut state = lock_registry()?;
        if state.shutting_down || !state.sessions.contains_key(session_id) {
            return Err("Code session is closing".into());
        }
        if state.tool_requests.contains_key(&request_key) {
            return Err("MCP request is already active".into());
        }
        if state
            .runs
            .values()
            .filter(|run| run.status == "running" || run.status == "queued")
            .count()
            >= MAX_BRIDGE_RUNS
        {
            return Err("Too many Code operations are active".into());
        }
        state.runs.insert(
            run_id.clone(),
            BridgeRun {
                run_id: run_id.clone(),
                definition_name: descriptor.identity.clone(),
                status: "queued".into(),
                stage: None,
                cycle: None,
                max_cycles: None,
                summary: None,
                result: None,
                artifacts: vec![],
                approvals: vec![],
                workspace: project.to_string_lossy().into_owned(),
                updated_at_ms: runs::now_ms(),
                terminal_reason: None,
            },
        );
        state
            .tool_requests
            .insert(request_key.clone(), (run_id.clone(), cancellation.clone()));
        trim_runs(&mut state);
        state
            .run_tasks
            .retain(|_, handle| !handle.inner().is_finished());
        let app = app.clone();
        let task_run_id = run_id.clone();
        let task = tauri::async_runtime::spawn(async move {
            let cancel_app = app.clone();
            let cancel_run_id = task_run_id.clone();
            // The shared executor registers its cancellation sender before TurnStarted.
            // Wait for that event so an immediate transport cancellation is not lost.
            let gate_cancellation = cancellation.clone();
            let cancel_task = tokio::spawn(async move {
                if registered_rx.await.is_ok() {
                    gate_cancellation.cancelled().await;
                    let _ = commands::agent_cancel_turn(cancel_app.state(), cancel_run_id).await;
                }
            });
            let event_run_id = task_run_id.clone();
            let sink = Arc::new(move |event: AgentEvent| {
                if matches!(event, AgentEvent::TurnStarted { .. }) {
                    if let Ok(mut sender) = registered.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(());
                        }
                    }
                }
                observe(&event_run_id, &event);
                Ok(())
            });
            let result = capabilities::execute_with_sink(app, request, sink).await;
            cancel_task.abort();
            let response = match result {
                Ok(result) => {
                    finish_success(&task_run_id);
                    json!({"content":[{"type":"text","text":result.content.to_string()}],"isError":result.error.is_some()})
                }
                Err(error) => {
                    finish_with_error(&task_run_id, &error);
                    json!({"content":[{"type":"text","text":error}],"isError":true})
                }
            };
            // Clearing pending approvals can wake a denied tool before the
            // shared cancellation receiver runs. The bridge's accepted cancel
            // request remains authoritative for its terminal activity status.
            if cancellation.is_cancelled() {
                observe(
                    &task_run_id,
                    &AgentEvent::TurnFinished {
                        reason: "cancelled".into(),
                        step_count: 1,
                    },
                );
                finish_success(&task_run_id);
            }
            if let Ok(mut state) = lock_registry() {
                state.tool_requests.remove(&request_key);
            }
            let _ = finished_tx.send(response);
        });
        state.run_tasks.insert(run_id, task);
    }
    finished_rx
        .await
        .map_err(|_| "Code operation could not finish".into())
}

fn arg<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}
fn agent_summary(definition: &definitions::AgentDefinition) -> Value {
    let kind = match &definition.strategy {
        definitions::AgentStrategy::Standard => "standard",
        definitions::AgentStrategy::GoalLoop { .. } => "goal_loop",
        definitions::AgentStrategy::Coordinator { .. } => "coordinator",
        definitions::AgentStrategy::Workflow { .. } => "workflow",
    };
    json!({"id":definition.id,"name":definition.name,"description":definition.description,"kind":kind,"roleAssignments":definition.role_assignments,"roles":definitions::placement_roles(definition)})
}
fn ensure_run_project(project: &Path, run_id: &str) -> Result<(), String> {
    let state = lock_registry()?;
    let run = state.runs.get(run_id).ok_or("Run not found")?;
    if run.workspace != project.to_string_lossy() {
        return Err("Run belongs to another project".into());
    }
    Ok(())
}

pub(crate) async fn select_model<R: Runtime>(
    app: &AppHandle<R>,
    definition: &definitions::AgentDefinition,
    data: &Path,
    selected_model: Option<String>,
) -> Result<String, String> {
    if let Some(id) = definition.model_instance_id.as_ref() {
        return Ok(id.clone());
    }
    let instances = commands::agent_list_model_instances(app.state()).await?;
    let ready = instances
        .iter()
        .map(|instance| instance.id.as_str())
        .collect::<HashSet<_>>();
    let roles = definitions::placement_roles(definition);
    let fully_assigned = roles.iter().all(|(role, _)| {
        matches!(
            definition.role_assignments.get(role).map(|a| &a.target),
            Some(
                super::agent::worker_pools::WorkerTarget::Instance { .. }
                    | super::agent::worker_pools::WorkerTarget::Pool { .. }
            )
        )
    });
    if fully_assigned {
        return select_ready_assigned_model(definition, data, &ready);
    }
    if let Some(id) = selected_model {
        if let Some(instance) = instances.iter().find(|instance| instance.id == id) {
            return Ok(instance.id.clone());
        }
        return match instances.iter().filter(|instance|instance.model_id==id).collect::<Vec<_>>().as_slice(){
            [instance]=>Ok(instance.id.clone()),
            []=>Err(format!("Configured Code model `{id}` is not a ready GChat instance")),
            _=>Err(format!("Configured Code model `{id}` matches multiple ready GChat instances; choose one exact instance ID")),
        };
    }
    if instances.len() == 1 {
        return Ok(instances[0].id.clone());
    }
    Err("No unambiguous model is selected for this agent. Choose a GChat model in Code or assign every role to an instance or worker pool.".into())
}

fn select_ready_assigned_model(
    definition: &definitions::AgentDefinition,
    data: &Path,
    ready: &HashSet<&str>,
) -> Result<String, String> {
    let pools = super::agent::worker_pools::list(data)?;
    for assignment in definition.role_assignments.values() {
        match &assignment.target {
            super::agent::worker_pools::WorkerTarget::Instance { id }
                if ready.contains(id.as_str()) =>
            {
                return Ok(id.clone());
            }
            super::agent::worker_pools::WorkerTarget::Pool { id } => {
                if let Some(member) = pools.iter().find(|pool| &pool.id == id).and_then(|pool| {
                    pool.members
                        .iter()
                        .find(|member| ready.contains(member.instance_id.as_str()))
                }) {
                    return Ok(member.instance_id.clone());
                }
            }
            _ => {}
        }
    }
    Err(
        "No ready model instance is available in the saved agent's assigned roles or worker pools"
            .into(),
    )
}

async fn start_run<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    session_id: &str,
    args: &Value,
) -> Result<Value, String> {
    let policy = session_policy(session_id)?;
    let disabled = policy.disabled_tools.iter().cloned().collect();
    let task = arg(args, "task")?.trim();
    let request_id = arg(args, "requestId")?.trim();
    if request_id.len() > 128 || task.len() > 32_000 {
        return Err("Task or requestId is too long".into());
    }
    let definition_id = args
        .get("definitionId")
        .and_then(Value::as_str)
        .unwrap_or("general");
    let skill_name = args.get("skillName").and_then(Value::as_str);
    let data = get_jan_data_folder_path(app.clone());
    let definition = definitions::get_definition(&data, definition_id)?;
    if let Some(name) = skill_name {
        let catalog = capabilities::load_catalog(app.clone()).await?;
        if skills::load_registry_with_tools(&data, &catalog.available_agent_tool_names(&disabled))?
            .get_enabled(name)
            .is_none()
        {
            return Err(format!("Skill `{name}` is not enabled or available"));
        }
    }
    let requested_model = args.get("modelId").and_then(Value::as_str);
    let fingerprint=json!({"task":task,"definitionId":definition_id,"skillName":skill_name,"modelId":requested_model}).to_string();
    let retry_key = (session_id.to_string(), request_id.to_string());
    {
        let state = lock_registry()?;
        if let Some((existing_fingerprint, run_id)) = state.retry_keys.get(&retry_key) {
            if existing_fingerprint != &fingerprint {
                return Err("requestId was already used for a different task".into());
            }
            let status = state
                .runs
                .get(run_id)
                .map(|run| run.status.as_str())
                .unwrap_or("accepted");
            return Ok(json!({"runId":run_id,"status":status,"reused":true}));
        }
    }
    let selected_model = if let Some(id) = requested_model {
        Some(id.to_string())
    } else {
        lock_registry()?
            .sessions
            .get(session_id)
            .and_then(|session| session.default_model.clone())
    };
    let model_id = select_model(app, &definition, &data, selected_model).await?;
    let run_id = format!("code-{}", Uuid::new_v4());
    let run_session_id = format!("code-{}", Uuid::new_v4());
    let max_cycles = match definition.strategy {
        definitions::AgentStrategy::GoalLoop { max_cycles, .. } => Some(max_cycles),
        _ => None,
    };
    let request = AgentTurnRequest {
        run_id: run_id.clone(),
        session_id: run_session_id,
        model_id,
        user_message: task.into(),
        definition_id: Some(definition_id.into()),
        role_assignments: Default::default(),
        selected_skill: skill_name.map(str::to_string),
        attachments: vec![],
        working_dir: Some(project.to_string_lossy().into_owned()),
        external_roots: policy.external_roots,
        max_steps: None,
        auto_approve: policy.auto_approve,
        disabled_tools: policy.disabled_tools,
        origin_session_id: policy.origin_session_id,
    };
    let run_id_for_task = run_id.clone();
    let app_for_task = app.clone();
    let (ready_tx, ready_rx) = oneshot::channel();
    let ready_cell = Arc::new(Mutex::new(Some(ready_tx)));
    {
        let mut state = lock_registry()?;
        if state.shutting_down || !state.sessions.contains_key(session_id) {
            return Err("Code session is closing".into());
        }
        state
            .run_tasks
            .retain(|_, handle| !handle.inner().is_finished());
        if let Some((existing_fingerprint, existing_id)) = state.retry_keys.get(&retry_key) {
            if existing_fingerprint != &fingerprint {
                return Err("requestId was already used for a different task".into());
            }
            let status = state
                .runs
                .get(existing_id)
                .map(|run| run.status.as_str())
                .unwrap_or("accepted");
            return Ok(json!({"runId":existing_id,"status":status,"reused":true}));
        }
        if state.runs.len() >= MAX_BRIDGE_RUNS
            && state
                .runs
                .values()
                .all(|run| run.status == "running" || run.status == "queued")
        {
            return Err("Too many delegated runs are active".into());
        }
        state
            .retry_keys
            .insert(retry_key, (fingerprint, run_id.clone()));
        state.runs.insert(
            run_id.clone(),
            BridgeRun {
                run_id: run_id.clone(),
                definition_name: definition.name.clone(),
                status: "queued".into(),
                stage: None,
                cycle: None,
                max_cycles,
                summary: Some(task.chars().take(160).collect()),
                result: None,
                artifacts: vec![],
                approvals: vec![],
                workspace: project.to_string_lossy().into_owned(),
                updated_at_ms: runs::now_ms(),
                terminal_reason: None,
            },
        );
        trim_runs(&mut state);
        let task_handle = tauri::async_runtime::spawn(async move {
            let event_run_id = run_id_for_task.clone();
            let sink = Arc::new(move |event: AgentEvent| {
                observe(&event_run_id, &event);
                Ok(())
            });
            let ready = ready_cell.clone();
            let on_registered = Arc::new(move || {
                if let Ok(mut sender) = ready.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(());
                    }
                }
            });
            match commands::run_turn_with_sink_ready(
                app_for_task,
                request,
                sink,
                Some(on_registered),
            )
            .await
            {
                Ok(()) => finish_success(&run_id_for_task),
                Err(error) => finish_with_error(&run_id_for_task, &error),
            }
        });
        state.run_tasks.insert(run_id.clone(), task_handle);
    }
    if ready_rx.await.is_err() {
        let mut state = lock_registry()?;
        let error = state
            .runs
            .remove(&run_id)
            .and_then(|run| run.summary)
            .unwrap_or_else(|| "Agent run could not start".into());
        state.retry_keys.retain(|_, (_, id)| id != &run_id);
        return Err(error);
    }
    Ok(json!({"runId":run_id,"status":"running","reused":false}))
}
fn trim_runs(state: &mut BridgeRegistry) {
    if state.runs.len() <= MAX_BRIDGE_RUNS {
        return;
    }
    let mut completed = state
        .runs
        .values()
        .filter(|run| run.status != "running" && run.status != "queued")
        .map(|run| (run.updated_at_ms, run.run_id.clone()))
        .collect::<Vec<_>>();
    completed.sort();
    for (_, id) in completed
        .into_iter()
        .take(state.runs.len() - MAX_BRIDGE_RUNS)
    {
        state.runs.remove(&id);
        state.retry_keys.retain(|_, (_, run_id)| run_id != &id);
    }
}
fn observe(run_id: &str, event: &AgentEvent) {
    if let AgentEvent::StageActivity { event, .. } = event {
        if matches!(
            event.as_ref(),
            AgentEvent::ApprovalRequested { .. } | AgentEvent::FolderAccessRequested { .. }
        ) {
            observe(run_id, event);
        }
        return;
    }
    let Ok(mut state) = lock_registry() else {
        return;
    };
    let Some(run) = state.runs.get_mut(run_id) else {
        return;
    };
    run.updated_at_ms = runs::now_ms();
    match event {
        AgentEvent::TurnStarted { .. } => run.status = "running".into(),
        AgentEvent::OrchestrationStarted {
            definition_name, ..
        } => {
            run.definition_name.clone_from(definition_name);
            run.status = "running".into();
        }
        AgentEvent::StageQueued { name, reason, .. } => {
            run.stage = Some(name.clone());
            run.summary = Some(reason.clone());
        }
        AgentEvent::StageStarted { name, cycle, .. } => {
            run.stage = Some(name.clone());
            run.cycle = *cycle;
            run.status = "running".into();
        }
        AgentEvent::StageFinished { summary, .. } => run.summary = Some(summary.clone()),
        AgentEvent::ToolCallParsed { call, .. } => run.stage = Some(call.tool.clone()),
        AgentEvent::ToolCallExecuted { result } => {
            run.summary = Some(result.outcome.summary.chars().take(160).collect());
            run.result = Some(match &result.outcome.details {
                Some(details) => {
                    json!({"summary": result.outcome.summary, "details": details}).to_string()
                }
                None => result.outcome.summary.clone(),
            });
        }
        AgentEvent::AssistantReply { text } => run.result = Some(text.clone()),
        AgentEvent::ApprovalRequested {
            run_id,
            approval_id,
            tool,
            reason,
            preview,
            can_remember,
            ..
        } => {
            if !run
                .approvals
                .iter()
                .any(|entry| entry["approvalId"] == *approval_id)
            {
                run.approvals.push(json!({"type":"approval_requested","runId":run_id,"approvalId":approval_id,"tool":tool,"reason":reason,"preview":preview,"canRemember":can_remember}));
            }
        }
        AgentEvent::FolderAccessRequested {
            run_id,
            access_id,
            tool,
            path,
            reason,
            ..
        } => {
            if !run
                .approvals
                .iter()
                .any(|entry| entry["approvalId"] == *access_id)
            {
                run.approvals.push(json!({"type":"folder_access_requested","runId":run_id,"approvalId":access_id,"tool":tool,"reason":reason,"path":path}));
            }
        }
        AgentEvent::TurnFinished { reason, .. } => {
            run.terminal_reason = Some(reason.clone());
            run.approvals.clear();
        }
        _ => {}
    }
}
fn finish_success(run_id: &str) {
    if let Ok(mut state) = lock_registry() {
        if let Some(run) = state.runs.get_mut(run_id) {
            run.status = match run.terminal_reason.as_deref() {
                Some("cancelled") => "cancelled",
                Some("failed") => "failed",
                Some("max_steps" | "max_cycles") => "incomplete",
                _ => "finished",
            }
            .into();
            run.updated_at_ms = runs::now_ms();
        }
    }
}
fn finish_with_error(run_id: &str, error: &str) {
    if let Ok(mut state) = lock_registry() {
        if let Some(run) = state.runs.get_mut(run_id) {
            run.status = "failed".into();
            run.summary = Some(error.into());
            run.approvals.clear();
            run.updated_at_ms = runs::now_ms();
        }
    }
}
async fn get_run<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    run_id: &str,
) -> Result<BridgeRun, String> {
    ensure_run_project(project, run_id)?;
    let mut run = lock_registry()?
        .runs
        .get(run_id)
        .cloned()
        .ok_or("Run not found")?;
    populate_completed(app, &mut run).await;
    filter_pending(app, &mut run).await;
    Ok(run)
}
async fn list_runs_for_project<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
) -> Result<Vec<BridgeRun>, String> {
    let filter = project.to_string_lossy();
    let mut rows = lock_registry()?
        .runs
        .values()
        .filter(|run| run.workspace == filter)
        .cloned()
        .collect::<Vec<_>>();
    rows.sort_by_key(|run| std::cmp::Reverse(run.updated_at_ms));
    let data = get_jan_data_folder_path(app.clone());
    let records = runs::list_runs(&data).unwrap_or_default();
    for run in &mut rows {
        if run.status != "running" && run.status != "queued" {
            if let Some(record) = records.iter().find(|record| record.run_id == run.run_id) {
                run.result = Some(record.final_reply.clone());
                if let Some(path) = &record.output_workspace {
                    run.artifacts.push(path.clone());
                }
            }
        }
        filter_pending(app, run).await;
    }
    Ok(rows)
}
async fn populate_completed<R: Runtime>(app: &AppHandle<R>, run: &mut BridgeRun) {
    if run.status == "running" || run.status == "queued" {
        return;
    }
    let data = get_jan_data_folder_path(app.clone());
    if let Ok(records) = runs::list_runs(&data) {
        if let Some(record) = records
            .into_iter()
            .find(|record| record.run_id == run.run_id)
        {
            run.result = Some(record.final_reply);
            if let Some(path) = record.output_workspace {
                run.artifacts.push(path);
            }
        }
    }
}
async fn filter_pending<R: Runtime>(app: &AppHandle<R>, run: &mut BridgeRun) {
    let state = app.state::<AppState>();
    let approvals = state.agent_pending_approvals.lock().await;
    let folders = state.agent_pending_folder_access.lock().await;
    run.approvals.retain(|entry| {
        let id = entry
            .get("approvalId")
            .and_then(Value::as_str)
            .unwrap_or("");
        approvals.contains_key(id) || folders.contains_key(id)
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub connected: bool,
    pub skill_count: usize,
    pub agent_count: usize,
    pub tool_count: usize,
    pub detail: Option<String>,
}
#[tauri::command]
pub async fn opencode_bridge_status<R: Runtime>(app: AppHandle<R>) -> Result<BridgeStatus, String> {
    let data = get_jan_data_folder_path(app.clone());
    let catalog = capabilities::load_catalog(app).await?;
    Ok(BridgeStatus {
        connected: lock_registry()?
            .sessions
            .values()
            .any(|session| session.connected),
        skill_count: skills::load_registry_with_tools(
            &data,
            &catalog.available_agent_tool_names(&Default::default()),
        )?
        .enabled()
        .count(),
        agent_count: definitions::list_definitions(&data)?.len(),
        tool_count: catalog
            .tools
            .iter()
            .filter(|tool| operational_tool(&tool.identity))
            .count(),
        detail: None,
    })
}
#[tauri::command]
pub async fn opencode_bridge_list_runs<R: Runtime>(
    app: AppHandle<R>,
    workspace: Option<String>,
) -> Result<Vec<BridgeRun>, String> {
    match workspace {
        Some(path) => {
            let canonical = PathBuf::from(path)
                .canonicalize()
                .map_err(|e| format!("Could not open Code workspace: {e}"))?;
            list_runs_for_project(&app, &canonical).await
        }
        None => {
            let mut rows = lock_registry()?.runs.values().cloned().collect::<Vec<_>>();
            rows.sort_by_key(|run| std::cmp::Reverse(run.updated_at_ms));
            let data = get_jan_data_folder_path(app.clone());
            let records = runs::list_runs(&data).unwrap_or_default();
            for run in &mut rows {
                if run.status != "running" && run.status != "queued" {
                    if let Some(record) = records.iter().find(|record| record.run_id == run.run_id)
                    {
                        run.result = Some(record.final_reply.clone());
                        if let Some(path) = &record.output_workspace {
                            run.artifacts.push(path.clone());
                        }
                    }
                }
                filter_pending(&app, run).await;
            }
            Ok(rows)
        }
    }
}
#[tauri::command]
pub async fn opencode_bridge_cancel_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    if !lock_registry()?.runs.contains_key(&run_id) {
        return Err("Bridge run not found".into());
    }
    cancel_bridge_run(state, run_id).await
}

async fn cancel_bridge_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    let cancellation = lock_registry()?
        .tool_requests
        .values()
        .find(|(id, _)| id == &run_id)
        .map(|(_, token)| token.clone());
    if let Some(token) = cancellation {
        token.cancel();
        return Ok(());
    }
    commands::agent_cancel_turn(state, run_id).await
}

pub async fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let (active, mut tasks) = match lock_registry() {
        Ok(mut state) => {
            state.shutting_down = true;
            for (_, cancellation) in state.tool_requests.values() {
                cancellation.cancel();
            }
            for (_, session) in state.sessions.drain() {
                session.server.abort();
            }
            let active = state
                .runs
                .values()
                .filter(|run| run.status == "queued" || run.status == "running")
                .map(|run| run.run_id.clone())
                .collect::<Vec<_>>();
            let tasks = std::mem::take(&mut state.run_tasks);
            (active, tasks)
        }
        Err(error) => {
            log::warn!("Could not stop Code bridge: {error}");
            return;
        }
    };
    let state = app.state::<AppState>();
    let mut unresolved = active;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !unresolved.is_empty() {
        let mut pending = state.tool_call_cancellations.lock().await;
        unresolved.retain(|run_id| {
            if let Some(sender) = pending.remove(run_id) {
                let _ = sender.send(());
                return false;
            }
            tasks
                .get(run_id)
                .is_some_and(|handle| !handle.inner().is_finished())
        });
        drop(pending);
        if unresolved.is_empty() {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            for run_id in &unresolved {
                if let Some(handle) = tasks.get(run_id) {
                    handle.abort();
                }
            }
            log::warn!(
                "Cancelled {} Code runs before they registered",
                unresolved.len()
            );
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    if tokio::time::timeout(
        Duration::from_secs(15),
        futures_util::future::join_all(tasks.drain().map(|(_, handle)| handle)),
    )
    .await
    .is_err()
    {
        log::warn!("Timed out waiting for delegated Code runs to persist after cancellation");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::worker_pools::{PoolMember, RoleAssignment, WorkerPool, WorkerTarget};
    use rmcp::{
        model::ClientInfo,
        transport::{
            streamable_http_client::StreamableHttpClientTransportConfig,
            StreamableHttpClientTransport,
        },
        ServiceExt,
    };
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn local_mcp_requires_its_launch_token_and_serves_tool_discovery() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock GChat");
        let project = tempfile::tempdir().expect("project");
        app.manage(AppState::default());
        app.manage(crate::test_support::TestDataRoot(
            project.path().join("data"),
        ));
        let connection =
            prepare_session(app.handle(), project.path(), None, BridgePolicy::default())
                .expect("bridge");
        let client = reqwest::Client::new();
        let initialized=client.post(&connection.url).bearer_auth(&connection.token).json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).send().await.expect("initialize");
        assert_eq!(initialized.status(), StatusCode::OK);
        let initialized: Value = initialized.json().await.expect("initialize result");
        assert_eq!(
            initialized["result"]["serverInfo"]["name"],
            "gchat-agent-studio"
        );
        let listed: Value = client
            .post(&connection.url)
            .bearer_auth(&connection.token)
            .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .expect("tools request")
            .json()
            .await
            .expect("tools result");
        assert!(listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "gchat_start_run"));
        let transport = StreamableHttpClientTransport::with_client(
            tauri_plugin_http::reqwest::Client::new(),
            StreamableHttpClientTransportConfig {
                uri: connection.url.clone().into(),
                auth_header: Some(connection.token.clone()),
                ..Default::default()
            },
        );
        let mcp = ClientInfo::default()
            .serve(transport)
            .await
            .expect("rmcp handshake");
        assert!(mcp
            .list_all_tools()
            .await
            .expect("rmcp tools")
            .iter()
            .any(|tool| tool.name == "gchat_start_run"));
        let denied = client
            .post(&connection.url)
            .json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}))
            .send()
            .await
            .expect("unauthorized request");
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        let wrong_path = client
            .post(connection.url.replace("/mcp/", "/wrong/"))
            .bearer_auth(&connection.token)
            .json(&json!({"jsonrpc":"2.0","id":4,"method":"tools/list"}))
            .send()
            .await
            .expect("wrong path request");
        assert_eq!(wrong_path.status(), StatusCode::NOT_FOUND);
        close_session(&connection.session_id);
    }

    async fn rpc(connection: &BridgeConnection, id: u32, method: &str, params: Value) -> Value {
        reqwest::Client::new()
            .post(&connection.url)
            .bearer_auth(&connection.token)
            .json(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["result"]
            .clone()
    }

    #[derive(Clone)]
    struct Connector(Arc<std::sync::atomic::AtomicUsize>);
    impl rmcp::ServerHandler for Connector {
        fn get_info(&self) -> rmcp::model::ServerInfo {
            rmcp::model::ServerInfo {
                capabilities: rmcp::model::ServerCapabilities::builder()
                    .enable_tools()
                    .build(),
                ..Default::default()
            }
        }
        async fn list_tools(
            &self,
            _: Option<rmcp::model::PaginatedRequestParam>,
            _: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
            Ok(rmcp::model::ListToolsResult {
                tools: vec![rmcp::model::Tool::new(
                    "read",
                    "Read the configured test connector",
                    Arc::new(
                        json!({"type":"object","properties":{"key":{"type":"string"}}})
                            .as_object()
                            .unwrap()
                            .clone(),
                    ),
                )],
                ..Default::default()
            })
        }
        async fn call_tool(
            &self,
            request: rmcp::model::CallToolRequestParam,
            _: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(rmcp::model::CallToolResult::success(vec![
                rmcp::model::Content::text(format!(
                    "configured connector: {}",
                    request.arguments.unwrap()["key"]
                )),
            ]))
        }
    }

    #[tokio::test]
    async fn code_mcp_executes_native_files_and_configured_connector_with_session_policy() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("note.txt"), "shared native read").unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        app.manage(crate::test_support::TestDataRoot(
            project.path().join("data"),
        ));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (server_io, client_io) = tokio::io::duplex(4096);
        let (server, client) = tokio::join!(
            Connector(calls.clone()).serve(server_io),
            ().serve(client_io)
        );
        let server = server.unwrap();
        app.state::<AppState>().mcp_servers.lock().await.insert(
            "configured".into(),
            crate::core::state::RunningServiceEnum::NoInit(client.unwrap()),
        );
        let connection = prepare_session(
            app.handle(),
            project.path(),
            None,
            BridgePolicy {
                auto_approve: true,
                ..Default::default()
            },
        )
        .unwrap();
        let tools = rpc(&connection, 1, "tools/list", json!({})).await;
        let tools = tools["tools"].as_array().unwrap();
        assert!(tools.iter().any(|tool| tool["name"] == "os_fs_read"));
        assert!(!tools
            .iter()
            .any(|tool| tool["name"] == "agent_run" || tool["name"] == "skill_invoke"));
        let wire = capabilities::mcp_wire_name("configured", "read");
        assert!(tools.iter().any(|tool| tool["name"] == wire));
        let read = rpc(
            &connection,
            2,
            "tools/call",
            json!({"name":"os_fs_read","arguments":{"path":"note.txt"}}),
        )
        .await;
        assert!(read.to_string().contains("shared native read"));
        assert_eq!(read["isError"], false);
        let connected = rpc(
            &connection,
            3,
            "tools/call",
            json!({"name":wire,"arguments":{"key":"document"}}),
        )
        .await;
        assert!(connected.to_string().contains("configured connector"));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        update_session_policy(
            &connection.session_id,
            BridgePolicy {
                auto_approve: true,
                disabled_tools: vec![
                    format!("configured::{wire}"),
                    "gchat-native::os_fs_read".into(),
                    "gchat-native::agent_run".into(),
                    "gchat-native::skill_invoke".into(),
                ],
                ..Default::default()
            },
        )
        .unwrap();
        let tools = rpc(&connection, 4, "tools/list", json!({})).await;
        assert!(!tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == wire
                || tool["name"] == "os_fs_read"
                || tool["name"] == "gchat_start_run"));
        for (id, name, arguments) in [
            (5, wire.as_str(), json!({"key":"document"})),
            (6, "os_fs_read", json!({"path":"note.txt"})),
            (
                7,
                "gchat_start_run",
                json!({"task":"test","requestId":"denied"}),
            ),
            (
                8,
                "gchat_start_run",
                json!({"task":"test","requestId":"denied-skill","skillName":"anything"}),
            ),
        ] {
            let denied = rpc(
                &connection,
                id,
                "tools/call",
                json!({"name":name,"arguments":arguments}),
            )
            .await;
            assert_eq!(denied["isError"], true, "{denied}");
            assert!(denied.to_string().contains("disabled"), "{denied}");
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        let rows = list_runs_for_project(app.handle(), project.path())
            .await
            .unwrap();
        assert!(rows.iter().any(|row| row.definition_name == "os.fs.read"
            && row.status == "finished"
            && row
                .result
                .as_deref()
                .is_some_and(|result| result.contains("shared native read"))));
        close_session(&connection.session_id);
        server.cancel().await.unwrap();
    }

    #[tokio::test]
    async fn code_direct_tool_surfaces_approval_and_transport_cancellation_clears_it() {
        let project = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        app.manage(crate::test_support::TestDataRoot(
            project.path().join("data"),
        ));
        let connection =
            prepare_session(app.handle(), project.path(), None, BridgePolicy::default()).unwrap();
        let request = rpc(
            &connection,
            42,
            "tools/call",
            json!({"name":"os_shell_run","arguments":{"cmd":"git","args":["status"]}}),
        );
        let cancellation = async {
            let run = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let rows = list_runs_for_project(app.handle(), project.path())
                        .await
                        .unwrap();
                    if let Some(row) = rows
                        .iter()
                        .find(|row| row.status == "finished" || row.status == "failed")
                    {
                        panic!(
                            "tool finished before approval: {}",
                            serde_json::to_string(row).unwrap()
                        );
                    }
                    if let Some(row) = rows.into_iter().find(|row| !row.approvals.is_empty()) {
                        break row;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("approval appears in Code panel data");
            assert_eq!(run.definition_name, "os.shell.run");
            assert_eq!(run.status, "running");
            assert_eq!(run.approvals[0]["tool"], "os.shell.run");
            let response = reqwest::Client::new().post(&connection.url).bearer_auth(&connection.token)
                .json(&json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":42}})).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::ACCEPTED);
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(8), async {
            tokio::join!(request, cancellation)
        })
        .await
        .unwrap();
        assert_eq!(result["isError"], true);
        let rows = list_runs_for_project(app.handle(), project.path())
            .await
            .unwrap();
        assert_eq!(rows[0].status, "cancelled");
        assert!(rows[0].approvals.is_empty());
        assert!(app
            .state::<AppState>()
            .agent_pending_approvals
            .lock()
            .await
            .is_empty());
        close_session(&connection.session_id);
    }

    #[tokio::test]
    async fn code_auto_approval_still_requires_confirmation_to_save_an_agent() {
        let project = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        app.manage(AppState::default());
        let data = project.path().join("data");
        app.manage(crate::test_support::TestDataRoot(data.clone()));
        let connection = prepare_session(
            app.handle(),
            project.path(),
            None,
            BridgePolicy {
                auto_approve: true,
                ..Default::default()
            },
        )
        .unwrap();
        let mut definition = definitions::general_agent();
        definition.id = "code-confirmation-test".into();
        definition.name = "Code confirmation test".into();
        definition.built_in = false;
        let request = rpc(
            &connection,
            99,
            "tools/call",
            json!({"name":"studio_manage","arguments":{"action":"save_definition","args":definition}}),
        );
        let cancel = async {
            let run = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let rows = list_runs_for_project(app.handle(), project.path())
                        .await
                        .unwrap();
                    if let Some(row) = rows.into_iter().find(|row| !row.approvals.is_empty()) {
                        break row;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("saving a definition must request human confirmation");
            assert_eq!(run.approvals[0]["tool"], "studio.manage");
            opencode_bridge_cancel_run(app.state(), run.run_id)
                .await
                .unwrap();
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(8), async {
            tokio::join!(request, cancel)
        })
        .await
        .unwrap();
        assert_eq!(result["isError"], true);
        assert!(!definitions::list_definitions(&data)
            .unwrap()
            .iter()
            .any(|definition| definition.id == "code-confirmation-test"));
        close_session(&connection.session_id);
    }

    #[test]
    fn fully_pool_assigned_agent_selects_a_ready_member_without_a_code_model() {
        let data = tempfile::tempdir().expect("data");
        let pool = super::super::agent::worker_pools::save(
            data.path(),
            WorkerPool {
                id: String::new(),
                name: "Review workers".into(),
                members: vec![
                    PoolMember {
                        instance_id: "ginfer/remote/offline".into(),
                        worker_limit: 1,
                    },
                    PoolMember {
                        instance_id: "ginfer/remote/ready".into(),
                        worker_limit: 1,
                    },
                ],
            },
        )
        .expect("pool");
        let mut definition = definitions::general_agent();
        definition.role_assignments.insert(
            "agent".into(),
            RoleAssignment {
                target: WorkerTarget::Pool { id: pool.id },
                ..Default::default()
            },
        );
        let ready = HashSet::from(["ginfer/remote/ready"]);
        assert_eq!(
            select_ready_assigned_model(&definition, data.path(), &ready)
                .expect("ready pool member"),
            "ginfer/remote/ready"
        );
        assert!(select_ready_assigned_model(&definition, data.path(), &HashSet::new()).is_err());
    }

    #[test]
    fn worker_finish_does_not_finish_parent_or_clear_sibling_approval() {
        let run_id = format!("code-{}", Uuid::new_v4());
        lock_registry().unwrap().runs.insert(
            run_id.clone(),
            BridgeRun {
                run_id: run_id.clone(),
                definition_name: "Team".into(),
                status: "running".into(),
                stage: None,
                cycle: None,
                max_cycles: None,
                summary: None,
                result: None,
                artifacts: vec![],
                approvals: vec![],
                workspace: "/project".into(),
                updated_at_ms: 0,
                terminal_reason: None,
            },
        );
        observe(
            &run_id,
            &AgentEvent::StageActivity {
                stage_id: "one".into(),
                event: Box::new(AgentEvent::ApprovalRequested {
                    run_id: run_id.clone(),
                    approval_id: "approval-one".into(),
                    tool: "os.fs.write".into(),
                    reason: "edit".into(),
                    preview: json!({}),
                    affected_resources: vec![],
                    can_remember: false,
                }),
            },
        );
        observe(
            &run_id,
            &AgentEvent::StageActivity {
                stage_id: "two".into(),
                event: Box::new(AgentEvent::TurnFinished {
                    reason: "finish".into(),
                    step_count: 1,
                }),
            },
        );
        let state = lock_registry().unwrap();
        let run = state.runs.get(&run_id).unwrap();
        assert_eq!(run.status, "running");
        assert_eq!(run.approvals.len(), 1);
        assert!(run.terminal_reason.is_none());
    }
}

#[cfg(test)]
#[path = "code_bridge/integration_tests.rs"]
mod integration_tests;
