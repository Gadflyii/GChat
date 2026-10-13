use russh::keys::PublicKey;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;
#[cfg(target_os = "linux")]
use tokio::sync::OwnedMutexGuard;
use uuid::Uuid;

use crate::{
    connectors::{
        BotConnectorAccounts, BotConnectors, ConnectorHost, ConnectorRequest, PreparedConnector,
    },
    contract::{
        BotPc, ContractError, GuestHello, GuestOperationKind, GuestOutcome, GuestReply,
        GuestRequest, GuestResult, OperationId, ServicePc, SessionIdentity, SshConnection,
        SshEndpoint, SshHostPublicKey, VaultCredentialRef, WorkspaceConfig, WorkspaceConnection,
        WorkspaceId,
    },
    executor::Assignment,
    inference::{InferenceHost, ModelConnection, PairedModel, ResolvedAssignment},
    media::{CloseView, MediaError, MediaLease, OpenView, ViewTicket},
    service::{
        ModelAssignment, OperationCompletion, Service, ServiceError, SessionControl,
        SessionControlState, SshWorkspaceCreationError,
    },
    ssh::{import_ssh_key, prepare_ssh_key, ImportedSshKey, SshError, SshPolicy, SshSession},
    vault::{Secret, Vault, VaultError},
};

#[derive(Debug)]
pub enum WorkspaceError {
    State(ServiceError),
    Creation(SshWorkspaceCreationError),
    Transport(SshError),
    Media(MediaError),
    NotFound,
    NotConnected,
    SetupIncomplete,
    AdapterUnavailable,
    ServiceLocationUnavailable,
    ShuttingDown,
    Vault(VaultError),
    CredentialCleanup(VaultError),
    Connector(String),
    Inference(String),
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::State(error) => error.fmt(f),
            Self::Creation(error) => error.fmt(f),
            Self::Transport(error) => error.fmt(f),
            Self::Media(error) => error.fmt(f),
            Self::NotFound => f.write_str("workspace is not registered"),
            Self::NotConnected => f.write_str("connect the selected guest session first"),
            Self::SetupIncomplete => {
                f.write_str("resume computer setup and complete its readiness checks first")
            }
            Self::AdapterUnavailable => f.write_str("this workspace adapter is not installed"),
            Self::ServiceLocationUnavailable => {
                f.write_str("this service cannot run on the selected PC")
            }
            Self::ShuttingDown => f.write_str("Gbot service is stopping"),
            Self::Vault(error) => error.fmt(f),
            Self::CredentialCleanup(error) => write!(
                f,
                "Model assignment was saved, but the old credential could not be removed: {error}"
            ),
            Self::Connector(error) | Self::Inference(error) => f.write_str(error),
        }
    }
}

impl std::error::Error for WorkspaceError {}
impl From<ServiceError> for WorkspaceError {
    fn from(value: ServiceError) -> Self {
        Self::State(value)
    }
}
impl From<SshError> for WorkspaceError {
    fn from(value: SshError) -> Self {
        Self::Transport(value)
    }
}
impl From<MediaError> for WorkspaceError {
    fn from(value: MediaError) -> Self {
        Self::Media(value)
    }
}

/// Secrets are input-only and are never serialized into workspace state or responses.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSshWorkspace {
    pub id: WorkspaceId,
    pub name: String,
    pub service_pc: ServicePc,
    pub bot_pc: BotPc,
    pub endpoint: SshEndpoint,
    pub pinned_host_key: SshHostPublicKey,
    pub private_key: String,
    pub passphrase: Option<String>,
}

pub struct WorkspaceRuntime {
    service: Arc<Service>,
    vault: Arc<dyn Vault>,
    sessions: Mutex<BTreeMap<WorkspaceId, Arc<SshSession>>>,
    media: Mutex<BTreeMap<WorkspaceId, MediaLease>>,
    lifecycle: Mutex<BTreeMap<WorkspaceId, Arc<Mutex<()>>>>,
    resume_observations: Mutex<BTreeMap<WorkspaceId, GuestReply>>,
    stopping: AtomicBool,
    connectors: Option<Arc<dyn ConnectorHost>>,
    inference: std::sync::OnceLock<Arc<dyn InferenceHost>>,
    #[cfg(target_os = "linux")]
    kvm_setup: std::sync::OnceLock<Arc<crate::kvm_setup::KvmSetup>>,
}

