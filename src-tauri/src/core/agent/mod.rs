//! Agent Studio definitions, worker placement, durable sessions, and scoped tools.
//! Inference targets local GInfer or explicitly paired host instances; tools and
//! approvals remain owned by this desktop application.

pub mod approval;
pub mod approval_allowlist;
pub mod attachments;
mod batch_executor;
pub mod commands;
pub mod compressor;
pub mod definitions;
pub mod folder_access;
pub mod ginfer_client;
pub mod loop_guard;
pub mod orchestrator;
pub mod path_policy;
pub mod prompt;
pub mod resource_class;
// `loop` is a reserved keyword; the run loop lives in `runner`.
pub mod runner;
pub mod runs;
pub mod session;
pub mod shell_guard;
pub mod skills;
mod storage;
pub mod memory;
pub mod token_budget;
pub mod tools;
pub mod types;
pub mod workspace;

#[cfg(test)]
mod runner_tests;
#[cfg(test)]
pub(crate) mod test_support;

pub use types::{
    AgentApprovalDecision, AgentEvent, AgentExternalRoot, AgentFolderAccessDecision,
    AgentTurnRequest, ApprovalDecision, ApprovalRequest, ApprovalResource, ToolCallPayload,
    ToolExecution, ToolOutcome, ToolStatus,
};
pub mod worker_pools;
mod worker_dispatch;
pub mod studio;
