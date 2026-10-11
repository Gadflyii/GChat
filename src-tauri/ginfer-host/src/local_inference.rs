//! Session-scoped loopback inference for local clients; management stays on pinned TLS.
use crate::service::{json, Host};
use hmac::{Hmac, Mac};
use hyper::{Body, Request, Response, StatusCode};
use sha2::Sha256;
use std::{
    convert::Infallible,
    sync::{Arc, Weak},
};
use uuid::Uuid;

struct CredentialVerifier {
    base: Hmac<Sha256>,
    expected: [u8; 32],
}
impl CredentialVerifier {
    fn new(secret: &str) -> Self {
        let base = Hmac::<Sha256>::new_from_slice(b"ginfer-local-inference/v1").unwrap();
        let mut expected = base.clone();
        expected.update(secret.as_bytes());
        Self { base, expected: expected.finalize().into_bytes().into() }
    }

    fn accepts(&self, provided: &str) -> bool {
        let mut actual = self.base.clone();
        actual.update(provided.as_bytes());
        actual.verify_slice(&self.expected).is_ok()
    }
}

pub struct LocalInference {
    pub port: u16,
    pub session_id: Uuid,
    pub api_key: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for LocalInference {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl LocalInference {
    pub fn bind(host: &Arc<Host>, instance_id: Uuid, session_id: Uuid) -> Result<Self, String> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let server = hyper::Server::from_tcp(listener).map_err(|e| e.to_string())?;
        let api_key = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let credential = Arc::new(CredentialVerifier::new(&api_key));
        let owner = Arc::downgrade(host);
        let service = hyper::service::make_service_fn(move |_| {
            let owner = owner.clone();
            let credential = credential.clone();
            async move {
                Ok::<_, Infallible>(hyper::service::service_fn(move |request| {
                    forward(
                        owner.clone(),
                        instance_id,
                        session_id,
                        credential.clone(),
                        request,
                    )
                }))
            }
        });
        let task = tokio::spawn(async move {
            let _ = server.serve(service).await;
        });
        Ok(Self {
            port,
            session_id,
            api_key,
            task,
        })
    }
}

async fn forward(
    owner: Weak<Host>,
    instance_id: Uuid,
    session_id: Uuid,
    credential: Arc<CredentialVerifier>,
    request: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    let origin = request.headers().get("origin").cloned();
    let allowed = origin.as_ref().and_then(|v| v.to_str().ok()).is_some_and(|origin| {
        matches!(origin, "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost")
            || (cfg!(debug_assertions) && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420"))
    });
    if origin.is_some() && !allowed {
        return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"origin is not allowed"})));
    }
    let preflight = request.method() == hyper::Method::OPTIONS;
    let mut response = if preflight {
        if !allowed { return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"app origin required"}))); }
        let method = request.headers().get("access-control-request-method").and_then(|v| v.to_str().ok());
        if !matches!(method, Some("GET" | "POST" | "DELETE")) {
            return Ok(json(StatusCode::METHOD_NOT_ALLOWED, serde_json::json!({"error":"unsupported preflight method"})));
        }
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NO_CONTENT;
        response.headers_mut().insert("access-control-allow-methods", "GET, POST, DELETE, OPTIONS".parse().unwrap());
        if let Some(headers) = request.headers().get("access-control-request-headers") {
            response.headers_mut().insert("access-control-allow-headers", headers.clone());
        }
        response.headers_mut().insert("access-control-max-age", "600".parse().unwrap());
        response
    } else {
        forward_authenticated(owner, instance_id, session_id, credential, request).await?
    };
    if let Some(origin) = origin.filter(|_| allowed) {
        response.headers_mut().insert("access-control-allow-origin", origin);
        response.headers_mut().append("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers".parse().unwrap());
    }
    Ok(response)
}

