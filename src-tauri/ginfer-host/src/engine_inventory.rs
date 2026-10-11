//! Metadata-only inspection for host inventory. Engine binding remains the
//! authority for executability: inspection does not qualify tensor payloads.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
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
        let model = self.identity.model_id.as_str();
        let required = match model {
            "qwen3.8-flash-next" | "qwen3.8-27b" => 0b011,
            "muse-glimmer-30b" => 0b111,
            _ => return false,
        };
        let flash = model == "qwen3.8-flash-next";
        let mut profile = false;
        let mut provenance = false;
        let mut present = [0u8; 4];
        let ready = |present: &[u8], profile, provenance| {
            (!flash || (profile && provenance)) && present.iter().all(|bits| *bits == required)
        };
        // Inventory validates TP before this pass; each bit is one required tensor.
        for object in &self.objects {
            if flash && object.kind == "resource" && object.name == "nvfp4_kv/provenance" {
                provenance = true;
                if ready(&present[..self.tp_size as usize], profile, provenance) {
                    return true;
                }
            }
            if object.kind != "tensor" {
                continue;
            }
            let bit = match (model, object.name.as_str()) {
                ("qwen3.8-flash-next", "nvfp4_kv/profile_v2") => {
                    profile |= object.rank == "all";
                    0
                }
                ("qwen3.8-flash-next", "nvfp4_kv/body_inverse_global_scales")
                | ("qwen3.8-27b", "text/kv_cache/nvfp4_g16/profile_v1")
                | ("muse-glimmer-30b", "text/kv_cache/nvfp4_g16/profile_v2") => 0b001,
                ("qwen3.8-flash-next", "nvfp4_kv/mtp_inverse_global_scales")
                | ("qwen3.8-27b", "text/kv_cache/nvfp4_g16/inverse_global_scales")
                | ("muse-glimmer-30b", "text/kv_cache/nvfp4_g16/full_inverse_global_scales") => 0b010,
                ("muse-glimmer-30b", "text/kv_cache/nvfp4_g16/sliding_inverse_global_scales") => 0b100,
                _ => continue,
            };
            if object.rank == "all" {
                if !flash || self.tp_size == 1 {
                    for rank in &mut present[..self.tp_size as usize] {
                        *rank |= bit;
                    }
                }
            } else if !flash || self.tp_size != 1 {
                if let Some(rank) = object.rank.as_u64().filter(|rank| *rank < u64::from(self.tp_size)) {
                    present[rank as usize] |= bit;
                }
            }
            if ready(&present[..self.tp_size as usize], profile, provenance) {
                return true;
            }
        }
        ready(&present[..self.tp_size as usize], profile, provenance)
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

/// One inventory scan owns one canonical header observation. Never retain this
/// inspector across scans or reuse it for launch preparation.
#[derive(Default)]
pub struct InventoryInspection {
    members: BTreeMap<PathBuf, Result<ArtifactMetadata, String>>,
}

impl InventoryInspection {
    pub fn inspect_artifact(&mut self, path: &Path) -> Result<ArtifactMetadata, String> {
        let resolved = path.canonicalize().map_err(|error| error.to_string())?;
        self.inspect_resolved(&resolved)
    }

    fn inspect_resolved(&mut self, path: &Path) -> Result<ArtifactMetadata, String> {
        if let Some(observation) = self.members.get(path) {
            return observation.clone();
        }
        let observation = inspect_artifact(path);
        self.members.insert(path.to_owned(), observation.clone());
        observation
    }

    pub fn artifact_set_members(
        &mut self,
        path: &Path,
    ) -> Result<Vec<(PathBuf, ArtifactMetadata)>, String> {
        inspect_artifact_set(path, |member| self.inspect_resolved(member))
    }
}

/// Resolve canonical payload paths with the same closed declaration validation
/// used by inventory and degree selection.
pub fn artifact_set_members(path: &Path) -> Result<Vec<(PathBuf, ArtifactMetadata)>, String> {
    inspect_artifact_set(path, inspect_artifact)
}

