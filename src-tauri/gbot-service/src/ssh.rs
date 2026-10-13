//! Vault-backed SSH transport for one explicitly selected guest session.
//!
//! Cua desktop control uses pinned MCP; commands/files have independent channels.
//! A view carries raw guest-loopback bytes and establishes no desktop capability.

use std::{
    fmt,
    net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr},
    ops::Deref,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Duration,
};

use russh::{
    client,
    keys::{
        Algorithm, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate,
    },
    Channel, Disconnect,
};
use serde::Serialize;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{oneshot, watch, Mutex, Notify},
    task::{JoinHandle, JoinSet},
};

use crate::{
    contract::{
        ContractError, GuestCapability, GuestHello, GuestReply, GuestRequest, OperationId,
        SessionIdentity, SshConnection, SshEndpoint, SshHostPublicKey, VaultCredentialRef,
    },
    vault::{Secret, Vault, VaultError},
};

mod guest;
mod native;
mod projection;
pub use guest::DesktopTool;
pub use projection::desktop_model_result;

#[derive(Clone, Copy, Debug)]
pub struct SshPolicy {
    /// Bounds connection/authentication/guest inspection, not guest output.
    pub connect_timeout: Duration,
    pub keepalive_interval: Duration,
    pub keepalive_max: usize,
}

impl Default for SshPolicy {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(30),
            keepalive_interval: Duration::from_secs(15),
            keepalive_max: 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SshError {
    Contract(ContractError),
    Vault(VaultError),
    MissingCredential,
    InvalidCredential,
    PassphraseRequired,
    InvalidPassphrase,
    UnsupportedCredentialAlgorithm,
    ImportFailed,
    InvalidPolicy,
    PeerRejected,
    AuthenticationRejected,
    Transport,
    TimedOut,
    Protocol,
    Closed,
    CleanupUnproven,
    /// Some request bytes may have reached the guest. Reconcile, never replay.
    UncertainOutcome {
        operation_id: OperationId,
    },
}

impl fmt::Display for SshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contract(error) => error.fmt(f),
            Self::Vault(error) => error.fmt(f),
            Self::MissingCredential => f.write_str("SSH credential is missing from secure storage"),
            Self::InvalidCredential => f.write_str("SSH credential must be an OpenSSH private key"),
            Self::PassphraseRequired => f.write_str("This SSH key requires its passphrase for import"),
            Self::InvalidPassphrase => f.write_str("SSH key could not be unlocked with this passphrase"),
            Self::UnsupportedCredentialAlgorithm => f.write_str("SSH credentials must use Ed25519, ECDSA or RSA"),
            Self::ImportFailed => f.write_str("SSH credential import could not complete"),
            Self::InvalidPolicy => f.write_str("SSH timeouts and keepalive count must be positive"),
            Self::PeerRejected => f.write_str("Guest SSH key does not match the selected peer"),
            Self::AuthenticationRejected => f.write_str("Guest rejected the selected SSH credential"),
            Self::Transport => f.write_str("Guest SSH transport failed"),
            Self::TimedOut => f.write_str("Guest SSH connection or liveness check timed out"),
            Self::Protocol => f.write_str("Guest transport did not return the expected protocol message"),
            Self::Closed => f.write_str("Guest SSH connection is closed"),
            Self::CleanupUnproven => f.write_str("Guest SSH transport cleanup could not be confirmed"),
            Self::UncertainOutcome { .. } => f.write_str("Guest operation outcome is unknown; inspect its operation identity before retrying"),
        }
    }
}

impl std::error::Error for SshError {}

