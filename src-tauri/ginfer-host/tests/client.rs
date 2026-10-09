use ginfer_host::{
    client::{Client, CredentialFuture, CredentialStore, PairRequest, SavedHost},
    service::Host,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
#[derive(Default)]
struct Vault(Mutex<BTreeMap<Uuid, String>>);
impl CredentialStore for Vault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
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

#[derive(Default)]
struct StallingVault {
    inner: Vault,
    stalled: std::sync::atomic::AtomicBool,
}
impl CredentialStore for StallingVault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        if self.stalled.load(std::sync::atomic::Ordering::SeqCst) {
            Box::pin(std::future::pending())
        } else {
            self.inner.get(id)
        }
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        self.inner.set(id, token)
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        self.inner.delete(id)
    }
}
async fn tls(host: Arc<Host>) -> (String, tokio::task::JoinHandle<()>) {
    tls_with_snapshot_gate(host, None).await
}
#[derive(Default)]
struct SnapshotGate {
    armed: std::sync::atomic::AtomicBool,
    connections: std::sync::atomic::AtomicUsize,
    snapshot_override: Mutex<Option<Value>>,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
async fn tls_with_snapshot_gate(
    host: Arc<Host>,
    gate: Option<Arc<SnapshotGate>>,
) -> (String, tokio::task::JoinHandle<()>) {
    tls_at(host, gate, "127.0.0.1:0").await
}
async fn tls_at(
    host: Arc<Host>,
    gate: Option<Arc<SnapshotGate>>,
    address: &str,
) -> (String, tokio::task::JoinHandle<()>) {
    let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap());
    let job = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            let socket = tokio::select! {
                Some(_) = connections.join_next(), if !connections.is_empty() => continue,
                accepted = listener.accept() => accepted.unwrap().0,
            };
            if let Some(gate) = &gate {
                gate.connections.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            let acceptor = acceptor.clone();
            let host = host.clone();
            let gate = gate.clone();
            connections.spawn(async move {
                if let Ok(tls) = acceptor.accept(socket).await {
                    let _ = hyper::server::conn::Http::new()
                        .serve_connection(
                            tls,
                            hyper::service::service_fn(move |req: hyper::Request<hyper::Body>| {
                                let host = host.clone();
                                let gate = gate.clone();
                                async move {
                                    let snapshot = req.uri().path() == "/host/v1/snapshot";
                                    let mut response = host.route(req).await?;
                                    if let Some(gate) = gate.filter(|_| snapshot) {
                                        if response.status().is_success() {
                                            if let Some(body) = gate.snapshot_override.lock().unwrap().clone() {
                                                response = ginfer_host::service::json(hyper::StatusCode::OK, body);
                                            }
                                        }
                                        if gate
                                            .armed
                                            .swap(false, std::sync::atomic::Ordering::SeqCst)
                                        {
                                            gate.entered.notify_one();
                                            gate.release.notified().await;
                                        }
                                    }
                                    Ok::<_, std::convert::Infallible>(response)
                                }
                            }),
                        )
                        .await;
                }
            });
        }
    });
    (origin, job)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_batch_observes_hosts_concurrently_and_preserves_order_and_errors() {
    let root = tempfile::tempdir().unwrap();
    let vault = Arc::new(Vault::default());
    let client = Arc::new(Client::new(Some(root.path().join("shared/hosts.json")), vault.clone()));
    let mut ids = Vec::new();
    let mut gates = Vec::new();
    let mut servers = Vec::new();
    for index in 0..2 {
        let host = Host::open(root.path().join(format!("host-{index}")), format!("Host {index}"),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        let gate = Arc::new(SnapshotGate::default());
        let (origin, server) = tls_with_snapshot_gate(host.clone(), Some(gate.clone())).await;
        host.lan_sharing.lock().await.standalone = Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
        client.pair(PairRequest { host_id: None, base_url: Some(origin), client_name: "Batch client".into() }).await.unwrap();
        ids.push(host.data.lock().await.host_id);
        gates.push(gate);
        servers.push(server);
    }
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let offline_id = Uuid::new_v4();
    let offline_grant = Uuid::new_v4();
    let offline = SavedHost { host_id: offline_id, name: "Offline".into(),
        base_url: format!("https://{}", closed.local_addr().unwrap()), certificate_sha256: "ab".repeat(32),
        client_id: offline_grant };
    drop(closed);
    vault.set(offline_grant, "offline-token").await.unwrap();
    let imported = root.path().join("imported.json");
    std::fs::write(&imported, serde_json::to_vec(&vec![offline]).unwrap()).unwrap();
    client.import_legacy(&imported).await.unwrap();
    for gate in &gates { gate.armed.store(true, std::sync::atomic::Ordering::SeqCst); }
    let batch_client = client.clone();
    let batch_ids = vec![ids[1], offline_id, Uuid::new_v4(), ids[0]];
    let batch = tokio::spawn(async move { batch_client.snapshots(&batch_ids).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(gates[0].entered.notified(), gates[1].entered.notified());
    }).await.expect("both independent hosts must be observed before either is released");
    for gate in &gates { gate.release.notify_one(); }
    let result = batch.await.unwrap();
    assert_eq!(result[0].as_ref().unwrap()["host_id"], ids[1].to_string());
    assert!(result[1].as_ref().unwrap_err().is_offline());
    assert!(!result[2].as_ref().unwrap_err().is_offline());
    assert_eq!(result[3].as_ref().unwrap()["host_id"], ids[0].to_string());
    for server in servers { server.abort(); }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pinned_requests_reuse_connections_without_reusing_credentials_or_changed_pins() {
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(root.path().join("host"), "Pool fixture".into(),
        std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
    let gate = Arc::new(SnapshotGate::default());
    let (origin, server) = tls_with_snapshot_gate(host.clone(), Some(gate.clone())).await;
    host.lan_sharing.lock().await.standalone = Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let vault = Arc::new(Vault::default());
    let registry = root.path().join("shared/hosts.json");
    let client = Client::new(Some(registry.clone()), vault.clone());
    client.pair(PairRequest { host_id: None, base_url: Some(origin.clone()), client_name: "Pool client".into() }).await.unwrap();
    let saved = client.registered().await.unwrap().remove(0);
    let token = vault.get(saved.client_id).await.unwrap();
    client.snapshot(saved.host_id).await.unwrap();
    let warm_connections = gate.connections.load(std::sync::atomic::Ordering::SeqCst);
    for _ in 0..5 {
        client.snapshot(saved.host_id).await.unwrap();
        client.request_json(saved.host_id, reqwest::Method::GET, "/host/v1/clients", None).await.unwrap();
    }
    assert_eq!(gate.connections.load(std::sync::atomic::Ordering::SeqCst), warm_connections,
        "ten complete warm reads must reuse the enrolled transport's TLS connection");

    vault.set(saved.client_id, "revoked-token").await.unwrap();
    let unauthorized = client.snapshot(saved.host_id).await.unwrap_err();
    assert!(!unauthorized.is_offline());
    assert!(unauthorized.to_string().contains("401"));
    vault.set(saved.client_id, &token).await.unwrap();
    client.snapshot(saved.host_id).await.unwrap();

    let original = std::fs::read(&registry).unwrap();
    let mut changed: Value = serde_json::from_slice(&original).unwrap();
    changed["hosts"][0]["certificate_sha256"] = "00".repeat(32).into();
    std::fs::write(&registry, serde_json::to_vec(&changed).unwrap()).unwrap();
    let bad_pin = client.snapshot(saved.host_id).await.unwrap_err();
    assert!(!bad_pin.is_offline());
    assert!(bad_pin.to_string().contains("certificate has changed"));
    std::fs::write(&registry, original).unwrap();
    client.snapshot(saved.host_id).await.unwrap();
    let valid_snapshot = client.snapshot(saved.host_id).await.unwrap();
    let mut wrong_identity = valid_snapshot.clone();
    wrong_identity["host_id"] = Uuid::new_v4().to_string().into();
    let mut wrong_protocol = valid_snapshot;
    wrong_protocol["protocol_version"] = 2.into();
    for invalid in [wrong_identity, wrong_protocol, json!({"malformed":"snapshot"})] {
        *gate.snapshot_override.lock().unwrap() = Some(invalid);
        assert!(!client.snapshot(saved.host_id).await.unwrap_err().is_offline(),
            "authenticated identity, protocol and schema failures remain problems");
    }
    *gate.snapshot_override.lock().unwrap() = None;
    client.forget(saved.host_id).await.unwrap();
    assert!(client.snapshot(saved.host_id).await.is_err());
    client.pair(PairRequest { host_id: None, base_url: Some(origin), client_name: "Pool client".into() }).await.unwrap();
    let before_new_snapshot = gate.connections.load(std::sync::atomic::Ordering::SeqCst);
    client.snapshot(saved.host_id).await.unwrap();
    assert_eq!(gate.connections.load(std::sync::atomic::Ordering::SeqCst), before_new_snapshot + 1,
        "forget/re-pair retires the previous grant's transport pool");
    server.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_native_clients_share_enrollment_reload_forget_and_one_time_migration() {
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(
        root.path().join("host"),
        "Fixture host".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (origin, server) = tls(host.clone()).await;
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let vault = Arc::new(Vault::default());
    let registry = root.path().join("shared/hosts.json");
    let first = Client::new(Some(registry.clone()), vault.clone());
    let second = Client::new(Some(registry.clone()), vault.clone());
    let (installation_a, installation_b) =
        tokio::join!(first.installation_id(), second.installation_id());
    assert_eq!(installation_a.unwrap(), installation_b.unwrap());
    let authority = {
        let data = host.data.lock().await;
        ginfer_host::fleet::AuthorityLocator {
            host_id: data.host_id,
            origins: vec![origin.clone()],
            certificate_sha256: data.certificate.fingerprint(),
        }
    };
    let wrong = ginfer_host::fleet::AuthorityLocator {
        certificate_sha256: "00".repeat(32),
        ..authority.clone()
    };
    assert!(first.pair_locator(&wrong, "Shared desktop").await.is_err());
    assert!(
        host.data.lock().await.clients.is_empty(),
        "a wrong coordinator pin must reject before enrollment"
    );
    let request = || PairRequest {
        host_id: None,
        base_url: Some(origin.clone()),
        client_name: "Shared desktop".into(),
    };
    let (a, b) = tokio::join!(
        first.pair(request()),
        second.pair_locator(&authority, "Shared desktop")
    );
    a.unwrap();
    b.unwrap();
    let saved = first.registered().await.unwrap();
    assert_eq!(saved, second.registered().await.unwrap());
    assert_eq!(saved.len(), 1);
    let grant = saved[0].client_id;
    let host_id = saved[0].host_id;
    assert_eq!(
        host.data.lock().await.clients.len(),
        1,
        "concurrent apps must retain one issued grant"
    );
    let token = vault.get(grant).await.unwrap();
    assert!(!std::fs::read_to_string(&registry).unwrap().contains(&token));
    assert_eq!(
        first.snapshot(host_id).await.unwrap()["display_name"],
        "Fixture host"
    );
    let clients = second
        .request_json(host_id, reqwest::Method::GET, "/host/v1/clients", None)
        .await
        .unwrap();
    assert_eq!(clients["clients"][0]["client_id"], grant.to_string());
    assert!(clients["clients"][0]["last_seen_unix_ms"]
        .as_u64()
        .is_some());
    assert!(!clients.to_string().contains(&token));
    assert!(clients["clients"][0].get("token_verifier").is_none());
    let legacy = root.path().join("old/hosts.json");
    std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    let imported = SavedHost {
        host_id: Uuid::new_v4(),
        name: "Old grant".into(),
        base_url: "https://127.0.0.1:7443".into(),
        certificate_sha256: "ab".repeat(32),
        client_id: Uuid::new_v4(),
    };
    let bytes = serde_json::to_vec(&vec![saved[0].clone(), imported.clone()]).unwrap();
    std::fs::write(&legacy, &bytes).unwrap();
    first.import_legacy(&legacy).await.unwrap();
    assert_eq!(second.registered().await.unwrap().len(), 2);
    second.forget(imported.host_id).await.unwrap();
    first.import_legacy(&legacy).await.unwrap();
    assert_eq!(first.registered().await.unwrap(), saved);
    assert_eq!(
        std::fs::read(&legacy).unwrap(),
        bytes,
        "migration must preserve original metadata"
    );
    first
        .request_json(
            host_id,
            reqwest::Method::DELETE,
            &format!("/host/v1/clients/{grant}"),
            None,
        )
        .await
        .unwrap();
    assert!(second.snapshot(host_id).await.is_err());
    second.forget(host_id).await.unwrap();
    assert!(first.registered().await.unwrap().is_empty());
    assert!(vault.get(grant).await.is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(registry).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    server.abort();
}
#[tokio::test]
async fn local_administrator_identity_needs_no_vault_and_survives_restart() {
    let root = tempfile::tempdir().unwrap();
    let state = root.path().join("host");
    let host = Host::open(
        state.clone(),
        "Local".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (origin, server) = tls(host.clone()).await;
    let control = ginfer_host::launcher::LocalControl::open(&state, &origin).unwrap();
    let first = control
        .request("/host/v1/local-client", Some(json!({})))
        .await
        .unwrap();
    assert_eq!(
        first,
        control
            .request("/host/v1/local-client", Some(json!({})))
            .await
            .unwrap()
    );
    assert!(first.get("token").is_none());
    let id = first["client_id"]
        .as_str()
        .unwrap()
        .parse::<Uuid>()
        .unwrap();
    assert_ne!(id, host.data.lock().await.host_id);
    let snapshot = control.snapshot().await.unwrap();
    assert_eq!(snapshot["clients"][0]["local"], true);
    assert_eq!(snapshot["clients"][0]["client_id"], id.to_string());
    assert!(snapshot["clients"][0].get("token_verifier").is_none());
    let reloaded = Host::open(
        state,
        "Ignored".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    assert_eq!(reloaded.data.lock().await.local_client_id, Some(id));
    let anonymous =
        ginfer_host::transport::pinned_client(&host.data.lock().await.certificate.fingerprint())
            .unwrap();
    assert_eq!(
        anonymous
            .post(format!("{origin}/host/v1/local-client"))
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let admin = host.data.lock().await.pairing_admin_token.clone();
    assert!(!snapshot.to_string().contains(&admin));
    server.abort();
}

#[cfg(unix)]
#[tokio::test]
async fn inference_usage_releases_on_completion_cancellation_and_rejection() {
    use hyper::{Body, Request, Response};
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let engine = root.path().join("inert-engine");
    std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
    let models = root.path().join("models");
    std::fs::create_dir(&models).unwrap();
    let directory=json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},"tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
    let mut artifact = b"NINFER\0\x03".to_vec();
    artifact.extend((directory.len() as u64).to_le_bytes());
    artifact.extend(directory.as_bytes());
    artifact.resize(4096, 0);
    std::fs::write(models.join("model.ginfer"), artifact).unwrap();
    let host = Host::open(
        root.path().join("host"),
        "Fixture".into(),
        engine,
        vec![models],
        vec![],
        vec![ginfer_host::service::Gpu {
            uuid: "GPU-inert".into(),
            name: "Inert".into(),
            display_name: None,
            memory_mib: 32768,
            compute_capability: Some("12.0".into()),
        }],
    )
    .await
    .unwrap();
    let (host_origin, host_server) = tls(host.clone()).await;
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&host_origin).unwrap().port().unwrap());
    let paired = host
        .clone()
        .route(
            Request::post("/host/v1/pair")
                .body(Body::from(
                    json!({"client_name":"Usage fixture"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let paired: Value =
        serde_json::from_slice(&hyper::body::to_bytes(paired.into_body()).await.unwrap()).unwrap();
    let token = paired["token"].as_str().unwrap();
    let request = ginfer_host::service::LaunchRequest {
        instance_id: None,
        qualified_profile_id: None,
        model_id: host.inventory.read().await[0].id,
        gpu_uuids: vec!["GPU-inert".into()],
        max_context: 2048,
        concurrency: 1,
        options: ginfer_host::engine_host::LaunchOptions::default(),
    };
    let id = host.launch(request).await.unwrap();
    let port = host
        .processes
        .lock()
        .await
        .instances()
        .find(|i| i.instance_id == id)
        .unwrap()
        .launch
        .port;
    let pending = Arc::new(Mutex::new(None::<hyper::body::Sender>));
    let capture = pending.clone();
    let upstream = hyper::Server::bind(&([127, 0, 0, 1], port).into()).serve(
        hyper::service::make_service_fn(move |_| {
            let pending = capture.clone();
            async move {
                Ok::<_, std::convert::Infallible>(hyper::service::service_fn(
                    move |req: Request<Body>| {
                        let pending = pending.clone();
                        async move {
                            let body = match req.uri().path() {
                                "/health" => Body::from("{}"),
                                "/v1/models" => Body::from(
                                    json!({"data":[{"id":"muse-glimmer-30b/nvfp4"}]}).to_string(),
                                ),
                                _ => {
                                    let (tx, body) = Body::channel();
                                    *pending.lock().unwrap() = Some(tx);
                                    body
                                }
                            };
                            Ok::<_, std::convert::Infallible>(Response::new(body))
                        }
                    },
                ))
            }
        }),
    );
    let server = tokio::spawn(upstream);
    host.processes.lock().await.refresh().await.unwrap();
    let path = format!("/host/v1/instances/{id}/inference/v1/chat/completions");
    let call = || {
        Request::post(&path)
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap()
    };
    let response = host.clone().route(call()).await.unwrap();
    assert_eq!(response.status(), 200);
    let snapshot = host.snapshot().await;
    assert_eq!(snapshot["instances"][0]["active_requests"], 1);
    assert_eq!(snapshot["clients"][0]["active_requests"], 1);
    drop(response);
    assert_eq!(
        host.snapshot().await["clients"][0]["active_requests"],
        0,
        "cancelling downstream releases its lease"
    );
    let response = host.clone().route(call()).await.unwrap();
    let mut sender = pending.lock().unwrap().take().unwrap();
    sender.send_data("done".into()).await.unwrap();
    drop(sender);
    assert_eq!(
        hyper::body::to_bytes(response.into_body()).await.unwrap(),
        "done"
    );
    assert_eq!(host.snapshot().await["clients"][0]["active_requests"], 0);
    let mut rejected = call();
    rejected.headers_mut().insert(
        "x-ginfer-session-id",
        Uuid::new_v4().to_string().parse().unwrap(),
    );
    assert_eq!(host.clone().route(rejected).await.unwrap().status(), 400);
    assert_eq!(
        host.snapshot().await["instances"][0]["active_requests"],
        0,
        "rejected session must release its lease"
    );
    host.processes.lock().await.shutdown().await.unwrap();
    server.abort();
    host_server.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delayed_snapshot_merges_other_apps_changes_and_rejects_replaced_or_forgotten_hosts() {
    use std::sync::atomic::Ordering;
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(
        root.path().join("host-a"),
        "Before".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let gate = Arc::new(SnapshotGate::default());
    let (origin, server) = tls_with_snapshot_gate(host.clone(), Some(gate.clone())).await;
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let other = Host::open(
        root.path().join("host-b"),
        "Other".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (other_origin, other_server) = tls(other.clone()).await;
    other.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&other_origin).unwrap().port().unwrap());
    let vault = Arc::new(Vault::default());
    let path = root.path().join("shared/hosts.json");
    let first = Arc::new(Client::new(Some(path.clone()), vault.clone()));
    let second = Client::new(Some(path), vault);
    first
        .pair(PairRequest {
            host_id: None,
            base_url: Some(origin.clone()),
            client_name: "Desktop".into(),
        })
        .await
        .unwrap();
    let original = first.registered().await.unwrap()[0].clone();
    let forgotten = SavedHost {
        host_id: Uuid::new_v4(),
        name: "Forgotten".into(),
        base_url: "https://127.0.0.1:7443".into(),
        certificate_sha256: "ab".repeat(32),
        client_id: Uuid::new_v4(),
    };
    let legacy = root.path().join("legacy.json");
    std::fs::write(
        &legacy,
        serde_json::to_vec(&vec![forgotten.clone()]).unwrap(),
    )
    .unwrap();
    first.import_legacy(&legacy).await.unwrap();
    host.data.lock().await.name = "After".into();
    host.save().await.unwrap();
    gate.armed.store(true, Ordering::SeqCst);
    let poll = {
        let first = first.clone();
        tokio::spawn(async move { first.snapshot(original.host_id).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), gate.entered.notified())
        .await
        .unwrap();
    second
        .pair(PairRequest {
            host_id: None,
            base_url: Some(other_origin),
            client_name: "Desktop".into(),
        })
        .await
        .unwrap();
    second.forget(forgotten.host_id).await.unwrap();
    let authority = ginfer_host::fleet::AuthorityLocator {
        host_id: original.host_id,
        origins: vec![origin.clone()],
        certificate_sha256: original.certificate_sha256.clone(),
    };
    second.set_fleet_authority(authority.clone()).await.unwrap();
    let cache:ginfer_host::fleet::FleetSnapshot=serde_json::from_value(json!({"schema":"ginfer-fleet-v1","authority":authority,"revision":1,"members":[{"host":authority,"display_name":"After"}],"pools":[],"assignments":[]})).unwrap();
    second.save_fleet_snapshot(cache.clone()).await.unwrap();
    gate.release.notify_one();
    assert_eq!(poll.await.unwrap().unwrap()["display_name"], "After");
    let current = first.registered().await.unwrap();
    assert_eq!(current.len(), 2);
    assert!(current.iter().all(|host| host.host_id != forgotten.host_id));
    assert_eq!(first.fleet_authority().await.unwrap(), Some(authority));
    assert_eq!(first.cached_fleet().await.unwrap(), Some(cache));
    // The import receipt must also survive this metadata merge.
    second.import_legacy(&legacy).await.unwrap();
    assert_eq!(second.registered().await.unwrap().len(), 2);
    gate.armed.store(true, Ordering::SeqCst);
    let poll = {
        let first = first.clone();
        tokio::spawn(async move { first.snapshot(original.host_id).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), gate.entered.notified())
        .await
        .unwrap();
    second.forget(original.host_id).await.unwrap();
    second
        .pair(PairRequest {
            host_id: None,
            base_url: Some(origin),
            client_name: "Replacement".into(),
        })
        .await
        .unwrap();
    let replacement = second
        .registered()
        .await
        .unwrap()
        .into_iter()
        .find(|host| host.host_id == original.host_id)
        .unwrap();
    assert_ne!(replacement.client_id, original.client_id);
    gate.release.notify_one();
    assert!(poll
        .await
        .unwrap()
        .unwrap_err()
        .to_string()
        .contains("registration changed"));
    assert_eq!(
        first
            .registered()
            .await
            .unwrap()
            .into_iter()
            .find(|host| host.host_id == original.host_id)
            .unwrap(),
        replacement
    );
    gate.armed.store(true, Ordering::SeqCst);
    let poll = {
        let first = first.clone();
        tokio::spawn(async move { first.snapshot(original.host_id).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), gate.entered.notified())
        .await
        .unwrap();
    second.forget(original.host_id).await.unwrap();
    gate.release.notify_one();
    assert!(poll.await.unwrap().is_err());
    assert!(first
        .registered()
        .await
        .unwrap()
        .iter()
        .all(|host| host.host_id != original.host_id));
    server.abort();
    other_server.abort();
}

#[tokio::test]
async fn manager_first_import_uses_registered_owners_configured_data_and_preserves_grants_once() {
    let root = tempfile::tempdir().unwrap();
    let provider = root.path().join("custom-gchat-data/ginfer");
    std::fs::create_dir_all(&provider).unwrap();
    let host = SavedHost {
        host_id: Uuid::new_v4(),
        name: "Already paired".into(),
        base_url: "https://127.0.0.1:7443".into(),
        certificate_sha256: "ab".repeat(32),
        client_id: Uuid::new_v4(),
    };
    let source = provider.join("hosts.json");
    let bytes = serde_json::to_vec(&vec![host.clone()]).unwrap();
    std::fs::write(&source, &bytes).unwrap();
    let executable = std::env::current_exe().unwrap();
    let owner =
        ginfer_host::local_host_registry::Owner::Desktop(ginfer_host::local_host::LocalHost {
            binary: executable.clone(),
            engine: executable,
            engine_runtimes: Default::default(),
            directory: provider.join("host"),
            desktop_provider: Some(provider),
            models: vec![],
            artifact_sets: vec![],
            name: "Local".into(),
            nvidia_smi: "nvidia-smi".into(),
            listen: "127.0.0.1:7443".parse().unwrap(),
        });
    let vault = Arc::new(Vault::default());
    vault
        .set(host.client_id, "existing grant credential")
        .await
        .unwrap();
    let manager = Client::new(Some(root.path().join("shared/hosts.json")), vault.clone());
    manager.initialize_from_owner(&owner).await.unwrap();
    assert_eq!(manager.registered().await.unwrap(), vec![host.clone()]);
    assert_eq!(
        manager.secret(host.client_id).await.unwrap(),
        "existing grant credential"
    );
    assert_eq!(std::fs::read(&source).unwrap(), bytes);
    assert!(
        !root.path().join("custom-gchat-data/ginfer/host").exists(),
        "import must not start or create a local service"
    );
    manager.forget(host.host_id).await.unwrap();
    manager.initialize_from_owner(&owner).await.unwrap();
    assert!(
        manager.registered().await.unwrap().is_empty(),
        "later manager launches must not resurrect forgotten grants"
    );
    assert_eq!(std::fs::read(source).unwrap(), bytes);
}

#[tokio::test]
async fn typed_requests_distinguish_stopped_hosts_from_vault_auth_and_pin_problems() {
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(
        root.path().join("host"),
        "Typed failures".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (origin, server) = tls(host.clone()).await;
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let vault = Arc::new(Vault::default());
    let client = Client::new(Some(root.path().join("registry.json")), vault.clone());
    client
        .pair(PairRequest {
            host_id: None,
            base_url: Some(origin),
            client_name: "Typed fixture".into(),
        })
        .await
        .unwrap();
    let saved = client.registered().await.unwrap()[0].clone();
    let token = vault.get(saved.client_id).await.unwrap();
    assert!(client.snapshot(saved.host_id).await.is_ok());
    vault.delete(saved.client_id).await.unwrap();
    let missing = client.snapshot(saved.host_id).await.unwrap_err();
    assert!(!missing.is_offline());
    assert!(missing.to_string().contains("credential absent"));
    vault.set(saved.client_id, "revoked token").await.unwrap();
    let auth = client
        .request_json(saved.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
        .await
        .unwrap_err();
    assert!(!auth.is_offline());
    assert!(auth.to_string().contains("401"));
    assert!(!client
        .snapshot(saved.host_id)
        .await
        .unwrap_err()
        .is_offline());
    assert!(client
        .command("snapshot", json!({"host_id":saved.host_id}))
        .await
        .unwrap_err()
        .contains("401"));
    vault.set(saved.client_id, &token).await.unwrap();
    let mut wrong_pin = saved.clone();
    wrong_pin.certificate_sha256 = "00".repeat(32);
    let legacy = root.path().join("bad-pin-legacy.json");
    std::fs::write(&legacy, serde_json::to_vec(&vec![wrong_pin]).unwrap()).unwrap();
    let bad_pin = Client::new(Some(root.path().join("bad-pin-registry.json")), vault);
    bad_pin.import_legacy(&legacy).await.unwrap();
    let pin = bad_pin.snapshot(saved.host_id).await.unwrap_err();
    assert!(
        !pin.is_offline(),
        "A failed TLS pin must remain a problem: {pin}"
    );
    assert!(pin.to_string().contains("certificate has changed"));
    assert!(!bad_pin
        .request(saved.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
        .await
        .unwrap_err()
        .is_offline());
    assert!(!bad_pin
        .request_json(saved.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
        .await
        .unwrap_err()
        .is_offline());
    server.abort();
    let _ = server.await;
    let offline = client.snapshot(saved.host_id).await.unwrap_err();
    assert!(
        offline.is_offline(),
        "Stopped TLS fixture must report availability: {offline}"
    );
    assert!(!offline.to_string().is_empty());
    assert!(client
        .request(saved.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
        .await
        .unwrap_err()
        .is_offline());
    assert!(client
        .request_json(saved.host_id, reqwest::Method::GET, "/host/v1/fleet", None)
        .await
        .unwrap_err()
        .is_offline());
}

#[tokio::test]
async fn fleet_deadline_keeps_a_stalled_vault_actionable_and_preserves_cached_pools() {
    use ginfer_host::{
        engine_registry::InstanceRef,
        fleet::{AuthorityLocator, FleetOperation, FleetPool, FleetPoolMember, FleetUpdate},
        fleet_client::{FleetClient, FleetHostPhase},
    };
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(
        root.path().join("host"),
        "Vault fixture".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (origin, server) = tls(host.clone()).await;
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let vault = Arc::new(StallingVault::default());
    let client = Arc::new(Client::new(
        Some(root.path().join("registry.json")),
        vault.clone(),
    ));
    client
        .pair(PairRequest {
            host_id: None,
            base_url: Some(origin.clone()),
            client_name: "Vault fixture".into(),
        })
        .await
        .unwrap();
    let saved = client.registered().await.unwrap()[0].clone();
    let fleet = FleetClient::new(client);
    fleet
        .configure(
            saved.host_id,
            AuthorityLocator {
                host_id: saved.host_id,
                origins: vec![origin],
                certificate_sha256: saved.certificate_sha256,
            },
        )
        .await
        .unwrap();
    let initial = fleet.read().await.unwrap();
    assert!(initial.connected);
    let cached = fleet
        .update(FleetUpdate {
            expected_revision: initial.snapshot.unwrap().revision,
            operation: FleetOperation::SavePool {
                pool: FleetPool {
                    id: Uuid::new_v4(),
                    name: "Cached workers".into(),
                    members: vec![FleetPoolMember {
                        instance: InstanceRef {
                            host_id: saved.host_id,
                            instance_id: Uuid::new_v4(),
                        },
                        worker_limit: 1,
                    }],
                },
            },
        })
        .await
        .unwrap();
    vault
        .stalled
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let started = std::time::Instant::now();
    let report = tokio::time::timeout(std::time::Duration::from_secs(20), fleet.read())
        .await
        .expect("The existing ten-second fleet deadline must include credential lookup")
        .unwrap();
    assert!(started.elapsed() >= std::time::Duration::from_secs(10));
    assert!(!report.connected);
    assert!(report.error.is_none());
    assert_eq!(report.snapshot, Some(cached.clone()));
    assert_eq!(report.host_issues.len(), 1);
    let issue = &report.host_issues[0];
    assert_eq!(issue.host_id, saved.host_id);
    assert_eq!(issue.phase, FleetHostPhase::Coordinator);
    assert!(
        !issue.offline,
        "A stalled credential store is not an offline host"
    );
    assert!(issue.message.contains("secure storage"));
    vault
        .stalled
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let recovered = fleet.read().await.unwrap();
    assert!(recovered.connected);
    assert!(recovered.host_issues.is_empty());
    assert_eq!(recovered.snapshot, Some(cached));
    server.abort();
}

#[tokio::test]
async fn fleet_reports_exact_offline_hosts_and_recovers_without_electing_or_losing_cache() {
    use ginfer_host::{
        fleet::{AuthorityLocator, FleetMember, FleetOperation, FleetUpdate},
        fleet_client::{FleetClient, FleetHostPhase},
    };
    let root = tempfile::tempdir().unwrap();
    let coordinator = Host::open(
        root.path().join("coordinator"),
        "Coordinator".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let member = Host::open(
        root.path().join("member"),
        "Member".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (coordinator_origin, coordinator_server) = tls(coordinator.clone()).await;
    let (member_origin, member_server) = tls(member.clone()).await;
    coordinator.lan_sharing.lock().await.standalone = Some(
        reqwest::Url::parse(&coordinator_origin)
            .unwrap()
            .port()
            .unwrap(),
    );
    member.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&member_origin).unwrap().port().unwrap());
    let vault = Arc::new(Vault::default());
    let client = Arc::new(Client::new(
        Some(root.path().join("registry.json")),
        vault.clone(),
    ));
    for origin in [&coordinator_origin, &member_origin] {
        client
            .pair(PairRequest {
                host_id: None,
                base_url: Some(origin.clone()),
                client_name: "Fleet fixture".into(),
            })
            .await
            .unwrap();
    }
    let registrations = client.registered().await.unwrap();
    let coordinator_id = coordinator.data.lock().await.host_id;
    let member_id = member.data.lock().await.host_id;
    let member_fingerprint = member.data.lock().await.certificate.fingerprint();
    let authority = AuthorityLocator {
        host_id: coordinator_id,
        origins: vec![coordinator_origin],
        certificate_sha256: coordinator.data.lock().await.certificate.fingerprint(),
    };
    let fleet = FleetClient::new(client.clone());
    fleet
        .configure(coordinator_id, authority.clone())
        .await
        .unwrap();
    let initial = fleet.read().await.unwrap();
    let enrolled = fleet
        .update(FleetUpdate {
            expected_revision: initial.snapshot.unwrap().revision,
            operation: FleetOperation::EnrollMember {
                member: FleetMember {
                    host: AuthorityLocator {
                        host_id: member_id,
                        origins: vec![member_origin.clone()],
                        certificate_sha256: member_fingerprint,
                    },
                    display_name: "Member".into(),
                },
            },
        })
        .await
        .unwrap();
    member_server.abort();
    let _ = member_server.await;
    let report = fleet.read().await.unwrap();
    assert!(report.connected);
    assert!(report.error.is_none());
    assert_eq!(report.snapshot, Some(enrolled.clone()));
    assert_eq!(report.host_issues.len(), 1);
    assert_eq!(report.host_issues[0].host_id, member_id);
    assert_eq!(report.host_issues[0].phase, FleetHostPhase::Membership);
    assert!(report.host_issues[0].offline);
    let issue = serde_json::to_value(&report.host_issues[0]).unwrap();
    assert_eq!(issue["phase"], "membership");
    let address = member_origin.trim_start_matches("https://");
    let (_, member_server) = tls_at(member.clone(), None, address).await;
    let recovered = fleet.read().await.unwrap();
    assert!(recovered.connected);
    assert!(recovered.host_issues.is_empty());
    coordinator_server.abort();
    let _ = coordinator_server.await;
    let report = fleet.read().await.unwrap();
    assert!(!report.connected);
    assert!(report.error.is_none());
    assert_eq!(report.authority, Some(authority.clone()));
    assert_eq!(report.snapshot, Some(enrolled));
    assert_eq!(report.host_issues.len(), 1);
    assert_eq!(report.host_issues[0].host_id, coordinator_id);
    assert_eq!(report.host_issues[0].phase, FleetHostPhase::Coordinator);
    assert!(report.host_issues[0].offline);
    // A new client discovers a member's published locator while retaining the
    // independently failed coordinator probe as an issue for that exact host.
    let legacy = root.path().join("discovery-legacy.json");
    std::fs::write(&legacy, serde_json::to_vec(&registrations).unwrap()).unwrap();
    let discovering = Arc::new(Client::new(
        Some(root.path().join("discovery-registry.json")),
        vault,
    ));
    discovering.import_legacy(&legacy).await.unwrap();
    let report = FleetClient::new(discovering).read().await.unwrap();
    assert!(!report.connected);
    assert!(report.error.is_none());
    assert_eq!(report.authority, Some(authority));
    assert!(report
        .host_issues
        .iter()
        .any(|issue| issue.host_id == coordinator_id
            && issue.phase == FleetHostPhase::Discovery
            && issue.offline));
    assert!(report
        .host_issues
        .iter()
        .any(|issue| issue.host_id == coordinator_id
            && issue.phase == FleetHostPhase::Coordinator
            && issue.offline));
    member_server.abort();
}
