//! Actual SSH transport against a disposable, in-process guest; no desktop or sshd.
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gbot_service::api::Api;
use gbot_service::contract::*;
use gbot_service::service::{OperationState, ReviewReason, Service, ServiceError};
use gbot_service::ssh::{SshError, SshPolicy, SshSession};
use gbot_service::vault::{Secret, Vault, VaultFuture};
use gbot_service::workspace::{WorkspaceError, WorkspaceRuntime};
use hyper::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Body, Client, Request, StatusCode,
};
use russh::keys::{ssh_key::LineEnding, Algorithm, PrivateKey, PublicKey};
use russh::server::ChannelOpenHandle;
use russh::{server, Channel, ChannelId, Disconnect};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Notify};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

const USER: &str = "gbot-fixture";
const WAIT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct MemoryVault(Mutex<BTreeMap<Uuid, Vec<u8>>>);

impl Vault for MemoryVault {
    fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>> {
        Box::pin(async move {
            Ok(self
                .0
                .lock()
                .unwrap()
                .get(&reference)
                .cloned()
                .map(Secret::new))
        })
    }
    fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
        Box::pin(async move {
            self.0
                .lock()
                .unwrap()
                .insert(reference, secret.expose_secret().to_vec());
            Ok(())
        })
    }
    fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().remove(&reference);
            Ok(())
        })
    }
}

fn key() -> PrivateKey {
    PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519).unwrap()
}

fn pin(key: &PrivateKey) -> SshHostPublicKey {
    let public = key.public_key().to_openssh().unwrap();
    let mut fields = public.split_whitespace();
    SshHostPublicKey {
        algorithm: fields.next().unwrap().into(),
        public_key: fields.next().unwrap().into(),
    }
}

fn policy() -> SshPolicy {
    SshPolicy {
        connect_timeout: WAIT,
        keepalive_interval: Duration::from_millis(100),
        keepalive_max: 3,
    }
}

type Tasks = Arc<Mutex<Vec<JoinHandle<()>>>>;
type Cancel = oneshot::Sender<oneshot::Sender<()>>;

struct Guest {
    root: PathBuf,
    hello: GuestHello,
    states: Mutex<BTreeMap<OperationId, GuestOperationState>>,
    dispatches: Mutex<BTreeMap<OperationId, usize>>,
    cancel: Mutex<BTreeMap<OperationId, Cancel>>,
    started: Notify,
    lose_reply: Mutex<Option<OperationId>>,
    tasks: Tasks,
}

fn failure(message: impl Into<String>) -> GuestError {
    GuestError {
        code: GuestErrorCode::Failed,
        message: message.into(),
    }
}