impl From<ContractError> for SshError {
    fn from(value: ContractError) -> Self {
        Self::Contract(value)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportedSshKey {
    pub credential_ref: VaultCredentialRef,
    pub public_key: SshHostPublicKey,
}

#[derive(Clone, Debug, Serialize)]
pub struct SshIdentity {
    pub public_key: SshHostPublicKey,
    pub fingerprint: String,
}

fn public_identity(public: &PublicKey) -> Result<SshIdentity, SshError> {
    let encoded = public
        .to_openssh()
        .map_err(|_| SshError::InvalidCredential)?;
    let mut fields = encoded.split_whitespace();
    let algorithm = fields.next().ok_or(SshError::InvalidCredential)?;
    let public_key = fields.next().ok_or(SshError::InvalidCredential)?;
    Ok(SshIdentity {
        public_key: SshHostPublicKey {
            algorithm: algorithm.into(),
            public_key: public_key.into(),
        },
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
    })
}

pub(crate) fn generate_ssh_key() -> Result<Secret, SshError> {
    let private = PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519)
        .map_err(|_| SshError::ImportFailed)?;
    let encoded = private
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .map_err(|_| SshError::ImportFailed)?;
    Ok(Secret::new(encoded.as_bytes().to_vec()))
}

pub(crate) fn ssh_public_key(secret: &Secret) -> Result<SshHostPublicKey, SshError> {
    let private = PrivateKey::from_openssh(secret.expose_secret())
        .map_err(|_| SshError::InvalidCredential)?;
    Ok(public_identity(private.public_key())?.public_key)
}

/// Discovery stops before authentication; the user must verify the offered key.
pub async fn inspect_ssh_identity(
    endpoint: SshEndpoint,
    policy: SshPolicy,
) -> Result<SshIdentity, SshError> {
    probe_ssh(endpoint, None, None, policy)
        .await
        .map(|(identity, _)| identity)
}

pub async fn check_ssh_connection(
    connection: &SshConnection,
    vault: &dyn Vault,
    policy: SshPolicy,
) -> Result<(), SshError> {
    let credentials = connection_credentials(connection, vault).await?;
    probe_ssh(connection.endpoint.clone(), Some(credentials), None, policy).await?;
    Ok(())
}

async fn connection_credentials(
    connection: &SshConnection,
    vault: &dyn Vault,
) -> Result<(PublicKey, PrivateKey), SshError> {
    connection.pinned_host_key.validate()?;
    connection.credential_ref.validate()?;
    let pinned = PublicKey::from_openssh(&format!(
        "{} {}",
        connection.pinned_host_key.algorithm, connection.pinned_host_key.public_key
    ))
    .map_err(|_| SshError::Contract(ContractError::InvalidHostKey))?;
    let secret = vault
        .get(connection.credential_ref.as_uuid())
        .await
        .map_err(SshError::Vault)?
        .ok_or(SshError::MissingCredential)?;
    let private = PrivateKey::from_openssh(secret.expose_secret())
        .map_err(|_| SshError::InvalidCredential)?;
    validate_credential_algorithm(&private)?;
    if private.is_encrypted() {
        return Err(SshError::PassphraseRequired);
    }
    drop(secret);
    Ok((pinned, private))
}

pub(crate) enum GuestPreparation {
    Stage(crate::lan_setup::Bundle),
    Check,
}

pub(crate) async fn prepare_ssh_guest(
    connection: &SshConnection,
    vault: &dyn Vault,
    action: GuestPreparation,
) -> Result<crate::lan_setup::Preparation, SshError> {
    let credentials = connection_credentials(connection, vault).await?;
    let mut policy = SshPolicy::default();
    if matches!(action, GuestPreparation::Stage(_)) {
        policy.connect_timeout = Duration::from_secs(600);
    }
    probe_ssh(
        connection.endpoint.clone(),
        Some(credentials),
        Some(action),
        policy,
    )
    .await?
    .1
    .ok_or(SshError::Protocol)
}

async fn probe_ssh(
    endpoint: SshEndpoint,
    credentials: Option<(PublicKey, PrivateKey)>,
    preparation: Option<GuestPreparation>,
    policy: SshPolicy,
) -> Result<(SshIdentity, Option<crate::lan_setup::Preparation>), SshError> {
    endpoint.validate()?;
    if policy.connect_timeout.is_zero()
        || policy.keepalive_interval.is_zero()
        || policy.keepalive_max == 0
    {
        return Err(SshError::InvalidPolicy);
    }
    let (cancel, mut cancelled) = oneshot::channel();
    let mut cancellation = CancelConnect(Some(cancel));
    let task = tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + policy.connect_timeout;
        let stream = tokio::select! {
            result = TcpStream::connect((endpoint.hostname.as_str(), endpoint.port)) => result.map_err(|_| SshError::Transport)?,
            _ = &mut cancelled => return Err(SshError::Closed),
            _ = tokio::time::sleep_until(deadline) => return Err(SshError::TimedOut),
        };
        let standard = stream.into_std().map_err(|_| SshError::Transport)?;
        let socket = standard.try_clone().map_err(|_| SshError::Transport)?;
        let stream = TcpStream::from_std(standard).map_err(|_| SshError::Transport)?;
        let mut setup = Box::pin(probe_session(
            stream,
            endpoint.user,
            credentials,
            preparation,
            policy,
        ));
        let interrupted = tokio::select! {
            result = &mut setup => return result,
            _ = &mut cancelled => SshError::Closed,
            _ = tokio::time::sleep_until(deadline) => SshError::TimedOut,
        };
        let _ = socket.shutdown(Shutdown::Both);
        let _ = setup.await;
        Err(interrupted)
    });
    let result = task.await.map_err(|_| SshError::CleanupUnproven)?;
    cancellation.0.take();
    result
}

