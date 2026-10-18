//! Immutable accepted guest payloads shared by setup and bundle installation.
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestAsset {
    pub filename: String,
    pub algorithm: String,
    pub digest: String,
    pub bytes: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ImageSource {
    filename: String,
    algorithm: String,
    digest: String,
    converter: String,
    arguments: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WindowsImage {
    asset: GuestAsset,
    source: ImageSource,
}

fn accepted_for(windows: bool) -> Vec<GuestAsset> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Inventory {
        schema: String,
        files: Vec<GuestAsset>,
        windows_image: WindowsImage,
    }
    let mut inventory: Inventory = serde_json::from_str(include_str!("../guest-assets.json"))
        .expect("compiled guest asset inventory");
    assert_eq!(inventory.schema, "gbot-guest-assets-v1");
    let source = &inventory.windows_image.source;
    assert_eq!(source.filename, inventory.files[0].filename);
    assert_eq!(source.algorithm, inventory.files[0].algorithm);
    assert_eq!(source.digest, inventory.files[0].digest);
    assert!(!source.converter.is_empty() && !source.arguments.is_empty());
    if windows {
        inventory.files[0] = inventory.windows_image.asset;
    }
    inventory.files
}

pub fn accepted() -> Vec<GuestAsset> {
    accepted_for(cfg!(target_os = "windows"))
}

/// Shared desktop contract for both a new VM and a dedicated existing computer.
pub(crate) fn desktop_config(browser: &str) -> std::io::Result<serde_json::Value> {
    let mut config: serde_json::Value =
        serde_json::from_str(include_str!("../guest/cloud-init.json"))?;
    let packages = config["packages"]
        .as_array_mut()
        .ok_or_else(|| std::io::Error::other("guest package list is invalid"))?;
    packages.extend([browser.into(), "mousepad".into()]);
    config["write_files"]
        .as_array_mut()
        .ok_or_else(|| std::io::Error::other("guest file list is invalid"))?
        .push(serde_json::json!({
            "path": "/usr/local/bin/gbot-operation", "owner": "root:root", "permissions": "0755",
            "content": include_str!("../guest/operation.sh")
        }));
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_uses_separately_pinned_ready_vhdx_from_the_linux_source() {
        let linux = accepted_for(false);
        let windows = accepted_for(true);
        assert_eq!(linux.len(), 3);
        assert_eq!(windows.len(), 3);
        assert!(linux[0].filename.ends_with(".qcow2"));
        assert_eq!(linux[0].algorithm, "sha512");
        assert!(windows[0].filename.ends_with(".vhdx"));
        assert_eq!(windows[0].algorithm, "sha256");
        assert_eq!(
            windows[0].digest,
            "9feafe51b36dccdcd79c2e97653a2ec04d9901ea7b69d75be9712f10c95f7c19"
        );
        assert_eq!(windows[0].bytes, Some(1233125376));
        for index in 1..3 {
            assert_eq!(linux[index].filename, windows[index].filename);
            assert_eq!(linux[index].digest, windows[index].digest);
        }
    }
}
