//! Pinned Cua MCP and independent SSH channels, with guest-owned receipts.
use super::*;
use crate::contract::{
    GuestError, GuestErrorCode, GuestOperationKind, GuestOperationState, GuestOutcome, GuestResult,
    GuestViewEndpoint, GUEST_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct DesktopTool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

pub(super) struct Mcp {
    stream: BufReader<russh::ChannelStream<client::Msg>>,
    next_id: u64,
    input: super::native::Input,
}

impl Mcp {
    async fn send(&mut self, value: Value) -> Result<(), SshError> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| SshError::Protocol)?;
        bytes.push(b'\n');
        self.stream
            .get_mut()
            .write_all(&bytes)
            .await
            .map_err(|_| SshError::Transport)?;
        self.stream
            .get_mut()
            .flush()
            .await
            .map_err(|_| SshError::Transport)
    }

    pub(super) async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, SshError> {
        self.next_id = self.next_id.checked_add(1).ok_or(SshError::Protocol)?;
        let id = self.next_id;
        self.send(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .await?;
        loop {
            let mut line = Vec::new();
            self.stream
                .read_until(b'\n', &mut line)
                .await
                .map_err(|_| SshError::Transport)?;
            if line.last() != Some(&b'\n') {
                return Err(SshError::Protocol);
            }
            let reply: Value = serde_json::from_slice(&line).map_err(|_| SshError::Protocol)?;
            if reply["jsonrpc"] != "2.0" {
                return Err(SshError::Protocol);
            }
            if reply.get("id").is_none() {
                continue;
            }
            if reply["id"] != id {
                return Err(SshError::Protocol);
            }
            if let Some(error) = reply.get("error") {
                // A JSON-RPC rejection is a known outcome, unlike a lost reply.
                return Ok(
                    json!({"isError":true,"content":[{"type":"text","text":error.to_string()}]}),
                );
            }
            return reply.get("result").cloned().ok_or(SshError::Protocol);
        }
    }
}