async fn probe_session(
    stream: TcpStream,
    user: String,
    credentials: Option<(PublicKey, PrivateKey)>,
    preparation: Option<GuestPreparation>,
    policy: SshPolicy,
) -> Result<(SshIdentity, Option<crate::lan_setup::Preparation>), SshError> {
    let offered = Arc::new(StdMutex::new(None));
    let rejected = Arc::new(AtomicBool::new(false));
    let (pinned, private) = match credentials {
        Some((pinned, private)) => (Some(pinned), Some(private)),
        None => (None, None),
    };
    let result = client::connect_stream(
        Arc::new(client::Config {
            keepalive_interval: Some(policy.keepalive_interval),
            keepalive_max: policy.keepalive_max,
            ..Default::default()
        }),
        stream,
        Peer {
            key: pinned,
            offered: Some(offered.clone()),
            rejected: rejected.clone(),
        },
    )
    .await;
    let identity = offered
        .lock()
        .expect("SSH identity lock")
        .as_ref()
        .map(public_identity)
        .transpose()?;
    match (result, private) {
        (Err(_), None) => identity
            .map(|identity| (identity, None))
            .ok_or(SshError::Transport),
        (Err(_), Some(_)) => Err(if rejected.load(Ordering::Acquire) {
            SshError::PeerRejected
        } else {
            SshError::Transport
        }),
        (Ok(mut client), Some(private)) => {
            let result = async {
                authenticate(&mut client, user, private).await?;
                match preparation {
                    Some(action) => prepare_guest(&client, action).await.map(Some),
                    None => Ok(None),
                }
            }
            .await;
            let _ = client
                .disconnect(Disconnect::ByApplication, "Connection check finished", "")
                .await;
            let _ = client.await;
            let prepared = result?;
            identity
                .map(|identity| (identity, prepared))
                .ok_or(SshError::Protocol)
        }
        (Ok(client), None) => {
            let _ = client
                .disconnect(Disconnect::ByApplication, "Identity check finished", "")
                .await;
            let _ = client.await;
            Err(SshError::Protocol)
        }
    }
}

async fn prepare_guest(
    client: &Client,
    action: GuestPreparation,
) -> Result<crate::lan_setup::Preparation, SshError> {
    use crate::lan_setup::{quote, Preparation};
    let command = match &action {
        GuestPreparation::Stage(_) => crate::lan_setup::preflight(),
        GuestPreparation::Check => crate::lan_setup::check_command(),
    };
    let (status, output) = guest::collect(client, &format!("( {command} ) 2>&1"), &[]).await?;
    if status != 0 {
        return Ok(Preparation {
            command: None,
            installed: false,
            issue: Some(String::from_utf8_lossy(&output).trim().to_string()),
        });
    }
    let GuestPreparation::Stage(bundle) = action else {
        return Ok(Preparation {
            command: None,
            installed: true,
            issue: None,
        });
    };
    let upload = |name: &str, digest: &str| {
        format!("set -eu; umask 077; directory=\"{}\"; [ ! -L \"$directory\" ]; mkdir -p \"$directory\"; cat > \"$directory/{name}.part\"; printf '%s  %s\\n' {} \"$directory/{name}.part\" | sha256sum --check --status; mv \"$directory/{name}.part\" \"$directory/{name}\"", bundle.directory(), quote(digest))
    };
    for (path, name, digest) in &bundle.archives {
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|_| SshError::Protocol)?;
        let (status, output) =
            guest::collect_stream(client, &format!("( {} ) 2>&1", upload(name, digest)), file)
                .await?;
        if status != 0 {
            return Ok(Preparation {
                command: None,
                installed: false,
                issue: Some(format!(
                    "Guest archive upload failed: {}",
                    String::from_utf8_lossy(&output).trim()
                )),
            });
        }
    }
    let (status, output) = guest::collect(
        client,
        &format!(
            "( {} ) 2>&1",
            upload("install.sh", &bundle.installer_digest())
        ),
        &bundle.installer,
    )
    .await?;
    if status != 0 {
        return Ok(Preparation {
            command: None,
            installed: false,
            issue: Some(format!(
                "Guest installer upload failed: {}",
                String::from_utf8_lossy(&output).trim()
            )),
        });
    }
    Ok(Preparation {
        command: Some(bundle.command()),
        installed: false,
        issue: None,
    })
}

