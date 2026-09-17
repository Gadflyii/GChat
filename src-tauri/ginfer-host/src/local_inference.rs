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
        let secret = api_key.clone();
        let owner = Arc::downgrade(host);
        let service = hyper::service::make_service_fn(move |_| {
            let owner = owner.clone();
            let secret = secret.clone();
            async move {
                Ok::<_, Infallible>(hyper::service::service_fn(move |request| {
                    forward(
                        owner.clone(),
                        instance_id,
                        session_id,
                        secret.clone(),
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
    secret: String,
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
        forward_authenticated(owner, instance_id, session_id, secret, request).await?
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
    secret: String,
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
    let mut expected = Hmac::<Sha256>::new_from_slice(b"ginfer-local-inference/v1").unwrap();
    expected.update(secret.as_bytes());
    let mut actual = Hmac::<Sha256>::new_from_slice(b"ginfer-local-inference/v1").unwrap();
    actual.update(provided.as_bytes());
    if actual
        .verify_slice(&expected.finalize().into_bytes())
        .is_err()
    {
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
    async fn desktop_preflight_succeeds_without_credentials_but_other_origins_do_not() {
        for origin in ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"] {
            let request = Request::builder().method("OPTIONS").uri("/v1/models")
                .header("origin", origin).header("access-control-request-method", "GET")
                .header("access-control-request-headers", "authorization,content-type")
                .body(Body::empty()).unwrap();
            let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), "secret".into(), request).await.unwrap();
            assert_eq!(response.status(), StatusCode::NO_CONTENT);
            assert_eq!(response.headers()["access-control-allow-origin"], origin);
            assert_eq!(response.headers()["access-control-allow-headers"], "authorization,content-type");
        }
        let request = Request::builder().method("OPTIONS").uri("/v1/models")
            .header("origin", "https://unrelated.example").header("access-control-request-method", "GET")
            .body(Body::empty()).unwrap();
        let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), "secret".into(), request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!response.headers().contains_key("access-control-allow-origin"));
    }

    #[tokio::test]
    async fn desktop_can_read_errors_instead_of_hanging_behind_cors() {
        let request = Request::builder().uri("/v1/models").header("origin", "http://tauri.localhost")
            .body(Body::empty()).unwrap();
        let response = forward(Weak::new(), Uuid::nil(), Uuid::nil(), "secret".into(), request).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()["access-control-allow-origin"], "http://tauri.localhost");
    }
}
