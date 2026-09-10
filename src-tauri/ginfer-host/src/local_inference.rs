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