fn inspect_artifact_set(
    path: &Path,
    mut inspect: impl FnMut(&Path) -> Result<ArtifactMetadata, String>,
) -> Result<Vec<(PathBuf, ArtifactMetadata)>, String> {
    #[cfg(test)]
    let file = resource_io::Reader::open(path)?;
    #[cfg(not(test))]
    let file = File::open(path).map_err(|error| error.to_string())?;
    let set: ArtifactSet =
        serde_json::from_reader(BufReader::new(file))
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
        let metadata = inspect(&member)?;
        if metadata.identity.model_id != set.identity.model_id
            || metadata.identity.weights_id != set.identity.weights_id
            || metadata.tp_size != entry.tp
            || metadata.draft_tp != entry.draft_tp
            || metadata.size_bytes != entry.bytes
        {
            return Err("artifact set member header or size disagrees with its declaration".into());
        }
        members.push((member, metadata));
    }
    members.sort_by_key(|(_, metadata)| metadata.tp_size);
    let has_draft = members.iter().any(|(_, metadata)| metadata.draft_tp != 0);
    if has_draft != set.canonical_reconstructed_draft_sha256.is_some()
        || (has_draft && members.iter().any(|(_, metadata)| metadata.draft_tp == 0))
    {
        return Err("artifact set draft digest and draft TP declarations disagree".into());
    }
    Ok(members)
}

/// Reads the framed directory only, never tensor payloads. Unknown identities
/// are reported as stored; no capability or runnable status is inferred.
pub fn inspect_artifact(path: &Path) -> Result<ArtifactMetadata, String> {
    #[cfg(test)]
    let mut file = resource_io::Reader::open(path)?;
    #[cfg(not(test))]
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
                || !directory.tp_size.is_multiple_of(directory.draft_tp)))
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
pub(crate) mod resource_io {
    use std::{fs::{File, Metadata}, io::{self, Read}, path::Path};
    use std::sync::atomic::{AtomicU64, Ordering};

    static OPENS: AtomicU64 = AtomicU64::new(0);
    static READ_BYTES: AtomicU64 = AtomicU64::new(0);
    static READ_CALLS: AtomicU64 = AtomicU64::new(0);

    // Take deltas only in a filtered serial measurement process, after its
    // blocking scan owner has returned. These count requested I/O, not cache misses.
    #[derive(Clone, Copy, Debug)]
    pub struct Counts {
        pub opens: u64,
        pub read_bytes: u64,
        pub read_calls: u64,
    }

    pub fn snapshot() -> Counts {
        Counts {
            opens: OPENS.load(Ordering::Relaxed),
            read_bytes: READ_BYTES.load(Ordering::Relaxed),
            read_calls: READ_CALLS.load(Ordering::Relaxed),
        }
    }

    pub(super) struct Reader(File);

    impl Reader {
        pub(super) fn open(path: &Path) -> Result<Self, String> {
            let file = File::open(path).map_err(|error| error.to_string())?;
            OPENS.fetch_add(1, Ordering::Relaxed);
            Ok(Self(file))
        }

        pub(super) fn metadata(&self) -> io::Result<Metadata> {
            self.0.metadata()
        }
    }

