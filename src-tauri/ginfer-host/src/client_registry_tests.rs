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

fn desktop_owner_for_stop(directory: &Path) -> crate::local_host_registry::Owner {
    crate::local_host_registry::Owner::Desktop(Box::new(crate::local_host::LocalHost {
        binary: directory.join("must-not-start"),
        engine: directory.join("must-not-load"),
        engine_runtimes: Default::default(),
        directory: directory.into(),
        desktop_provider: None,
        models: vec![],
        artifact_sets: vec![],
        name: "Stop fixture".into(),
        nvidia_smi: "unused".into(),
        listen: "127.0.0.1:1".parse().unwrap(),
    }))
}

#[tokio::test]
async fn cached_stop_never_initializes_or_follows_a_foreign_owner() {
    use crate::local_host_registry::Owner;
    let directory = tempfile::tempdir().unwrap();
    let client = Client::new(Some(directory.path().join("must-not-create.json")), Arc::new(MetadataOnlyVault));
    assert!(!client.stop_local_host_if_idle(directory.path(), None).await.unwrap());
    assert!(client.state.lock().await.path.is_none());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);

    let service = Owner::Service { directory: directory.path().into(), origin: "https://127.0.0.1:1".into() };
    *client.local_owner.lock().await = (Some(directory.path().into()), Some(service));
    assert!(client.stop_selected_local_host_if_idle(None).await.unwrap_err().contains("desktop's managed Host"));
    *client.local_owner.lock().await = (Some(directory.path().into()), Some(desktop_owner_for_stop(directory.path())));
    let foreign = directory.path().join("foreign");
    assert!(client.stop_local_host_if_idle(&foreign, None).await.unwrap_err().contains("different data folder"));
    assert!(client.stop_local_host_if_idle(directory.path(), None).await.is_err());
    assert!(client.state.lock().await.path.is_none());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);

    let host = crate::service::Host::open(directory.path().into(), "Identity fixture".into(),
        directory.path().join("must-not-load"), vec![], vec![], vec![]).await.unwrap();
    let before = host.snapshot().await;
    assert!(client.stop_local_host_if_idle(directory.path(), Some(Uuid::new_v4())).await.unwrap_err().contains("identity changed"));
    assert_eq!(host.snapshot().await, before);
    assert!(!*client.local_attachment.lock().await);
}

#[tokio::test]
async fn cached_stop_serializes_bootstrap_and_retains_accepted_stop() {
    use std::task::{Context, Poll, Waker};
    let directory = tempfile::tempdir().unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(directory.path().into()), Some(desktop_owner_for_stop(directory.path())));
    let (release, wait) = tokio::sync::oneshot::channel();
    let mut stopping = Box::pin(client.stop_cached_local_host_if_idle_with(Some(directory.path()), None,
        |_| async move { wait.await.unwrap() }));
    let mut context = Context::from_waker(Waker::noop());
    assert!(matches!(stopping.as_mut().poll(&mut context), Poll::Pending));
    let mut polling = Box::pin(client.attach_local());
    assert!(matches!(polling.as_mut().poll(&mut context), Poll::Pending));
    release.send(Ok(json!({"stopping":true}))).unwrap();
    assert!(stopping.await.unwrap());
    // An already waiting passive refresh must not execute bootstrap after Stop.
    assert_eq!(polling.await.unwrap(), None);
    assert!(client.stop_selected_local_host_if_idle(None).await.unwrap());
    assert!(client.state.lock().await.path.is_none());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn cached_stop_busy_or_invalid_ack_restores_attachment_admission() {
    use std::task::{Context, Poll, Waker};
    let directory = tempfile::tempdir().unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(directory.path().into()), Some(desktop_owner_for_stop(directory.path())));
    let mut cancelled = Box::pin(client.stop_cached_local_host_if_idle_with(None, None,
        |_| std::future::pending()));
    assert!(matches!(cancelled.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Pending));
    drop(cancelled);
    assert!(!*client.local_attachment.lock().await);
    let error = client.stop_cached_local_host_if_idle_with(None, None,
        |_| async { Err("Host is busy: model load in progress".into()) }).await.unwrap_err();
    assert!(error.contains("model load in progress"));
    assert!(!*client.local_attachment.lock().await);
    assert!(client.stop_cached_local_host_if_idle_with(None, None,
        |_| async { Ok(json!({"stopping":false})) }).await.unwrap_err().contains("did not acknowledge"));
    assert!(!*client.local_attachment.lock().await);
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), directory.path());
    assert!(client.state.lock().await.path.is_none());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn relocation_reserves_both_roots_without_discovery_or_bootstrap() {
    use std::task::{Context, Poll, Waker};
    let root = tempfile::tempdir().unwrap();
    let previous = root.path().join("old/host");
    let destination = root.path().join("new/host");
    let foreign = root.path().join("foreign/host");
    let client = Client::new(Some(root.path().join("must-not-create.json")), Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(foreign.clone()), Some(desktop_owner_for_stop(&foreign)));
    let relocation = client.prepare_local_relocation_with(&previous, &destination,
        |_| async { panic!("A stopped root must not receive a Stop request") }).await.unwrap();
    assert!(!relocation.had_running_host());
    assert!(crate::service_owner::ServiceOwner::acquire(&previous).is_err());
    assert!(crate::service_owner::ServiceOwner::acquire(&destination).is_err());
    let mut polling = Box::pin(client.attach_local());
    assert!(matches!(polling.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Pending));
    drop(polling);
    drop(relocation);
    let _source = crate::service_owner::ServiceOwner::acquire(&previous).unwrap();
    let _target = crate::service_owner::ServiceOwner::acquire(&destination).unwrap();
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), foreign);
    assert!(client.state.lock().await.path.is_none());
    assert!(!root.path().join("must-not-create.json").exists());
    assert!(!foreign.exists());
}

