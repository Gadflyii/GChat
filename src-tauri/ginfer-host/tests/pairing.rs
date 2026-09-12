use ginfer_host::{service::Host, transport::pinned_client};
use std::sync::Arc;

#[tokio::test]
async fn tls_pairing_authentication_replay_revocation_and_persistence() {
    let directory = tempfile::tempdir().unwrap();
    let host = Host::open(
        directory.path().into(),
        "Test host".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    let (fingerprint, acceptor) = {
        let data = host.data.lock().await;
        (
            data.certificate.fingerprint(),
            data.certificate.acceptor().unwrap(),
        )
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("https://{}", listener.local_addr().unwrap());
    let server_host = Arc::clone(&host);
    let server = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let host = server_host.clone();
            tokio::spawn(async move {
                if let Ok(tls) = acceptor.accept(socket).await {
                    let _ = hyper::server::conn::Http::new()
                        .serve_connection(
                            tls,
                            hyper::service::service_fn(move |req| host.clone().route(req)),
                        )
                        .await;
                }
            });
        }
    });
    let client = pinned_client(&fingerprint).unwrap();
    let launcher = ginfer_host::launcher::LocalControl::open(directory.path(), &base).unwrap();
    let local_snapshot = launcher.snapshot().await.unwrap();
    assert_eq!(local_snapshot["display_name"], "Test host");
    assert!(local_snapshot.get("pairing_admin_token").is_none());
    let scanned = launcher
        .request("/host/v1/scan", Some(serde_json::json!({})))
        .await
        .unwrap();
    assert_eq!(scanned["host_id"], local_snapshot["host_id"]);
    let external = tempfile::tempdir().unwrap();
    let artifact_path = external.path().join("model.ginfer");
    let metadata =
        serde_json::json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},
        "tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]})
        .to_string();
    let mut artifact = b"NINFER\0\x03".to_vec();
    artifact.extend((metadata.len() as u64).to_le_bytes());
    artifact.extend(metadata.as_bytes());
    artifact.resize(4096, 0);
    std::fs::write(&artifact_path, &artifact).unwrap();
    let registered = launcher.register_model(&artifact_path).await.unwrap();
    assert_eq!(registered.path, artifact_path.canonicalize().unwrap());
    assert_eq!(
        launcher.register_model(&artifact_path).await.unwrap().id,
        registered.id
    );
    assert_eq!(std::fs::read(&artifact_path).unwrap(), artifact);
    let wrong = pinned_client(&"00".repeat(32)).unwrap();
    assert!(wrong
        .get(format!("{base}/.well-known/ginfer"))
        .send()
        .await
        .is_err());
    assert_eq!(
        client
            .get(format!("{base}/host/v1/snapshot"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let code = host.enable_pairing().await;
    let body = serde_json::json!({"code":code,"client_name":"Test client"});
    let paired = client
        .post(format!("{base}/host/v1/pair"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(paired.status(), 200);
    let paired: serde_json::Value = paired.json().await.unwrap();
    let token = paired["token"].as_str().unwrap();
    assert_eq!(
        client
            .post(format!("{base}/host/v1/local-artifacts"))
            .bearer_auth(token)
            .json(&serde_json::json!({"path":artifact_path}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let host_id = host.data.lock().await.host_id;
    assert!(
        ginfer_host::transport::host_snapshot_at(&base, &fingerprint, token, host_id)
            .await
            .is_ok()
    );
    assert!(ginfer_host::transport::host_snapshot_at(
        &base,
        &fingerprint,
        token,
        uuid::Uuid::new_v4()
    )
    .await
    .is_err());
    assert!(
        ginfer_host::transport::host_snapshot_at(&base, &"00".repeat(32), token, host_id)
            .await
            .is_err()
    );
    assert_eq!(
        client
            .post(format!("{base}/host/v1/pairing"))
            .bearer_auth(token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(format!("{base}/host/v1/pairing"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let administrator = host.data.lock().await.pairing_admin_token.clone();
    let activated = client
        .post(format!("{base}/host/v1/pairing"))
        .bearer_auth(&administrator)
        .send()
        .await
        .unwrap();
    assert_eq!(activated.status(), 200);
    let activation: serde_json::Value = activated.json().await.unwrap();
    assert_eq!(activation["certificate_sha256"], fingerprint);
    assert_eq!(activation["code"].as_str().unwrap().len(), 8);
    let activation_command = tokio::process::Command::new(env!("CARGO_BIN_EXE_ginfer-host"))
        .arg("--data-dir")
        .arg(directory.path())
        .arg("--request-pairing")
        .arg("--host-url")
        .arg(&base)
        .output()
        .await
        .unwrap();
    assert!(
        activation_command.status.success(),
        "{}",
        String::from_utf8_lossy(&activation_command.stderr)
    );
    let display = String::from_utf8_lossy(&activation_command.stdout);
    assert!(display.contains(&fingerprint));
    assert!(display.contains("Pairing code (5 minutes):"));
    assert!(!display.contains(&administrator));
    // Re-enabling pairing invalidates the old code; a normal paired client still works.
    assert_eq!(
        client
            .post(format!("{base}/host/v1/pair"))
            .json(&body)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let snapshot: serde_json::Value = client
        .get(format!("{base}/host/v1/snapshot"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(snapshot["display_name"], "Test host");
    assert!(snapshot.get("certificate").is_none());
    let saved = std::fs::read_to_string(directory.path().join("host.json")).unwrap();
    assert!(!saved.contains(token));
    let reloaded = Host::open(
        directory.path().into(),
        "Ignored on restart".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap();
    assert_eq!(
        host.data.lock().await.host_id,
        reloaded.data.lock().await.host_id
    );
    assert_eq!(
        reloaded.data.lock().await.certificate.fingerprint(),
        fingerprint
    );
    let request = hyper::Request::builder()
        .header("authorization", format!("Bearer {token}"))
        .body(hyper::Body::empty())
        .unwrap();
    assert!(reloaded.authenticated(&request).await);
    let client_id = paired["client_id"].as_str().unwrap();
    assert_eq!(
        client
            .delete(format!("{base}/host/v1/clients/{client_id}"))
            .bearer_auth(token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{base}/host/v1/snapshot"))
            .bearer_auth(token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    server.abort();
}
