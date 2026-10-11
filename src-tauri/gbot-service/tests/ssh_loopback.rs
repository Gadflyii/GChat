//! Actual SSH transport against a disposable, in-process guest; no desktop or sshd.
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gbot_service::api::Api;
use gbot_service::contract::*;
use gbot_service::service::{OperationState, ReviewReason, Service, ServiceError};
use gbot_service::ssh::{import_ssh_key, SshError, SshPolicy, SshSession};
use gbot_service::vault::{Secret, Vault, VaultFuture};
use gbot_service::workspace::{WorkspaceError, WorkspaceRuntime};
use hyper::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Body, Client, Request, StatusCode,
};
use russh::keys::{ssh_key::LineEnding, Algorithm, HashAlg, PrivateKey, PublicKey};
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
    authenticated_algorithms: Mutex<Vec<Algorithm>>,
    tasks: Tasks,
    echo_address: SocketAddr,
    desktop_claim: Mutex<Option<OperationId>>,
    stale: std::sync::atomic::AtomicBool,
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
            GuestOperationKind::Desktop { .. } => unreachable!("desktop uses MCP"),
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
        let (state, stdout, stderr) = match result {
            Ok(GuestResult::ExecFinished {
                exit_code,
                stdout,
                stderr,
            }) => (
                GuestOperationState::Completed {
                    exit_code: Some(exit_code),
                },
                stdout,
                stderr,
            ),
            Ok(GuestResult::Read { data }) => (
                GuestOperationState::Completed { exit_code: Some(0) },
                data,
                vec![],
            ),
            Ok(GuestResult::Written { .. }) => (
                GuestOperationState::Completed { exit_code: Some(0) },
                vec![],
                vec![],
            ),
            Ok(GuestResult::Status { state } | GuestResult::Cancel { state }) => {
                (state, vec![], vec![])
            }
            Err(error) if error.code == GuestErrorCode::Cancelled => {
                (GuestOperationState::Cancelled, vec![], vec![])
            }
            Err(error) => (
                GuestOperationState::Completed { exit_code: Some(1) },
                vec![],
                error.message.into_bytes(),
            ),
            _ => unreachable!(),
        };
        if !matches!(
            request.operation,
            GuestOperationKind::Status { .. } | GuestOperationKind::Cancel { .. }
        ) {
            self.states
                .lock()
                .unwrap()
                .insert(request.operation_id, state.clone());
            let lose = {
                let mut loss = self.lose_reply.lock().unwrap();
                if *loss == Some(request.operation_id) {
                    loss.take();
                    true
                } else {
                    false
                }
            };
            if lose {
                let _ = handle.close(channel).await;
                return;
            }
        }
        send_receipt(&handle, channel, state, stdout, stderr).await;
    }
}

async fn send_receipt(
    handle: &server::Handle,
    channel: ChannelId,
    state: GuestOperationState,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
) {
    let mut bytes = match state {
        GuestOperationState::Completed { exit_code } => {
            format!("completed\n{}\n{}\n", exit_code.unwrap_or(0), stdout.len()).into_bytes()
        }
        GuestOperationState::Running => b"running\n".to_vec(),
        GuestOperationState::Cancelled => b"cancelled\n".to_vec(),
        _ => b"unknown\n".to_vec(),
    };
    bytes.extend(stdout);
    bytes.extend(stderr);
    let _ = handle.data(channel, bytes).await;
    let _ = handle.eof(channel).await;
    let _ = handle.exit_status_request(channel, 0).await;
    let _ = handle.close(channel).await;
}

enum Input {
    Mcp(Vec<u8>),
    Helper { args: Vec<String>, data: Vec<u8> },
}
struct Peer {
    user_key: PublicKey,
    guest: Arc<Guest>,
    buffers: BTreeMap<ChannelId, Input>,
}

