use super::*;
use crate::core::agent::{
    ginfer_client::GinferConnection,
    test_support::{ScriptedGinferServer, ScriptedResponse, TestFleet},
    worker_pools::{Allocator, Candidate, PoolMember, RoleAssignment, WorkerPool, WorkerTarget},
};
use crate::test_support::TestDataRoot;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_ginfer::state::{GinferSession, GinferState, SessionInfo, SessionOwner};

async fn mcp_tool(
    client: &reqwest::Client,
    connection: &BridgeConnection,
    name: &str,
    mut arguments: Value,
) -> Value {
    if arguments.get(CALLER_SESSION_KEY).is_none() {
        arguments[CALLER_SESSION_KEY] = json!("ses_test");
    }
    let response = client
        .post(&connection.url)
        .bearer_auth(&connection.token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": Uuid::new_v4().to_string(),
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments },
        }))
        .send()
        .await
        .expect("MCP request");
    assert_eq!(response.status(), StatusCode::OK);
    let envelope: Value = response.json().await.expect("MCP response");
    assert_eq!(envelope["jsonrpc"], "2.0");
    assert_ne!(envelope["result"]["isError"], true, "{envelope}");
    serde_json::from_str(
        envelope["result"]["content"][0]["text"]
            .as_str()
            .expect("MCP text result"),
    )
    .expect("MCP JSON result")
}

