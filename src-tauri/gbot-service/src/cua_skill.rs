//! The shared bundled skill is also the executor's computer-use instruction source.
use serde_json::{json, Value};

use crate::executor::{ExecutorError, FunctionTool, ToolBinding};

const SKILL: &str = include_str!("../../resources/agent-skills/cua-driver/SKILL.md");
const GUIDES: &[(&str, &str)] = &[
    (
        "LINUX.md",
        include_str!("../../resources/agent-skills/cua-driver/LINUX.md"),
    ),
    (
        "WINDOWS.md",
        include_str!("../../resources/agent-skills/cua-driver/WINDOWS.md"),
    ),
    (
        "MACOS.md",
        include_str!("../../resources/agent-skills/cua-driver/MACOS.md"),
    ),
    (
        "BROWSER.md",
        include_str!("../../resources/agent-skills/cua-driver/BROWSER.md"),
    ),
    (
        "WORKFLOW.md",
        include_str!("../../resources/agent-skills/cua-driver/WORKFLOW.md"),
    ),
    (
        "VISUAL.md",
        include_str!("../../resources/agent-skills/cua-driver/VISUAL.md"),
    ),
    (
        "RUNTIME.md",
        include_str!("../../resources/agent-skills/cua-driver/RUNTIME.md"),
    ),
    (
        "RECORDING.md",
        include_str!("../../resources/agent-skills/cua-driver/RECORDING.md"),
    ),
    (
        "EMBEDDING.md",
        include_str!("../../resources/agent-skills/cua-driver/EMBEDDING.md"),
    ),
];

pub(crate) fn install(
    messages: &mut Vec<Value>,
    tools: &mut Vec<FunctionTool>,
) -> Result<(), ExecutorError> {
    if tools.iter().any(|tool| tool.name == "read_cua_guide") {
        return Err(ExecutorError::InvalidMessage);
    }
    let body = SKILL
        .split_once("\n---\n")
        .expect("bundled skill has frontmatter")
        .1;
    if let Some(message) = messages
        .iter_mut()
        .find(|message| message["role"] == "system")
    {
        let content = message["content"]
            .as_str()
            .ok_or(ExecutorError::InvalidMessage)?;
        message["content"] = Value::String(format!("{content}\n\n{body}"));
    } else {
        messages.insert(0, json!({"role":"system","content":body}));
    }
    tools.push(FunctionTool {
        name: "read_cua_guide".into(),
        description: "Read a bundled Cua driver guide. This reads trusted instructions, not a file on the guest or client computer.".into(),
        parameters: json!({"type":"object","properties":{"file":{"type":"string","enum":GUIDES.iter().map(|(name,_)|name).collect::<Vec<_>>()}},"required":["file"],"additionalProperties":false}),
        binding: ToolBinding::CuaGuide,
    });
    Ok(())
}

pub(crate) fn read(args: &Value) -> Result<Value, ExecutorError> {
    let object = args.as_object().ok_or(ExecutorError::InvalidMessage)?;
    if object.len() != 1 {
        return Err(ExecutorError::InvalidMessage);
    }
    let name = object
        .get("file")
        .and_then(Value::as_str)
        .ok_or(ExecutorError::InvalidMessage)?;
    let (_, content) = GUIDES
        .iter()
        .find(|(file, _)| *file == name)
        .ok_or(ExecutorError::InvalidMessage)?;
    Ok(json!({"file":name,"content":content}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_instructions_and_on_demand_guides_use_the_shared_bundle() {
        let mut messages = vec![
            json!({"role":"system","content":"Task-specific constraints."}),
            json!({"role":"user","content":"Save hello.txt"}),
        ];
        let mut tools = vec![];
        install(&mut messages, &mut tools).unwrap();
        assert_eq!(messages.len(), 2);
        let prompt = messages[0]["content"].as_str().unwrap();
        assert!(prompt.starts_with("Task-specific constraints."));
        assert!(prompt.contains("Never use\nAT-SPI DoAction"));
        assert!(!prompt.contains("# Linux"));
        assert!(read(&json!({"file":"WORKFLOW.md"})).unwrap()["content"]
            .as_str()
            .unwrap()
            .contains("real foreground input"));
        assert!(read(&json!({"file":"../private-key"})).is_err());
        assert!(read(&json!({"file":"LINUX.md","path":"/home/user"})).is_err());
        assert!(install(&mut messages, &mut tools).is_err());
    }
}
