//! Opt-in physical LAN test. Launch two hosts with --discoverable --pair first.
//! GINFER_LAN_HOSTS is a JSON array of {origin, fingerprint, code, host_id}.
//! Credentials remain in memory and are revoked after each host check.
use ginfer_host::{discovery::Discovery, transport::pinned_client};
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct Target {
    origin: String,
    fingerprint: String,
    code: String,
    host_id: uuid::Uuid,
    artifact: Option<String>,
}

async fn ready(
    client: &reqwest::Client,
    origin: &str,
    token: &str,
    id: uuid::Uuid,
) -> Result<serde_json::Value, String> {
    tokio::time::timeout(Duration::from_secs(600), async {
        loop {
            let snapshot: serde_json::Value = client
                .get(format!("{origin}/host/v1/snapshot"))
                .bearer_auth(token)
                .timeout(Duration::from_secs(10))
                .send()
                .await
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let instance = snapshot["instances"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["instance_id"] == id.to_string())
                .ok_or("instance missing")?;
            match instance["status"].as_str() {
                Some("ready") => return Ok(instance.clone()),
                Some("failed") => return Err(format!("engine failed: {}", instance["last_error"])),
                _ => tokio::time::sleep(Duration::from_secs(1)).await,
            }
        }
    })
    .await
    .map_err(|_| "engine readiness timeout".to_string())?
}

#[tokio::test]
#[ignore = "loads real models on explicitly released singleton GPUs; requires fresh pairing codes"]
async fn physical_lan_real_engine_load_infer_reload_and_stop() {
    let targets: Vec<Target> =
        serde_json::from_str(&std::env::var("GINFER_LAN_HOSTS").expect("set GINFER_LAN_HOSTS"))
            .unwrap();
    assert!(targets.len() >= 2);
    for target in targets {
        let client = pinned_client(&target.fingerprint).unwrap();
        let url = |path: &str| format!("{}{path}", target.origin);
        let pair: serde_json::Value = client.post(url("/host/v1/pair"))
            .json(&serde_json::json!({"code":target.code,"client_name":"Real Engine LAN qualification"}))
            .timeout(Duration::from_secs(10)).send().await.unwrap()
            .error_for_status().unwrap().json().await.unwrap();
        let token = pair["token"].as_str().unwrap();
        let client_id = pair["client_id"].as_str().unwrap();
        let id = uuid::Uuid::new_v4();
        let result: Result<(), String> = async {
            let snapshot: serde_json::Value = client.get(url("/host/v1/snapshot"))
                .bearer_auth(token).timeout(Duration::from_secs(10)).send().await
                .map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?
                .json().await.map_err(|e|e.to_string())?;
            if snapshot["host_id"] != target.host_id.to_string() { return Err("wrong host".into()); }
            let artifact = target.artifact.as_ref().ok_or("explicit artifact required")?;
            let model = snapshot["models"].as_array().unwrap().iter()
                .find(|m| m["path"] == *artifact && m["metadata"]["tp_size"] == 1 && m["artifact_set"] == false)
                .ok_or("explicit TP1 artifact missing")?;
            let gpus = snapshot["gpus"].as_array().unwrap();
            if gpus.len() != 1 { return Err("test requires explicitly released singleton host".into()); }
            client.post(url("/host/v1/instances")).bearer_auth(token)
                .json(&serde_json::json!({"instance_id":id,"model_id":model["id"],
                    "gpu_uuids":[gpus[0]["uuid"]],"max_context":8192,"concurrency":1,
                    "vision":false,"spec":"none","kv_dtype":"int8","kv_arena_bytes":1073741824u64}))
                .timeout(Duration::from_secs(30)).send().await.map_err(|e|e.to_string())?
                .error_for_status().map_err(|e|e.to_string())?;
            let first = ready(&client,&target.origin,token,id).await?;
            eprintln!("{}: engine ready",target.origin);
            let response: serde_json::Value = client.post(url(&format!("/host/v1/instances/{id}/inference/v1/chat/completions")))
                .bearer_auth(token).json(&serde_json::json!({"model":"host-rewrites-this", "messages":[{"role":"user","content":"Reply with the word hello."}],"max_tokens":16,"temperature":0}))
                .timeout(Duration::from_secs(120)).send().await.map_err(|e|e.to_string())?
                .error_for_status().map_err(|e|e.to_string())?.json().await.map_err(|e|e.to_string())?;
            if response["choices"].as_array().is_none_or(|a|a.is_empty()) || response["usage"]["completion_tokens"].as_u64().unwrap_or(0)==0 {
                return Err(format!("missing generated output/accounting: {response}"));
            }
            client.post(url(&format!("/host/v1/instances/{id}/reload"))).bearer_auth(token)
                .json(&serde_json::json!({"force":false})).timeout(Duration::from_secs(45))
                .send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
            let second = ready(&client,&target.origin,token,id).await?;
            if first["session_id"] == second["session_id"] {return Err("reload did not change session".into());}
            eprintln!("{}: real generation and reload/session replacement passed",target.origin);
            Ok(())
        }.await;
        // Always attempt cleanup, including when load/readiness/inference fails.
        let stop = client
            .post(url(&format!("/host/v1/instances/{id}/stop")))
            .bearer_auth(token)
            .json(&serde_json::json!({"force":true}))
            .timeout(Duration::from_secs(45))
            .send()
            .await;
        let revoke = client
            .delete(url(&format!("/host/v1/clients/{client_id}")))
            .bearer_auth(token)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .unwrap();
        assert!(revoke.status().is_success());
        assert!(result.is_ok(), "{}: {result:?}", target.origin);
        assert!(stop.unwrap().status().is_success());
    }
}