impl Guest {
    fn path(&self, path: &GuestPath) -> Result<PathBuf, GuestError> {
        let path = PathBuf::from(&path.0);
        if !path.starts_with(&self.root)
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(failure("fixture accepts only its generated paths"));
        }
        Ok(path)
    }

    async fn perform(&self, request: &GuestRequest) -> Result<GuestResult, GuestError> {
        match &request.operation {
            GuestOperationKind::Write {
                path,
                offset,
                data,
                truncate,
            } => {
                let mut file = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(*truncate)
                    .open(self.path(path)?)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                file.seek(std::io::SeekFrom::Start(*offset))
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                file.write_all(data)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                Ok(GuestResult::Written {
                    bytes_written: data.len() as u64,
                })
            }
            GuestOperationKind::Read {
                path,
                offset,
                length,
            } => {
                let mut file = tokio::fs::File::open(self.path(path)?)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                file.seek(std::io::SeekFrom::Start(*offset))
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                let mut data = Vec::new();
                file.take(*length)
                    .read_to_end(&mut data)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                Ok(GuestResult::Read { data })
            }
            GuestOperationKind::Exec {
                program,
                args,
                cwd,
                env,
            } => {
                if program != "/bin/sh" {
                    return Err(failure("fixture runs only its generated shell scripts"));
                }
                let mut child = tokio::process::Command::new(program)
                    .args(args)
                    .current_dir(self.path(cwd)?)
                    .envs(env)
                    .kill_on_drop(true)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .map_err(|e| failure(e.to_string()))?;
                let mut stdout = child.stdout.take().unwrap();
                let mut stderr = child.stderr.take().unwrap();
                let (cancel_tx, mut cancel_rx) = oneshot::channel::<oneshot::Sender<()>>();
                self.cancel
                    .lock()
                    .unwrap()
                    .insert(request.operation_id, cancel_tx);
                self.started.notify_one();
                let status = tokio::select! {
                    status = child.wait() => status.map_err(|e| failure(e.to_string()))?,
                    ack = &mut cancel_rx => {
                        child.kill().await.map_err(|e| failure(e.to_string()))?;
                        child.wait().await.map_err(|e| failure(e.to_string()))?;
                        self.states.lock().unwrap().insert(request.operation_id, GuestOperationState::Cancelled);
                        if let Ok(ack) = ack { let _ = ack.send(()); }
                        return Err(GuestError { code: GuestErrorCode::Cancelled, message: "owned command cancelled".into() });
                    }
                };
                self.cancel.lock().unwrap().remove(&request.operation_id);
                let mut out = Vec::new();
                let mut err = Vec::new();
                stdout
                    .read_to_end(&mut out)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                stderr
                    .read_to_end(&mut err)
                    .await
                    .map_err(|e| failure(e.to_string()))?;
                Ok(GuestResult::ExecFinished {
                    exit_code: status.code().unwrap_or(-1),
                    stdout: out,
                    stderr: err,
                })
            }
            GuestOperationKind::Status { operation_id } => Ok(GuestResult::Status {
                state: self
                    .states
                    .lock()
                    .unwrap()
                    .get(operation_id)
                    .cloned()
                    .unwrap_or(GuestOperationState::Unknown),
            }),
            GuestOperationKind::Cancel { operation_id } => {
                let cancel = self.cancel.lock().unwrap().remove(operation_id);
                if let Some(cancel) = cancel {
                    let (ack_tx, ack_rx) = oneshot::channel();
                    cancel
                        .send(ack_tx)
                        .map_err(|_| failure("command already exited"))?;
                    ack_rx
                        .await
                        .map_err(|_| failure("command cancellation was not reaped"))?;
                }
                Ok(GuestResult::Cancel {
                    state: self
                        .states
                        .lock()
                        .unwrap()
                        .get(operation_id)
                        .cloned()
                        .unwrap_or(GuestOperationState::Unknown),
                })
            }
        }
    }

    async fn reply(
        self: Arc<Self>,
        request: GuestRequest,
        channel: ChannelId,
        handle: server::Handle,
    ) {
        let result = self.perform(&request).await;
        let state = match &result {
            Ok(GuestResult::ExecFinished { exit_code, .. }) => GuestOperationState::Completed {
                exit_code: Some(*exit_code),
            },
            Ok(_) => GuestOperationState::Completed { exit_code: None },
            Err(error) if error.code == GuestErrorCode::Cancelled => GuestOperationState::Cancelled,
            Err(error) => GuestOperationState::Failed {
                error: error.clone(),
            },
        };
        self.states
            .lock()
            .unwrap()
            .insert(request.operation_id, state);
        if *self.lose_reply.lock().unwrap() == Some(request.operation_id) {
            // The guest effect completed, but its reply never reaches the service.
            let _ = handle.close(channel).await;
            return;
        }
        let reply = GuestReply {
            identity: request.identity,
            operation_id: request.operation_id,
            outcome: match result {
                Ok(result) => GuestOutcome::Success { result },
                Err(error) => GuestOutcome::Error { error },
            },
        };
        let mut bytes = serde_json::to_vec(&reply).unwrap();
        bytes.push(b'\n');
        let _ = handle.data(channel, bytes).await;
        let _ = handle.eof(channel).await;
        let _ = handle.exit_status_request(channel, 0).await;
        let _ = handle.close(channel).await;
    }
}

