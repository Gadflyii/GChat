//! Tool resource-class taxonomy (`TOOL_RESOURCE_CLASS` port).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceClass {
    PureRead,
    FsWrite,
    Browser,
    MemoryWrite,
    TasksWrite,
    Vision,
    ApprovalGated,
    Terminal,
    Unknown,
}

pub(super) fn connector_tool(name: &str) -> Option<&'static crate::core::connectors::ConnectorTool> {
    crate::core::connectors::tool(name).or_else(|| {
        crate::core::connectors::tools().iter().find(|tool| {
            super::ginfer_client::wire_tool_name(tool.name) == name
        })
    })
}

pub fn resource_class_for(tool_name: &str) -> ResourceClass {
    if let Some(tool) = connector_tool(tool_name) {
        return if tool.write {
            ResourceClass::ApprovalGated
        } else {
            ResourceClass::PureRead
        };
    }
    match tool_name {
        "tool.view"
        | "capability_search"
        | "capability_read"
        | "studio.inspect"
        | "memory.recall"
        | "skill.view"
        | "os.fs.read"
        | "os.fs.read_document"
        | "os.fs.list"
        | "os.fs.glob"
        | "os.fs.grep"
        | "os.fs.hash"
        | "os.fs.diff"
        | "os.fs.archive.list"
        | "os.fs.archive.read_entry"
        | "os.git.status"
        | "os.git.log"
        | "os.git.diff"
        | "os.git.show"
        | "os.git.blame"
        | "os.git.branch"
        | "os.proc.list"
        | "os.web.search"
        | "os.web.fetch"
        | "os.clipboard.read" => ResourceClass::PureRead,
        "vision.describe" => ResourceClass::Vision,
        "os.clipboard.write" | "os.notify" => ResourceClass::MemoryWrite,
        "os.fs.write" | "os.fs.mkdir" | "os.fs.edit" => ResourceClass::FsWrite,
        "os.fs.trash"
        | "studio.manage"
        | "memory.save"
        | "memory.delete"
        | "os.fs.patch"
        | "os.fs.archive.extract"
        | "os.shell.run"
        | "os.proc.kill"
        | "os.http.request"
        | "skill.run_script" => ResourceClass::ApprovalGated,
        "reply" | "finish" => ResourceClass::Terminal,
        name if name.starts_with("mcp_") => ResourceClass::ApprovalGated,
        _ => ResourceClass::Unknown,
    }
}

pub fn is_batchable(class: ResourceClass) -> bool {
    !matches!(
        class,
        ResourceClass::ApprovalGated | ResourceClass::Terminal | ResourceClass::Unknown
    )
}

pub fn is_parallel_within_group(class: ResourceClass) -> bool {
    class == ResourceClass::PureRead
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::prompt::ITERATION_ONE_TOOLS;

    #[test]
    fn classifies_every_iteration_one_tool() {
        for descriptor in ITERATION_ONE_TOOLS {
            assert_ne!(
                resource_class_for(descriptor.name),
                ResourceClass::Unknown,
                "{} lacks a resource class",
                descriptor.name
            );
        }
    }

    #[test]
    fn fails_closed_for_unknown_tools() {
        assert_eq!(resource_class_for("os.unknown"), ResourceClass::Unknown);
        assert!(!is_batchable(ResourceClass::Unknown));
    }

    #[test]
    fn only_pure_reads_parallelize_within_a_group() {
        assert!(is_batchable(ResourceClass::PureRead));
        assert!(is_parallel_within_group(ResourceClass::PureRead));
        assert!(!is_parallel_within_group(ResourceClass::FsWrite));
        assert!(is_batchable(ResourceClass::Vision));
        assert!(!is_parallel_within_group(ResourceClass::Vision));
        assert!(!is_batchable(ResourceClass::ApprovalGated));
        assert!(!is_batchable(ResourceClass::Terminal));
    }

    #[test]
    fn classifies_vision_as_a_serial_group() {
        assert_eq!(resource_class_for("vision.describe"), ResourceClass::Vision);
    }

    #[test]
    fn capability_discovery_reads_do_not_receive_connector_approval() {
        assert_eq!(resource_class_for("capability_search"), ResourceClass::PureRead);
        assert_eq!(resource_class_for("capability_read"), ResourceClass::PureRead);
        assert_eq!(resource_class_for("mcp_call"), ResourceClass::ApprovalGated);
    }

    #[test]
    fn workspace_connectors_use_semantic_effects_and_exact_registered_names() {
        for name in ["google.gmail.search", "google.calendar.freebusy", "microsoft.calendar.free_busy", "microsoft.excel.read_range"] {
            assert_eq!(resource_class_for(name), ResourceClass::PureRead, "{name}");
            assert_eq!(resource_class_for(&super::super::ginfer_client::wire_tool_name(name)), ResourceClass::PureRead);
        }
        for name in ["google.gmail.send", "google.drive.share", "microsoft.outlook.send", "microsoft.onedrive.delete"] {
            assert_eq!(resource_class_for(name), ResourceClass::ApprovalGated, "{name}");
        }
        assert_eq!(resource_class_for("google.gmail.unregistered"), ResourceClass::Unknown);
        assert_eq!(resource_class_for("microsoft.outlook.send.raw"), ResourceClass::Unknown);
    }
}
