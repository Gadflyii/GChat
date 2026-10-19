//! Files a bot hands back to the person from its own computer.
//!
//! The `hand_back_file` tool copies one finished file from the bot's computer into the
//! task's own folder on the service computer, after the usual approval. The person can then
//! save or open it from the task. Any format the bot's computer can produce works: the
//! service stores bytes and never interprets them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

use crate::executor::{FunctionTool, ToolBinding};

pub const TOOL: &str = "hand_back_file";
/// Largest file handed back, so one task cannot fill the person's disk.
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Most files one task can hand back.
pub const MAX_FILES: usize = 12;
/// One guest read; the file is fetched in pieces of this size.
pub const CHUNK_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskOutput {
    pub id: Uuid,
    pub call_id: String,
    /// The name the person sees and the default name when saving.
    pub name: String,
    /// Where the file was on the bot's computer.
    pub guest_path: String,
    /// The stored file's name inside the task's files folder.
    pub stored: String,
    pub bytes: u64,
    pub at: u64,
}

pub fn tool() -> FunctionTool {
    FunctionTool {
        name: TOOL.into(),
        description: "Hand a finished file from this computer back to the user so they can open or save it from this task. Use it for results the user asked for: a document, spreadsheet, slide deck, text or data file, or an image. Save the file first (in any format this computer can produce), then give its full path. Only completed files; a file must be no larger than 16 MB, and at most 12 files per task. The user is asked to approve it, and then sees the file listed under the task.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The full path of the saved file on this computer, starting with /, for example /home/gbot/report.docx."},
                "name": {"type": "string", "description": "Optional short file name the user sees, for example quarterly-report.docx. Defaults to the file's own name."}
            },
            "required": ["path"],
            "additionalProperties": false
        }),
        binding: ToolBinding::HandBack,
    }
}

/// The file name to show and save under: the last path part, with anything that could
/// escape a folder or confuse a file system removed. Never empty.
pub fn safe_name(requested: Option<&str>, path: &str) -> String {
    let raw = requested
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(""));
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').chars().take(120).collect::<String>();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// Checks the model's arguments; the error is written for the model to correct itself.
pub fn parse(args: &Value) -> Result<(String, String), String> {
    let path = args["path"].as_str().unwrap_or_default().trim().to_owned();
    if !path.starts_with('/') || path.contains('\0') || path.ends_with('/') {
        return Err("path must be the full path of one saved file, starting with /".into());
    }
    let name = safe_name(args["name"].as_str(), &path);
    Ok((path, name))
}

pub fn file_name_on_disk(index: usize, id: Uuid, name: &str) -> String {
    format!("{index:02}-{}-{name}", &id.simple().to_string()[..8])
}

pub fn dir_of(record_path: &std::path::Path) -> PathBuf {
    record_path.with_extension("files")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_escape_or_be_empty() {
        assert_eq!(safe_name(None, "/home/gbot/report.docx"), "report.docx");
        assert_eq!(safe_name(Some("../../etc/passwd"), "/x/y"), "passwd");
        assert_eq!(safe_name(Some("a:b?.txt"), "/x"), "a_b_.txt");
        assert_eq!(safe_name(Some(".."), "/x/"), "file");
        assert_eq!(safe_name(Some("  "), "/home/gbot/notes.md"), "notes.md");
        assert!(safe_name(Some(&"n".repeat(500)), "/x").len() <= 120);
    }

    #[test]
    fn arguments_need_a_full_file_path() {
        assert!(parse(&json!({"path": "report.docx"})).is_err());
        assert!(parse(&json!({"path": "/home/gbot/"})).is_err());
        assert!(parse(&json!({})).is_err());
        let (path, name) = parse(&json!({"path": "/home/gbot/a.csv", "name": "Sales.csv"})).unwrap();
        assert_eq!((path.as_str(), name.as_str()), ("/home/gbot/a.csv", "Sales.csv"));
    }
}
