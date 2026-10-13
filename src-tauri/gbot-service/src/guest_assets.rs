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

pub fn accepted() -> Vec<GuestAsset> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Inventory {
        schema: String,
        files: Vec<GuestAsset>,
    }
    let inventory: Inventory = serde_json::from_str(include_str!("../guest-assets.json"))
        .expect("compiled guest asset inventory");
    assert_eq!(inventory.schema, "gbot-guest-assets-v1");
    inventory.files
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