struct Peer {
    user_key: PublicKey,
    guest: Arc<Guest>,
    buffers: BTreeMap<ChannelId, Vec<u8>>,
}

impl server::Handler for Peer {
    type Error = russh::Error;

    async fn auth_publickey_offered(
        &mut self,
        user: &str,
        public_key: &PublicKey,
    ) -> Result<server::Auth, Self::Error> {
        Ok(if user == USER && public_key == &self.user_key {
            server::Auth::Accept
        } else {
            server::Auth::reject()
        })
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &PublicKey,
    ) -> Result<server::Auth, Self::Error> {
        self.auth_publickey_offered(user, public_key).await
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<server::Msg>,
        reply: ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.buffers.insert(channel.id(), Vec::new());
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        if data != b"gbot-guest --stdio" {
            return session.channel_failure(channel);
        }
        session.channel_success(channel)?;
        let mut hello = serde_json::to_vec(&self.guest.hello).unwrap();
        hello.push(b'\n');
        session.data(channel, hello)
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let Some(buffer) = self.buffers.get_mut(&channel) else {
            return Ok(());
        };
        buffer.extend_from_slice(data);
        let Some(end) = buffer.iter().position(|byte| *byte == b'\n') else {
            return Ok(());
        };
        let request: GuestRequest = serde_json::from_slice(&buffer[..end]).unwrap();
        request.validate(&self.guest.hello).unwrap();
        self.buffers.remove(&channel);
        assert_eq!(
            bufferless_dispatch(&self.guest, request.operation_id),
            1,
            "operation was redispatched"
        );
        self.guest
            .states
            .lock()
            .unwrap()
            .insert(request.operation_id, GuestOperationState::Running);
        let guest = self.guest.clone();
        let handle = session.handle();
        let task = tokio::spawn(async move { guest.reply(request, channel, handle).await });
        self.guest.tasks.lock().unwrap().push(task);
        Ok(())
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<server::Msg>,
        host: &str,
        port: u32,
        _: &str,
        _: u32,
        reply: ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let endpoint = self.guest.hello.view.as_ref().unwrap();
        if host != "127.0.0.1" || port != u32::from(endpoint.port) {
            reply
                .reject(russh::ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        let mut tcp = TcpStream::connect((endpoint.host, endpoint.port)).await?;
        reply.accept().await;
        let mut stream = channel.into_stream();
        let task = tokio::spawn(async move {
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
        });
        self.guest.tasks.lock().unwrap().push(task);
        Ok(())
    }
}

fn bufferless_dispatch(guest: &Guest, id: OperationId) -> usize {
    let mut dispatches = guest.dispatches.lock().unwrap();
    let count = dispatches.entry(id).or_default();
    *count += 1;
    *count
}

struct Fixture {
    directory: TempDir,
    address: SocketAddr,
    echo_address: SocketAddr,
    connection: SshConnection,
    vault: Arc<MemoryVault>,
    guest: Arc<Guest>,
    handles: Arc<Mutex<Vec<server::Handle>>>,
    accept: JoinHandle<()>,
    echo_accept: JoinHandle<()>,
}

impl Fixture {
    async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let echo_address = echo.local_addr().unwrap();
        let host_key = key();
        let user_key = key();
        let identity = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let connection = SshConnection {
            endpoint: SshEndpoint {
                hostname: address.ip().to_string(),
                port: address.port(),
                user: USER.into(),
            },
            pinned_host_key: pin(&host_key),
            credential_ref: VaultCredentialRef::new(),
        };
        let vault = Arc::new(MemoryVault::default());
        vault
            .put(
                connection.credential_ref.as_uuid(),
                Secret::new(
                    user_key
                        .to_openssh(LineEnding::LF)
                        .unwrap()
                        .as_bytes()
                        .to_vec(),
                ),
            )
            .await
            .unwrap();
        let tasks: Tasks = Arc::default();
        let guest = Arc::new(Guest {
            root: directory.path().into(),
            hello: GuestHello {
                protocol_version: GUEST_PROTOCOL_VERSION,
                identity,
                capabilities: [
                    GuestCapability::Exec,
                    GuestCapability::Read,
                    GuestCapability::Write,
                    GuestCapability::Status,
                    GuestCapability::Cancel,
                    GuestCapability::ViewTransport,
                ]
                .into_iter()
                .collect(),
                view: Some(GuestViewEndpoint {
                    host: echo_address.ip(),
                    port: echo_address.port(),
                    session_id: identity.session_id,
                }),
            },
            states: Mutex::default(),
            dispatches: Mutex::default(),
            cancel: Mutex::default(),
            started: Notify::new(),
            lose_reply: Mutex::new(None),
            tasks: tasks.clone(),
        });
        let handles = Arc::new(Mutex::new(Vec::new()));
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            auth_rejection_time: Duration::from_millis(1),
            inactivity_timeout: Some(Duration::from_secs(10)),
            ..Default::default()
        });
        let accept = {
            let guest = guest.clone();
            let handles = handles.clone();
            let public_key = user_key.public_key().clone();
            tokio::spawn(async move {
                while let Ok((stream, _)) = listener.accept().await {
                    // Complete run_stream before accepting again so every live session is pinned.
                    let peer = Peer {
                        user_key: public_key.clone(),
                        guest: guest.clone(),
                        buffers: BTreeMap::new(),
                    };
                    let running = server::run_stream(config.clone(), stream, peer)
                        .await
                        .unwrap();
                    handles.lock().unwrap().push(running.handle());
                    guest.tasks.lock().unwrap().push(tokio::spawn(async move {
                        let _ = running.await;
                    }));
                }
            })
        };
        let echo_accept = tokio::spawn(async move {
            while let Ok((mut stream, _)) = echo.accept().await {
                let task = tokio::spawn(async move {
                    let (mut read, mut write) = stream.split();
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                });
                tasks.lock().unwrap().push(task);
            }
        });
        Self {
            directory,
            address,
            echo_address,
            connection,
            vault,
            guest,
            handles,
            accept,
            echo_accept,
        }
    }

    async fn connect(&self) -> SshSession {
        SshSession::connect(
            &self.connection,
            self.guest.hello.identity,
            self.vault.as_ref(),
            policy(),
        )
        .await
        .unwrap()
    }

    fn request(&self, operation: GuestOperationKind) -> GuestRequest {
        GuestRequest {
            identity: self.guest.hello.identity,
            operation_id: OperationId::new(),
            operation,
        }
    }

    async fn runtime(&self, service: Arc<Service>) -> Arc<WorkspaceRuntime> {
        let runtime = Arc::new(WorkspaceRuntime::new(service, self.vault.clone()));
        runtime
            .register_workspace(WorkspaceConfig {
                id: self.guest.hello.identity.workspace_id,
                name: "Disposable SSH guest".into(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::Lan {
                    computer_id: Uuid::new_v4(),
                },
                connection: WorkspaceConnection::Ssh(self.connection.clone()),
            })
            .await
            .unwrap();
        runtime
    }

    fn path(&self, name: &str) -> GuestPath {
        GuestPath(self.directory.path().join(name).to_str().unwrap().into())
    }

    async fn script(&self, name: &str, body: &str) -> GuestRequest {
        let path = self.directory.path().join(name);
        tokio::fs::write(&path, body).await.unwrap();
        self.request(GuestOperationKind::Exec {
            program: "/bin/sh".into(),
            args: vec![path.to_str().unwrap().into()],
            cwd: self.path(""),
            env: BTreeMap::new(),
        })
    }

    async fn shutdown(&self) {
        self.accept.abort();
        self.echo_accept.abort();
        // Await aborted listeners before snapshotting their child sessions/tasks.
        while !self.accept.is_finished() || !self.echo_accept.is_finished() {
            tokio::task::yield_now().await;
        }
        let handles = self.handles.lock().unwrap().clone();
        for handle in handles {
            let _ = handle
                .disconnect(
                    Disconnect::ByApplication,
                    "fixture complete".into(),
                    "".into(),
                )
                .await;
        }
        loop {
            let tasks = std::mem::take(&mut *self.guest.tasks.lock().unwrap());
            if tasks.is_empty() {
                break;
            }
            for task in tasks {
                timeout(WAIT, task)
                    .await
                    .expect("owned fixture task survived shutdown")
                    .unwrap();
            }
        }
        assert!(TcpStream::connect(self.address).await.is_err());
        assert!(TcpStream::connect(self.echo_address).await.is_err());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.accept.abort();
        self.echo_accept.abort();
        for task in self.guest.tasks.lock().unwrap().iter() {
            task.abort();
        }
        // The explicit shutdown path awaits every RunningSession; this also handles a test panic.
        for handle in self.handles.lock().unwrap().clone() {
            tokio::spawn(async move {
                let _ = handle
                    .disconnect(
                        Disconnect::ByApplication,
                        "fixture dropped".into(),
                        "".into(),
                    )
                    .await;
            });
        }
    }
}

