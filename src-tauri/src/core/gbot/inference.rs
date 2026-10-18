//! Gbot uses the shared native certificate, grant and engine-session owner.
use gbot_service::inference::{
    InferenceFuture, InferenceHost, InferenceResponse, PairedModel, PairedTarget,
};
use ginfer_host::{client::Client, engine_registry::InstanceRef};
use serde_json::Value;
use std::sync::Arc;

pub(super) struct NativeInferenceHost {
    client: Arc<Client>,
    connection: tokio::sync::Mutex<()>,
}

impl NativeInferenceHost {
    fn new(client: Arc<Client>) -> Self {
        Self {
            client,
            connection: tokio::sync::Mutex::new(()),
        }
    }

    pub async fn open() -> Result<Self, String> {
        let client = crate::core::engine_hosts::shared_client().await?;
        client.initialize_from_local_owner().await?;
        Ok(Self::new(client))
    }

    async fn attach_local(&self) -> Result<Option<String>, String> {
        // This is an explicit service operation. Attach through the local owner
        // without overriding Client's fence for a deliberately stopped Host.
        let hosts = self.client.list().await?;
        Ok(hosts
            .get("local_error")
            .and_then(Value::as_str)
            .map(str::to_owned))
    }
}
impl InferenceHost for NativeInferenceHost {
    fn models(&self) -> InferenceFuture<'_, Vec<PairedModel>> {
        Box::pin(async move {
            let _connection = self.connection.lock().await;
            let mut errors: Vec<_> = self.attach_local().await?.into_iter().collect();
            let hosts = self.client.registered().await?;
            // The independent service has its own Client session. A desktop
            // connection does not unlock these saved credentials for Gbot.
            let results = futures_util::future::join_all(
                hosts.iter().map(|host| self.client.connect(host.host_id)),
            )
            .await;
            let mut connected = std::collections::BTreeSet::new();
            for (host, result) in hosts.iter().zip(results) {
                match result {
                    Ok(_) => {
                        connected.insert(host.host_id);
                    }
                    Err(error) => errors.push(format!("{}: {error}", host.name)),
                }
            }
            let state = self.client.view().await?;
            let mut models = Vec::new();
            for (host_id, snapshot) in &state.snapshots {
                if !connected.contains(host_id) {
                    continue;
                }
                for instance in snapshot
                    .get("instances")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(instance_id) = instance
                        .get("instance_id")
                        .and_then(Value::as_str)
                        .and_then(|id| id.parse().ok())
                    else {
                        continue;
                    };
                    let Ok(resolved) = state.registry.resolve(&InstanceRef {
                        host_id: *host_id,
                        instance_id,
                    }) else {
                        continue;
                    };
                    let Some(session_id) = resolved.session_id else {
                        continue;
                    };
                    let Some(context_tokens) = instance
                        .pointer("/configuration/max_context")
                        .and_then(Value::as_u64)
                        .filter(|n| *n > 0)
                    else {
                        continue;
                    };
                    models.push(PairedModel {
                        target: PairedTarget {
                            host_id: *host_id,
                            instance_id,
                            session_id,
                        },
                        host_name: snapshot
                            .get("display_name")
                            .and_then(Value::as_str)
                            .unwrap_or("GInfer Host")
                            .into(),
                        model: resolved.upstream_model_id.clone(),
                        context_tokens,
                    });
                }
            }
            models.sort_by(|a, b| {
                (&a.host_name, &a.model, a.target.instance_id).cmp(&(
                    &b.host_name,
                    &b.model,
                    b.target.instance_id,
                ))
            });
            if !errors.is_empty() {
                let error = format!("Could not discover ready models: {}", errors.join("; "));
                if models.is_empty() {
                    return Err(error);
                }
                log::warn!("Gbot Host discovery: {error}");
            }
            Ok(models)
        })
    }
    fn request<'a>(
        &'a self,
        target: &'a PairedTarget,
        path: &'a str,
        body: Value,
    ) -> InferenceFuture<'a, InferenceResponse> {
        Box::pin(async move {
            {
                // Serialize connection refreshes, not inference: simultaneous
                // task dispatches must not supersede one another's snapshot.
                let _connection = self.connection.lock().await;
                let local_error = self.attach_local().await?;
                // A persisted brain can run before models() after restart.
                // request_instance still checks its exact saved session.
                self.client
                    .connect(target.host_id)
                    .await
                    .map_err(|error| match local_error {
                        Some(local) => format!("{error}; local Host: {local}"),
                        None => error.to_string(),
                    })?;
            }
            let response = self
                .client
                .request_instance(
                    &InstanceRef {
                        host_id: target.host_id,
                        instance_id: target.instance_id,
                    },
                    target.session_id,
                    reqwest::Method::POST,
                    path,
                    Some(&body),
                )
                .await
                .map_err(|error| error.to_string())?;
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/json")
                .to_owned();
            let body = response
                .bytes()
                .await
                .map_err(|error| error.to_string())?
                .to_vec();
            Ok(InferenceResponse {
                status,
                content_type,
                body,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ginfer_host::{
        client::{CredentialFuture, CredentialStore, PairRequest},
        local_host_registry::Owner,
        service::Host,
    };
    use serde_json::json;
    use std::{collections::BTreeMap, sync::Mutex};
    use uuid::Uuid;

    #[derive(Default)]
    struct Vault(
        Mutex<BTreeMap<Uuid, String>>,
        std::sync::atomic::AtomicUsize,
    );
    impl CredentialStore for Vault {
        fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
            self.1.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async move {
                self.0
                    .lock()
                    .unwrap()
                    .get(&id)
                    .cloned()
                    .ok_or("credential absent".into())
            })
        }
        fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().insert(id, token.into());
                Ok(())
            })
        }
        fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().remove(&id);
                Ok(())
            })
        }
    }

    struct Fixture {
        root: tempfile::TempDir,
        host: Arc<Host>,
        origin: String,
        instances: Arc<Mutex<Vec<Value>>>,
        inference_sessions: Arc<Mutex<Vec<String>>>,
        server: tokio::task::JoinHandle<()>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }
    impl Fixture {
        async fn open() -> Self {
            let root = tempfile::tempdir().unwrap();
            let host = Host::open(
                root.path().join("host"),
                "Brain Host".into(),
                std::env::current_exe().unwrap(),
                vec![],
                vec![],
                vec![],
            )
            .await
            .unwrap();
            let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let origin = format!("https://127.0.0.1:{port}");
            host.lan_sharing.lock().await.standalone = Some(port);
            host.data.lock().await.management_origin = Some(origin.clone());
            host.save().await.unwrap();
            let instances = Arc::new(Mutex::new(Vec::new()));
            let inference_sessions = Arc::new(Mutex::new(Vec::new()));
            let server = {
                let host = host.clone();
                let instances = instances.clone();
                let inference_sessions = inference_sessions.clone();
                tokio::spawn(async move {
                    let mut connections = tokio::task::JoinSet::new();
                    let revision = Arc::new(std::sync::atomic::AtomicU64::new(1));
                    loop {
                        let socket = tokio::select! {
                            Some(_) = connections.join_next(), if !connections.is_empty() => continue,
                            accepted = listener.accept() => accepted.unwrap().0,
                        };
                        let acceptor = acceptor.clone();
                        let host = host.clone();
                        let instances = instances.clone();
                        let inference_sessions = inference_sessions.clone();
                        let revision = revision.clone();
                        connections.spawn(async move {
                            if let Ok(tls) = acceptor.accept(socket).await {
                                let _ = hyper::server::conn::Http::new()
                                    .serve_connection(
                                        tls,
                                        hyper::service::service_fn(
                                            move |req: hyper::Request<hyper::Body>| {
                                                let host = host.clone();
                                                let instances = instances.clone();
                                                let revision = revision.clone();
                                                let inference =
                                                    req.uri().path().contains("/inference/");
                                                let snapshot =
                                                    req.uri().path() == "/host/v1/snapshot";
                                                if inference {
                                                    inference_sessions.lock().unwrap().push(
                                                        req.headers()
                                                            .get("x-ginfer-session-id")
                                                            .unwrap()
                                                            .to_str()
                                                            .unwrap()
                                                            .into(),
                                                    );
                                                }
                                                async move {
                                                    // Retain real certificate, pairing and Host authorization.
                                                    // Only the advertised Engine inventory is a CPU-only fixture.
                                                    let mut response = host.route(req).await?;
                                                    if snapshot && response.status().is_success() {
                                                        let bytes = hyper::body::to_bytes(
                                                            response.body_mut(),
                                                        )
                                                        .await
                                                        .unwrap();
                                                        let mut body: Value =
                                                            serde_json::from_slice(&bytes).unwrap();
                                                        body["instances"] =
                                                            json!(*instances.lock().unwrap());
                                                        body["revision"] = revision
                                                            .fetch_add(
                                                                1,
                                                                std::sync::atomic::Ordering::SeqCst,
                                                            )
                                                            .into();
                                                        response = ginfer_host::service::json(
                                                            hyper::StatusCode::OK,
                                                            body,
                                                        );
                                                    }
                                                    Ok::<_, std::convert::Infallible>(response)
                                                }
                                            },
                                        ),
                                    )
                                    .await;
                            }
                        });
                    }
                })
            };
            Self {
                root,
                host,
                origin,
                instances,
                inference_sessions,
                server,
            }
        }
        async fn paired(&self, vault: Arc<Vault>) -> Arc<Client> {
            let registry = self.root.path().join("clients/hosts.json");
            let pairing = Client::new(Some(registry.clone()), vault.clone());
            pairing
                .pair(PairRequest {
                    host_id: None,
                    base_url: Some(self.origin.clone()),
                    client_name: "Brain fixture".into(),
                })
                .await
                .unwrap();
            let client = Arc::new(Client::new(Some(registry), vault));
            client
                .set_local_directory(self.root.path().join("unselected"))
                .await
                .unwrap();
            client
        }
        async fn ready(&self) -> PairedTarget {
            let target = PairedTarget {
                host_id: self.host.data.lock().await.host_id,
                instance_id: Uuid::new_v4(),
                session_id: Uuid::new_v4(),
            };
            *self.instances.lock().unwrap() = vec![json!({
                "instance_id": target.instance_id, "session_id": target.session_id,
                "display_name": "Qwen", "upstream_model_id": "qwen38-test",
                "status": "ready", "configuration": {"max_context": 32768}
            })];
            target
        }
    }

    #[tokio::test]
    async fn cold_service_discovers_models_loaded_after_start_and_keeps_partial_success() {
        let fixture = Fixture::open().await;
        let vault = Arc::new(Vault::default());
        let client = fixture.paired(vault.clone()).await;
        let inference = NativeInferenceHost::new(client.clone());
        assert!(inference.models().await.unwrap().is_empty());
        let target = fixture.ready().await;
        let models = inference.models().await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].target, target);
        assert_eq!(models[0].model, "qwen38-test");
        assert_eq!(models[0].context_tokens, 32768);

        let unavailable = Fixture::open().await;
        unavailable.ready().await;
        client
            .pair(PairRequest {
                host_id: None,
                base_url: Some(unavailable.origin.clone()),
                client_name: "Second Host".into(),
            })
            .await
            .unwrap();
        let saved = client
            .registered()
            .await
            .unwrap()
            .into_iter()
            .find(|host| host.host_id != target.host_id)
            .unwrap();
        assert_eq!(inference.models().await.unwrap().len(), 2);
        vault.delete(saved.client_id).await.unwrap();
        let models = inference.models().await.unwrap();
        assert_eq!(
            models.len(),
            1,
            "a failed connection must not advertise its old ready snapshot"
        );
        assert_eq!(
            models[0].target, target,
            "one unavailable saved Host must not hide another Host's ready model"
        );
        let saved = client
            .registered()
            .await
            .unwrap()
            .into_iter()
            .find(|host| host.host_id == target.host_id)
            .unwrap();
        vault.delete(saved.client_id).await.unwrap();
        assert!(
            inference
                .models()
                .await
                .unwrap_err()
                .contains("credential absent"),
            "failed authorization must not retain either previously ready model"
        );
    }

    #[tokio::test]
    async fn discovery_reports_credential_and_poll_failures_instead_of_empty_models() {
        let fixture = Fixture::open().await;
        let vault = Arc::new(Vault::default());
        let client = fixture.paired(vault.clone()).await;
        let saved = client.registered().await.unwrap().remove(0);
        let token = vault.0.lock().unwrap().remove(&saved.client_id).unwrap();
        let inference = NativeInferenceHost::new(client);
        let error = inference.models().await.unwrap_err();
        assert!(
            error.contains("Brain Host") && error.contains("credential absent"),
            "{error}"
        );
        vault.set(saved.client_id, &token).await.unwrap();
        fixture.server.abort();
        let error = inference.models().await.unwrap_err();
        assert!(
            error.contains("Brain Host") && error.contains("Could not discover"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn local_owner_attachment_discovers_ready_model_without_vault_access() {
        let fixture = Fixture::open().await;
        let target = fixture.ready().await;
        let vault = Arc::new(Vault::default());
        let client = Arc::new(Client::new(
            Some(fixture.root.path().join("clients/hosts.json")),
            vault.clone(),
        ));
        client
            .initialize_from_owner(&Owner::Service {
                directory: fixture.host.directory.clone(),
                origin: fixture.origin.clone(),
            })
            .await
            .unwrap();
        let inference = NativeInferenceHost::new(client);
        assert_eq!(inference.models().await.unwrap()[0].target, target);
        assert_eq!(vault.1.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn saved_brain_dispatch_connects_cold_service_and_rejects_restarted_session() {
        let fixture = Fixture::open().await;
        let target = fixture.ready().await;
        let client = fixture.paired(Arc::new(Vault::default())).await;
        let inference = NativeInferenceHost::new(client);
        // No preceding models() call: a persisted assignment is the first use.
        let response = inference
            .request(&target, "/v1/chat/completions", json!({}))
            .await
            .unwrap();
        assert_eq!(
            response.status, 400,
            "real Host rejects the CPU-only fixture's absent Engine"
        );
        assert_eq!(
            *fixture.inference_sessions.lock().unwrap(),
            vec![target.session_id.to_string()]
        );
        let (first, second) = tokio::join!(
            inference.request(&target, "/v1/chat/completions", json!({})),
            inference.request(&target, "/v1/chat/completions", json!({}))
        );
        assert_eq!(first.unwrap().status, 400);
        assert_eq!(second.unwrap().status, 400);
        fixture.instances.lock().unwrap()[0]["session_id"] = Uuid::new_v4().to_string().into();
        let error = inference
            .request(&target, "/v1/chat/completions", json!({}))
            .await
            .err()
            .expect("a restarted target must fail");
        assert!(error.contains("restarted"), "{error}");
        assert_eq!(
            fixture.inference_sessions.lock().unwrap().len(),
            3,
            "a saved assignment must not silently select the new ready session"
        );
    }
}
