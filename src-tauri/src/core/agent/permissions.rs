use super::{
    tools::ApprovalHook,
    types::{ApprovalDecision, ApprovalRequest},
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    #[default]
    Default,
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    FileRead,
    FileWrite,
    Shell,
    Scripts,
    Network,
    Management,
    Clipboard,
}

pub type Permissions = BTreeMap<Capability, Permission>;

fn capability(tool: &str) -> Option<Capability> {
    use Capability::*;
    Some(match tool {
        "os.shell.run" => Shell,
        "skill.run_script" => Scripts,
        "os.http.request" | "os.web.search" | "os.web.fetch" => Network,
        "os.clipboard.read" | "os.clipboard.write" => Clipboard,
        "vision.describe" => FileRead,
        "studio.manage" | "memory.save" | "memory.delete" | "os.proc.kill" | "os.notify" => {
            Management
        }
        "os.fs.write"
        | "os.fs.mkdir"
        | "os.fs.edit"
        | "os.fs.trash"
        | "os.fs.patch"
        | "os.fs.archive.extract" => FileWrite,
        name if name.starts_with("os.fs.") || name.starts_with("os.git.") => FileRead,
        _ => return None,
    })
}

pub struct DefinitionApproval<'a> {
    pub permissions: &'a Permissions,
    pub inner: &'a dyn ApprovalHook,
}

#[async_trait]
impl ApprovalHook for DefinitionApproval<'_> {
    fn permission_summary(&self) -> Option<String> {
        Some(format!("Enforced agent permissions: {}. Denied capabilities must not be bypassed using another tool. Shell commands and skill scripts are not filesystem or network sandboxes.", serde_json::to_string(self.permissions).unwrap_or_default()))
    }
    fn permission(&self, tool: &str) -> Permission {
        capability(tool)
            .and_then(|key| self.permissions.get(&key).copied())
            .unwrap_or_default()
    }
    async fn is_allowed(&self, fingerprint: &str) -> bool {
        self.inner.is_allowed(fingerprint).await
    }
    async fn request(&self, request: ApprovalRequest) -> Result<ApprovalDecision, String> {
        self.inner.request(request).await
    }
}
