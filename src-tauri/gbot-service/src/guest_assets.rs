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
