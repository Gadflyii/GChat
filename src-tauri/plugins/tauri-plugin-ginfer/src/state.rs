use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32,  // opaque handle for unload/chat
    pub port: u16, // Session-scoped local inference endpoint.
    pub model_id: String,
    pub model_path: String, // path of the loaded model artifact
    pub is_embedding: bool,
    pub vision: bool,
    /// Startup-fixed logical context limit requested for this resident model.
    /// Zero means the engine selected its artifact/runtime default.
    #[serde(default)]
    pub max_context: u32,
    /// Startup-fixed execution settings retained so diagnostics and benchmarks
    /// describe the resident server they actually exercised.
    #[serde(default)]
    pub spec: String,
    #[serde(default)]
    pub draft_tokens: u32,
    #[serde(default)]
    pub draft_tp: u32,
    #[serde(default)]
    pub kv_dtype: String,
    #[serde(default)]
    pub kv_arena_bytes: String,
    #[serde(default)]
    pub prefill_chunk: u32,
    #[serde(default)]
    pub max_concurrency: u32,
    #[serde(default)]
    pub no_cuda_graph: bool,
    pub api_key: String,
}

pub struct BenchmarkControl {
    pub cancelled: AtomicBool,
    pub notify: Notify,
}

impl Default for BenchmarkControl {
    fn default() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
}

pub struct GinferSession {
    pub owner: SessionOwner,
    pub info: SessionInfo,
    pub endpoint: Option<crate::cli_endpoint::CliEndpoint>,
}

pub struct SessionOwner {
    pub control: Arc<ginfer_host::launcher::LocalControl>,
    pub connection: ginfer_host::launcher::LocalConnection,
}

/// GInfer plugin state
pub struct GinferState {
    pub ginfer_process: Arc<Mutex<HashMap<i32, GinferSession>>>,
    pub benchmark_runs: Arc<Mutex<HashMap<String, Arc<BenchmarkControl>>>>,
}

impl Default for GinferState {
    fn default() -> Self {
        Self {
            ginfer_process: Arc::new(Mutex::new(HashMap::new())),
            benchmark_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl GinferState {
    pub fn new() -> Self {
        Self::default()
    }
}