fn validate_credential_algorithm(private: &PrivateKey) -> Result<(), SshError> {
    if matches!(
        private.algorithm(),
        Algorithm::Ed25519 | Algorithm::Ecdsa { .. } | Algorithm::Rsa { .. }
    ) {
        Ok(())
    } else {
        Err(SshError::UnsupportedCredentialAlgorithm)
    }
}

/// Unlock an OpenSSH key once; only its normalized key enters secure storage.
pub async fn import_ssh_key(
    vault: &dyn Vault,
    key: Secret,
    passphrase: Option<Secret>,
) -> Result<ImportedSshKey, SshError> {
    let (public_key, normalized) = prepare_ssh_key(key, passphrase).await?;
    let credential_ref = VaultCredentialRef::new();
    vault
        .put(credential_ref.as_uuid(), normalized)
        .await
        .map_err(SshError::Vault)?;
    Ok(ImportedSshKey {
        credential_ref,
        public_key,
    })
}

/// Validate and normalize before the owning workspace transaction writes the vault.
pub(crate) async fn prepare_ssh_key(
    key: Secret,
    passphrase: Option<Secret>,
) -> Result<(SshHostPublicKey, Secret), SshError> {
    tokio::task::spawn_blocking(move || {
        // Parse the OpenSSH envelope before distinguishing missing/wrong passwords.
        let mut private = PrivateKey::from_openssh(key.expose_secret())
            .map_err(|_| SshError::InvalidCredential)?;
        validate_credential_algorithm(&private)?;
        if private.is_encrypted() {
            let passphrase = passphrase.as_ref().ok_or(SshError::PassphraseRequired)?;
            let password = std::str::from_utf8(passphrase.expose_secret())
                .map_err(|_| SshError::InvalidPassphrase)?;
            let encoded = std::str::from_utf8(key.expose_secret())
                .map_err(|_| SshError::InvalidCredential)?;
            private = russh::keys::decode_secret_key(encoded, Some(password))
                .map_err(|_| SshError::InvalidPassphrase)?;
        }
        // A key's free-form comment is not public connection metadata.
        private.set_comment("");
        let public = private
            .public_key()
            .to_openssh()
            .map_err(|_| SshError::InvalidCredential)?;
        let (algorithm, public_key) = public.split_once(' ').ok_or(SshError::InvalidCredential)?;
        let public_key = SshHostPublicKey {
            algorithm: algorithm.into(),
            public_key: public_key.into(),
        };
        public_key.validate()?;
        let normalized = private
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .map_err(|_| SshError::InvalidCredential)?;
        Ok::<_, SshError>((public_key, Secret::new(normalized.as_bytes().to_vec())))
    })
    .await
    .map_err(|_| SshError::ImportFailed)?
}

struct Peer {
    key: Option<PublicKey>,
    offered: Option<Arc<StdMutex<Option<PublicKey>>>>,
    rejected: Arc<AtomicBool>,
}

