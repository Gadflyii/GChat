//! Producer-qualified launch configurations shared by the menu and desktop clients.
use crate::{
    engine_host::LaunchOptions,
    engine_inventory::ArtifactIdentity,
    service::{Gpu, ModelEntry},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::Path};

pub const HEADROOM_BYTES: u64 = 1 << 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaunchProfile {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub identity: ArtifactIdentity,
    pub artifact_sha256: String,
    pub artifact_bytes: u64,
    pub tp: u32,
    pub draft_tp: u32,
    pub gpu_name: String,
    pub compute_capability: String,
    pub vram_tier_gib: u32,
    pub min_memory_mib_per_gpu: u64,
    pub max_context: u32,
    pub concurrency: u32,
    pub options: LaunchOptions,
    pub qualification: Qualification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Qualification {
    pub evidence: String,
    pub engine_revision: String,
    /// Minimum across ranks at the measured full-context/concurrency workload.
    pub free_bytes_per_gpu: u64,
    pub full_context_requests: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileCatalog {
    pub schema: String,
    pub profiles: Vec<LaunchProfile>,
}

impl ProfileCatalog {
    pub fn read_installed(state: &Path, bundled: &Path) -> Result<Vec<LaunchProfile>, String> {
        match std::fs::metadata(state) {
            Ok(_) => Self::read(state),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Self::read(bundled),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn read(path: &Path) -> Result<Vec<LaunchProfile>, String> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let catalog: Self = serde_json::from_reader(std::io::BufReader::new(file))
            .map_err(|e| format!("invalid launch profile catalog: {e}"))?;
        if catalog.schema != "ginfer-launch-profiles-v1" {
            return Err("unsupported launch profile catalog schema".into());
        }
        let mut ids = BTreeSet::new();
        for profile in &catalog.profiles {
            profile.validate()?;
            if !ids.insert(&profile.id) {
                return Err(format!("duplicate launch profile: {}", profile.id));
            }
        }
        Ok(catalog.profiles)
    }
}

impl LaunchProfile {
    pub fn validate(&self) -> Result<(), String> {
        let fail = || format!("invalid or unqualified launch profile: {}", self.id);
        if self.id.is_empty()
            || self.name.trim().is_empty()
            || !matches!(self.platform.as_str(), "linux" | "windows")
            || self.gpu_name.trim().is_empty()
            || self.artifact_bytes == 0
            || self.artifact_sha256.len() != 64
            || !self
                .artifact_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !matches!(self.tp, 1 | 2 | 4)
            || !matches!(self.draft_tp, 0 | 1 | 2 | 4)
            || self.draft_tp > self.tp
            || !matches!(
                self.compute_capability.as_str(),
                "8.0" | "8.6" | "8.9" | "12.0"
            )
            || !(matches!(self.vram_tier_gib, 16 | 24 | 32) || self.vram_tier_gib >= 64)
            || self.min_memory_mib_per_gpu == 0
            || !(1..=8).contains(&self.concurrency)
            || self.max_context == 0
            || self.identity.weights_id.is_empty()
            || self.qualification.evidence.trim().is_empty()
            || self.qualification.engine_revision.trim().is_empty()
            || self.qualification.free_bytes_per_gpu < HEADROOM_BYTES
            || self.qualification.full_context_requests != self.concurrency
            || self.options.kv_arena_headroom_bytes < HEADROOM_BYTES
        {
            return Err(fail());
        }
        let maximum = match self.identity.model_id.as_str() {
            "qwen3.8-27b" => 262144,
            "muse-glimmer-30b" => 131072,
            _ => return Err(fail()),
        };
        if self.max_context > maximum {
            return Err(fail());
        }
        self.options.validate(self.tp)?;
        if (self.identity.weights_id.contains("nvfp4") || self.options.kv_dtype == "nvfp4")
            && self.compute_capability != "12.0"
        {
            return Err(fail());
        }
        if (self.options.spec == "dflash" && self.draft_tp == 0)
            || (self.identity.model_id == "qwen3.8-27b"
                && ((self.options.vision && self.options.spec != "none")
                    || self.options.draft_tokens > 7))
        {
            return Err(fail());
        }
        if self.options.draft_tp != self.draft_tp && self.options.draft_tp != 0 {
            return Err(fail());
        }
        Ok(())
    }

    pub fn matches_model(&self, model: &ModelEntry) -> bool {
        model.metadata.identity == self.identity
            && model.metadata.tp_size == self.tp
            && model.metadata.draft_tp == self.draft_tp
            && model.metadata.size_bytes == self.artifact_bytes
    }

    /// Each group is an independent choice. P2P and available memory are checked by the engine.
    pub fn gpu_groups(&self, gpus: &[Gpu], reserved: &BTreeSet<String>) -> Vec<Vec<String>> {
        if self.platform != std::env::consts::OS {
            return vec![];
        }
        let eligible: Vec<_> = gpus
            .iter()
            .filter(|g| {
                !reserved.contains(&g.uuid)
                    && g.name == self.gpu_name
                    && g.compute_capability.as_deref() == Some(&self.compute_capability)
                    && g.memory_mib >= self.min_memory_mib_per_gpu
            })
            .map(|g| g.uuid.clone())
            .collect();
        fn choose(all: &[String], n: usize, picked: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
            if n == 0 {
                out.push(picked.clone());
                return;
            }
            if all.len() < n {
                return;
            }
            for i in 0..=all.len() - n {
                picked.push(all[i].clone());
                choose(&all[i + 1..], n - 1, picked, out);
                picked.pop();
            }
        }
        let mut result = vec![];
        choose(&eligible, self.tp as usize, &mut vec![], &mut result);
        result
    }

    pub fn verify_payload(&self, path: &Path) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        use std::io::Read;
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() != self.artifact_bytes {
            return Err("profile artifact size mismatch".into());
        }
        let mut digest = Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
        if hex::encode(digest.finalize()) != self.artifact_sha256 {
            return Err("profile does not qualify this artifact payload".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> LaunchProfile {
        LaunchProfile {
            id: "fixture-c4".into(),
            name: "Test fixture, not a qualified release".into(),
            platform: std::env::consts::OS.into(),
            identity: ArtifactIdentity {
                model_id: "muse-glimmer-30b".into(),
                weights_id: "nvfp4".into(),
            },
            artifact_sha256: "a".repeat(64),
            artifact_bytes: 4096,
            tp: 2,
            draft_tp: 0,
            gpu_name: "Fixture GPU".into(),
            compute_capability: "12.0".into(),
            vram_tier_gib: 32,
            min_memory_mib_per_gpu: 32000,
            max_context: 65536,
            concurrency: 4,
            options: LaunchOptions::default(),
            qualification: Qualification {
                evidence: "synthetic test only".into(),
                engine_revision: "fixture".into(),
                free_bytes_per_gpu: HEADROOM_BYTES,
                full_context_requests: 4,
            },
        }
    }
    #[test]
    fn profiles_require_full_context_headroom_and_exact_per_gpu_groups() {
        let mut p = profile();
        p.validate().unwrap();
        let mut gpus: Vec<_> = (0..4)
            .map(|i| Gpu {
                uuid: format!("GPU-{i}"),
                name: "Fixture GPU".into(),
                memory_mib: 32607,
                compute_capability: Some("12.0".into()),
            })
            .collect();
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::new()).len(), 6);
        gpus[2].memory_mib = 16000;
        gpus[3].compute_capability = Some("8.6".into());
        assert_eq!(
            p.gpu_groups(&gpus, &BTreeSet::new()),
            vec![vec!["GPU-0".to_string(), "GPU-1".to_string()]]
        );
        assert!(p
            .gpu_groups(&gpus, &BTreeSet::from(["GPU-0".into()]))
            .is_empty());
        p.qualification.free_bytes_per_gpu -= 1;
        assert!(p.validate().is_err());
        p.qualification.free_bytes_per_gpu = HEADROOM_BYTES;
        p.qualification.full_context_requests = 1;
        assert!(p.validate().is_err());
    }
    #[test]
    fn other_platform_profiles_are_not_launch_choices() {
        let mut p = profile();
        let gpus = vec![Gpu {
            uuid: "GPU-fixture".into(), name: "Fixture GPU".into(),
            memory_mib: 32607, compute_capability: Some("12.0".into()),
        }];
        p.tp = 1;
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::new()).len(), 1);
        p.platform = if std::env::consts::OS == "windows" { "linux" } else { "windows" }.into();
        p.validate().unwrap();
        assert!(p.gpu_groups(&gpus, &BTreeSet::new()).is_empty());
        p.platform = "unknown".into();
        assert!(p.validate().is_err());
    }
    #[test]
    fn installed_catalog_uses_bundle_until_an_explicit_state_catalog_exists() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("state.json");
        let bundled = dir.path().join("bundled.json");
        let catalog = ProfileCatalog { schema: "ginfer-launch-profiles-v1".into(), profiles: vec![profile()] };
        std::fs::write(&bundled, serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert_eq!(ProfileCatalog::read_installed(&state, &bundled).unwrap().len(), 1);
        std::fs::write(&state, br#"{"schema":"ginfer-launch-profiles-v1","profiles":[]}"#).unwrap();
        assert!(ProfileCatalog::read_installed(&state, &bundled).unwrap().is_empty());
        std::fs::write(&state, b"invalid").unwrap();
        assert!(ProfileCatalog::read_installed(&state, &bundled).is_err());
    }

    #[test]
    fn catalog_rejects_duplicate_ids_and_unsupported_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profiles.json");
        let mut catalog = ProfileCatalog {
            schema: "ginfer-launch-profiles-v1".into(),
            profiles: vec![profile()],
        };
        std::fs::write(&path, serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert_eq!(ProfileCatalog::read(&path).unwrap()[0].max_context, 65536);
        catalog.profiles.push(profile());
        std::fs::write(&path, serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert!(ProfileCatalog::read(&path)
            .unwrap_err()
            .contains("duplicate"));
        catalog.profiles.pop();
        catalog.schema = "unknown".into();
        std::fs::write(&path, serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert!(ProfileCatalog::read(&path).unwrap_err().contains("schema"));
    }
    #[test]
    fn payload_must_be_the_qualified_artifact_not_just_same_size() {
        use sha2::{Digest, Sha256};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.ginfer");
        std::fs::write(&path, b"original").unwrap();
        let mut p = profile();
        p.artifact_bytes = 8;
        p.artifact_sha256 = hex::encode(Sha256::digest(b"original"));
        p.verify_payload(&path).unwrap();
        std::fs::write(&path, b"modified").unwrap();
        assert!(p.verify_payload(&path).is_err());
    }
}
