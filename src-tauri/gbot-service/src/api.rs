use std::{convert::Infallible, future::Future, net::SocketAddr, sync::Arc};

use hyper::{
    header::{AUTHORIZATION, CONTENT_TYPE, WWW_AUTHENTICATE},
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    contract::{GuestRequest, SessionIdentity, WorkspaceConfig},
    service::{Service, ServiceError},
    ssh::SshError,
    vault::{Secret, Vault, VaultError},
    workspace::{WorkspaceError, WorkspaceRuntime},
};

#[derive(Debug)]
pub enum ApiError {
    Vault(VaultError),
    Listener(std::io::Error),
    Http(hyper::Error),
    Workspace(WorkspaceError),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Vault(error) => write!(formatter, "Gbot secure storage: {error}"),
            Self::Listener(_) => formatter.write_str("Gbot loopback listener is unavailable"),
            Self::Http(_) => formatter.write_str("Gbot HTTP service could not complete"),
            Self::Workspace(error) => error.fmt(formatter),
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
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SshKeyImportRequest {
    private_key: String,
    passphrase: Option<String>,
}

impl Api {
    pub async fn bind(
        service: Arc<Service>,
        vault: Arc<dyn Vault>,
        port: u16,
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
        Ok(Self {
            runtime: Arc::new(WorkspaceRuntime::new(service.clone(), vault)),
            service,
            token: Arc::new(token),
            listener,
            endpoint,
        })
    }

    pub fn endpoint(&self) -> SocketAddr {
        self.endpoint
    }

    pub async fn serve(
        self,
        shutdown: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), ApiError> {
        let service = self.service;
        let token = self.token;
        let runtime = self.runtime;
        let routing_runtime = runtime.clone();
        let stopping_runtime = runtime.clone();
        let (stopped, mut stop_result) = tokio::sync::oneshot::channel();
        let serving = hyper::Server::from_tcp(self.listener)
            .map_err(ApiError::Http)?
            .serve(make_service_fn(move |_| {
                let service = service.clone();
                let token = token.clone();
                let runtime = routing_runtime.clone();
                async move {
                    Ok::<_, Infallible>(service_fn(move |request| {
                        route(service.clone(), runtime.clone(), token.clone(), request)
                    }))
                }
            }))
            .with_graceful_shutdown(async move {
                shutdown.await;
                let _ = stopped.send(stopping_runtime.close().await);
            })
            .await;
        let cleanup = match stop_result.try_recv() {
            Ok(result) => result,
            Err(_) => runtime.close().await,
        };
        cleanup.map_err(ApiError::Workspace)?;
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

async fn route(
    service: Arc<Service>,
    runtime: Arc<WorkspaceRuntime>,
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
    let response = match (request.method(), request.uri().path()) {
        (&Method::GET, "/v1/state") => json_response(StatusCode::OK, &service.snapshot().await),
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
        (&Method::POST, "/v1/operations") => match parse_body::<GuestRequest>(request).await {
            Some(operation) => match runtime.request(operation).await {
                Ok(reply) => json_response(StatusCode::OK, &reply),
                Err(error) => workspace_error(error),
            },
            None => invalid_request(),
        },
        (&Method::POST, "/v1/connect" | "/v1/disconnect" | "/v1/view/open" | "/v1/view/close") => {
            let path = request.uri().path().to_string();
            match parse_body::<SessionIdentity>(request).await {
                Some(identity) => match path.as_str() {
                    "/v1/connect" => match runtime.connect(identity).await {
                        Ok(hello) => json_response(StatusCode::OK, &hello),
                        Err(error) => workspace_error(error),
                    },
                    "/v1/view/open" => match runtime.open_view(identity).await {
                        Ok(endpoint) => json_response(
                            StatusCode::OK,
                            &serde_json::json!({
                                "identity": identity, "endpoint": endpoint.to_string(), "capability": "view_transport"
                            }),
                        ),
                        Err(error) => workspace_error(error),
                    },
                    other => {
                        let result = if other == "/v1/disconnect" {
                            runtime.disconnect(identity).await
                        } else {
                            runtime.close_view(identity).await
                        };
                        match result {
                            Ok(()) => json_response(
                                StatusCode::OK,
                                &serde_json::json!({"identity":identity}),
                            ),
                            Err(error) => workspace_error(error),
                        }
                    }
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

fn workspace_error(error: WorkspaceError) -> Response<Body> {
    let (status, code) = match &error {
        WorkspaceError::NotFound => (StatusCode::NOT_FOUND, "workspace_not_found"),
        WorkspaceError::State(ServiceError::Contract(_)) => {
            (StatusCode::BAD_REQUEST, "invalid_guest_request")
        }
        WorkspaceError::State(ServiceError::Persistence) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "state_not_saved")
        }
        WorkspaceError::Transport(_) => (StatusCode::BAD_GATEWAY, "guest_connection_failed"),
        WorkspaceError::AdapterUnavailable | WorkspaceError::ServiceLocationUnavailable => {
            (StatusCode::NOT_IMPLEMENTED, "adapter_unavailable")
        }
        WorkspaceError::ShuttingDown => (StatusCode::SERVICE_UNAVAILABLE, "service_stopping"),
        _ => (StatusCode::CONFLICT, "guest_state_conflict"),
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
    struct MemoryVault(Mutex<BTreeMap<Uuid, Vec<u8>>>, AtomicBool);

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
                self.0.lock().unwrap().remove(&reference);
                Ok(())
            })
        }
    }

    struct LockedVault(bool);

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
        assert_eq!(state["workspaces"], serde_json::json!([config]));
        shutdown.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), serving)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(tokio::net::TcpStream::connect(endpoint).await.is_err());
        drop(client);
        drop(service);

        let persisted = std::fs::read(&state_path).unwrap();
        assert!(!persisted.windows(token.len()).any(|window| window == token));
        let reopened = Arc::new(Service::open(state_path).await.unwrap());
        assert_eq!(reopened.snapshot().await.service_id, service_id);
        assert_eq!(reopened.snapshot().await.workspaces, vec![config]);
        let api = Api::bind(reopened.clone(), vault.clone(), 0).await.unwrap();
        assert_eq!(vault.0.lock().unwrap()[&service_id], token);
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
