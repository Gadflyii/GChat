use super::*;
use crate::core::agent::{
    ginfer_client::GinferConnection,
    test_support::{ScriptedGinferServer, ScriptedResponse},
    worker_pools::{
        self, Allocator, Candidate, PoolMember, RoleAssignment, WorkerPool, WorkerTarget,
    },
};
use crate::test_support::TestDataRoot;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_ginfer::state::{GinferSession, GinferState, SessionInfo, SessionOwner};

async fn mcp_tool(
    client: &reqwest::Client,
    connection: &BridgeConnection,
    name: &str,
    arguments: Value,
) -> Value {
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
    let host_state = tempfile::tempdir().expect("host state");
    let host = ginfer_host::service::Host::open(
        host_state.path().into(),
        "Fixture".into(),
        std::env::current_exe().expect("test executable"),
        vec![],
        vec![],
        vec![],
    )
    .await
    .expect("fixture host");
    let owner = SessionOwner {
        control: Arc::new(
            ginfer_host::launcher::LocalControl::open(host_state.path(), "https://127.0.0.1:1")
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
    drop(host);
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
        .manage(ginfer)
        .build(mock_context(noop_assets()))
        .expect("mock GChat");
    let pool = worker_pools::save(
        data.path(),
        WorkerPool {
            id: String::new(),
            name: "Review workers".into(),
            members: vec![PoolMember {
                instance_id: MODEL_ID.into(),
                worker_limit: 1,
            }],
        },
    )
    .expect("saved worker pool");
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

    let connection = prepare_session(app.handle(), project.path(), None).expect("Code bridge");
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

    let allocator = Allocator::shared();
    let occupied = allocator
        .try_acquire(
            &[Candidate {
                instance_id: MODEL_ID.into(),
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
    let waiting = mcp_tool(
        &client,
        &connection,
        "gchat_start_run",
        json!({
            "definitionId": "bridge-pool-review",
            "task": "Review a second task.",
            "requestId": "pool-review-cancel",
        }),
    )
    .await;
    let waiting_id = waiting["runId"]
        .as_str()
        .expect("waiting run ID")
        .to_string();
    close_session(&connection.session_id);
    let reconnected =
        prepare_session(app.handle(), project.path(), None).expect("reconnected bridge");
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
    let other = prepare_session(app.handle(), other_project.path(), None).expect("other bridge");
    let denied: Value = client
        .post(&other.url)
        .bearer_auth(&other.token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "gchat_get_run", "arguments": { "runId": waiting_id } },
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
    assert_eq!(record.stages[0].model_instance_id, MODEL_ID);
    let cancelled_record = records
        .iter()
        .find(|record| record.run_id == waiting_id)
        .expect("cancelled run saved in Studio history");
    assert_eq!(cancelled_record.status, "cancelled");
    close_session(&reconnected.session_id);
}