pub(super) async fn open(
    client: &Client,
    expected: SessionIdentity,
) -> Result<(Mcp, GuestHello, Vec<DesktopTool>), SshError> {
    check_session(client, expected).await?;
    let channel = open_exec(client, "/usr/local/bin/gbot-cua").await?;
    let mut mcp = Mcp {
        stream: BufReader::new(channel.into_stream()),
        next_id: 0,
        input: super::native::Input::default(),
    };
    let initialized = mcp.rpc("initialize", json!({"protocolVersion":"2025-06-18", "capabilities":{},"clientInfo":{"name":"gbot-service","version":env!("CARGO_PKG_VERSION")}})).await?;
    if initialized["serverInfo"]["name"] != "cua-driver"
        || initialized["serverInfo"]["version"] != "0.34.1"
        || initialized["protocolVersion"] != "2025-06-18"
    {
        return Err(SshError::Protocol);
    }
    mcp.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .await?;
    let mut tools = Vec::new();
    let mut cursor = None;
    loop {
        let params = cursor
            .as_ref()
            .map_or_else(|| json!({}), |cursor| json!({"cursor":cursor}));
        let listed = mcp.rpc("tools/list", params).await?;
        let mut page: Vec<DesktopTool> =
            serde_json::from_value(listed["tools"].clone()).map_err(|_| SshError::Protocol)?;
        for tool in &page {
            if tool.name.is_empty()
                || !tool.input_schema.is_object()
                || tools.iter().any(|old: &DesktopTool| old.name == tool.name)
            {
                return Err(SshError::Protocol);
            }
        }
        tools.append(&mut page);
        match listed.get("nextCursor") {
            None | Some(Value::Null) => break,
            Some(Value::String(next)) if !next.is_empty() && cursor.as_ref() != Some(next) => {
                cursor = Some(next.clone())
            }
            _ => return Err(SshError::Protocol),
        }
    }
    if !tools.iter().any(|tool| tool.name == "get_window_state")
        || !tools.iter().any(|tool| tool.name == "click")
        || !tools.iter().any(|tool| tool.name == "start_session")
    {
        return Err(SshError::Protocol);
    }
    let hello = GuestHello {
        protocol_version: GUEST_PROTOCOL_VERSION,
        identity: expected,
        capabilities: [
            GuestCapability::Exec,
            GuestCapability::Read,
            GuestCapability::Write,
            GuestCapability::Status,
            GuestCapability::Cancel,
            GuestCapability::DesktopCapture,
            GuestCapability::DesktopInput,
            GuestCapability::ViewTransport,
        ]
        .into(),
        view: Some(GuestViewEndpoint {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 3211,
            session_id: expected.session_id,
        }),
    };
    Ok((mcp, hello, super::native::catalog(tools)))
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) async fn media_token(
    client: &Client,
    identity: SessionIdentity,
) -> Result<String, SshError> {
    check_session(client, identity).await?;
    let (code, bytes) = collect(
        client,
        "head -c 257 \"$HOME/.local/state/gbot/media/token\"",
        &[],
    )
    .await?;
    let token = String::from_utf8(bytes).map_err(|_| SshError::Protocol)?;
    let token = token.trim();
    if code != 0
        || !(32..=256).contains(&token.len())
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(SshError::Protocol);
    }
    Ok(token.into())
}
fn command(
    mode: &str,
    identity: SessionIdentity,
    id: Option<OperationId>,
    args: &[String],
) -> String {
    let mut argv = vec![
        "/usr/local/bin/gbot-operation".into(),
        mode.into(),
        identity.workspace_id.as_uuid().to_string(),
        identity.session_id.as_uuid().to_string(),
    ];
    if let Some(id) = id {
        argv.push(id.as_uuid().to_string());
    }
    argv.extend_from_slice(args);
    argv.iter()
        .map(|arg| quote(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) async fn open_exec(
    client: &Client,
    command: &str,
) -> Result<Channel<client::Msg>, SshError> {
    let mut opening = OpeningChannel(Some(
        client
            .channel_open_session()
            .await
            .map_err(|_| SshError::Transport)?,
    ));
    let channel = opening.0.as_mut().ok_or(SshError::Protocol)?;
    channel
        .exec(true, command)
        .await
        .map_err(|_| SshError::Transport)?;
    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Success) => return opening.0.take().ok_or(SshError::Protocol),
            Some(russh::ChannelMsg::WindowAdjusted { .. }) => {}
            _ => return Err(SshError::Protocol),
        }
    }
}

struct CommandWrite(Option<russh::ChannelWriteHalf<client::Msg>>);
impl Drop for CommandWrite {
    fn drop(&mut self) {
        if let Some(write) = self.0.take() {
            tokio::spawn(async move {
                let _ = write.close().await;
            });
        }
    }
}

pub(super) async fn collect(
    client: &Client,
    command: &str,
    input: &[u8],
) -> Result<(u32, Vec<u8>), SshError> {
    collect_stream(client, command, input).await
}

pub(super) async fn collect_stream<R: tokio::io::AsyncRead + Unpin>(
    client: &Client,
    command: &str,
    input: R,
) -> Result<(u32, Vec<u8>), SshError> {
    let channel = open_exec(client, command).await?;
    let (mut read, write) = channel.split();
    let write = CommandWrite(Some(write));
    let write = &write;
    // Send input concurrently: writes and reads may both exceed SSH windows.
    let send = async {
        write
            .0
            .as_ref()
            .ok_or(SshError::Closed)?
            .data(input)
            .await
            .map_err(|_| SshError::Transport)?;
        write
            .0
            .as_ref()
            .ok_or(SshError::Closed)?
            .eof()
            .await
            .map_err(|_| SshError::Transport)
    };
    let receive = async {
        let mut bytes = Vec::new();
        let mut code = None;
        while let Some(message) = read.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => bytes.extend_from_slice(&data),
                russh::ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok((code.ok_or(SshError::Protocol)?, bytes))
    };
    let (_, result) = tokio::try_join!(send, receive)?;
    Ok(result)
}

