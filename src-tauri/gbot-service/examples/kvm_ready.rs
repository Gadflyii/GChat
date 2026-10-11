//! Opt-in dedicated-guest gate; credentials stay in an isolated native vault.
#[cfg(target_os = "linux")]
mod linux {
    use gbot_service::{
        kvm::{GuestBinary, KvmSpec, KvmTools, PreparedVm, CUA_REVISION},
        vault::{NativeVault, Secret, Vault},
    };
    use russh::{
        client,
        keys::{PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate},
    };
    use serde_json::{json, Value};
    use std::{error::Error, path::PathBuf, sync::Arc, time::Duration};
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        process::Command,
    };
    use uuid::Uuid;
    type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;
    struct Peer(PublicKey);
    impl client::Handler for Peer {
        type Error = russh::Error;
        async fn check_server_key(
            &mut self,
            key: &PublicKeyOrCertificate,
        ) -> std::result::Result<bool, Self::Error> {
            Ok(
                matches!(key, PublicKeyOrCertificate::PublicKey { key, .. } if key.key_data() == self.0.key_data()),
            )
        }
    }
    type Mcp = BufReader<russh::ChannelStream<client::Msg>>;
    async fn mcp(mcp: &mut Mcp, request: Value, root: &std::path::Path) -> Result<Value> {
        let id = request["id"].clone();
        mcp.get_mut()
            .write_all(format!("{request}\n").as_bytes())
            .await?;
        mcp.get_mut().flush().await?;
        if id.is_null() {
            return Ok(Value::Null);
        }
        loop {
            let mut line = String::new();
            if mcp.read_line(&mut line).await? == 0 {
                return Err("Cua MCP closed before reply".into());
            }
            let reply: Value = serde_json::from_str(&line)?;
            if reply["id"] != id {
                continue;
            }
            tokio::fs::write(
                root.join(format!("mcp-{id}.json")),
                serde_json::to_vec_pretty(&reply)?,
            )
            .await?;
            if !reply["error"].is_null() {
                return Err("Cua MCP returned JSON-RPC error; see saved reply".into());
            }
            println!("MCP reply {id} saved");
            return Ok(reply);
        }
    }
    fn payload(reply: &Value) -> Value {
        let result = &reply["result"];
        if result["structuredContent"].is_object() {
            return result["structuredContent"].clone();
        }
        for content in result["content"].as_array().into_iter().flatten() {
            if let Some(text) = content["text"].as_str() {
                if let Ok(value) = serde_json::from_str(text) {
                    return value;
                }
            }
        }
        result.clone()
    }
    fn target(value: &Value) -> Option<(u64, Value)> {
        match value {
            Value::Object(map) => {
                if map
                    .get("title")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s.contains("Gbot-Readiness"))
                {
                    if let Some(pid) = map.get("pid").and_then(Value::as_u64) {
                        return map.get("window_id").cloned().map(|window| (pid, window));
                    }
                }
                map.values().find_map(target)
            }
            Value::Array(items) => items.iter().find_map(target),
            _ => None,
        }
    }
    fn call(id: u32, name: &str, arguments: Value) -> Value {
        json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})
    }
    async fn gate(vm: &PreparedVm, private: PrivateKey, evidence: &std::path::Path) -> Result<()> {
        let tools = KvmTools::default();
        vm.start(&tools).await?;
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
        let raw = Command::new("stty")
            .args(["-F", &tty, "raw", "-echo"])
            .status()
            .await?;
        if !raw.success() {
            return Err("cannot read the owned guest console".into());
        }
        let mut console = BufReader::new(tokio::fs::File::open(tty).await?).lines();
        let mut log = tokio::fs::File::create(evidence.join("serial.log")).await?;
        let key = loop {
            let line = console
                .next_line()
                .await?
                .ok_or("guest console closed before boot completion")?;
            log.write_all(format!("{line}\n").as_bytes()).await?;
            if let Some((_, key)) = line.split_once("GBOT_READY_KEY ") {
                break PublicKey::from_openssh(key.trim())?;
            }
        };
        log.flush().await?;
        println!("First boot complete; SSH host key bound to owned console");
        let mut client = client::connect(
            Arc::new(client::Config {
                keepalive_interval: Some(Duration::from_secs(15)),
                keepalive_max: 3,
                ..Default::default()
            }),
            ("127.0.0.1", vm.spec.ssh_port),
            Peer(key),
        )
        .await?;
        let auth = client
            .authenticate_publickey("gbot", PrivateKeyWithHashAlg::new(Arc::new(private), None))
            .await?;
        if !auth.success() {
            return Err("guest authentication refused".into());
        }
        let result = desktop_gate(&mut client, evidence).await;
        let diagnostics = async {
            let channel = client.channel_open_session().await?;
            channel.exec(true, "(cat /tmp/gbot-cua-gate.stderr; XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status gbot-desktop.service --no-pager; journalctl --user -u gbot-desktop.service -n 60 --no-pager) 2>&1").await?;
            let mut bytes = Vec::new();
            channel.into_stream().read_to_end(&mut bytes).await?;
            tokio::fs::write(evidence.join("guest-diagnostics.txt"), bytes).await?;
            Ok::<(), Box<dyn Error + Send + Sync>>(())
        }.await;
        if let Err(error) = diagnostics {
            tokio::fs::write(
                evidence.join("guest-diagnostics-error.txt"),
                error.to_string(),
            )
            .await?;
        }
        let _ = client
            .disconnect(russh::Disconnect::ByApplication, "gate finished", "en")
            .await;
        let _ = client.await;
        result
    }
    async fn desktop_gate(
        client: &mut client::Handle<Peer>,
        evidence: &std::path::Path,
    ) -> Result<()> {
        let terminal = client.channel_open_session().await?;
        terminal
        .exec(
            true,
            "/usr/local/bin/gbot-in-session xfce4-terminal --disable-server --title Gbot-Readiness",
        )
        .await?;
        let mut channel = client.channel_open_session().await?;
        channel
            .exec(true, "/usr/local/bin/gbot-cua 2>/tmp/gbot-cua-gate.stderr")
            .await?;
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Success) => break,
                Some(russh::ChannelMsg::WindowAdjusted { .. }) => (),
                _ => return Err("Cua exec refused".into()),
            }
        }
        let mut stream = BufReader::new(channel.into_stream());
        mcp(&mut stream, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"gbot-owned-guest-gate","version":"1"}}}), evidence).await?;
        mcp(
            &mut stream,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            evidence,
        )
        .await?;
        let desktop = mcp(
            &mut stream,
            call(2, "get_desktop_state", json!({})),
            evidence,
        )
        .await?;
        if desktop["result"]["isError"] == true
            || !desktop["result"]["content"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["type"] == "image"))
        {
            return Err("desktop capture produced no real image".into());
        }
        let windows = mcp(&mut stream, call(3, "list_windows", json!({})), evidence).await?;
        let (pid, window) =
            target(&payload(&windows)).ok_or("dedicated terminal was not discovered")?;
        let state = mcp(
            &mut stream,
            call(
                4,
                "get_window_state",
                json!({"pid":pid,"window_id":window,"include_screenshot":false}),
            ),
            evidence,
        )
        .await?;
        let state = payload(&state);
        if state["degraded"] == true || !state.to_string().contains("Help") {
            return Err("terminal accessibility tree unavailable".into());
        }
        let action = mcp(
            &mut stream,
            call(
                5,
                "invoke_menu",
                json!({"pid":pid,"window_id":window,"path":["Help","About"]}),
            ),
            evidence,
        )
        .await?;
        if action["result"]["isError"] == true {
            return Err("harmless AT-SPI menu action refused".into());
        }
        let after = mcp(&mut stream, call(6, "list_windows", json!({})), evidence).await?;
        if !payload(&after).to_string().to_lowercase().contains("about") {
            return Err("AT-SPI action had no independently observed About dialog".into());
        }
        stream.get_mut().shutdown().await?;
        drop(stream);
        drop(terminal.into_stream());
        println!("PASS: real frame plus AT-SPI About action and dialog readback");
        Ok(())
    }
    #[tokio::main]
    pub async fn run() -> Result<()> {
        let mut args = std::env::args_os().skip(1);
        let root = PathBuf::from(args.next().ok_or("VM root required")?);
        let image = PathBuf::from(args.next().ok_or("exact image required")?);
        let evidence = root.join("evidence");
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
        let spec = KvmSpec { id:Uuid::new_v4(), cpus:2, host_cpus:vec![112,113], memory_mib:4096, disk_gib:40, ssh_port:0,
        ssh_public_key:private.public_key().to_openssh()?, browser_package:"firefox-esr".into(),
        driver:GuestBinary { url:"https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.34.1/cua-driver-rs-0.34.1-linux-x86_64-binary.tar.gz".into(),sha256:"a41fe2bdcbeea4501dc594c074f16b0975728e0cc7b08b90acea8564d48fafee".into() }, driver_revision:CUA_REVISION.into() };
        let vm = match PreparedVm::prepare(&root, &image, spec, &KvmTools::default()).await {
            Ok(vm) => vm,
            Err(error) => {
                NativeVault.delete(reference).await?;
                return Err(error.into());
            }
        };
        tokio::fs::write(evidence.join("guest.json"), serde_json::to_vec_pretty(&vm)?).await?;
        let result =
            tokio::time::timeout(Duration::from_secs(900), gate(&vm, private, &evidence)).await;
        let stop = vm.force_stop(&KvmTools::default()).await;
        let cleanup = NativeVault.delete(reference).await;
        tokio::fs::write(evidence.join("gate-result.json"),serde_json::to_vec_pretty(&json!({"pass": matches!(result,Ok(Ok(()))),"result":format!("{result:?}"),"stop":format!("{stop:?}"),"credential_cleanup":format!("{cleanup:?}"),"vm_id":vm.spec.id,"scope":"dedicated guest/adapter/Cua/native fixture vault; service JSON-worker replacement is still owed"}))?).await?;
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
    eprintln!("The dedicated KVM guest gate requires Linux");
    std::process::exit(1);
}
