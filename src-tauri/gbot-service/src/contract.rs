use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    net::IpAddr,
};
use uuid::Uuid;

pub const GUEST_PROTOCOL_VERSION: u32 = 1;

macro_rules! identity {
    ($name:ident) => {
        #[derive(
            Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
            pub fn validate(&self) -> Result<(), ContractError> {
                if self.0.is_nil() {
                    Err(ContractError::InvalidIdentity)
                } else {
                    Ok(())
                }
            }
        }
        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

identity!(WorkspaceId);
identity!(SessionId);
identity!(OperationId);
identity!(VaultCredentialRef);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServicePc {
    #[default]
    Local,
    Lan {
        hostname: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Hypervisor {
    HyperV,
    Kvm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudProvider {
    Hetzner,
    DigitalOcean,
    Azure,
    Aws,
    Gcp,
}

// There is deliberately no host-desktop bot computer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BotPc {
    LocalVm {
        host_id: Uuid,
        vm_id: String,
        hypervisor: Hypervisor,
    },
    Lan {
        computer_id: Uuid,
    },
    Cloud {
        provider: CloudProvider,
        resource_id: String,
    },
    M365 {
        cloud_pc_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshEndpoint {
    pub hostname: String,
    pub port: u16,
    pub user: String,
}

impl SshEndpoint {
    pub fn validate(&self) -> Result<(), ContractError> {
        validate_hostname(&self.hostname)?;
        if self.port == 0
            || self.user.is_empty()
            || !self
                .user
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
            || self.user.starts_with('-')
        {
            return Err(ContractError::InvalidEndpoint);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshHostPublicKey {
    pub algorithm: String,
    pub public_key: String,
}

impl SshHostPublicKey {
    pub fn validate(&self) -> Result<(), ContractError> {
        // The SSH adapter also parses this public key before connecting.
        if !(self.algorithm.starts_with("ssh-") || self.algorithm.starts_with("ecdsa-"))
            || !self
                .algorithm
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-@._".contains(&c))
            || self.public_key.is_empty()
            || !self
                .public_key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"+/=".contains(&c))
        {
            return Err(ContractError::InvalidHostKey);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshConnection {
    pub endpoint: SshEndpoint,
    pub pinned_host_key: SshHostPublicKey,
    pub credential_ref: VaultCredentialRef,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MicrosoftRoute {
    PendingQualification,
    BrokeredClient,
    GuestWorker,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkspaceConnection {
    Ssh(SshConnection),
    Microsoft {
        connection_ref: Uuid,
        route: MicrosoftRoute,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub id: WorkspaceId,
    pub name: String,
    pub service_pc: ServicePc,
    pub bot_pc: BotPc,
    pub connection: WorkspaceConnection,
}

impl WorkspaceConfig {
    pub fn validate(&self) -> Result<(), ContractError> {
        self.id.validate()?;
        validate_text(&self.name)?;
        if let ServicePc::Lan { hostname } = &self.service_pc {
            validate_hostname(hostname)?;
        }
        match &self.bot_pc {
            BotPc::LocalVm { host_id, vm_id, .. } => {
                if host_id.is_nil() {
                    return Err(ContractError::InvalidIdentity);
                }
                validate_text(vm_id)?;
            }
            BotPc::Lan { computer_id } if computer_id.is_nil() => {
                return Err(ContractError::InvalidIdentity)
            }
            BotPc::Cloud { resource_id, .. } => validate_text(resource_id)?,
            BotPc::M365 { cloud_pc_id } => validate_text(cloud_pc_id)?,
            BotPc::Lan { .. } => {}
        }
        match (&self.bot_pc, &self.connection) {
            (BotPc::M365 { .. }, WorkspaceConnection::Microsoft { connection_ref, .. }) => {
                if connection_ref.is_nil() {
                    return Err(ContractError::InvalidIdentity);
                }
            }
            (BotPc::M365 { .. }, _) | (_, WorkspaceConnection::Microsoft { .. }) => {
                return Err(ContractError::AdapterMismatch)
            }
            (_, WorkspaceConnection::Ssh(ssh)) => {
                ssh.endpoint.validate()?;
                ssh.pinned_host_key.validate()?;
                ssh.credential_ref.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionIdentity {
    pub workspace_id: WorkspaceId,
    pub session_id: SessionId,
}

impl SessionIdentity {
    pub fn validate(&self) -> Result<(), ContractError> {
        self.workspace_id.validate()?;
        self.session_id.validate()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStage {
    Disconnected,
    CheckingIdentity,
    Authenticating,
    TransportReady,
    InspectingGuest,
    GuestReady,
    InspectingDesktop,
    DesktopReady,
    Offline,
    NeedsAttention,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuestCapability {
    Exec,
    Read,
    Write,
    Status,
    Cancel,
    DesktopCapture,
    DesktopInput,
    ViewTransport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestViewEndpoint {
    pub host: IpAddr,
    pub port: u16,
    pub session_id: SessionId,
}

impl GuestViewEndpoint {
    pub fn validate(&self, session: SessionId) -> Result<(), ContractError> {
        if !self.host.is_loopback() || self.port == 0 {
            return Err(ContractError::InvalidViewEndpoint);
        }
        if self.session_id != session {
            return Err(ContractError::SessionMismatch);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestHello {
    pub protocol_version: u32,
    pub identity: SessionIdentity,
    pub capabilities: BTreeSet<GuestCapability>,
    pub view: Option<GuestViewEndpoint>,
}

impl GuestHello {
    pub fn validate(&self, expected: &SessionIdentity) -> Result<(), ContractError> {
        self.identity.validate()?;
        expected.validate()?;
        if self.protocol_version != GUEST_PROTOCOL_VERSION {
            return Err(ContractError::UnsupportedProtocol);
        }
        validate_binding(self.identity, *expected)?;
        if let Some(view) = &self.view {
            view.validate(self.identity.session_id)?;
            if !self.capabilities.contains(&GuestCapability::ViewTransport) {
                return Err(ContractError::CapabilityUnavailable);
            }
        }
        Ok(())
    }

    // A handshake (even with a view endpoint) proves no frame or desktop input.
    pub fn connection_stage(&self) -> ConnectionStage {
        ConnectionStage::GuestReady
    }
}

// This is a guest-owned path, never a service/client filesystem path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GuestPath(pub String);

impl GuestPath {
    pub fn validate(&self) -> Result<(), ContractError> {
        validate_text(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GuestOperationKind {
    Exec {
        program: String,
        args: Vec<String>,
        cwd: GuestPath,
        env: BTreeMap<String, String>,
    },
    Read {
        path: GuestPath,
        offset: u64,
        length: u64,
    },
    Write {
        path: GuestPath,
        offset: u64,
        data: Vec<u8>,
        truncate: bool,
    },
    Desktop {
        tool: String,
        arguments: serde_json::Value,
    },
    Status {
        operation_id: OperationId,
    },
    Cancel {
        operation_id: OperationId,
    },
}

impl GuestOperationKind {
    pub fn capability(&self) -> GuestCapability {
        match self {
            Self::Exec { .. } => GuestCapability::Exec,
            Self::Read { .. } => GuestCapability::Read,
            Self::Write { .. } => GuestCapability::Write,
            Self::Desktop { tool, .. } => match tool.as_str() {
                "get_window_state" | "get_desktop_state" | "list_windows" | "list_displays"
                | "verify_state" => GuestCapability::DesktopCapture,
                _ => GuestCapability::DesktopInput,
            },
            Self::Status { .. } => GuestCapability::Status,
            Self::Cancel { .. } => GuestCapability::Cancel,
        }
    }

    pub fn validate(&self) -> Result<(), ContractError> {
        match self {
            Self::Exec {
                program,
                args,
                cwd,
                env,
            } => {
                validate_text(program)?;
                cwd.validate()?;
                if args.iter().any(|arg| arg.contains('\0'))
                    || env.iter().any(|(key, value)| {
                        key.is_empty() || key.contains(['=', '\0']) || value.contains('\0')
                    })
                {
                    return Err(ContractError::InvalidOperation);
                }
            }
            Self::Read {
                path,
                offset,
                length,
            } => {
                path.validate()?;
                if *length == 0 || offset.checked_add(*length).is_none() {
                    return Err(ContractError::InvalidRange);
                }
            }
            Self::Write {
                path, offset, data, ..
            } => {
                path.validate()?;
                let length = u64::try_from(data.len()).map_err(|_| ContractError::InvalidRange)?;
                if offset.checked_add(length).is_none() {
                    return Err(ContractError::InvalidRange);
                }
            }
            Self::Status { operation_id } | Self::Cancel { operation_id } => {
                operation_id.validate()?
            }
            Self::Desktop { tool, arguments } => {
                validate_text(tool)?;
                if !arguments.is_object() {
                    return Err(ContractError::InvalidOperation);
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestRequest {
    pub identity: SessionIdentity,
    pub operation_id: OperationId,
    pub operation: GuestOperationKind,
}

impl GuestRequest {
    pub fn validate(&self, hello: &GuestHello) -> Result<(), ContractError> {
        hello.validate(&self.identity)?;
        self.operation_id.validate()?;
        self.operation.validate()?;
        if !hello.capabilities.contains(&self.operation.capability()) {
            return Err(ContractError::CapabilityUnavailable);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestReply {
    pub identity: SessionIdentity,
    pub operation_id: OperationId,
    pub outcome: GuestOutcome,
}

impl GuestReply {
    pub fn validate(&self, request: &GuestRequest) -> Result<(), ContractError> {
        self.identity.validate()?;
        validate_binding(self.identity, request.identity)?;
        if self.operation_id != request.operation_id {
            return Err(ContractError::OperationMismatch);
        }
        match (&request.operation, &self.outcome) {
            (_, GuestOutcome::Error { .. }) => Ok(()),
            (
                GuestOperationKind::Exec { .. },
                GuestOutcome::Success {
                    result: GuestResult::Started | GuestResult::ExecFinished { .. },
                },
            ) => Ok(()),
            (
                GuestOperationKind::Read { length, .. },
                GuestOutcome::Success {
                    result: GuestResult::Read { data },
                },
            ) if data.len() as u64 <= *length => Ok(()),
            (
                GuestOperationKind::Write { data, .. },
                GuestOutcome::Success {
                    result: GuestResult::Written { bytes_written },
                },
            ) if *bytes_written <= data.len() as u64 => Ok(()),
            (
                GuestOperationKind::Desktop { .. },
                GuestOutcome::Success {
                    result: GuestResult::Desktop { .. },
                },
            ) => Ok(()),
            (
                GuestOperationKind::Status { .. },
                GuestOutcome::Success {
                    result: GuestResult::Status { .. },
                },
            ) => Ok(()),
            (
                GuestOperationKind::Cancel { .. },
                GuestOutcome::Success {
                    result: GuestResult::Cancel { .. },
                },
            ) => Ok(()),
            _ => Err(ContractError::InvalidReply),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GuestOutcome {
    Success { result: GuestResult },
    Error { error: GuestError },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GuestResult {
    Started,
    ExecFinished {
        exit_code: i32,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },
    Read {
        data: Vec<u8>,
    },
    Written {
        bytes_written: u64,
    },
    Desktop {
        result: serde_json::Value,
    },
    Status {
        state: GuestOperationState,
    },
    Cancel {
        state: GuestOperationState,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GuestOperationState {
    Running,
    Completed { exit_code: Option<i32> },
    Cancelled,
    Failed { error: GuestError },
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestError {
    pub code: GuestErrorCode,
    // Safe diagnostic text, never credentials or an implicit local retry instruction.
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuestErrorCode {
    UnsupportedProtocol,
    IdentityMismatch,
    CapabilityUnavailable,
    InvalidOperation,
    NotFound,
    PermissionDenied,
    Unavailable,
    Cancelled,
    Failed,
    OutcomeUnknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContractError {
    InvalidIdentity,
    InvalidEndpoint,
    InvalidHostKey,
    AdapterMismatch,
    UnsupportedProtocol,
    WorkspaceMismatch,
    SessionMismatch,
    OperationMismatch,
    CapabilityUnavailable,
    InvalidViewEndpoint,
    InvalidOperation,
    InvalidRange,
    InvalidReply,
}

impl fmt::Display for ContractError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidIdentity => "invalid workspace identity",
            Self::InvalidEndpoint => "invalid SSH endpoint",
            Self::InvalidHostKey => "invalid pinned host public key",
            Self::AdapterMismatch => "computer and connection adapter do not match",
            Self::UnsupportedProtocol => "unsupported guest protocol",
            Self::WorkspaceMismatch => "guest workspace does not match",
            Self::SessionMismatch => "guest session does not match",
            Self::OperationMismatch => "guest operation does not match",
            Self::CapabilityUnavailable => "guest capability is unavailable",
            Self::InvalidViewEndpoint => "guest view must use a loopback endpoint",
            Self::InvalidOperation => "invalid guest operation",
            Self::InvalidRange => "invalid guest file range",
            Self::InvalidReply => "guest reply does not match the operation",
        })
    }
}
impl std::error::Error for ContractError {}

fn validate_binding(
    actual: SessionIdentity,
    expected: SessionIdentity,
) -> Result<(), ContractError> {
    if actual.workspace_id != expected.workspace_id {
        return Err(ContractError::WorkspaceMismatch);
    }
    if actual.session_id != expected.session_id {
        return Err(ContractError::SessionMismatch);
    }
    Ok(())
}

fn validate_text(text: &str) -> Result<(), ContractError> {
    if text.trim().is_empty() || text.contains('\0') {
        Err(ContractError::InvalidOperation)
    } else {
        Ok(())
    }
}

fn validate_hostname(hostname: &str) -> Result<(), ContractError> {
    if hostname.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    // DNS wire limits, not an application output or task budget.
    let name = hostname.strip_suffix('.').unwrap_or(hostname);
    if name.is_empty()
        || name.len() > 253
        || !name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return Err(ContractError::InvalidEndpoint);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> GuestHello {
        GuestHello {
            protocol_version: GUEST_PROTOCOL_VERSION,
            identity: SessionIdentity {
                workspace_id: WorkspaceId::new(),
                session_id: SessionId::new(),
            },
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

    fn request(hello: &GuestHello, operation: GuestOperationKind) -> GuestRequest {
        GuestRequest {
            identity: hello.identity,
            operation_id: OperationId::new(),
            operation,
        }
    }

    #[test]
    fn guest_operations_reject_wrong_workspace_session_and_missing_capability() {
        let guest = hello();
        let mut operation = request(
            &guest,
            GuestOperationKind::Read {
                path: GuestPath("/home/bot/result".into()),
                offset: 0,
                length: 8,
            },
        );
        assert_eq!(operation.validate(&guest), Ok(()));
        operation.identity.workspace_id = WorkspaceId::new();
        assert_eq!(
            operation.validate(&guest),
            Err(ContractError::WorkspaceMismatch)
        );
        operation.identity = guest.identity;
        operation.identity.session_id = SessionId::new();
        assert_eq!(
            operation.validate(&guest),
            Err(ContractError::SessionMismatch)
        );
        operation.identity = guest.identity;
        let mut unavailable = guest;
        unavailable.capabilities.remove(&GuestCapability::Read);
        assert_eq!(
            operation.validate(&unavailable),
            Err(ContractError::CapabilityUnavailable)
        );
    }

    #[test]
    fn view_is_loopback_session_bound_and_does_not_establish_desktop_ready() {
        let mut guest = hello();
        guest.capabilities.insert(GuestCapability::ViewTransport);
        guest.view = Some(GuestViewEndpoint {
            host: "127.0.0.1".parse().unwrap(),
            port: 5900,
            session_id: guest.identity.session_id,
        });
        assert_eq!(guest.validate(&guest.identity), Ok(()));
        assert_eq!(guest.connection_stage(), ConnectionStage::GuestReady);
        guest.view.as_mut().unwrap().host = "0.0.0.0".parse().unwrap();
        assert_eq!(
            guest.validate(&guest.identity),
            Err(ContractError::InvalidViewEndpoint)
        );
        guest.view.as_mut().unwrap().host = "::1".parse().unwrap();
        guest.view.as_mut().unwrap().session_id = SessionId::new();
        assert_eq!(
            guest.validate(&guest.identity),
            Err(ContractError::SessionMismatch)
        );
        guest.protocol_version += 1;
        assert_eq!(
            guest.validate(&guest.identity),
            Err(ContractError::UnsupportedProtocol)
        );
    }

    #[test]
    fn workspace_round_trip_contains_public_identity_and_vault_reference_only() {
        let config = WorkspaceConfig {
            id: WorkspaceId::new(),
            name: "Dedicated guest".into(),
            service_pc: ServicePc::Local,
            bot_pc: BotPc::LocalVm {
                host_id: Uuid::new_v4(),
                vm_id: "bot-linux".into(),
                hypervisor: Hypervisor::Kvm,
            },
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: SshEndpoint {
                    hostname: "guest.example".into(),
                    port: 22,
                    user: "bot".into(),
                },
                pinned_host_key: SshHostPublicKey {
                    algorithm: "ssh-ed25519".into(),
                    public_key: "AAAAC3NzaC1lZDI1NTE5AAAAIA==".into(),
                },
                credential_ref: VaultCredentialRef::new(),
            }),
        };
        assert_eq!(config.validate(), Ok(()));
        let saved = serde_json::to_value(&config).unwrap();
        assert!(saved["connection"]["credential_ref"].is_string());
        assert!(saved["connection"].get("private_key").is_none());
        assert_eq!(
            serde_json::from_value::<WorkspaceConfig>(saved).unwrap(),
            config
        );
        let mut cloud_pc = config;
        cloud_pc.bot_pc = BotPc::M365 {
            cloud_pc_id: "assigned-cloud-pc".into(),
        };
        assert_eq!(cloud_pc.validate(), Err(ContractError::AdapterMismatch));
        cloud_pc.connection = WorkspaceConnection::Microsoft {
            connection_ref: Uuid::new_v4(),
            route: MicrosoftRoute::PendingQualification,
        };
        assert_eq!(cloud_pc.validate(), Ok(()));
    }

    #[test]
    fn endpoint_rejects_shell_syntax_missing_port_and_unpinned_identity() {
        for host in ["-option", "user@host", "host;command", "https://host", ""] {
            assert_eq!(
                SshEndpoint {
                    hostname: host.into(),
                    port: 22,
                    user: "bot".into()
                }
                .validate(),
                Err(ContractError::InvalidEndpoint)
            );
        }
        assert_eq!(
            SshEndpoint {
                hostname: "::1".into(),
                port: 22,
                user: "bot".into()
            }
            .validate(),
            Ok(())
        );
        assert_eq!(
            SshEndpoint {
                hostname: "localhost".into(),
                port: 0,
                user: "bot".into()
            }
            .validate(),
            Err(ContractError::InvalidEndpoint)
        );
        assert_eq!(
            SshEndpoint {
                hostname: "localhost".into(),
                port: 22,
                user: "bot;command".into()
            }
            .validate(),
            Err(ContractError::InvalidEndpoint)
        );
        assert_eq!(
            SshHostPublicKey {
                algorithm: "ssh-ed25519".into(),
                public_key: String::new()
            }
            .validate(),
            Err(ContractError::InvalidHostKey)
        );
    }

    #[test]
    fn file_bounds_and_reply_operation_are_checked_without_an_output_cap() {
        let guest = hello();
        let read = request(
            &guest,
            GuestOperationKind::Read {
                path: GuestPath("C:\\Bot\\result.bin".into()),
                offset: 2,
                length: 3,
            },
        );
        assert_eq!(read.validate(&guest), Ok(()));
        let mut reply = GuestReply {
            identity: guest.identity,
            operation_id: read.operation_id,
            outcome: GuestOutcome::Success {
                result: GuestResult::Read {
                    data: vec![1, 2, 3],
                },
            },
        };
        assert_eq!(reply.validate(&read), Ok(()));
        reply.outcome = GuestOutcome::Success {
            result: GuestResult::Read {
                data: vec![1, 2, 3, 4],
            },
        };
        assert_eq!(reply.validate(&read), Err(ContractError::InvalidReply));
        reply.operation_id = OperationId::new();
        assert_eq!(reply.validate(&read), Err(ContractError::OperationMismatch));
        let overflow = request(
            &guest,
            GuestOperationKind::Read {
                path: GuestPath("/result".into()),
                offset: u64::MAX,
                length: 1,
            },
        );
        assert_eq!(overflow.validate(&guest), Err(ContractError::InvalidRange));
        let exec = request(
            &guest,
            GuestOperationKind::Exec {
                program: "printf".into(),
                args: vec!["hello".into()],
                cwd: GuestPath("/home/bot".into()),
                env: BTreeMap::new(),
            },
        );
        assert_eq!(exec.validate(&guest), Ok(()));
        let reply = GuestReply {
            identity: guest.identity,
            operation_id: exec.operation_id,
            outcome: GuestOutcome::Success {
                result: GuestResult::ExecFinished {
                    exit_code: 0,
                    stdout: vec![0; 131_072],
                    stderr: Vec::new(),
                },
            },
        };
        assert_eq!(reply.validate(&exec), Ok(()));
    }

    #[test]
    fn status_cancel_and_remote_errors_stay_bound_to_guest_operations() {
        let guest = hello();
        let target = OperationId::new();
        for operation in [
            GuestOperationKind::Status {
                operation_id: target,
            },
            GuestOperationKind::Cancel {
                operation_id: target,
            },
        ] {
            let request = request(&guest, operation);
            assert_eq!(request.validate(&guest), Ok(()));
            let reply = GuestReply {
                identity: guest.identity,
                operation_id: request.operation_id,
                outcome: GuestOutcome::Error {
                    error: GuestError {
                        code: GuestErrorCode::Unavailable,
                        message: "Guest disconnected".into(),
                    },
                },
            };
            assert_eq!(reply.validate(&request), Ok(()));
            assert_eq!(
                serde_json::from_str::<GuestReply>(&serde_json::to_string(&reply).unwrap())
                    .unwrap(),
                reply
            );
        }
    }
}
