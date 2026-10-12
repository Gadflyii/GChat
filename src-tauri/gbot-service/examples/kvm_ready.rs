//! Opt-in production-service gate against a dedicated guest and a booked model.
#[cfg(target_os = "linux")]
mod linux {
    use gbot_service::{
        contract::*,
        executor::{
            ApprovalFuture, Assignment, CuaTask, ExecutorProcesses, FunctionTool, ProcessSpec,
            ToolApproval, ToolBinding,
        },
        kvm::{GuestBinary, KvmSpec, KvmTools, PreparedVm, CUA_DRIVER_REVISION},
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
        net::{TcpStream, UnixListener},
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
            json!({"role":"system","content":"You operate a dedicated Linux bot computer through accessibility observations and real foreground input. Open Mousepad, type exactly one line: Hello from Gbot. Save it as /home/gbot/hello.txt. Use open_editor to launch it; all typing and saving must use desktop foreground input, never shell/file-writing. Inspect the window before actions and verify changes. get_window_state must use include_screenshot=false. Use element tokens from its current tree. You are text-only; do not request screenshots. The service owns session IDs. Finish only after saving."}),
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
                if data == b"Hello from Gbot." || data == b"Hello from Gbot.\n" =>
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
        if !service
            .snapshot()
            .await
            .workspaces
            .iter()
            .any(|w| w.id == identity.workspace_id)
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
            let log = tokio::fs::File::create(evidence.join("serial.log")).await?;
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
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(NativeVault),
        ));
        let result = async {
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
            let view = runtime.open_view(identity).await?;
            let mut stream = TcpStream::connect(view).await?;
            let mut version = [0u8; 12];
            stream.read_exact(&mut version).await?;
            if !version.starts_with(b"RFB ") {
                return Err("view channel is not RFB".into());
            }
            runtime.close_view(identity).await?;
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
        tokio::fs::create_dir_all(&evidence).await?;
        let record_path = evidence.join("controller.json");
        let record: GateRecord = if record_path.try_exists()? {
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
                browser_package: "firefox-esr".into(),
                driver: GuestBinary::CloudInitArchive {
                    path: archive,
                    sha256: digest,
                },
                driver_revision: CUA_DRIVER_REVISION.into(),
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
        let result =
            tokio::time::timeout(Duration::from_secs(1800), gate(&record, &evidence)).await;
        let stop = record.vm.force_stop(&KvmTools::default()).await;
        let passed = matches!(result, Ok(Ok(())));
        let cleanup = if passed {
            NativeVault.delete(record.credential_ref).await
        } else {
            Ok(())
        };
        tokio::fs::write(evidence.join("gate-result.json"),serde_json::to_vec_pretty(&json!({"pass":passed,"result":format!("{result:?}"),"stop":format!("{stop:?}"),"credential_cleanup":format!("{cleanup:?}"),"credential_retained":!passed,"vm_id":record.vm.spec.id,"scope":"ComputerAgent + production service + pinned Cua MCP + native vault + view + text-only desktop task and actual Cua task setup/evaluation; no performance/Vision claim"}))?).await?;
        stop?;
        cleanup?;
        result??;
        Ok(())
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
