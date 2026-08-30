//! Shared types for the agent backend core.
//!
//! `AgentEvent` is a serde-tagged enum streamed to the frontend over a
//! `tauri::ipc::Channel`. It is a pragmatic subset of the TS
//! `AgentLoopEvent` / `StepEvent` union — enough for a future UI to render a
//! full run, but iteration 1 only emits.

use serde::{Deserialize, Serialize};

use super::definitions::AgentReasoningEffort;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInferenceMetrics {
    pub prompt_tokens: f64,
    pub generated_tokens: f64,
    pub prompt_ms: f64,
    pub generation_ms: f64,
}

impl AgentInferenceMetrics {
    pub fn record(
        &mut self,
        prompt_tokens: f64,
        generated_tokens: f64,
        prompt_ms: f64,
        generation_ms: f64,
    ) {
        self.prompt_tokens += prompt_tokens;
        self.generated_tokens += generated_tokens;
        self.prompt_ms += prompt_ms;
        self.generation_ms += generation_ms;
    }

    pub fn merge(&mut self, other: Self) {
        self.record(
            other.prompt_tokens,
            other.generated_tokens,
            other.prompt_ms,
            other.generation_ms,
        );
    }
}

/// A single tool call the model asked for: `{ "tool": ..., "args": ... }`.
///
/// GInfer returns native OpenAI-compatible function calls; the direct client
/// normalizes those calls into this executor-owned representation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCallPayload {
    pub tool: String,
    /// Raw arguments object exactly as the model emitted it.
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Terminal status of a single tool execution.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Ok,
    Error,
    /// Blocked by the loop guard (`deniedReason: "tool-loop"`) or approval.
    Denied,
    /// The turn was cancelled mid-flight.
    Cancelled,
}

/// Compressed outcome of one tool call. Ported from
/// `CompressedToolResult` (result-compressor.ts) — a short human summary
/// plus optional structured details, never the raw payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutcome {
    pub status: ToolStatus,
    /// One-line human-readable summary of what happened.
    pub summary: String,
    /// Optional structured details (error kind, denied reason, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl ToolOutcome {
    pub fn ok(summary: impl Into<String>) -> Self {
        Self {
            status: ToolStatus::Ok,
            summary: summary.into(),
            details: None,
        }
    }

    pub fn error(summary: impl Into<String>) -> Self {
        Self {
            status: ToolStatus::Error,
            summary: summary.into(),
            details: None,
        }
    }

    pub fn denied(summary: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            status: ToolStatus::Denied,
            summary: summary.into(),
            details: Some(serde_json::json!({ "deniedReason": reason.into() })),
        }
    }
}

