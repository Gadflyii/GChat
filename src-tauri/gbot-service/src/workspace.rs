use std::{
    collections::BTreeMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

use crate::{
    contract::{
        GuestHello, GuestOperationKind, GuestOutcome, GuestReply, GuestRequest, GuestResult,
        ServicePc, SessionIdentity, WorkspaceConfig, WorkspaceConnection, WorkspaceId,
    },
    service::{OperationCompletion, Service, ServiceError},
    ssh::{SshError, SshPolicy, SshSession},
    vault::Vault,
};

#[derive(Debug)]
pub enum WorkspaceError {
    State(ServiceError),
    Transport(SshError),
    NotFound,
    NotConnected,
    AdapterUnavailable,
    ServiceLocationUnavailable,
    ShuttingDown,
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::State(error) => error.fmt(f),
            Self::Transport(error) => error.fmt(f),
            Self::NotFound => f.write_str("workspace is not registered"),
            Self::NotConnected => f.write_str("connect the selected guest session first"),
            Self::AdapterUnavailable => f.write_str("this workspace adapter is not installed"),
            Self::ServiceLocationUnavailable => {
                f.write_str("this service cannot run on the selected PC")
            }
            Self::ShuttingDown => f.write_str("Gbot service is stopping"),
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

pub struct WorkspaceRuntime {
    service: Arc<Service>,
    vault: Arc<dyn Vault>,
    sessions: Mutex<BTreeMap<WorkspaceId, Arc<SshSession>>>,
    lifecycle: Mutex<BTreeMap<WorkspaceId, Arc<Mutex<()>>>>,
    stopping: AtomicBool,
}

impl WorkspaceRuntime {
    pub fn new(service: Arc<Service>, vault: Arc<dyn Vault>) -> Self {
        Self {
            service,
            vault,
            sessions: Mutex::new(BTreeMap::new()),
            lifecycle: Mutex::new(BTreeMap::new()),
            stopping: AtomicBool::new(false),
        }
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

    pub async fn register_workspace(&self, config: WorkspaceConfig) -> Result<(), WorkspaceError> {
        self.accepting()?;
        let lock = self.lifecycle_lock(config.id).await;
        let _guard = lock.lock().await;
        self.accepting()?;
        self.service.register_workspace(config).await?;
        Ok(())
    }

    pub async fn connect(&self, identity: SessionIdentity) -> Result<GuestHello, WorkspaceError> {
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

    pub async fn request(&self, request: GuestRequest) -> Result<GuestReply, WorkspaceError> {
        let session = self.session(request.identity).await?;
        self.service.begin_operation(&request).await?;
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

    pub async fn open_view(&self, identity: SessionIdentity) -> Result<SocketAddr, WorkspaceError> {
        Ok(self.session(identity).await?.open_view().await?)
    }

    pub async fn close_view(&self, identity: SessionIdentity) -> Result<(), WorkspaceError> {
        self.session(identity).await?.close_view().await?;
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

    async fn disconnect_locked(&self, workspace: WorkspaceId) -> Result<(), WorkspaceError> {
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
        Ok(())
    }

    pub async fn close(self: &Arc<Self>) -> Result<(), WorkspaceError> {
        self.stopping.store(true, Ordering::Release);
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
