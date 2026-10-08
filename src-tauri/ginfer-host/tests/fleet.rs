use ginfer_host::{
    engine_registry::InstanceRef,
    fleet::{
        AuthorityLocator, ClientAssignment, FleetMember, FleetOperation, FleetPool,
        FleetPoolMember, FleetSnapshot, FleetUpdate, FleetView, HostMembershipProjection,
        MembershipView, MEMBERSHIP_SCHEMA,
    },
    service::Host,
    transport::pinned_client,
};
use hyper::{Body, Request, StatusCode};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use uuid::Uuid;

async fn open(path: &Path) -> Arc<Host> {
    Host::open(
        path.to_path_buf(),
        "Fleet host".into(),
        std::env::current_exe().unwrap(),
        vec![],
        vec![],
        vec![],
    )
    .await
    .unwrap()
}

async fn locator(host: &Host, origin: &str) -> AuthorityLocator {
    let data = host.data.lock().await;
    AuthorityLocator {
        host_id: data.host_id,
        origins: vec![origin.into()],
        certificate_sha256: data.certificate.fingerprint(),
    }
}

async fn route(
    host: &Arc<Host>,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(if body.is_some() { "POST" } else { "GET" })
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap();
    let response = host.clone().route(request).await.unwrap();
    let status = response.status();
    let body = hyper::body::to_bytes(response.into_body()).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

fn pool(host_id: Uuid) -> FleetPool {
    FleetPool {
        id: Uuid::new_v4(),
        name: "Coding workers".into(),
        members: vec![
            FleetPoolMember {
                instance: InstanceRef {
                    host_id,
                    instance_id: Uuid::new_v4(),
                },
                worker_limit: 2,
            },
            FleetPoolMember {
                instance: InstanceRef {
                    host_id,
                    instance_id: Uuid::new_v4(),
                },
                worker_limit: 1,
            },
        ],
    }
}

async fn update(
    host: &Arc<Host>,
    token: &str,
    revision: u64,
    operation: FleetOperation,
) -> (StatusCode, Value) {
    route(
        host,
        token,
        "/host/v1/fleet/update",
        Some(
            serde_json::to_value(FleetUpdate {
                expected_revision: revision,
                operation,
            })
            .unwrap(),
        ),
    )
    .await
}

#[tokio::test]
async fn catalog_and_order_survive_restart_and_stale_write_is_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    assert_eq!(
        route(&host, &token, "/host/v1/fleet", None).await.1,
        json!({"kind":"unconfigured"})
    );
    let authority = locator(&host, "https://127.0.0.1:7443").await;
    let configured = route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    assert_eq!(configured.0, StatusCode::OK);
    let pool = pool(authority.host_id);
    let saved = update(
        &host,
        &token,
        1,
        FleetOperation::SavePool { pool: pool.clone() },
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK);
    let expected: FleetSnapshot = serde_json::from_value(saved.1).unwrap();
    assert_eq!(expected.revision, 2);
    assert_eq!(expected.pools, vec![pool.clone()]);
    let stale = update(
        &host,
        &token,
        1,
        FleetOperation::DeletePool { pool_id: pool.id },
    )
    .await;
    assert_eq!(stale.0, StatusCode::CONFLICT);
    assert_eq!(stale.1["current_revision"], 2);
    assert_eq!(
        host.snapshot().await["fleet"]["fleet"],
        serde_json::to_value(&expected).unwrap()
    );
    drop(host);
    let reopened = open(dir.path()).await;
    let loaded: FleetView =
        serde_json::from_value(route(&reopened, &token, "/host/v1/fleet", None).await.1).unwrap();
    assert_eq!(loaded, FleetView::Coordinator { fleet: expected });
    let stale = update(
        &reopened,
        &token,
        1,
        FleetOperation::DeletePool { pool_id: pool.id },
    )
    .await;
    assert_eq!(stale.0, StatusCode::CONFLICT);
}