impl client::Handler for Peer {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        offered: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let accepted = match offered {
            PublicKeyOrCertificate::PublicKey { key, .. } => {
                if let Some(offered) = &self.offered {
                    *offered.lock().expect("SSH identity lock") = Some(key.clone());
                }
                self.key
                    .as_ref()
                    .is_some_and(|pinned| key.key_data() == pinned.key_data())
            }
            PublicKeyOrCertificate::Certificate(_) => false,
        };
        if !accepted {
            self.rejected.store(true, Ordering::Release);
        }
        Ok(accepted)
    }

    // The library's defaults accept several server-initiated channel kinds.
    // This owner never requests reverse forwarding, agent forwarding or X11.
    #[allow(clippy::too_many_arguments)]
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        _channel: Channel<client::Msg>,
        _address: &str,
        _port: u32,
        _origin: &str,
        _origin_port: u32,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    async fn server_channel_open_forwarded_streamlocal(
        &mut self,
        _channel: Channel<client::Msg>,
        _path: &str,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    async fn server_channel_open_agent_forward(
        &mut self,
        _channel: Channel<client::Msg>,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    async fn server_channel_open_session(
        &mut self,
        _channel: Channel<client::Msg>,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    async fn server_channel_open_direct_tcpip(
        &mut self,
        _channel: Channel<client::Msg>,
        _host: &str,
        _port: u32,
        _origin: &str,
        _origin_port: u32,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    async fn server_channel_open_direct_streamlocal(
        &mut self,
        _channel: Channel<client::Msg>,
        _path: &str,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    async fn server_channel_open_x11(
        &mut self,
        _channel: Channel<client::Msg>,
        _origin: &str,
        _port: u32,
        _reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

type Client = client::Handle<Peer>;

// Every shared client reference is a lease. Its release wakes the connection
// owner after dropping the reference, including cancelled request/view tasks.
struct ClientLease {
    client: Option<Arc<Client>>,
    released: Arc<Notify>,
}

impl Clone for ClientLease {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            released: self.released.clone(),
        }
    }
}

impl Deref for ClientLease {
    type Target = Client;
    fn deref(&self) -> &Client {
        self.client.as_deref().expect("live client lease")
    }
}

impl Drop for ClientLease {
    fn drop(&mut self) {
        drop(self.client.take());
        self.released.notify_one();
    }
}

/// Drop initiates shutdown; only `close().await` proves that owned tasks ended.
pub struct SshSession {
    hello: GuestHello,
    mcp: Mutex<Option<guest::Mcp>>,
    tools: Vec<DesktopTool>,
    shared: Arc<ConnectionOwner>,
    policy: SshPolicy,
}

impl fmt::Debug for SshSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshSession")
            .field("identity", &self.hello.identity)
            .field("closed", &self.shared.closed.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

struct ConnectionOwner {
    client: StdMutex<Option<ClientLease>>,
    socket: Arc<std::net::TcpStream>,
    shutdown: StdMutex<Option<oneshot::Sender<()>>>,
    owner: Mutex<Option<JoinHandle<Result<(), SshError>>>>,
    view: Mutex<Option<ViewTunnel>>,
    closed: AtomicBool,
    close_task: Mutex<Option<JoinHandle<Result<(), SshError>>>>,
    close_result: StdMutex<Option<Result<(), SshError>>>,
}

struct CancelConnect(Option<oneshot::Sender<()>>);
impl Drop for CancelConnect {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}

impl SshSession {
    /// Credentials are unencrypted OpenSSH key bytes loaded only from `vault`.
    pub async fn connect(
        connection: &SshConnection,
        expected: SessionIdentity,
        vault: &dyn Vault,
        policy: SshPolicy,
    ) -> Result<Self, SshError> {
        connection.endpoint.validate()?;
        connection.pinned_host_key.validate()?;
        connection.credential_ref.validate()?;
        expected.validate()?;
        if policy.connect_timeout.is_zero()
            || policy.keepalive_interval.is_zero()
            || policy.keepalive_max == 0
        {
            return Err(SshError::InvalidPolicy);
        }
        let public = format!(
            "{} {}",
            connection.pinned_host_key.algorithm, connection.pinned_host_key.public_key
        );
        let pinned = PublicKey::from_openssh(&public)
            .map_err(|_| SshError::Contract(ContractError::InvalidHostKey))?;
        let secret = vault
            .get(connection.credential_ref.as_uuid())
            .await
            .map_err(SshError::Vault)?
            .ok_or(SshError::MissingCredential)?;
        let private = PrivateKey::from_openssh(secret.expose_secret())
            .map_err(|_| SshError::InvalidCredential)?;
        if private.is_encrypted() {
            return Err(SshError::PassphraseRequired);
        }
        validate_credential_algorithm(&private)?;
        drop(secret);
        let connection = connection.clone();
        let (cancel, cancelled) = oneshot::channel();
        let mut cancellation = CancelConnect(Some(cancel));
        // The owner keeps the handshake future alive through socket shutdown.
        // Dropping a public connect future does not abandon russh's spawned KEX.
        let task = tokio::spawn(connect_owned(
            connection, expected, pinned, private, policy, cancelled,
        ));
        let result = task.await.map_err(|_| SshError::CleanupUnproven)?;
        cancellation.0.take();
        result
    }

    pub fn hello(&self) -> &GuestHello {
        &self.hello
    }

    fn client(&self) -> Result<ClientLease, SshError> {
        if self.shared.closed.load(Ordering::Acquire) {
            return Err(SshError::Closed);
        }
        let guard = self
            .shared
            .client
            .lock()
            .map_err(|_| SshError::CleanupUnproven)?;
        let client = guard.as_ref().ok_or(SshError::Closed)?;
        if client.is_closed() {
            return Err(SshError::Closed);
        }
        Ok(client.clone())
    }

    pub async fn request(&self, request: GuestRequest) -> Result<GuestReply, SshError> {
        request.validate(&self.hello)?;
        self.guest_request(&request).await
    }

    pub async fn ping(&self) -> Result<(), SshError> {
        let client = self.client()?;
        tokio::time::timeout(self.policy.connect_timeout, client.send_ping())
            .await
            .map_err(|_| SshError::TimedOut)?
            .map_err(|_| SshError::Transport)?;
        if client.is_closed() {
            return Err(SshError::Closed);
        }
        Ok(())
    }

    pub(crate) async fn media_token(&self) -> Result<String, SshError> {
        let client = self.client()?;
        tokio::time::timeout(
            self.policy.connect_timeout,
            guest::media_token(&client, self.hello.identity),
        )
        .await
        .map_err(|_| SshError::TimedOut)?
    }

    pub(crate) async fn open_view(&self) -> Result<SocketAddr, SshError> {
        let mut view = self.shared.view.lock().await;
        if view.is_some() {
            return Err(SshError::Protocol);
        }
        self.hello.validate(&self.hello.identity)?;
        if !self
            .hello
            .capabilities
            .contains(&GuestCapability::ViewTransport)
        {
            return Err(SshError::Contract(ContractError::CapabilityUnavailable));
        }
        let endpoint = self
            .hello
            .view
            .as_ref()
            .ok_or(SshError::Contract(ContractError::InvalidViewEndpoint))?;
        // This slice approves only the IPv4 guest-loopback view endpoint.
        if endpoint.host != IpAddr::V4(Ipv4Addr::LOCALHOST) {
            return Err(SshError::Contract(ContractError::InvalidViewEndpoint));
        }
        let client = self.client()?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| SshError::Transport)?;
        let address = listener.local_addr().map_err(|_| SshError::Transport)?;
        if self.shared.closed.load(Ordering::Acquire) {
            return Err(SshError::Closed);
        }
        let (stop, stopped) = watch::channel(false);
        let port = endpoint.port;
        let task = tokio::spawn(view_owner(listener, client, port, stopped));
        *view = Some(ViewTunnel {
            stop,
            task: Some(task),
        });
        Ok(address)
    }

    pub async fn close_view(&self) -> Result<(), SshError> {
        // Retain the view's join in shared state until it has been observed.
        // Cancellation of a caller cannot discard an in-flight teardown.
        let mut guard = self.shared.view.lock().await;
        if let Some(view) = guard.as_mut() {
            view.stop.send_replace(true);
            let result = view
                .task
                .as_mut()
                .ok_or(SshError::CleanupUnproven)?
                .await
                .map_err(|_| SshError::CleanupUnproven)
                .and_then(|value| value);
            guard.take();
            result?;
        }
        Ok(())
    }

    pub async fn close(&self) -> Result<(), SshError> {
        let mut task = self.shared.close_task.lock().await;
        if let Some(result) = *self
            .shared
            .close_result
            .lock()
            .map_err(|_| SshError::CleanupUnproven)?
        {
            return result;
        }
        if task.is_none() {
            self.shared.closed.store(true, Ordering::Release);
            let shared = self.shared.clone();
            *task = Some(tokio::spawn(close_owned(shared)));
        }
        let result = task
            .as_mut()
            .ok_or(SshError::CleanupUnproven)?
            .await
            .map_err(|_| SshError::CleanupUnproven)
            .and_then(|value| value);
        *self
            .shared
            .close_result
            .lock()
            .map_err(|_| SshError::CleanupUnproven)? = Some(result);
        task.take();
        result
    }
}

impl Drop for ConnectionOwner {
    fn drop(&mut self) {
        // No task is spawned from Drop, including after runtime destruction.
        self.view.get_mut().take();
        if let Ok(client) = self.client.get_mut() {
            client.take();
        }
        let _ = self.socket.shutdown(Shutdown::Both);
        if let Ok(shutdown) = self.shutdown.get_mut() {
            if let Some(shutdown) = shutdown.take() {
                let _ = shutdown.send(());
            }
        }
        // The already-created owner drains the session. Drop is not a join proof.
    }
}

async fn connect_owned(
    connection: SshConnection,
    expected: SessionIdentity,
    pinned: PublicKey,
    private: PrivateKey,
    policy: SshPolicy,
    mut cancelled: oneshot::Receiver<()>,
) -> Result<SshSession, SshError> {
    let deadline = tokio::time::Instant::now() + policy.connect_timeout;
    let stream = tokio::select! {
        result = TcpStream::connect((connection.endpoint.hostname.as_str(), connection.endpoint.port)) => result.map_err(|_| SshError::Transport)?,
        _ = &mut cancelled => return Err(SshError::Closed),
        _ = tokio::time::sleep_until(deadline) => return Err(SshError::TimedOut),
    };
    let standard = stream.into_std().map_err(|_| SshError::Transport)?;
    let socket = Arc::new(standard.try_clone().map_err(|_| SshError::Transport)?);
    let stream = TcpStream::from_std(standard).map_err(|_| SshError::Transport)?;
    let mut setup = Box::pin(establish(
        stream,
        socket.clone(),
        connection.endpoint.user,
        expected,
        pinned,
        private,
        policy,
    ));
    let interrupted = tokio::select! {
        result = &mut setup => return result,
        _ = &mut cancelled => SshError::Closed,
        _ = tokio::time::sleep_until(deadline) => SshError::TimedOut,
    };
    let _ = socket.shutdown(Shutdown::Both);
    // Await the SAME future; connect_stream may already own a spawned KEX task.
    if let Ok(session) = setup.await {
        session.close().await?;
    }
    Err(interrupted)
}

async fn authenticate(
    client: &mut client::Handle<Peer>,
    user: String,
    private: PrivateKey,
) -> Result<(), SshError> {
    let hash = if matches!(private.algorithm(), Algorithm::Rsa { .. }) {
        match client
            .best_supported_rsa_hash()
            .await
            .map_err(|_| SshError::Transport)?
        {
            Some(Some(hash)) => Some(hash),
            Some(None) => return Err(SshError::AuthenticationRejected),
            None => Some(HashAlg::Sha256),
        }
    } else {
        None
    };
    let auth = client
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(private), hash))
        .await
        .map_err(|_| SshError::Transport)?;
    if auth.success() {
        Ok(())
    } else {
        Err(SshError::AuthenticationRejected)
    }
}

async fn establish(
    stream: TcpStream,
    socket: Arc<std::net::TcpStream>,
    user: String,
    expected: SessionIdentity,
    pinned: PublicKey,
    private: PrivateKey,
    policy: SshPolicy,
) -> Result<SshSession, SshError> {
    let rejected = Arc::new(AtomicBool::new(false));
    let config = Arc::new(client::Config {
        keepalive_interval: Some(policy.keepalive_interval),
        keepalive_max: policy.keepalive_max,
        ..Default::default()
    });
    let mut client = client::connect_stream(
        config,
        stream,
        Peer {
            key: Some(pinned),
            offered: None,
            rejected: rejected.clone(),
        },
    )
    .await
    .map_err(|_| {
        if rejected.load(Ordering::Acquire) {
            SshError::PeerRejected
        } else {
            SshError::Transport
        }
    })?;
    let inspection = async {
        authenticate(&mut client, user, private).await?;
        guest::open(&client, expected).await
    }
    .await;
    let (mcp, hello, tools) = match inspection {
        Ok(ready) => ready,
        Err(error) => {
            let _ = socket.shutdown(Shutdown::Both);
            // Authentication/inspection failures retain the owned session join.
            let _ = client.await;
            return Err(error);
        }
    };
    let client = Arc::new(client);
    let owned = client.clone();
    let released = Arc::new(Notify::new());
    let owner_released = released.clone();
    let client = ClientLease {
        client: Some(client),
        released,
    };
    let shutdown_socket = socket.clone();
    let (shutdown, shutdown_requested) = oneshot::channel();
    let owner = tokio::spawn(async move {
        let _ = shutdown_requested.await;
        let graceful = tokio::time::timeout(
            policy.connect_timeout,
            owned.disconnect(
                Disconnect::ByApplication,
                "Workspace connection closed",
                "en",
            ),
        )
        .await;
        if !matches!(graceful, Ok(Ok(()))) {
            let _ = shutdown_socket.shutdown(Shutdown::Both);
        }
        let mut owned = owned;
        let client = loop {
            // Register before checking ownership. notify_one also preserves a
            // permit when the final lease drops before this future is polled.
            let release = owner_released.notified();
            match Arc::try_unwrap(owned) {
                Ok(client) => break client,
                Err(shared) => {
                    owned = shared;
                    release.await;
                }
            }
        };
        tokio::pin!(client);
        if tokio::time::timeout(policy.connect_timeout, &mut client)
            .await
            .is_err()
        {
            let _ = shutdown_socket.shutdown(Shutdown::Both);
            let _ = client.await;
        }
        // Both success and protocol error here mean the session task terminated.
        Ok(())
    });
    Ok(SshSession {
        hello,
        mcp: Mutex::new(Some(mcp)),
        tools,
        shared: Arc::new(ConnectionOwner {
            client: StdMutex::new(Some(client)),
            socket,
            shutdown: StdMutex::new(Some(shutdown)),
            owner: Mutex::new(Some(owner)),
            view: Mutex::new(None),
            closed: AtomicBool::new(false),
            close_task: Mutex::new(None),
            close_result: StdMutex::new(None),
        }),
        policy,
    })
}

async fn close_owned(shared: Arc<ConnectionOwner>) -> Result<(), SshError> {
    // Closing the socket first releases independently awaited worker channels;
    // their outcomes remain uncertain, not silently cancelled or replayed.
    let _ = shared.socket.shutdown(Shutdown::Both);
    let view_result = {
        let mut guard = shared.view.lock().await;
        if let Some(view) = guard.as_mut() {
            view.stop.send_replace(true);
            let result = match view.task.as_mut() {
                Some(task) => task
                    .await
                    .map_err(|_| SshError::CleanupUnproven)
                    .and_then(|value| value),
                None => Err(SshError::CleanupUnproven),
            };
            guard.take();
            result
        } else {
            Ok(())
        }
    };
    shared
        .client
        .lock()
        .map_err(|_| SshError::CleanupUnproven)?
        .take();
    if let Some(shutdown) = shared
        .shutdown
        .lock()
        .map_err(|_| SshError::CleanupUnproven)?
        .take()
    {
        let _ = shutdown.send(());
    }
    let result = shared
        .owner
        .lock()
        .await
        .take()
        .ok_or(SshError::CleanupUnproven)?
        .await
        .map_err(|_| SshError::CleanupUnproven)?;
    result?;
    // A transport error can be caused by this intentional socket shutdown.
    // It does not erase the observed joins; panic/unproven cleanup still fails.
    if view_result == Err(SshError::CleanupUnproven) {
        return view_result;
    }
    Ok(())
}

// Raw russh Channels do not close on Drop; its ChannelStream does. Preserve
// that close-on-drop behavior while awaiting exec acceptance as well.
struct OpeningChannel(Option<Channel<client::Msg>>);
impl Drop for OpeningChannel {
    fn drop(&mut self) {
        if let Some(channel) = self.0.take() {
            drop(channel.into_stream());
        }
    }
}

struct ViewTunnel {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<Result<(), SshError>>>,
}

impl Drop for ViewTunnel {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}

async fn view_owner(
    listener: TcpListener,
    client: ClientLease,
    guest_port: u16,
    mut stopped: watch::Receiver<bool>,
) -> Result<(), SshError> {
    let mut connections = JoinSet::new();
    let result = loop {
        if *stopped.borrow() {
            break Ok(());
        }
        tokio::select! {
            _ = stopped.changed() => break Ok(()),
            result = listener.accept() => {
                let (mut local, origin) = match result {
                    Ok(pair) => pair,
                    Err(_) => break Err(SshError::Transport),
                };
                let client = client.clone();
                connections.spawn(async move {
                    let channel = client.channel_open_direct_tcpip("127.0.0.1", u32::from(guest_port), origin.ip().to_string(), u32::from(origin.port())).await.map_err(|_| SshError::Transport)?;
                    let mut remote = channel.into_stream();
                    tokio::io::copy_bidirectional(&mut local, &mut remote).await.map_err(|_| SshError::Transport)?;
                    Ok::<(), SshError>(())
                });
            },
            result = connections.join_next(), if !connections.is_empty() => {
                match result {
                    Some(Ok(Ok(()))) => {},
                    _ => break Err(SshError::Transport),
                }
            },
        }
    };
    drop(listener);
    connections.abort_all();
    while let Some(result) = connections.join_next().await {
        if let Err(error) = result {
            if !error.is_cancelled() {
                return Err(SshError::CleanupUnproven);
            }
        }
    }
    result
}
