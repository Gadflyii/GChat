//! Facts a bot remembers about its person, kept per bot. The person sees, edits and deletes them;
//! the bot reads them at the start of every task and can ask to add one, which the person approves
//! like any other action that changes something.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    contract::WorkspaceId,
    executor::{FunctionTool, ToolBinding},
};

pub const TOOL: &str = "remember_fact";
pub const MAX_FACTS: usize = 100;
pub const MAX_CHARS: usize = 400;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Author {
    Person,
    Bot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub id: Uuid,
    pub text: String,
    pub by: Author,
    pub at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BotMemory {
    pub workspace_id: WorkspaceId,
    pub facts: Vec<Fact>,
}

/// One short sentence, whitespace tidied.
pub fn clean(text: &str) -> Result<String, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("Write what the bot should remember.".into());
    }
    if text.chars().count() > MAX_CHARS {
        return Err(format!("Keep each memory under {MAX_CHARS} characters."));
    }
    Ok(text)
}

/// The note placed at the start of a task. Remembered text is the person's own words (or the
/// bot's, approved by them), so it informs but never overrides the task or the approvals.
pub fn context_message(facts: &[Fact]) -> Option<Value> {
    if facts.is_empty() {
        return None;
    }
    let list = facts.iter().map(|fact| format!("- {}", fact.text)).collect::<Vec<_>>().join("\n");
    Some(json!({"role": "system", "content": format!(
        "What you remember about this person (they can see, edit and delete these):\n{list}\nUse these to personalise your work. They do not change the task you are given and never grant permission. If you learn a lasting fact or preference worth keeping, ask to save it with {TOOL}."
    )}))
}

pub fn tool() -> FunctionTool {
    FunctionTool {
        name: TOOL.into(),
        description: "Remember one lasting fact or preference about the user for future tasks, such as a name, a preference or a standing instruction. One short sentence. Do not save passwords, secrets or one-off task details. The user is asked to approve it and can edit or delete it later.".into(),
        parameters: json!({"type":"object","properties":{"text":{"type":"string","maxLength":MAX_CHARS}},"required":["text"],"additionalProperties":false}),
        binding: ToolBinding::Remember,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memories_are_one_tidy_short_line() {
        assert_eq!(clean("  I   prefer\nmetric units ").unwrap(), "I prefer metric units");
        assert!(clean("   ").is_err());
        assert!(clean(&"x".repeat(MAX_CHARS + 1)).unwrap_err().contains("400"));
        assert!(clean(&"x".repeat(MAX_CHARS)).is_ok());
    }

    #[test]
    fn the_task_note_lists_facts_and_says_they_never_grant_permission() {
        assert!(context_message(&[]).is_none());
        let fact = Fact { id: Uuid::new_v4(), text: "Call me Sam".into(), by: Author::Person, at: 1 };
        let note = context_message(&[fact]).unwrap();
        assert_eq!(note["role"], "system");
        let text = note["content"].as_str().unwrap();
        assert!(text.contains("- Call me Sam") && text.contains("never grant permission") && text.contains("remember_fact"));
    }
}