pub(super) async fn check_session(
    client: &Client,
    identity: SessionIdentity,
) -> Result<(), SshError> {
    let (code, bytes) = collect(client, &command("hello", identity, None, &[]), &[]).await?;
    if code == 65 {
        return Err(SshError::Contract(ContractError::SessionMismatch));
    }
    if code != 0 {
        return Err(SshError::Protocol);
    }
    if bytes
        != format!(
            "GBOT-SSH-1\n{}\n{}\n",
            identity.workspace_id.as_uuid(),
            identity.session_id.as_uuid()
        )
        .as_bytes()
    {
        return Err(SshError::Protocol);
    }
    Ok(())
}

struct Receipt {
    state: GuestOperationState,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}
fn receipt(bytes: &[u8]) -> Result<Receipt, SshError> {
    let empty = |state| Receipt {
        state,
        stdout: Vec::new(),
        stderr: Vec::new(),
    };
    match bytes {
        b"running\n" => return Ok(empty(GuestOperationState::Running)),
        b"cancelled\n" => return Ok(empty(GuestOperationState::Cancelled)),
        b"unknown\n" => return Ok(empty(GuestOperationState::Unknown)),
        _ => {}
    }
    let mut fields = bytes.splitn(4, |byte| *byte == b'\n');
    if fields.next() != Some(b"completed".as_slice()) {
        return Err(SshError::Protocol);
    }
    let code = std::str::from_utf8(fields.next().ok_or(SshError::Protocol)?)
        .map_err(|_| SshError::Protocol)?
        .trim()
        .parse::<i32>()
        .map_err(|_| SshError::Protocol)?;
    let length = std::str::from_utf8(fields.next().ok_or(SshError::Protocol)?)
        .map_err(|_| SshError::Protocol)?
        .trim()
        .parse::<usize>()
        .map_err(|_| SshError::Protocol)?;
    let data = fields.next().ok_or(SshError::Protocol)?;
    if length > data.len() {
        return Err(SshError::Protocol);
    }
    Ok(Receipt {
        state: GuestOperationState::Completed {
            exit_code: Some(code),
        },
        stdout: data[..length].to_vec(),
        stderr: data[length..].to_vec(),
    })
}

impl SshSession {
    pub fn desktop_tools(&self) -> &[DesktopTool] {
        &self.tools
    }

