use std::collections::{BTreeSet, VecDeque};
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use hyper::body::to_bytes;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Method, Request, Response, Server, StatusCode};
use serde_json::Value;
use tokio::sync::oneshot;

use super::ginfer_client::{GinferClient, GinferSessionTarget};
use super::skills::SkillRegistry;
use super::tools::{ApprovalHook, DesktopServices, FolderAccessHook};
use super::types::{AgentEvent, ApprovalDecision, ApprovalRequest, FolderAccessRequest};

/// Real TLS host management and shared registry, without an inference process.
pub(crate) struct TestFleet {
    pub host: Arc<ginfer_host::service::Host>,
    pub client: Arc<ginfer_host::client::Client>,
    pub directory: tempfile::TempDir,
    pub origin: String,
    server: tokio::task::JoinHandle<()>,
    credentials: Arc<TestCredentials>,
    registry: PathBuf,
    pause_reads: Arc<std::sync::atomic::AtomicBool>,
    read_arrived: Arc<tokio::sync::Notify>,
    read_resumed: Arc<tokio::sync::Notify>,
}

#[derive(Default)]
struct TestCredentials(Mutex<std::collections::HashMap<uuid::Uuid, String>>);
impl ginfer_host::client::CredentialStore for TestCredentials {
    fn get(&self, id: uuid::Uuid) -> ginfer_host::client::CredentialFuture<'_, String> {
        Box::pin(async move {
            self.0
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or("Unknown fixture grant".into())
        })
    }
    fn set<'a>(
        &'a self,
        id: uuid::Uuid,
        token: &'a str,
    ) -> ginfer_host::client::CredentialFuture<'a, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().insert(id, token.to_owned());
            Ok(())
        })
    }
    fn delete(&self, id: uuid::Uuid) -> ginfer_host::client::CredentialFuture<'_, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().remove(&id);
            Ok(())
        })
    }
}

impl TestFleet {
    pub async fn start() -> Self {
        Self::start_configured(true).await
    }

    pub async fn unconfigured() -> Self {
        Self::start_configured(false).await
    }

    pub async fn unconfigured_shared() -> Self {
        Self::start_bound(false, true).await
    }

    async fn start_configured(configured: bool) -> Self {
        Self::start_bound(configured, false).await
    }

