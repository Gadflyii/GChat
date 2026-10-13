//! Task-scoped inference transport; paired Host credentials stay in the native owner.
use crate::{executor::Assignment, service::ModelAssignment};
use hyper::{
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server, StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{future::Future, ops::Deref, pin::Pin, sync::Arc};
use tokio::sync::watch;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairedTarget {
    pub host_id: Uuid,
    pub instance_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModelConnection {
    Endpoint { api_base: String },
    PairedHost { target: PairedTarget },
}

impl ModelConnection {
    pub fn valid(&self) -> bool {
        match self {
            Self::Endpoint { api_base } => !api_base.trim().is_empty(),
            Self::PairedHost { target } => {
                !target.host_id.is_nil()
                    && !target.instance_id.is_nil()
                    && !target.session_id.is_nil()
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PairedModel {
    pub target: PairedTarget,
    pub host_name: String,
    pub model: String,
    pub context_tokens: u64,
}

pub struct InferenceResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}
pub type InferenceFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
pub trait InferenceHost: Send + Sync {
    fn models(&self) -> InferenceFuture<'_, Vec<PairedModel>>;
    fn request<'a>(
        &'a self,
        target: &'a PairedTarget,
        path: &'a str,
        body: Value,
    ) -> InferenceFuture<'a, InferenceResponse>;
}

pub struct ResolvedAssignment {
    assignment: Assignment,
    pub(crate) source: Option<ModelAssignment>,
    _lease: Option<InferenceLease>,
}
impl From<Assignment> for ResolvedAssignment {
    fn from(assignment: Assignment) -> Self {
        Self {
            assignment,
            source: None,
            _lease: None,
        }
    }
}
impl Deref for ResolvedAssignment {
    type Target = Assignment;
    fn deref(&self) -> &Assignment {
        &self.assignment
    }
}
impl ResolvedAssignment {
    pub fn endpoint(assignment: Assignment, source: ModelAssignment) -> Self {
        Self {
            assignment,
            source: Some(source),
            _lease: None,
        }
    }
    pub async fn paired(
        source: ModelAssignment,
        host: Arc<dyn InferenceHost>,
        target: PairedTarget,
    ) -> Result<Self, String> {
        let lease = InferenceLease::open(host, target, source.model.clone()).await?;
        Ok(Self {
            assignment: Assignment {
                api_base: lease.api_base.clone(),
                api_key: Some(lease.token.clone()),
                model: source.model.clone(),
                context_tokens: source.context_tokens,
            },
            source: Some(source),
            _lease: Some(lease),
        })
    }
}

pub struct InferenceLease {
    api_base: String,
    token: String,
    cancel: watch::Sender<bool>,
}
impl Drop for InferenceLease {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
    }
}
impl InferenceLease {
    async fn open(
        host: Arc<dyn InferenceHost>,
        target: PairedTarget,
        model: String,
    ) -> Result<Self, String> {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let authorization = format!("Bearer {token}");
        let (cancel, mut stopped) = watch::channel(false);
        let revoked = stopped.clone();
        let server = Server::from_tcp(listener).map_err(|e| e.to_string())?.serve(make_service_fn(move |_| {
            let (host, target, model, authorization, revoked) =
                (host.clone(), target.clone(), model.clone(), authorization.clone(), revoked.clone());
            async move {
                Ok::<_, hyper::Error>(service_fn(move |request| {
                    let (host, target, model, authorization, mut revoked) =
                        (host.clone(), target.clone(), model.clone(), authorization.clone(), revoked.clone());
                    async move {
                        let response = if *revoked.borrow() { failure(StatusCode::GONE, "inference_lease_revoked", "Task inference connection has ended") }
                        else {
                            tokio::select! {
                                _ = revoked.changed() => failure(StatusCode::GONE, "inference_lease_revoked", "Task inference connection has ended"),
                                result = forward(request, host, &target, &model, &authorization) => result,
                            }
                        };
                        Ok::<_, hyper::Error>(response)
                    }
                }))
            }
        })).with_graceful_shutdown(async move { let _ = stopped.changed().await; });
        tokio::spawn(async move {
            let _ = server.await;
        });
        Ok(Self {
            api_base: format!("http://{address}/v1"),
            token,
            cancel,
        })
    }
}

fn failure(status: StatusCode, code: &str, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"error":{"code":code,"message":message}}).to_string(),
        ))
        .unwrap()
}

