//! Sub-agent dispatch for bot tasks, with the same `agent_dispatch` contract as
//! Chat: one call starts one child task per brief on the same computer and
//! model, waits for all of them and returns every result to the parent task.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::executor::{FunctionTool, TaskRecord, TaskState, ToolBinding};

pub const DISPATCH_TOOL: &str = "agent_dispatch";
pub const MAX_SUB_AGENTS: usize = 8;
pub const STOPPED_BY_USER_NOTE: &str =
    "The user stopped this sub-agent. Do not dispatch it again unless the user asks.";
const INSTRUCTIONS: &str = "You are a sub-agent doing one part of a larger task on this bot's computer. Other sub-agents may use the same computer at the same time: use only the apps, windows and files your task needs, observe the current state before every action, and do not close or change anything else. Finish by replying with your result.";

/// A child task's place in its parent's dispatch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubAgentLink {
    pub parent: Uuid,
    pub call_id: String,
    pub index: usize,
    pub title: String,
}

/// The parent's journal entry; a saved reply is returned instead of dispatching again.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DispatchCall {
    pub call_id: String,
    pub reply: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Brief {
    pub title: String,
    pub task: String,
}

pub fn tool() -> FunctionTool {
    FunctionTool {
        name: DISPATCH_TOOL.into(),
        description: "Dispatch one or more sub-agents that work on separate tasks at the same time, wait for all of them, and return each result. Use this whenever the user asks you to dispatch, delegate to, or use agents or sub-agents, or when a task splits into independent parts. Each sub-agent is a task on this bot's computer with this bot's model and tools; give each one its own apps, windows or files so they do not interfere. A sub-agent cannot see this task, so each task must be complete on its own: include names, details and the expected answer. The user sees every sub-agent working and can stop any of them; a stopped sub-agent was stopped on purpose, so do not dispatch it again unless the user asks.".into(),
        parameters: json!({
            "type": "object",
            "properties": {"agents": {
                "type": "array", "minItems": 1, "maxItems": MAX_SUB_AGENTS,
                "items": {"type": "object", "properties": {
                    "title": {"type": "string", "description": "A short name the user sees, for example \"Summarize notes.txt\"."},
                    "task": {"type": "string", "description": "The complete instructions for this sub-agent."}
                }, "required": ["title", "task"], "additionalProperties": false}
            }},
            "required": ["agents"],
            "additionalProperties": false
        }),
        binding: ToolBinding::Dispatch,
    }
}

/// Validates model arguments before any child starts.
pub fn parse_briefs(args: &Value) -> Result<Vec<Brief>, String> {
    let agents = args["agents"]
        .as_array()
        .filter(|agents| !agents.is_empty())
        .ok_or("agents must list at least one sub-agent task")?;
    if agents.len() > MAX_SUB_AGENTS {
        return Err(format!(
            "Dispatch at most {MAX_SUB_AGENTS} sub-agents at once"
        ));
    }
    agents
        .iter()
        .enumerate()
        .map(|(index, agent)| {
            let task = agent["task"].as_str().unwrap_or_default().trim();
            if task.is_empty() {
                return Err(format!("Sub-agent {} needs a task", index + 1));
            }
            let title = agent["title"]
                .as_str()
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map_or_else(|| format!("Sub-agent {}", index + 1), str::to_owned);
            Ok(Brief {
                title,
                task: task.to_owned(),
            })
        })
        .collect()
}

pub fn child_messages(task: &str) -> Vec<Value> {
    vec![
        json!({"role":"system","content":INSTRUCTIONS}),
        json!({"role":"user","content":task}),
    ]
}

/// A child in one of these states no longer needs its parent to wait; a
/// child waiting for a person's answer keeps the parent waiting.
pub fn settled(state: TaskState) -> bool {
    matches!(
        state,
        TaskState::Completed
            | TaskState::Cancelled
            | TaskState::NeedsReview
            | TaskState::Interrupted
            | TaskState::Paused
    )
}

fn reply_text(record: &TaskRecord) -> Option<String> {
    let content = &record
        .messages
        .iter()
        .rev()
        .find(|message| message["role"] == "assistant")?["content"];
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    Some(text).filter(|text| !text.trim().is_empty())
}

/// One entry of the parent's tool result.
pub fn outcome(brief: &Brief, record: &TaskRecord) -> Value {
    let mut entry = json!({"title": brief.title, "taskId": record.id});
    let reason = record.history.last().map(|event| event.reason.clone());
    match record.state {
        TaskState::Completed => {
            entry["status"] = "done".into();
            if let Some(text) = reply_text(record) {
                entry["result"] = text.into();
            }
        }
        TaskState::Cancelled => {
            entry["status"] = "stopped".into();
            entry["note"] = STOPPED_BY_USER_NOTE.into();
        }
        TaskState::NeedsReview => {
            entry["status"] = "failed".into();
            entry["error"] =
                "This sub-agent stopped because a tool result is uncertain; it needs review.".into();
        }
        _ => {
            entry["status"] = "not_finished".into();
            if let Some(reason) = reason {
                entry["error"] = reason.into();
            }
        }
    }
    entry
}

pub fn failed(brief: &Brief, error: &str) -> Value {
    json!({"title": brief.title, "status": "failed", "error": error})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn briefs_are_validated_before_any_child_starts() {
        assert_eq!(
            parse_briefs(&json!({"agents":[{"title":" Notes ","task":" Read notes.txt "},{"task":"Two"}]}))
                .unwrap(),
            vec![
                Brief { title: "Notes".into(), task: "Read notes.txt".into() },
                Brief { title: "Sub-agent 2".into(), task: "Two".into() },
            ]
        );
        assert!(parse_briefs(&json!({"agents":[]})).unwrap_err().contains("at least one"));
        assert!(parse_briefs(&json!({"agents":[{"title":"x","task":" "}]}))
            .unwrap_err()
            .contains("Sub-agent 1 needs a task"));
        let nine: Vec<_> = (0..9).map(|n| json!({"title":n.to_string(),"task":"x"})).collect();
        assert!(parse_briefs(&json!({"agents":nine})).unwrap_err().contains("at most 8"));
        assert_eq!(tool().parameters["properties"]["agents"]["maxItems"], MAX_SUB_AGENTS);
    }
}