/// A parsed call paired with the outcome of executing it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecution {
    pub call: ToolCallPayload,
    pub outcome: ToolOutcome,
    /// Position of this call inside the parsed batch (0-based).
    pub batch_index: usize,
    pub batch_size: usize,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentAttachmentKind {
    File,
    Image,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentAttachment {
    pub kind: AgentAttachmentKind,
    pub name: String,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub data_url: Option<String>,
}

/// Request payload for a single agent turn (from the Tauri command).
#[derive(Debug, Clone, Deserialize)]
pub struct AgentTurnRequest {
    /// Opaque id chosen by the caller; used for cancellation.
    pub run_id: String,
    /// Durable session id. The frontend binds this to the owning thread id.
    pub session_id: String,
    /// The `model_id` whose `ginfer-serve` session the agent should target.
    pub model_id: String,
    /// The user's message for this turn.
    pub user_message: String,
    /// Saved Agent Studio definition to execute. Defaults to the built-in
    /// General Agent.
    #[serde(default)]
    pub definition_id: Option<String>,
    /// Optional enabled skill that must be loaded before the first inference.
    #[serde(default)]
    pub selected_skill: Option<String>,
    /// Files staged into the owning thread before the agent loop begins.
    #[serde(default)]
    pub attachments: Vec<AgentAttachment>,
    /// Optional working directory for OS tools (defaults to the app cwd).
    #[serde(default)]
    pub working_dir: Option<String>,
    /// Additional thread-scoped roots with explicit read/write permissions.
    #[serde(default)]
    pub external_roots: Vec<AgentExternalRoot>,
    /// Optional cap on inference steps (defaults to `MAX_STEPS`).
    #[serde(default)]
    pub max_steps: Option<u32>,
    /// Run-scoped escape hatch for trusted callers. When false, dangerous
    /// actions wait for an explicit approval decision.
    #[serde(default)]
    pub auto_approve: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentExternalRoot {
    pub path: String,
    #[serde(default = "default_can_edit")]
    pub can_edit: bool,
}

fn default_can_edit() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalResource {
    pub kind: String,
    pub value: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub tool: String,
    pub reason: String,
    pub preview: serde_json::Value,
    pub affected_resources: Vec<ApprovalResource>,
    pub fingerprint: String,
    pub can_remember: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Deny,
    AllowOnce,
    AlwaysAllow,
}

impl ApprovalDecision {
    pub fn is_approved(self) -> bool {
        matches!(self, Self::AllowOnce | Self::AlwaysAllow)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentApprovalDecision {
    pub approval_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentFolderAccessDecision {
    pub access_id: String,
    pub run_id: String,
    pub allow: bool,
}

#[derive(Debug, Clone)]
pub struct FolderAccessRequest {
    pub tool: String,
    pub path: String,
    pub display_name: String,
    pub root_id: String,
    pub reason: String,
}

/// Loop-guard severity surfaced to observers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoopLevel {
    Warn,
    Critical,
    Breaker,
}

/// Which loop-guard detector fired.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoopDetector {
    GenericRepeat,
    NoProgress,
    Wandering,
}

/// Observability events emitted by the agent loop, streamed over the
/// `ipc::Channel`. Serde tag `type` + `snake_case` to mirror the TS union.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted {
        run_id: String,
        session_id: String,
    },
    OrchestrationStarted {
        definition_id: String,
        definition_name: String,
        kind: String,
        default_model_instance_id: String,
    },
    StageStarted {
        stage_id: String,
        name: String,
        role: String,
        cycle: Option<u32>,
        model_instance_id: String,
        reasoning_effort: Option<AgentReasoningEffort>,
    },
    StageFinished {
        stage_id: String,
        name: String,
        status: String,
        summary: String,
        step_count: u32,
        duration_ms: u64,
        model_instance_id: String,
        model_id: String,
        reasoning_effort: Option<AgentReasoningEffort>,
        inference: AgentInferenceMetrics,
    },
    Handoff {
        from: String,
        to: String,
        summary: String,
    },
    StepStarted {
        step_index: u32,
    },
    ReasoningDelta {
        step_index: u32,
        text: String,
    },
    AssistantDelta {
        text: String,
    },
    ToolCallParsed {
        call: ToolCallPayload,
        batch_index: usize,
        batch_size: usize,
    },
    ToolCallExecuted {
        result: ToolExecution,
    },
    ApprovalRequested {
        run_id: String,
        approval_id: String,
        tool: String,
        reason: String,
        preview: serde_json::Value,
        affected_resources: Vec<ApprovalResource>,
        can_remember: bool,
    },
    FolderAccessRequested {
        run_id: String,
        access_id: String,
        tool: String,
        path: String,
        display_name: String,
        root_id: String,
        reason: String,
    },
    LoopDetected {
        level: LoopLevel,
        detector: LoopDetector,
        message: String,
    },
    ParseRetry {
        step_index: u32,
        reason: String,
    },
    BatchTrimmed {
        step_index: u32,
        reason: String,
        kept_tool: String,
        dropped_tools: Vec<String>,
    },
    AssistantReply {
        text: String,
    },
    StepError {
        message: String,
        category: String,
    },
    TurnFinished {
        /// `"reply"` | `"finish"` | `"max_steps"` | `"cancelled"` | `"failed"`.
        reason: String,
        step_count: u32,
    },
}