#[tokio::test]
#[cfg(unix)]
async fn attached_local_instance_and_ready_host_snapshot_share_one_code_choice() {
    use ginfer_host::engine_host::{EngineLaunch, HostProcesses, LaunchOptions};
    use std::collections::BTreeSet;
    use std::os::unix::fs::PermissionsExt;
    const MODEL_ID: &str = "muse-glimmer-30b/nvfp4";
    let scripted = ScriptedGinferServer::start_with_model(
        Vec::new(),
        json!({
            "id":MODEL_ID,"object":"model","max_model_len":65536
        }),
    )
    .await;
    let GinferConnection::Local { port, .. } = scripted.client().target().connection else {
        unreachable!()
    };
    let fleet = TestFleet::start().await;
    let engine = fleet.directory.path().join("inert-engine");
    std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
    let artifact = fleet.directory.path().join("fixture.ginfer");
    std::fs::write(&artifact, b"inert process fixture").unwrap();
    let instance_id = Uuid::new_v4();
    let session_id = {
        let mut processes = fleet.host.processes.lock().await;
        *processes = HostProcesses::new(
            engine,
            BTreeSet::from(["GPU-inert".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        processes
            .launch(EngineLaunch {
                instance_id,
                artifact_dependencies: vec![artifact.clone()],
                artifact,
                artifact_set: false,
                model_id: MODEL_ID.into(),
                gpu_uuids: vec!["GPU-inert".into()],
                tp: 1,
                port: port.try_into().unwrap(),
                max_context: 65536,
                concurrency: 2,
                options: LaunchOptions::default(),
            })
            .unwrap()
    };
    fleet.host.refresh_processes().await.unwrap();
    assert_eq!(
        fleet
            .host
            .processes
            .lock()
            .await
            .instances()
            .next()
            .unwrap()
            .status,
        ginfer_host::engine_registry::InstanceStatus::Ready
    );
    let host_id = fleet.host.data.lock().await.host_id;
    let snapshot = fleet.client.snapshot(host_id).await.unwrap();
    assert_eq!(
        snapshot["instances"][0]["session_id"],
        session_id.to_string()
    );
    let ginfer = GinferState::default();
    ginfer.ginfer_process.lock().await.insert(1,GinferSession{
        owner:SessionOwner{
            control:Arc::new(ginfer_host::launcher::LocalControl::open(&fleet.directory.path().join("host"),&fleet.origin).unwrap()),
            connection:ginfer_host::launcher::LocalConnection{
                instance_id,session_id,model_id:MODEL_ID.into(),port:port.try_into().unwrap(),api_key:String::new()
            }
        },
        info:serde_json::from_value(json!({"pid":1,"port":port,"model_id":MODEL_ID,"model_path":"fixture.ginfer",
            "is_embedding":false,"vision":false,"api_key":"","max_concurrency":1,"max_context":16384})).unwrap(),
        endpoint:None
    });
    let data = tempfile::tempdir().unwrap();
    let app = mock_builder()
        .manage(ginfer)
        .manage(fleet.client.clone())
        .build(mock_context(noop_assets()))
        .unwrap();
    let reference = ginfer_host::engine_registry::InstanceRef {
        host_id,
        instance_id,
    }
    .model_alias();
    let instances = commands::agent_list_model_instances(app.handle().clone(), app.state())
        .await
        .unwrap();
    assert_eq!(
        instances.len(),
        1,
        "a plugin attachment and its host snapshot are one physical instance"
    );
    assert_eq!(instances[0].id, reference);
    assert_eq!(instances[0].session_id, session_id.to_string());
    assert_eq!(instances[0].aliases, vec![MODEL_ID.to_owned()]);
    assert!(
        instances[0].vision,
        "confirmed host capabilities take precedence for the same session"
    );
    assert_eq!(instances[0].concurrency, 2);
    assert_eq!(instances[0].max_context, 65536);
    assert_eq!(
        select_model(
            app.handle(),
            &definitions::general_agent(),
            data.path(),
            None
        )
        .await
        .unwrap(),
        reference
    );

    let replacement = Uuid::new_v4();
    app.state::<GinferState>()
        .ginfer_process
        .lock()
        .await
        .get_mut(&1)
        .unwrap()
        .owner
        .connection
        .session_id = replacement;
    let instances = commands::agent_list_model_instances(app.handle().clone(), app.state())
        .await
        .unwrap();
    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].session_id, replacement.to_string());
    assert_eq!(
        instances[0].max_context, 16384,
        "an older host incarnation cannot overwrite the attached connection"
    );
    app.state::<GinferState>()
        .ginfer_process
        .lock()
        .await
        .clear();
    let instances = commands::agent_list_model_instances(app.handle().clone(), app.state())
        .await
        .unwrap();
    assert_eq!(
        instances.len(),
        1,
        "host-only local instances remain selectable"
    );
    assert_eq!(
        select_model(
            app.handle(),
            &definitions::general_agent(),
            data.path(),
            None
        )
        .await
        .unwrap(),
        reference
    );
    fleet.host.processes.lock().await.shutdown().await.unwrap();
}

#[tokio::test]
async fn mcp_runs_a_saved_pool_agent_through_studio_and_persists_its_result() {
    const MODEL_ID: &str = "code-bridge-scripted-model";
    let scripted = ScriptedGinferServer::start_with_model(
        vec![ScriptedResponse::completion(
            r#"[{"tool":"reply","args":{"text":"Pool worker finished the review."}}]"#,
        )],
        json!({ "id": MODEL_ID, "object": "model", "max_model_len": 32768 }),
    )
    .await;
    let GinferConnection::Local { port, .. } = scripted.client().target().connection else {
        unreachable!()
    };
    let fleet = TestFleet::start().await;
    let owner = SessionOwner {
        control: Arc::new(
            ginfer_host::launcher::LocalControl::open(
                &fleet.directory.path().join("host"),
                &fleet.origin,
            )
            .expect("fixture host control"),
        ),
        connection: ginfer_host::launcher::LocalConnection {
            instance_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            model_id: MODEL_ID.into(),
            port: port.try_into().expect("test port"),
            api_key: String::new(),
        },
    };
    let canonical = ginfer_host::engine_registry::InstanceRef {
        host_id: owner.control.host_id(),
        instance_id: owner.connection.instance_id,
    }
    .model_alias();
    let info: SessionInfo = serde_json::from_value(json!({
        "pid": 1,
        "port": port,
        "model_id": MODEL_ID,
        "model_path": "test.ginfer",
        "is_embedding": false,
        "vision": false,
        "api_key": "",
        "max_concurrency": 1,
        "max_context": 32768,
    }))
    .expect("session info");
    let ginfer = GinferState::default();
    ginfer.ginfer_process.lock().await.insert(
        1,
        GinferSession {
            owner,
            info,
            endpoint: None,
        },
    );

    let data = tempfile::tempdir().expect("app data");
    let project = tempfile::tempdir().expect("Code project");
    let app = mock_builder()
        .manage(TestDataRoot(data.path().to_path_buf()))
        .manage(AppState::default())
        .manage(fleet.client.clone())
        .manage(ginfer)
        .build(mock_context(noop_assets()))
        .expect("mock GChat");
    let pool = WorkerPool {
        id: Uuid::new_v4().to_string(),
        name: "Review workers".into(),
        members: vec![PoolMember {
            instance_id: MODEL_ID.into(),
            worker_limit: 1,
        }],
    };
    std::fs::write(
        data.path().join("agent-worker-pools.json"),
        serde_json::to_vec(&vec![pool.clone()]).unwrap(),
    )
    .unwrap();
    let mut definition = definitions::editable_general_agent();
    definition.id = "bridge-pool-review".into();
    definition.name = "Pool Review".into();
    definition.role_assignments.insert(
        "agent".into(),
        RoleAssignment {
            target: WorkerTarget::Pool {
                id: pool.id.clone(),
            },
            ..Default::default()
        },
    );
    definitions::save_definition(data.path(), definition).expect("saved pool agent");

    let connection = prepare_session(app.handle(), project.path(), None, BridgePolicy::default())
        .expect("Code bridge");
    tests::register_caller(
        app.handle(),
        project.path(),
        &connection,
        "ses_test",
        BridgePolicy::default(),
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("HTTP client");
    let initialized: Value = client
        .post(&connection.url)
        .bearer_auth(&connection.token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "1" },
            },
        }))
        .send()
        .await
        .expect("MCP initialize")
        .json()
        .await
        .expect("initialize response");
    assert_eq!(
        initialized["result"]["serverInfo"]["name"],
        "gchat-agent-studio"
    );

    let args = json!({
        "definitionId": "bridge-pool-review",
        "task": "Review this Code project and give a short result.",
        "requestId": "pool-review-1",
    });
    let started = mcp_tool(&client, &connection, "gchat_start_run", args.clone()).await;
    let run_id = started["runId"].as_str().expect("run ID").to_string();
    assert_eq!(started["reused"], false);
    let retried = mcp_tool(&client, &connection, "gchat_start_run", args).await;
    assert_eq!(retried["runId"], run_id);
    assert_eq!(retried["reused"], true);

    tokio::time::timeout(Duration::from_secs(5), async {
        while scripted.requests().is_empty() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("first pool worker began inference");

    let finished = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let run = mcp_tool(
                &client,
                &connection,
                "gchat_get_run",
                json!({ "runId": run_id }),
            )
            .await;
            if run["status"] == "finished" {
                break run;
            }
            assert!(
                run["status"] == "queued" || run["status"] == "running",
                "{run}"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("delegated run completed");
    assert!(finished["result"]
        .as_str()
        .unwrap_or_default()
        .contains("Pool worker finished the review."));
    assert_eq!(scripted.requests().len(), 1, "retry must not execute twice");
    assert_eq!(finished["originSessionId"], "code-ses_test");
    assert_eq!(finished["callerSessionId"], "ses_test");

    let allocator = Allocator::shared();
    let occupied = allocator
        .try_acquire(
            &[Candidate {
                instance_id: canonical.clone(),
                session_id: "occupied-test-slot".into(),
                concurrency: 1,
                worker_limit: 1,
                vision: false,
                context: 32768,
            }],
            &RoleAssignment::default(),
            None,
        )
        .expect("reserve sole pool slot");
    tests::register_caller(
        app.handle(),
        project.path(),
        &connection,
        "ses_second",
        BridgePolicy::default(),
    );
    let waiting = mcp_tool(
        &client,
        &connection,
        "gchat_start_run",
        json!({
            "definitionId": "bridge-pool-review",
            "task": "Review a second task.",
            "requestId": "pool-review-1",
            CALLER_SESSION_KEY: "ses_second",
        }),
    )
    .await;
    let waiting_id = waiting["runId"]
        .as_str()
        .expect("waiting run ID")
        .to_string();
    assert_ne!(
        waiting_id, run_id,
        "same requestId from another actual caller must create its own run"
    );
    close_session(&connection.session_id);
    let reconnected = prepare_session(app.handle(), project.path(), None, BridgePolicy::default())
        .expect("reconnected bridge");
    tests::register_caller(
        app.handle(),
        project.path(),
        &reconnected,
        "ses_test",
        BridgePolicy::default(),
    );
    let reconnect_status = client
        .post(&reconnected.url)
        .bearer_auth(&reconnected.token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "1" },
            },
        }))
        .send()
        .await
        .expect("reconnect initialize");
    assert_eq!(reconnect_status.status(), StatusCode::OK);
    let discovered = mcp_tool(&client, &reconnected, "gchat_list_runs", json!({})).await;
    assert!(discovered
        .as_array()
        .expect("project runs")
        .iter()
        .any(|run| run["runId"] == waiting_id));

    let other_project = tempfile::tempdir().expect("other Code project");
    let other = prepare_session(
        app.handle(),
        other_project.path(),
        None,
        BridgePolicy::default(),
    )
    .expect("other bridge");
    tests::register_caller(
        app.handle(),
        other_project.path(),
        &other,
        "ses_other",
        BridgePolicy::default(),
    );
    let denied: Value = client
        .post(&other.url)
        .bearer_auth(&other.token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "gchat_get_run", "arguments": { "runId": waiting_id, CALLER_SESSION_KEY: "ses_other" } },
        }))
        .send()
        .await
        .expect("other project request")
        .json()
        .await
        .expect("other project response");
    assert_eq!(denied["result"]["isError"], true);
    assert!(denied["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .contains("another project"));
    close_session(&other.session_id);

    let cancelled = mcp_tool(
        &client,
        &reconnected,
        "gchat_cancel_run",
        json!({ "runId": waiting_id }),
    )
    .await;
    assert_eq!(cancelled["cancelled"], true);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let run = mcp_tool(
                &client,
                &reconnected,
                "gchat_get_run",
                json!({ "runId": waiting_id }),
            )
            .await;
            if run["status"] == "cancelled" {
                break;
            }
            assert!(
                run["status"] == "queued" || run["status"] == "running",
                "{run}"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("waiting worker cancelled");

    drop(occupied);
    assert_eq!(
        scripted.requests().len(),
        1,
        "cancelled worker must not infer"
    );

    let records = runs::list_runs(data.path()).expect("Agent Studio history");
    let record = records
        .iter()
        .find(|record| record.run_id == run_id)
        .expect("delegated run saved in Studio history");
    assert_eq!(record.status, "finished");
    assert_eq!(record.definition_id, "bridge-pool-review");
    assert_eq!(record.final_reply, "Pool worker finished the review.");
    assert_eq!(
        record.role_assignments["agent"].target,
        WorkerTarget::Pool { id: pool.id }
    );
    assert_eq!(record.stages[0].model_instance_id, canonical);
    assert!(record.fleet_revision.is_some());
    let cancelled_record = records
        .iter()
        .find(|record| record.run_id == waiting_id)
        .expect("cancelled run saved in Studio history");
    assert_eq!(cancelled_record.status, "cancelled");
    close_session(&reconnected.session_id);
}
