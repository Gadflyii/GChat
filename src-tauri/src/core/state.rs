use std::{collections::HashMap, sync::Arc};

use crate::core::{
    agent::approval_allowlist::ApprovalAllowlist, downloads::models::DownloadManagerState,
    mcp::models::McpSettings,
};
use rmcp::{
    model::{CallToolRequestParam, CallToolResult, InitializeRequestParam, Tool},
    service::{Peer, RunningService},
    RoleClient, ServiceError,
};
use tokio::sync::{oneshot, Mutex};

/// Handles owned by one Local API Server run.
pub struct ServerHandle {
    pub server_task: tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
}

/// Provider configuration for remote model providers
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

pub struct PendingAgentApproval {
    pub run_id: String,
    pub fingerprint: String,
    pub can_remember: bool,
    pub sender: oneshot::Sender<crate::core::agent::types::ApprovalDecision>,
}

pub struct PendingAgentFolderAccess {
    pub run_id: String,
    pub sender: oneshot::Sender<bool>,
}

pub type AgentSessionLocks = Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>;

pub enum RunningServiceEnum {
    NoInit(RunningService<RoleClient, ()>),
    WithInit(RunningService<RoleClient, InitializeRequestParam>),
}
pub type SharedMcpServers = Arc<Mutex<HashMap<String, RunningServiceEnum>>>;

#[derive(Default)]
pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: SharedMcpServers,
    pub mcp_start_generations: Arc<Mutex<HashMap<String, u64>>>,
    pub mcp_server_generations: Arc<Mutex<HashMap<String, u64>>>,
    pub mcp_server_errors: Arc<Mutex<HashMap<String, String>>>,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub agent_pending_approvals: Arc<Mutex<HashMap<String, PendingAgentApproval>>>,
    pub agent_pending_folder_access: Arc<Mutex<HashMap<String, PendingAgentFolderAccess>>>,
    pub agent_approval_allowlist: Arc<Mutex<ApprovalAllowlist>>,
    pub agent_session_locks: AgentSessionLocks,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub background_cleanup_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, HashMap<u64, u32>>>>,
    /// Remote provider configurations (e.g., Anthropic, OpenAI, etc.)
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    /// Handles to the dynamic rows in the system tray menu (desktop only).
    /// Populated by `setup::setup_tray` when the tray is installed, consumed by
    /// `tray_status::update_tray_status` to re-render server / model / RAM.
    #[cfg(desktop)]
    pub tray_handles: Arc<std::sync::Mutex<Option<crate::core::tray_status::TrayHandles>>>,
}

impl RunningServiceEnum {
    pub async fn list_all_tools(&self) -> Result<Vec<Tool>, ServiceError> {
        match self {
            Self::NoInit(s) => s.list_all_tools().await,
            Self::WithInit(s) => s.list_all_tools().await,
        }
    }

    /// Cloneable client handle for this server. `Peer` is a cheap `Clone`
    /// (Arc-backed) and exposes the same request methods (`list_all_tools`,
    /// `call_tool`, …) as the owning `RunningService`. Cloning it lets callers
    /// release the `mcp_servers` map lock *before* doing slow network round
    /// trips, so one unresponsive server can't block the whole map (ATO-271).
    pub fn peer(&self) -> Peer<RoleClient> {
        match self {
            Self::NoInit(s) => s.peer().clone(),
            Self::WithInit(s) => s.peer().clone(),
        }
    }
    pub async fn call_tool(
        &self,
        params: CallToolRequestParam,
    ) -> Result<CallToolResult, ServiceError> {
        match self {
            Self::NoInit(s) => s.call_tool(params).await,
            Self::WithInit(s) => s.call_tool(params).await,
        }
    }
}
