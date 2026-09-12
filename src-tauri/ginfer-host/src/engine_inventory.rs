//! Metadata-only inspection for host inventory. Engine binding remains the
//! authority for executability: inspection does not qualify tensor payloads.

use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactIdentity {
    pub model_id: String,
    pub weights_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Directory {
    identity: ArtifactIdentity,
    tp_size: u32,
    draft_tp: u32,
    objects: Vec<InventoryObject>,
}

#[derive(Deserialize)]
struct InventoryObject {
    name: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    rank: serde_json::Value,
}

impl Directory {
    fn nvfp4_kv_available(&self) -> bool {
        let suffixes: &[&str] = match self.identity.model_id.as_str() {
            "qwen3.8-27b" => &["profile_v1", "inverse_global_scales"],
            "muse-glimmer-30b" => &["profile_v2", "full_inverse_global_scales", "sliding_inverse_global_scales"],
            _ => return false,
        };
        (0..self.tp_size).all(|rank| suffixes.iter().all(|suffix| {
            let name = format!("text/kv_cache/nvfp4_g16/{suffix}");
            self.objects.iter().any(|object| object.kind == "tensor" && object.name == name
                && (object.rank == rank || object.rank == "all"))
        }))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactMetadata {
    pub identity: ArtifactIdentity,
    pub tp_size: u32,
    pub draft_tp: u32,
    pub size_bytes: u64,
    pub object_count: usize,
    pub nvfp4_kv_available: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetIdentity {
    model_id: String,
    weights_id: String,
    family_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetEntry {
    tp: u32,
    draft_tp: u32,
    path: PathBuf,
    bytes: u64,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactSet {
    schema: String,
    identity: SetIdentity,
    canonical_reconstructed_target_sha256: String,
    #[serde(deserialize_with = "required_nullable_digest")]
    canonical_reconstructed_draft_sha256: Option<String>,
    artifacts: Vec<SetEntry>,
}
fn required_nullable_digest<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

/// Resolve a declared payload after inventory validation; never guess sibling names.
pub fn artifact_set_payload(path: &Path, tp: u32) -> Result<PathBuf, String> {
    inspect_artifact_set(path)?;
    let set: ArtifactSet =
        serde_json::from_reader(BufReader::new(File::open(path).map_err(|e| e.to_string())?))
            .map_err(|e| e.to_string())?;
    let entry = set
        .artifacts
        .into_iter()
        .find(|e| e.tp == tp)
        .ok_or("degree is not declared")?;
    path.parent()
        .ok_or("artifact set has no parent")?
        .join(entry.path)
        .canonicalize()
        .map_err(|e| e.to_string())
}

/// Validate the deployment declaration and every member header. The Engine,
/// not inventory, hashes the selected payload before materialization.
pub fn inspect_artifact_set(path: &Path) -> Result<Vec<ArtifactMetadata>, String> {
    let set: ArtifactSet =
        serde_json::from_reader(BufReader::new(File::open(path).map_err(|e| e.to_string())?))
            .map_err(|e| format!("invalid artifact set: {e}"))?;
    let digest = |value: &str| {
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    };
    if set.schema != "ginfer-artifact-set-v1"
        || !digest(&set.identity.family_id)
        || !digest(&set.canonical_reconstructed_target_sha256)
        || set
            .canonical_reconstructed_draft_sha256
            .as_deref()
            .is_some_and(|s| !digest(s))
        || set.artifacts.is_empty()
    {
        return Err("artifact set has an invalid schema, family/digest, or empty inventory".into());
    }
    let root = path
        .parent()
        .ok_or("artifact set has no parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut degrees = std::collections::BTreeSet::new();
    let mut members = Vec::new();
    for entry in set.artifacts {
        if !degrees.insert(entry.tp)
            || !digest(&entry.sha256)
            || entry.path.as_os_str().is_empty()
            || entry.path.is_absolute()
        {
            return Err(
                "artifact set has duplicate degrees, invalid digest, or escaping path".into(),
            );
        }
        let member = root
            .join(entry.path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !member.starts_with(&root) {
            return Err("artifact set member escapes its directory".into());
        }
        let metadata = inspect_artifact(&member)?;
        if metadata.identity.model_id != set.identity.model_id
            || metadata.identity.weights_id != set.identity.weights_id
            || metadata.tp_size != entry.tp
            || metadata.draft_tp != entry.draft_tp
            || metadata.size_bytes != entry.bytes
        {
            return Err("artifact set member header or size disagrees with its declaration".into());
        }
        members.push(metadata);
    }
    members.sort_by_key(|m| m.tp_size);
    let has_draft = members.iter().any(|m| m.draft_tp != 0);
    if has_draft != set.canonical_reconstructed_draft_sha256.is_some()
        || (has_draft && members.iter().any(|m| m.draft_tp == 0))
    {
        return Err("artifact set draft digest and draft TP declarations disagree".into());
    }
    Ok(members)
}

/// Reads the framed directory only, never tensor payloads. Unknown identities
/// are reported as stored; no capability or runnable status is inferred.
pub fn inspect_artifact(path: &Path) -> Result<ArtifactMetadata, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size_bytes = file.metadata().map_err(|e| e.to_string())?.len();
    let mut prefix = [0u8; 16];
    file.read_exact(&mut prefix)
        .map_err(|e| format!("cannot read container prefix: {e}"))?;
    if &prefix[..8] != b"NINFER\0\x03" {
        return Err("not a GInfer version-3 container".into());
    }
    let json_bytes = u64::from_le_bytes(prefix[8..].try_into().unwrap());
    if json_bytes == 0 {
        return Err("container directory is empty".into());
    }
    let payload_offset = json_bytes
        .checked_add(16)
        .and_then(|n| n.checked_add(4095))
        .map(|n| n & !4095)
        .ok_or("container directory length overflows")?;
    if payload_offset > size_bytes {
        return Err("container is truncated before its payload boundary".into());
    }
    // Take wraps the file before buffering so the reader cannot prefetch weights.
    let directory: Directory = serde_json::from_reader(BufReader::new(file.take(json_bytes)))
        .map_err(|e| format!("invalid container directory: {e}"))?;
    if directory.identity.model_id.is_empty() || directory.identity.weights_id.is_empty() {
        return Err("container identity is empty".into());
    }
    if !matches!(directory.tp_size, 1 | 2 | 4)
        || !matches!(directory.draft_tp, 0 | 1 | 2 | 4)
        || (directory.draft_tp != 0
            && (directory.draft_tp > directory.tp_size
                || directory.tp_size % directory.draft_tp != 0))
    {
        return Err("container declares an invalid TP or draft TP degree".into());
    }
    if directory.objects.is_empty() {
        return Err("container object directory is empty".into());
    }
    let nvfp4_kv_available = directory.nvfp4_kv_available();
    Ok(ArtifactMetadata {
        identity: directory.identity,
        tp_size: directory.tp_size,
        draft_tp: directory.draft_tp,
        size_bytes,
        object_count: directory.objects.len(),
        nvfp4_kv_available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn artifact(path: &Path, directory: serde_json::Value) {
        let json = serde_json::to_vec(&directory).unwrap();
        let mut file = File::create(path).unwrap();
        file.write_all(b"NINFER\0\x03").unwrap();
        file.write_all(&(json.len() as u64).to_le_bytes()).unwrap();
        file.write_all(&json).unwrap();
        // Sparse simulated weights establish that inventory needs no full read.
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
    }

    fn directory() -> serde_json::Value {
        serde_json::json!({"identity": {"model_id": "muse-glimmer-30b", "weights_id": "nvfp4"},
            "tp_size": 2, "draft_tp": 0, "objects": [{"name": "fixture"}]})
    }

    #[test]
    fn nvfp4_weights_do_not_imply_calibrated_kv() {
        let mut value = directory();
        let parsed: Directory = serde_json::from_value(value.clone()).unwrap();
        assert!(!parsed.nvfp4_kv_available());
        value["objects"] = serde_json::json!([
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/profile_v2"},
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/full_inverse_global_scales"},
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/sliding_inverse_global_scales"}
        ]);
        assert!(serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
        value["objects"][2]["rank"] = 0.into();
        assert!(!serde_json::from_value::<Directory>(value).unwrap().nvfp4_kv_available());
    }

    #[test]
    fn artifact_sets_validate_declared_degrees_headers_and_closed_contract() {
        let dir = tempfile::tempdir().unwrap();
        let mut singleton = directory();
        singleton["tp_size"] = 1.into();
        artifact(&dir.path().join("one.ginfer"), singleton);
        artifact(&dir.path().join("two.ginfer"), directory());
        let set_path = dir.path().join("deployment.json");
        let set = serde_json::json!({"schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4","family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),"canonical_reconstructed_draft_sha256":null,
            "artifacts":[{"tp":1,"draft_tp":0,"path":"one.ginfer","bytes":8u64*1024*1024*1024,"sha256":"c".repeat(64)},
                {"tp":2,"draft_tp":0,"path":"two.ginfer","bytes":8u64*1024*1024*1024,"sha256":"d".repeat(64)}]});
        std::fs::write(&set_path, set.to_string()).unwrap();
        assert_eq!(
            inspect_artifact_set(&set_path)
                .unwrap()
                .iter()
                .map(|m| m.tp_size)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        let mut invalid = set.clone();
        invalid["artifacts"][1]["tp"] = 1.into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(inspect_artifact_set(&set_path)
            .unwrap_err()
            .contains("duplicate"));
        let mut invalid = set.clone();
        invalid["artifacts"][1]["path"] = "one.ginfer".into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(inspect_artifact_set(&set_path)
            .unwrap_err()
            .contains("disagrees"));
        let mut invalid = set.clone();
        invalid
            .as_object_mut()
            .unwrap()
            .remove("canonical_reconstructed_draft_sha256");
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(inspect_artifact_set(&set_path)
            .unwrap_err()
            .contains("missing field"));
        let mut invalid = set;
        invalid["canonical_reconstructed_draft_sha256"] = "e".repeat(64).into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(inspect_artifact_set(&set_path)
            .unwrap_err()
            .contains("disagree"));
    }

    #[test]
    fn reads_identity_and_degrees_from_directory_not_filename() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("misleading_qwen_tp4.ginfer");
        artifact(&path, directory());
        let metadata = inspect_artifact(&path).unwrap();
        assert_eq!(metadata.identity.model_id, "muse-glimmer-30b");
        assert_eq!(metadata.tp_size, 2);
        assert_eq!(metadata.size_bytes, 8 * 1024 * 1024 * 1024);
        assert_eq!(metadata.object_count, 1);
    }

    #[test]
    fn rejects_invalid_degree_and_truncated_directory_without_loading_weights() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.ginfer");
        let mut value = directory();
        value["draft_tp"] = 4.into();
        artifact(&path, value);
        assert!(inspect_artifact(&path).unwrap_err().contains("degree"));
        artifact(&path, directory());
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(128)
            .unwrap();
        assert!(inspect_artifact(&path).unwrap_err().contains("truncated"));
    }
}