// Decode the client's quoted argv without running a shell in the fixture.
fn argv(command: &str) -> Vec<String> {
    let mut words = vec![];
    let mut word = String::new();
    let mut quoted = false;
    let mut escape = false;
    for ch in command.chars() {
        if escape {
            word.push(ch);
            escape = false;
        } else if ch == '\\' && !quoted {
            escape = true;
        } else if ch == '\'' {
            quoted = !quoted;
        } else if ch.is_whitespace() && !quoted {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push(ch);
        }
    }
    assert!(!quoted && !escape);
    if !word.is_empty() {
        words.push(word);
    }
    words
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
        let accepted = self.auth_publickey_offered(user, public_key).await?;
        if accepted == server::Auth::Accept {
            self.guest
                .authenticated_algorithms
                .lock()
                .unwrap()
                .push(public_key.algorithm());
        }
        Ok(accepted)
    }
    async fn channel_open_session(
        &mut self,
        _: Channel<server::Msg>,
        reply: ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }
    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let args = argv(std::str::from_utf8(data).unwrap());
        let input = match args.first().map(String::as_str) {
            Some("/usr/local/bin/gbot-cua") => Input::Mcp(vec![]),
            Some("/usr/local/bin/gbot-operation") => Input::Helper { args, data: vec![] },
            _ => return session.channel_failure(channel),
        };
        self.buffers.insert(channel, input);
        session.channel_success(channel)
    }
    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let Some(input) = self.buffers.get_mut(&channel) else {
            return Ok(());
        };
        match input {
            Input::Helper { data: bytes, .. } => bytes.extend_from_slice(data),
            Input::Mcp(bytes) => {
                bytes.extend_from_slice(data);
                while let Some(end) = bytes.iter().position(|byte| *byte == b'\n') {
                    let request: serde_json::Value =
                        serde_json::from_slice(&bytes.drain(..=end).collect::<Vec<_>>()).unwrap();
                    let result = match request["method"].as_str().unwrap() {
                        "initialize" => {
                            serde_json::json!({"protocolVersion":"2025-06-18","serverInfo":{"name":"cua-driver","version":"0.34.1"},"capabilities":{"tools":{}}})
                        }
                        "notifications/initialized" => continue,
                        "tools/list" => serde_json::json!({"tools":[
                            {"name":"get_window_state","description":"Read accessible window","inputSchema":{"type":"object","properties":{"session":{"type":"string"}}}},
                            {"name":"invoke_menu","description":"Invoke accessible menu","inputSchema":{"type":"object","properties":{"session":{"type":"string"}}}}
                        ]}),
                        "tools/call" => {
                            assert_eq!(
                                request["params"]["arguments"]["session"],
                                self.guest.hello.identity.session_id.as_uuid().to_string()
                            );
                            let operation =
                                self.guest.desktop_claim.lock().unwrap().take().unwrap();
                            assert_eq!(bufferless_dispatch(&self.guest, operation), 1);
                            serde_json::json!({"isError":false,"content":[{"type":"text","text":"accessible result"}]})
                        }
                        _ => panic!("unexpected MCP method"),
                    };
                    let mut reply = serde_json::to_vec(
                        &serde_json::json!({"jsonrpc":"2.0","id":request["id"],"result":result}),
                    )
                    .unwrap();
                    reply.push(b'\n');
                    session.data(channel, reply)?;
                }
            }
        }
        Ok(())
    }
    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let Some(Input::Helper { args, data }) = self.buffers.remove(&channel) else {
            return Ok(());
        };
        let handle = session.handle();
        let guest = self.guest.clone();
        if args[1] == "hello" {
            if guest.stale.load(std::sync::atomic::Ordering::Acquire) {
                handle.exit_status_request(channel, 65).await?;
            } else {
                assert_eq!(
                    args[2],
                    guest.hello.identity.workspace_id.as_uuid().to_string()
                );
                assert_eq!(
                    args[3],
                    guest.hello.identity.session_id.as_uuid().to_string()
                );
                handle
                    .data(
                        channel,
                        format!("GBOT-SSH-1\n{}\n{}\n", args[2], args[3]).into_bytes(),
                    )
                    .await?;
                handle.exit_status_request(channel, 0).await?;
            }
            handle.eof(channel).await?;
            handle.close(channel).await?;
            return Ok(());
        }
        let id = OperationId(Uuid::parse_str(&args[4]).unwrap());
        if args[1] == "desktop" {
            assert!(guest
                .states
                .lock()
                .unwrap()
                .insert(id, GuestOperationState::Unknown)
                .is_none());
            *guest.desktop_claim.lock().unwrap() = Some(id);
            handle.data(channel, b"claimed\n".to_vec()).await?;
            handle.exit_status_request(channel, 0).await?;
            handle.eof(channel).await?;
            handle.close(channel).await?;
            return Ok(());
        }
        if args[1] == "finish" {
            let state = GuestOperationState::Completed {
                exit_code: Some(args[5].parse().unwrap()),
            };
            guest.states.lock().unwrap().insert(id, state.clone());
            send_receipt(&handle, channel, state, data, vec![]).await;
            return Ok(());
        }
        let operation = match args[1].as_str() {
            "exec" => {
                let mut tail = args[6..].iter();
                let mut env = BTreeMap::new();
                let mut program = tail.next().unwrap();
                while let Some((key, value)) = program.split_once('=') {
                    env.insert(key.into(), value.into());
                    program = tail.next().unwrap();
                }
                GuestOperationKind::Exec {
                    cwd: GuestPath(args[5].clone()),
                    program: program.clone(),
                    args: tail.cloned().collect(),
                    env,
                }
            }
            "read" => GuestOperationKind::Read {
                path: GuestPath(args[5].clone()),
                offset: args[6].parse().unwrap(),
                length: args[7].parse().unwrap(),
            },
            "write" => GuestOperationKind::Write {
                path: GuestPath(args[5].clone()),
                offset: args[6].parse().unwrap(),
                truncate: args[7].parse().unwrap(),
                data,
            },
            "status" => GuestOperationKind::Status { operation_id: id },
            "cancel" => GuestOperationKind::Cancel { operation_id: id },
            _ => panic!("unknown helper operation"),
        };
        let request = GuestRequest {
            identity: guest.hello.identity,
            operation_id: id,
            operation,
        };
        if !matches!(
            request.operation,
            GuestOperationKind::Status { .. } | GuestOperationKind::Cancel { .. }
        ) {
            assert_eq!(
                bufferless_dispatch(&guest, id),
                1,
                "operation was redispatched"
            );
            guest
                .states
                .lock()
                .unwrap()
                .insert(id, GuestOperationState::Running);
        }
        let task = tokio::spawn(async move {
            guest.reply(request, channel, handle).await;
        });
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
        if host != "127.0.0.1" || port != 5900 {
            reply
                .reject(russh::ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        let mut tcp = TcpStream::connect(self.guest.echo_address).await?;
        reply.accept().await;
        let mut stream = channel.into_stream();
        self.guest
            .tasks
            .lock()
            .unwrap()
            .push(tokio::spawn(async move {
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
            }));
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
        Self::with_user_key(key()).await
    }

    async fn with_user_key(user_key: PrivateKey) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let echo_address = echo.local_addr().unwrap();
        let host_key = key();
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
                    GuestCapability::DesktopCapture,
                    GuestCapability::DesktopInput,
                ]
                .into_iter()
                .collect(),
                view: Some(GuestViewEndpoint {
                    host: echo_address.ip(),
                    port: 5900,
                    session_id: identity.session_id,
                }),
            },
            states: Mutex::default(),
            dispatches: Mutex::default(),
            cancel: Mutex::default(),
            started: Notify::new(),
            lose_reply: Mutex::new(None),
            authenticated_algorithms: Mutex::default(),
            tasks: tasks.clone(),
            echo_address,
            desktop_claim: Mutex::new(None),
            stale: std::sync::atomic::AtomicBool::new(false),
        });
        let handles = Arc::new(Mutex::new(Vec::new()));
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            auth_rejection_time: Duration::from_millis(1),
            inactivity_timeout: Some(Duration::from_secs(10)),
            // Host identity remains Ed25519; RSA user-auth advertisement permits only SHA2.
            preferred: russh::Preferred {
                key: Cow::Owned(vec![
                    Algorithm::Ed25519,
                    Algorithm::Rsa {
                        hash: Some(HashAlg::Sha512),
                    },
                    Algorithm::Rsa {
                        hash: Some(HashAlg::Sha256),
                    },
                ]),
                ..Default::default()
            },
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
async fn encrypted_and_rsa_imports_authenticate_and_reconnect_without_passphrase() {
    // One 4096-bit RSA generation is shared by encrypted/plain cases. Keep it off
    // the async executor; the larger bound includes prime generation and bcrypt.
    timeout(Duration::from_secs(180), async {
        let rsa = tokio::task::spawn_blocking(|| {
            PrivateKey::random(
                &mut russh::keys::key::safe_rng(),
                Algorithm::Rsa { hash: None },
            )
            .unwrap()
        })
        .await
        .unwrap();
        for (user_key, encrypted) in [(key(), true), (rsa.clone(), true), (rsa, false)] {
            let fixture = Fixture::with_user_key(user_key.clone()).await;
            let passphrase = Uuid::new_v4().simple().to_string().into_bytes();
            let wrong_passphrase = Uuid::new_v4().simple().to_string().into_bytes();
            let imported_key = if encrypted {
                user_key
                    .encrypt(&mut russh::keys::key::safe_rng(), &passphrase)
                    .unwrap()
            } else {
                user_key.clone()
            };
            let encoded = imported_key.to_openssh(LineEnding::LF).unwrap();
            let before = fixture.vault.0.lock().unwrap().clone();
            if encrypted {
                assert!(matches!(
                    import_ssh_key(
                        fixture.vault.as_ref(),
                        Secret::new(encoded.as_bytes().to_vec()),
                        None
                    )
                    .await,
                    Err(SshError::PassphraseRequired)
                ));
                assert!(
                    *fixture.vault.0.lock().unwrap() == before,
                    "missing passphrase changed secure storage"
                );
                assert!(matches!(
                    import_ssh_key(
                        fixture.vault.as_ref(),
                        Secret::new(encoded.as_bytes().to_vec()),
                        Some(Secret::new(wrong_passphrase))
                    )
                    .await,
                    Err(SshError::InvalidPassphrase)
                ));
                assert!(
                    *fixture.vault.0.lock().unwrap() == before,
                    "wrong passphrase changed secure storage"
                );
            }
            let imported = import_ssh_key(
                fixture.vault.as_ref(),
                Secret::new(encoded.as_bytes().to_vec()),
                encrypted.then(|| Secret::new(passphrase.clone())),
            )
            .await
            .unwrap();
            drop(passphrase);
            assert!(imported.public_key == pin(&user_key));
            assert!(imported.credential_ref != fixture.connection.credential_ref);
            imported.credential_ref.validate().unwrap();
            assert_eq!(fixture.vault.0.lock().unwrap().len(), before.len() + 1);
            let stored = fixture
                .vault
                .get(imported.credential_ref.as_uuid())
                .await
                .unwrap()
                .unwrap();
            let parsed = PrivateKey::from_openssh(stored.expose_secret()).unwrap();
            assert!(
                !parsed.is_encrypted(),
                "import did not store a reconnectable key"
            );
            assert!(parsed.public_key() == user_key.public_key());
            let mut connection = fixture.connection.clone();
            connection.credential_ref = imported.credential_ref;
            for _ in 0..2 {
                // A fresh transport has only the imported vault reference, never a passphrase.
                let session = SshSession::connect(
                    &connection,
                    fixture.guest.hello.identity,
                    fixture.vault.as_ref(),
                    policy(),
                )
                .await
                .unwrap();
                assert_eq!(session.hello().identity, fixture.guest.hello.identity);
                session.ping().await.unwrap();
                session.close().await.unwrap();
            }
            let algorithms = fixture
                .guest
                .authenticated_algorithms
                .lock()
                .unwrap()
                .clone();
            assert_eq!(algorithms.len(), 2);
            assert!(algorithms
                .iter()
                .all(|algorithm| *algorithm == user_key.algorithm()));
            // For RSA this proves verified RSA authentication against SHA2-only
            // advertisement. The private wire hash is not exposed by Handler.
            fixture.shutdown().await;
        }
    })
    .await
    .expect("bounded generated SSH key import/authentication case timed out");
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
        assert_eq!(runtime.desktop_tools(expected).await.unwrap().len(), 2);
        let desktop = fixture.request(GuestOperationKind::Desktop { tool:"invoke_menu".into(),arguments:serde_json::json!({"session":"model-supplied-untrusted"}) });
        assert!(matches!(success(runtime.request(desktop).await.unwrap()),GuestResult::Desktop { result } if result["isError"] == false));

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
        fixture.guest.stale.store(true,std::sync::atomic::Ordering::Release);
        assert!(matches!(SshSession::connect(&fixture.connection,expected,fixture.vault.as_ref(),policy()).await, Err(SshError::Contract(ContractError::SessionMismatch))));
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