async fn forward_authenticated(
    owner: Weak<Host>,
    instance_id: Uuid,
    session_id: Uuid,
    credential: Arc<CredentialVerifier>,
    mut request: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    let Some(host) = owner.upgrade() else {
        return Ok(json(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({"error":"host unavailable"}),
        ));
    };
    if request.method() == hyper::Method::GET && request.uri().path() == "/health" {
        let ready = host
            .processes
            .lock()
            .await
            .endpoint(instance_id)
            .is_ok_and(|(_, _, _, current)| current == session_id);
        return Ok(json(
            if ready {
                StatusCode::OK
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            serde_json::json!({"status":if ready {"ok"} else {"unavailable"}}),
        ));
    }
    let provided = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !credential.accepts(provided) {
        return Ok(json(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({"error":"invalid inference credential"}),
        ));
    }
    let suffix = request.uri().path().trim_start_matches('/').to_string();
    request.headers_mut().insert(
        "x-ginfer-session-id",
        session_id.to_string().parse().unwrap(),
    );
    request.extensions_mut().insert(crate::service::Principal::LocalAdministrator);
    Ok(host
        .inference(instance_id, &suffix, &mut request)
        .await
        .unwrap_or_else(|error| {
            json(
                StatusCode::SERVICE_UNAVAILABLE,
                serde_json::json!({"error":error}),
            )
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "one authenticated-request resource measurement"]
    async fn request_resource_measurement_session_authentication() {
        let directory = tempfile::tempdir().unwrap();
        let host = Host::open(directory.path().join("host"), "fixture".into(),
            directory.path().join("unused-engine"), Vec::new(), Vec::new(), Vec::new()).await.unwrap();
        let instance = Uuid::new_v4();
        let first = LocalInference::bind(&host, instance, Uuid::new_v4()).unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://127.0.0.1:{}/v1/models", first.port);
        for credential in [None, Some("wrong"), Some("")] {
            let mut request = client.get(&url);
            if let Some(credential) = credential { request = request.bearer_auth(credential); }
            let response = request.send().await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(response.json::<serde_json::Value>().await.unwrap()["error"], "invalid inference credential");
        }
        let request = client.get(&url).bearer_auth(&first.api_key).header("origin", "http://tauri.localhost");
        let measurement = crate::resource_measurement::Measurement::start();
        let response = request.send().await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()["access-control-allow-origin"], "http://tauri.localhost");
        let body = response.json::<serde_json::Value>().await.unwrap();
        measurement.finish("session_authentication_request");
        assert_eq!(body["error"], "instance is not ready");
        let second = LocalInference::bind(&host, instance, Uuid::new_v4()).unwrap();
        assert_ne!(first.api_key, second.api_key);
        let response = client.get(format!("http://127.0.0.1:{}/v1/models", second.port))
            .bearer_auth(&first.api_key).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let response = client.get(format!("http://127.0.0.1:{}/health", first.port)).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.json::<serde_json::Value>().await.unwrap()["status"], "unavailable");
        drop(first);
        drop(second);
    }

    #[tokio::test]
    async fn desktop_preflight_succeeds_without_credentials_but_other_origins_do_not() {
        for origin in ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"] {
            let request = Request::builder().method("OPTIONS").uri("/v1/models")
                .header("origin", origin).header("access-control-request-method", "GET")
                .header("access-control-request-headers", "authorization,content-type")
                .body(Body::empty()).unwrap();
            let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), Arc::new(CredentialVerifier::new("secret")), request).await.unwrap();
            assert_eq!(response.status(), StatusCode::NO_CONTENT);
            assert_eq!(response.headers()["access-control-allow-origin"], origin);
            assert_eq!(response.headers()["access-control-allow-headers"], "authorization,content-type");
        }
        let request = Request::builder().method("OPTIONS").uri("/v1/models")
            .header("origin", "https://unrelated.example").header("access-control-request-method", "GET")
            .body(Body::empty()).unwrap();
        let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), Arc::new(CredentialVerifier::new("secret")), request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!response.headers().contains_key("access-control-allow-origin"));
    }

    #[tokio::test]
    async fn desktop_can_read_errors_instead_of_hanging_behind_cors() {
        let request = Request::builder().uri("/v1/models").header("origin", "http://tauri.localhost")
            .body(Body::empty()).unwrap();
        let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), Arc::new(CredentialVerifier::new("secret")), request).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()["access-control-allow-origin"], "http://tauri.localhost");
    }
}