#[cfg(target_os = "linux")]
pub(crate) struct WorkspaceRemoval<'a> {
    runtime: &'a WorkspaceRuntime,
    _guard: OwnedMutexGuard<()>,
    workspace: WorkspaceId,
    session: Option<SessionIdentity>,
}

#[cfg(target_os = "linux")]
impl WorkspaceRemoval<'_> {
    pub(crate) fn session(&self) -> Option<SessionIdentity> {
        self.session
    }

    pub(crate) async fn disconnect(&self) -> Result<(), WorkspaceError> {
        let media_result = self.runtime.close_media_locked(self.workspace).await;
        self.runtime
            .resume_observations
            .lock()
            .await
            .remove(&self.workspace);
        let session = self.runtime.sessions.lock().await.remove(&self.workspace);
        if let Some(session) = session {
            session.close().await?;
        }
        self.runtime.media.lock().await.remove(&self.workspace);
        media_result
    }
}

#[derive(Serialize)]
pub struct HandBack {
    pub control: SessionControl,
    pub observation: GuestReply,
}

impl WorkspaceRuntime {
    pub fn new(service: Arc<Service>, vault: Arc<dyn Vault>) -> Self {
        Self {
            service,
            vault,
            sessions: Mutex::new(BTreeMap::new()),
            media: Mutex::new(BTreeMap::new()),
            lifecycle: Mutex::new(BTreeMap::new()),
            resume_observations: Mutex::new(BTreeMap::new()),
            stopping: AtomicBool::new(false),
            connectors: None,
            inference: std::sync::OnceLock::new(),
            #[cfg(target_os = "linux")]
            kvm_setup: std::sync::OnceLock::new(),
        }
    }

    #[cfg(target_os = "linux")]
    pub async fn configure_kvm_setup(
        self: &Arc<Self>,
        root: std::path::PathBuf,
    ) -> Result<(), crate::kvm_setup::SetupIssue> {
        let owner = Arc::new(
            crate::kvm_setup::KvmSetup::open(
                root,
                self.service.clone(),
                self.vault.clone(),
                Arc::downgrade(self),
            )
            .await?,
        );
        self.kvm_setup.set(owner).map_err(|_| {
            crate::kvm_setup::SetupIssue::new(
                "setup_configured",
                "The local setup owner already exists.",
                "Reuse the service's existing setup owner.",
            )
        })
    }
    #[cfg(target_os = "linux")]
    pub fn kvm_setup(&self) -> Option<Arc<crate::kvm_setup::KvmSetup>> {
        self.kvm_setup.get().cloned()
    }

    pub fn with_connectors(mut self, connectors: Arc<dyn ConnectorHost>) -> Self {
        self.connectors = Some(connectors);
        self
    }

    pub async fn native_connector_operation(
        &self,
        operation: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.connectors
            .as_ref()
            .ok_or("Native Workspace connector owner unavailable")?
            .native_operation(operation, arguments)
            .await
    }

