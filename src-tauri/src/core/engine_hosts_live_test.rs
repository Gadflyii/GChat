//! Opt-in native desktop IPC-to-physical-host qualification. No user data paths.
use super::*;
use crate::test_support::IpcTestHarness;
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires native OS vault and an explicitly released remote singleton GPU; run alone"]
fn desktop_ipc_pair_launch_route_benchmark_and_forget_live_host() {
    let target: Value = serde_json::from_str(&std::env::var("GCHAT_LIVE_HOST").expect("GCHAT_LIVE_HOST required")).unwrap();
    let host_id: Uuid = target["host_id"].as_str().unwrap().parse().unwrap();
    let instance_id = Uuid::new_v4();
    let harness = IpcTestHarness::new(|builder| builder
        .manage(tauri_plugin_ginfer::state::GinferState::default())
        .invoke_handler(tauri::generate_handler![engine_hosts_command]));
    let invoke = |action: &str, args: Value| -> Result<Value, String> {
        harness.invoke("engine_hosts_command", json!({"action":action,"args":args})).map_err(|e|e.to_string())
    };
    let paired = invoke("pair", json!({"base_url":target["origin"],"fingerprint":target["fingerprint"],"code":target["code"]})).unwrap();
    let client_id: Uuid = paired["client_id"].as_str().unwrap().parse().unwrap();
    let result = (|| -> Result<(), String> {
        if paired["host_id"] != host_id.to_string() { return Err("paired wrong host".into()); }
        let snapshot = invoke("snapshot", json!({"host_id":host_id}))?;
        let models = snapshot["models"].as_array().ok_or("missing inventory")?;
        let model = models.iter().find(|m| m["path"] == target["artifact"] && m["metadata"]["tp_size"] == 1 && m["artifact_set"] == false).ok_or("exact TP1 artifact absent")?;
        let gpus = snapshot["gpus"].as_array().ok_or("missing GPUs")?;
        if gpus.len()!=1 { return Err("requires released singleton GPU".into()); }
        invoke("launch", json!({"host_id":host_id,"body":{
            "instance_id":instance_id,"model_id":model["id"],"gpu_uuids":[gpus[0]["uuid"]],
            "max_context":8192,"concurrency":1,"spec":"none","vision":false,
            "kv_dtype":"int8","kv_arena_bytes":1073741824u64
        }}))?;
        let deadline=Instant::now()+Duration::from_secs(600);
        loop {
            let snapshot=match invoke("snapshot",json!({"host_id":host_id})) {
                Ok(snapshot)=>snapshot,
                Err(error) if Instant::now()<deadline=>{
                    eprintln!("Snapshot observation failed; retrying the same instance: {error}");
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                },
                Err(error)=>return Err(format!("readiness observation deadline: {error}")),
            };
            let instance=snapshot["instances"].as_array().unwrap().iter().find(|i|i["instance_id"]==instance_id.to_string()).ok_or("instance missing")?;
            if instance["status"]=="ready" {break;}
            if instance["status"]=="failed" {return Err(format!("engine startup: {}",instance["last_error"]));}
            if Instant::now()>deadline {return Err("readiness timeout".into());}
            std::thread::sleep(Duration::from_secs(1));
        }
        let alias=format!("ginfer/{host_id}/{instance_id}");
        tauri::async_runtime::block_on(async {
            if !available_models().await.iter().any(|m|m["id"]==alias) {return Err("facade model missing".to_string());}
            if !agent_instances().await.iter().any(|i|i.id==alias) {return Err("agent instance missing".to_string());}
            let _target=agent_target(&alias).await?;
            let body=json!({"model":alias,"messages":[{"role":"user","content":"Reply with hello."}],"max_tokens":16,"temperature":0});
            let response=forward_alias(&alias,"/chat/completions",&body).await?;
            if !response.status().is_success() {return Err(format!("chat status {}",response.status()));}
            let bytes=hyper::body::to_bytes(response.into_body()).await.map_err(|e|e.to_string())?;
            let output:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
            if output["model"]!=alias || output["usage"]["completion_tokens"].as_u64().unwrap_or(0)==0 {return Err("alias/output accounting mismatch".into());}
            let mut streaming=body; streaming["stream"]=true.into();
            let response=forward_alias(&alias,"/chat/completions",&streaming).await?;
            if !response.status().is_success() {return Err("stream request failed".into());}
            let bytes=hyper::body::to_bytes(response.into_body()).await.map_err(|e|e.to_string())?;
            let text=std::str::from_utf8(&bytes).map_err(|e|e.to_string())?;
            if !text.contains(&alias) || !text.contains("[DONE]") {return Err("stream alias/framing mismatch".into());}
            Ok::<_,String>(())
        })?;
        let sessions=invoke("benchmark_sessions",json!({}))?;
        if !sessions.as_array().ok_or("benchmark sessions missing")?.iter().any(|s|s["target_id"]==alias) {return Err("benchmark selection missing".into());}
        let bench=invoke("benchmark",json!({"target_id":alias,"request":{
            "run_id":Uuid::new_v4().to_string(),"prompt_tokens":128,"max_output_tokens":16,
            "concurrencies":[1],"warmup_rounds":0,"measured_rounds":1
        }}))?;
        if bench["points"].as_array().is_none_or(|p|p.is_empty()) {return Err(format!("benchmark returned no points: {bench}"));}
        let persisted=std::fs::read_to_string(harness.data_root().join("ginfer/hosts.json")).map_err(|e|e.to_string())?;
        let credential=tauri::async_runtime::block_on(secret(client_id))?;
        if persisted.contains(&credential) {return Err("credential leaked to registry file".into());}
        Ok(())
    })();
    let stop=invoke("stop",json!({"host_id":host_id,"instance_id":instance_id,"body":{"force":true}}));
    let revoke=tauri::async_runtime::block_on(request(host_id,reqwest::Method::DELETE,&format!("/host/v1/clients/{client_id}"),None));
    let forget=invoke("forget",json!({"host_id":host_id}));
    assert!(result.is_ok(),"{result:?}");
    assert!(stop.is_ok(),"stop failed: {stop:?}");
    assert!(revoke.unwrap().status().is_success());
    assert!(forget.is_ok(),"forget failed: {forget:?}");
    assert!(tauri::async_runtime::block_on(secret(client_id)).is_err());
    assert!(tauri::async_runtime::block_on(available_models()).is_empty());
}