async fn forward(
    request: Request<Body>,
    host: Arc<dyn InferenceHost>,
    target: &PairedTarget,
    model: &str,
    authorization: &str,
) -> Response<Body> {
    if request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        != Some(authorization)
    {
        return failure(
            StatusCode::UNAUTHORIZED,
            "invalid_inference_lease",
            "Task inference authorization is required",
        );
    }
    let path = request.uri().path().to_owned();
    if request.method() != Method::POST
        || !matches!(
            path.as_str(),
            "/v1/chat/completions" | "/v1/chat/completions/count_tokens"
        )
    {
        return failure(
            StatusCode::NOT_FOUND,
            "inference_route_unavailable",
            "This task connection only serves chat and token counting",
        );
    }
    let body: Value = match hyper::body::to_bytes(request.into_body())
        .await
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
    {
        Some(body) => body,
        None => {
            return failure(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Expected a JSON request",
            )
        }
    };
    if body.get("model").and_then(Value::as_str) != Some(model) {
        return failure(
            StatusCode::CONFLICT,
            "assigned_model_mismatch",
            "Use this bot's saved model assignment",
        );
    }
    match host.request(target, &path, body).await {
        Ok(reply) => Response::builder()
            .status(reply.status)
            .header("content-type", reply.content_type)
            .body(Body::from(reply.body))
            .unwrap_or_else(|_| {
                failure(
                    StatusCode::BAD_GATEWAY,
                    "invalid_inference_response",
                    "Host returned an invalid response",
                )
            }),
        Err(error) => failure(StatusCode::CONFLICT, "paired_inference_unavailable", &error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };
    struct Host {
        calls: Mutex<Vec<(PairedTarget, String, Value)>>,
        entered: tokio::sync::Notify,
        cancelled: AtomicBool,
    }
    struct Pending<'a>(&'a AtomicBool);
    impl Drop for Pending<'_> {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }
    impl InferenceHost for Host {
        fn models(&self) -> InferenceFuture<'_, Vec<PairedModel>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn request<'a>(
            &'a self,
            target: &'a PairedTarget,
            path: &'a str,
            body: Value,
        ) -> InferenceFuture<'a, InferenceResponse> {
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((target.clone(), path.into(), body.clone()));
                if body["hold"] == true {
                    let _pending = Pending(&self.cancelled);
                    self.entered.notify_one();
                    std::future::pending::<()>().await;
                }
                Ok(InferenceResponse {
                    status: 200,
                    content_type: "application/json".into(),
                    body: br#"{"ok":true}"#.to_vec(),
                })
            })
        }
    }
    async fn send(
        client: &hyper::Client<hyper::client::HttpConnector>,
        lease: &InferenceLease,
        path: &str,
        token: &str,
        body: Value,
    ) -> Response<Body> {
        client
            .request(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("{}{path}", lease.api_base))
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn paired_lease_pins_target_routes_and_revokes_pending_request() {
        let host = Arc::new(Host {
            calls: Mutex::new(vec![]),
            entered: tokio::sync::Notify::new(),
            cancelled: AtomicBool::new(false),
        });
        let target = PairedTarget {
            host_id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
        };
        let lease = InferenceLease::open(host.clone(), target.clone(), "qwen".into())
            .await
            .unwrap();
        let client = hyper::Client::new();
        let body = json!({"model":"qwen", "messages":[{"role":"user", "content":"hello"}]});
        for (path, token, request, status) in [
            (
                "/chat/completions",
                "wrong",
                body.clone(),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "/models",
                lease.token.as_str(),
                body.clone(),
                StatusCode::NOT_FOUND,
            ),
            (
                "/chat/completions",
                lease.token.as_str(),
                json!({"model":"other"}),
                StatusCode::CONFLICT,
            ),
            (
                "/chat/completions",
                lease.token.as_str(),
                body.clone(),
                StatusCode::OK,
            ),
            (
                "/chat/completions/count_tokens",
                lease.token.as_str(),
                body.clone(),
                StatusCode::OK,
            ),
        ] {
            let response = send(&client, &lease, path, token, request).await;
            assert_eq!(response.status(), status);
            hyper::body::to_bytes(response.into_body()).await.unwrap();
        }
        assert_eq!(
            *host.calls.lock().unwrap(),
            vec![
                (target.clone(), "/v1/chat/completions".into(), body.clone()),
                (target, "/v1/chat/completions/count_tokens".into(), body)
            ]
        );
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("{}/chat/completions", lease.api_base))
            .header("authorization", format!("Bearer {}", lease.token))
            .body(Body::from(json!({"model":"qwen", "hold":true}).to_string()))
            .unwrap();
        let pending = tokio::spawn(async move { client.request(request).await.unwrap() });
        tokio::time::timeout(std::time::Duration::from_secs(2), host.entered.notified())
            .await
            .unwrap();
        drop(lease);
        let response = tokio::time::timeout(std::time::Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), StatusCode::GONE);
        assert!(host.cancelled.load(Ordering::Acquire));
    }
}
