//! Bot account references and the native Workspace connector boundary.
//! OAuth credentials and provider implementation remain with the native account owner.
use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::contract::{SessionIdentity, WorkspaceId};

pub type ConnectorFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectorAccount {
    pub id: String,
    pub provider: String,
    pub display_name: String,
    pub email: Option<String>,
    pub services: Vec<String>,
    pub access: String,
    pub granted_scopes: Vec<String>,
    pub needs_reconnect: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectorTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub write: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedConnector {
    pub name: String,
    pub account_id: String,
    pub arguments: Value,
    pub write: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectorRequest {
    pub identity: SessionIdentity,
    pub operation: PreparedConnector,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BotConnectorAccounts {
    pub workspace_id: WorkspaceId,
    pub account_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct BotConnectors {
    pub account_ids: Vec<String>,
    pub accounts: Vec<ConnectorAccount>,
}

/// Dropping execute's future cancels provider work through its native cancellation owner.
pub trait ConnectorHost: Send + Sync {
    fn close(&self) -> ConnectorFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Authenticated native Chat/Settings callers share the service account owner.
    /// Bot execution continues to use the scoped methods below.
    fn native_operation<'a>(
        &'a self,
        _operation: &'a str,
        _arguments: Value,
    ) -> ConnectorFuture<'a, Value> {
        Box::pin(async { Err("Native Workspace connector operation unavailable".into()) })
    }
    fn accounts(&self) -> ConnectorFuture<'_, Vec<ConnectorAccount>>;
    fn catalog<'a>(&'a self, account_ids: &'a [String]) -> ConnectorFuture<'a, Vec<ConnectorTool>>;
    fn prepare<'a>(
        &'a self,
        account_ids: &'a [String],
        name: &'a str,
        arguments: Value,
    ) -> ConnectorFuture<'a, PreparedConnector>;
    fn execute<'a>(&'a self, request: &'a PreparedConnector) -> ConnectorFuture<'a, Value>;
}
