//! Launch settings a person saved for one model package on this computer.
//!
//! A saved profile is keyed to the model package's SHA-256 and to the graphics
//! cards it was saved on. It is offered for launch only while both still match;
//! otherwise its status says what changed, so it is never applied silently.
use crate::{
    engine_host::LaunchOptions,
    engine_inventory::ArtifactIdentity,
    service::{Gpu, LaunchRequest},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// One graphics card as it was when the settings were saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedGpu {
    pub uuid: String,
    pub name: String,
    pub memory_mib: u64,
    pub compute_capability: Option<String>,
}

impl From<&Gpu> for SavedGpu {
    fn from(gpu: &Gpu) -> Self {
        Self {
            uuid: gpu.uuid.clone(),
            name: gpu.name.clone(),
            memory_mib: gpu.memory_mib,
            compute_capability: gpu.compute_capability.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomProfile {
    pub id: Uuid,
    pub name: String,
    /// The model package these settings were saved for.
    pub package_sha256: String,
    pub identity: ArtifactIdentity,
    /// Where that package was installed when saved, to say when the file changed.
    pub model_path: PathBuf,
    /// The graphics cards, in rank order; empty for the CPU device.
    pub hardware: Vec<SavedGpu>,
    pub max_context: u32,
    pub concurrency: u32,
    pub options: LaunchOptions,
    pub created_unix_ms: u64,
    pub updated_unix_ms: u64,
}

/// What a saved profile matches on this computer now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomProfileStatus {
    /// The same package is installed and the same graphics cards are present.
    Ready,
    /// A different file is installed where the saved package was.
    ModelChanged,
    /// The saved package is not installed.
    ModelMissing,
    /// The package is installed, but the graphics cards are missing or different.
    HardwareChanged,
}

/// An installed model and its package SHA-256, when the Host knows it.
pub struct InstalledPackage<'a> {
    pub id: Uuid,
    pub path: &'a std::path::Path,
    pub identity: &'a ArtifactIdentity,
    pub sha256: Option<&'a str>,
}

impl CustomProfile {
    /// The installed model these settings apply to, and whether they still match.
    pub fn status(&self, models: &[InstalledPackage<'_>], gpus: &[Gpu]) -> (CustomProfileStatus, Option<Uuid>) {
        let Some(model) = models.iter().find(|model| {
            model.sha256 == Some(self.package_sha256.as_str()) && model.identity == &self.identity
        }) else {
            let changed = models.iter().any(|model| model.path == self.model_path);
            return (
                if changed { CustomProfileStatus::ModelChanged } else { CustomProfileStatus::ModelMissing },
                None,
            );
        };
        let present = self.hardware.iter().all(|saved| {
            gpus.iter().any(|gpu| SavedGpu::from(gpu) == *saved)
        });
        (
            if present { CustomProfileStatus::Ready } else { CustomProfileStatus::HardwareChanged },
            Some(model.id),
        )
    }

    /// The launch these settings describe for an installed model.
    pub fn request(&self, model_id: Uuid) -> LaunchRequest {
        LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            benchmark_profile: None,
            model_id,
            gpu_uuids: self.hardware.iter().map(|gpu| gpu.uuid.clone()).collect(),
            max_context: self.max_context,
            concurrency: self.concurrency,
            options: self.options.clone(),
        }
    }
}

/// A saved name: trimmed, not empty and short enough for a menu.
pub fn profile_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a name for these settings".into());
    }
    if name.chars().count() > 80 {
        return Err("Use a name of 80 characters or fewer".into());
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(uuid: &str, memory_mib: u64) -> Gpu {
        Gpu {
            uuid: uuid.into(),
            name: "NVIDIA GeForce RTX 5070 Ti".into(),
            display_name: None,
            memory_mib,
            compute_capability: Some("12.0".into()),
        }
    }

    #[test]
    fn saved_settings_match_only_the_same_package_and_cards() {
        let identity = ArtifactIdentity { model_id: "qwen3.8-27b".into(), weights_id: "smol-q2g64-mix-dflash2-q4".into() };
        let other = ArtifactIdentity { model_id: "muse-glimmer-30b".into(), weights_id: "smol-q2g64-mix-dflash-q4".into() };
        let path = PathBuf::from("/models/qwen.ginfer");
        let profile = CustomProfile {
            id: Uuid::new_v4(), name: "Long chats".into(), package_sha256: "a".repeat(64),
            identity: identity.clone(), model_path: path.clone(),
            hardware: vec![SavedGpu::from(&gpu("GPU-1", 16303))], max_context: 65536, concurrency: 1,
            options: LaunchOptions::default(), created_unix_ms: 1, updated_unix_ms: 1,
        };
        let id = Uuid::new_v4();
        let sha = "a".repeat(64);
        let same = [InstalledPackage { id, path: &path, identity: &identity, sha256: Some(&sha) }];
        assert_eq!(profile.status(&same, &[gpu("GPU-1", 16303)]), (CustomProfileStatus::Ready, Some(id)));
        assert_eq!(profile.request(id).gpu_uuids, vec!["GPU-1".to_string()]);
        // Another card, or the same card with different memory, is different hardware.
        assert_eq!(profile.status(&same, &[gpu("GPU-2", 16303)]).0, CustomProfileStatus::HardwareChanged);
        assert_eq!(profile.status(&same, &[gpu("GPU-1", 8192)]).0, CustomProfileStatus::HardwareChanged);
        let changed_sha = "b".repeat(64);
        let changed = [InstalledPackage { id, path: &path, identity: &identity, sha256: Some(&changed_sha) }];
        assert_eq!(profile.status(&changed, &[gpu("GPU-1", 16303)]), (CustomProfileStatus::ModelChanged, None));
        let unknown = [InstalledPackage { id, path: &path, identity: &identity, sha256: None }];
        assert_eq!(profile.status(&unknown, &[gpu("GPU-1", 16303)]).0, CustomProfileStatus::ModelChanged);
        let elsewhere = PathBuf::from("/models/muse.ginfer");
        let missing = [InstalledPackage { id, path: &elsewhere, identity: &other, sha256: Some(&sha) }];
        assert_eq!(profile.status(&missing, &[gpu("GPU-1", 16303)]).0, CustomProfileStatus::ModelMissing);
        assert_eq!(profile_name("  Fast  ").unwrap(), "Fast");
        assert!(profile_name(" ").is_err());
        assert!(profile_name(&"x".repeat(81)).is_err());
    }
}