    pub async fn bot_connectors(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<BotConnectors, WorkspaceError> {
        self.accepting()?;
        let account_ids = self.service.connector_accounts(workspace_id).await?;
        let accounts = match &self.connectors {
            Some(host) => host.accounts().await.map_err(WorkspaceError::Connector)?,
            None => Vec::new(),
        };
        Ok(BotConnectors {
            account_ids,
            accounts,
        })
    }

    pub async fn save_bot_connectors(
        &self,
        links: BotConnectorAccounts,
    ) -> Result<BotConnectors, WorkspaceError> {
        let current = self.bot_connectors(links.workspace_id).await?;
        // Disconnected references may be removed; only currently owned accounts may be linked.
        if links.account_ids.iter().any(|id| {
            !current.accounts.iter().any(|account| account.id == *id)
                && !current.account_ids.contains(id)
        }) {
            return Err(WorkspaceError::Connector(
                "Choose an existing Workspace account".into(),
            ));
        }
        let workspace_id = links.workspace_id;
        self.service.save_connector_accounts(links).await?;
        self.bot_connectors(workspace_id).await
    }

    pub async fn connector_tools(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<Vec<crate::executor::FunctionTool>, WorkspaceError> {
        self.accepting()?;
        let links = self.service.connector_accounts(workspace_id).await?;
        let Some(host) = &self.connectors else {
            return Ok(Vec::new());
        };
        Ok(host
            .catalog(&links)
            .await
            .map_err(WorkspaceError::Connector)?
            .into_iter()
            .map(|tool| crate::executor::FunctionTool {
                binding: crate::executor::ToolBinding::Connector {
                    name: tool.name.clone(),
                },
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            })
            .collect())
    }

    pub async fn prepare_connector(
        &self,
        identity: SessionIdentity,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<ConnectorRequest, WorkspaceError> {
        self.accepting()?;
        let links = self
            .service
            .connector_accounts(identity.workspace_id)
            .await?;
        let host = self.connectors.as_ref().ok_or_else(|| {
            WorkspaceError::Connector("Workspace connectors are unavailable".into())
        })?;
        let operation: PreparedConnector = host
            .prepare(&links, name, arguments)
            .await
            .map_err(WorkspaceError::Connector)?;
        if !links.contains(&operation.account_id)
            || operation
                .arguments
                .get("account_id")
                .and_then(serde_json::Value::as_str)
                != Some(operation.account_id.as_str())
        {
            return Err(WorkspaceError::Connector(
                "Connector account was not explicitly linked to this bot".into(),
            ));
        }
        Ok(ConnectorRequest {
            identity,
            operation,
        })
    }

    pub async fn execute_connector(
        &self,
        request: &ConnectorRequest,
    ) -> Result<serde_json::Value, WorkspaceError> {
        self.accepting()?;
        self.service.admit_connector(request).await?;
        self.connectors
            .as_ref()
            .ok_or_else(|| {
                WorkspaceError::Connector("Workspace connectors are unavailable".into())
            })?
            .execute(&request.operation)
            .await
            .map_err(WorkspaceError::Connector)
    }

    fn accepting(&self) -> Result<(), WorkspaceError> {
        if self.stopping.load(Ordering::Acquire) {
            Err(WorkspaceError::ShuttingDown)
        } else {
            Ok(())
        }
    }

    async fn lifecycle_lock(&self, workspace: WorkspaceId) -> Arc<Mutex<()>> {
        self.lifecycle
            .lock()
            .await
            .entry(workspace)
            .or_default()
            .clone()
    }

    pub async fn create_ssh_workspace(
        &self,
        input: CreateSshWorkspace,
    ) -> Result<WorkspaceConfig, WorkspaceError> {
        self.accepting()?;
        let config = WorkspaceConfig {
            id: input.id,
            name: input.name,
            service_pc: input.service_pc,
            bot_pc: input.bot_pc,
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: input.endpoint,
                pinned_host_key: input.pinned_host_key,
                // This setup owns the same slot across failures, retries and restarts.
                credential_ref: VaultCredentialRef(input.id.as_uuid()),
            }),
        };
        config.validate().map_err(ServiceError::Contract)?;
        let WorkspaceConnection::Ssh(connection) = &config.connection else {
            unreachable!()
        };
        PublicKey::from_openssh(&format!(
            "{} {}",
            connection.pinned_host_key.algorithm, connection.pinned_host_key.public_key
        ))
        .map_err(|_| ServiceError::Contract(ContractError::InvalidHostKey))?;
        let (_, key) = prepare_ssh_key(
            Secret::new(input.private_key.into_bytes()),
            input
                .passphrase
                .map(|value| Secret::new(value.into_bytes())),
        )
        .await?;
        self.accepting()?;
        self.service
            .create_ssh_workspace(config, key, self.vault.clone())
            .await
            .map_err(WorkspaceError::Creation)
    }

    pub async fn import_ssh_key(
        &self,
        key: Secret,
        passphrase: Option<Secret>,
    ) -> Result<ImportedSshKey, WorkspaceError> {
        self.accepting()?;
        Ok(import_ssh_key(self.vault.as_ref(), key, passphrase).await?)
    }

    pub async fn register_workspace(&self, config: WorkspaceConfig) -> Result<(), WorkspaceError> {
        self.accepting()?;
        let lock = self.lifecycle_lock(config.id).await;
        let _guard = lock.lock().await;
        self.accepting()?;
        self.service.register_workspace(config).await?;
        Ok(())
    }

    pub fn configure_inference(&self, host: Arc<dyn InferenceHost>) -> Result<(), WorkspaceError> {
        self.inference
            .set(host)
            .map_err(|_| WorkspaceError::Inference("Host inference is already configured".into()))
    }

    pub async fn paired_models(&self) -> Result<Vec<PairedModel>, WorkspaceError> {
        self.accepting()?;
        self.inference
            .get()
            .ok_or_else(|| WorkspaceError::Inference("Host inference is unavailable".into()))?
            .models()
            .await
            .map_err(WorkspaceError::Inference)
    }

    async fn validate_paired(&self, saved: &ModelAssignment) -> Result<(), WorkspaceError> {
        if let ModelConnection::PairedHost { target } = &saved.connection {
            let models = self.paired_models().await?;
            if !models.iter().any(|model| {
                model.target == *target
                    && model.model == saved.model
                    && model.context_tokens == saved.context_tokens
            }) {
                return Err(WorkspaceError::Inference("The selected model is offline or restarted. Refresh and select its ready session again.".into()));
            }
        }
        Ok(())
    }

    /// Missing endpoint key preserves this bot's key; an empty key removes it.
    pub async fn save_model_assignment(
        &self,
        workspace_id: WorkspaceId,
        connection: ModelConnection,
        assignment: Assignment,
    ) -> Result<ModelAssignment, WorkspaceError> {
        if matches!(connection, ModelConnection::PairedHost { .. }) && assignment.api_key.is_some()
        {
            return Err(ServiceError::InvalidAssignment.into());
        }
        let candidate = ModelAssignment {
            workspace_id,
            connection: connection.clone(),
            model: assignment.model.clone(),
            context_tokens: assignment.context_tokens,
            credential_ref: None,
        };
        candidate.validate()?;
        self.validate_paired(&candidate).await?;
        self.accepting()?;
        let lock = self.lifecycle_lock(workspace_id).await;
        let service = self.service.clone();
        let vault = self.vault.clone();
        // Retain the vault/state transaction if the client disconnects mid-save.
        tokio::spawn(async move {
            let _guard = lock.lock().await;
            let previous = service.model_assignment(workspace_id).await?;
            let old_reference = previous.and_then(|saved| saved.credential_ref);
            let credential_ref = match (&connection, assignment.api_key.as_deref()) {
                (ModelConnection::PairedHost { .. }, _) => None,
                (_, None) => old_reference,
                (_, Some("")) => None,
                (_, Some(_)) => Some(VaultCredentialRef::new()),
            };
            let saved = ModelAssignment {
                workspace_id,
                connection,
                model: assignment.model,
                context_tokens: assignment.context_tokens,
                credential_ref,
            };
            saved.validate()?;
            if let (Some(reference), Some(key)) = (credential_ref, assignment.api_key) {
                vault
                    .put(reference.as_uuid(), Secret::new(key.into_bytes()))
                    .await
                    .map_err(WorkspaceError::Vault)?;
            }
            if let Err(error) = service.save_model_assignment(saved.clone()).await {
                if credential_ref != old_reference {
                    if let Some(reference) = credential_ref {
                        let _ = vault.delete(reference.as_uuid()).await;
                    }
                }
                return Err(WorkspaceError::State(error));
            }
            if credential_ref != old_reference {
                if let Some(reference) = old_reference {
                    vault
                        .delete(reference.as_uuid())
                        .await
                        .map_err(WorkspaceError::CredentialCleanup)?;
                }
            }
            Ok(saved)
        })
        .await
        .map_err(|_| WorkspaceError::Vault(VaultError::WorkerFailure))?
    }

    pub async fn model_assignment(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<Option<ModelAssignment>, WorkspaceError> {
        self.accepting()?;
        Ok(self.service.model_assignment(workspace_id).await?)
    }

    /// Fetch the key only at the execution boundary, never into task records.
    pub async fn resolve_model_assignment(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<ResolvedAssignment, WorkspaceError> {
        self.accepting()?;
        let lock = self.lifecycle_lock(workspace_id).await;
        let _guard = lock.lock().await;
        let saved = self
            .service
            .model_assignment(workspace_id)
            .await?
            .ok_or(ServiceError::AssignmentNotFound)?;
        self.validate_paired(&saved).await?;
        if let ModelConnection::PairedHost { target } = &saved.connection {
            return ResolvedAssignment::paired(
                saved.clone(),
                self.inference.get().unwrap().clone(),
                target.clone(),
            )
            .await
            .map_err(WorkspaceError::Inference);
        }
        let ModelConnection::Endpoint { api_base } = &saved.connection else {
            unreachable!()
        };
        let api_key = match saved.credential_ref {
            Some(reference) => {
                let secret = self
                    .vault
                    .get(reference.as_uuid())
                    .await
                    .map_err(WorkspaceError::Vault)?
                    .ok_or(WorkspaceError::Vault(VaultError::Missing))?;
                Some(
                    std::str::from_utf8(secret.expose_secret())
                        .map_err(|_| WorkspaceError::Vault(VaultError::InvalidData))?
                        .to_owned(),
                )
            }
            None => None,
        };
        Ok(ResolvedAssignment::endpoint(
            Assignment {
                api_base: api_base.clone(),
                api_key,
                model: saved.model.clone(),
                context_tokens: saved.context_tokens,
            },
            saved,
        ))
    }

    pub async fn connect(&self, identity: SessionIdentity) -> Result<GuestHello, WorkspaceError> {
        self.ensure_workspace_ready(identity.workspace_id).await?;
        self.connect_session(identity).await
    }

    #[cfg(target_os = "linux")]
    pub(crate) async fn connect_for_setup(
        &self,
        identity: SessionIdentity,
    ) -> Result<GuestHello, WorkspaceError> {
        self.connect_session(identity).await
    }

    async fn ensure_workspace_ready(&self, workspace: WorkspaceId) -> Result<(), WorkspaceError> {
        #[cfg(target_os = "linux")]
        if let Some(setup) = self.kvm_setup.get() {
            setup.ensure_ready(workspace).await?;
        }
        #[cfg(not(target_os = "linux"))]
        let _ = workspace;
        Ok(())
    }

    async fn connect_session(
        &self,
        identity: SessionIdentity,
    ) -> Result<GuestHello, WorkspaceError> {
        self.accepting()?;
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        self.accepting()?;
        let previous = self
            .sessions
            .lock()
            .await
            .get(&identity.workspace_id)
            .cloned();
        if let Some(session) = previous {
            if session.hello().identity == identity {
                return Ok(session.hello().clone());
            }
            self.disconnect_locked(identity.workspace_id).await?;
        }
        let config = self
            .service
            .snapshot()
            .await
            .workspaces
            .into_iter()
            .find(|entry| entry.id == identity.workspace_id)
            .ok_or(WorkspaceError::NotFound)?;
        if config.service_pc != ServicePc::Local {
            return Err(WorkspaceError::ServiceLocationUnavailable);
        }
        let WorkspaceConnection::Ssh(connection) = &config.connection else {
            return Err(WorkspaceError::AdapterUnavailable);
        };
        let session = Arc::new(
            SshSession::connect(
                connection,
                identity,
                self.vault.as_ref(),
                SshPolicy::default(),
            )
            .await?,
        );
        if let Err(error) = self.accepting() {
            session.close().await?;
            return Err(error);
        }
        let hello = session.hello().clone();
        if let Err(error) = self.service.register_session(identity, hello.clone()).await {
            session.close().await?;
            return Err(error.into());
        }
        self.sessions
            .lock()
            .await
            .insert(identity.workspace_id, session);
        Ok(hello)
    }

    async fn session(&self, identity: SessionIdentity) -> Result<Arc<SshSession>, WorkspaceError> {
        self.accepting()?;
        let session = self
            .sessions
            .lock()
            .await
            .get(&identity.workspace_id)
            .cloned()
            .ok_or(WorkspaceError::NotConnected)?;
        if session.hello().identity != identity {
            return Err(ServiceError::SessionMismatch.into());
        }
        Ok(session)
    }

    pub async fn desktop_tools(
        &self,
        identity: SessionIdentity,
    ) -> Result<Vec<crate::ssh::DesktopTool>, WorkspaceError> {
        self.ensure_workspace_ready(identity.workspace_id).await?;
        let session = self.session(identity).await?;
        Ok(session.desktop_tools().to_vec())
    }

    pub async fn request(&self, request: GuestRequest) -> Result<GuestReply, WorkspaceError> {
        self.request_owned(request, None).await
    }

    async fn request_owned(
        &self,
        request: GuestRequest,
        owner: Option<Uuid>,
    ) -> Result<GuestReply, WorkspaceError> {
        self.ensure_workspace_ready(request.identity.workspace_id)
            .await?;
        self.execute_request(request, owner).await
    }

    #[cfg(target_os = "linux")]
    pub(crate) async fn request_for_setup(
        &self,
        request: GuestRequest,
    ) -> Result<GuestReply, WorkspaceError> {
        self.execute_request(request, None).await
    }

    async fn execute_request(
        &self,
        request: GuestRequest,
        owner: Option<Uuid>,
    ) -> Result<GuestReply, WorkspaceError> {
        let session = self.session(request.identity).await?;
        if let Some(owner) = owner {
            self.service
                .begin_control_observation(&request, owner)
                .await?;
        } else {
            self.service.begin_operation(&request).await?;
            self.resume_observations
                .lock()
                .await
                .remove(&request.identity.workspace_id);
        }
        let reply = match session.request(request.clone()).await {
            Ok(reply) => reply,
            Err(error) => {
                self.service
                    .mark_operation_uncertain(request.operation_id, request.identity)
                    .await?;
                return Err(error.into());
            }
        };
        if matches!(
            request.operation,
            GuestOperationKind::Status { .. } | GuestOperationKind::Cancel { .. }
        ) {
            self.service.reconcile_operation(&request, &reply).await?;
            return Ok(reply);
        }
        let completion = match &reply.outcome {
            GuestOutcome::Success {
                result: GuestResult::Started,
            } => return Ok(reply),
            GuestOutcome::Success {
                result: GuestResult::ExecFinished { exit_code, .. },
            } if *exit_code != 0 => OperationCompletion::Failed,
            GuestOutcome::Success {
                result: GuestResult::Desktop { result },
            } if result["isError"] == true => OperationCompletion::Failed,
            GuestOutcome::Success { .. } => OperationCompletion::Completed,
            GuestOutcome::Error { error }
                if matches!(
                    error.code,
                    crate::contract::GuestErrorCode::OutcomeUnknown
                        | crate::contract::GuestErrorCode::Unavailable
                ) =>
            {
                self.service
                    .mark_operation_uncertain(request.operation_id, request.identity)
                    .await?;
                return Ok(reply);
            }
            GuestOutcome::Error { error }
                if error.code == crate::contract::GuestErrorCode::Cancelled =>
            {
                OperationCompletion::Cancelled
            }
            GuestOutcome::Error { .. } => OperationCompletion::Failed,
        };
        self.service
            .finish_operation(request.operation_id, request.identity, completion)
            .await?;
        Ok(reply)
    }

    pub async fn take_over(
        &self,
        identity: SessionIdentity,
        owner: Uuid,
    ) -> Result<SessionControl, WorkspaceError> {
        self.ensure_workspace_ready(identity.workspace_id).await?;
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        self.session(identity).await?;
        let control = self.service.take_over(identity, owner).await?;
        self.resume_observations
            .lock()
            .await
            .remove(&identity.workspace_id);
        Ok(control)
    }

    pub async fn hand_back(
        &self,
        identity: SessionIdentity,
        owner: Uuid,
    ) -> Result<HandBack, WorkspaceError> {
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        self.session(identity).await?;
        let admitted = self.service.begin_hand_back(identity, owner).await;
        if let Err(error) = admitted {
            if error == ServiceError::OperationState {
                self.close_media_locked(identity.workspace_id).await?;
            }
            return Err(error.into());
        }
        // Human connections and queued bytes end before the bot may observe/resume.
        self.close_media_locked(identity.workspace_id).await?;
        let request = GuestRequest {
            identity,
            operation_id: OperationId::new(),
            operation: GuestOperationKind::Desktop {
                tool: "get_desktop_state".into(),
                arguments: serde_json::json!({}),
            },
        };
        let observation = self.request_owned(request.clone(), Some(owner)).await?;
        let valid = matches!(&observation.outcome,
            GuestOutcome::Success { result: GuestResult::Desktop { result } }
                if result["isError"] != true
                    && ["screenshot_width", "screenshot_height", "screen_width", "screen_height"]
                        .iter().all(|field| result["structuredContent"][field].as_u64().is_some_and(|n| n > 0))
                    && result["content"].as_array().is_some_and(|content|
                        content.iter().any(|part| part["type"] == "image" && part["data"].as_str().is_some_and(|data| !data.is_empty()))));
        if !valid {
            return Err(ServiceError::OperationState.into());
        }
        self.resume_observations
            .lock()
            .await
            .insert(identity.workspace_id, observation.clone());
        let control = match self
            .service
            .finish_hand_back(identity, owner, request.operation_id)
            .await
        {
            Ok(control) => control,
            Err(error) => {
                self.resume_observations
                    .lock()
                    .await
                    .remove(&identity.workspace_id);
                return Err(error.into());
            }
        };
        Ok(HandBack {
            control,
            observation,
        })
    }

    /// Consume the fresh hand-back frame; a restarted runner captures another frame.
    pub async fn resume_observation(&self, identity: SessionIdentity) -> Option<GuestReply> {
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        if !self
            .service
            .snapshot()
            .await
            .controls
            .iter()
            .any(|control| {
                control.identity == identity && control.state == SessionControlState::Bot
            })
        {
            return None;
        }
        let mut observations = self.resume_observations.lock().await;
        if observations
            .get(&identity.workspace_id)
            .is_some_and(|reply| reply.identity == identity)
        {
            observations.remove(&identity.workspace_id)
        } else {
            None
        }
    }

    pub async fn open_view(
        self: &Arc<Self>,
        request: OpenView,
    ) -> Result<ViewTicket, WorkspaceError> {
        self.ensure_workspace_ready(request.identity.workspace_id)
            .await?;
        self.open_session_view(request).await
    }

    #[cfg(target_os = "linux")]
    pub(crate) async fn open_view_for_setup(
        self: &Arc<Self>,
        request: OpenView,
    ) -> Result<ViewTicket, WorkspaceError> {
        self.open_session_view(request).await
    }

    async fn open_session_view(
        self: &Arc<Self>,
        request: OpenView,
    ) -> Result<ViewTicket, WorkspaceError> {
        let runtime = self.clone();
        // Retain ownership if the HTTP caller disappears during ticket creation.
        tokio::spawn(async move {
            let identity = request.identity;
            let lock = runtime.lifecycle_lock(identity.workspace_id).await;
            let _guard = lock.lock_owned().await;
            runtime.accepting()?;
            let session = runtime.session(identity).await?;
            if request.interactive
                && !runtime
                    .service
                    .snapshot()
                    .await
                    .controls
                    .iter()
                    .any(|control| {
                        control.identity == identity
                            && control.owner == Some(request.owner)
                            && control.state == SessionControlState::Human
                    })
            {
                return Err(ServiceError::ControlOwner.into());
            }
            if runtime
                .media
                .lock()
                .await
                .get(&identity.workspace_id)
                .is_some_and(|lease| lease.owner != request.owner)
            {
                return Err(ServiceError::ControlOwner.into());
            }
            runtime.close_media_locked(identity.workspace_id).await?;
            let token = session.media_token().await?;
            let endpoint = session.open_view().await?;
            let lease = match MediaLease::open(endpoint, token, &request).await {
                Ok(lease) => lease,
                Err(error) => {
                    session.close_view().await?;
                    return Err(error.into());
                }
            };
            let ticket = lease.ticket.clone();
            runtime
                .media
                .lock()
                .await
                .insert(identity.workspace_id, lease);
            Ok(ticket)
        })
        .await
        .map_err(|_| WorkspaceError::ShuttingDown)?
    }

    pub async fn close_view(&self, request: CloseView) -> Result<(), WorkspaceError> {
        let identity = request.identity;
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        self.session(identity).await?;
        let media = self.media.lock().await;
        let Some(lease) = media.get(&identity.workspace_id) else {
            return Ok(());
        };
        if lease.ticket.lease_id != request.lease_id {
            return Ok(());
        }
        if lease.owner != request.owner {
            return Err(ServiceError::ControlOwner.into());
        }
        // Transport closure preserves Human ownership until explicit hand-back.
        drop(media);
        self.close_media_locked(identity.workspace_id).await?;
        Ok(())
    }

    async fn close_media_locked(&self, workspace: WorkspaceId) -> Result<(), WorkspaceError> {
        let mut media = self.media.lock().await;
        if let Some(lease) = media.get_mut(&workspace) {
            lease.close().await?;
        }
        media.remove(&workspace);
        drop(media);
        if let Some(session) = self.sessions.lock().await.get(&workspace).cloned() {
            session.close_view().await?;
        }
        Ok(())
    }

    pub async fn ping(&self, identity: SessionIdentity) -> Result<(), WorkspaceError> {
        self.session(identity).await?.ping().await?;
        Ok(())
    }

    pub async fn disconnect(&self, identity: SessionIdentity) -> Result<(), WorkspaceError> {
        let lock = self.lifecycle_lock(identity.workspace_id).await;
        let _guard = lock.lock().await;
        let session = self
            .sessions
            .lock()
            .await
            .get(&identity.workspace_id)
            .cloned()
            .ok_or(WorkspaceError::NotConnected)?;
        if session.hello().identity != identity {
            return Err(ServiceError::SessionMismatch.into());
        }
        self.disconnect_locked(identity.workspace_id).await
    }

    #[cfg(target_os = "linux")]
    pub(crate) async fn lock_for_removal(
        &self,
        identity: SessionIdentity,
    ) -> Result<WorkspaceRemoval<'_>, WorkspaceError> {
        let guard = self
            .lifecycle_lock(identity.workspace_id)
            .await
            .lock_owned()
            .await;
        let session = self
            .sessions
            .lock()
            .await
            .get(&identity.workspace_id)
            .map(|session| session.hello().identity);
        if session.is_some_and(|session| session != identity) {
            return Err(ServiceError::SessionMismatch.into());
        }
        Ok(WorkspaceRemoval {
            runtime: self,
            _guard: guard,
            workspace: identity.workspace_id,
            session,
        })
    }

    async fn disconnect_locked(&self, workspace: WorkspaceId) -> Result<(), WorkspaceError> {
        // A failed ticket revocation still ends the SSH channel on disconnect.
        let media_result = self.close_media_locked(workspace).await;
        self.resume_observations.lock().await.remove(&workspace);
        let Some(session) = self.sessions.lock().await.remove(&workspace) else {
            return Ok(());
        };
        let state_result = self
            .service
            .disconnect_session(session.hello().identity)
            .await;
        let close_result = session.close().await;
        state_result?;
        close_result?;
        self.media.lock().await.remove(&workspace);
        media_result?;
        Ok(())
    }

    pub async fn close(self: &Arc<Self>) -> Result<(), WorkspaceError> {
        self.stopping.store(true, Ordering::Release);
        if let Some(connectors) = &self.connectors {
            let _ = connectors.close().await;
        }
        #[cfg(target_os = "linux")]
        if let Some(setup) = self.kvm_setup() {
            setup.close().await;
        }
        let workspaces: Vec<_> = self.lifecycle.lock().await.keys().copied().collect();
        let mut jobs = tokio::task::JoinSet::new();
        for workspace in workspaces {
            let lock = self.lifecycle_lock(workspace).await;
            let runtime = self.clone();
            jobs.spawn(async move {
                let _guard = lock.lock_owned().await;
                runtime.disconnect_locked(workspace).await
            });
        }
        let mut first_error = None;
        while let Some(result) = jobs.join_next().await {
            match result {
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                }
                Ok(Ok(())) => {}
                Err(_) => {
                    first_error.get_or_insert(WorkspaceError::ShuttingDown);
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
