#![cfg(unix)]

use ginfer_host::{
    client::{Client, CredentialFuture, CredentialStore},
    fleet::AuthorityLocator,
};
#[cfg(unix)]
use ginfer_host::{
    client::PairRequest,
    fleet::{FleetOperation, FleetPool, FleetPoolMember, FleetUpdate},
    fleet_client::FleetClient,
    engine_registry::InstanceRef,
    service::Host,
};
use std::{collections::BTreeMap, sync::{Arc, Mutex}};
use uuid::Uuid;

#[path = "common/resource_measurement.rs"]
#[cfg(unix)]
mod resource_measurement;

#[derive(Default)]
struct Vault(Mutex<BTreeMap<Uuid, String>>);
impl CredentialStore for Vault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(async move { self.0.lock().unwrap().get(&id).cloned().ok_or("fixture credential missing".into()) })
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        Box::pin(async move { self.0.lock().unwrap().insert(id, token.into()); Ok(()) })
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(async move { self.0.lock().unwrap().remove(&id); Ok(()) })
    }
}

#[cfg(unix)]
async fn tls(host: Arc<Host>) -> (String, tokio::task::JoinHandle<()>) {
    let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap());
    let job = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            let socket = tokio::select! {
                Some(_) = connections.join_next(), if !connections.is_empty() => continue,
                accepted = listener.accept() => accepted.unwrap().0,
            };
            let acceptor = acceptor.clone();
            let host = host.clone();
            connections.spawn(async move {
                if let Ok(tls) = acceptor.accept(socket).await {
                    let _ = hyper::server::conn::Http::new().serve_connection(tls,
                        hyper::service::service_fn(move |request| {
                            let host = host.clone();
                            async move { host.route(request).await }
                        })).await;
                }
            });
        }
    });
    (origin, job)
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "one fresh-process catalog-pass resource measurement"]
async fn measure_one_unchanged_catalog_read() {
    use std::os::unix::fs::MetadataExt;
    let root = tempfile::tempdir().unwrap();
    let host = Host::open(root.path().join("host"), "Registry resource fixture".into(),
        std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
    let (origin, server) = tls(host.clone()).await;
    host.lan_sharing.lock().await.standalone = Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let path = root.path().join("hosts.json");
    let client = Arc::new(Client::new(Some(path.clone()), Arc::new(Vault::default())));
    client.pair(PairRequest { host_id: None, base_url: Some(origin.clone()), client_name: "Resource fixture".into() }).await.unwrap();
    let saved = client.registered().await.unwrap()[0].clone();
    let fleet = FleetClient::new(client);
    fleet.configure(saved.host_id, AuthorityLocator { host_id: saved.host_id, origins: vec![origin], certificate_sha256: saved.certificate_sha256 }).await.unwrap();
    let initial = fleet.read().await.unwrap();
    fleet.update(FleetUpdate { expected_revision: initial.snapshot.unwrap().revision,
        operation: FleetOperation::SavePool { pool: FleetPool { id: Uuid::from_u128(20), name: "Fixture work pool".into(),
            members: vec![FleetPoolMember { instance: InstanceRef { host_id: saved.host_id, instance_id: Uuid::from_u128(21) }, worker_limit: 1 }] } } }).await.unwrap();
    let expected = fleet.read().await.unwrap().snapshot.unwrap();
    let original_bytes = std::fs::read(&path).unwrap();
    // Keeping the original inode open rules out inode reuse during replacement.
    let original_file = std::fs::File::open(&path).unwrap();
    let original_inode = original_file.metadata().unwrap().ino();
    let measurement = resource_measurement::Measurement::start();
    let report = fleet.read().await.unwrap();
    let counts = measurement.finish("registry_unchanged_catalog");
    assert!(report.connected);
    assert_eq!(report.snapshot, Some(expected));
    assert_eq!(std::fs::read(&path).unwrap(), original_bytes);
    let metadata = std::fs::metadata(&path).unwrap();
    let writes = u64::from(metadata.ino() != original_inode);
    println!("REGISTRY_PUBLICATION successful_atomic_replacements={writes} document_bytes={} published_bytes={} allocations={} allocated_bytes={} elapsed_ns={}", metadata.len(), writes * metadata.len(), counts.allocations, counts.allocated_bytes, counts.elapsed_ns);
    // Deliberately no candidate-only expectation: the same fixture runs on baseline.
    server.abort();
    let _ = server.await;
}
