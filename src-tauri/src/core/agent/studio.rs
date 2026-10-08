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
    if action == "compact_worker" {
        let id = args
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Worker context id is required")?;
        super::context::request_compaction(id)?;
        return Ok(json!({"queued":true}));
    }
    if action == "stop_run" {
        let id = args
            .get("id")
            .and_then(Value::as_str)
            .ok_or("id is required")?;
        super::commands::agent_cancel_turn(app.state(), id.into()).await?;
        return Ok(json!({"stopped":true}));
    }
    let catalog = matches!(action, "catalog" | "capacity");
    if action == "fleet_authority" {
        worker_pools::configure(
            &app,
            args.get("hostId")
                .and_then(Value::as_str)
                .ok_or("hostId is required")?
                .parse()
                .map_err(|error: uuid::Error| error.to_string())?,
            args.get("origin")
                .and_then(Value::as_str)
                .map(str::to_owned),
        )
        .await?;
        return Ok(json!({"configured":true}));
    }
    if action == "save_pool" || action == "delete_pool" {
        let revision = args.get("expectedRevision").and_then(Value::as_u64).ok_or(
            "Refresh the fleet catalog and provide expectedRevision before editing a pool",
        )?;
        return if action == "save_pool" {
            Ok(json!(
                worker_pools::save(
                    &app,
                    serde_json::from_value(args.get("pool").cloned().ok_or("pool is required")?)
                        .map_err(|error| error.to_string())?,
                    revision
                )
                .await?
            ))
        } else {
            worker_pools::remove(
                &app,
                args.get("id")
                    .and_then(Value::as_str)
                    .ok_or("id is required")?,
                revision,
            )
            .await?;
            Ok(json!({"deleted":true}))
        };
    }
    let pools = if catalog || action == "pools" {
        Some(worker_pools::catalog(&app, &data).await?)
    } else {
        None
    };
    if action == "pools" {
        return Ok(json!(pools));
    }
    let action = action.to_owned();
    let mut result = tokio::task::spawn_blocking(move || {
    let id = || args.get("id").and_then(Value::as_str).ok_or_else(|| "id is required".to_string());
    match action.as_str() {
        "capacity" => Ok(json!({"usage":worker_pools::Allocator::shared().usage()})),
        "catalog" => Ok(json!({
            "localModelDirectory": data.join("ginfer").join("models"),
            "definitionSchema": definitions::definition_json_schema(),
            "definitions": definitions::list_definitions(&data)?,
            "templates": definitions::built_in_templates(),
            "usage": worker_pools::Allocator::shared().usage(),
            "assignmentExample": {"target":{"kind":"pool","id":"pool UUID"},"vision":true,"minimumContext":8192},
            "roles": {"standard":["agent"],"goal_loop":["executor","evaluator"],"coordinator":["coordinator","synthesizer","worker:<worker id>"],"workflow":["workflow:<node id>"]},
        })),
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
        if let Some(pools) = pools {
            let fields = serde_json::to_value(pools).map_err(|error| error.to_string())?;
            result
                .as_object_mut()
                .ok_or("Studio catalog must be an object")?
                .extend(
                    fields
                        .as_object()
                        .ok_or("Fleet catalog must be an object")?
                        .clone(),
                );
        }
        result["instances"] =
            json!(super::commands::agent_list_model_instances(app.clone(), app.state()).await?);
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
