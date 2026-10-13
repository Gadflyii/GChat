use super::*;
use crate::fleet::{AuthorityLocator, FleetMember, FleetSnapshot, FLEET_SCHEMA};

fn catalog() -> FleetSnapshot {
    let authority = AuthorityLocator {
        host_id: Uuid::from_u128(1),
        origins: vec!["https://127.0.0.1:7443".into()],
        certificate_sha256: "ab".repeat(32),
    };
    FleetSnapshot {
        schema: FLEET_SCHEMA.into(),
        authority: authority.clone(),
        revision: 1,
        members: vec![FleetMember { host: authority, display_name: "Fixture".into() }],
        pools: vec![], assignments: vec![], legacy_imports: BTreeMap::new(),
    }
}

struct MetadataOnlyVault;
impl CredentialStore for MetadataOnlyVault {
    fn get(&self, _: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(async { Err("metadata operation accessed credentials".into()) })
    }
    fn set<'a>(&'a self, _: Uuid, _: &'a str) -> CredentialFuture<'a, ()> {
        Box::pin(async { Err("metadata operation changed credentials".into()) })
    }
    fn delete(&self, _: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(async { Err("metadata operation deleted credentials".into()) })
    }
}

#[tokio::test]
async fn inference_rejects_restarted_session_before_accessing_credentials() {
    use crate::engine_registry::{
        HostSnapshot, InstanceRef, InstanceSnapshot, InstanceStatus, HOST_PROTOCOL_VERSION,
    };
    let root = tempfile::tempdir().unwrap();
    let client = Client::new(
        Some(root.path().join("hosts.json")),
        Arc::new(MetadataOnlyVault),
    );
    client.initialize().await.unwrap();
    let host_id = Uuid::new_v4();
    let instance_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    {
        let mut state = client.state.lock().await;
        let host = SavedHost {
            host_id,
            name: "Fixture".into(),
            base_url: "https://127.0.0.1:7443".into(),
            certificate_sha256: "ab".repeat(32),
            client_id: Uuid::new_v4(),
        };
        state.registry.register_paired(registration(&host));
        state.saved.insert(host_id, host);
        persist(&state).unwrap();
        let connection = state.registry.connect(host_id).unwrap();
        state
            .registry
            .reconcile(
                connection,
                HostSnapshot {
                    protocol_version: HOST_PROTOCOL_VERSION,
                    host_id,
                    boot_id: Uuid::new_v4(),
                    revision: 1,
                    display_name: "Fixture".into(),
                    hardware_profile: None,
                    instances: vec![InstanceSnapshot {
                        instance_id,
                        session_id: Some(session_id),
                        display_name: "Qwen".into(),
                        upstream_model_id: "qwen".into(),
                        status: InstanceStatus::Ready,
                    }],
                },
            )
            .unwrap();
    }
    let error = client
        .request_instance(
            &InstanceRef {
                host_id,
                instance_id,
            },
            Uuid::new_v4(),
            reqwest::Method::POST,
            "/v1/chat/completions",
            None,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("restarted"));
    client.state.lock().await.registry.mark_offline(host_id);
    let error = client
        .request_instance(
            &InstanceRef {
                host_id,
                instance_id,
            },
            session_id,
            reqwest::Method::POST,
            "/v1/chat/completions",
            None,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("offline"));
}

#[tokio::test]
async fn cached_catalog_tracks_cross_client_changes_and_rejects_old_authority() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("hosts.json");
    let first = Client::new(Some(path.clone()), Arc::new(MetadataOnlyVault));
    let second = Client::new(Some(path), Arc::new(MetadataOnlyVault));
    let original = catalog();
    first.set_fleet_authority(original.authority.clone()).await.unwrap();
    first.save_fleet_snapshot(&original).await.unwrap();
    assert_eq!(second.cached_fleet().await.unwrap(), Some(original.clone()));

    let mut changed = original.clone();
    changed.revision += 1;
    second.save_fleet_snapshot(&changed).await.unwrap();
    assert!(first.save_fleet_snapshot(&original).await.is_err());
    assert_eq!(first.cached_fleet().await.unwrap(), Some(changed.clone()));
    first.save_fleet_snapshot(&changed).await.unwrap();

    let mut replacement = changed.authority.clone();
    replacement.certificate_sha256 = "cd".repeat(32);
    second.set_fleet_authority(replacement).await.unwrap();
    assert!(first.save_fleet_snapshot(&changed).await.is_err());
    assert_eq!(first.cached_fleet().await.unwrap(), None);
}

#[test]
fn failed_catalog_write_preserves_durable_observation_and_retries() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("hosts.json");
    let original = catalog();
    let mut state = ClientState {
        path: Some(path.clone()),
        fleet_authority: Some(original.authority.clone()),
        fleet_snapshot: Some(original.clone()),
        ..Default::default()
    };
    persist(&state).unwrap();
    reload(&mut state).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let mut changed = original.clone();
    changed.revision += 1;
    // A real rename failure at the publication boundary, after the durable read.
    state.path = Some(root.path().join("blocked"));
    std::fs::create_dir(state.path.as_ref().unwrap()).unwrap();
    assert!(publish_fleet_snapshot(&mut state, &changed).is_err());
    assert_eq!(state.fleet_snapshot.as_ref(), Some(&original));
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    state.path = Some(path);
    reload(&mut state).unwrap();
    publish_fleet_snapshot(&mut state, &changed).unwrap();
    reload(&mut state).unwrap();
    assert_eq!(state.fleet_snapshot.as_ref(), Some(&changed));
    // An identical observation needs no write even if publication is unavailable.
    state.path = Some(root.path().join("blocked"));
    publish_fleet_snapshot(&mut state, &changed).unwrap();
}

#[test]
fn borrowed_registry_encoding_preserves_complete_document_bytes() {
    let root = tempfile::tempdir().unwrap();
    let fleet = catalog();
    let host = SavedHost {
        host_id: fleet.authority.host_id, name: "Fixture".into(),
        base_url: fleet.authority.origins[0].clone(),
        certificate_sha256: fleet.authority.certificate_sha256.clone(), client_id: Uuid::from_u128(2),
    };
    let state = ClientState {
        path: Some(root.path().join("hosts.json")), installation_id: Some(Uuid::from_u128(3)),
        saved: BTreeMap::from([(host.host_id, host.clone())]),
        imported: BTreeSet::from([root.path().join("imported.json")]),
        fleet_authority: Some(fleet.authority.clone()), fleet_snapshot: Some(fleet.clone()),
        ..Default::default()
    };
    let expected = serde_json::to_vec(&Document {
        schema: "ginfer-host-client-v1".into(), installation_id: state.installation_id,
        hosts: vec![host], imported: state.imported.clone(),
        fleet_authority: Some(fleet.authority.clone()), fleet_snapshot: Some(fleet),
    }).unwrap();
    persist(&state).unwrap();
    assert_eq!(std::fs::read(state.path.as_ref().unwrap()).unwrap(), expected);
}