fn success(reply: GuestReply) -> GuestResult {
    match reply.outcome {
        GuestOutcome::Success { result } => result,
        GuestOutcome::Error { error } => panic!("guest error: {error:?}"),
    }
}

#[tokio::test]
async fn vault_auth_file_command_keepalive_and_view_reconnect() {
    timeout(Duration::from_secs(30), async {
        let fixture = Fixture::new().await;
        let expected = fixture.guest.hello.identity;
        let mut wrong_pin = fixture.connection.clone();
        wrong_pin.pinned_host_key = pin(&key());
        assert!(matches!(
            SshSession::connect(&wrong_pin, expected, fixture.vault.as_ref(), policy()).await,
            Err(SshError::PeerRejected)
        ));
        let wrong_vault = MemoryVault::default();
        wrong_vault
            .put(
                fixture.connection.credential_ref.as_uuid(),
                Secret::new(
                    key()
                        .to_openssh(LineEnding::LF)
                        .unwrap()
                        .as_bytes()
                        .to_vec(),
                ),
            )
            .await
            .unwrap();
        assert!(matches!(
            SshSession::connect(&fixture.connection, expected, &wrong_vault, policy()).await,
            Err(SshError::AuthenticationRejected)
        ));
        assert!(matches!(
            SshSession::connect(
                &fixture.connection,
                expected,
                &MemoryVault::default(),
                policy()
            )
            .await,
            Err(SshError::MissingCredential)
        ));
        let changed_session = SessionIdentity {
            session_id: SessionId::new(),
            ..expected
        };
        assert!(matches!(
            SshSession::connect(
                &fixture.connection,
                changed_session,
                fixture.vault.as_ref(),
                policy()
            )
            .await,
            Err(SshError::Contract(ContractError::SessionMismatch))
        ));
        let session = fixture.connect().await;
        let mut wrong_identity = fixture.request(GuestOperationKind::Read {
            path: fixture.path("guest.txt"),
            offset: 0,
            length: 1,
        });
        wrong_identity.identity.workspace_id = WorkspaceId::new();
        assert!(matches!(
            session.request(wrong_identity).await,
            Err(SshError::Contract(ContractError::WorkspaceMismatch))
        ));
        session.close().await.unwrap();

        let service = Arc::new(
            Service::open(fixture.directory.path().join("service.json"))
                .await
                .unwrap(),
        );
        let runtime = fixture.runtime(service.clone()).await;
        assert_eq!(
            runtime.connect(expected).await.unwrap(),
            fixture.guest.hello
        );
        assert_eq!(
            success(
                runtime
                    .request(fixture.request(GuestOperationKind::Write {
                        path: fixture.path("guest.txt"),
                        offset: 0,
                        data: b"from guest".to_vec(),
                        truncate: true,
                    }))
                    .await
                    .unwrap()
            ),
            GuestResult::Written { bytes_written: 10 }
        );
        assert_eq!(
            success(
                runtime
                    .request(fixture.request(GuestOperationKind::Read {
                        path: fixture.path("guest.txt"),
                        offset: 5,
                        length: 5,
                    }))
                    .await
                    .unwrap()
            ),
            GuestResult::Read {
                data: b"guest".to_vec()
            }
        );
        assert_eq!(
            tokio::fs::read(fixture.directory.path().join("guest.txt"))
                .await
                .unwrap(),
            b"from guest"
        );
        let command = fixture
            .script("cwd.sh", "pwd\nprintf command > command.txt\n")
            .await;
        assert_eq!(
            success(runtime.request(command).await.unwrap()),
            GuestResult::ExecFinished {
                exit_code: 0,
                stdout: format!("{}\n", fixture.directory.path().display()).into_bytes(),
                stderr: Vec::new(),
            }
        );
        assert_eq!(
            tokio::fs::read(fixture.directory.path().join("command.txt"))
                .await
                .unwrap(),
            b"command"
        );
        assert!(service
            .snapshot()
            .await
            .operations
            .iter()
            .all(|op| op.state == OperationState::Completed));
        runtime.ping(expected).await.unwrap();

        let view = runtime.open_view(expected).await.unwrap();
        assert!(view.ip().is_loopback());
        let mut tcp = TcpStream::connect(view).await.unwrap();
        tcp.write_all(b"view through ssh").await.unwrap();
        let mut echo = [0; 16];
        timeout(WAIT, tcp.read_exact(&mut echo))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&echo, b"view through ssh");
        runtime.close_view(expected).await.unwrap();
        assert_eq!(
            timeout(WAIT, tcp.read(&mut echo)).await.unwrap().unwrap(),
            0
        );
        assert!(TcpStream::connect(view).await.is_err());
        drop(tcp);
        runtime.disconnect(expected).await.unwrap();
        assert!(service.live_sessions().await.is_empty());
        assert_eq!(runtime.connect(expected).await.unwrap().identity, expected);
        runtime.ping(expected).await.unwrap();
        let view = runtime.open_view(expected).await.unwrap();
        let mut tcp = TcpStream::connect(view).await.unwrap();
        tcp.write_all(b"reconnected view").await.unwrap();
        timeout(WAIT, tcp.read_exact(&mut echo))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&echo, b"reconnected view");
        runtime.close().await.unwrap();
        assert_eq!(
            timeout(WAIT, tcp.read(&mut echo)).await.unwrap().unwrap(),
            0
        );
        assert!(TcpStream::connect(view).await.is_err());
        drop(tcp);

        // Exercise the authenticated HTTP routes against this same real SSH guest.
        let api = Api::bind(service.clone(), fixture.vault.clone(), 0)
            .await
            .unwrap();
        let endpoint = api.endpoint();
        let token = fixture
            .vault
            .get(service.snapshot().await.service_id)
            .await
            .unwrap()
            .unwrap();
        let mut bearer = b"Bearer ".to_vec();
        bearer.extend_from_slice(token.expose_secret());
        let mut authorization = HeaderValue::from_bytes(&bearer).unwrap();
        authorization.set_sensitive(true);
        let (stop, stopped) = oneshot::channel();
        let serving = tokio::spawn(api.serve(async move {
            let _ = stopped.await;
        }));
        let client = Client::new();
        let post = |path: &str, bytes: Vec<u8>| {
            Request::post(format!("http://{endpoint}{path}"))
                .header(AUTHORIZATION, authorization.clone())
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(bytes))
                .unwrap()
        };
        let response = client
            .request(post("/v1/connect", serde_json::to_vec(&expected).unwrap()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let hello: GuestHello =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        assert_eq!(hello, fixture.guest.hello);
        let command = fixture.script("http.sh", "printf http\n").await;
        let response = client
            .request(post(
                "/v1/operations",
                serde_json::to_vec(&command).unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let reply: GuestReply =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        reply.validate(&command).unwrap();
        assert_eq!(
            success(reply),
            GuestResult::ExecFinished {
                exit_code: 0,
                stdout: b"http".to_vec(),
                stderr: Vec::new(),
            }
        );
        drop(client);
        stop.send(()).unwrap();
        timeout(WAIT, serving).await.unwrap().unwrap().unwrap();
        assert!(service.live_sessions().await.is_empty());
        assert!(TcpStream::connect(endpoint).await.is_err());
        fixture.shutdown().await;
    })
    .await
    .expect("bounded loopback transport test timed out");
}

#[tokio::test]
async fn cancellation_and_lost_reply_reconcile_without_redispatch() {
    timeout(Duration::from_secs(30), async {
        let fixture = Fixture::new().await;
        let identity = fixture.guest.hello.identity;
        let state_path = fixture.directory.path().join("service.json");
        let service = Arc::new(Service::open(&state_path).await.unwrap());
        let runtime = fixture.runtime(service.clone()).await;
        runtime.connect(identity).await.unwrap();

        let delayed = fixture.script("delayed.sh", "exec sleep 30\n").await;
        let mut exec = Box::pin(runtime.request(delayed.clone()));
        tokio::select! {
            reply = &mut exec => panic!("delayed command returned before cancellation: {reply:?}"),
            _ = fixture.guest.started.notified() => {}
        }
        let status = fixture.request(GuestOperationKind::Status { operation_id: delayed.operation_id });
        assert_eq!(success(timeout(WAIT, runtime.request(status)).await.unwrap().unwrap()),
            GuestResult::Status { state: GuestOperationState::Running });
        let cancel = fixture.request(GuestOperationKind::Cancel { operation_id: delayed.operation_id });
        assert_eq!(success(timeout(WAIT, runtime.request(cancel)).await.unwrap().unwrap()),
            GuestResult::Cancel { state: GuestOperationState::Cancelled });
        assert!(matches!(timeout(WAIT, &mut exec).await.unwrap().unwrap().outcome,
            GuestOutcome::Error { error: GuestError { code: GuestErrorCode::Cancelled, .. } }));
        drop(exec);
        assert_eq!(service.snapshot().await.operations.iter().find(|op| op.id == delayed.operation_id).unwrap().state,
            OperationState::Cancelled);

        let effect = fixture.script("effect.sh", "printf once >> effect.txt\n").await;
        *fixture.guest.lose_reply.lock().unwrap() = Some(effect.operation_id);
        assert!(matches!(runtime.request(effect.clone()).await,
            Err(WorkspaceError::Transport(SshError::UncertainOutcome { operation_id })) if operation_id == effect.operation_id));
        assert_eq!(service.snapshot().await.operations.iter().find(|op| op.id == effect.operation_id).unwrap().state,
            OperationState::NeedsReview { reason: ReviewReason::OutcomeUnknown });
        runtime.close().await.unwrap();
        drop(runtime);
        drop(service);
        let reopened = Arc::new(Service::open(&state_path).await.unwrap());
        assert!(reopened.live_sessions().await.is_empty());
        assert_eq!(reopened.snapshot().await.operations.iter().find(|op| op.id == effect.operation_id).unwrap().state,
            OperationState::NeedsReview { reason: ReviewReason::OutcomeUnknown });
        let runtime = Arc::new(WorkspaceRuntime::new(reopened.clone(), fixture.vault.clone()));
        runtime.connect(identity).await.unwrap();
        assert!(matches!(runtime.request(effect.clone()).await,
            Err(WorkspaceError::State(ServiceError::DuplicateOperation))), "reopen must not replay the uncertain operation");
        let status = fixture.request(GuestOperationKind::Status { operation_id: effect.operation_id });
        assert_eq!(success(runtime.request(status).await.unwrap()),
            GuestResult::Status { state: GuestOperationState::Completed { exit_code: Some(0) } });
        assert_eq!(reopened.snapshot().await.operations.iter().find(|op| op.id == effect.operation_id).unwrap().state,
            OperationState::Completed);
        assert_eq!(tokio::fs::read(fixture.directory.path().join("effect.txt")).await.unwrap(), b"once");
        assert_eq!(fixture.guest.dispatches.lock().unwrap()[&effect.operation_id], 1);
        runtime.close().await.unwrap();
        fixture.shutdown().await;
    }).await.expect("bounded operation/recovery test timed out");
}