    impl Read for Reader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            READ_CALLS.fetch_add(1, Ordering::Relaxed);
            let result = self.0.read(buffer);
            if let Ok(bytes) = &result {
                READ_BYTES.fetch_add(*bytes as u64, Ordering::Relaxed);
            }
            result
        }
    }
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
    fn scan_observation_keeps_declarations_fresh_and_never_substitutes_for_full_sha() {
        use sha2::{Digest, Sha256};
        use crate::launch_profiles::LaunchProfile;

        let directory = tempfile::tempdir().unwrap();
        let mut declarations = Vec::new();
        let mut payloads = Vec::new();
        for tp in [1, 2, 4] {
            let mut objects = vec![
                serde_json::json!({"kind":"tensor", "rank":"all", "name":"nvfp4_kv/profile_v2"}),
                serde_json::json!({"kind":"resource", "name":"nvfp4_kv/provenance"}),
            ];
            for rank in 0..tp {
                let placement = if tp == 1 { serde_json::json!("all") } else { serde_json::json!(rank) };
                for suffix in ["body_inverse_global_scales", "mtp_inverse_global_scales"] {
                    objects.push(serde_json::json!({"kind":"tensor", "rank":placement, "name":format!("nvfp4_kv/{suffix}")}));
                }
            }
            let header = serde_json::to_vec(&serde_json::json!({
                "identity":{"model_id":"qwen3.8-flash-next", "weights_id":"nvfp4"},
                "tp_size":tp, "draft_tp":0, "objects":objects,
            })).unwrap();
            let mut bytes = b"NINFER\0\x03".to_vec();
            bytes.extend_from_slice(&(header.len() as u64).to_le_bytes());
            bytes.extend(header);
            bytes.resize(4096 + 31, 7);
            let name = format!("tp{tp}.ginfer");
            let path = directory.path().join(&name);
            std::fs::write(&path, &bytes).unwrap();
            declarations.push(serde_json::json!({
                "tp":tp, "draft_tp":0, "path":name, "bytes":bytes.len(),
                "sha256":hex::encode(Sha256::digest(&bytes)),
            }));
            payloads.push((path, bytes));
        }
        let set_path = directory.path().join("set.json");
        let descriptor = serde_json::json!({
            "schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":"qwen3.8-flash-next", "weights_id":"nvfp4", "family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),
            "canonical_reconstructed_draft_sha256":null, "artifacts":declarations,
        });
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        let mut scan = InventoryInspection::default();
        let observed = scan.artifact_set_members(&set_path).unwrap();
        assert_eq!(observed.iter().map(|(_, metadata)| metadata.tp_size).collect::<Vec<_>>(), vec![1, 2, 4]);
        assert!(observed.iter().all(|(_, metadata)| metadata.nvfp4_kv_available));
        for (path, metadata) in &observed {
            assert_eq!(scan.inspect_artifact(path).unwrap(), *metadata);
        }

        // A cached header cannot authorize a different descriptor declaration.
        let mut invalid = descriptor.clone();
        invalid["artifacts"][2]["bytes"] = serde_json::json!(4126);
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(scan.artifact_set_members(&set_path).unwrap_err().contains("disagrees"));
        std::fs::write(&set_path, descriptor.to_string()).unwrap();

        let (path, bytes) = &payloads[1];
        let profile: LaunchProfile = serde_json::from_value(serde_json::json!({
            "id":"fixture", "name":"Synthetic hash control", "platform":std::env::consts::OS,
            "identity":observed[1].1.identity, "artifact_sha256":hex::encode(Sha256::digest(bytes)),
            "artifact_bytes":bytes.len(), "tp":2, "draft_tp":0,
            "gpu_name":"Fixture", "compute_capability":"12.0", "vram_tier_gib":32,
            "min_memory_mib_per_gpu":32768, "max_context":4096, "concurrency":1,
            "options":{}, "qualification":{"tier":"full-context-tested", "evidence":"synthetic only",
                "engine_revision":"fixture", "free_bytes_per_gpu":1_u64 << 30, "full_context_requests":1},
        })).unwrap();
        profile.verify_payload(path).unwrap();
        let mut changed = bytes.clone();
        *changed.last_mut().unwrap() ^= 1;
        std::fs::write(path, changed).unwrap();
        assert_eq!(inspect_artifact(path).unwrap(), observed[1].1);
        assert_eq!(profile.verify_payload(path).unwrap_err(), "profile does not qualify this artifact payload");

        // A new pass observes a header change; no previous scan grants freshness.
        let (path, bytes) = &payloads[2];
        let mut changed = bytes.clone();
        let needle = b"nvfp4_kv/provenance";
        let offset = changed.windows(needle.len()).position(|part| part == needle).unwrap();
        changed[offset] = b'x';
        std::fs::write(path, changed).unwrap();
        let refreshed = artifact_set_members(&set_path).unwrap();
        assert!(!refreshed[2].1.nvfp4_kv_available);
        assert_ne!(refreshed[2].1, observed[2].1);
        std::fs::remove_file(&payloads[0].0).unwrap();
        assert!(artifact_set_members(&set_path).is_err());
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
    fn legacy_nvfp4_calibration_requires_each_tensor_on_every_rank() {
        for (model, suffixes) in [
            ("qwen3.8-27b", vec!["profile_v1", "inverse_global_scales"]),
            ("muse-glimmer-30b", vec!["profile_v2", "full_inverse_global_scales", "sliding_inverse_global_scales"]),
        ] {
            for tp in [1, 2, 4] {
                let mut value = directory();
                value["identity"]["model_id"] = model.into();
                value["tp_size"] = tp.into();
                let mut objects = Vec::new();
                for suffix in &suffixes {
                    for rank in 0..tp {
                        objects.push(serde_json::json!({"kind":"tensor", "rank":rank,
                            "name":format!("text/kv_cache/nvfp4_g16/{suffix}")}));
                    }
                }
                value["objects"] = objects.into();
                assert!(serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
                for index in 0..value["objects"].as_array().unwrap().len() {
                    let mut missing = value.clone();
                    missing["objects"].as_array_mut().unwrap().remove(index);
                    assert!(!serde_json::from_value::<Directory>(missing).unwrap().nvfp4_kv_available());
                    for invalid in [serde_json::json!("0"), serde_json::json!(0.0), serde_json::json!(-1), serde_json::json!(tp), serde_json::Value::Null] {
                        let mut misplaced = value.clone();
                        misplaced["objects"][index]["rank"] = invalid;
                        assert!(!serde_json::from_value::<Directory>(misplaced).unwrap().nvfp4_kv_available());
                    }
                    let mut wrong_kind = value.clone();
                    wrong_kind["objects"][index]["kind"] = "resource".into();
                    assert!(!serde_json::from_value::<Directory>(wrong_kind).unwrap().nvfp4_kv_available());
                }
                // One shared tensor can cover all ranks; repeated copies cannot replace another name.
                value["objects"][0]["rank"] = "all".into();
                assert!(serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
                let duplicate = value["objects"][0].clone();
                value["objects"].as_array_mut().unwrap().push(duplicate);
                assert!(serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
                let last_name = format!("text/kv_cache/nvfp4_g16/{}", suffixes.last().unwrap());
                value["objects"].as_array_mut().unwrap().retain(|object| object["name"] != last_name);
                assert!(!serde_json::from_value::<Directory>(value).unwrap().nvfp4_kv_available());
            }
        }
    }

    #[test]
    fn flash_nvfp4_kv_requires_its_own_partition_and_provenance_for_every_rank() {
        for tp in [1, 2, 4] {
            let mut value = directory();
            value["identity"]["model_id"] = "qwen3.8-flash-next".into();
            value["tp_size"] = tp.into();
            assert!(!serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
            let mut objects = vec![
                serde_json::json!({"kind":"tensor", "rank":"all", "name":"nvfp4_kv/profile_v2"}),
                serde_json::json!({"kind":"resource", "name":"nvfp4_kv/provenance"}),
            ];
            for rank in 0..tp {
                let placement = if tp == 1 { serde_json::json!("all") } else { serde_json::json!(rank) };
                for suffix in ["body_inverse_global_scales", "mtp_inverse_global_scales"] {
                    objects.push(serde_json::json!({"kind":"tensor", "rank":placement, "name":format!("nvfp4_kv/{suffix}")}));
                }
            }
            value["objects"] = objects.into();
            assert!(serde_json::from_value::<Directory>(value.clone()).unwrap().nvfp4_kv_available());
            for index in 0..value["objects"].as_array().unwrap().len() {
                let mut missing = value.clone();
                missing["objects"].as_array_mut().unwrap().remove(index);
                assert!(!serde_json::from_value::<Directory>(missing).unwrap().nvfp4_kv_available());
            }
            for index in [0, 2] {
                let mut misplaced = value.clone();
                misplaced["objects"][index]["rank"] = if misplaced["objects"][index]["rank"] == "all" { 0.into() } else { "all".into() };
                assert!(!serde_json::from_value::<Directory>(misplaced).unwrap().nvfp4_kv_available());
            }
            value["objects"][1]["kind"] = "tensor".into();
            assert!(!serde_json::from_value::<Directory>(value).unwrap().nvfp4_kv_available());
        }
        let mut old_muse_partition = directory();
        old_muse_partition["identity"]["model_id"] = "qwen3.8-flash-next".into();
        old_muse_partition["objects"] = serde_json::json!([
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/profile_v2"},
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/full_inverse_global_scales"},
            {"kind":"tensor", "rank":"all", "name":"text/kv_cache/nvfp4_g16/sliding_inverse_global_scales"}
        ]);
        assert!(!serde_json::from_value::<Directory>(old_muse_partition).unwrap().nvfp4_kv_available());
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
            artifact_set_members(&set_path)
                .unwrap()
                .iter()
                .map(|(_, metadata)| metadata.tp_size)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        let mut invalid = set.clone();
        invalid["artifacts"][1]["tp"] = 1.into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(artifact_set_members(&set_path)
            .unwrap_err()
            .contains("duplicate"));
        let mut invalid = set.clone();
        invalid["artifacts"][1]["path"] = "one.ginfer".into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(artifact_set_members(&set_path)
            .unwrap_err()
            .contains("disagrees"));
        let mut invalid = set.clone();
        invalid
            .as_object_mut()
            .unwrap()
            .remove("canonical_reconstructed_draft_sha256");
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(artifact_set_members(&set_path)
            .unwrap_err()
            .contains("missing field"));
        let mut invalid = set;
        invalid["canonical_reconstructed_draft_sha256"] = "e".repeat(64).into();
        std::fs::write(&set_path, invalid.to_string()).unwrap();
        assert!(artifact_set_members(&set_path)
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
