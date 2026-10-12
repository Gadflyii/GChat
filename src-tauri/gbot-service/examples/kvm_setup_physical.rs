//! Opt-in native-client gate for an owned guest; never attaches to a host desktop.
use gbot_service::{
    api::Api,
    service::Service,
    vault::{NativeVault, Vault},
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixListener,
};

async fn ssh_readback(
    record: gbot_service::kvm_setup::SetupRecord,
    data: &std::path::Path,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    use std::os::unix::fs::PermissionsExt;
    let spec = record.spec.ok_or("guest specification missing")?;
    let host = record.pinned_host_key.ok_or("guest host key missing")?;
    host.validate()?;
    let secret = NativeVault
        .get(record.credential_ref.as_uuid())
        .await?
        .ok_or("guest key missing")?;
    let key = data.join("readback-key");
    let known = data.join("readback-known-hosts");
    tokio::fs::write(&key, secret.expose_secret()).await?;
    tokio::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).await?;
    tokio::fs::write(
        &known,
        format!(
            "[127.0.0.1]:{} {} {}\n",
            spec.ssh_port, host.algorithm, host.public_key
        ),
    )
    .await?;
    let result = tokio::process::Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
        ])
        .arg(format!("UserKnownHostsFile={}", known.display()))
        .arg("-i")
        .arg(&key)
        .arg("-p")
        .arg(spec.ssh_port.to_string())
        .args(["gbot@127.0.0.1", "cat /home/gbot/Gbot-browser-receipt.txt"])
        .output()
        .await;
    tokio::fs::remove_file(key).await?;
    tokio::fs::remove_file(known).await?;
    let output = result?;
    Ok(
        json!({"exit_code":output.status.code(),"stdout":String::from_utf8(output.stdout)?,"stderr":String::from_utf8(output.stderr)?}),
    )
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args: Vec<_> = std::env::args().collect();
    let data = PathBuf::from(args.get(1).ok_or("data root required")?);
    let evidence = PathBuf::from(args.get(2).ok_or("evidence root required")?);
    tokio::fs::create_dir_all(&evidence).await?;
    let service = Arc::new(Service::open(data.join("gbot/state.json")).await?);
    let service_id = service.snapshot().await.service_id;
    let api = Api::bind(service, Arc::new(NativeVault), 0)
        .await?
        .with_kvm_setup(data.join("gbot"))
        .await?;
    let client = api.client();
    let socket = data.join("control.sock");
    let listener = UnixListener::bind(&socket)?;
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let serving = tokio::spawn(api.serve(async {
        let _ = stopped.await;
    }));
    tokio::fs::write(
        evidence.join("service.json"),
        serde_json::to_vec_pretty(&json!({"service_id":service_id,"socket":socket}))?,
    )
    .await?;
    let mut updates = client.subscribe_setup().ok_or("setup watch unavailable")?;
    println!("NATIVE_CLIENT_READY {service_id}");
    loop {
        tokio::select! {
            changed = updates.changed() => {
                changed?;
                let state = client.call("/v1/setup/kvm/status", json!({})).await.map_err(std::io::Error::other)?;
                tokio::fs::write(evidence.join("latest-setup.json"), serde_json::to_vec_pretty(&state)?).await?;
                println!("SETUP_UPDATE {state}");
            },
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let (reader, mut writer) = stream.into_split();
                let mut reader = BufReader::new(reader);
                let mut line = String::new();
                reader.read_line(&mut line).await?;
                let command: Value = serde_json::from_str(&line)?;
                let path = command["path"].as_str().ok_or("path required")?;
                if path == "/gate/quit" {
                    writer.write_all(b"{\"quit\":true}\n").await?;
                    break;
                }
                let response = if path == "/gate/ssh-readback" {
                    let record = serde_json::from_value(command["body"].clone())?;
                    json!({"ok":true,"response":ssh_readback(record, &data).await?})
                } else { match client.call(path, command["body"].clone()).await {
                    Ok(value) => json!({"ok":true,"response":value}),
                    Err(error) => json!({"ok":false,"error":error}),
                }};
                if let Some(tag) = command["tag"].as_str() {
                    if !tag.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("invalid tag".into()); }
                    tokio::fs::write(evidence.join(format!("{tag}.json")), serde_json::to_vec_pretty(&response)?).await?;
                }
                writer.write_all(&serde_json::to_vec(&response)?).await?;
                writer.write_all(b"\n").await?;
            }
        }
    }
    let _ = stop.send(());
    serving.await??;
    NativeVault.delete(service_id).await?;
    tokio::fs::remove_file(socket).await?;
    Ok(())
}
