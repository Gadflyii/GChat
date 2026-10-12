//! Opt-in production-service gate against a dedicated guest and a booked model.
#[cfg(target_os = "linux")]
mod linux {
    use gbot_service::{
        contract::*,
        executor::{
            ApprovalFuture, Assignment, CuaTask, ExecutorProcesses, FunctionTool, ProcessSpec,
            ToolApproval, ToolBinding,
        },
        kvm::{GuestBinary, KvmSpec, KvmTools, PreparedVm, VmState, CUA_DRIVER_REVISION},
        media::{CloseView, OpenView},
        service::Service,
        vault::{NativeVault, Secret, Vault},
        workspace::WorkspaceRuntime,
    };
    use hyper::{Body, Client, Request};
    use russh::keys::{PrivateKey, PublicKey};
    use serde_json::{json, Value};
    use std::{
        error::Error,
        path::{Path, PathBuf},
        process::Stdio,
        sync::Arc,
        time::Duration,
    };
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        net::UnixListener,
        process::Command,
    };
    use uuid::Uuid;
    type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;

    #[derive(serde::Serialize, serde::Deserialize)]
    struct GateRecord {
        vm: PreparedVm,
        credential_ref: Uuid,
        identity: SessionIdentity,
    }

    async fn guest_key(
        mut console: impl tokio::io::AsyncBufRead + Unpin,
        mut log: impl tokio::io::AsyncWrite + Unpin,
    ) -> Result<PublicKey> {
        let marker = b"GBOT_READY_KEY ";
        let mut line = Vec::new();
        loop {
            line.clear();
            if console.read_until(b'\n', &mut line).await? == 0 {
                return Err("guest console closed before Ready".into());
            }
            log.write_all(&line).await?;
            if let Some(offset) = line.windows(marker.len()).position(|part| part == marker) {
                log.flush().await?;
                let key = std::str::from_utf8(&line[offset + marker.len()..])?;
                return Ok(PublicKey::from_openssh(key.trim())?);
            }
        }
    }

    async fn ssh_started(
        mut console: impl tokio::io::AsyncBufRead + Unpin,
        mut log: impl tokio::io::AsyncWrite + Unpin,
    ) -> Result<()> {
        let mut line = Vec::new();
        loop {
            line.clear();
            if console.read_until(b'\n', &mut line).await? == 0 {
                return Err("guest console closed before SSH started".into());
            }
            log.write_all(&line).await?;
            if [b"Started ".as_slice(), b"ssh.service".as_slice()]
                .iter()
                .all(|marker| line.windows(marker.len()).any(|part| part == *marker))
            {
                log.flush().await?;
                return Ok(());
            }
        }
    }

    async fn operation(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        kind: GuestOperationKind,
    ) -> Result<GuestResult> {
        let reply = runtime
            .request(GuestRequest {
                identity,
                operation_id: OperationId::new(),
                operation: kind,
            })
            .await?;
        match reply.outcome {
            GuestOutcome::Success { result } => Ok(result),
            GuestOutcome::Error { error } => Err(format!("guest operation: {error:?}").into()),
        }
    }
    async fn desktop(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        name: &str,
        arguments: Value,
    ) -> Result<Value> {
        match operation(
            runtime,
            identity,
            GuestOperationKind::Desktop {
                tool: name.into(),
                arguments,
            },
        )
        .await?
        {
            GuestResult::Desktop { result } => Ok(result),
            _ => Err("unexpected desktop reply".into()),
        }
    }
    struct DedicatedApproval(SessionIdentity);

    // Minimal wire probe for the opt-in physical gate; no second viewer client.
    struct MediaProbe(hyper::upgrade::Upgraded);
    impl MediaProbe {
        async fn open(url: &str) -> Result<Self> {
            let request = Request::get(url.replacen("ws://", "http://", 1))
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())?;
            let response = Client::new().request(request).await?;
            if response.status() != hyper::StatusCode::SWITCHING_PROTOCOLS {
                return Err("media socket upgrade failed".into());
            }
            Ok(Self(hyper::upgrade::on(response).await?))
        }
        async fn send(&mut self, opcode: u8, data: &[u8]) -> Result<()> {
            let mask = [17, 43, 91, 7];
            let mut frame = vec![0x80 | opcode];
            if data.len() < 126 {
                frame.push(0x80 | data.len() as u8);
            } else {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&u16::try_from(data.len())?.to_be_bytes());
            }
            frame.extend_from_slice(&mask);
            frame.extend(data.iter().enumerate().map(|(i, byte)| byte ^ mask[i % 4]));
            self.0.write_all(&frame).await?;
            Ok(())
        }
        async fn next(&mut self) -> Result<(u8, Vec<u8>)> {
            loop {
                let mut header = [0; 2];
                self.0.read_exact(&mut header).await?;
                if header[0] & 0x80 == 0 || header[1] & 0x80 != 0 {
                    return Err("unexpected fragmented/masked server frame".into());
                }
                let size = match header[1] & 127 {
                    126 => u64::from(self.0.read_u16().await?),
                    127 => self.0.read_u64().await?,
                    n => u64::from(n),
                };
                if size > 32 * 1024 * 1024 {
                    return Err("physical probe frame too large".into());
                }
                let mut data = vec![0; usize::try_from(size)?];
                self.0.read_exact(&mut data).await?;
                let opcode = header[0] & 15;
                if opcode == 9 {
                    self.send(10, &data).await?;
                } else {
                    return Ok((opcode, data));
                }
            }
        }
        async fn input(&mut self, session: &str) -> Result<Value> {
            self.send(
                1,
                &serde_json::to_vec(&json!({"type":"interactive_input","payload":{
                "session_id":session,"first_sequence":1,"events":[{"kind":"pointer","phase":"move",
                "button":null,"x_normalized":0.5,"y_normalized":0.5,"modifiers":[]}]}}))?,
            )
            .await?;
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let (kind, bytes) = self.next().await?;
                    if kind == 1 {
                        let value: Value = serde_json::from_slice(&bytes)?;
                        if value["type"] == "interactive_input_acknowledgement"
                            || value["type"] == "error"
                        {
                            return Ok(value);
                        }
                    }
                    if kind == 8 {
                        return Err("input socket closed".into());
                    }
                }
            })
            .await?
        }
    }

    fn video_frame(bytes: &[u8]) -> Result<(Value, &[u8])> {
        if bytes.len() < 8 {
            return Err("short video packet".into());
        }
        let header = usize::try_from(u32::from_be_bytes(bytes[..4].try_into()?))?;
        let payload = usize::try_from(u32::from_be_bytes(bytes[4..8].try_into()?))?;
        if 8 + header + payload != bytes.len() {
            return Err("video frame lengths differ".into());
        }
        let envelope: Value = serde_json::from_slice(&bytes[8..8 + header])?;
        if envelope["direction"] != "video" || !envelope["message"].is_object() {
            return Err(format!("unexpected video envelope: {envelope}").into());
        }
        Ok((envelope["message"].clone(), &bytes[8 + header..]))
    }

    async fn physical_media(
        runtime: &Arc<WorkspaceRuntime>,
        identity: SessionIdentity,
        evidence: &Path,
    ) -> Result<()> {
        // The independent unit keeps playback alive after its launch command exits.
        let mut pcm = Vec::with_capacity(48000 * 4 * 8);
        for n in 0..48000 * 8 {
            let sample =
                ((n as f64 * std::f64::consts::TAU * 440.0 / 48000.0).sin() * 12000.0) as i16;
            pcm.extend_from_slice(&sample.to_le_bytes());
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        operation(
            runtime,
            identity,
            GuestOperationKind::Write {
                path: GuestPath("/home/gbot/tone.pcm".into()),
                offset: 0,
                data: pcm,
                truncate: true,
            },
        )
        .await?;
        let owner = Uuid::new_v4();
        let view = runtime
            .open_view(OpenView {
                identity,
                owner,
                interactive: false,
                audio: true,
                h264: false,
            })
            .await?;
        let mut socket = MediaProbe::open(&view.ws_url).await?;
        let played = operation(
            runtime,
            identity,
            GuestOperationKind::Exec {
                program: "/usr/local/bin/gbot-in-session".into(),
                args: vec![
                    "systemd-run".into(),
                    "--user".into(),
                    "--quiet".into(),
                    "--collect".into(),
                    "--unit=gbot-media-tone".into(),
                    "/usr/local/bin/gbot-in-session".into(),
                    "paplay".into(),
                    "--raw".into(),
                    "--format=s16le".into(),
                    "--rate=48000".into(),
                    "--channels=2".into(),
                    "/home/gbot/tone.pcm".into(),
                ],
                cwd: GuestPath("/home/gbot".into()),
                env: Default::default(),
            },
        )
        .await?;
        if !matches!(played, GuestResult::ExecFinished { exit_code: 0, .. }) {
            return Err("tone launch failed".into());
        }
        let mut session = String::new();
        let mut controls = Vec::new();
        let mut audio = Vec::new();
        let mut frame = None;
        tokio::time::timeout(Duration::from_secs(20), async {
            while frame.is_none() || audio.len() < 48000 * 4 * 3 || session.is_empty() {
                let (kind, bytes) = socket.next().await?;
                if kind == 1 {
                    let value: Value = serde_json::from_slice(&bytes)?;
                    if value["type"] == "session_opened" {
                        session = value["payload"]["session_id"]
                            .as_str()
                            .ok_or("media session id missing")?
                            .into();
                    }
                    controls.push(value);
                } else if kind == 2 && bytes.starts_with(b"RAU2") {
                    if bytes.len() < 24 {
                        return Err("short audio packet".into());
                    }
                    audio.extend_from_slice(&bytes[24..]);
                } else if kind == 2 && bytes.len() >= 8 {
                    let (descriptor, pixels) = video_frame(&bytes)?;
                    tokio::fs::write(
                        evidence.join("capture-frame.json"),
                        serde_json::to_vec_pretty(&descriptor)?,
                    )
                    .await?;
                    let filename = match descriptor["codec"].as_str() {
                        Some("png") if pixels.starts_with(b"\x89PNG\r\n\x1a\n") => "capture.png",
                        Some("bgra") => {
                            let width = descriptor["width_px"]
                                .as_u64()
                                .ok_or("capture width missing")?;
                            let height = descriptor["height_px"]
                                .as_u64()
                                .ok_or("capture height missing")?;
                            let expected = width
                                .checked_mul(height)
                                .and_then(|size| size.checked_mul(4));
                            if width == 0 || height == 0 || expected != Some(pixels.len() as u64) {
                                return Err("BGRA capture dimensions differ".into());
                            }
                            "capture.bgra"
                        }
                        _ => return Err("unexpected capture codec".into()),
                    };
                    tokio::fs::write(evidence.join(filename), pixels).await?;
                    frame = Some(descriptor);
                } else if kind == 8 {
                    return Err("capture socket closed".into());
                }
            }
            Ok::<(), Box<dyn Error + Send + Sync>>(())
        })
        .await??;
        let config = controls
            .iter()
            .find(|value| {
                value["type"] == "audio_config" && value["payload"]["direction"] == "down"
            })
            .ok_or("audio configuration missing")?;
        if config["payload"]["sample_rate_hz"] != 48000 || config["payload"]["channels"] != 2 {
            return Err("unexpected audio format".into());
        }
        let samples: Vec<f64> = audio
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f64::from(i16::from_le_bytes([bytes[0], bytes[1]])))
            .collect();
        let power = samples.iter().map(|n| n * n).sum::<f64>() / samples.len() as f64;
        let projection = |quadrature: bool| {
            samples
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    let angle = i as f64 * std::f64::consts::TAU * 440.0 / 48000.0;
                    n * if quadrature { angle.sin() } else { angle.cos() }
                })
                .sum::<f64>()
        };
        let tone_power = 2.0 * (projection(false).powi(2) + projection(true).powi(2))
            / (samples.len() as f64).powi(2);
        tokio::fs::write(evidence.join("capture.s16le"), &audio).await?;
        tokio::fs::write(
            evidence.join("capture-controls.json"),
            serde_json::to_vec_pretty(&controls)?,
        )
        .await?;
        if power < 10000.0 || tone_power / power < 0.5 {
            return Err(format!(
                "known audio tone not received: power={power}, fraction={}",
                tone_power / power
            )
            .into());
        }
        let refusal = socket.input(&session).await?;
        if refusal["payload"]["delivered"] == true
            || refusal["payload"]["error"].is_null() && refusal["type"] != "error"
        {
            return Err("view-only input was not rejected".into());
        }
        runtime
            .close_view(CloseView {
                identity,
                owner,
                lease_id: view.lease_id,
            })
            .await?;
        let taken = runtime.take_over(identity, owner).await?;
        let interactive = runtime
            .open_view(OpenView {
                identity,
                owner,
                interactive: true,
                audio: false,
                h264: false,
            })
            .await?;
        let mut human = MediaProbe::open(&interactive.ws_url).await?;
        let human_session = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let (kind, bytes) = human.next().await?;
                if kind == 1 {
                    let value: Value = serde_json::from_slice(&bytes)?;
                    if value["type"] == "session_opened" {
                        return Ok::<String, Box<dyn Error + Send + Sync>>(
                            value["payload"]["session_id"]
                                .as_str()
                                .ok_or("interactive session missing")?
                                .into(),
                        );
                    }
                }
            }
        })
        .await??;
        let delivered = human.input(&human_session).await?;
        if delivered["payload"]["delivered"] != true {
            return Err(format!("takeover input failed: {delivered}").into());
        }
        let returned = runtime.hand_back(identity, owner).await?;
        let closed = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match human.next().await {
                    Ok((8, _)) | Err(_) => return true,
                    _ => {}
                }
            }
        })
        .await?;
        tokio::fs::write(evidence.join("physical-media.json"), serde_json::to_vec_pretty(&json!({
            "frame":frame,"audio_bytes":audio.len(),"audio_rms":power.sqrt(),"tone_energy_fraction":tone_power/power,
            "view_only":refusal,"take_over":taken,"input":delivered,"hand_back":returned,"interactive_socket_revoked":closed,
            "scope":"dedicated Debian/Xvnc guest, PNG/BGRA capture + PCM desktop tone + control ownership; no Windows/M365 or browser playback claim"
        }))?).await?;
        println!("PHYSICAL_MEDIA_PASS");
        Ok(())
    }
    impl ToolApproval for DedicatedApproval {
        fn approve<'a>(&'a self, _: Uuid, request: &'a GuestRequest) -> ApprovalFuture<'a> {
            Box::pin(async move { request.identity == self.0 })
        }
    }
    async fn run_task(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        assignment: &Assignment,
        processes: &ExecutorProcesses,
        path: PathBuf,
        messages: Vec<Value>,
        tools: Vec<FunctionTool>,
    ) -> Result<()> {
        let mut task = if path.try_exists()? {
            let task = CuaTask::open(path).await?;
            if task.snapshot().identity != identity {
                return Err("saved task belongs to a different guest session".into());
            }
            task
        } else {
            CuaTask::create(path, identity, messages, tools).await?
        };
        let (_sender, receiver) = tokio::sync::watch::channel(false);
        task.run(
            runtime,
            &DedicatedApproval(identity),
            assignment,
            processes,
            receiver,
        )
        .await?;
        println!(
            "Cua task {} completed; {} model replies, {} receipts",
            task.snapshot().id,
            task.snapshot().model_replies.len(),
            task.snapshot().calls.len()
        );
        Ok(())
    }
    fn bench_output(result: GuestResult) -> Value {
        match result {
            GuestResult::ExecFinished {
                exit_code,
                stdout,
                stderr,
            } => {
                json!({"exit_code":exit_code,"stdout":String::from_utf8_lossy(&stdout),"stderr":String::from_utf8_lossy(&stderr)})
            }
            other => serde_json::to_value(other).expect("guest result is serializable"),
        }
    }
    async fn bench_task(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        assignment: &Assignment,
        processes: &ExecutorProcesses,
        evidence: &Path,
        variant: u32,
    ) -> Result<()> {
        let evaluation = evidence.join(format!("bench-{variant}-evaluation.json"));
        if evaluation.try_exists()? {
            let saved: Value = serde_json::from_slice(&tokio::fs::read(evaluation).await?)?;
            if saved["rewards"] == json!([1.0]) {
                return Ok(());
            }
        }
        let resume = evidence
            .join(format!("bench-{variant}-task.json"))
            .try_exists()?;
        let root = std::env::var("GBOT_CUA_BENCH_ROOT")?;
        let mut child = Command::new(&processes.python.program)
            .args(&processes.python.args)
            .args(["-u", "-c", include_str!("cua-bench-session.py"), &root])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let result=async {
            let mut input=child.stdin.take().ok_or("missing benchmark input")?;
            let mut output=BufReader::new(child.stdout.take().ok_or("missing benchmark output")?).lines();
            input.write_all(format!("{}\n",json!({"variant":variant,"resume":resume})).as_bytes()).await?;input.flush().await?;
            loop {
                let event:Value=serde_json::from_str(&output.next_line().await?.ok_or("Cua benchmark exited")?)?;
                let value=match event["method"].as_str() {
                    Some("guest")=>bench_output(operation(runtime,identity,serde_json::from_value(event["payload"].clone())?).await?),
                    Some("ready")=> {
                        let tools=vec![FunctionTool {name:"run_command".into(),description:"Run a shell command on this dedicated Linux computer.".into(),parameters:json!({"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}),binding:ToolBinding::Shell {cwd:GuestPath("/tmp".into())}}];
                        run_task(runtime,identity,assignment,processes,evidence.join(format!("bench-{variant}-task.json")),
                            vec![json!({"role":"system","content":"Complete the user's task on the dedicated Linux computer using the available tools."}),json!({"role":"user","content":event["payload"]["description"]})],tools).await?;
                        Value::Null
                    },
                    Some("evaluation")=> {
                        tokio::fs::write(evidence.join(format!("bench-{variant}-evaluation.json")),serde_json::to_vec_pretty(&event["payload"])?).await?;
                        if event["payload"]["rewards"]!=json!([1.0]) { return Err("actual Cua evaluator rejected the model's answer".into()); }
                        input.write_all(b"{\"ok\":null}\n").await?;input.flush().await?;drop(input);
                        if !child.wait().await?.success() { return Err("Cua evaluator exited unsuccessfully".into()); }
                        println!("PASS: actual hello_file_env variant {variant} setup/model/evaluate");
                        return Ok(());
                    },
                    _=>return Err("invalid Cua benchmark message".into()),
                };
                input.write_all(format!("{}\n",json!({"ok":value})).as_bytes()).await?;input.flush().await?;
            }
        }.await;
        let _ = child.start_kill();
        let _ = child.wait().await;
        result
    }
    const DESKTOP_LINE: &str = "Hello from Gbot.";

    async fn model_task(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        url: &str,
        evidence: &Path,
    ) -> Result<()> {
        let api_key = std::env::var("GBOT_MODEL_API_KEY").ok();
        let mut builder = Request::get(format!("{}/v1/models", url.trim_end_matches('/')));
        if let Some(key) = &api_key {
            builder = builder.header("authorization", format!("Bearer {key}"));
        }
        let response = Client::new().request(builder.body(Body::empty())?).await?;
        let status = response.status();
        let bytes = hyper::body::to_bytes(response.into_body()).await?;
        tokio::fs::write(evidence.join("served-models.json"), &bytes).await?;
        if !status.is_success() {
            return Err(format!("model inventory HTTP {status}").into());
        }
        let models: Value = serde_json::from_slice(&bytes)?;
        let entries = models["data"].as_array().ok_or("missing model inventory")?;
        if entries.len() != 1 {
            return Err("the gate requires one served model".into());
        }
        let assignment = Assignment {
            api_base: format!("{}/v1", url.trim_end_matches('/')),
            api_key,
            model: entries[0]["id"]
                .as_str()
                .ok_or("missing model identity")?
                .into(),
            context_tokens: entries[0]["max_model_len"]
                .as_u64()
                .ok_or("missing context capacity")?,
        };
        let processes = ExecutorProcesses {
            python: ProcessSpec {
                program: std::env::var_os("GBOT_CUA_PYTHON")
                    .ok_or("pinned Cua Python launcher required")?
                    .into(),
                args: vec![],
            },
            context: ProcessSpec {
                program: "node".into(),
                args: vec![std::env::var("GBOT_CONTEXT_PREPARER")?],
            },
        };
        if std::env::var_os("GBOT_CUA_BENCH_ONLY").is_some() {
            for variant in 0..2 {
                bench_task(
                    runtime,
                    identity,
                    &assignment,
                    &processes,
                    evidence,
                    variant,
                )
                .await?;
            }
            return Ok(());
        }
        if std::env::var_os("GBOT_CUA_OVERWRITE_FIXTURE").is_some() {
            let previous = b"Hello from Gbot";
            let written = operation(
                runtime,
                identity,
                GuestOperationKind::Write {
                    path: GuestPath("/home/gbot/hello.txt".into()),
                    offset: 0,
                    data: previous.to_vec(),
                    truncate: true,
                },
            )
            .await?;
            let read = operation(
                runtime,
                identity,
                GuestOperationKind::Read {
                    path: GuestPath("/home/gbot/hello.txt".into()),
                    offset: 0,
                    length: 4096,
                },
            )
            .await?;
            tokio::fs::write(
                evidence.join("overwrite-precondition.json"),
                serde_json::to_vec_pretty(&json!({"written":written,"read":read}))?,
            )
            .await?;
            if !matches!(read, GuestResult::Read { data } if data == previous) {
                return Err("overwrite precondition did not match".into());
            }
        }
        let names = [
            "list_windows",
            "get_window_state",
            "type_text",
            "press_key",
            "hotkey",
            "click",
            "verify_state",
        ];
        let mut tools: Vec<_> = runtime
            .desktop_tools(identity)
            .await?
            .into_iter()
            .filter(|tool| names.contains(&tool.name.as_str()))
            .map(|tool| FunctionTool {
                binding: ToolBinding::Desktop {
                    name: tool.name.clone(),
                },
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            })
            .collect();
        tools.push(FunctionTool {name:"open_editor".into(),description:"Open Mousepad on the dedicated bot desktop. Use this once, then foreground input tools to type and save.".into(),parameters:json!({"type":"object","properties":{},"additionalProperties":false}),binding:ToolBinding::Fixed {operation:GuestOperationKind::Exec {program:"/usr/local/bin/gbot-in-session".into(),args:vec!["systemd-run".into(),"--user".into(),"--quiet".into(),"--collect".into(),"--unit=gbot-editor".into(),"/usr/local/bin/gbot-in-session".into(),"mousepad".into()],cwd:GuestPath("/home/gbot".into()),env:Default::default()}}});
        run_task(runtime,identity,&assignment,&processes,evidence.join("desktop-task.json"),vec![
            json!({"role":"system","content":format!("You operate a dedicated Linux bot computer through accessibility observations and real foreground input. Open Mousepad, type exactly the following line:\n```\n{}\n```\nSave it as /home/gbot/hello.txt. Use open_editor to launch it; all typing and saving must use desktop foreground input, never shell/file-writing. Inspect the window before actions and verify changes. get_window_state must use include_screenshot=false. Use element tokens from its current tree. You are text-only; do not request screenshots. The service owns session IDs. Finish only after saving.", DESKTOP_LINE)}),
            json!({"role":"user","content":"Please create the text file now."}),
        ],tools).await?;
        match operation(
            runtime,
            identity,
            GuestOperationKind::Read {
                path: GuestPath("/home/gbot/hello.txt".into()),
                offset: 0,
                length: 4096,
            },
        )
        .await?
        {
            GuestResult::Read { data }
                if data == DESKTOP_LINE.as_bytes()
                    || data.strip_suffix(b"\n") == Some(DESKTOP_LINE.as_bytes()) =>
            {
                tokio::fs::write(evidence.join("hello.txt"), data).await?;
                println!("PASS: ComputerAgent saved hello.txt; independent SSH readback matched");
            }
            other => {
                return Err(
                    format!("saved file did not match the requested line: {other:?}").into(),
                )
            }
        }
        if std::env::var_os("GBOT_CUA_DESKTOP_ONLY").is_some() {
            return Ok(());
        }
        for variant in 0..2 {
            bench_task(
                runtime,
                identity,
                &assignment,
                &processes,
                evidence,
                variant,
            )
            .await?;
        }
        Ok(())
    }
    async fn gate(record: &GateRecord, evidence: &Path) -> Result<()> {
        let vm = &record.vm;
        vm.start(&KvmTools::default()).await?;
        let service = Arc::new(Service::open(evidence.join("service.json")).await?);
        let identity = record.identity;
        let registered = service
            .snapshot()
            .await
            .workspaces
            .iter()
            .any(|w| w.id == identity.workspace_id);
        {
            let tty = Command::new("virsh")
                .args([
                    "--connect",
                    "qemu:///session",
                    "ttyconsole",
                    &vm.spec.id.to_string(),
                ])
                .output()
                .await?;
            if !tty.status.success() {
                return Err("owned guest console unavailable".into());
            }
            let tty = String::from_utf8(tty.stdout)?.trim().to_owned();
            if !Command::new("stty")
                .args(["-F", &tty, "raw", "-echo"])
                .status()
                .await?
                .success()
            {
                return Err("cannot read owned console".into());
            }
            let console = BufReader::new(tokio::fs::File::open(tty).await?);
            let log = tokio::fs::File::create(evidence.join(if registered {
                "resume-serial.log"
            } else {
                "serial.log"
            }))
            .await?;
            if registered {
                tokio::time::timeout(Duration::from_secs(180), ssh_started(console, log)).await??;
            } else {
                let key = guest_key(console, log).await?;
                let key = key.to_openssh()?;
                let mut fields = key.split_whitespace();
                service
                    .register_workspace(WorkspaceConfig {
                        id: identity.workspace_id,
                        name: "Dedicated Cua gate".into(),
                        service_pc: ServicePc::Local,
                        bot_pc: BotPc::LocalVm {
                            host_id: service.snapshot().await.service_id,
                            vm_id: vm.spec.id.to_string(),
                            hypervisor: Hypervisor::Kvm,
                        },
                        connection: WorkspaceConnection::Ssh(SshConnection {
                            endpoint: SshEndpoint {
                                hostname: "127.0.0.1".into(),
                                port: vm.spec.ssh_port,
                                user: "gbot".into(),
                            },
                            pinned_host_key: SshHostPublicKey {
                                algorithm: fields.next().ok_or("host algorithm missing")?.into(),
                                public_key: fields.next().ok_or("host key missing")?.into(),
                            },
                            credential_ref: VaultCredentialRef(record.credential_ref),
                        }),
                    })
                    .await?;
            }
        }
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(NativeVault),
        ));
        let result = async {
            println!("GUEST_SSH_READY");
            let hello = runtime.connect(identity).await?;
            tokio::fs::write(
                evidence.join("hello.json"),
                serde_json::to_vec_pretty(&hello)?,
            )
            .await?;
            let tools = runtime.desktop_tools(identity).await?;
            tokio::fs::write(
                evidence.join("tools.json"),
                serde_json::to_vec_pretty(&tools)?,
            )
            .await?;
            if std::env::var_os("GBOT_MEDIA_ONLY").is_some() {
                return physical_media(&runtime, identity, evidence).await;
            }
            let owner = Uuid::new_v4();
            let view = runtime
                .open_view(OpenView {
                    identity,
                    owner,
                    interactive: false,
                    audio: false,
                    h264: false,
                })
                .await?;
            let request = Request::get(view.ws_url.replacen("ws://", "http://", 1))
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())?;
            let response = Client::new().request(request).await?;
            if response.status() != hyper::StatusCode::SWITCHING_PROTOCOLS {
                return Err("media socket upgrade failed".into());
            }
            runtime
                .close_view(CloseView {
                    identity,
                    owner,
                    lease_id: view.lease_id,
                })
                .await?;
            let frame = desktop(&runtime, identity, "get_desktop_state", json!({})).await?;
            if frame["isError"] == true
                || !frame["content"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item["type"] == "image"))
            {
                return Err("no real desktop frame".into());
            }
            tokio::fs::write(
                evidence.join("desktop.json"),
                serde_json::to_vec_pretty(&frame)?,
            )
            .await?;
            if let Some(script) = std::env::var_os("GBOT_GUEST_DIAGNOSTIC") {
                let script = tokio::fs::read_to_string(script).await?;
                let reply = operation(
                    &runtime,
                    identity,
                    GuestOperationKind::Exec {
                        program: "/usr/local/bin/gbot-in-session".into(),
                        args: vec!["sh".into(), "-c".into(), script],
                        cwd: GuestPath("/home/gbot".into()),
                        env: Default::default(),
                    },
                )
                .await?;
                tokio::fs::write(
                    evidence.join("guest-diagnostic.json"),
                    serde_json::to_vec_pretty(&reply)?,
                )
                .await?;
                if !matches!(reply, GuestResult::ExecFinished { exit_code: 0, .. }) {
                    return Err(
                        "guest diagnostic did not exit successfully; see its receipt".into(),
                    );
                }
                println!("GUEST_DIAGNOSTIC_RECORDED");
                return Ok(());
            }
            let socket = evidence.join("model-start.sock");
            if socket.try_exists()? {
                tokio::fs::remove_file(&socket).await?;
            }
            let listener = UnixListener::bind(&socket)?;
            println!(
                "READY_FOR_MODEL {}",
                evidence.join("model-start.sock").display()
            );
            let (stream, _) = listener.accept().await?;
            let mut url = String::new();
            BufReader::new(stream).read_line(&mut url).await?;
            model_task(&runtime, identity, url.trim(), evidence).await
        }
        .await;
        if std::env::var_os("GBOT_MEDIA_ONLY").is_some() {
            // Preserve guest evidence while SSH and the native-vault key still exist.
            let diagnostics = operation(&runtime, identity, GuestOperationKind::Exec {
                program: "/usr/local/bin/gbot-in-session".into(),
                args: vec!["sh".into(), "-c".into(),
                    "systemctl --user status gbot-media --no-pager; journalctl --user -u gbot-media --no-pager -n 80; printf 'DISPLAY=%s\n' \"$DISPLAY\"; xdpyinfo | head -20; timeout 5 pactl info; timeout 5 pactl list short sources; systemctl --user status gbot-media-tone --no-pager; journalctl --user -u gbot-media-tone --no-pager -n 20; true".into()],
                cwd: GuestPath("/home/gbot".into()), env: Default::default(),
            });
            let diagnostics = tokio::time::timeout(Duration::from_secs(15), diagnostics).await;
            tokio::fs::write(
                evidence.join("media-diagnostic.json"),
                serde_json::to_vec_pretty(&match diagnostics {
                    Ok(Ok(reply)) => serde_json::to_value(reply)?,
                    other => json!({"diagnostic_error": format!("{other:?}")}),
                })?,
            )
            .await?;
        }
        let close = runtime.close().await;
        result?;
        close?;
        Ok(())
    }
    #[tokio::main]
    pub async fn run() -> Result<()> {
        let mut args = std::env::args_os().skip(1);
        let root = PathBuf::from(args.next().ok_or("VM root required")?);
        let image = PathBuf::from(args.next().ok_or("exact image required")?);
        let evidence = PathBuf::from(args.next().ok_or("private evidence folder required")?);
        let archive = PathBuf::from(args.next().ok_or("pinned driver archive required")?);
        let digest = args
            .next()
            .ok_or("driver archive SHA-256 required")?
            .into_string()
            .map_err(|_| "driver digest must be UTF-8")?;
        let media_archive = PathBuf::from(args.next().ok_or("pinned media archive required")?);
        let media_digest = args
            .next()
            .ok_or("media archive SHA-256 required")?
            .into_string()
            .map_err(|_| "media digest must be UTF-8")?;
        tokio::fs::create_dir_all(&evidence).await?;
        let record_path = evidence.join("controller.json");
        let mut record: GateRecord = if record_path.try_exists()? {
            let record: GateRecord = serde_json::from_slice(&tokio::fs::read(&record_path).await?)?;
            let vm = PreparedVm::open(&record.vm.directory).await?;
            if vm.spec.id != record.identity.workspace_id.0 {
                return Err("saved guest identity mismatch".into());
            }
            NativeVault
                .get(record.credential_ref)
                .await?
                .ok_or("saved guest credential unavailable; do not create a replacement guest")?;
            record
        } else {
            let reference = Uuid::new_v4();
            let private = PrivateKey::random(
                &mut russh::keys::key::safe_rng(),
                russh::keys::Algorithm::Ed25519,
            )?;
            let key = private.to_openssh(russh::keys::ssh_key::LineEnding::LF)?;
            NativeVault
                .put(reference, Secret::new(key.as_bytes().to_vec()))
                .await?;
            drop(key);
            drop(private);
            let saved = NativeVault
                .get(reference)
                .await?
                .ok_or("fixture credential missing")?;
            let private = PrivateKey::from_openssh(saved.expose_secret())?;
            drop(saved);
            let spec = KvmSpec {
                id: Uuid::new_v4(),
                cpus: 2,
                host_cpus: vec![112, 113],
                memory_mib: 4096,
                disk_gib: 40,
                ssh_port: 0,
                ssh_public_key: private.public_key().to_openssh()?,
                browser_package: "chromium".into(),
                driver: GuestBinary::SeedArchive {
                    path: archive,
                    sha256: digest,
                },
                driver_revision: CUA_DRIVER_REVISION.into(),
                media: GuestBinary::SeedArchive {
                    path: media_archive,
                    sha256: media_digest,
                },
                media_revision: gbot_service::kvm::CUA_REVISION.into(),
            };
            drop(private);
            let vm = match PreparedVm::prepare(&root, &image, spec, &KvmTools::default()).await {
                Ok(vm) => vm,
                Err(error) => {
                    NativeVault.delete(reference).await?;
                    return Err(error.into());
                }
            };
            tokio::fs::write(evidence.join("guest.json"), serde_json::to_vec_pretty(&vm)?).await?;
            let record = GateRecord {
                identity: SessionIdentity {
                    workspace_id: WorkspaceId(vm.spec.id),
                    session_id: SessionId::new(),
                },
                vm,
                credential_ref: reference,
            };
            tokio::fs::write(&record_path, serde_json::to_vec_pretty(&record)?).await?;
            record
        };
        if std::env::var_os("GBOT_RETIRE_ONLY").is_some() {
            record.vm.force_stop(&KvmTools::default()).await?;
            record.vm.unregister(&KvmTools::default()).await?;
            NativeVault.delete(record.credential_ref).await?;
            tokio::fs::write(
                evidence.join("retirement.json"),
                serde_json::to_vec_pretty(&json!({
                    "vm_id": record.vm.spec.id,
                    "directory": record.vm.directory,
                    "stopped": true,
                    "unregistered": true,
                    "credential_deleted": true,
                }))?,
            )
            .await?;
            println!("OWNED_GUEST_RETIRED");
            return Ok(());
        }
        // A boot starts a new desktop lifetime; keep its session on live reconnects.
        if record.vm.state(&KvmTools::default()).await? == VmState::Stopped {
            record.identity.session_id = SessionId::new();
            tokio::fs::write(&record_path, serde_json::to_vec_pretty(&record)?).await?;
        }
        let result =
            tokio::time::timeout(Duration::from_secs(1800), gate(&record, &evidence)).await;
        let tools = KvmTools::default();
        let stop = async {
            record.vm.shutdown(&tools).await?;
            tokio::time::timeout(Duration::from_secs(60), async {
                while record.vm.state(&tools).await? != VmState::Stopped {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Ok::<_, std::io::Error>(VmState::Stopped)
            })
            .await
            .map_err(std::io::Error::other)?
        }
        .await;
        let stop = match stop {
            Ok(state) => Ok(state),
            Err(_) => record.vm.force_stop(&tools).await,
        };
        let passed = matches!(result, Ok(Ok(())));
        let retained = !passed
            || std::env::var_os("GBOT_MEDIA_ONLY").is_some()
            || std::env::var_os("GBOT_GUEST_DIAGNOSTIC").is_some()
            || std::env::var_os("GBOT_CUA_BENCH_ONLY").is_some()
            || std::env::var_os("GBOT_CUA_DESKTOP_ONLY").is_some();
        let cleanup = if !retained {
            NativeVault.delete(record.credential_ref).await
        } else {
            Ok(())
        };
        tokio::fs::write(evidence.join("gate-result.json"),serde_json::to_vec_pretty(&json!({"pass":passed,"result":format!("{result:?}"),"stop":format!("{stop:?}"),"credential_cleanup":format!("{cleanup:?}"),"credential_retained":retained,"vm_id":record.vm.spec.id,"scope":if std::env::var_os("GBOT_MEDIA_ONLY").is_some() {"dedicated Debian/Xvnc guest, PNG/BGRA capture + PCM desktop tone + control ownership; no model, Windows/M365 or browser playback claim"} else if std::env::var_os("GBOT_GUEST_DIAGNOSTIC").is_some() {"dedicated guest geometry diagnosis; no model task"} else if std::env::var_os("GBOT_CUA_BENCH_ONLY").is_some() {"actual Cua hello_file_env variants only; desktop task acceptance remains separate"} else if std::env::var_os("GBOT_CUA_DESKTOP_ONLY").is_some() {"ComputerAgent + production service + pinned Cua MCP + native vault + view + exact text-only desktop overwrite task; existing Cua task acceptance reused; no performance/Vision claim"} else {"ComputerAgent + production service + pinned Cua MCP + native vault + view + text-only desktop task and actual Cua task setup/evaluation; no performance/Vision claim"}}))?).await?;
        stop?;
        cleanup?;
        result??;
        Ok(())
    }

    #[test]
    fn cua_video_envelope_exposes_descriptor_and_pixels() {
        let descriptor = json!({"codec":"bgra","width_px":2,"height_px":1});
        let header =
            serde_json::to_vec(&json!({"direction":"video","message":descriptor})).unwrap();
        let pixels = [0, 40, 80, 255, 80, 40, 0, 255];
        let mut packet = Vec::new();
        packet.extend_from_slice(&(header.len() as u32).to_be_bytes());
        packet.extend_from_slice(&(pixels.len() as u32).to_be_bytes());
        packet.extend_from_slice(&header);
        packet.extend_from_slice(&pixels);
        let (actual, payload) = video_frame(&packet).unwrap();
        assert_eq!(actual, descriptor);
        assert_eq!(payload, pixels);
        packet.pop();
        assert!(video_frame(&packet).is_err());
    }

    #[tokio::test]
    async fn ssh_readiness_waits_for_the_guest_service_start() {
        let boot = b"Starting ssh.service...\n[\x1b[0;32m OK \x1b[0m] Started \x1b[0;1;39mssh.service\x1b[0m - OpenBSD Secure Shell server.\n";
        let mut log = Vec::new();
        ssh_started(BufReader::new(boot.as_slice()), &mut log)
            .await
            .unwrap();
        assert_eq!(log, boot);
        assert!(ssh_started(BufReader::new(b"".as_slice()), &mut Vec::new())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn non_utf8_console_keeps_raw_bytes_and_verifies_host_key() {
        let private = PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let expected = private.public_key().to_openssh().unwrap();
        let mut input = b"boot \xff\xfe\n".to_vec();
        input.extend_from_slice(format!("GBOT_READY_KEY {expected}\r\n").as_bytes());
        let mut log = Vec::new();
        let key = guest_key(BufReader::new(input.as_slice()), &mut log)
            .await
            .unwrap();
        assert_eq!(key.to_openssh().unwrap(), expected);
        assert_eq!(log, input);
    }
}
#[cfg(target_os = "linux")]
fn main() -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    linux::run()
}
#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("Dedicated KVM guest gate requires Linux");
    std::process::exit(1);
}
