//! Bounded Agent Studio run history.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_jan_data_folder_path;

use super::definitions::{AgentDefinition, AgentReasoningEffort};
use super::runner::AgentTurnOutcome;
use super::types::{AgentEvent, AgentInferenceMetrics};

const RUN_HISTORY_FILE: &str = "agent-runs.json";
const RUN_HISTORY_SCHEMA_VERSION: u32 = 3;
const MAX_RUN_HISTORY: usize = 100;
static RUN_HISTORY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub schema_version: u32,
    pub id: String,
    pub run_id: String,
    pub session_id: String,
    pub definition_id: String,
    pub definition_name: String,
    pub kind: String,
    pub status: String,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub total_steps: u32,
    pub final_reply: String,
    pub default_model_instance_id: String,
    pub stages: Vec<AgentRunStage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStage {
    pub stage_id: String,
    pub name: String,
    pub status: String,
    pub summary: String,
    pub step_count: u32,
    pub duration_ms: u64,
    pub model_instance_id: String,
    pub model_id: String,
    #[serde(default)]
    pub reasoning_effort: Option<AgentReasoningEffort>,
    #[serde(default)]
    pub inference: AgentInferenceMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunHistory {
    schema_version: u32,
    runs: Vec<AgentRunRecord>,
}

impl AgentRunRecord {
    pub fn completed(
        id: &str,
        run_id: &str,
        session_id: &str,
        definition: &AgentDefinition,
        started_at_ms: u64,
        events: &[AgentEvent],
        result: &Result<AgentTurnOutcome, String>,
    ) -> Self {
        let stages = events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::StageFinished {
                    stage_id,
                    name,
                    status,
                    summary,
                    step_count,
                    duration_ms,
                    model_instance_id,
                    model_id,
                    reasoning_effort,
                    inference,
                } => Some(AgentRunStage {
                    stage_id: stage_id.clone(),
                    name: name.clone(),
                    status: status.clone(),
                    summary: summary.clone(),
                    step_count: *step_count,
                    duration_ms: *duration_ms,
                    model_instance_id: model_instance_id.clone(),
                    model_id: model_id.clone(),
                    reasoning_effort: *reasoning_effort,
                    inference: *inference,
                }),
                _ => None,
            })
            .collect::<Vec<_>>();
        let completed_stage_steps = stages.iter().map(|stage| stage.step_count).sum();
        let (status, total_steps, final_reply) = match result {
            Ok(outcome) => (
                if outcome.reason == "cancelled" {
                    "cancelled"
                } else {
                    "finished"
                },
                outcome.step_count,
                outcome.reply.clone().unwrap_or_default(),
            ),
            Err(error) => ("failed", completed_stage_steps, error.clone()),
        };
        let kind = events
            .iter()
            .find_map(|event| match event {
                AgentEvent::OrchestrationStarted { kind, .. } => Some(kind.clone()),
                _ => None,
            })
            .unwrap_or_else(|| "standard".into());
        let default_model_instance_id = events
            .iter()
            .find_map(|event| match event {
                AgentEvent::OrchestrationStarted {
                    default_model_instance_id,
                    ..
                } => Some(default_model_instance_id.clone()),
                _ => None,
            })
            .unwrap_or_default();
        Self {
            schema_version: RUN_HISTORY_SCHEMA_VERSION,
            id: id.into(),
            run_id: run_id.into(),
            session_id: session_id.into(),
            definition_id: definition.id.clone(),
            definition_name: definition.name.clone(),
            kind,
            status: status.into(),
            started_at_ms,
            finished_at_ms: now_ms(),
            total_steps,
            final_reply,
            default_model_instance_id,
            stages,
        }
    }
}

pub fn record_run(data_folder: &Path, record: AgentRunRecord) -> Result<(), String> {
    let _guard = RUN_HISTORY_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Agent run-history lock is poisoned".to_string())?;
    let mut history = read_history(data_folder)?;
    history.runs.insert(0, record);
    let removed = if history.runs.len() > MAX_RUN_HISTORY {
        history.runs.split_off(MAX_RUN_HISTORY)
    } else {
        Vec::new()
    };
    write_history(data_folder, &history)?;
    for run in removed {
        prune_run_workspace(data_folder, &run.id);
    }
    Ok(())
}