#[tokio::test]
async fn relocation_refuses_invalid_ownership_without_sending_stop() {
    let root = tempfile::tempdir().unwrap();
    let invalid_root = root.path().join("not-a-directory");
    std::fs::write(&invalid_root, "preserved source").unwrap();
    let invalid_lock = root.path().join("invalid-lock");
    std::fs::create_dir_all(invalid_lock.join("host.lock")).unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    for previous in [&invalid_root, &invalid_lock] {
        let destination = root.path().join("new/host");
        let error = client.prepare_local_relocation_with(previous, &destination,
            |_| async { panic!("An ownership filesystem error must not send Stop") }).await.err().unwrap();
        assert!(error.contains("Cannot inspect Host ownership"));
        let _target = crate::service_owner::ServiceOwner::acquire(&destination).unwrap();
    }
    assert_eq!(std::fs::read(&invalid_root).unwrap(), b"preserved source");
    assert!(invalid_lock.join("host.lock").is_dir());
    assert!(client.local_owner.lock().await.1.is_none());
    assert!(!*client.local_attachment.lock().await);
    assert!(client.state.lock().await.path.is_none());
}

#[tokio::test]
async fn relocation_refuses_busy_host_and_waits_for_actual_ownership_release() {
    use std::task::{Context, Poll, Waker};
    let root = tempfile::tempdir().unwrap();
    let previous = root.path().join("old/host");
    let destination = root.path().join("new/host");
    let source_owner = crate::service_owner::ServiceOwner::acquire(&previous).unwrap();
    std::fs::write(previous.join("preserved-model.ginfer"), "original model").unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(previous.clone()), Some(desktop_owner_for_stop(&previous)));
    let error = client.prepare_local_relocation_with(&previous, &destination,
        |_| async { Err("Host is busy: model load in progress".into()) }).await.err().unwrap();
    assert!(error.contains("model load in progress"));
    assert!(!*client.local_attachment.lock().await);
    // A successful HTTP ACK alone is insufficient: the old process still owns
    // its state until its normal shutdown actually releases this real lock.
    let mut preparing = Box::pin(client.prepare_local_relocation_with(&previous, &destination,
        |_| async { Ok(json!({"stopping":true})) }));
    assert!(matches!(preparing.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Pending));
    assert!(crate::service_owner::ServiceOwner::acquire(&destination).is_err());
    drop(preparing);
    assert_eq!(std::fs::read(previous.join("preserved-model.ginfer")).unwrap(), b"original model");
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), previous);
    assert!(client.state.lock().await.path.is_none());
    let _target = crate::service_owner::ServiceOwner::acquire(&destination).unwrap();
    drop(source_owner);
}

#[tokio::test]
async fn relocation_commits_copied_identity_and_releases_both_roots_before_restart() {
    let root = tempfile::tempdir().unwrap();
    let previous = root.path().join("old/host");
    let destination = root.path().join("new/host");
    let host = crate::service::Host::open(previous.clone(), "Relocation fixture".into(),
        root.path().join("must-not-load"), vec![], vec![], vec![]).await.unwrap();
    let before = host.snapshot().await;
    let source_owner = crate::service_owner::ServiceOwner::acquire(&previous).unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(previous.clone()), Some(desktop_owner_for_stop(&previous)));
    let expected = previous.clone();
    let relocation = client.prepare_local_relocation_with(&previous, &destination,
        move |directory| async move {
            assert_eq!(directory, expected);
            drop(source_owner);
            Ok(json!({"stopping":true}))
        }).await.unwrap();
    assert!(relocation.had_running_host());
    std::fs::copy(previous.join("host.json"), destination.join("host.json")).unwrap();
    let crate::local_host_registry::Owner::Desktop(local) = desktop_owner_for_stop(&destination) else { unreachable!() };
    let running = relocation.commit_with(*local, |old, new| {
        assert_eq!(old, previous);
        assert_eq!(new.directory, destination);
        assert!(crate::service_owner::ServiceOwner::acquire(&previous).is_err());
        assert!(crate::service_owner::ServiceOwner::acquire(&destination).is_err());
        // A concurrently selected foreign locator is left intact, but the
        // desktop still adopts its explicitly configured new local root.
        Ok(false)
    }).unwrap();
    assert!(running);
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), destination);
    assert!(!*client.local_attachment.lock().await);
    let _source = crate::service_owner::ServiceOwner::acquire(&previous).unwrap();
    let _target = crate::service_owner::ServiceOwner::acquire(&destination).unwrap();
    assert_eq!(host.snapshot().await, before);
    assert_eq!(std::fs::read(previous.join("host.json")).unwrap(), std::fs::read(destination.join("host.json")).unwrap());
    assert!(client.state.lock().await.path.is_none());
}

