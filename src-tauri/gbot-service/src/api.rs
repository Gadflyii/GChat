use std::{convert::Infallible, future::Future, net::SocketAddr, sync::Arc};

use hyper::{
    header::{AUTHORIZATION, CONTENT_TYPE, WWW_AUTHENTICATE},
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    connectors::{BotConnectorAccounts, ConnectorHost},
    contract::{GuestRequest, SessionIdentity, WorkspaceConfig, WorkspaceId},
    executor::{Assignment, ExecutorProcesses},
    media::{CloseView, OpenView},
    service::{Service, ServiceError, SshWorkspaceCreationError},
    ssh::SshError,
    tasks::{TaskRunner, TaskRunnerError},
    vault::{Secret, Vault, VaultError},
    workspace::{CreateSshWorkspace, WorkspaceError, WorkspaceRuntime},
};

#[derive(Debug)]
pub enum ApiError {
    Vault(VaultError),
    Listener(std::io::Error),
    Http(hyper::Error),
    Workspace(WorkspaceError),
    Tasks(TaskRunnerError),
    #[cfg(target_os = "linux")]
    Setup(crate::kvm_setup::SetupIssue),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Vault(error) => write!(formatter, "Gbot secure storage: {error}"),
            Self::Listener(_) => formatter.write_str("Gbot loopback listener is unavailable"),
            Self::Http(_) => formatter.write_str("Gbot HTTP service could not complete"),
            Self::Workspace(error) => error.fmt(formatter),
            Self::Tasks(error) => error.fmt(formatter),
            #[cfg(target_os = "linux")]
            Self::Setup(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ApiError {}

pub struct Api {
    service: Arc<Service>,
    token: Arc<Secret>,
    listener: std::net::TcpListener,
    endpoint: SocketAddr,
    runtime: Arc<WorkspaceRuntime>,
    tasks: Option<Arc<TaskRunner>>,
}

#[derive(Clone)]
pub struct ApiClient {
    service: Arc<Service>,
    token: Arc<Secret>,
    runtime: Arc<WorkspaceRuntime>,
    tasks: Option<Arc<TaskRunner>>,
}

impl ApiClient {
    #[cfg(target_os = "linux")]
    pub fn subscribe_setup(&self) -> Option<tokio::sync::watch::Receiver<u64>> {
        self.runtime.kvm_setup().map(|setup| setup.subscribe())
    }

    pub fn subscribe_tasks(&self) -> Option<tokio::sync::watch::Receiver<u64>> {
        self.tasks.as_ref().map(|tasks| tasks.subscribe())
    }
    /// Native clients retain the authentication secret outside the webview.
    pub async fn call(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if matches!(path, "/v1/tasks/start" | "/v1/tasks/resume")
            && body.get("assignment").is_some()
        {
            return Err("Bot tasks use this bot's saved model assignment".into());
        }
        let method = if matches!(
            path,
            "/v1/state" | "/v1/tasks" | "/v1/tasks/approvals" | "/v1/schedules"
        ) {
            Method::GET
        } else {
            Method::POST
        };
        let token = std::str::from_utf8(self.token.expose_secret())
            .map_err(|_| "Invalid service credential")?;
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(
                serde_json::to_vec(&body).map_err(|_| "Invalid request")?,
            ))
            .map_err(|_| "Invalid service request")?;
        let response = route(
            self.service.clone(),
            self.runtime.clone(),
            self.tasks.clone(),
            self.token.clone(),
            request,
        )
        .await
        .unwrap();
        let status = response.status();
        let bytes = hyper::body::to_bytes(response.into_body())
            .await
            .map_err(|_| "Service response unavailable")?;
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid service response")?;
        if status.is_success() {
            Ok(value)
        } else {
            let message = value["error"]["message"]
                .as_str()
                .unwrap_or("Gbot request failed");
            let action = value["error"]["next_action"].as_str().unwrap_or("");
            Err(format!("{message} {action}").trim().to_string())
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StartTask {
    identity: SessionIdentity,
    prompt: String,
    assignment: Option<Assignment>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResumeTask {
    id: Uuid,
    assignment: Option<Assignment>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveAssignment {
    pub workspace_id: WorkspaceId,
    pub api_base: String,
    pub model: String,
    pub context_tokens: u64,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GetAssignment {
    pub workspace_id: WorkspaceId,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskId {
    id: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApprovalDecision {
    id: Uuid,
    allow: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HelpReply {
    id: Uuid,
    request_id: Uuid,
    response: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SshKeyImportRequest {
    private_key: String,
    passphrase: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlRequest {
    identity: SessionIdentity,
    owner: Uuid,
}

impl Api {
    pub async fn bind(
        service: Arc<Service>,
        vault: Arc<dyn Vault>,
        port: u16,
    ) -> Result<Self, ApiError> {
        Self::bind_with_connector_host(service, vault, port, None).await
    }

    pub async fn bind_with_connectors(
        service: Arc<Service>,
        vault: Arc<dyn Vault>,
        port: u16,
        connectors: Arc<dyn ConnectorHost>,
    ) -> Result<Self, ApiError> {
        Self::bind_with_connector_host(service, vault, port, Some(connectors)).await
    }

    async fn bind_with_connector_host(
        service: Arc<Service>,
        vault: Arc<dyn Vault>,
        port: u16,
        connectors: Option<Arc<dyn ConnectorHost>>,
    ) -> Result<Self, ApiError> {
        let reference = service.snapshot().await.service_id;
        let token = match vault.get(reference).await.map_err(ApiError::Vault)? {
            Some(secret) => secret,
            None => {
                let secret = Secret::new(
                    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()).into_bytes(),
                );
                vault
                    .put(reference, Secret::new(secret.expose_secret().to_vec()))
                    .await
                    .map_err(ApiError::Vault)?;
                secret
            }
        };
        if token.expose_secret().is_empty()
            || !token
                .expose_secret()
                .iter()
                .all(|byte| byte.is_ascii_graphic())
        {
            return Err(ApiError::Vault(VaultError::InvalidData));
        }
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .map_err(ApiError::Listener)?;
        listener.set_nonblocking(true).map_err(ApiError::Listener)?;
        let endpoint = listener.local_addr().map_err(ApiError::Listener)?;
        let mut runtime = WorkspaceRuntime::new(service.clone(), vault);
        if let Some(connectors) = connectors {
            runtime = runtime.with_connectors(connectors);
        }
        Ok(Self {
            runtime: Arc::new(runtime),
            service,
            token: Arc::new(token),
            listener,
            endpoint,
            tasks: None,
        })
    }

    #[cfg(target_os = "linux")]
    pub async fn with_kvm_setup(self, root: std::path::PathBuf) -> Result<Self, ApiError> {
        self.runtime
            .configure_kvm_setup(root)
            .await
            .map_err(ApiError::Setup)?;
        Ok(self)
    }

    pub async fn with_executor(
        mut self,
        root: std::path::PathBuf,
        processes: ExecutorProcesses,
    ) -> Result<Self, ApiError> {
        self.tasks = Some(Arc::new(
            TaskRunner::new(root, self.runtime.clone(), processes)
                .await
                .map_err(ApiError::Tasks)?,
        ));
        Ok(self)
    }

    pub fn client(&self) -> ApiClient {
        ApiClient {
            service: self.service.clone(),
            token: self.token.clone(),
            runtime: self.runtime.clone(),
            tasks: self.tasks.clone(),
        }
    }

    pub fn endpoint(&self) -> SocketAddr {
        self.endpoint
    }

    pub async fn serve(
        self,
        shutdown: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), ApiError> {
        let (explicit_stop, mut explicit_stopped) = tokio::sync::watch::channel(false);
        let service = self.service;
        let token = self.token;
        let runtime = self.runtime;
        let tasks = self.tasks;
        let routing_tasks = tasks.clone();
        let stopping_tasks = tasks.clone();
        let routing_runtime = runtime.clone();
        let stopping_runtime = runtime.clone();
        let (stop_schedules, mut schedules_stopped) = tokio::sync::watch::channel(false);
        let schedule_tasks = tasks.clone();
        let schedule_service = service.clone();
        let schedule_runtime = runtime.clone();
        let scheduler = tokio::spawn(async move {
            if let Some(tasks) = schedule_tasks {
                let mut wake = tokio::time::interval(std::time::Duration::from_secs(1));
                wake.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        biased;
                        _ = schedules_stopped.changed() => break,
                        _ = wake.tick() => {
                            let result = tokio::select! {
                                biased;
                                _ = schedules_stopped.changed() => break,
                                result = tasks.schedules.tick(crate::schedules::now(), &tasks, &schedule_service, &schedule_runtime) => result,
                            };
                            if let Err(error) = result {
                                eprintln!("Gbot scheduler stopped: {error}");
                                tasks.schedules.mark_stopped(error.to_string()).await;
                                tasks.notify();
                                break;
                            }
                        }
                    }
                }
            }
        });
        let stopping_scheduler = stop_schedules.clone();
        let (stopped, mut stop_result) = tokio::sync::oneshot::channel();
        let serving = hyper::Server::from_tcp(self.listener)
            .map_err(ApiError::Http)?
            .serve(make_service_fn(move |_| {
                let service = service.clone();
                let token = token.clone();
                let runtime = routing_runtime.clone();
                let tasks = routing_tasks.clone();
                let explicit_stop = explicit_stop.clone();
                async move {
                    Ok::<_, Infallible>(service_fn(move |request| {
                        service_route(
                            service.clone(),
                            runtime.clone(),
                            tasks.clone(),
                            token.clone(),
                            explicit_stop.clone(),
                            request,
                        )
                    }))
                }
            }))
            .with_graceful_shutdown(async move {
                tokio::select! { _ = shutdown => {}, _ = explicit_stopped.changed() => {} }
                stopping_scheduler.send_replace(true);
                let task_result = match stopping_tasks {
                    Some(tasks) => tasks.close().await,
                    None => Ok(()),
                };
                let workspace_result = stopping_runtime.close().await;
                let _ = stopped.send((task_result, workspace_result));
            })
            .await;
        stop_schedules.send_replace(true);
        let _ = scheduler.await;
        let cleanup = match stop_result.try_recv() {
            Ok(result) => result,
            Err(_) => {
                let task_result = match tasks {
                    Some(tasks) => tasks.close().await,
                    None => Ok(()),
                };
                (task_result, runtime.close().await)
            }
        };
        cleanup.1.map_err(ApiError::Workspace)?;
        cleanup.0.map_err(ApiError::Tasks)?;
        serving.map_err(ApiError::Http)
    }
}

fn authorized(request: &Request<Body>, token: &Secret) -> bool {
    let mut headers = request.headers().get_all(AUTHORIZATION).iter();
    let Some(header) = headers.next() else {
        return false;
    };
    if headers.next().is_some() {
        return false;
    }
    let Some(provided) = header.as_bytes().strip_prefix(b"Bearer ") else {
        return false;
    };
    let expected = token.expose_secret();
    if provided.len() != expected.len() {
        return false;
    }
    provided
        .iter()
        .zip(expected)
        .fold(0, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn json_response(status: StatusCode, value: &impl Serialize) -> Response<Body> {
    let (status, bytes) = match serde_json::to_vec(value) {
        Ok(bytes) => (status, bytes),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            br#"{"error":{"code":"serialization_failed","message":"State could not be returned"}}"#
                .to_vec(),
        ),
    };
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        hyper::header::HeaderValue::from_static("application/json"),
    );
    response
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response<Body> {
    json_response(
        status,
        &serde_json::json!({"error": {"code": code, "message": message}}),
    )
}

async fn setup_route(runtime: Arc<WorkspaceRuntime>, request: Request<Body>) -> Response<Body> {
    #[cfg(target_os = "linux")]
    {
        let Some(setup) = runtime.kvm_setup() else {
            return error_response(StatusCode::SERVICE_UNAVAILABLE, "setup_unavailable", "Local VM setup is not enabled in this service. Reopen GChat with its local service enabled.");
        };
        match request.uri().path() {
            "/v1/setup/kvm/preflight" => json_response(StatusCode::OK, &setup.preflight().await),
            "/v1/setup/kvm/status" => json_response(StatusCode::OK, &setup.status().await),
            "/v1/setup/kvm/start" => {
                match parse_body::<crate::kvm_setup::StartSetup>(request).await {
                    Some(input) => match setup.start(input).await {
                        Ok(record) => json_response(StatusCode::OK, &record),
                        Err(issue) => {
                            json_response(StatusCode::CONFLICT, &serde_json::json!({"error":issue}))
                        }
                    },
                    None => invalid_request(),
                }
            }
            "/v1/setup/kvm/remove" => {
                match parse_body::<crate::kvm_setup::SetupId>(request).await {
                    Some(input) => match setup.remove(input.id).await {
                        Ok(record) => json_response(StatusCode::OK, &record),
                        Err(issue) => {
                            json_response(StatusCode::CONFLICT, &serde_json::json!({"error":issue}))
                        }
                    },
                    None => invalid_request(),
                }
            }
            _ => invalid_request(),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (runtime, request);
        error_response(
            StatusCode::NOT_IMPLEMENTED,
            "unsupported_host",
            "Local KVM setup requires Linux x86-64. Hyper-V setup is unfinished.",
        )
    }
}

async fn service_route(
    service: Arc<Service>,
    runtime: Arc<WorkspaceRuntime>,
    tasks: Option<Arc<TaskRunner>>,
    token: Arc<Secret>,
    stop: tokio::sync::watch::Sender<bool>,
    request: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    if request.method() == Method::POST
        && request.uri().path() == "/v1/service/shutdown"
        && authorized(&request, &token)
    {
        stop.send_replace(true);
        return Ok(json_response(
            StatusCode::OK,
            &serde_json::json!({"stopping": true}),
        ));
    }
    let mut stopped = stop.subscribe();
    if request.uri().path() == "/v1/updates" && authorized(&request, &token) {
        if *stopped.borrow() {
            return Ok(json_response(
                StatusCode::OK,
                &serde_json::json!({"stopping":true}),
            ));
        }
        tokio::select! {
            result = route(service, runtime, tasks, token, request) => result,
            _ = stopped.changed() => Ok(json_response(StatusCode::OK, &serde_json::json!({"stopping":true}))),
        }
    } else {
        route(service, runtime, tasks, token, request).await
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateRevision {
    tasks: u64,
    setup: u64,
}

async fn wait_updates(
    runtime: &WorkspaceRuntime,
    tasks: Option<&TaskRunner>,
    revision: UpdateRevision,
) -> Response<Body> {
    let mut task_updates = tasks.map(TaskRunner::subscribe);
    #[cfg(target_os = "linux")]
    let mut setup_updates = runtime.kvm_setup().map(|setup| setup.subscribe());
    #[cfg(not(target_os = "linux"))]
    let mut setup_updates: Option<tokio::sync::watch::Receiver<u64>> = None;
    #[cfg(not(target_os = "linux"))]
    let _ = runtime;
    let task_revision = task_updates
        .as_mut()
        .map(|updates| *updates.borrow_and_update())
        .unwrap_or(0);
    let setup_revision = setup_updates
        .as_mut()
        .map(|updates| *updates.borrow_and_update())
        .unwrap_or(0);
    if task_revision == revision.tasks && setup_revision == revision.setup {
        async fn changed(updates: &mut Option<tokio::sync::watch::Receiver<u64>>) {
            match updates {
                Some(updates) => {
                    let _ = updates.changed().await;
                }
                None => std::future::pending::<()>().await,
            }
        }
        tokio::select! {
            _ = changed(&mut task_updates) => {},
            _ = changed(&mut setup_updates) => {},
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {},
        }
    }
    json_response(
        StatusCode::OK,
        &serde_json::json!({
            "tasks": task_updates.as_ref().map(|updates| *updates.borrow()).unwrap_or(0),
            "setup": setup_updates.as_ref().map(|updates| *updates.borrow()).unwrap_or(0),
        }),
    )
}

async fn route(
    service: Arc<Service>,
    runtime: Arc<WorkspaceRuntime>,
    tasks: Option<Arc<TaskRunner>>,
    token: Arc<Secret>,
    request: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    if !authorized(&request, &token) {
        let mut response = error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Gbot authentication is required",
        );
        response.headers_mut().insert(
            WWW_AUTHENTICATE,
            hyper::header::HeaderValue::from_static("Bearer"),
        );
        return Ok(response);
    }
    let native_operation = request
        .uri()
        .path()
        .strip_prefix("/v1/native/connectors/")
        .map(str::to_owned);
    if request.method() == Method::POST {
        if let Some(operation) = native_operation {
            return Ok(match parse_body::<serde_json::Value>(request).await {
                Some(arguments) => match runtime
                    .native_connector_operation(&operation, arguments)
                    .await
                {
                    Ok(value) => json_response(StatusCode::OK, &value),
                    Err(message) => {
                        error_response(StatusCode::BAD_REQUEST, "connector_error", &message)
                    }
                },
                None => invalid_request(),
            });
        }
    }
    let response = match (request.method(), request.uri().path()) {
        (&Method::POST, "/v1/updates") => match parse_body::<UpdateRevision>(request).await {
            Some(revision) => wait_updates(&runtime, tasks.as_deref(), revision).await,
            None => invalid_request(),
        },
        (&Method::GET, "/v1/schedules") => match tasks {
            Some(tasks) => json_response(StatusCode::OK, &tasks.schedules.list_for_client().await),
            None => executor_unavailable(),
        },
        (&Method::POST, "/v1/schedules/create") => match (
            tasks,
            parse_body::<crate::schedules::CreateSchedule>(request).await,
        ) {
            (Some(tasks), Some(input)) => {
                match service.model_assignment(input.workspace_id).await {
                    Ok(Some(assignment)) => match tasks.schedules.create(input, assignment).await {
                        Ok(schedule) => {
                            tasks.notify();
                            json_response(StatusCode::OK, &schedule)
                        }
                        Err(error) => schedule_error(error),
                    },
                    Ok(None) => workspace_error(ServiceError::AssignmentNotFound.into()),
                    Err(error) => workspace_error(error.into()),
                }
            }
            (None, _) => executor_unavailable(),
            _ => invalid_request(),
        },
        (&Method::POST, "/v1/schedules/enabled") => match (
            tasks,
            parse_body::<crate::schedules::SetEnabled>(request).await,
        ) {
            (Some(tasks), Some(input)) => match tasks.schedules.set_enabled(input).await {
                Ok(schedule) => {
                    tasks.notify();
                    json_response(StatusCode::OK, &schedule)
                }
                Err(error) => schedule_error(error),
            },
            (None, _) => executor_unavailable(),
            _ => invalid_request(),
        },
        (
            &Method::POST,
            "/v1/setup/kvm/preflight"
            | "/v1/setup/kvm/status"
            | "/v1/setup/kvm/start"
            | "/v1/setup/kvm/remove",
        ) => setup_route(runtime, request).await,

        (&Method::POST, "/v1/connectors/get") => match parse_body::<GetAssignment>(request).await {
            Some(input) => match runtime.bot_connectors(input.workspace_id).await {
                Ok(settings) => json_response(StatusCode::OK, &settings),
                Err(error) => workspace_error(error),
            },
            None => invalid_request(),
        },
        (&Method::POST, "/v1/connectors/save") => {
            match parse_body::<BotConnectorAccounts>(request).await {
                Some(input) => match runtime.save_bot_connectors(input).await {
                    Ok(settings) => json_response(StatusCode::OK, &settings),
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/assignments/save") => {
            match parse_body::<SaveAssignment>(request).await {
                Some(input) => match runtime
                    .save_model_assignment(
                        input.workspace_id,
                        Assignment {
                            api_base: input.api_base,
                            api_key: input.api_key,
                            model: input.model,
                            context_tokens: input.context_tokens,
                        },
                    )
                    .await
                {
                    Ok(saved) => json_response(StatusCode::OK, &saved),
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/assignments/get") => {
            match parse_body::<GetAssignment>(request).await {
                Some(input) => match runtime.model_assignment(input.workspace_id).await {
                    Ok(saved) => json_response(StatusCode::OK, &saved),
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::GET, "/v1/tasks") => match tasks {
            Some(tasks) => task_result(tasks.list().await),
            None => executor_unavailable(),
        },
        (&Method::GET, "/v1/tasks/approvals") => match tasks {
            Some(tasks) => task_result(tasks.approvals().await),
            None => executor_unavailable(),
        },
        (&Method::POST, "/v1/tasks/start") => match (tasks, parse_body::<StartTask>(request).await)
        {
            (Some(tasks), Some(input)) => task_result(
                tasks
                    .start(input.identity, input.prompt, input.assignment)
                    .await,
            ),
            (None, _) => executor_unavailable(),
            _ => invalid_request(),
        },
        (&Method::POST, "/v1/tasks/resume") => {
            match (tasks, parse_body::<ResumeTask>(request).await) {
                (Some(tasks), Some(input)) => {
                    task_result(tasks.resume(input.id, input.assignment).await)
                }
                (None, _) => executor_unavailable(),
                _ => invalid_request(),
            }
        }
        (&Method::POST, "/v1/tasks/cancel") => match (tasks, parse_body::<TaskId>(request).await) {
            (Some(tasks), Some(input)) => task_result(tasks.cancel(input.id).await),
            (None, _) => executor_unavailable(),
            _ => invalid_request(),
        },
        (&Method::POST, "/v1/tasks/approval") => {
            match (tasks, parse_body::<ApprovalDecision>(request).await) {
                (Some(tasks), Some(input)) => {
                    task_result(tasks.decide(input.id, input.allow).await)
                }
                (None, _) => executor_unavailable(),
                _ => invalid_request(),
            }
        }
        (&Method::POST, "/v1/tasks/help") => {
            match (tasks, parse_body::<HelpReply>(request).await) {
                (Some(tasks), Some(input)) => task_result(
                    tasks
                        .answer_help(input.id, input.request_id, input.response)
                        .await,
                ),
                (None, _) => executor_unavailable(),
                _ => invalid_request(),
            }
        }
        (&Method::GET, "/v1/state") => {
            let mut state =
                serde_json::to_value(service.snapshot().await).expect("Gbot state is serializable");
            state["live_sessions"] = serde_json::to_value(service.live_sessions().await)
                .expect("session identities are serializable");
            json_response(StatusCode::OK, &state)
        }
        (&Method::POST, "/v1/workspaces/ssh") => {
            match parse_body::<CreateSshWorkspace>(request).await {
                Some(input) => match runtime.create_ssh_workspace(input).await {
                    Ok(config) => json_response(StatusCode::CREATED, &config),
                    Err(error) => ssh_workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/credentials/ssh") => {
            match parse_body::<SshKeyImportRequest>(request).await {
                Some(import) => match runtime
                    .import_ssh_key(
                        Secret::new(import.private_key.into_bytes()),
                        import
                            .passphrase
                            .map(|value| Secret::new(value.into_bytes())),
                    )
                    .await
                {
                    Ok(imported) => json_response(StatusCode::CREATED, &imported),
                    Err(error) => key_import_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/workspaces") => {
            let config = match hyper::body::to_bytes(request.into_body()).await {
                Ok(bytes) => serde_json::from_slice::<WorkspaceConfig>(&bytes).ok(),
                Err(_) => None,
            };
            match config {
                Some(config) => match runtime.register_workspace(config).await {
                    Ok(()) => json_response(StatusCode::CREATED, &service.snapshot().await),
                    Err(WorkspaceError::State(ServiceError::Contract(_))) => error_response(
                        StatusCode::BAD_REQUEST,
                        "invalid_workspace",
                        "Workspace configuration is invalid",
                    ),
                    Err(WorkspaceError::State(ServiceError::WorkspaceInUse)) => error_response(
                        StatusCode::CONFLICT,
                        "workspace_in_use",
                        "Workspace has a live session or unresolved operation",
                    ),
                    Err(_) => error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "workspace_not_saved",
                        "Workspace could not be saved",
                    ),
                },
                _ => error_response(
                    StatusCode::BAD_REQUEST,
                    "invalid_workspace",
                    "Workspace configuration is invalid",
                ),
            }
        }
        (&Method::POST, "/v1/desktop/tools") => {
            match parse_body::<SessionIdentity>(request).await {
                Some(identity) => match runtime.desktop_tools(identity).await {
                    Ok(tools) => json_response(StatusCode::OK, &tools),
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/operations") => match parse_body::<GuestRequest>(request).await {
            Some(operation) => match runtime.request(operation).await {
                Ok(reply) => json_response(StatusCode::OK, &reply),
                Err(error) => workspace_error(error),
            },
            None => invalid_request(),
        },
        (&Method::POST, "/v1/control/take-over" | "/v1/control/hand-back") => {
            let take_over = request.uri().path() == "/v1/control/take-over";
            match parse_body::<ControlRequest>(request).await {
                Some(control) if take_over => {
                    match runtime.take_over(control.identity, control.owner).await {
                        Ok(control) => {
                            if let Some(tasks) = &tasks {
                                if let Err(error) = tasks.pause(control.identity).await {
                                    return Ok(task_result::<()>(Err(error)));
                                }
                            }
                            let current = service
                                .snapshot()
                                .await
                                .controls
                                .into_iter()
                                .find(|value| value.identity == control.identity)
                                .unwrap_or(control);
                            json_response(StatusCode::OK, &current)
                        }
                        Err(error) => workspace_error(error),
                    }
                }
                Some(control) => match runtime.hand_back(control.identity, control.owner).await {
                    Ok(result) => json_response(StatusCode::OK, &result),
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        (&Method::POST, "/v1/view/open") => match parse_body::<OpenView>(request).await {
            Some(view) => match runtime.open_view(view).await {
                Ok(ticket) => json_response(StatusCode::OK, &ticket),
                Err(error) => workspace_error(error),
            },
            None => invalid_request(),
        },
        (&Method::POST, "/v1/view/close") => match parse_body::<CloseView>(request).await {
            Some(view) => match runtime.close_view(view).await {
                Ok(()) => json_response(StatusCode::OK, &serde_json::json!({"closed":true})),
                Err(error) => workspace_error(error),
            },
            None => invalid_request(),
        },
        (&Method::POST, "/v1/connect" | "/v1/disconnect") => {
            let connect = request.uri().path() == "/v1/connect";
            match parse_body::<SessionIdentity>(request).await {
                Some(identity) if connect => match runtime.connect(identity).await {
                    Ok(hello) => json_response(StatusCode::OK, &hello),
                    Err(error) => workspace_error(error),
                },
                Some(identity) => match runtime.disconnect(identity).await {
                    Ok(()) => {
                        json_response(StatusCode::OK, &serde_json::json!({"identity":identity}))
                    }
                    Err(error) => workspace_error(error),
                },
                None => invalid_request(),
            }
        }
        _ => error_response(
            StatusCode::NOT_FOUND,
            "not_found",
            "Gbot route was not found",
        ),
    };
    Ok(response)
}

async fn parse_body<T: serde::de::DeserializeOwned>(request: Request<Body>) -> Option<T> {
    match hyper::body::to_bytes(request.into_body()).await {
        Ok(bytes) => serde_json::from_slice(&bytes).ok(),
        Err(_) => None,
    }
}

fn invalid_request() -> Response<Body> {
    error_response(
        StatusCode::BAD_REQUEST,
        "invalid_request",
        "Gbot request is invalid",
    )
}

fn executor_unavailable() -> Response<Body> {
    error_response(StatusCode::SERVICE_UNAVAILABLE, "executor_unavailable", "Configure the pinned Cua Python runtime and shared context preparer before running a bot task")
}

fn task_result<T: Serialize>(result: Result<T, TaskRunnerError>) -> Response<Body> {
    match result {
        Ok(value) => json_response(StatusCode::OK, &value),
        Err(TaskRunnerError::Workspace(error)) => workspace_error(error),
        Err(error) => {
            let status = match &error {
                TaskRunnerError::NotFound => StatusCode::NOT_FOUND,
                TaskRunnerError::InvalidPrompt => StatusCode::BAD_REQUEST,
                TaskRunnerError::AlreadyRunning => StatusCode::CONFLICT,
                TaskRunnerError::Executor(crate::executor::ExecutorError::InvalidMessage) => {
                    StatusCode::CONFLICT
                }
                TaskRunnerError::Closed => StatusCode::SERVICE_UNAVAILABLE,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            error_response(status, "task_failed", &error.to_string())
        }
    }
}

fn schedule_error(error: WorkspaceError) -> Response<Body> {
    match error {
        WorkspaceError::NotFound => error_response(
            StatusCode::NOT_FOUND,
            "schedule_not_found",
            "Schedule not found",
        ),
        WorkspaceError::State(ServiceError::InvalidState) => error_response(
            StatusCode::BAD_REQUEST,
            "invalid_schedule",
            "Enter a nonempty prompt, a UTC start time and a positive interval",
        ),
        _ => workspace_error(error),
    }
}

fn workspace_error(error: WorkspaceError) -> Response<Body> {
    let (status, code) = match &error {
        WorkspaceError::NotFound | WorkspaceError::State(ServiceError::WorkspaceNotFound) => {
            (StatusCode::NOT_FOUND, "workspace_not_found")
        }
        WorkspaceError::State(ServiceError::InvalidAssignment) => {
            (StatusCode::BAD_REQUEST, "invalid_assignment")
        }
        WorkspaceError::State(ServiceError::AssignmentNotFound) => {
            (StatusCode::CONFLICT, "assignment_not_found")
        }
        WorkspaceError::SetupIncomplete => (StatusCode::CONFLICT, "computer_setup_incomplete"),
        WorkspaceError::Vault(_) => (StatusCode::SERVICE_UNAVAILABLE, "model_vault_unavailable"),
        WorkspaceError::CredentialCleanup(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "assignment_credential_cleanup_pending",
        ),
        WorkspaceError::State(ServiceError::Contract(_)) => {
            (StatusCode::BAD_REQUEST, "invalid_guest_request")
        }
        WorkspaceError::State(ServiceError::Persistence) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "state_not_saved")
        }
        WorkspaceError::State(ServiceError::BotPaused) => (StatusCode::CONFLICT, "bot_paused"),
        WorkspaceError::State(ServiceError::ControlOwner) => {
            (StatusCode::CONFLICT, "control_owner")
        }
        WorkspaceError::Media(_) => (StatusCode::BAD_GATEWAY, "desktop_media_unavailable"),
        WorkspaceError::Transport(_) => (StatusCode::BAD_GATEWAY, "guest_connection_failed"),
        WorkspaceError::AdapterUnavailable | WorkspaceError::ServiceLocationUnavailable => {
            (StatusCode::NOT_IMPLEMENTED, "adapter_unavailable")
        }
        WorkspaceError::ShuttingDown => (StatusCode::SERVICE_UNAVAILABLE, "service_stopping"),
        WorkspaceError::Connector(_) => (StatusCode::BAD_REQUEST, "connector_unavailable"),
        _ => (StatusCode::CONFLICT, "guest_state_conflict"),
    };
    error_response(status, code, &error.to_string())
}

fn ssh_workspace_error(error: WorkspaceError) -> Response<Body> {
    let (status, code) = match &error {
        WorkspaceError::State(ServiceError::Contract(_)) => {
            (StatusCode::BAD_REQUEST, "invalid_workspace")
        }
        WorkspaceError::Creation(SshWorkspaceCreationError::State(
            ServiceError::WorkspaceConflict,
        )) => (StatusCode::CONFLICT, "workspace_creation_conflict"),
        WorkspaceError::Creation(SshWorkspaceCreationError::State(_)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "workspace_not_saved")
        }
        WorkspaceError::Creation(SshWorkspaceCreationError::Vault(_)) => {
            (StatusCode::SERVICE_UNAVAILABLE, "ssh_vault_unavailable")
        }
        WorkspaceError::Creation(SshWorkspaceCreationError::Cleanup(_)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "ssh_credential_cleanup_pending",
        ),
        WorkspaceError::Creation(SshWorkspaceCreationError::SavedDurabilityUnconfirmed) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "workspace_saved_durability_unconfirmed",
        ),
        WorkspaceError::Creation(SshWorkspaceCreationError::PersistenceUncertain) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "workspace_save_unconfirmed",
        ),
        _ => return key_import_error(error),
    };
    error_response(status, code, &error.to_string())
}

fn key_import_error(error: WorkspaceError) -> Response<Body> {
    let (status, code) = match &error {
        WorkspaceError::Transport(SshError::PassphraseRequired) => {
            (StatusCode::UNPROCESSABLE_ENTITY, "ssh_passphrase_required")
        }
        WorkspaceError::Transport(SshError::InvalidPassphrase) => {
            (StatusCode::UNPROCESSABLE_ENTITY, "ssh_invalid_passphrase")
        }
        WorkspaceError::Transport(
            SshError::InvalidCredential | SshError::UnsupportedCredentialAlgorithm,
        ) => (StatusCode::BAD_REQUEST, "ssh_invalid_key"),
        WorkspaceError::Transport(SshError::Vault(_)) => {
            (StatusCode::SERVICE_UNAVAILABLE, "ssh_vault_unavailable")
        }
        WorkspaceError::Transport(SshError::ImportFailed) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "ssh_import_failed")
        }
        _ => return workspace_error(error),
    };
    error_response(status, code, &error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        contract::{
            BotPc, Hypervisor, ServicePc, SshConnection, SshEndpoint, SshHostPublicKey,
            VaultCredentialRef, WorkspaceConnection, WorkspaceId,
        },
        vault::VaultFuture,
    };
    use std::{
        collections::BTreeMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
        time::Duration,
    };

    #[derive(Default)]
    struct MemoryVault(Mutex<BTreeMap<Uuid, Vec<u8>>>, AtomicBool, AtomicBool);

    impl Vault for MemoryVault {
        fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>> {
            Box::pin(async move {
                Ok(self
                    .0
                    .lock()
                    .unwrap()
                    .get(&reference)
                    .cloned()
                    .map(Secret::new))
            })
        }

        fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                if self.1.load(Ordering::Acquire) {
                    return Err(VaultError::AccessDenied);
                }
                self.0
                    .lock()
                    .unwrap()
                    .insert(reference, secret.expose_secret().to_vec());
                Ok(())
            })
        }

        fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                if self.2.load(Ordering::Acquire) {
                    return Err(VaultError::AccessDenied);
                }
                self.0.lock().unwrap().remove(&reference);
                Ok(())
            })
        }
    }

    struct LockedVault(bool);

    #[tokio::test]
    async fn unfinished_computer_returns_a_typed_conflict() {
        let response = workspace_error(WorkspaceError::SetupIncomplete);
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body: serde_json::Value =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        assert_eq!(body["error"]["code"], "computer_setup_incomplete");
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("resume computer setup"));
    }

    impl Vault for LockedVault {
        fn get(&self, _: Uuid) -> VaultFuture<'_, Option<Secret>> {
            Box::pin(async move {
                if self.0 {
                    Ok(None)
                } else {
                    Err(VaultError::AccessDenied)
                }
            })
        }

        fn put(&self, _: Uuid, _: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async { Err(VaultError::AccessDenied) })
        }

        fn delete(&self, _: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async { Err(VaultError::AccessDenied) })
        }
    }

    fn ssh_workspace_request() -> serde_json::Value {
        use russh::keys::{ssh_key::LineEnding, Algorithm, PrivateKey};
        let private =
            PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519).unwrap();
        let public = private.public_key().to_openssh().unwrap();
        let (algorithm, public_key) = public.split_once(' ').unwrap();
        serde_json::json!({
            "id": WorkspaceId::new(), "name": "Dedicated bot",
            "service_pc": {"kind": "local"},
            "bot_pc": {"kind": "lan", "computer_id": Uuid::new_v4()},
            "endpoint": {"hostname": "bot.local", "port": 22, "user": "bot"},
            "pinned_host_key": {"algorithm": algorithm, "public_key": public_key},
            "private_key": private.to_openssh(LineEnding::LF).unwrap().as_str(),
            "passphrase": null,
        })
    }

    // Run by the process-lifetime case below; never launches a guest or a model.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn background_service_process_fixture() {
        let Some(root) = std::env::var_os("GBOT_PROCESS_FIXTURE_ROOT") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let service = Arc::new(Service::open(root.join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let service_id = service.snapshot().await.service_id;
        vault
            .0
            .lock()
            .unwrap()
            .insert(service_id, b"process-fixture-bearer".to_vec());
        let process = crate::executor::ProcessSpec {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "exit 0".into()],
        };
        let api = Api::bind(service, vault, 0)
            .await
            .unwrap()
            .with_executor(
                root.join("tasks"),
                ExecutorProcesses {
                    python: process.clone(),
                    context: process,
                },
            )
            .await
            .unwrap();
        tokio::fs::write(root.join("endpoint"), api.endpoint().to_string())
            .await
            .unwrap();
        api.serve(std::future::pending()).await.unwrap();
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn background_service_process_survives_client_disconnect_and_stops_explicitly() {
        use std::time::Duration;
        let directory = tempfile::tempdir().unwrap();
        let mut child = tokio::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "api::tests::background_service_process_fixture",
                "--nocapture",
            ])
            .env("GBOT_PROCESS_FIXTURE_ROOT", directory.path())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let endpoint = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(endpoint) =
                    tokio::fs::read_to_string(directory.path().join("endpoint")).await
                {
                    break endpoint;
                }
                assert!(
                    child.try_wait().unwrap().is_none(),
                    "fixture process exited before readiness"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        async fn request(
            client: &hyper::Client<hyper::client::HttpConnector>,
            endpoint: &str,
            path: &str,
            body: Option<serde_json::Value>,
            token: &str,
        ) -> (StatusCode, serde_json::Value) {
            let request = Request::builder()
                .method(if body.is_some() {
                    Method::POST
                } else {
                    Method::GET
                })
                .uri(format!("http://{endpoint}{path}"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    body.map(|body| serde_json::to_vec(&body).unwrap())
                        .unwrap_or_default(),
                ))
                .unwrap();
            let response = client.request(request).await.unwrap();
            let status = response.status();
            let body =
                serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                    .unwrap();
            (status, body)
        }
        let client = hyper::Client::new();
        let token = "process-fixture-bearer";
        let (status, workspace) = request(
            &client,
            &endpoint,
            "/v1/workspaces/ssh",
            Some(ssh_workspace_request()),
            token,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let id = workspace["id"].clone();
        let (status, _) = request(&client, &endpoint, "/v1/assignments/save", Some(serde_json::json!({"workspace_id":id,"api_base":"http://host.example:8080/v1","model":"fixture","context_tokens":4096})), token).await;
        assert_eq!(status, StatusCode::OK);
        let (status, schedule) = request(&client, &endpoint, "/v1/schedules/create", Some(serde_json::json!({"workspace_id":id,"prompt":"Persist across client exits","timing":{"kind":"interval","first_at":2000000000u64,"every_seconds":60},"missed_run_policy":"run_latest"})), token).await;
        assert_eq!(status, StatusCode::OK);
        let (_, before) = request(&client, &endpoint, "/v1/state", None, token).await;
        drop(client);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(child.try_wait().unwrap().is_none());
        let reconnected = hyper::Client::new();
        let (_, after) = request(&reconnected, &endpoint, "/v1/state", None, token).await;
        assert_eq!(before, after);
        let (_, schedules) = request(&reconnected, &endpoint, "/v1/schedules", None, token).await;
        assert_eq!(schedules["schedules"][0]["id"], schedule["id"]);
        let (status, _) = request(
            &reconnected,
            &endpoint,
            "/v1/service/shutdown",
            Some(serde_json::Value::Null),
            "wrong-token",
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(child.try_wait().unwrap().is_none());
        // An active update long poll must drain on shutdown rather than delay it 30 seconds.
        let poll = tokio::spawn({
            let endpoint = endpoint.clone();
            async move {
                request(
                    &hyper::Client::new(),
                    &endpoint,
                    "/v1/updates",
                    Some(serde_json::json!({"tasks":0,"setup":0})),
                    token,
                )
                .await
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        let (status, _) = request(
            &reconnected,
            &endpoint,
            "/v1/service/shutdown",
            Some(serde_json::Value::Null),
            token,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success());
        tokio::time::timeout(Duration::from_secs(1), poll)
            .await
            .unwrap()
            .unwrap();
        assert!(tokio::net::TcpStream::connect(&endpoint).await.is_err());
        let reopened = Service::open(directory.path().join("state.json"))
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(reopened.snapshot().await).unwrap()["service_id"],
            before["service_id"]
        );
        assert_eq!(reopened.snapshot().await.workspaces.len(), 1);
    }

    #[tokio::test]
    async fn schedule_api_requires_assignment_and_creates_lists_disables() {
        let directory = tempfile::tempdir().unwrap();
        let service = Arc::new(
            Service::open(directory.path().join("state.json"))
                .await
                .unwrap(),
        );
        let vault = Arc::new(MemoryVault::default());
        let process = crate::executor::ProcessSpec {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "exit 0".into()],
        };
        let api = Api::bind(service.clone(), vault, 0)
            .await
            .unwrap()
            .with_executor(
                directory.path().join("tasks"),
                ExecutorProcesses {
                    python: process.clone(),
                    context: process,
                },
            )
            .await
            .unwrap();
        let client = api.client();
        let workspace = client
            .call("/v1/workspaces/ssh", ssh_workspace_request())
            .await
            .unwrap();
        let id = workspace["id"].clone();
        let input = serde_json::json!({"workspace_id": id, "prompt": "Scheduled prompt", "timing": {"kind":"interval","first_at":2000000000u64,"every_seconds":60}, "missed_run_policy":"run_latest"});
        assert!(client
            .call("/v1/schedules/create", input.clone())
            .await
            .unwrap_err()
            .contains("model assignment"));
        client.call("/v1/assignments/save", serde_json::json!({"workspace_id":id,"api_base":"http://localhost:1337/v1","model":"scheduled-model","context_tokens":131072})).await.unwrap();
        let mut injected = input.clone();
        injected["assignment"] = serde_json::json!({"model":"other-model"});
        assert!(client.call("/v1/schedules/create", injected).await.is_err());
        let mut invalid = input.clone();
        invalid["timing"]["every_seconds"] = serde_json::json!(0);
        assert!(client
            .call("/v1/schedules/create", invalid)
            .await
            .unwrap_err()
            .contains("positive interval"));
        let schedule = client.call("/v1/schedules/create", input).await.unwrap();
        assert_eq!(schedule["assignment"]["model"], "scheduled-model");
        assert_eq!(schedule["workspace_id"], id);
        assert_eq!(schedule["enabled"], true);
        assert_eq!(
            client
                .call("/v1/schedules", serde_json::json!({}))
                .await
                .unwrap()["schedules"][0],
            schedule
        );
        assert!(client
            .call("/v1/schedules", serde_json::json!({}))
            .await
            .unwrap()["stopped"]
            .is_null());
        let disabled = client
            .call(
                "/v1/schedules/enabled",
                serde_json::json!({"id": schedule["id"],"enabled":false}),
            )
            .await
            .unwrap();
        assert_eq!(disabled["enabled"], false);
        assert!(disabled["occurrences"].as_array().unwrap().is_empty());
        api.tasks
            .as_ref()
            .unwrap()
            .schedules
            .mark_stopped("Fixture scheduler error".into())
            .await;
        assert_eq!(
            client
                .call("/v1/schedules", serde_json::json!({}))
                .await
                .unwrap()["stopped"],
            "Fixture scheduler error"
        );
        api.tasks.as_ref().unwrap().close().await.unwrap();
    }

    #[tokio::test]
    async fn ssh_workspace_save_failure_cleans_key_and_retry_persists_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let retained = directory.path().join("retained.json");
        let service = Arc::new(Service::open(&path).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let client = api.client();
        let input = ssh_workspace_request();
        let before = service.snapshot().await;
        let prior_bytes = std::fs::read(&path).unwrap();
        std::fs::rename(&path, &retained).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(client
            .call("/v1/workspaces/ssh", input.clone())
            .await
            .unwrap_err()
            .contains("could not persist"));
        assert_eq!(
            vault.0.lock().unwrap().len(),
            1,
            "only service authentication remains"
        );
        assert_eq!(service.snapshot().await, before);
        assert_eq!(std::fs::read(&retained).unwrap(), prior_bytes);
        std::fs::remove_dir(&path).unwrap();
        std::fs::rename(&retained, &path).unwrap();
        let saved = client
            .call("/v1/workspaces/ssh", input.clone())
            .await
            .unwrap();
        assert_eq!(saved["id"], input["id"]);
        assert_eq!(saved["connection"]["credential_ref"], input["id"]);
        assert!(saved.get("private_key").is_none());
        assert!(saved.get("passphrase").is_none());
        let entries = vault.0.lock().unwrap().clone();
        let retry = client
            .call("/v1/workspaces/ssh", input.clone())
            .await
            .unwrap();
        assert_eq!(retry, saved);
        assert_eq!(*vault.0.lock().unwrap(), entries);
        assert_eq!(service.snapshot().await.workspaces.len(), 1);
        let persisted = std::fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("PRIVATE KEY"));
        assert!(!persisted.contains("passphrase"));
        drop(client);
        drop(api);
        drop(service);
        let reopened = Service::open(&path).await.unwrap();
        assert_eq!(
            serde_json::to_value(&reopened.snapshot().await.workspaces[0]).unwrap(),
            saved
        );
    }

    #[tokio::test]
    async fn ssh_workspace_validates_before_vault_and_rejects_conflicting_retries() {
        let directory = tempfile::tempdir().unwrap();
        let service = Arc::new(
            Service::open(directory.path().join("state.json"))
                .await
                .unwrap(),
        );
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let client = api.client();
        let input = ssh_workspace_request();
        for (field, value) in [
            ("name", serde_json::json!("")),
            (
                "endpoint",
                serde_json::json!({"hostname":"bot.local", "port":0,"user":"bot"}),
            ),
            (
                "pinned_host_key",
                serde_json::json!({"algorithm":"ssh-ed25519","public_key":"AAAA"}),
            ),
            ("private_key", serde_json::json!("invalid-private-key")),
        ] {
            let mut invalid = input.clone();
            invalid[field] = value;
            assert!(client.call("/v1/workspaces/ssh", invalid).await.is_err());
            assert_eq!(vault.0.lock().unwrap().len(), 1);
            assert!(service.snapshot().await.workspaces.is_empty());
        }
        vault.1.store(true, Ordering::Release);
        assert!(client
            .call("/v1/workspaces/ssh", input.clone())
            .await
            .unwrap_err()
            .contains("locked"));
        assert_eq!(vault.0.lock().unwrap().len(), 1);
        vault.1.store(false, Ordering::Release);
        let (first, second) = tokio::join!(
            client.call("/v1/workspaces/ssh", input.clone()),
            client.call("/v1/workspaces/ssh", input.clone()),
        );
        let saved = first.unwrap();
        assert_eq!(second.unwrap(), saved);
        let entries = vault.0.lock().unwrap().clone();
        let mut conflict = input.clone();
        conflict["name"] = serde_json::json!("Different bot");
        assert!(client
            .call("/v1/workspaces/ssh", conflict)
            .await
            .unwrap_err()
            .contains("different workspace or SSH key"));
        let mut conflict = input;
        conflict["private_key"] = ssh_workspace_request()["private_key"].clone();
        assert!(client
            .call("/v1/workspaces/ssh", conflict)
            .await
            .unwrap_err()
            .contains("different workspace or SSH key"));
        assert_eq!(*vault.0.lock().unwrap(), entries);
        assert_eq!(service.snapshot().await.workspaces.len(), 1);
    }

    #[tokio::test]
    async fn ssh_workspace_failed_cleanup_reuses_the_same_owned_vault_slot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let retained = directory.path().join("retained.json");
        let service = Arc::new(Service::open(&path).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let client = api.client();
        let input = ssh_workspace_request();
        std::fs::rename(&path, &retained).unwrap();
        std::fs::create_dir(&path).unwrap();
        vault.2.store(true, Ordering::Release);
        for _ in 0..2 {
            assert!(client
                .call("/v1/workspaces/ssh", input.clone())
                .await
                .unwrap_err()
                .contains("SSH key could not be removed"));
            assert_eq!(vault.0.lock().unwrap().len(), 2);
            assert!(service.snapshot().await.workspaces.is_empty());
        }
        std::fs::remove_dir(&path).unwrap();
        std::fs::rename(&retained, &path).unwrap();
        vault.2.store(false, Ordering::Release);
        client.call("/v1/workspaces/ssh", input).await.unwrap();
        assert_eq!(vault.0.lock().unwrap().len(), 2);
        assert_eq!(service.snapshot().await.workspaces.len(), 1);
    }

    #[tokio::test]
    async fn ssh_workspace_post_publish_failure_retains_key_and_reconciles_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let service = Arc::new(Service::open(&path).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let client = api.client();
        let input = ssh_workspace_request();
        service.fail_next_save_after_publish();
        assert!(client
            .call("/v1/workspaces/ssh", input.clone())
            .await
            .unwrap_err()
            .contains("Workspace was saved"));
        let state = service.snapshot().await;
        assert_eq!(state.workspaces.len(), 1);
        assert_eq!(
            std::fs::read(&path).unwrap(),
            serde_json::to_vec_pretty(&state).unwrap()
        );
        let entries = vault.0.lock().unwrap().clone();
        assert_eq!(entries.len(), 2);
        client.call("/v1/workspaces/ssh", input).await.unwrap();
        assert_eq!(*vault.0.lock().unwrap(), entries);
        assert_eq!(service.snapshot().await, state);
    }

    #[tokio::test]
    async fn ssh_workspace_client_cancellation_finishes_transaction_without_duplicates() {
        #[derive(Default)]
        struct PausedVault {
            memory: MemoryVault,
            entered: tokio::sync::Notify,
            release: tokio::sync::Notify,
        }
        impl Vault for PausedVault {
            fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>> {
                self.memory.get(reference)
            }
            fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
                self.memory.delete(reference)
            }
            fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
                Box::pin(async move {
                    self.entered.notify_one();
                    self.release.notified().await;
                    self.memory.put(reference, secret).await
                })
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let service = Arc::new(
            Service::open(directory.path().join("state.json"))
                .await
                .unwrap(),
        );
        let vault = Arc::new(PausedVault::default());
        let runtime = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
        let input = ssh_workspace_request();
        let caller = tokio::spawn({
            let runtime = runtime.clone();
            let input = input.clone();
            async move {
                runtime
                    .create_ssh_workspace(serde_json::from_value(input).unwrap())
                    .await
            }
        });
        tokio::time::timeout(Duration::from_secs(2), vault.entered.notified())
            .await
            .unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        vault.release.notify_one();
        let saved = tokio::time::timeout(
            Duration::from_secs(2),
            runtime.create_ssh_workspace(serde_json::from_value(input).unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(service.snapshot().await.workspaces, vec![saved]);
        assert_eq!(vault.memory.0.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn ssh_key_import_authentication_errors_and_vault_only_storage() {
        use russh::keys::{ssh_key::LineEnding, Algorithm, PrivateKey};

        let directory = tempfile::tempdir().unwrap();
        let state_path = directory.path().join("gbot/state.json");
        let service = Arc::new(Service::open(state_path.clone()).await.unwrap());
        let service_id = service.snapshot().await.service_id;
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let endpoint = api.endpoint();
        let token = vault.0.lock().unwrap()[&service_id].clone();
        let bearer = format!("Bearer {}", std::str::from_utf8(&token).unwrap());
        let (shutdown, stopped) = tokio::sync::oneshot::channel();
        let serving = tokio::spawn(api.serve(async move {
            let _ = stopped.await;
        }));
        let client = hyper::Client::new();
        let passphrase = "fixture-one-time-passphrase";
        let key =
            PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519).unwrap();
        let encrypted = key
            .encrypt(&mut russh::keys::key::safe_rng(), passphrase)
            .unwrap()
            .to_openssh(LineEnding::LF)
            .unwrap();
        let plain = key.to_openssh(LineEnding::LF).unwrap();
        for (auth, password, status, code) in [
            (
                false,
                Some(passphrase),
                StatusCode::UNAUTHORIZED,
                "unauthorized",
            ),
            (
                true,
                None,
                StatusCode::UNPROCESSABLE_ENTITY,
                "ssh_passphrase_required",
            ),
            (
                true,
                Some("wrong-passphrase"),
                StatusCode::UNPROCESSABLE_ENTITY,
                "ssh_invalid_passphrase",
            ),
        ] {
            let mut request = Request::builder()
                .method(Method::POST)
                .uri(format!("http://{endpoint}/v1/credentials/ssh"));
            if auth {
                request = request.header(AUTHORIZATION, bearer.as_str());
            }
            let response = client.request(request.body(Body::from(serde_json::to_vec(
                &serde_json::json!({"private_key": encrypted.as_str(), "passphrase": password})
            ).unwrap())).unwrap()).await.unwrap();
            assert_eq!(response.status(), status);
            let bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
            let error: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(error["error"]["code"], code);
            assert!(!bytes
                .windows(passphrase.len())
                .any(|window| window == passphrase.as_bytes()));
            assert!(!bytes
                .windows(plain.len())
                .any(|window| window == plain.as_bytes()));
            assert_eq!(vault.0.lock().unwrap().len(), 1);
        }
        for (payload, code) in [
            (
                serde_json::json!({"private_key": "invalid-private-key"}),
                "ssh_invalid_key",
            ),
            (
                serde_json::json!({"private_key": encrypted.as_str(), "passphrase": passphrase,
                "credential_ref": service_id}),
                "invalid_request",
            ),
        ] {
            let response = client
                .request(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("http://{endpoint}/v1/credentials/ssh"))
                        .header(AUTHORIZATION, bearer.as_str())
                        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
            let error: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(error["error"]["code"], code);
            assert!(!bytes
                .windows(passphrase.len())
                .any(|window| window == passphrase.as_bytes()));
            assert!(!bytes
                .windows(plain.len())
                .any(|window| window == plain.as_bytes()));
            assert_eq!(vault.0.lock().unwrap().len(), 1);
        }
        for denied in [true, false] {
            vault.1.store(denied, Ordering::Release);
            let response = client
                .request(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("http://{endpoint}/v1/credentials/ssh"))
                        .header(AUTHORIZATION, bearer.as_str())
                        .body(Body::from(
                            serde_json::to_vec(&serde_json::json!({
                                "private_key": encrypted.as_str(), "passphrase": passphrase
                            }))
                            .unwrap(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                if denied {
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    StatusCode::CREATED
                }
            );
            let bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
            assert!(!bytes
                .windows(passphrase.len())
                .any(|window| window == passphrase.as_bytes()));
            assert!(!bytes
                .windows(plain.len())
                .any(|window| window == plain.as_bytes()));
            let result: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            if denied {
                assert_eq!(result["error"]["code"], "ssh_vault_unavailable");
                assert_eq!(vault.0.lock().unwrap().len(), 1);
            } else {
                assert!(result.get("private_key").is_none());
                assert!(result.get("passphrase").is_none());
                let reference: VaultCredentialRef =
                    serde_json::from_value(result["credential_ref"].clone()).unwrap();
                let stored = vault.get(reference.as_uuid()).await.unwrap().unwrap();
                let imported = PrivateKey::from_openssh(stored.expose_secret()).unwrap();
                assert!(!imported.is_encrypted());
                assert!(imported.public_key() == key.public_key());
                assert_eq!(vault.0.lock().unwrap().len(), 2);
            }
        }
        shutdown.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), serving)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let persisted = std::fs::read(&state_path).unwrap();
        assert!(!persisted
            .windows(passphrase.len())
            .any(|window| window == passphrase.as_bytes()));
        assert!(!persisted
            .windows(plain.len())
            .any(|window| window == plain.as_bytes()));
        assert!(service.snapshot().await.workspaces.is_empty());
        assert!(tokio::net::TcpStream::connect(endpoint).await.is_err());
    }

    #[tokio::test]
    async fn loopback_auth_workspace_persistence_and_vault_failure() {
        let directory = tempfile::tempdir().unwrap();
        let state_path = directory.path().join("gbot/state.json");
        let service = Arc::new(Service::open(state_path.clone()).await.unwrap());
        let service_id = service.snapshot().await.service_id;
        let vault = Arc::new(MemoryVault::default());
        let api = Api::bind(service.clone(), vault.clone(), 0).await.unwrap();
        let local_api = api.client();
        let endpoint = api.endpoint();
        assert_eq!(endpoint.ip(), std::net::Ipv4Addr::LOCALHOST);
        let token = vault.0.lock().unwrap()[&service_id].clone();
        assert_eq!(token.len(), 64);
        let bearer = format!("Bearer {}", std::str::from_utf8(&token).unwrap());
        let (shutdown, stopped) = tokio::sync::oneshot::channel();
        let serving = tokio::spawn(api.serve(async move {
            let _ = stopped.await;
        }));
        let client = hyper::Client::new();
        let state_uri = format!("http://{endpoint}/v1/state");
        for authorization in [None, Some("Bearer incorrect")] {
            let mut request = Request::builder().uri(&state_uri);
            if let Some(value) = authorization {
                request = request.header(AUTHORIZATION, value);
            }
            let response = client
                .request(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            let bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
            assert!(!bytes.windows(token.len()).any(|window| window == token));
        }
        for path in ["/v1/connect", "/v1/operations"] {
            let response = client
                .request(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("http://{endpoint}{path}"))
                        .header(AUTHORIZATION, bearer.as_str())
                        .body(Body::from("{invalid"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let error: serde_json::Value =
                serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                    .unwrap();
            assert_eq!(error["error"]["code"], "invalid_request");
        }
        let config = WorkspaceConfig {
            id: WorkspaceId::new(),
            name: "Dedicated fixture guest".into(),
            service_pc: ServicePc::Local,
            bot_pc: BotPc::LocalVm {
                host_id: Uuid::new_v4(),
                vm_id: "fixture-linux".into(),
                hypervisor: Hypervisor::Kvm,
            },
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: SshEndpoint {
                    hostname: "guest.example".into(),
                    port: 22,
                    user: "bot".into(),
                },
                pinned_host_key: SshHostPublicKey {
                    algorithm: "ssh-ed25519".into(),
                    public_key: "AAAAC3NzaC1lZDI1NTE5AAAAIA==".into(),
                },
                credential_ref: VaultCredentialRef::new(),
            }),
        };
        let response = client
            .request(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("http://{endpoint}/v1/workspaces"))
                    .body(Body::from(serde_json::to_vec(&config).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        hyper::body::to_bytes(response.into_body()).await.unwrap();
        assert!(service.snapshot().await.workspaces.is_empty());
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("http://{endpoint}/v1/workspaces"))
            .header(AUTHORIZATION, bearer.as_str())
            .body(Body::from(serde_json::to_vec(&config).unwrap()))
            .unwrap();
        let response = client.request(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
        assert!(!bytes.windows(token.len()).any(|window| window == token));
        let mut second_bot = config.clone();
        second_bot.id = WorkspaceId::new();
        second_bot.name = "Independent fixture bot".into();
        service
            .register_workspace(second_bot.clone())
            .await
            .unwrap();
        let save = |workspace_id, model: &str, api_key: Option<&str>| {
            serde_json::json!({
                "workspace_id": workspace_id,
                "api_base": "http://fixture.local/v1",
                "model": model,
                "context_tokens": 131072,
                "api_key": api_key,
            })
        };
        let first = local_api
            .call(
                "/v1/assignments/save",
                save(config.id, "first-model", Some("first-model-secret")),
            )
            .await
            .unwrap();
        let second = local_api
            .call(
                "/v1/assignments/save",
                save(second_bot.id, "second-model", Some("second-model-secret")),
            )
            .await
            .unwrap();
        assert!(!first.to_string().contains("first-model-secret"));
        assert!(first.get("api_key").is_none());
        assert_ne!(first["credential_ref"], second["credential_ref"]);
        let saved = local_api
            .call(
                "/v1/assignments/save",
                save(config.id, "updated-first-model", None),
            )
            .await
            .unwrap();
        assert_eq!(saved["credential_ref"], first["credential_ref"]);
        assert_eq!(
            local_api
                .runtime
                .resolve_model_assignment(config.id)
                .await
                .unwrap()
                .api_key
                .as_deref(),
            Some("first-model-secret")
        );
        vault.1.store(true, Ordering::Release);
        let failed = local_api
            .call(
                "/v1/assignments/save",
                save(config.id, "must-not-save", Some("blocked-secret")),
            )
            .await
            .unwrap_err();
        assert!(!failed.contains("blocked-secret"));
        vault.1.store(false, Ordering::Release);
        assert_eq!(
            local_api
                .call(
                    "/v1/assignments/get",
                    serde_json::json!({"workspace_id":config.id})
                )
                .await
                .unwrap(),
            saved
        );
        assert_eq!(
            local_api
                .runtime
                .resolve_model_assignment(second_bot.id)
                .await
                .unwrap()
                .model,
            "second-model"
        );
        let response = client
            .request(
                Request::builder()
                    .uri(&state_uri)
                    .header(AUTHORIZATION, bearer.as_str())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let state: serde_json::Value =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        assert_eq!(state["service_id"], service_id.to_string());
        assert_eq!(state["workspaces"], serde_json::json!([config, second_bot]));
        assert_eq!(state["assignments"].as_array().unwrap().len(), 2);
        assert!(!state.to_string().contains("model-secret"));
        shutdown.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), serving)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(tokio::net::TcpStream::connect(endpoint).await.is_err());
        drop(client);
        drop(local_api);
        drop(service);

        let persisted = std::fs::read(&state_path).unwrap();
        assert!(!persisted.windows(token.len()).any(|window| window == token));
        assert!(!String::from_utf8_lossy(&persisted).contains("model-secret"));
        let reopened = Arc::new(Service::open(state_path).await.unwrap());
        assert_eq!(reopened.snapshot().await.service_id, service_id);
        assert_eq!(
            reopened.snapshot().await.workspaces,
            vec![config.clone(), second_bot.clone()]
        );
        let api = Api::bind(reopened.clone(), vault.clone(), 0).await.unwrap();
        assert_eq!(vault.0.lock().unwrap()[&service_id], token);
        assert_eq!(
            api.client()
                .call(
                    "/v1/assignments/get",
                    serde_json::json!({"workspace_id":config.id})
                )
                .await
                .unwrap(),
            saved
        );
        assert_eq!(
            api.runtime
                .resolve_model_assignment(config.id)
                .await
                .unwrap()
                .api_key
                .as_deref(),
            Some("first-model-secret")
        );
        assert_eq!(
            api.runtime
                .resolve_model_assignment(second_bot.id)
                .await
                .unwrap()
                .api_key
                .as_deref(),
            Some("second-model-secret")
        );
        drop(api);
        for denied in [LockedVault(false), LockedVault(true)] {
            assert!(matches!(
                Api::bind(reopened.clone(), Arc::new(denied), 0).await,
                Err(ApiError::Vault(VaultError::AccessDenied))
            ));
        }
        vault
            .0
            .lock()
            .unwrap()
            .insert(service_id, b"unsafe\r\nheader".to_vec());
        assert!(matches!(
            Api::bind(reopened, vault, 0).await,
            Err(ApiError::Vault(VaultError::InvalidData))
        ));
    }
}