struct Server(tokio::task::JoinHandle<()>);
impl Drop for Server {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn serve(host: &Arc<Host>) -> (String, Server) {
    let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap());
    let host = host.clone();
    let task = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let host = host.clone();
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
    (origin, Server(task))
}

#[tokio::test]
async fn independent_paired_clients_observe_the_same_authoritative_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let (origin, _server) = serve(&host).await;
    let authority = locator(&host, &origin).await;
    let admin = host.data.lock().await.pairing_admin_token.clone();
    assert_eq!(
        route(
            &host,
            &admin,
            "/host/v1/fleet/authority",
            Some(json!({"authority":authority}))
        )
        .await
        .0,
        StatusCode::OK
    );
    host.lan_sharing.lock().await.standalone =
        Some(reqwest::Url::parse(&origin).unwrap().port().unwrap());
    let first = pinned_client(&authority.certificate_sha256).unwrap();
    let second = pinned_client(&authority.certificate_sha256).unwrap();
    let first_grant: Value = first
        .post(format!("{origin}/host/v1/pair"))
        .json(&json!({"client_name":"GChat"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let second_grant: Value = second
        .post(format!("{origin}/host/v1/pair"))
        .json(&json!({"client_name":"Manager"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_ne!(first_grant["client_id"], second_grant["client_id"]);
    assert_eq!(first_grant["fleet"], second_grant["fleet"]);
    let first_token = first_grant["token"].as_str().unwrap();
    let second_token = second_grant["token"].as_str().unwrap();
    let pool = pool(authority.host_id);
    let saved: FleetSnapshot = first
        .post(format!("{origin}/host/v1/fleet/update"))
        .bearer_auth(first_token)
        .json(&FleetUpdate {
            expected_revision: 1,
            operation: FleetOperation::SavePool { pool: pool.clone() },
        })
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let read: FleetView = second
        .get(format!("{origin}/host/v1/fleet"))
        .bearer_auth(second_token)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(read, FleetView::Coordinator { fleet: saved });
    let assignment = ClientAssignment {
        client_id: first_grant["client_id"].as_str().unwrap().parse().unwrap(),
        pool_ids: vec![pool.id],
        preferred_hosts: vec![authority.host_id],
        preferred_instances: vec![pool.members[0].instance.clone()],
    };
    let changed: FleetSnapshot = second
        .post(format!("{origin}/host/v1/fleet/update"))
        .bearer_auth(second_token)
        .json(&FleetUpdate {
            expected_revision: 2,
            operation: FleetOperation::SetClientAssignment {
                assignment: assignment.clone(),
            },
        })
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(changed.assignments, vec![assignment]);
    let read: FleetView = first
        .get(format!("{origin}/host/v1/fleet"))
        .bearer_auth(first_token)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(read, FleetView::Coordinator { fleet: changed });
    let stale = first
        .post(format!("{origin}/host/v1/fleet/update"))
        .bearer_auth(first_token)
        .json(&FleetUpdate {
            expected_revision: 2,
            operation: FleetOperation::DeletePool { pool_id: pool.id },
        })
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), 409);
    let mut first_edit = pool.clone();
    first_edit.name = "First concurrent edit".into();
    let mut second_edit = pool.clone();
    second_edit.name = "Second concurrent edit".into();
    let first_request = first
        .post(format!("{origin}/host/v1/fleet/update"))
        .bearer_auth(first_token)
        .json(&FleetUpdate {
            expected_revision: 3,
            operation: FleetOperation::SavePool { pool: first_edit },
        });
    let second_request = second
        .post(format!("{origin}/host/v1/fleet/update"))
        .bearer_auth(second_token)
        .json(&FleetUpdate {
            expected_revision: 3,
            operation: FleetOperation::SavePool { pool: second_edit },
        });
    let (first_response, second_response) =
        tokio::join!(first_request.send(), second_request.send());
    let mut statuses = [
        first_response.unwrap().status().as_u16(),
        second_response.unwrap().status().as_u16(),
    ];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let first_read: Value = first
        .get(format!("{origin}/host/v1/fleet"))
        .bearer_auth(first_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let second_read: Value = second
        .get(format!("{origin}/host/v1/fleet"))
        .bearer_auth(second_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(first_read, second_read);
    assert_eq!(first_read["fleet"]["revision"], 4);
    assert_eq!(
        first
            .post(format!("{origin}/host/v1/lan-sharing"))
            .bearer_auth(first_token)
            .json(&json!({"enabled":false}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
}

#[tokio::test]
async fn member_persists_only_locator_and_cannot_mutate_coordinator_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let authority = AuthorityLocator {
        host_id: Uuid::new_v4(),
        origins: vec!["https://192.0.2.10:7443".into()],
        certificate_sha256: "12".repeat(32),
    };
    let configured = route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    assert_eq!(configured.0, StatusCode::OK);
    assert_eq!(configured.1, json!({"kind":"member","authority":authority}));
    let denied = update(
        &host,
        &token,
        1,
        FleetOperation::SavePool {
            pool: pool(authority.host_id),
        },
    )
    .await;
    assert_eq!(denied.0, StatusCode::CONFLICT);
    assert_eq!(denied.1["fleet"], configured.1);
    let saved: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("host.json")).unwrap()).unwrap();
    assert_eq!(saved["fleet"], configured.1);
    assert!(saved["fleet"].get("pools").is_none());
    drop(host);
    let reopened = open(dir.path()).await;
    assert_eq!(
        route(&reopened, &token, "/host/v1/fleet", None).await.1,
        configured.1
    );
}

#[tokio::test]
async fn failed_durable_write_never_publishes_candidate_revision() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let authority = locator(&host, "https://127.0.0.1:7443").await;
    route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    let state = dir.path().join("host.json");
    std::fs::rename(&state, dir.path().join("original-host.json")).unwrap();
    std::fs::create_dir(&state).unwrap();
    let failed = update(
        &host,
        &token,
        1,
        FleetOperation::SavePool {
            pool: pool(authority.host_id),
        },
    )
    .await;
    assert_eq!(failed.0, StatusCode::BAD_REQUEST);
    let current = route(&host, &token, "/host/v1/fleet", None).await.1;
    assert_eq!(current["fleet"]["revision"], 1);
    assert_eq!(current["fleet"]["pools"], json!([]));
}

#[tokio::test]
async fn ownership_and_referential_validation_preserve_saved_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let authority = locator(&host, "https://127.0.0.1:7443").await;
    route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    let mut remote = authority.clone();
    remote.host_id = Uuid::new_v4();
    let enrolled = update(
        &host,
        &token,
        1,
        FleetOperation::EnrollMember {
            member: FleetMember {
                host: remote.clone(),
                display_name: "Remote".into(),
            },
        },
    )
    .await;
    assert_eq!(enrolled.0, StatusCode::OK);
    let pool = pool(remote.host_id);
    assert_eq!(
        update(
            &host,
            &token,
            2,
            FleetOperation::SavePool { pool: pool.clone() }
        )
        .await
        .0,
        StatusCode::OK
    );
    let remove = update(
        &host,
        &token,
        3,
        FleetOperation::RemoveMember {
            host_id: remote.host_id,
        },
    )
    .await;
    assert_eq!(remove.0, StatusCode::BAD_REQUEST);
    let transfer = route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":remote})),
    )
    .await;
    assert_eq!(transfer.0, StatusCode::BAD_REQUEST);
    let refreshed = AuthorityLocator {
        origins: vec!["https://127.0.0.1:8443".into()],
        ..authority
    };
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/authority",
            Some(json!({"authority":refreshed}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let saved = route(&host, &token, "/host/v1/fleet", None).await.1;
    assert_eq!(saved["fleet"]["revision"], 4);
    assert_eq!(saved["fleet"]["pools"], json!([pool]));
    assert_eq!(saved["fleet"]["authority"], json!(refreshed));
    let assignment = ClientAssignment {
        client_id: Uuid::new_v4(),
        pool_ids: vec![pool.id],
        preferred_hosts: vec![],
        preferred_instances: vec![],
    };
    assert_eq!(
        update(
            &host,
            &token,
            4,
            FleetOperation::SetClientAssignment { assignment }
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(route(&host, &token, "/host/v1/fleet", None).await.1, saved);
}

#[tokio::test]
async fn legacy_import_receipts_are_atomic_and_never_recreate_deleted_pools() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let authority = locator(&host, "https://127.0.0.1:7443").await;
    route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    let first = pool(authority.host_id);
    let source_id = "23".repeat(32);
    let imported = update(
        &host,
        &token,
        1,
        FleetOperation::ImportLegacyPools {
            source_id: source_id.clone(),
            pools: vec![first.clone()],
        },
    )
    .await;
    assert_eq!(imported.0, StatusCode::OK);
    assert_eq!(imported.1["legacy_imports"][&source_id], json!([first.id]));
    assert_eq!(
        update(
            &host,
            &token,
            2,
            FleetOperation::DeletePool { pool_id: first.id }
        )
        .await
        .0,
        StatusCode::OK
    );
    let second = pool(authority.host_id);
    let retry = update(
        &host,
        &token,
        3,
        FleetOperation::ImportLegacyPools {
            source_id: source_id.clone(),
            pools: vec![first.clone(), second.clone()],
        },
    )
    .await;
    assert_eq!(retry.0, StatusCode::OK);
    assert_eq!(retry.1["pools"], json!([second.clone()]));
    assert_eq!(
        retry.1["legacy_imports"][&source_id],
        json!([first.id, second.id])
    );
    let other = pool(authority.host_id);
    let mut conflict = second.clone();
    conflict.name = "Different migration".into();
    let failed = update(
        &host,
        &token,
        4,
        FleetOperation::ImportLegacyPools {
            source_id: "34".repeat(32),
            pools: vec![other, conflict],
        },
    )
    .await;
    assert_eq!(failed.0, StatusCode::BAD_REQUEST);
    let unchanged = route(&host, &token, "/host/v1/fleet", None).await.1;
    assert_eq!(unchanged["fleet"], retry.1);
    drop(host);
    let reopened = open(dir.path()).await;
    let retry = update(
        &reopened,
        &token,
        4,
        FleetOperation::ImportLegacyPools {
            source_id,
            pools: vec![first],
        },
    )
    .await;
    assert_eq!(retry.0, StatusCode::OK);
    assert_eq!(retry.1["pools"], json!([second]));
}

#[tokio::test]
async fn explicit_empty_authority_reconfiguration_keeps_revision_monotonic() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let authority = locator(&host, "https://127.0.0.1:7443").await;
    route(
        &host,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    let pool = pool(authority.host_id);
    assert_eq!(
        update(
            &host,
            &token,
            1,
            FleetOperation::SavePool { pool: pool.clone() }
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        update(
            &host,
            &token,
            2,
            FleetOperation::DeletePool { pool_id: pool.id }
        )
        .await
        .0,
        StatusCode::OK
    );
    let other = AuthorityLocator {
        host_id: Uuid::new_v4(),
        ..authority.clone()
    };
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/authority",
            Some(json!({"authority":other}))
        )
        .await
        .0,
        StatusCode::OK
    );
    drop(host);
    let reopened = open(dir.path()).await;
    let resumed = route(
        &reopened,
        &token,
        "/host/v1/fleet/authority",
        Some(json!({"authority":authority})),
    )
    .await;
    assert_eq!(resumed.0, StatusCode::OK);
    assert_eq!(resumed.1["fleet"]["revision"], 4);
    assert_eq!(
        update(
            &reopened,
            &token,
            3,
            FleetOperation::DeletePool { pool_id: pool.id }
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn hosts_observe_only_their_own_canonical_pool_membership_and_preferences() {
    let coordinator_dir = tempfile::tempdir().unwrap();
    let member_dir = tempfile::tempdir().unwrap();
    let coordinator = open(coordinator_dir.path()).await;
    let member = open(member_dir.path()).await;
    let coordinator_token = coordinator.data.lock().await.pairing_admin_token.clone();
    let member_token = member.data.lock().await.pairing_admin_token.clone();
    let authority = locator(&coordinator, "https://127.0.0.1:7443").await;
    let member_locator = locator(&member, "https://127.0.0.1:7444").await;
    for (host, token) in [(&coordinator, &coordinator_token), (&member, &member_token)] {
        assert_eq!(
            route(
                host,
                token,
                "/host/v1/fleet/authority",
                Some(json!({"authority":authority}))
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        update(
            &coordinator,
            &coordinator_token,
            1,
            FleetOperation::EnrollMember {
                member: FleetMember {
                    host: member_locator.clone(),
                    display_name: "Second host".into()
                }
            }
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut mixed = pool(member_locator.host_id);
    let own = pool(authority.host_id);
    mixed.members.insert(0, own.members[0].clone());
    assert_eq!(
        update(
            &coordinator,
            &coordinator_token,
            2,
            FleetOperation::SavePool {
                pool: mixed.clone()
            }
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        update(
            &coordinator,
            &coordinator_token,
            3,
            FleetOperation::SavePool { pool: own.clone() }
        )
        .await
        .0,
        StatusCode::OK
    );
    let client_id: Uuid = route(
        &coordinator,
        &coordinator_token,
        "/host/v1/local-client",
        Some(json!({})),
    )
    .await
    .1["client_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let assignment = ClientAssignment {
        client_id,
        pool_ids: vec![mixed.id, own.id],
        preferred_hosts: vec![authority.host_id, member_locator.host_id],
        preferred_instances: vec![
            own.members[0].instance.clone(),
            mixed.members[1].instance.clone(),
        ],
    };
    let saved = update(
        &coordinator,
        &coordinator_token,
        4,
        FleetOperation::SetClientAssignment { assignment },
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK);
    let canonical: FleetSnapshot = serde_json::from_value(saved.1).unwrap();
    let projection = canonical.membership(member_locator.host_id).unwrap();
    assert_eq!(projection.revision, 5);
    assert_eq!(
        projection.pools,
        vec![FleetPool {
            members: mixed.members[1..].to_vec(),
            ..mixed.clone()
        }]
    );
    assert_eq!(
        projection.assignments,
        vec![ClientAssignment {
            client_id,
            pool_ids: vec![mixed.id],
            preferred_hosts: vec![member_locator.host_id],
            preferred_instances: vec![mixed.members[1].instance.clone()]
        }]
    );
    let accepted = route(
        &member,
        &member_token,
        "/host/v1/fleet/membership",
        Some(json!(projection)),
    )
    .await;
    assert_eq!(accepted.0, StatusCode::OK);
    assert_eq!(accepted.1["applied"], true);
    let view: MembershipView = serde_json::from_value(
        route(&member, &member_token, "/host/v1/fleet/membership", None)
            .await
            .1,
    )
    .unwrap();
    assert_eq!(view.membership, Some(projection.clone()));
    assert!(!view.coordinator);
    assert_eq!(member.snapshot().await["fleet_membership"], json!(view));
    assert_eq!(
        route(&member, &member_token, "/host/v1/fleet", None)
            .await
            .1,
        json!({"kind":"member", "authority":authority})
    );
    let owner: MembershipView = serde_json::from_value(
        route(
            &coordinator,
            &coordinator_token,
            "/host/v1/fleet/membership",
            None,
        )
        .await
        .1,
    )
    .unwrap();
    assert!(owner.coordinator);
    assert_eq!(
        owner.membership,
        Some(canonical.membership(authority.host_id).unwrap())
    );
    assert!(canonical
        .membership(Uuid::new_v4())
        .unwrap()
        .pools
        .is_empty());
    drop(member);
    let reopened = open(member_dir.path()).await;
    assert_eq!(
        route(&reopened, &member_token, "/host/v1/fleet/membership", None)
            .await
            .1,
        json!(view)
    );
}

async fn membership_fixture(host: &Arc<Host>, token: &str) -> HostMembershipProjection {
    let host_id = host.data.lock().await.host_id;
    let authority = AuthorityLocator {
        host_id: Uuid::new_v4(),
        origins: vec!["https://192.0.2.10:7443".into()],
        certificate_sha256: "45".repeat(32),
    };
    assert_eq!(
        route(
            host,
            token,
            "/host/v1/fleet/authority",
            Some(json!({"authority":authority}))
        )
        .await
        .0,
        StatusCode::OK
    );
    HostMembershipProjection {
        schema: MEMBERSHIP_SCHEMA.into(),
        authority,
        host_id,
        revision: 3,
        pools: vec![pool(host_id)],
        assignments: vec![],
    }
}

#[tokio::test]
async fn membership_is_authority_bound_monotonic_and_cleared_on_explicit_switch() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let current = membership_fixture(&host, &token).await;
    assert_eq!(
        route(
            &host,
            "invalid",
            "/host/v1/fleet/membership",
            Some(json!(current))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(current))
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut stale = current.clone();
    stale.revision = 2;
    stale.pools.clear();
    let ignored = route(
        &host,
        &token,
        "/host/v1/fleet/membership",
        Some(json!(stale)),
    )
    .await;
    assert_eq!(ignored.0, StatusCode::OK);
    assert_eq!(ignored.1, json!({"applied":false,"membership":current}));
    let mut conflicting = current.clone();
    conflicting.pools[0].name = "Changed at same revision".into();
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(conflicting))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut wrong_pin = current.clone();
    wrong_pin.revision = 4;
    wrong_pin.authority.certificate_sha256 = "56".repeat(32);
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(wrong_pin))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut foreign = current.clone();
    foreign.revision = 4;
    foreign.pools[0].members[0].instance.host_id = foreign.authority.host_id;
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(foreign))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut removed = current.clone();
    removed.revision = 4;
    removed.pools.clear();
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(removed))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        route(&host, &token, "/host/v1/fleet/membership", None)
            .await
            .1["membership"],
        json!(removed)
    );
    let other = AuthorityLocator {
        host_id: Uuid::new_v4(),
        ..current.authority.clone()
    };
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/authority",
            Some(json!({"authority":other}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        route(&host, &token, "/host/v1/fleet/membership", None)
            .await
            .1["membership"],
        Value::Null
    );
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(removed))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn failed_membership_commit_preserves_last_known_projection() {
    let dir = tempfile::tempdir().unwrap();
    let host = open(dir.path()).await;
    let token = host.data.lock().await.pairing_admin_token.clone();
    let current = membership_fixture(&host, &token).await;
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(current))
        )
        .await
        .0,
        StatusCode::OK
    );
    let state = dir.path().join("host.json");
    std::fs::rename(&state, dir.path().join("original-host.json")).unwrap();
    std::fs::create_dir(&state).unwrap();
    let mut next = current.clone();
    next.revision = 4;
    next.pools.clear();
    assert_eq!(
        route(
            &host,
            &token,
            "/host/v1/fleet/membership",
            Some(json!(next))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        route(&host, &token, "/host/v1/fleet/membership", None)
            .await
            .1["membership"],
        json!(current)
    );
}
