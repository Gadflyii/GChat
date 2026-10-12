use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OwnedMutexGuard};
use uuid::Uuid;

use crate::connectors::{BotConnectorAccounts, ConnectorRequest};
use crate::contract::{
    ContractError, GuestCapability, GuestHello, GuestOperationKind, GuestOperationState,
    GuestOutcome, GuestReply, GuestRequest, GuestResult, OperationId, ServicePc, SessionIdentity,
    VaultCredentialRef, WorkspaceConfig, WorkspaceConnection, WorkspaceId,
};
use crate::store::{SaveError, Store};
use crate::vault::{Secret, Vault, VaultError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewReason {
    ServiceRestarted,
    SessionDisconnected,
    OutcomeUnknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OperationState {
    InFlight,
    Completed,
    Failed,
    Cancelled,
    NeedsReview { reason: ReviewReason },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationCompletion {
    Completed,
    Failed,
    Cancelled,
}

impl From<OperationCompletion> for OperationState {
    fn from(completion: OperationCompletion) -> Self {
        match completion {
            OperationCompletion::Completed => Self::Completed,
            OperationCompletion::Failed => Self::Failed,
            OperationCompletion::Cancelled => Self::Cancelled,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationRecord {
    pub id: OperationId,
    pub identity: SessionIdentity,
    pub capability: GuestCapability,
    pub target_operation_id: Option<OperationId>,
    pub state: OperationState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionControlState {
    Bot,
    Pausing,
    Human,
    Paused,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionControl {
    pub identity: SessionIdentity,
    pub owner: Option<Uuid>,
    pub state: SessionControlState,
}

/// Bot-owned inference settings. The credential itself belongs only to the vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelAssignment {
    pub workspace_id: WorkspaceId,
    pub api_base: String,
    pub model: String,
    pub context_tokens: u64,
    pub credential_ref: Option<VaultCredentialRef>,
}

impl ModelAssignment {
    pub fn validate(&self) -> Result<(), ServiceError> {
        if self.workspace_id.validate().is_err()
            || self.api_base.trim().is_empty()
            || self.model.trim().is_empty()
            || self.context_tokens == 0
            || self
                .credential_ref
                .is_some_and(|reference| reference.validate().is_err())
        {
            return Err(ServiceError::InvalidAssignment);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DurableState {
    pub service_id: Uuid,
    pub service_pc: ServicePc,
    pub workspaces: Vec<WorkspaceConfig>,
    pub operations: Vec<OperationRecord>,
    #[serde(default)]
    pub controls: Vec<SessionControl>,
    #[serde(default)]
    pub assignments: Vec<ModelAssignment>,
    #[serde(default)]
    pub connector_accounts: Vec<BotConnectorAccounts>,
}

impl DurableState {
    fn new() -> Self {
        Self {
            service_id: Uuid::new_v4(),
            service_pc: ServicePc::default(),
            workspaces: Vec::new(),
            operations: Vec::new(),
            controls: Vec::new(),
            assignments: Vec::new(),
            connector_accounts: Vec::new(),
        }
    }

    fn validate(&self) -> Result<(), ServiceError> {
        if self.service_id.is_nil() {
            return Err(ServiceError::InvalidState);
        }
        let mut workspaces = BTreeSet::new();
        for workspace in &self.workspaces {
            workspace
                .validate()
                .map_err(|_| ServiceError::InvalidState)?;
            if !workspaces.insert(workspace.id) {
                return Err(ServiceError::InvalidState);
            }
        }
        let mut operations = BTreeSet::new();
        let mut connector_bots = BTreeSet::new();
        for links in &self.connector_accounts {
            if !workspaces.contains(&links.workspace_id)
                || !connector_bots.insert(links.workspace_id)
                || links.account_ids.iter().any(|id| id.trim().is_empty())
                || links.account_ids.iter().collect::<BTreeSet<_>>().len()
                    != links.account_ids.len()
            {
                return Err(ServiceError::InvalidState);
            }
        }
        let mut assignments = BTreeSet::new();
        let mut credentials = BTreeSet::new();
        for assignment in &self.assignments {
            assignment
                .validate()
                .map_err(|_| ServiceError::InvalidState)?;
            if !workspaces.contains(&assignment.workspace_id)
                || !assignments.insert(assignment.workspace_id)
                || assignment
                    .credential_ref
                    .is_some_and(|reference| !credentials.insert(reference))
            {
                return Err(ServiceError::InvalidState);
            }
        }
        let mut controls = BTreeSet::new();
        for control in &self.controls {
            control
                .identity
                .validate()
                .map_err(|_| ServiceError::InvalidState)?;
            if !workspaces.contains(&control.identity.workspace_id)
                || !controls.insert(control.identity.workspace_id)
                || match control.state {
                    SessionControlState::Bot => control.owner.is_some(),
                    _ => control.owner.is_none_or(|owner| owner.is_nil()),
                }
            {
                return Err(ServiceError::InvalidState);
            }
        }
        for operation in &self.operations {
            operation
                .id
                .validate()
                .map_err(|_| ServiceError::InvalidState)?;
            operation
                .identity
                .validate()
                .map_err(|_| ServiceError::InvalidState)?;
            if !operations.insert(operation.id)
                || !workspaces.contains(&operation.identity.workspace_id)
                || matches!(operation.capability, GuestCapability::ViewTransport)
            {
                return Err(ServiceError::InvalidState);
            }
        }
        for operation in &self.operations {
            match (operation.capability, operation.target_operation_id) {
                (GuestCapability::Status | GuestCapability::Cancel, Some(target_id)) => {
                    if target_id == operation.id
                        || !self.operations.iter().any(|target| {
                            target.id == target_id && target.identity == operation.identity
                        })
                    {
                        return Err(ServiceError::InvalidState);
                    }
                }
                (GuestCapability::Status | GuestCapability::Cancel, None) | (_, Some(_)) => {
                    return Err(ServiceError::InvalidState);
                }
                (_, None) => {}
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServiceError {
    AlreadyRunning,
    Persistence,
    InvalidState,
    Contract(ContractError),
    WorkspaceNotFound,
    WorkspaceInUse,
    WorkspaceConflict,
    SessionUnavailable,
    SessionMismatch,
    OperationNotFound,
    DuplicateOperation,
    OperationState,
    BotPaused,
    ControlOwner,
    InvalidAssignment,
    AssignmentNotFound,
}

impl fmt::Display for ServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contract(error) => fmt::Display::fmt(error, formatter),
            _ => formatter.write_str(match self {
                Self::Persistence => "could not persist Gbot state",
                Self::AlreadyRunning => "Gbot state is already owned by a running service",
                Self::InvalidState => "invalid Gbot state",
                Self::WorkspaceNotFound => "workspace is not registered",
                Self::WorkspaceInUse => "workspace has a live session or unresolved operation",
                Self::WorkspaceConflict => {
                    "This setup identity already belongs to a different workspace or SSH key"
                }
                Self::SessionUnavailable => "verified guest session is unavailable",
                Self::SessionMismatch => "guest session does not match",
                Self::OperationNotFound => "operation is not recorded; its outcome is unknown",
                Self::DuplicateOperation => "operation is already recorded; do not replay it",
                Self::OperationState => "operation requires review or is already finished",
                Self::BotPaused => "bot dispatch is paused for human control",
                Self::ControlOwner => "human control belongs to another client or session",
                Self::InvalidAssignment => {
                    "model assignment needs an endpoint, model and context capacity"
                }
                Self::AssignmentNotFound => {
                    "configure this bot's model assignment before running a task"
                }
                Self::Contract(_) => unreachable!(),
            }),
        }
    }
}

impl std::error::Error for ServiceError {}

/// Creation owns the key until persistence confirms that the workspace references it.
#[derive(Debug)]
pub enum SshWorkspaceCreationError {
    State(ServiceError),
    Vault(VaultError),
    Cleanup(VaultError),
    PersistenceUncertain,
    SavedDurabilityUnconfirmed,
}

impl From<ServiceError> for SshWorkspaceCreationError {
    fn from(error: ServiceError) -> Self {
        Self::State(error)
    }
}

impl fmt::Display for SshWorkspaceCreationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::State(error) => error.fmt(f),
            Self::Vault(error) => error.fmt(f),
            Self::Cleanup(error) => write!(f, "Workspace was not saved and its SSH key could not be removed; retry this setup: {error}"),
            Self::SavedDurabilityUnconfirmed => f.write_str("Workspace was saved, but storage durability could not be confirmed; retry this setup"),
            Self::PersistenceUncertain => f.write_str("Workspace save could not be confirmed; retry this setup to reconcile its SSH key"),
        }
    }
}

struct RuntimeState {
    durable: DurableState,
    sessions: BTreeMap<WorkspaceId, GuestHello>,
}

pub struct Service {
    store: Arc<Store>,
    state: Arc<Mutex<RuntimeState>>,
}

impl Service {
    pub async fn open(path: impl Into<PathBuf>) -> Result<Self, ServiceError> {
        let store = Arc::new(Store::open(path.into()).await?);
        let loaded = store.load().await?;
        let initial = loaded.is_none();
        let mut durable = loaded.unwrap_or_else(DurableState::new);
        durable.validate()?;
        let mut recovered = false;
        for operation in &mut durable.operations {
            if operation.state == OperationState::InFlight {
                operation.state = OperationState::NeedsReview {
                    reason: ReviewReason::ServiceRestarted,
                };
                recovered = true;
            }
        }
        for control in &mut durable.controls {
            if control.state != SessionControlState::Bot {
                control.state = SessionControlState::Paused;
                recovered = true;
            }
        }
        if initial || recovered {
            store.save(&durable).await?;
        }
        Ok(Self {
            store,
            state: Arc::new(Mutex::new(RuntimeState {
                durable,
                sessions: BTreeMap::new(),
            })),
        })
    }

    #[cfg(test)]
    pub(crate) fn fail_next_save_after_publish(&self) {
        self.store
            .fail_after_publish
            .store(true, std::sync::atomic::Ordering::Release);
    }

    pub async fn snapshot(&self) -> DurableState {
        self.state.lock().await.durable.clone()
    }

    pub async fn live_sessions(&self) -> Vec<SessionIdentity> {
        self.state
            .lock()
            .await
            .sessions
            .values()
            .map(|hello| hello.identity)
            .collect()
    }

    pub async fn model_assignment(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<Option<ModelAssignment>, ServiceError> {
        let state = self.state.lock().await;
        if !state
            .durable
            .workspaces
            .iter()
            .any(|workspace| workspace.id == workspace_id)
        {
            return Err(ServiceError::WorkspaceNotFound);
        }
        Ok(state
            .durable
            .assignments
            .iter()
            .find(|assignment| assignment.workspace_id == workspace_id)
            .cloned())
    }

    pub async fn save_model_assignment(
        &self,
        assignment: ModelAssignment,
    ) -> Result<(), ServiceError> {
        assignment.validate()?;
        let state = self.state.clone().lock_owned().await;
        if !state
            .durable
            .workspaces
            .iter()
            .any(|workspace| workspace.id == assignment.workspace_id)
        {
            return Err(ServiceError::WorkspaceNotFound);
        }
        let mut next = state.durable.clone();
        if let Some(existing) = next
            .assignments
            .iter_mut()
            .find(|saved| saved.workspace_id == assignment.workspace_id)
        {
            *existing = assignment;
        } else {
            next.assignments.push(assignment);
        }
        next.validate()?;
        drop(self.commit(state, next).await?);
        Ok(())
    }

    pub async fn connector_accounts(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<Vec<String>, ServiceError> {
        let state = self.state.lock().await;
        if !state
            .durable
            .workspaces
            .iter()
            .any(|workspace| workspace.id == workspace_id)
        {
            return Err(ServiceError::WorkspaceNotFound);
        }
        Ok(state
            .durable
            .connector_accounts
            .iter()
            .find(|links| links.workspace_id == workspace_id)
            .map(|links| links.account_ids.clone())
            .unwrap_or_default())
    }

    pub async fn save_connector_accounts(
        &self,
        links: BotConnectorAccounts,
    ) -> Result<(), ServiceError> {
        let state = self.state.clone().lock_owned().await;
        if !state
            .durable
            .workspaces
            .iter()
            .any(|workspace| workspace.id == links.workspace_id)
        {
            return Err(ServiceError::WorkspaceNotFound);
        }
        let mut next = state.durable.clone();
        next.connector_accounts
            .retain(|saved| saved.workspace_id != links.workspace_id);
        next.connector_accounts.push(links);
        next.validate()?;
        drop(self.commit(state, next).await?);
        Ok(())
    }

    /// Admission rechecks links and control after a possibly long human approval.
    pub async fn admit_connector(&self, request: &ConnectorRequest) -> Result<(), ServiceError> {
        let state = self.state.lock().await;
        verified_session(&state, request.identity)?;
        if state.durable.controls.iter().any(|control| {
            control.identity.workspace_id == request.identity.workspace_id
                && control.state != SessionControlState::Bot
        }) {
            return Err(ServiceError::BotPaused);
        }
        if !state.durable.connector_accounts.iter().any(|links| {
            links.workspace_id == request.identity.workspace_id
                && links.account_ids.contains(&request.operation.account_id)
        }) {
            return Err(ServiceError::InvalidState);
        }
        Ok(())
    }

    async fn commit(
        &self,
        mut state: OwnedMutexGuard<RuntimeState>,
        mut next: DurableState,
    ) -> Result<OwnedMutexGuard<RuntimeState>, ServiceError> {
        // A human may receive ownership only after all earlier effects are known.
        for control in &mut next.controls {
            if control.state == SessionControlState::Pausing
                && !unresolved(&next.operations, control.identity)
            {
                control.state = SessionControlState::Human;
            }
        }
        let store = self.store.clone();
        // Cancellation of the caller must not release ownership during a disk commit.
        tokio::spawn(async move {
            store.save(&next).await?;
            state.durable = next;
            Ok(state)
        })
        .await
        .map_err(|_| ServiceError::Persistence)?
    }

    /// A stable setup ID owns one vault slot. Retrying never allocates another key.
    pub(crate) async fn create_ssh_workspace(
        &self,
        config: WorkspaceConfig,
        key: Secret,
        vault: Arc<dyn Vault>,
    ) -> Result<WorkspaceConfig, SshWorkspaceCreationError> {
        config.validate().map_err(ServiceError::Contract)?;
        let WorkspaceConnection::Ssh(connection) = &config.connection else {
            return Err(ServiceError::InvalidState.into());
        };
        let reference = connection.credential_ref.as_uuid();
        let state = self.state.clone();
        let store = self.store.clone();
        // The vault/save/rollback transaction outlives an interrupted HTTP client.
        tokio::spawn(async move {
            let mut state = state.lock_owned().await;
            if let Some(existing) = state
                .durable
                .workspaces
                .iter()
                .find(|entry| entry.id == config.id)
            {
                if existing != &config {
                    return Err(ServiceError::WorkspaceConflict.into());
                }
                let stored = vault
                    .get(reference)
                    .await
                    .map_err(SshWorkspaceCreationError::Vault)?;
                if !stored.is_some_and(|stored| stored.expose_secret() == key.expose_secret()) {
                    return Err(ServiceError::WorkspaceConflict.into());
                }
                // Also confirms durability after a save whose rename succeeded but sync failed.
                store
                    .save_with_outcome(&state.durable)
                    .await
                    .map_err(|_| SshWorkspaceCreationError::SavedDurabilityUnconfirmed)?;
                return Ok(config);
            }
            if state.durable.service_id == reference
                || state.durable.workspaces.iter().any(|entry| {
                    matches!(&entry.connection,
                    WorkspaceConnection::Ssh(ssh) if ssh.credential_ref.as_uuid() == reference)
                })
                || state.durable.assignments.iter().any(|entry| {
                    entry
                        .credential_ref
                        .is_some_and(|key| key.as_uuid() == reference)
                })
            {
                return Err(ServiceError::WorkspaceConflict.into());
            }
            let mut next = state.durable.clone();
            next.workspaces.push(config.clone());
            next.validate()?;
            if let Err(error) = vault.put(reference, key).await {
                vault
                    .delete(reference)
                    .await
                    .map_err(SshWorkspaceCreationError::Cleanup)?;
                return Err(SshWorkspaceCreationError::Vault(error));
            }
            if let Err(error) = store.save_with_outcome(&next).await {
                match error {
                    SaveError::NotPublished(error) => {
                        vault
                            .delete(reference)
                            .await
                            .map_err(SshWorkspaceCreationError::Cleanup)?;
                        return Err(SshWorkspaceCreationError::State(error));
                    }
                    SaveError::Published => {
                        state.durable = next;
                        return Err(SshWorkspaceCreationError::SavedDurabilityUnconfirmed);
                    }
                    SaveError::Unconfirmed => {
                        return Err(SshWorkspaceCreationError::PersistenceUncertain)
                    }
                }
            }
            state.durable = next;
            Ok(config)
        })
        .await
        .map_err(|_| SshWorkspaceCreationError::PersistenceUncertain)?
    }

    pub async fn register_workspace(&self, config: WorkspaceConfig) -> Result<(), ServiceError> {
        config.validate().map_err(ServiceError::Contract)?;
        let state = self.state.clone().lock_owned().await;
        let mut next = state.durable.clone();
        if let Some(existing) = next
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == config.id)
        {
            if *existing == config {
                return Ok(());
            }
            if state.sessions.contains_key(&config.id)
                || state.durable.controls.iter().any(|control| {
                    control.identity.workspace_id == config.id
                        && control.state != SessionControlState::Bot
                })
                || state.durable.operations.iter().any(|operation| {
                    operation.identity.workspace_id == config.id
                        && matches!(
                            operation.state,
                            OperationState::InFlight | OperationState::NeedsReview { .. }
                        )
                })
            {
                return Err(ServiceError::WorkspaceInUse);
            }
            *existing = config;
        } else {
            next.workspaces.push(config);
        }
        drop(self.commit(state, next).await?);
        Ok(())
    }

    /// Remove only the exact guest registered by the local setup owner. Attached bot
    /// accounts/model assignments or unsettled work must be resolved first.
    #[cfg(target_os = "linux")]
    pub(crate) async fn remove_owned_workspace(
        &self,
        id: WorkspaceId,
        owner: &crate::contract::BotPc,
    ) -> Result<(), ServiceError> {
        let state = self.state.clone().lock_owned().await;
        if let Some(workspace) = state
            .durable
            .workspaces
            .iter()
            .find(|workspace| workspace.id == id)
        {
            if &workspace.bot_pc != owner {
                return Err(ServiceError::WorkspaceInUse);
            }
        } else {
            return Ok(());
        }
        if state.sessions.contains_key(&id)
            || state
                .durable
                .assignments
                .iter()
                .any(|item| item.workspace_id == id)
            || state
                .durable
                .connector_accounts
                .iter()
                .any(|item| item.workspace_id == id)
            || state.durable.controls.iter().any(|item| {
                item.identity.workspace_id == id && item.state != SessionControlState::Bot
            })
            || state.durable.operations.iter().any(|item| {
                item.identity.workspace_id == id
                    && matches!(
                        item.state,
                        OperationState::InFlight | OperationState::NeedsReview { .. }
                    )
            })
        {
            return Err(ServiceError::WorkspaceInUse);
        }
        let mut next = state.durable.clone();
        next.workspaces.retain(|item| item.id != id);
        next.controls
            .retain(|item| item.identity.workspace_id != id);
        next.operations
            .retain(|item| item.identity.workspace_id != id);
        drop(self.commit(state, next).await?);
        Ok(())
    }

    /// The caller owns and verifies the transport; only its session binding is retained here.
    pub async fn register_session(
        &self,
        expected: SessionIdentity,
        hello: GuestHello,
    ) -> Result<(), ServiceError> {
        hello.validate(&expected).map_err(ServiceError::Contract)?;
        let mut state = self.state.clone().lock_owned().await;
        if !state
            .durable
            .workspaces
            .iter()
            .any(|workspace| workspace.id == expected.workspace_id)
        {
            return Err(ServiceError::WorkspaceNotFound);
        }
        let mut next = state.durable.clone();
        let mut changed = false;
        if let Some(control) = next.controls.iter_mut().find(|control| {
            control.identity.workspace_id == expected.workspace_id
                && control.state == SessionControlState::Bot
        }) {
            if control.identity != expected {
                control.identity = expected;
                changed = true;
            }
        }
        for operation in &mut next.operations {
            if operation.identity.workspace_id == expected.workspace_id
                && operation.identity != expected
                && operation.state == OperationState::InFlight
            {
                operation.state = OperationState::NeedsReview {
                    reason: ReviewReason::SessionDisconnected,
                };
                changed = true;
            }
        }
        if changed {
            state = self.commit(state, next).await?;
        }
        state.sessions.insert(expected.workspace_id, hello);
        Ok(())
    }

    pub async fn disconnect_session(&self, identity: SessionIdentity) -> Result<(), ServiceError> {
        let mut state = self.state.clone().lock_owned().await;
        let hello = state
            .sessions
            .get(&identity.workspace_id)
            .ok_or(ServiceError::SessionUnavailable)?;
        if hello.identity != identity {
            return Err(ServiceError::SessionMismatch);
        }
        // A dead connection must not remain dispatchable if its review write fails.
        state.sessions.remove(&identity.workspace_id);
        let mut next = state.durable.clone();
        if let Some(control) = next.controls.iter_mut().find(|control| {
            control.identity.workspace_id == identity.workspace_id
                && control.state != SessionControlState::Bot
        }) {
            control.state = SessionControlState::Paused;
        }
        for operation in &mut next.operations {
            if operation.identity == identity && operation.state == OperationState::InFlight {
                operation.state = OperationState::NeedsReview {
                    reason: ReviewReason::SessionDisconnected,
                };
            }
        }
        drop(self.commit(state, next).await?);
        Ok(())
    }

    pub async fn begin_operation(
        &self,
        request: &GuestRequest,
    ) -> Result<OperationRecord, ServiceError> {
        self.begin_operation_owned(request, None).await
    }

    /// Only the service's hand-back observation may cross a paused admission gate.
    pub async fn begin_control_observation(
        &self,
        request: &GuestRequest,
        owner: Uuid,
    ) -> Result<OperationRecord, ServiceError> {
        if !matches!(&request.operation, GuestOperationKind::Desktop { tool, .. }
            if tool == "get_desktop_state")
        {
            return Err(ServiceError::OperationState);
        }
        self.begin_operation_owned(request, Some(owner)).await
    }

    async fn begin_operation_owned(
        &self,
        request: &GuestRequest,
        owner: Option<Uuid>,
    ) -> Result<OperationRecord, ServiceError> {
        let state = self.state.clone().lock_owned().await;
        let hello = state
            .sessions
            .get(&request.identity.workspace_id)
            .ok_or(ServiceError::SessionUnavailable)?;
        request.validate(hello).map_err(ServiceError::Contract)?;
        if let Some(control) = state.durable.controls.iter().find(|control| {
            control.identity.workspace_id == request.identity.workspace_id
                && control.state != SessionControlState::Bot
        }) {
            let reconciliation = matches!(
                request.operation,
                GuestOperationKind::Status { .. } | GuestOperationKind::Cancel { .. }
            );
            let observation = owner.is_some()
                && owner == control.owner
                && control.identity == request.identity
                && control.state == SessionControlState::Paused;
            if !reconciliation && !observation {
                return Err(ServiceError::BotPaused);
            }
        } else if owner.is_some() {
            return Err(ServiceError::ControlOwner);
        }
        if state
            .durable
            .operations
            .iter()
            .any(|operation| operation.id == request.operation_id)
        {
            return Err(ServiceError::DuplicateOperation);
        }
        let target_operation_id = if let GuestOperationKind::Status { operation_id }
        | GuestOperationKind::Cancel { operation_id } =
            &request.operation
        {
            let target = state
                .durable
                .operations
                .iter()
                .find(|operation| operation.id == *operation_id)
                .ok_or(ServiceError::OperationNotFound)?;
            if target.identity != request.identity {
                return Err(ServiceError::SessionMismatch);
            }
            Some(*operation_id)
        } else {
            None
        };
        let operation = OperationRecord {
            id: request.operation_id,
            identity: request.identity,
            capability: request.operation.capability(),
            target_operation_id,
            state: OperationState::InFlight,
        };
        let mut next = state.durable.clone();
        next.operations.push(operation.clone());
        drop(self.commit(state, next).await?);
        Ok(operation)
    }

    pub async fn take_over(
        &self,
        identity: SessionIdentity,
        owner: Uuid,
    ) -> Result<SessionControl, ServiceError> {
        if owner.is_nil() {
            return Err(ServiceError::ControlOwner);
        }
        let state = self.state.clone().lock_owned().await;
        verified_session(&state, identity)?;
        let mut next = state.durable.clone();
        let index = match next
            .controls
            .iter()
            .position(|control| control.identity.workspace_id == identity.workspace_id)
        {
            Some(index) => {
                let control = &next.controls[index];
                if control.state != SessionControlState::Bot
                    && (control.identity != identity || control.owner != Some(owner))
                {
                    return Err(ServiceError::ControlOwner);
                }
                index
            }
            None => {
                next.controls.push(SessionControl {
                    identity,
                    owner: None,
                    state: SessionControlState::Bot,
                });
                next.controls.len() - 1
            }
        };
        next.controls[index] = SessionControl {
            identity,
            owner: Some(owner),
            state: SessionControlState::Pausing,
        };
        let state = self.commit(state, next).await?;
        Ok(state.durable.controls[index].clone())
    }

    pub async fn begin_hand_back(
        &self,
        identity: SessionIdentity,
        owner: Uuid,
    ) -> Result<(), ServiceError> {
        let state = self.state.clone().lock_owned().await;
        verified_session(&state, identity)?;
        let mut next = state.durable.clone();
        let control = owned_control(&mut next, identity, owner)?;
        // Disable human ownership before closing its tunnel and observing the desktop.
        control.state = SessionControlState::Paused;
        let pending = unresolved(&next.operations, identity);
        drop(self.commit(state, next).await?);
        if pending {
            Err(ServiceError::OperationState)
        } else {
            Ok(())
        }
    }

    pub async fn finish_hand_back(
        &self,
        identity: SessionIdentity,
        owner: Uuid,
        observation: OperationId,
    ) -> Result<SessionControl, ServiceError> {
        let state = self.state.clone().lock_owned().await;
        verified_session(&state, identity)?;
        let mut next = state.durable.clone();
        if unresolved(&next.operations, identity)
            || !next.operations.iter().any(|operation| {
                operation.id == observation
                    && operation.identity == identity
                    && operation.capability == GuestCapability::DesktopCapture
                    && operation.state == OperationState::Completed
            })
        {
            return Err(ServiceError::OperationState);
        }
        let control = owned_control(&mut next, identity, owner)?;
        if control.state != SessionControlState::Paused {
            return Err(ServiceError::OperationState);
        }
        control.state = SessionControlState::Bot;
        control.owner = None;
        let result = control.clone();
        drop(self.commit(state, next).await?);
        Ok(result)
    }

    pub async fn finish_operation(
        &self,
        id: OperationId,
        identity: SessionIdentity,
        completion: OperationCompletion,
    ) -> Result<(), ServiceError> {
        let state = self.state.clone().lock_owned().await;
        let mut next = state.durable.clone();
        let operation = next
            .operations
            .iter_mut()
            .find(|operation| operation.id == id)
            .ok_or(ServiceError::OperationNotFound)?;
        if operation.identity != identity {
            return Err(ServiceError::SessionMismatch);
        }
        if operation.state == OperationState::from(completion) {
            return Ok(());
        }
        if operation.state != OperationState::InFlight {
            return Err(ServiceError::OperationState);
        }
        let session = state
            .sessions
            .get(&identity.workspace_id)
            .ok_or(ServiceError::SessionUnavailable)?;
        if session.identity != identity {
            return Err(ServiceError::SessionMismatch);
        }
        operation.state = completion.into();
        drop(self.commit(state, next).await?);
        Ok(())
    }

    pub async fn mark_operation_uncertain(
        &self,
        id: OperationId,
        identity: SessionIdentity,
    ) -> Result<(), ServiceError> {
        let state = self.state.clone().lock_owned().await;
        let mut next = state.durable.clone();
        let operation = next
            .operations
            .iter_mut()
            .find(|operation| operation.id == id)
            .ok_or(ServiceError::OperationNotFound)?;
        if operation.identity != identity {
            return Err(ServiceError::SessionMismatch);
        }
        if operation.state != OperationState::InFlight {
            return Ok(());
        }
        operation.state = OperationState::NeedsReview {
            reason: ReviewReason::OutcomeUnknown,
        };
        drop(self.commit(state, next).await?);
        Ok(())
    }

    pub async fn reconcile_operation(
        &self,
        request: &GuestRequest,
        reply: &GuestReply,
    ) -> Result<(), ServiceError> {
        reply.validate(request).map_err(ServiceError::Contract)?;
        let target_id = match &request.operation {
            GuestOperationKind::Status { operation_id }
            | GuestOperationKind::Cancel { operation_id } => *operation_id,
            _ => return Err(ServiceError::OperationState),
        };
        let (observed, probe_state) = match &reply.outcome {
            GuestOutcome::Success {
                result: GuestResult::Status { state } | GuestResult::Cancel { state },
            } => (observed_state(state), OperationState::Completed),
            GuestOutcome::Error { .. } => (
                OperationState::NeedsReview {
                    reason: ReviewReason::OutcomeUnknown,
                },
                OperationState::Failed,
            ),
            _ => return Err(ServiceError::OperationState),
        };
        let state = self.state.clone().lock_owned().await;
        let hello = state
            .sessions
            .get(&request.identity.workspace_id)
            .ok_or(ServiceError::SessionUnavailable)?;
        request.validate(hello).map_err(ServiceError::Contract)?;
        let mut next = state.durable.clone();
        let probe_index = next
            .operations
            .iter()
            .position(|operation| operation.id == request.operation_id)
            .ok_or(ServiceError::OperationNotFound)?;
        let target_index = next
            .operations
            .iter()
            .position(|operation| operation.id == target_id)
            .ok_or(ServiceError::OperationNotFound)?;
        let probe = &next.operations[probe_index];
        if probe.identity != request.identity
            || next.operations[target_index].identity != request.identity
        {
            return Err(ServiceError::SessionMismatch);
        }
        if probe.capability != request.operation.capability()
            || probe.target_operation_id != Some(target_id)
            || probe.state != OperationState::InFlight
            || probe_index == target_index
        {
            return Err(ServiceError::OperationState);
        }
        // A delayed probe cannot undo a recorded terminal result.
        if matches!(
            next.operations[target_index].state,
            OperationState::InFlight | OperationState::NeedsReview { .. }
        ) {
            next.operations[target_index].state = observed;
        }
        next.operations[probe_index].state = probe_state;
        drop(self.commit(state, next).await?);
        Ok(())
    }
}

fn unresolved(operations: &[OperationRecord], identity: SessionIdentity) -> bool {
    operations.iter().any(|operation| {
        operation.identity == identity
            && matches!(
                operation.state,
                OperationState::InFlight | OperationState::NeedsReview { .. }
            )
    })
}

fn verified_session(state: &RuntimeState, identity: SessionIdentity) -> Result<(), ServiceError> {
    let hello = state
        .sessions
        .get(&identity.workspace_id)
        .ok_or(ServiceError::SessionUnavailable)?;
    if hello.identity != identity {
        return Err(ServiceError::SessionMismatch);
    }
    Ok(())
}

fn owned_control(
    state: &mut DurableState,
    identity: SessionIdentity,
    owner: Uuid,
) -> Result<&mut SessionControl, ServiceError> {
    state
        .controls
        .iter_mut()
        .find(|control| {
            control.identity == identity
                && control.owner == Some(owner)
                && control.state != SessionControlState::Bot
        })
        .ok_or(ServiceError::ControlOwner)
}

fn observed_state(state: &GuestOperationState) -> OperationState {
    match state {
        GuestOperationState::Running => OperationState::InFlight,
        GuestOperationState::Completed {
            exit_code: Some(code),
        } if *code != 0 => OperationState::Failed,
        GuestOperationState::Completed { .. } => OperationState::Completed,
        GuestOperationState::Cancelled => OperationState::Cancelled,
        GuestOperationState::Failed { .. } => OperationState::Failed,
        GuestOperationState::Unknown => OperationState::NeedsReview {
            reason: ReviewReason::OutcomeUnknown,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{
        BotPc, GuestError, GuestErrorCode, GuestPath, Hypervisor, SessionId, SshConnection,
        SshEndpoint, SshHostPublicKey, VaultCredentialRef, WorkspaceConnection,
        GUEST_PROTOCOL_VERSION,
    };

    fn workspace() -> WorkspaceConfig {
        WorkspaceConfig {
            id: WorkspaceId::new(),
            name: "Fixture VM".into(),
            service_pc: ServicePc::Local,
            bot_pc: BotPc::LocalVm {
                host_id: Uuid::new_v4(),
                vm_id: "fixture-vm".into(),
                hypervisor: Hypervisor::Kvm,
            },
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: SshEndpoint {
                    hostname: "127.0.0.1".into(),
                    port: 2222,
                    user: "fixture".into(),
                },
                pinned_host_key: SshHostPublicKey {
                    algorithm: "ssh-ed25519".into(),
                    public_key: "AAAA".into(),
                },
                credential_ref: VaultCredentialRef::new(),
            }),
        }
    }

    fn hello(identity: SessionIdentity) -> GuestHello {
        GuestHello {
            protocol_version: GUEST_PROTOCOL_VERSION,
            identity,
            capabilities: [
                GuestCapability::Exec,
                GuestCapability::Read,
                GuestCapability::Write,
                GuestCapability::Status,
                GuestCapability::Cancel,
            ]
            .into(),
            view: None,
        }
    }

    fn exec(identity: SessionIdentity) -> GuestRequest {
        GuestRequest {
            identity,
            operation_id: OperationId::new(),
            operation: GuestOperationKind::Exec {
                program: "fixture-command".into(),
                args: vec!["private-operation-payload-not-durable".into()],
                cwd: GuestPath("/fixture".into()),
                env: BTreeMap::from([(
                    "FIXTURE_SECRET".into(),
                    "private-vault-value-not-durable".into(),
                )]),
            },
        }
    }

    fn probe(request: &GuestRequest, cancel: bool) -> GuestRequest {
        GuestRequest {
            identity: request.identity,
            operation_id: OperationId::new(),
            operation: if cancel {
                GuestOperationKind::Cancel {
                    operation_id: request.operation_id,
                }
            } else {
                GuestOperationKind::Status {
                    operation_id: request.operation_id,
                }
            },
        }
    }

    fn reply(request: &GuestRequest, state: GuestOperationState) -> GuestReply {
        GuestReply {
            identity: request.identity,
            operation_id: request.operation_id,
            outcome: GuestOutcome::Success {
                result: if matches!(request.operation, GuestOperationKind::Cancel { .. }) {
                    GuestResult::Cancel { state }
                } else {
                    GuestResult::Status { state }
                },
            },
        }
    }

    async fn operation_state(service: &Service, id: OperationId) -> OperationState {
        service
            .snapshot()
            .await
            .operations
            .into_iter()
            .find(|record| record.id == id)
            .unwrap()
            .state
    }

    #[tokio::test]
    async fn takeover_drains_exclusively_and_handback_requires_observation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let service = Service::open(&path).await.unwrap();
        let config = workspace();
        let identity = SessionIdentity {
            workspace_id: config.id,
            session_id: SessionId::new(),
        };
        service.register_workspace(config).await.unwrap();
        let mut guest = hello(identity);
        guest.capabilities.insert(GuestCapability::DesktopCapture);
        service
            .register_session(identity, guest.clone())
            .await
            .unwrap();
        let in_flight = exec(identity);
        service.begin_operation(&in_flight).await.unwrap();
        let owner = Uuid::new_v4();
        assert_eq!(
            service.take_over(identity, owner).await.unwrap().state,
            SessionControlState::Pausing
        );
        assert_eq!(
            service.begin_operation(&exec(identity)).await,
            Err(ServiceError::BotPaused)
        );
        assert_eq!(
            service.take_over(identity, Uuid::new_v4()).await,
            Err(ServiceError::ControlOwner)
        );
        service
            .finish_operation(
                in_flight.operation_id,
                identity,
                OperationCompletion::Completed,
            )
            .await
            .unwrap();
        assert_eq!(
            service.snapshot().await.controls[0].state,
            SessionControlState::Human
        );
        service.begin_hand_back(identity, owner).await.unwrap();
        let observation = GuestRequest {
            identity,
            operation_id: OperationId::new(),
            operation: GuestOperationKind::Desktop {
                tool: "get_desktop_state".into(),
                arguments: serde_json::json!({}),
            },
        };
        assert_eq!(
            service
                .finish_hand_back(identity, owner, observation.operation_id)
                .await,
            Err(ServiceError::OperationState)
        );
        assert_eq!(
            service.begin_operation(&observation).await,
            Err(ServiceError::BotPaused)
        );
        service
            .begin_control_observation(&observation, owner)
            .await
            .unwrap();
        service
            .finish_operation(
                observation.operation_id,
                identity,
                OperationCompletion::Completed,
            )
            .await
            .unwrap();
        assert_eq!(
            service
                .finish_hand_back(identity, owner, observation.operation_id)
                .await
                .unwrap()
                .state,
            SessionControlState::Bot
        );
        let unknown = exec(identity);
        service.begin_operation(&unknown).await.unwrap();
        service.take_over(identity, owner).await.unwrap();
        service
            .mark_operation_uncertain(unknown.operation_id, identity)
            .await
            .unwrap();
        assert_eq!(
            service.begin_hand_back(identity, owner).await,
            Err(ServiceError::OperationState)
        );
        assert_eq!(
            service.snapshot().await.controls[0].state,
            SessionControlState::Paused
        );
        drop(service);
        let recovered = Service::open(&path).await.unwrap();
        recovered.register_session(identity, guest).await.unwrap();
        assert_eq!(
            recovered.snapshot().await.controls[0].state,
            SessionControlState::Paused
        );
        assert_eq!(
            recovered.begin_operation(&exec(identity)).await,
            Err(ServiceError::BotPaused)
        );
        // Status remains available while paused; no unknown effect is redispatched.
        let status = probe(&unknown, false);
        recovered.begin_operation(&status).await.unwrap();
        recovered
            .reconcile_operation(
                &status,
                &reply(
                    &status,
                    GuestOperationState::Completed { exit_code: Some(0) },
                ),
            )
            .await
            .unwrap();
        assert_eq!(
            recovered.snapshot().await.controls[0].state,
            SessionControlState::Paused
        );
    }

    #[tokio::test]
    async fn restart_preserves_vault_references_and_requires_operation_review() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let service = Service::open(&path).await.unwrap();
        let config = workspace();
        service.register_workspace(config.clone()).await.unwrap();
        let identity = SessionIdentity {
            workspace_id: config.id,
            session_id: SessionId::new(),
        };
        service
            .register_session(identity, hello(identity))
            .await
            .unwrap();
        let finished = exec(identity);
        let interrupted = exec(identity);
        service.begin_operation(&finished).await.unwrap();
        service
            .finish_operation(
                finished.operation_id,
                identity,
                OperationCompletion::Completed,
            )
            .await
            .unwrap();
        service.begin_operation(&interrupted).await.unwrap();
        let service_id = service.snapshot().await.service_id;
        let persisted = std::fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("private-operation-payload-not-durable"));
        assert!(!persisted.contains("private-vault-value-not-durable"));
        let WorkspaceConnection::Ssh(connection) = &config.connection else {
            unreachable!()
        };
        assert!(persisted.contains(&connection.credential_ref.as_uuid().to_string()));
        drop(service);

        let reopened = Service::open(&path).await.unwrap();
        let state = reopened.snapshot().await;
        assert_eq!(state.service_id, service_id);
        assert_eq!(state.service_pc, ServicePc::Local);
        assert_eq!(state.workspaces, vec![config.clone()]);
        assert!(reopened.live_sessions().await.is_empty());
        assert_eq!(
            operation_state(&reopened, finished.operation_id).await,
            OperationState::Completed
        );
        assert_eq!(
            operation_state(&reopened, interrupted.operation_id).await,
            OperationState::NeedsReview {
                reason: ReviewReason::ServiceRestarted
            }
        );
        assert_eq!(
            reopened.begin_operation(&interrupted).await,
            Err(ServiceError::SessionUnavailable)
        );
        reopened
            .register_session(identity, hello(identity))
            .await
            .unwrap();
        assert_eq!(
            reopened.begin_operation(&interrupted).await,
            Err(ServiceError::DuplicateOperation)
        );
        let status = probe(&interrupted, false);
        reopened.begin_operation(&status).await.unwrap();
        reopened
            .reconcile_operation(&status, &reply(&status, GuestOperationState::Unknown))
            .await
            .unwrap();
        assert_eq!(
            operation_state(&reopened, interrupted.operation_id).await,
            OperationState::NeedsReview {
                reason: ReviewReason::OutcomeUnknown
            }
        );
        drop(reopened);
        let recovered = Service::open(&path).await.unwrap();
        assert_eq!(
            operation_state(&recovered, interrupted.operation_id).await,
            OperationState::NeedsReview {
                reason: ReviewReason::OutcomeUnknown
            }
        );
    }

    #[tokio::test]
    async fn state_owner_is_exclusive_until_service_drop() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let first = Service::open(&path).await.unwrap();
        let service_id = first.snapshot().await.service_id;
        assert!(matches!(
            Service::open(&path).await,
            Err(ServiceError::AlreadyRunning)
        ));
        drop(first);
        let next = Service::open(&path).await.unwrap();
        assert_eq!(next.snapshot().await.service_id, service_id);
    }

    #[tokio::test]
    async fn failed_commit_preserves_published_state_and_prior_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        let service = Service::open(&path).await.unwrap();
        let first = workspace();
        let second = workspace();
        let (first_result, second_result) = tokio::join!(
            service.register_workspace(first.clone()),
            service.register_workspace(second.clone()),
        );
        first_result.unwrap();
        second_result.unwrap();
        let before = service.snapshot().await;
        assert_eq!(before.workspaces.len(), 2);
        let prior_bytes = std::fs::read(&path).unwrap();
        let retained = directory.path().join("retained-state.json");
        std::fs::rename(&path, &retained).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(
            service.register_workspace(workspace()).await,
            Err(ServiceError::Persistence)
        );
        assert_eq!(service.snapshot().await, before);
        assert_eq!(std::fs::read(&retained).unwrap(), prior_bytes);
    }

    #[tokio::test]
    async fn operation_reconciliation_binds_target_identity_and_preserves_terminal_outcomes() {
        let directory = tempfile::tempdir().unwrap();
        let service = Service::open(directory.path().join("state.json"))
            .await
            .unwrap();
        let config = workspace();
        service.register_workspace(config.clone()).await.unwrap();
        let identity = SessionIdentity {
            workspace_id: config.id,
            session_id: SessionId::new(),
        };
        service
            .register_session(identity, hello(identity))
            .await
            .unwrap();
        let target = exec(identity);
        let other = exec(identity);
        service.begin_operation(&target).await.unwrap();
        service.begin_operation(&other).await.unwrap();
        let status = probe(&target, false);
        service.begin_operation(&status).await.unwrap();
        let mut substituted = status.clone();
        substituted.operation = GuestOperationKind::Status {
            operation_id: other.operation_id,
        };
        assert_eq!(
            service
                .reconcile_operation(
                    &substituted,
                    &reply(&substituted, GuestOperationState::Running)
                )
                .await,
            Err(ServiceError::OperationState)
        );
        service
            .mark_operation_uncertain(target.operation_id, identity)
            .await
            .unwrap();
        let missing = GuestReply {
            identity,
            operation_id: status.operation_id,
            outcome: GuestOutcome::Error {
                error: GuestError {
                    code: GuestErrorCode::NotFound,
                    message: "worker journal has no result".into(),
                },
            },
        };
        service
            .reconcile_operation(&status, &missing)
            .await
            .unwrap();
        assert_eq!(
            operation_state(&service, status.operation_id).await,
            OperationState::Failed
        );
        assert_eq!(
            operation_state(&service, target.operation_id).await,
            OperationState::NeedsReview {
                reason: ReviewReason::OutcomeUnknown
            }
        );
        let failed = probe(&target, false);
        service.begin_operation(&failed).await.unwrap();
        service
            .reconcile_operation(
                &failed,
                &reply(
                    &failed,
                    GuestOperationState::Completed { exit_code: Some(7) },
                ),
            )
            .await
            .unwrap();
        assert_eq!(
            operation_state(&service, target.operation_id).await,
            OperationState::Failed
        );

        let cancel = probe(&other, true);
        service.begin_operation(&cancel).await.unwrap();
        service
            .reconcile_operation(&cancel, &reply(&cancel, GuestOperationState::Running))
            .await
            .unwrap();
        assert_eq!(
            operation_state(&service, other.operation_id).await,
            OperationState::InFlight
        );
        let delayed = probe(&other, false);
        service.begin_operation(&delayed).await.unwrap();
        let acknowledged = probe(&other, true);
        service.begin_operation(&acknowledged).await.unwrap();
        service
            .reconcile_operation(
                &acknowledged,
                &reply(&acknowledged, GuestOperationState::Cancelled),
            )
            .await
            .unwrap();
        service
            .finish_operation(other.operation_id, identity, OperationCompletion::Cancelled)
            .await
            .unwrap();
        service
            .reconcile_operation(&delayed, &reply(&delayed, GuestOperationState::Running))
            .await
            .unwrap();
        service
            .mark_operation_uncertain(other.operation_id, identity)
            .await
            .unwrap();
        assert_eq!(
            operation_state(&service, other.operation_id).await,
            OperationState::Cancelled
        );
        assert_eq!(
            service
                .finish_operation(other.operation_id, identity, OperationCompletion::Completed)
                .await,
            Err(ServiceError::OperationState)
        );

        let foreign_config = workspace();
        service
            .register_workspace(foreign_config.clone())
            .await
            .unwrap();
        let foreign_identity = SessionIdentity {
            workspace_id: foreign_config.id,
            session_id: SessionId::new(),
        };
        service
            .register_session(foreign_identity, hello(foreign_identity))
            .await
            .unwrap();
        for cancel in [false, true] {
            let mut cross_workspace = probe(&target, cancel);
            cross_workspace.identity = foreign_identity;
            assert_eq!(
                service.begin_operation(&cross_workspace).await,
                Err(ServiceError::SessionMismatch)
            );
        }
        let mut altered = config;
        altered.name = "Different VM".into();
        assert_eq!(
            service.register_workspace(altered).await,
            Err(ServiceError::WorkspaceInUse)
        );
        service.disconnect_session(identity).await.unwrap();
        service
            .finish_operation(other.operation_id, identity, OperationCompletion::Cancelled)
            .await
            .unwrap();
        let replacement = SessionIdentity {
            workspace_id: identity.workspace_id,
            session_id: SessionId::new(),
        };
        service
            .register_session(replacement, hello(replacement))
            .await
            .unwrap();
        let mut cross_session = probe(&target, false);
        cross_session.identity = replacement;
        assert_eq!(
            service.begin_operation(&cross_session).await,
            Err(ServiceError::SessionMismatch)
        );
        assert_eq!(
            service
                .finish_operation(
                    target.operation_id,
                    replacement,
                    OperationCompletion::Failed
                )
                .await,
            Err(ServiceError::SessionMismatch)
        );
    }
}
