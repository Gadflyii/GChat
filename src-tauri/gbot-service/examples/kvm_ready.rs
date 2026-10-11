//! Opt-in production-service gate against a dedicated guest and a booked model.
#[cfg(target_os = "linux")]
mod linux {
    use gbot_service::{
        contract::*,
        kvm::{GuestBinary, KvmSpec, KvmTools, PreparedVm, CUA_REVISION},
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
    fn text_only(mut result: Value) -> Value {
        if let Some(content) = result["content"].as_array_mut() {
            content.retain(|item| item["type"] != "image");
        }
        result
    }
    async fn model_task(
        runtime: &WorkspaceRuntime,
        identity: SessionIdentity,
        url: &str,
        evidence: &Path,
    ) -> Result<()> {
        let catalog = runtime.desktop_tools(identity).await?;
        let names = [
            "list_windows",
            "get_window_state",
            "invoke_menu",
            "type_text",
            "set_value",
            "press_key",
            "click",
            "verify_state",
        ];
        let mut tools: Vec<Value> = catalog.iter().filter(|tool| names.contains(&tool.name.as_str())).map(|tool|
            json!({"type":"function","function":{"name":tool.name,"description":tool.description,"parameters":tool.input_schema}})).collect();
        tools.push(json!({"type":"function","function":{"name":"open_editor","description":"Open Mousepad on the dedicated bot desktop. Use this once, then accessibility tools to type and save.","parameters":{"type":"object","properties":{},"additionalProperties":false}}}));
        let mut messages = vec![
            json!({"role":"system","content":"You operate a dedicated Linux bot computer through AT-SPI accessibility tools. Open Mousepad, type exactly one line: Hello from Gbot. Save it as /home/gbot/hello.txt. Use open_editor to launch it; all typing and saving must use desktop accessibility, never shell/file-writing. Inspect the window before actions and verify changes. get_window_state must use include_screenshot=false. Use element tokens from its current tree. You are text-only; do not request screenshots. The service owns session IDs. Finish only after saving."}),
            json!({"role":"user","content":"Please create the text file now."}),
        ];
        let client = Client::new();
        let mut turn = 0;
        loop {
            turn += 1;
            let request = Request::post(format!("{}/v1/chat/completions",url.trim_end_matches('/'))).header("content-type","application/json")
                .body(Body::from(serde_json::to_vec(&json!({"model":"qwen38_27b_int_df2","messages":messages,"tools":tools,"tool_choice":"auto"}))?))?;
            let response = client.request(request).await?;
            let status = response.status();
            let bytes = hyper::body::to_bytes(response.into_body()).await?;
            tokio::fs::write(evidence.join(format!("model-{turn}.json")), &bytes).await?;
            if !status.is_success() {
                return Err(
                    format!("model HTTP {status}: {}", String::from_utf8_lossy(&bytes)).into(),
                );
            }
            let reply: Value = serde_json::from_slice(&bytes)?;
            let message = reply["choices"][0]["message"].clone();
            if !message.is_object() {
                return Err("model returned no assistant message".into());
            }
            messages.push(message.clone());
            let Some(calls) = message["tool_calls"]
                .as_array()
                .filter(|calls| !calls.is_empty())
            else {
                break;
            };
            for call in calls {
                let name = call["function"]["name"]
                    .as_str()
                    .ok_or("missing tool name")?;
                let arguments: Value = serde_json::from_str(
                    call["function"]["arguments"]
                        .as_str()
                        .ok_or("missing tool arguments")?,
                )?;
                let result = if name == "open_editor" {
                    let result = operation(
                        runtime,
                        identity,
                        GuestOperationKind::Exec {
                            program: "/usr/local/bin/gbot-in-session".into(),
                            args: vec![
                                "systemd-run".into(),
                                "--user".into(),
                                "--quiet".into(),
                                "--collect".into(),
                                "--unit=gbot-editor".into(),
                                "/usr/local/bin/gbot-in-session".into(),
                                "mousepad".into(),
                            ],
                            cwd: GuestPath("/home/gbot".into()),
                            env: Default::default(),
                        },
                    )
                    .await;
                    match result {
                        Ok(value) => serde_json::to_value(value)?,
                        Err(error) => json!({"error":error.to_string()}),
                    }
                } else if names.contains(&name) {
                    match desktop(runtime, identity, name, arguments).await {
                        Ok(value) => text_only(value),
                        Err(error) => json!({"error":error.to_string()}),
                    }
                } else {
                    json!({"error":"tool is not in the text-only accessibility gate"})
                };
                tokio::fs::write(
                    evidence.join(format!(
                        "tool-{turn}-{}.json",
                        call["id"].as_str().ok_or("missing tool-call identity")?
                    )),
                    serde_json::to_vec_pretty(&result)?,
                )
                .await?;
                messages.push(
                    json!({"role":"tool","tool_call_id":call["id"],"content":result.to_string()}),
                );
            }
            println!("Model turn {turn}: {} tools", calls.len());
        }
        tokio::fs::write(
            evidence.join("conversation.json"),
            serde_json::to_vec_pretty(&messages)?,
        )
        .await?;
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
                println!("PASS: model task saved the line; independent SSH readback matched");
                Ok(())
            }
            other => Err(format!("saved file did not match the requested line: {other:?}").into()),
        }
    }
    async fn gate(vm: &PreparedVm, reference: Uuid, evidence: &Path) -> Result<()> {
        vm.start(&KvmTools::default()).await?;
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
        let mut console = BufReader::new(tokio::fs::File::open(tty).await?).lines();
        let mut log = tokio::fs::File::create(evidence.join("serial.log")).await?;
        let key = loop {
            let line = console
                .next_line()
                .await?
                .ok_or("guest console closed before Ready")?;
            log.write_all(format!("{line}\n").as_bytes()).await?;
            if let Some((_, key)) = line.split_once("GBOT_READY_KEY ") {
                break PublicKey::from_openssh(key.trim())?;
            }
        };
        log.flush().await?;
        let key = key.to_openssh()?;
        let mut fields = key.split_whitespace();
        let identity = SessionIdentity {
            workspace_id: WorkspaceId(vm.spec.id),
            session_id: SessionId::new(),
        };
        let service = Arc::new(Service::open(evidence.join("service.json")).await?);
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(NativeVault),
        ));
        let result = async {
            runtime
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
                        credential_ref: VaultCredentialRef(reference),
                    }),
                })
                .await?;
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
            let listener = UnixListener::bind(evidence.join("model-start.sock"))?;
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
        tokio::fs::create_dir_all(&evidence).await?;
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
        let spec = KvmSpec {id:Uuid::new_v4(),cpus:2,host_cpus:vec![112,113],memory_mib:4096,disk_gib:40,ssh_port:0,ssh_public_key:private.public_key().to_openssh()?,browser_package:"firefox-esr".into(),driver:GuestBinary {url:"https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.34.1/cua-driver-rs-0.34.1-linux-x86_64-binary.tar.gz".into(),sha256:"a41fe2bdcbeea4501dc594c074f16b0975728e0cc7b08b90acea8564d48fafee".into()},driver_revision:CUA_REVISION.into()};
        drop(private);
        let vm = match PreparedVm::prepare(&root, &image, spec, &KvmTools::default()).await {
            Ok(vm) => vm,
            Err(error) => {
                NativeVault.delete(reference).await?;
                return Err(error.into());
            }
        };
        tokio::fs::write(evidence.join("guest.json"), serde_json::to_vec_pretty(&vm)?).await?;
        let result =
            tokio::time::timeout(Duration::from_secs(1800), gate(&vm, reference, &evidence)).await;
        let stop = vm.force_stop(&KvmTools::default()).await;
        let cleanup = NativeVault.delete(reference).await;
        tokio::fs::write(evidence.join("gate-result.json"),serde_json::to_vec_pretty(&json!({"pass":matches!(result,Ok(Ok(()))),"result":format!("{result:?}"),"stop":format!("{stop:?}"),"credential_cleanup":format!("{cleanup:?}"),"vm_id":vm.spec.id,"scope":"production service + pinned Cua MCP + native vault + view + text-only real-model task/SSH readback; no performance/Vision claim"}))?).await?;
        stop?;
        cleanup?;
        result??;
        Ok(())
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