#[tokio::test]
async fn relocation_rejects_identity_or_registration_failure_without_changing_selection() {
    let root = tempfile::tempdir().unwrap();
    let previous = root.path().join("old/host");
    let destination = root.path().join("new/host");
    let _host = crate::service::Host::open(previous.clone(), "Relocation fixture".into(),
        root.path().join("must-not-load"), vec![], vec![], vec![]).await.unwrap();
    let client = Client::new(None, Arc::new(MetadataOnlyVault));
    *client.local_owner.lock().await = (Some(previous.clone()), Some(desktop_owner_for_stop(&previous)));
    let relocation = client.prepare_local_relocation(&previous, &destination).await.unwrap();
    let crate::local_host_registry::Owner::Desktop(local) = desktop_owner_for_stop(&destination) else { unreachable!() };
    let error = relocation.commit_with(*local, |_, _| panic!("Invalid copied identity must not change registration")).unwrap_err();
    assert!(error.contains("identity does not match"));
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), previous);

    let relocation = client.prepare_local_relocation(&previous, &destination).await.unwrap();
    std::fs::copy(previous.join("host.json"), destination.join("host.json")).unwrap();
    let crate::local_host_registry::Owner::Desktop(local) = desktop_owner_for_stop(&destination) else { unreachable!() };
    assert!(relocation.commit_with(*local, |_, _| Err("registration is changing".into())).unwrap_err().contains("registration is changing"));
    assert_eq!(client.local_owner.lock().await.1.as_ref().unwrap().directory(), previous);
    let _source = crate::service_owner::ServiceOwner::acquire(&previous).unwrap();
    let _target = crate::service_owner::ServiceOwner::acquire(&destination).unwrap();
    assert!(!*client.local_attachment.lock().await);
    assert!(client.state.lock().await.path.is_none());
}

#[tokio::test]
async fn desktop_clients_keep_their_selected_local_owner_without_credentials() {
    use crate::local_host_registry::Owner;
    let root = tempfile::tempdir().unwrap();
    let first = Client::new(Some(root.path().join("first-clients.json")), Arc::new(MetadataOnlyVault));
    let second = Client::new(Some(root.path().join("second-clients.json")), Arc::new(MetadataOnlyVault));
    let first_owner = Owner::Service { directory: root.path().join("first/host"), origin: "https://127.0.0.1:17443".into() };
    let second_owner = Owner::Service { directory: root.path().join("second/host"), origin: "https://127.0.0.1:17444".into() };
    first.initialize_from_owner(&first_owner).await.unwrap();
    second.initialize_from_owner(&second_owner).await.unwrap();
    first.set_local_directory(first_owner.directory().into()).await.unwrap();
    assert_eq!(first.selected_local_owner().await.unwrap().unwrap().directory(), first_owner.directory());
    assert_eq!(second.selected_local_owner().await.unwrap().unwrap().directory(), second_owner.directory());
    // Gbot reinitializes the shared client. A later registration for another
    // installation must not redirect this already selected desktop root.
    let discovery_called = std::sync::atomic::AtomicBool::new(false);
    first.initialize_from_local_owner_resolving(|| {
        discovery_called.store(true, std::sync::atomic::Ordering::SeqCst);
        async { Ok(Some(second_owner.clone())) }
    }).await.unwrap();
    assert!(!discovery_called.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(first.selected_local_owner().await.unwrap().unwrap().directory(), first_owner.directory());
    // Selecting a new desktop root must retire the old in-process owner, while
    // another open client continues to use its independently selected owner.
    first.set_local_directory(second_owner.directory().into()).await.unwrap();
    assert!(first.local_owner.lock().await.1.is_none());
    first.initialize_from_local_owner_resolving(|| async { Ok(Some(first_owner.clone())) }).await.unwrap();
    assert!(first.local_owner.lock().await.1.is_none());
    first.initialize_from_local_owner_resolving(|| async { Ok(Some(second_owner.clone())) }).await.unwrap();
    assert_eq!(first.selected_local_owner().await.unwrap().unwrap().directory(), second_owner.directory());
    assert_eq!(second.selected_local_owner().await.unwrap().unwrap().directory(), second_owner.directory());
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