    pub(super) async fn guest_request(
        &self,
        request: &GuestRequest,
    ) -> Result<GuestReply, SshError> {
        let client = self.client()?;
        check_session(&client, request.identity).await?;
        let uncertain = || SshError::UncertainOutcome {
            operation_id: request.operation_id,
        };
        let outcome = if let GuestOperationKind::Desktop { tool, arguments } = &request.operation {
            if !self.tools.iter().any(|definition| definition.name == *tool) {
                return Err(SshError::Contract(ContractError::CapabilityUnavailable));
            }
            let mut guard = self.mcp.lock().await;
            // A cancelled call discards its channel, including unread replies.
            let mut mcp = match guard.take() {
                Some(mcp) => mcp,
                None => open(&client, request.identity).await?.0,
            };
            let (code, claimed) = collect(
                &client,
                &command("desktop", request.identity, Some(request.operation_id), &[]),
                &[],
            )
            .await
            .map_err(|_| uncertain())?;
            if code != 0 || claimed != b"claimed\n" {
                return Err(uncertain());
            }
            let mut arguments = arguments.clone();
            // The service owns the Cua lifecycle label; models cannot cross sessions.
            if self
                .tools
                .iter()
                .find(|definition| definition.name == *tool)
                .is_some_and(|definition| {
                    definition.input_schema["properties"]
                        .get("session")
                        .is_some()
                })
            {
                arguments["session"] = request.identity.session_id.as_uuid().to_string().into();
            }
            // Cua expires idle sessions; renew before dispatch, never replay an action.
            let active = mcp
                .rpc(
                    "tools/call",
                    json!({"name":"start_session","arguments":{"session":request.identity.session_id.as_uuid().to_string()}}),
                )
                .await
                .map_err(|_| uncertain())?;
            let result = if active["isError"] == true {
                active
            } else if active["structuredContent"]["active"] != true {
                return Err(uncertain());
            } else {
                match mcp.input.prepare(tool, &arguments) {
                    Ok(native) => {
                        let result = mcp
                            .rpc("tools/call", json!({"name":tool,"arguments":native}))
                            .await
                            .map_err(|_| uncertain())?;
                        mcp.input.observe(tool, &result);
                        result
                    }
                    Err(refusal) => refusal,
                }
            };
            let status = if result["isError"] == true { "1" } else { "0" };
            let bytes = serde_json::to_vec(&result).map_err(|_| uncertain())?;
            let (code, saved) = collect(
                &client,
                &command(
                    "finish",
                    request.identity,
                    Some(request.operation_id),
                    &[status.into()],
                ),
                &bytes,
            )
            .await
            .map_err(|_| uncertain())?;
            let saved = receipt(&saved).map_err(|_| uncertain())?;
            if code != 0 || saved.stdout != bytes {
                return Err(uncertain());
            }
            *guard = Some(mcp);
            GuestOutcome::Success {
                result: GuestResult::Desktop { result },
            }
        } else {
            let (mode, target, args, input) = match &request.operation {
                GuestOperationKind::Exec {
                    program,
                    args,
                    cwd,
                    env,
                } => {
                    let mut arguments = vec![cwd.0.clone()];
                    arguments.extend(env.iter().map(|(key, value)| format!("{key}={value}")));
                    arguments.push(program.clone());
                    arguments.extend_from_slice(args);
                    ("exec", request.operation_id, arguments, &[][..])
                }
                GuestOperationKind::Read {
                    path,
                    offset,
                    length,
                } => (
                    "read",
                    request.operation_id,
                    vec![path.0.clone(), offset.to_string(), length.to_string()],
                    &[][..],
                ),
                GuestOperationKind::Write {
                    path,
                    offset,
                    data,
                    truncate,
                } => (
                    "write",
                    request.operation_id,
                    vec![path.0.clone(), offset.to_string(), truncate.to_string()],
                    data.as_slice(),
                ),
                GuestOperationKind::Status { operation_id } => {
                    ("status", *operation_id, vec![], &[][..])
                }
                GuestOperationKind::Cancel { operation_id } => {
                    ("cancel", *operation_id, vec![], &[][..])
                }
                GuestOperationKind::Desktop { .. } => unreachable!(),
            };
            let (code, bytes) = collect(
                &client,
                &command(mode, request.identity, Some(target), &args),
                input,
            )
            .await
            .map_err(|_| uncertain())?;
            if code != 0 {
                return Err(uncertain());
            }
            let received = receipt(&bytes).map_err(|_| uncertain())?;
            let result = match &request.operation {
                GuestOperationKind::Status { .. } => Some(GuestResult::Status {
                    state: received.state.clone(),
                }),
                GuestOperationKind::Cancel { .. } => Some(GuestResult::Cancel {
                    state: received.state.clone(),
                }),
                GuestOperationKind::Exec { .. } => match received.state {
                    GuestOperationState::Completed {
                        exit_code: Some(exit_code),
                    } => Some(GuestResult::ExecFinished {
                        exit_code,
                        stdout: received.stdout.clone(),
                        stderr: received.stderr.clone(),
                    }),
                    _ => None,
                },
                GuestOperationKind::Read { .. }
                    if received.state
                        == (GuestOperationState::Completed { exit_code: Some(0) }) =>
                {
                    Some(GuestResult::Read {
                        data: received.stdout.clone(),
                    })
                }
                GuestOperationKind::Write { data, .. }
                    if received.state
                        == (GuestOperationState::Completed { exit_code: Some(0) }) =>
                {
                    Some(GuestResult::Written {
                        bytes_written: data.len() as u64,
                    })
                }
                _ => None,
            };
            match result {
                Some(result) => GuestOutcome::Success { result },
                None => GuestOutcome::Error {
                    error: GuestError {
                        code: match received.state {
                            GuestOperationState::Cancelled => GuestErrorCode::Cancelled,
                            GuestOperationState::Completed { .. } => GuestErrorCode::Failed,
                            _ => GuestErrorCode::OutcomeUnknown,
                        },
                        message: String::from_utf8_lossy(&received.stderr).into_owned(),
                    },
                },
            }
        };
        let reply = GuestReply {
            identity: request.identity,
            operation_id: request.operation_id,
            outcome,
        };
        reply.validate(request).map_err(|_| uncertain())?;
        Ok(reply)
    }
}
