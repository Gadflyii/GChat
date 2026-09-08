//! Shared Agent Studio operations for the desktop UI and bundled builder skill.
use super::{definitions, runs, worker_pools};
use crate::core::app::commands::get_jan_data_folder_path;
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, Runtime};

static LIVE: OnceLock<Mutex<BTreeMap<String, VecDeque<Value>>>> = OnceLock::new();
pub fn observe(run_id: &str, event: &super::types::AgentEvent) {
    use super::types::AgentEvent;
    fn compact(event: &AgentEvent) -> Option<Value> {
        Some(match event {
            AgentEvent::AssistantDelta { .. } | AgentEvent::ReasoningDelta { .. } => return None,
            AgentEvent::StageActivity { stage_id, event } => {
                json!({"type":"stage_activity","stage_id":stage_id,"event":compact(event)?})
            }
            AgentEvent::ToolCallParsed { call, .. } => {
                json!({"type":"tool_call_parsed","tool":call.tool})
            }
            AgentEvent::ToolCallExecuted { result } => {
                json!({"type":"tool_call_executed","tool":result.call.tool,"status":result.outcome.status,"summary":result.outcome.summary.chars().take(4096).collect::<String>()})
            }
            AgentEvent::AssistantReply { text } => {
                json!({"type":"assistant_reply","text":text.chars().take(8192).collect::<String>()})
            }
            event => json!(event),
        })
    }
    let Some(value) = compact(event) else { return };
    if let Ok(mut live) = LIVE.get_or_init(|| Mutex::new(BTreeMap::new())).lock() {
        let events = live.entry(run_id.into()).or_default();
        if events.len() >= 128 {
            events.pop_front();
        }
        events.push_back(value);
        // Durable completed records are owned by runs.rs, not this live view.
        if matches!(event, super::types::AgentEvent::TurnFinished { .. }) {
            live.remove(run_id);
        }
    }
}

pub async fn operation<R: Runtime>(
    app: AppHandle<R>,
    action: &str,
    args: Value,
) -> Result<Value, String> {
    let data = get_jan_data_folder_path(app.clone());
    if action == "stop_run" {
        let id = args
            .get("id")
            .and_then(Value::as_str)
            .ok_or("id is required")?;
        super::commands::agent_cancel_turn(app.state(), id.into()).await?;
        return Ok(json!({"stopped":true}));
    }
    let catalog = matches!(action, "catalog" | "capacity");
    let action = action.to_owned();
    let mut result = tokio::task::spawn_blocking(move || {
    let id = || args.get("id").and_then(Value::as_str).ok_or_else(|| "id is required".to_string());
    match action.as_str() {
        "capacity" => Ok(json!({"pools":worker_pools::list(&data)?,"usage":worker_pools::Allocator::shared().usage()})),
        "catalog" => Ok(json!({
            "definitions": definitions::list_definitions(&data)?,
            "templates": definitions::built_in_templates(),
            "pools": worker_pools::list(&data)?,
            "usage": worker_pools::Allocator::shared().usage(),
            "assignmentExample": {"target":{"kind":"pool","id":"pool UUID"},"vision":true,"minimumContext":8192},
            "roles": {"standard":["agent"],"goal_loop":["executor","evaluator"],"coordinator":["coordinator","synthesizer","worker:<worker id>"],"workflow":["workflow:<node id>"]},
        })),
        "pools" => Ok(json!(worker_pools::list(&data)?)),
        "save_pool" => Ok(json!(worker_pools::save(&data, serde_json::from_value(args).map_err(|e| e.to_string())?)?)),
        "delete_pool" => { worker_pools::remove(&data, id()?)?; Ok(json!({"deleted":true})) },
        "get_definition" => Ok(json!(definitions::get_definition(&data, id()?)?)),
        "validate_definition" => {
            let definition: definitions::AgentDefinition = serde_json::from_value(args).map_err(|e| e.to_string())?;
            definitions::validate_definition(&definition)?;
            Ok(json!({"valid":true,"roles":definitions::placement_roles(&definition)}))
        }
        "save_definition" => Ok(json!(definitions::save_definition(&data, serde_json::from_value(args).map_err(|e| e.to_string())?)?)),
        "runs" => Ok(json!(runs::list_runs(&data)?)),
        "monitor" => Ok(json!({"active": LIVE.get_or_init(|| Mutex::new(BTreeMap::new())).lock().map_err(|e|e.to_string())?.clone(), "completed":runs::list_runs(&data)?})),
        _ => Err(format!("Unsupported Agent Studio operation `{action}`")),
    }
    }).await.map_err(|e| e.to_string())??;
    if catalog {
        result["instances"] =
            json!(super::commands::agent_list_model_instances(app.state()).await?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn agent_studio<R: Runtime>(
    app: AppHandle<R>,
    action: String,
    args: Value,
) -> Result<Value, String> {
    operation(app, &action, args).await
}
