//! Scoped, local MCP access to the existing Agent Studio runtime for Code.

use std::{
    collections::{BTreeMap, HashMap},
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
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::oneshot;
use uuid::Uuid;

use super::{
    agent::{
        commands, definitions, runs, skills,
        types::{AgentEvent, AgentTurnRequest},
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

struct Session {
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
) -> Result<BridgeConnection, String> {
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
            default_model,
            connected: false,
            server: task,
        },
    );
    Ok(connection)
}

/// Release the endpoint when its Code terminal ends. Delegated runs remain app-owned.
pub fn close_session(session_id: &str) {
    if let Ok(mut state) = lock_registry() {
        if let Some(session) = state.sessions.remove(session_id) {
            session.server.abort();
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
    if request.uri().path() != format!("/mcp/{session_id}") {
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
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    let method = rpc.get("method").and_then(Value::as_str).unwrap_or("");
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
                json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"gchat-agent-studio","version":env!("CARGO_PKG_VERSION")},"instructions":"GChat skills and saved agents run in GChat's Agent Studio runtime, including worker-pool placement. Discover skills/agents, then delegate with gchat_start_run. For project edits, wait for a delegated run to finish before editing the same files in OpenCode. Use gchat_get_run to check progress without busy polling. Human approvals appear in GChat; OpenCode must not approve its own delegated actions."}),
            )
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools":tools()})),
        "tools/call" => Ok(
            match call_tool(
                &app,
                &project,
                &session_id,
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
fn tools() -> Vec<Value> {
    vec![
    tool("gchat_list_skills", "List enabled GChat skills. Skills needing GChat tools or scripts run through gchat_start_run.", json!({}), &[]),
    tool("gchat_read_skill", "Read instructions for an enabled GChat skill. To execute it with GChat tools, delegate through gchat_start_run.", json!({"name":{"type":"string"}}), &["name"]),
    tool("gchat_list_agents", "List saved GChat agents, Goal Loops, teams, and workflows with their worker-pool assignments.", json!({}), &[]),
    tool("gchat_start_run", "Start an asynchronous GChat Agent Studio run in this Code project. Saved worker-pool assignments apply. Use a stable requestId to make retries safe. Wait for project-writing runs before editing the same files. Human approvals are handled in GChat.", json!({"task":{"type":"string"},"requestId":{"type":"string"},"definitionId":{"type":"string"},"skillName":{"type":"string"},"modelId":{"type":"string","description":"Optional exact ready GChat model instance ID after switching models in Code"}}), &["task","requestId"]),
    tool("gchat_list_runs", "List delegated runs for this Code project, including runs from earlier Code sessions. Follow or cancel by runId.", json!({}), &[]),
    tool("gchat_get_run", "Get current status, progress, approval requests, result and artifacts for a delegated run. Poll only when useful; approvals require a human in GChat.", json!({"runId":{"type":"string"}}), &["runId"]),
    tool("gchat_cancel_run", "Cancel an active delegated GChat run.", json!({"runId":{"type":"string"}}), &["runId"]),
]
}

async fn call_tool<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    session_id: &str,
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
    let data = get_jan_data_folder_path(app.clone());
    let result = match name {
        "gchat_list_skills" => json!(skills::load_registry(&data)?
            .list_all()
            .into_iter()
            .filter(|entry| entry.enabled
                && entry.compatible
                && entry.unavailable_reasons.is_empty())
            .collect::<Vec<_>>()),
        "gchat_read_skill" => {
            let name = arg(&args, "name")?;
            let registry = skills::load_registry(&data)?;
            let record = registry
                .get_enabled(name)
                .ok_or_else(|| format!("Skill `{name}` is not enabled or available"))?;
            json!({"name":record.manifest.name,"description":record.manifest.description,"requiresTools":record.manifest.requires_tools,"requiresScripts":record.manifest.requires_scripts,"body":record.body,"execution":"delegate to GChat with gchat_start_run"})
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
            commands::agent_cancel_turn(app.state(), run_id.into()).await?;
            json!({"cancelled":true,"runId":run_id})
        }
        _ => return Err(format!("Unknown GChat tool `{name}`")),
    };
    Ok(json!({"content":[{"type":"text","text":result.to_string()}]}))
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

async fn select_model<R: Runtime>(
    app: &AppHandle<R>,
    definition: &definitions::AgentDefinition,
    data: &Path,
    selected_model: Option<String>,
) -> Result<String, String> {
    if let Some(id) = definition.model_instance_id.as_ref() {
        return Ok(id.clone());
    }
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
        for assignment in definition.role_assignments.values() {
            match &assignment.target {
                super::agent::worker_pools::WorkerTarget::Instance { id } => return Ok(id.clone()),
                super::agent::worker_pools::WorkerTarget::Pool { id } => {
                    if let Some(pool) = super::agent::worker_pools::list(data)?
                        .into_iter()
                        .find(|pool| &pool.id == id)
                    {
                        if let Some(member) = pool.members.first() {
                            return Ok(member.instance_id.clone());
                        }
                    }
                }
                super::agent::worker_pools::WorkerTarget::Current => {}
            }
        }
        return Err("An assigned worker pool has no model instances".into());
    }
    let instances = commands::agent_list_model_instances(app.state()).await?;
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

async fn start_run<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    session_id: &str,
    args: &Value,
) -> Result<Value, String> {
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
        if skills::load_registry(&data)?.get_enabled(name).is_none() {
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
        external_roots: vec![],
        max_steps: None,
        auto_approve: false,
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
    pub detail: Option<String>,
}
#[tauri::command]
pub async fn opencode_bridge_status<R: Runtime>(app: AppHandle<R>) -> Result<BridgeStatus, String> {
    let data = get_jan_data_folder_path(app);
    Ok(BridgeStatus {
        connected: lock_registry()?
            .sessions
            .values()
            .any(|session| session.connected),
        skill_count: skills::load_registry(&data)?.enabled().count(),
        agent_count: definitions::list_definitions(&data)?.len(),
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
    commands::agent_cancel_turn(state, run_id).await
}

pub async fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let (active, mut tasks) = match lock_registry() {
        Ok(mut state) => {
            state.shutting_down = true;
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
        let connection = prepare_session(app.handle(), project.path(), None).expect("bridge");
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

    #[tokio::test]
    async fn fully_pool_assigned_agent_keeps_its_saved_placement_without_a_code_model() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock GChat");
        let data = tempfile::tempdir().expect("data");
        let pool = super::super::agent::worker_pools::save(
            data.path(),
            WorkerPool {
                id: String::new(),
                name: "Review workers".into(),
                members: vec![PoolMember {
                    instance_id: "ginfer/remote/review".into(),
                    worker_limit: 1,
                }],
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
        let selected = select_model(app.handle(), &definition, data.path(), None)
            .await
            .expect("pool model");
        assert_eq!(selected, "ginfer/remote/review");
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