#[tokio::test]
#[ignore = "requires two explicitly configured physical LAN hosts and fresh pairing codes"]
async fn physical_lan_discovery_pairing_snapshot_and_revocation() {
    let targets: Vec<Target> =
        serde_json::from_str(&std::env::var("GINFER_LAN_HOSTS").expect("set GINFER_LAN_HOSTS"))
            .unwrap();
    assert!(targets.len() >= 2, "two physical hosts required");
    let ids: std::collections::BTreeSet<_> = targets.iter().map(|t| t.host_id).collect();
    assert_eq!(ids.len(), targets.len(), "host identities must be distinct");
    let discovery = Discovery::start().unwrap();
    let discovered = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let hosts = discovery.hosts();
            if targets.iter().all(|target| {
                hosts
                    .iter()
                    .any(|h| h.host_id == target.host_id.to_string())
            }) {
                return hosts;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    })
    .await;
    // Check manual TLS pairing even when the network blocks multicast, then report
    // discovery failure separately. Never treat manual reachability as mDNS proof.
    for target in targets {
        let client = pinned_client(&target.fingerprint).unwrap();
        let url = |path: &str| format!("{}{path}", target.origin);
        let pair = client
            .post(url("/host/v1/pair"))
            .timeout(Duration::from_secs(10))
            .json(
                &serde_json::json!({"code":target.code,"client_name":"Physical LAN qualification"}),
            )
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap();
        let token = pair["token"].as_str().unwrap();
        let client_id = pair["client_id"].as_str().unwrap();
        let snapshot = ginfer_host::transport::host_snapshot_at(
            &target.origin,
            &target.fingerprint,
            token,
            target.host_id,
        )
        .await;
        let revoke = client
            .delete(url(&format!("/host/v1/clients/{client_id}")))
            .bearer_auth(token)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .unwrap();
        assert!(revoke.status().is_success(), "grant revocation failed");
        assert!(snapshot.is_ok(), "snapshot failed for {}", target.origin);
        let rejected = client
            .get(url("/host/v1/snapshot"))
            .bearer_auth(token)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), 401);
        eprintln!(
            "{}: pinned TLS, pairing, identity, snapshot, revocation passed",
            target.origin
        );
    }
    assert!(
        discovered.is_ok(),
        "physical mDNS discovery did not resolve both hosts within 30 seconds"
    );
}