    async fn start_bound(configured: bool, shared: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let host = ginfer_host::service::Host::open(
            directory.path().join("host"),
            "Fixture".into(),
            std::env::current_exe().unwrap(),
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let listener =
            tokio::net::TcpListener::bind(if shared { "0.0.0.0:0" } else { "127.0.0.1:0" })
                .await
                .unwrap();
        let origin = format!(
            "https://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        );
        host.data.lock().await.management_origin = Some(origin.clone());
        host.save().await.unwrap();
        // The fixture serves the standalone discoverable host's real pairing API.
        host.lan_sharing.lock().await.standalone = true;
        let (host_id, token, fingerprint, acceptor) = {
            let data = host.data.lock().await;
            (
                data.host_id,
                data.pairing_admin_token.clone(),
                data.certificate.fingerprint(),
                data.certificate.acceptor().unwrap(),
            )
        };
        let local = host
            .clone()
            .route(
                Request::post("/host/v1/local-client")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        let local: Value =
            serde_json::from_slice(&to_bytes(local.into_body()).await.unwrap()).unwrap();
        let client_id: uuid::Uuid = local["client_id"].as_str().unwrap().parse().unwrap();
        let serving = host.clone();
        let pause_reads = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let read_arrived = Arc::new(tokio::sync::Notify::new());
        let read_resumed = Arc::new(tokio::sync::Notify::new());
        let paused = pause_reads.clone();
        let arrived = read_arrived.clone();
        let resumed = read_resumed.clone();
        let server = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            while let Ok((socket, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                let serving = serving.clone();
                let paused = paused.clone();
                let arrived = arrived.clone();
                let resumed = resumed.clone();
                connections.spawn(async move {
                    if let Ok(tls) = acceptor.accept(socket).await {
                        let service = service_fn(move |request: Request<Body>| {
                            let serving = serving.clone();
                            let paused = paused.clone();
                            let arrived = arrived.clone();
                            let resumed = resumed.clone();
                            async move {
                                if request.method() == Method::GET
                                    && request.uri().path() == "/host/v1/fleet"
                                    && paused.load(std::sync::atomic::Ordering::SeqCst)
                                {
                                    arrived.notify_one();
                                    resumed.notified().await;
                                }
                                serving.route(request).await
                            }
                        });
                        let _ = hyper::server::conn::Http::new()
                            .serve_connection(tls, service)
                            .await;
                    }
                });
            }
        });
        let credentials = Arc::new(TestCredentials::default());
        credentials.0.lock().unwrap().insert(client_id, token);
        let registry = directory.path().join("client/hosts.json");
        let client = Arc::new(ginfer_host::client::Client::new(
            Some(registry.clone()),
            credentials.clone(),
        ));
        let legacy = directory.path().join("paired-hosts.json");
        std::fs::write(
            &legacy,
            serde_json::to_vec(&vec![ginfer_host::client::SavedHost {
                host_id,
                name: "Fixture".into(),
                base_url: origin.clone(),
                certificate_sha256: fingerprint.clone(),
                client_id,
            }])
            .unwrap(),
        )
        .unwrap();
        client.import_legacy(&legacy).await.unwrap();
        if configured {
            ginfer_host::fleet_client::FleetClient::new(client.clone())
                .configure(
                    host_id,
                    ginfer_host::fleet::AuthorityLocator {
                        host_id,
                        origins: vec![origin.clone()],
                        certificate_sha256: fingerprint,
                    },
                )
                .await
                .unwrap();
        }
        Self {
            host,
            client,
            directory,
            origin,
            server,
            credentials,
            registry,
            pause_reads,
            read_arrived,
            read_resumed,
        }
    }

    pub fn second_client(&self) -> Arc<ginfer_host::client::Client> {
        Arc::new(ginfer_host::client::Client::new(
            Some(self.registry.clone()),
            self.credentials.clone(),
        ))
    }
    pub async fn register(&self, other: &Self) {
        let record = other
            .client
            .registered()
            .await
            .unwrap()
            .into_iter()
            .find(|host| host.base_url == other.origin)
            .unwrap();
        let token = other.credentials.0.lock().unwrap()[&record.client_id].clone();
        self.credentials
            .0
            .lock()
            .unwrap()
            .insert(record.client_id, token);
        let path = self
            .directory
            .path()
            .join(format!("import-{}.json", record.host_id));
        std::fs::write(&path, serde_json::to_vec(&vec![record]).unwrap()).unwrap();
        self.client.import_legacy(&path).await.unwrap();
    }

    pub async fn independent_client(&self) -> Arc<ginfer_host::client::Client> {
        let client = Arc::new(ginfer_host::client::Client::new(
            Some(self.directory.path().join("independent/hosts.json")),
            self.credentials.clone(),
        ));
        client
            .import_legacy(&self.directory.path().join("paired-hosts.json"))
            .await
            .unwrap();
        client
    }
    pub fn stop(&self) {
        self.server.abort();
    }
    pub fn pause_fleet_reads(&self) {
        self.pause_reads
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    pub async fn wait_for_fleet_read(&self) {
        self.read_arrived.notified().await;
    }
    pub fn resume_fleet_reads(&self) {
        self.pause_reads
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.read_resumed.notify_one();
    }
}
impl Drop for TestFleet {
    fn drop(&mut self) {
        self.server.abort();
    }
}

pub(crate) struct TestWorkspace {
    path: PathBuf,
}

impl TestWorkspace {
    pub(crate) fn new() -> Self {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-test-workspaces")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&path).expect("create agent test workspace");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn write(&self, relative: &str, content: impl AsRef<[u8]>) {
        let path = self.path.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create fixture parent");
        }
        std::fs::write(path, content).expect("write fixture");
    }

    pub(crate) fn read(&self, relative: &str) -> Vec<u8> {
        std::fs::read(self.path.join(relative)).expect("read fixture")
    }

    pub(crate) fn skill_registry(&self) -> SkillRegistry {
        SkillRegistry::load(
            self.path.join(".agent-skills"),
            &BTreeSet::new(),
            &BTreeSet::new(),
        )
        .expect("create empty skill registry")
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(crate) struct RecordingApproval {
    approved: bool,
    error: Option<String>,
    requests: Mutex<Vec<ApprovalRequest>>,
}

impl RecordingApproval {
    pub(crate) fn allow() -> Self {
        Self {
            approved: true,
            error: None,
            requests: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn deny() -> Self {
        Self {
            approved: false,
            error: None,
            requests: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn requests(&self) -> Vec<ApprovalRequest> {
        self.requests.lock().expect("approval requests").clone()
    }
}

#[async_trait]
impl ApprovalHook for RecordingApproval {
    async fn is_allowed(&self, _fingerprint: &str) -> bool {
        false
    }

    async fn request(&self, request: ApprovalRequest) -> Result<ApprovalDecision, String> {
        self.requests
            .lock()
            .expect("approval requests")
            .push(request);
        match &self.error {
            Some(error) => Err(error.clone()),
            None => Ok(if self.approved {
                ApprovalDecision::AllowOnce
            } else {
                ApprovalDecision::Deny
            }),
        }
    }
}

pub(crate) struct RecordingFolderAccess {
    allowed: bool,
    requests: Mutex<Vec<FolderAccessRequest>>,
}

impl RecordingFolderAccess {
    pub(crate) fn deny() -> Self {
        Self {
            allowed: false,
            requests: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn requests(&self) -> Vec<FolderAccessRequest> {
        self.requests
            .lock()
            .expect("folder access requests")
            .clone()
    }
}

#[async_trait]
impl FolderAccessHook for RecordingFolderAccess {
    async fn request(&self, request: FolderAccessRequest) -> Result<bool, String> {
        self.requests
            .lock()
            .expect("folder access requests")
            .push(request);
        Ok(self.allowed)
    }
}

#[derive(Default)]
pub(crate) struct RecordingDesktop {
    clipboard_writes: Mutex<Vec<String>>,
    notifications: Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl DesktopServices for RecordingDesktop {
    async fn write_clipboard(&self, text: String) -> Result<(), String> {
        self.clipboard_writes
            .lock()
            .expect("clipboard writes")
            .push(text);
        Ok(())
    }

    async fn notify(&self, title: String, body: String) -> Result<(), String> {
        self.notifications
            .lock()
            .expect("notifications")
            .push((title, body));
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct ScriptedResponse {
    status: StatusCode,
    body: Value,
    delay: Duration,
}

impl ScriptedResponse {
    pub(crate) fn tool_call(name: &str, arguments: Value) -> Self {
        let mut response = Self::completion("");
        response.body["choices"][0]["message"]["tool_calls"] = serde_json::json!([{
            "type":"function", "id":"fixture-call", "function":{"name":name,"arguments":arguments.to_string()}
        }]);
        response
    }
    pub(crate) fn with_finish_reason(mut self, reason: &str) -> Self {
        self.body["x_ginfer"]["finish_reason"] = serde_json::json!(reason);
        self
    }
    pub(crate) fn completion(content: impl Into<String>) -> Self {
        Self {
            status: StatusCode::OK,
            body: serde_json::json!({
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "model": "scripted-test-model",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": content.into()},
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                    "prompt_tokens_details": {"cached_tokens": 0}
                },
                "x_ginfer": {
                    "computed_prefill_tokens": 1,
                    "prefill_seconds": 0.002,
                    "decode_seconds": 0.004,
                    "finish_reason": "stop_token"
                }
            }),
            delay: Duration::ZERO,
        }
    }

    pub(crate) fn reasoning_completion(
        content: impl Into<String>,
        reasoning: impl Into<String>,
    ) -> Self {
        let mut response = Self::completion(content);
        response.body["choices"][0]["message"]["reasoning_content"] =
            Value::String(reasoning.into());
        response
    }

    pub(crate) fn http_error(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: serde_json::json!({"error": {"message": message.into()}}),
            delay: Duration::ZERO,
        }
    }

    pub(crate) fn delayed(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

pub(crate) struct ScriptedGinferServer {
    address: SocketAddr,
    requests: Arc<Mutex<Vec<Value>>>,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

impl ScriptedGinferServer {
    pub(crate) async fn start(responses: Vec<ScriptedResponse>) -> Self {
        Self::start_with_model(
            responses,
            serde_json::json!({
                "id": "scripted-test-model",
                "object": "model",
                "max_model_len": 32768
            }),
        )
        .await
    }

    pub(crate) async fn start_with_model(responses: Vec<ScriptedResponse>, model: Value) -> Self {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .expect("bind scripted completion server");
        listener
            .set_nonblocking(true)
            .expect("set scripted server nonblocking");
        let address = listener.local_addr().expect("scripted server address");
        let responses = Arc::new(tokio::sync::Mutex::new(VecDeque::from(responses)));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let service_responses = Arc::clone(&responses);
        let service_requests = Arc::clone(&requests);
        let make_service = make_service_fn(move |_| {
            let responses = Arc::clone(&service_responses);
            let requests = Arc::clone(&service_requests);
            let model = model.clone();
            async move {
                Ok::<_, Infallible>(service_fn(move |request| {
                    serve_ginfer(
                        request,
                        Arc::clone(&responses),
                        Arc::clone(&requests),
                        model.clone(),
                    )
                }))
            }
        });
        let server = Server::from_tcp(listener)
            .expect("build scripted server")
            .serve(make_service)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            });
        let task = tokio::spawn(async move {
            let _ = server.await;
        });
        tokio::task::yield_now().await;
        Self {
            address,
            requests,
            shutdown: Some(shutdown_tx),
            task,
        }
    }

    pub(crate) fn client(&self) -> GinferClient {
        GinferClient::new(&GinferSessionTarget {
            connection: super::ginfer_client::GinferConnection::Local {
                port: i32::from(self.address.port()),
                api_key: String::new(),
            },
            model_id: "scripted-test-model".into(),
            has_vision: false,
        })
        .expect("create scripted backend client")
    }

    pub(crate) fn requests(&self) -> Vec<Value> {
        self.requests.lock().expect("scripted requests").clone()
    }
}

impl Drop for ScriptedGinferServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.abort();
    }
}

async fn serve_ginfer(
    request: Request<Body>,
    responses: Arc<tokio::sync::Mutex<VecDeque<ScriptedResponse>>>,
    requests: Arc<Mutex<Vec<Value>>>,
    model: Value,
) -> Result<Response<Body>, Infallible> {
    if request.method() == Method::GET && request.uri().path() == "/health" {
        return Ok(json_response(
            StatusCode::OK,
            serde_json::json!({"status":"ok"}),
        ));
    }
    if request.method() == Method::GET && request.uri().path() == "/v1/models" {
        return Ok(json_response(
            StatusCode::OK,
            serde_json::json!({"object": "list", "data": [model]}),
        ));
    }
    if request.method() == Method::POST
        && request.uri().path() == "/v1/chat/completions/count_tokens"
    {
        let body = to_bytes(request.into_body()).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        // Deterministic fixture tokenizer; production always uses the engine's tokenizer.
        let text = payload["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["content"].as_str().unwrap_or("").len())
            .sum::<usize>();
        return Ok(json_response(
            StatusCode::OK,
            serde_json::json!({"input_tokens":text / 4 + 32}),
        ));
    }
    if request.method() != Method::POST || request.uri().path() != "/v1/chat/completions" {
        return Ok(json_response(
            StatusCode::NOT_FOUND,
            serde_json::json!({"error": {"message": "not found"}}),
        ));
    }
    let body = to_bytes(request.into_body()).await.unwrap_or_default();
    let parsed = serde_json::from_slice(&body)
        .unwrap_or_else(|_| serde_json::json!({"invalidBody": String::from_utf8_lossy(&body)}));
    requests.lock().expect("scripted requests").push(parsed);
    let response = responses.lock().await.pop_front().unwrap_or_else(|| {
        ScriptedResponse::http_error(StatusCode::INTERNAL_SERVER_ERROR, "script exhausted")
    });
    if !response.delay.is_zero() {
        tokio::time::sleep(response.delay).await;
    }
    Ok(json_response(response.status, response.body))
}

fn json_response(status: StatusCode, body: Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(hyper::header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("build scripted response")
}

pub(crate) fn collect_event(events: &mut Vec<AgentEvent>, event: AgentEvent) -> Result<(), String> {
    events.push(event);
    Ok(())
}
