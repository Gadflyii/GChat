use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub pid: i32, // opaque handle for unload/chat
    pub port: u16, // ginfer-serve output port
    pub model_id: String,
    pub model_path: String, // path of the loaded model artifact
    pub is_embedding: bool,
    pub vision: bool,
    pub api_key: String,
}

pub struct GinferSession {
    pub child: Child,
    pub info: SessionInfo,
}

/// GInfer plugin state
pub struct GinferState {
    pub ginfer_process: Arc<Mutex<HashMap<i32, GinferSession>>>,
}

impl Default for GinferState {
    fn default() -> Self {
        Self {
            ginfer_process: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl GinferState {
    pub fn new() -> Self {
        Self::default()
    }
}