pub fn list_runs(data_folder: &Path) -> Result<Vec<AgentRunRecord>, String> {
    Ok(read_history(data_folder)?.runs)
}

fn prune_run_workspace(data_folder: &Path, id: &str) {
    if uuid::Uuid::parse_str(id).is_err() {
        return;
    }
    let path = data_folder.join("agent-runs").join(id);
    if let Err(error) = std::fs::remove_dir_all(&path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "Failed to prune Agent run workspace '{}': {error}",
                path.display()
            );
        }
    }
}

fn history_path(data_folder: &Path) -> PathBuf {
    data_folder.join(RUN_HISTORY_FILE)
}

fn read_history(data_folder: &Path) -> Result<RunHistory, String> {
    let path = history_path(data_folder);
    if !path.exists() {
        return Ok(RunHistory {
            schema_version: RUN_HISTORY_SCHEMA_VERSION,
            runs: Vec::new(),
        });
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Failed to read Agent run history: {error}"))?;
    let mut history: RunHistory = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to parse Agent run history: {error}"))?;
    if !matches!(history.schema_version, 2 | RUN_HISTORY_SCHEMA_VERSION) {
        return Err(format!(
            "Unsupported Agent run-history schema version {}",
            history.schema_version
        ));
    }
    history.schema_version = RUN_HISTORY_SCHEMA_VERSION;
    for run in &mut history.runs {
        run.schema_version = RUN_HISTORY_SCHEMA_VERSION;
    }
    Ok(history)
}

fn write_history(data_folder: &Path, history: &RunHistory) -> Result<(), String> {
    std::fs::create_dir_all(data_folder)
        .map_err(|error| format!("Failed to create GChat data folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(history)
        .map_err(|error| format!("Failed to serialize Agent run history: {error}"))?;
    super::storage::atomic_write(&history_path(data_folder), &bytes, "Agent run history")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[tauri::command]
pub async fn agent_list_runs<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<Vec<AgentRunRecord>, String> {
    list_runs(&get_jan_data_folder_path(app_handle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::definitions::general_agent;

    #[test]
    fn keeps_newest_one_hundred_runs() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..105 {
            let outcome = Ok(AgentTurnOutcome {
                reply: Some(format!("reply-{index}")),
                reason: "reply".into(),
                step_count: 1,
                inference: AgentInferenceMetrics::default(),
            });
            record_run(
                root.path(),
                AgentRunRecord::completed(
                    &uuid::Uuid::new_v4().to_string(),
                    &format!("run-{index}"),
                    "session",
                    &general_agent(),
                    index,
                    &[],
                    &outcome,
                ),
            )
            .unwrap();
        }
        let runs = list_runs(root.path()).unwrap();
        assert_eq!(runs.len(), 100);
        assert_eq!(runs[0].run_id, "run-104");
        assert_eq!(runs[99].run_id, "run-5");
    }

    #[test]
    fn records_the_resolved_model_for_each_stage() {
        let outcome = Ok(AgentTurnOutcome {
            reply: Some("done".into()),
            reason: "reply".into(),
            step_count: 2,
            inference: AgentInferenceMetrics::default(),
        });
        let events = vec![
            AgentEvent::OrchestrationStarted {
                definition_id: "team".into(),
                definition_name: "Team".into(),
                kind: "coordinator".into(),
                default_model_instance_id: "coordinator-model".into(),
            },
            AgentEvent::StageFinished {
                stage_id: "researcher".into(),
                name: "Researcher".into(),
                status: "reply".into(),
                summary: "report".into(),
                step_count: 2,
                duration_ms: 50,
                model_instance_id: "research-model".into(),
                model_id: "research-model".into(),
                reasoning_effort: Some(AgentReasoningEffort::High),
                inference: AgentInferenceMetrics {
                    prompt_tokens: 100.0,
                    generated_tokens: 50.0,
                    prompt_ms: 10.0,
                    generation_ms: 100.0,
                },
            },
        ];

        let record = AgentRunRecord::completed(
            "record",
            "run",
            "session",
            &general_agent(),
            10,
            &events,
            &outcome,
        );

        assert_eq!(record.default_model_instance_id, "coordinator-model");
        assert_eq!(record.stages[0].model_instance_id, "research-model");
        assert_eq!(record.stages[0].inference.generated_tokens, 50.0);
    }
}
