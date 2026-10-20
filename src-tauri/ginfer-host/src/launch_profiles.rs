//! Recorded launch configurations shared by the menu and desktop clients.
use crate::{
    engine_host::LaunchOptions,
    engine_inventory::ArtifactIdentity,
    service::{Gpu, ModelEntry},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::Path};

pub const HEADROOM_BYTES: u64 = 1 << 30;
pub const MIN_PROFILE_HEADROOM_BYTES: u64 = 300 * 1024 * 1024;
/// GInfer's `--cpu-ram-headroom-gib` default.
pub const CPU_DEFAULT_HEADROOM_GIB: u64 = 4;

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
    /// Graphics-card requirement; empty/zero on a CPU-device profile.
    #[serde(default)]
    pub gpu_name: String,
    #[serde(default)]
    pub compute_capability: String,
    #[serde(default)]
    pub vram_tier_gib: u32,
    #[serde(default)]
    pub min_memory_mib_per_gpu: u64,
    /// CPU-device requirement: the tested processor path and RAM class.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpu: Option<CpuRequirement>,
    pub max_context: u32,
    pub concurrency: u32,
    #[serde(deserialize_with = "recorded_options")]
    pub options: LaunchOptions,
    pub qualification: Qualification,
}

fn recorded_options<'de, D>(deserializer: D) -> Result<LaunchOptions, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let mut options = serde_json::Map::<String, serde_json::Value>::deserialize(deserializer)?;
    // Catalog omission records the Engine's OFF default.
    options.entry("structured_outputs".to_owned()).or_insert(false.into());
    serde_json::from_value(serde_json::Value::Object(options)).map_err(serde::de::Error::custom)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CpuRequirement {
    /// `amx`, `avx512` or `avx2` (cpu_host::ISA_PATHS); a host matches its own best path.
    pub isa: String,
    /// Smallest MemTotal, in MiB, of the RAM class this entry was tested for.
    pub min_ram_mib: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Qualification {
    pub tier: QualificationTier,
    pub evidence: String,
    pub engine_revision: String,
    /// Minimum across ranks: startup for screened entries, the recorded workload otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_bytes_per_gpu: Option<u64>,
    pub full_context_requests: u32,
    /// CPU device: lowest Host MemAvailable measured while the entry served its smoke.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_free_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculation: Option<CapacityCalculation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoke_requests: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QualificationTier {
    FullContextTested,
    ScreenedStartup,
    CalculatedStartupSmoke,
    CalculatedPendingValidation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapacityCalculation {
    pub required_kv_bytes_per_rank: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_kv_bytes_per_rank: Option<u64>,
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
    /// CPU-device entries carry a processor path and RAM class instead of a graphics card.
    fn validate_cpu(&self) -> Result<(), String> {
        let fail = || format!("invalid or unqualified launch profile: {}", self.id);
        let Some(cpu) = &self.cpu else { return Err(fail()) };
        let headroom = self.options.cpu_ram_headroom_gib.unwrap_or(CPU_DEFAULT_HEADROOM_GIB) << 30;
        if self.id.is_empty()
            || self.name.trim().is_empty()
            || !matches!(self.platform.as_str(), "linux" | "windows")
            || !crate::cpu_host::ISA_PATHS.contains(&cpu.isa.as_str())
            || cpu.min_ram_mib == 0
            || !self.gpu_name.is_empty()
            || !self.compute_capability.is_empty()
            || self.vram_tier_gib != 0
            || self.min_memory_mib_per_gpu != 0
            || self.artifact_bytes == 0
            || self.artifact_sha256.len() != 64
            || !self.artifact_sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || (self.tp, self.draft_tp) != (1, 0)
            || !(1..=8).contains(&self.concurrency)
            || self.max_context == 0
            || self.identity.weights_id.is_empty()
            || self.qualification.evidence.trim().is_empty()
            || self.qualification.engine_revision.trim().is_empty()
            || self.qualification.free_bytes_per_gpu.is_some()
            || self.qualification.calculation.is_some()
            || self.qualification.host_free_bytes.is_none_or(|free| free < headroom)
        {
            return Err(fail());
        }
        let evidence_valid = match self.qualification.tier {
            QualificationTier::FullContextTested => {
                self.qualification.full_context_requests == self.concurrency
                    && self.qualification.smoke_requests.is_none()
            }
            QualificationTier::ScreenedStartup => {
                self.qualification.full_context_requests == 0
                    && self.qualification.smoke_requests == Some(self.concurrency)
            }
            _ => false,
        };
        if !evidence_valid {
            return Err(fail());
        }
        if self.max_context > self.options.validate_target(&self.identity, self.tp, self.draft_tp)? {
            return Err(fail());
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.options.is_cpu() {
            return self.validate_cpu();
        }
        let fail = || format!("invalid or unqualified launch profile: {}", self.id);
        if self.cpu.is_some() || self.qualification.host_free_bytes.is_some() {
            return Err(fail());
        }
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
            || self.options.kv_arena_headroom_bytes < MIN_PROFILE_HEADROOM_BYTES
        {
            return Err(fail());
        }
        let evidence_valid = match self.qualification.tier {
            QualificationTier::FullContextTested => {
                self.qualification.full_context_requests == self.concurrency
                    && self.qualification.calculation.is_none()
                    && self.qualification.smoke_requests.is_none()
            }
            QualificationTier::ScreenedStartup => {
                self.qualification.full_context_requests == 0
                    && self.qualification.smoke_requests == Some(self.concurrency)
                    && self.qualification.calculation.is_none()
            }
            QualificationTier::CalculatedStartupSmoke => {
                self.qualification.full_context_requests == 0
                    && self.qualification.smoke_requests == Some(self.concurrency)
                    && self.qualification.calculation.as_ref().is_some_and(|calculation| {
                        calculation.required_kv_bytes_per_rank > 0
                            && calculation.available_kv_bytes_per_rank.is_some_and(|available| {
                                let arena = self.options.kv_arena_bytes.unwrap_or(available);
                                calculation.required_kv_bytes_per_rank <= arena && arena <= available
                            })
                    })
            }
            QualificationTier::CalculatedPendingValidation => {
                self.qualification.full_context_requests == 0
                    && self.qualification.free_bytes_per_gpu.is_none()
                    && self.qualification.smoke_requests.is_none()
                    && self.qualification.calculation.as_ref().is_some_and(|calculation| {
                        calculation.required_kv_bytes_per_rank > 0
                            && self.options.kv_arena_bytes.is_none_or(|arena| calculation.required_kv_bytes_per_rank <= arena)
                            && calculation.available_kv_bytes_per_rank.is_none()
                    })
            }
        };
        let measured_guard_valid = self.qualification.tier == QualificationTier::CalculatedPendingValidation
            || self.qualification.free_bytes_per_gpu.is_some_and(|free| free >= self.options.kv_arena_headroom_bytes);
        if !evidence_valid || !measured_guard_valid {
            return Err(fail());
        }
        let maximum = self.options.validate_target(&self.identity, self.tp, self.draft_tp)?;
        if self.max_context > maximum {
            return Err(fail());
        }
        if (self.identity.weights_id.contains("nvfp4") || self.options.kv_dtype == "nvfp4")
            && self.compute_capability != "12.0"
        {
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

    /// Launch choices on this host: GPU groups, or one empty group for a CPU-device entry whose
    /// processor path and RAM class match. The Engine's quote still checks free RAM.
    pub fn launch_groups(&self, gpus: &[Gpu], reserved: &BTreeSet<String>, host: &crate::cpu_host::CpuFacts) -> Vec<Vec<String>> {
        let Some(cpu) = self.cpu.as_ref().filter(|_| self.options.is_cpu()) else {
            return self.gpu_groups(gpus, reserved);
        };
        let ram_class = host.total_ram_bytes.is_some_and(|total| total >= cpu.min_ram_mib << 20);
        if self.platform == std::env::consts::OS && host.isa_path == Some(cpu.isa.as_str()) && ram_class {
            vec![vec![]]
        } else {
            vec![]
        }
    }

    /// Each group is an independent choice. P2P and available memory are checked by the engine.
    pub fn gpu_groups(&self, gpus: &[Gpu], reserved: &BTreeSet<String>) -> Vec<Vec<String>> {
        if self.options.is_cpu() {
            return vec![];
        }
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
            .map(|g| g.uuid.as_str())
            .collect();
        fn choose<'a>(all: &[&'a str], n: usize, picked: &mut Vec<&'a str>, out: &mut Vec<Vec<String>>) {
            if n == 0 {
                out.push(picked.iter().map(|uuid| (*uuid).to_owned()).collect());
                return;
            }
            if all.len() < n {
                return;
            }
            for i in 0..=all.len() - n {
                picked.push(all[i]);
                choose(&all[i + 1..], n - 1, picked, out);
                picked.pop();
            }
        }
        let mut result = vec![];
        choose(&eligible, self.tp as usize, &mut vec![], &mut result);
        result
    }

    pub fn verify_payload(&self, path: &Path) -> Result<(), String> {
        crate::payload_verification::verify(path, &self.artifact_sha256, self.artifact_bytes, None)
            .map(|_| ())
            .map_err(profile_verification_error)
    }
}

// Keep the existing qualification errors for callers and the Manager UI.
pub(crate) fn profile_verification_error(error: String) -> String {
    match error.as_str() {
        "payload size mismatch" => "profile artifact size mismatch".into(),
        "SHA256 mismatch" => "profile does not qualify this artifact payload".into(),
        _ => error,
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
            cpu: None,
            max_context: 65536,
            concurrency: 4,
            options: LaunchOptions {
                kv_arena_bytes: Some(4096),
                ..LaunchOptions::default()
            },
            qualification: Qualification {
                tier: QualificationTier::FullContextTested,
                calculation: None,
                smoke_requests: None,
                evidence: "synthetic test only".into(),
                engine_revision: "fixture".into(),
                free_bytes_per_gpu: Some(HEADROOM_BYTES),
                full_context_requests: 4,
                host_free_bytes: None,
            },
        }
    }

    #[test]
    fn flash_profiles_admit_exact_weights_context_and_mtp_without_dflash_tp() {
        let mut p = profile();
        p.identity.model_id = "qwen3.8-flash-next".into();
        p.max_context = 262144;
        for weights in ["groupwise-int", "smol-q2g64", "nvfp4"] {
            p.identity.weights_id = weights.into();
            for tp in [1, 2, 4] {
                p.tp = tp;
                for spec in ["auto", "none", "mtp"] {
                    p.options.spec = spec.into();
                    p.options.draft_tokens = if spec == "mtp" { 16 } else { 0 };
                    for policy in ["auto", "fixed"] {
                        p.options.draft_policy = policy.into();
                        p.validate().unwrap();
                    }
                }
            }
        }
        p.max_context += 1;
        assert!(p.validate().is_err());
        p.max_context = 262144;
        p.options.draft_policy = "adaptive".into();
        assert!(p.validate().is_err());
        p.options.draft_policy = "auto".into();
        p.options.spec = "dflash".into();
        p.options.draft_tokens = 4;
        assert!(p.validate().is_err());
        p.options.spec = "auto".into();
        p.options.draft_tokens = 0;
        for obsolete in ["groupwise-int-mtp", "smol-q2g64-mtp", "nvfp4-mtp", "nvfp4-dflash2-q4"] {
            p.identity.weights_id = obsolete.into();
            assert!(p.validate().is_err());
        }
        p.identity.weights_id = "nvfp4".into();
        p.draft_tp = 1;
        assert!(p.validate().is_err());
        p.draft_tp = 0;
        p.options.draft_tp = 1;
        assert!(p.validate().is_err());
        p.options.draft_tp = 0;
        p.compute_capability = "8.6".into();
        assert!(p.validate().is_err());
        p.identity.weights_id = "groupwise-int".into();
        p.validate().unwrap();
    }

    #[test]
    fn mtp_is_not_a_qwen_27b_or_muse_speculation_backend() {
        let mut p = profile();
        p.options.spec = "mtp".into();
        p.options.draft_tokens = 3;
        for model in ["qwen3.8-27b", "muse-glimmer-30b", "qwen3.8-flash", "unknown"] {
            p.identity.model_id = model.into();
            assert!(p.validate().is_err());
        }
    }
    #[test]
    fn vision_dflash_capability_is_independent_of_evidence_tier() {
        let mut p = profile();
        p.identity.model_id = "qwen3.8-27b".into();
        p.identity.weights_id = "groupwise-int-dflash2-q4".into();
        p.draft_tp = 1;
        p.options.draft_tp = 1;
        p.options.vision = true;
        p.options.spec = "dflash".into();
        p.validate().unwrap();
        p.options.draft_tokens = 8;
        assert!(p.validate().is_err());
    }

    #[test]
    fn pending_profiles_do_not_invent_measured_memory_or_smoke() {
        let mut p = profile();
        p.qualification.tier = QualificationTier::CalculatedPendingValidation;
        p.qualification.full_context_requests = 0;
        p.qualification.free_bytes_per_gpu = None;
        p.qualification.calculation = Some(CapacityCalculation {
            required_kv_bytes_per_rank: 4096,
            available_kv_bytes_per_rank: None,
        });
        p.identity.model_id = "qwen3.8-27b".into();
        p.identity.weights_id = "groupwise-int-dflash2-q4".into();
        p.draft_tp = 1;
        p.options.draft_tp = 1;
        p.options.vision = true;
        p.options.spec = "dflash".into();
        p.validate().unwrap();
        p.qualification.free_bytes_per_gpu = Some(HEADROOM_BYTES);
        assert!(p.validate().is_err());
        p.qualification.free_bytes_per_gpu = None;
        p.qualification.smoke_requests = Some(4);
        assert!(p.validate().is_err());
        p.qualification.smoke_requests = None;
        p.qualification.calculation.as_mut().unwrap().available_kv_bytes_per_rank = Some(4096);
        assert!(p.validate().is_err());
    }

    #[test]
    fn supplied_release_catalogs_validate_with_exact_admitted_settings() {
        let Some(paths) = std::env::var_os("GINFER_PROFILE_CATALOGS") else {
            return;
        };
        let mut ids = BTreeSet::new();
        let mut screened_pro_found = false;
        let supplied_paths: Vec<_> = std::env::split_paths(&paths).collect();
        let laptop_context_limits = [
            (
                "linux-rtx3090-qwen38-groupwise-int-dflash2-q4.json",
                "rtx3090-qwen38-groupwise-int-dflash2-q4-tp1-c1-168k-int8",
                161792,
            ),
            (
                "linux-rtx4090-qwen38-groupwise-int-dflash2-q4.json",
                "rtx4090-qwen38-groupwise-int-dflash2-q4-tp1-c1-149069-int8",
                138240,
            ),
            (
                "linux-rtx3090-qwen38-groupwise-int-dflash2-q4-vision.json",
                "rtx3090-qwen38-groupwise-int-dflash2-q4-tp1-c1-168k-int8-vision-calculated",
                82944,
            ),
            (
                "linux-rtx4090-qwen38-groupwise-int-dflash2-q4-vision.json",
                "rtx4090-qwen38-groupwise-int-dflash2-q4-tp1-c1-149069-int8-vision-calculated",
                60416,
            ),
        ];
        let expected_laptop_ids: BTreeSet<_> = laptop_context_limits
            .iter()
            .filter(|(file, _, _)| {
                supplied_paths
                    .iter()
                    .any(|path| path.file_name().is_some_and(|name| name == *file))
            })
            .map(|(_, id, _)| *id)
            .collect();
        let mut laptop_ids = BTreeSet::new();
        let consumer_qwen_settings = [
            (
                "linux-rtx5090-qwen38-smol-q2g64-mix-dflash2-q4.json",
                "rtx5090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-screened",
                "linux", "NVIDIA GeForce RTX 5090", "12.0", 32, 32606, 131072, 448790528,
                "aa1c480162683d6da344456e2ccf0c14d2d291a3", 0,
            ),
            (
                "linux-rtx4090-qwen38-smol-q2g64-mix-dflash2-q4.json",
                "rtx4090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-screened",
                "linux", "NVIDIA GeForce RTX 4090", "8.9", 24, 24563, 131072, 316039168,
                "72153af017f4e3d864b47e5df6d62dc7a83357bf", 1024,
            ),
            (
                "linux-rtx3080ti-laptop-qwen38-smol-q2g64-mix-dflash2-q4.json",
                "rtx3080ti-laptop-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-74k-int8-screened",
                "linux", "NVIDIA GeForce RTX 3080 Ti Laptop GPU", "8.6", 16, 16384, 75776, 316555264,
                "72153af017f4e3d864b47e5df6d62dc7a83357bf", 1024,
            ),
            (
                "windows-rtx5090-qwen38-smol-q2g64-mix-dflash2-q4.json",
                "rtx5090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-windows-screened",
                "windows", "NVIDIA GeForce RTX 5090", "12.0", 32, 32606, 131072, 373293056,
                "6b85ecf77da129fe332818b8bcaec9467b56bdaa", 0,
            ),
            (
                "windows-rtx4090-qwen38-smol-q2g64-mix-dflash2-q4.json",
                "rtx4090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-windows-screened",
                "windows", "NVIDIA GeForce RTX 4090", "8.9", 24, 24563, 131072, 316669952,
                "6b85ecf77da129fe332818b8bcaec9467b56bdaa", 1024,
            ),
        ];
        let expected_consumer_ids: BTreeSet<_> = consumer_qwen_settings
            .iter()
            .filter(|(file, ..)| {
                supplied_paths
                    .iter()
                    .any(|path| path.file_name().is_some_and(|name| name == *file))
            })
            .map(|(_, id, ..)| *id)
            .collect();
        let mut consumer_ids = BTreeSet::new();
        struct MuseSetting {
            file: &'static str,
            id: &'static str,
            platform: &'static str,
            gpu: &'static str,
            cc: &'static str,
            tier: u32,
            memory: u64,
            context: u32,
            concurrency: u32,
            vision: bool,
            /// Saved explicit arena; `None` is Automatic KV.
            arena: Option<u64>,
            /// Final arena witnessed by the calculated startup smoke.
            available: Option<u64>,
            prefill: u32,
            free: u64,
            required: Option<u64>,
            engine: &'static str,
        }
        let consumer_muse_settings = [
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 8, vision: false, arena: Some(15189450752), available: Some(15189450752),
                prefill: 1024, free: 328204288, required: Some(8336650240),
                engine: "eb777ab9570fad1c8301635617f0923f2b820424",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 8, vision: false, arena: Some(9091153920), available: Some(9091153920),
                prefill: 1024, free: 316669952, required: Some(8643358720),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c8-8k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 8192, concurrency: 8, vision: false, arena: Some(1593835520), available: Some(1593835520),
                prefill: 1024, free: 316669952, required: Some(1582880768),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 131072, concurrency: 1, vision: false, arena: Some(2965372928), available: Some(2965372928),
                prefill: 1024, free: 316669952, required: Some(1042081280),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 131072, concurrency: 2, vision: false, arena: Some(2715811840), available: Some(2715811840),
                prefill: 1024, free: 316669952, required: Some(2084162560),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c4-60k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 61440, concurrency: 4, vision: false, arena: Some(2260729856), available: Some(2260729856),
                prefill: 1024, free: 316669952, required: Some(2254770176),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c7-16k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 16384, concurrency: 7, vision: false, arena: Some(1797259264), available: Some(1797259264),
                prefill: 1024, free: 316669952, required: Some(1779305472),
                engine: "72153af017f4e3d864b47e5df6d62dc7a83357bf",
            },
            MuseSetting {
                file: "windows-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-windows-screened",
                platform: "windows", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 8, vision: false, arena: None, available: None,
                prefill: 1024, free: 449839104, required: None,
                engine: "6b85ecf77da129fe332818b8bcaec9467b56bdaa",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 8, vision: false, arena: None, available: Some(86585114624),
                prefill: 1024, free: 315621376, required: Some(8336650240),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 4, vision: false, arena: None, available: Some(87090528256),
                prefill: 1024, free: 315621376, required: Some(4168325120),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 2, vision: false, arena: None, available: Some(87455432704),
                prefill: 1024, free: 315621376, required: Some(2084162560),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 1, vision: false, arena: None, available: Some(87688216576),
                prefill: 1024, free: 315621376, required: Some(1042081280),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 8, vision: true, arena: None, available: Some(84448116736),
                prefill: 1024, free: 315621376, required: Some(8336650240),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 4, vision: true, arena: None, available: Some(85320531968),
                prefill: 1024, free: 315621376, required: Some(4168325120),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 2, vision: true, arena: None, available: Some(85769322496),
                prefill: 1024, free: 315621376, required: Some(2084162560),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx-pro6000-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", cc: "12.0", tier: 96, memory: 97887,
                context: 131072, concurrency: 1, vision: true, arena: None, available: Some(86094381056),
                prefill: 1024, free: 315621376, required: Some(1042081280),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 4, vision: false, arena: None, available: Some(9948889088),
                prefill: 1024, free: 315621376, required: Some(4321679360),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 2, vision: false, arena: None, available: Some(10500440064),
                prefill: 1024, free: 315621376, required: Some(2160839680),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 1, vision: false, arena: None, available: Some(10810818560),
                prefill: 1024, free: 315621376, required: Some(1080419840),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c8-98k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 100352, concurrency: 8, vision: true, arena: None, available: Some(6985613312),
                prefill: 1024, free: 315621376, required: Some(6954915840),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 4, vision: true, arena: None, available: Some(8178892800),
                prefill: 1024, free: 315621376, required: Some(4321679360),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 2, vision: true, arena: None, available: Some(8814329856),
                prefill: 1024, free: 315621376, required: Some(2160839680),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx4090-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 131072, concurrency: 1, vision: true, arena: None, available: Some(9216983040),
                prefill: 1024, free: 315621376, required: Some(1080419840),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c2-61k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 62464, concurrency: 2, vision: true, arena: None, available: Some(1142947840),
                prefill: 1024, free: 316669952, required: Some(1141442560),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 131072, concurrency: 1, vision: true, arena: None, available: Some(1484783616),
                prefill: 1024, free: 316669952, required: Some(1042081280),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 4, vision: false, arena: None, available: Some(16844324864),
                prefill: 1024, free: 454033408, required: Some(4168325120),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 2, vision: false, arena: None, available: Some(17148411904),
                prefill: 1024, free: 652214272, required: Some(2084162560),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 1, vision: false, arena: None, available: Some(17379098624),
                prefill: 1024, free: 658505728, required: Some(1042081280),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 8, vision: true, arena: None, available: Some(14145290240),
                prefill: 1024, free: 516947968, required: Some(8336650240),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c4-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 4, vision: true, arena: None, available: Some(15013511168),
                prefill: 1024, free: 492830720, required: Some(4168325120),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c2-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 2, vision: true, arena: None, available: Some(15510536192),
                prefill: 1024, free: 632291328, required: Some(2084162560),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            MuseSetting {
                file: "linux-rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-vision.json",
                id: "rtx5090-muse-glimmer-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-vision-calculated",
                platform: "linux", gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 131072, concurrency: 1, vision: true, arena: None, available: Some(15814623232),
                prefill: 1024, free: 584056832, required: Some(1042081280),
                engine: "c7bdb4673d3f4c3128c69d5b15ca353f85969250",
            },
            // MUSE-MIX-PROFILES (end)
        ];
        let expected_muse_ids: BTreeSet<_> = consumer_muse_settings
            .iter()
            .filter(|s| {
                supplied_paths
                    .iter()
                    .any(|path| path.file_name().is_some_and(|name| name == s.file))
            })
            .map(|s| s.id)
            .collect();
        let mut muse_ids = BTreeSet::new();
        // Flash pure 2-bit 8bbb85bf consumer entries: one screened C8 profile per card.
        struct FlashSetting {
            file: &'static str,
            id: &'static str,
            gpu: &'static str,
            cc: &'static str,
            tier: u32,
            memory: u64,
            context: u32,
            free: u64,
            engine: &'static str,
        }
        let consumer_flash_settings = [
            FlashSetting {
                file: "linux-rtx5090-flash-next-smol-q2g64.json",
                id: "rtx5090-flash-next-smol-q2g64-tp1-c8-256k-int8-screened",
                gpu: "NVIDIA GeForce RTX 5090", cc: "12.0", tier: 32, memory: 32606,
                context: 262144, free: 1051721728,
                engine: "aa1c480162683d6da344456e2ccf0c14d2d291a3",
            },
            FlashSetting {
                file: "linux-rtx4090-flash-next-smol-q2g64.json",
                id: "rtx4090-flash-next-smol-q2g64-tp1-c8-137k-int8-screened",
                gpu: "NVIDIA GeForce RTX 4090", cc: "8.9", tier: 24, memory: 24564,
                context: 140288, free: 1098907648,
                engine: "bec3a90404b7e68d1d00dea5978ada12bdbf7f24",
            },
            FlashSetting {
                file: "linux-rtx3080ti-laptop-flash-next-smol-q2g64.json",
                id: "rtx3080ti-laptop-flash-next-smol-q2g64-tp1-c8-66k-int8-screened",
                gpu: "NVIDIA GeForce RTX 3080 Ti Laptop GPU", cc: "8.6", tier: 16, memory: 16384,
                context: 67584, free: 1459617792,
                engine: "bec3a90404b7e68d1d00dea5978ada12bdbf7f24",
            },
        ];
        let expected_flash_ids: BTreeSet<_> = consumer_flash_settings
            .iter()
            .filter(|s| {
                supplied_paths
                    .iter()
                    .any(|path| path.file_name().is_some_and(|name| name == s.file))
            })
            .map(|s| s.id)
            .collect();
        let mut flash_ids = BTreeSet::new();
        // Qwen3.6-35B-A3B INT daf27aaf CPU-device entries: one screened entry per CPU path and
        // RAM class, smoked from its file on a host of that path (GCHAT-CPU-ONLY-LOAD).
        struct CpuSetting {
            file: &'static str,
            id: &'static str,
            isa: &'static str,
            min_ram_mib: u64,
            context: u32,
            concurrency: u32,
            host_free: u64,
            engine: &'static str,
        }
        let consumer_cpu_settings = [
            CpuSetting {
                file: "linux-cpu-amx-qwen36-35b-a3b-groupwise-int.json",
                id: "cpu-amx-qwen36-35b-a3b-groupwise-int-tp1-c8-256k-int8-screened",
                isa: "amx", min_ram_mib: 92160, context: 262144, concurrency: 8,
                host_free: CPU_AMX_HOST_FREE, engine: CPU_ENGINE,
            },
            CpuSetting {
                file: "linux-cpu-avx512-qwen36-35b-a3b-groupwise-int.json",
                id: "cpu-avx512-qwen36-35b-a3b-groupwise-int-tp1-c4-256k-int8-screened",
                isa: "avx512", min_ram_mib: 61440, context: 262144, concurrency: 4,
                host_free: 57744515072, engine: CPU_ENGINE,
            },
            CpuSetting {
                file: "linux-cpu-avx2-qwen36-35b-a3b-groupwise-int.json",
                id: "cpu-avx2-qwen36-35b-a3b-groupwise-int-tp1-c1-256k-int8-screened",
                isa: "avx2", min_ram_mib: 40960, context: 262144, concurrency: 1,
                host_free: CPU_AVX2_HOST_FREE, engine: CPU_ENGINE,
            },
        ];
        let expected_cpu_ids: BTreeSet<_> = consumer_cpu_settings
            .iter()
            .filter(|s| supplied_paths.iter().any(|path| path.file_name().is_some_and(|name| name == s.file)))
            .map(|s| s.id)
            .collect();
        let mut cpu_ids = BTreeSet::new();
        let screened_pro_supplied = supplied_paths.iter().any(|path| {
            path.file_name().is_some_and(|name| {
                name == "linux-rtx-pro6000-flash-next-smol-q2g64.json"
            })
        });
        for path in supplied_paths {
            let profiles = ProfileCatalog::read(&path).unwrap();
            assert!(!profiles.is_empty(), "{}", path.display());
            let muse_catalog_ids: BTreeSet<_> = consumer_muse_settings
                .iter()
                .filter(|s| path.file_name().is_some_and(|name| name == s.file))
                .map(|s| s.id)
                .collect();
            if !muse_catalog_ids.is_empty() {
                let actual_ids: BTreeSet<_> = profiles.iter().map(|p| p.id.as_str()).collect();
                assert_eq!(actual_ids, muse_catalog_ids, "{}", path.display());
            }
            let flash_catalog_ids: BTreeSet<_> = consumer_flash_settings
                .iter()
                .filter(|s| path.file_name().is_some_and(|name| name == s.file))
                .map(|s| s.id)
                .collect();
            if !flash_catalog_ids.is_empty() {
                let actual_ids: BTreeSet<_> = profiles.iter().map(|p| p.id.as_str()).collect();
                assert_eq!(actual_ids, flash_catalog_ids, "{}", path.display());
            }
            let cpu_catalog_ids: BTreeSet<_> = consumer_cpu_settings
                .iter()
                .filter(|s| path.file_name().is_some_and(|name| name == s.file))
                .map(|s| s.id)
                .collect();
            if !cpu_catalog_ids.is_empty() {
                let actual_ids: BTreeSet<_> = profiles.iter().map(|p| p.id.as_str()).collect();
                assert_eq!(actual_ids, cpu_catalog_ids, "{}", path.display());
            }
            for p in profiles {
                assert!(ids.insert(p.id.clone()), "duplicate {}", p.id);
                if let Some((_, id, max_context)) = laptop_context_limits
                    .iter()
                    .find(|(_, id, _)| p.id == *id)
                {
                    assert_eq!(p.max_context, *max_context, "{}", p.id);
                    laptop_ids.insert(*id);
                }
                if let Some((_, id, platform, gpu, cc, tier, memory, context, free, engine, prefill)) = consumer_qwen_settings
                    .iter()
                    .find(|(_, id, ..)| p.id == *id)
                {
                    consumer_ids.insert(*id);
                    assert_eq!(p.platform, *platform);
                    assert_eq!(p.identity.model_id, "qwen3.8-27b");
                    assert_eq!(p.identity.weights_id, "smol-q2g64-mix-dflash2-q4");
                    assert_eq!(p.artifact_sha256, "483343c28912ae5db3d00478f16fffb10dcbb0c1317f8c90c09c396fcb6e4ca4");
                    assert_eq!(p.artifact_bytes, 10667321600);
                    assert_eq!((p.tp, p.draft_tp, p.concurrency), (1, 1, 8));
                    assert_eq!((p.gpu_name.as_str(), p.compute_capability.as_str()), (*gpu, *cc));
                    assert_eq!((p.vram_tier_gib, p.min_memory_mib_per_gpu, p.max_context), (*tier, *memory, *context));
                    assert_eq!(p.options, LaunchOptions {
                        vision: false,
                        structured_outputs: false,
                        progressive_ready: false,
                        spec: "dflash".into(),
                        draft_policy: "fixed".into(),
                        draft_tokens: 7,
                        draft_tp: 1,
                        kv_dtype: "int8".into(),
                        kv_arena_bytes: None,
                        vram_budget_bytes: None,
                        kv_arena_headroom_bytes: MIN_PROFILE_HEADROOM_BYTES,
                        host_kv_cache_bytes: None,
                        prefill_chunk: *prefill,
                        no_cuda_graph: false,
                        ..LaunchOptions::default()
                    }, "{}", p.id);
                    assert_eq!(p.qualification.tier, QualificationTier::ScreenedStartup);
                    assert_eq!(p.qualification.engine_revision, *engine);
                    assert_eq!(p.qualification.free_bytes_per_gpu, Some(*free));
                    assert_eq!(p.qualification.full_context_requests, 0);
                    assert_eq!(p.qualification.smoke_requests, Some(8));
                    assert!(p.qualification.calculation.is_none());
                }
                if let Some(s) = consumer_muse_settings.iter().find(|s| p.id == s.id) {
                    muse_ids.insert(s.id);
                    assert_eq!(p.platform, s.platform);
                    assert_eq!(p.identity.model_id, "muse-glimmer-30b");
                    assert_eq!(p.identity.weights_id, "smol-q2g64-mix-dflash-q4");
                    assert_eq!(p.artifact_sha256, "9d4ca1b204b993e3a5dd9e52c8eda0d804801dd4ded664dd37b81641fcb44a2c");
                    assert_eq!(p.artifact_bytes, 13838508544);
                    assert_eq!((p.tp, p.draft_tp, p.concurrency), (1, 1, s.concurrency));
                    assert_eq!((p.gpu_name.as_str(), p.compute_capability.as_str()), (s.gpu, s.cc));
                    assert_eq!((p.vram_tier_gib, p.min_memory_mib_per_gpu, p.max_context), (s.tier, s.memory, s.context));
                    assert_eq!(p.options, LaunchOptions {
                        vision: s.vision,
                        structured_outputs: false,
                        progressive_ready: false,
                        spec: "dflash".into(),
                        draft_policy: "fixed".into(),
                        draft_tokens: 7,
                        draft_tp: 1,
                        kv_dtype: "int8".into(),
                        kv_arena_bytes: s.arena,
                        vram_budget_bytes: None,
                        kv_arena_headroom_bytes: MIN_PROFILE_HEADROOM_BYTES,
                        host_kv_cache_bytes: None,
                        prefill_chunk: s.prefill,
                        no_cuda_graph: false,
                        ..LaunchOptions::default()
                    }, "{}", p.id);
                    assert_eq!(p.qualification.engine_revision, s.engine);
                    assert_eq!(p.qualification.free_bytes_per_gpu, Some(s.free));
                    assert_eq!(p.qualification.full_context_requests, 0);
                    assert_eq!(p.qualification.smoke_requests, Some(s.concurrency));
                    if let Some(required) = s.required {
                        assert_eq!(p.qualification.tier, QualificationTier::CalculatedStartupSmoke);
                        let calculation = p.qualification.calculation.as_ref().unwrap();
                        assert_eq!(calculation.required_kv_bytes_per_rank, required);
                        assert_eq!(calculation.available_kv_bytes_per_rank, s.available);
                    } else {
                        assert_eq!(p.qualification.tier, QualificationTier::ScreenedStartup);
                        assert!(p.qualification.calculation.is_none());
                    }
                }
                if consumer_qwen_settings.iter().any(|(_, id, ..)| p.id == *id)
                    || consumer_muse_settings.iter().any(|s| p.id == s.id)
                    || consumer_flash_settings.iter().any(|s| p.id == s.id)
                {
                    let gpu = Gpu {
                        uuid: "GPU-consumer".into(),
                        name: p.gpu_name.clone(),
                        display_name: None,
                        memory_mib: p.min_memory_mib_per_gpu,
                        compute_capability: Some(p.compute_capability.clone()),
                    };
                    let groups = p.gpu_groups(std::slice::from_ref(&gpu), &BTreeSet::new());
                    if p.platform == std::env::consts::OS {
                        assert_eq!(groups, vec![vec![gpu.uuid.clone()]], "{}", p.id);
                        assert!(p.gpu_groups(std::slice::from_ref(&gpu), &BTreeSet::from([gpu.uuid.clone()])).is_empty());
                    } else {
                        assert!(groups.is_empty(), "{}", p.id);
                    }
                }
                if let Some(s) = consumer_flash_settings.iter().find(|s| p.id == s.id) {
                    flash_ids.insert(s.id);
                    assert_eq!(p.platform, "linux");
                    assert_eq!(p.identity.model_id, "qwen3.8-flash-next");
                    assert_eq!(p.identity.weights_id, "smol-q2g64");
                    assert_eq!(p.artifact_sha256, "8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08");
                    assert_eq!(p.artifact_bytes, 70247086080);
                    assert_eq!((p.tp, p.draft_tp, p.concurrency), (1, 0, 8));
                    assert_eq!((p.gpu_name.as_str(), p.compute_capability.as_str()), (s.gpu, s.cc));
                    assert_eq!((p.vram_tier_gib, p.min_memory_mib_per_gpu, p.max_context), (s.tier, s.memory, s.context));
                    assert_eq!(p.options, LaunchOptions {
                        vision: false,
                        structured_outputs: false,
                        progressive_ready: false,
                        spec: "mtp".into(),
                        draft_policy: "fixed".into(),
                        draft_tokens: 3,
                        draft_tp: 0,
                        kv_dtype: "int8".into(),
                        kv_arena_bytes: None,
                        vram_budget_bytes: None,
                        kv_arena_headroom_bytes: MIN_PROFILE_HEADROOM_BYTES,
                        host_kv_cache_bytes: None,
                        prefill_chunk: 0,
                        no_cuda_graph: false,
                        flash_host_ram_headroom_gib: Some(10),
                        expert_lfu: true,
                        device: "gpu".into(),
                        cpu_ram_headroom_gib: None,
                    }, "{}", p.id);
                    assert_eq!(p.qualification.tier, QualificationTier::ScreenedStartup);
                    assert_eq!(p.qualification.engine_revision, s.engine);
                    assert_eq!(p.qualification.free_bytes_per_gpu, Some(s.free));
                    assert_eq!(p.qualification.full_context_requests, 0);
                    assert_eq!(p.qualification.smoke_requests, Some(8));
                    assert!(p.qualification.calculation.is_none());
                }
                if let Some(s) = consumer_cpu_settings.iter().find(|s| p.id == s.id) {
                    cpu_ids.insert(s.id);
                    assert_eq!(p.platform, "linux");
                    assert_eq!(p.identity.model_id, "qwen3.6-35b-a3b");
                    assert_eq!(p.identity.weights_id, "groupwise-int");
                    assert_eq!(p.artifact_sha256, "daf27aafd5f461f81de9a7fa63b8c3f1e56c3ac42b2da858842275879b90bdfa");
                    assert_eq!(p.artifact_bytes, 20016414464);
                    assert_eq!((p.tp, p.draft_tp, p.concurrency, p.max_context), (1, 0, s.concurrency, s.context));
                    assert_eq!(p.cpu, Some(CpuRequirement { isa: s.isa.into(), min_ram_mib: s.min_ram_mib }));
                    assert_eq!((p.gpu_name.as_str(), p.compute_capability.as_str(), p.vram_tier_gib, p.min_memory_mib_per_gpu), ("", "", 0, 0));
                    assert_eq!(p.options, LaunchOptions {
                        device: "cpu".into(),
                        vision: false,
                        structured_outputs: true,
                        spec: "none".into(),
                        kv_dtype: "int8".into(),
                        ..LaunchOptions::default()
                    }, "{}", p.id);
                    assert_eq!(p.qualification.tier, QualificationTier::ScreenedStartup);
                    assert_eq!(p.qualification.engine_revision, s.engine);
                    assert_eq!(p.qualification.host_free_bytes, Some(s.host_free));
                    assert_eq!(p.qualification.free_bytes_per_gpu, None);
                    assert_eq!((p.qualification.full_context_requests, p.qualification.smoke_requests), (0, Some(s.concurrency)));
                    // Matched by processor path and RAM class only; never a GPU group.
                    let host = crate::cpu_host::CpuFacts { model_name: None, isa_path: Some(s.isa),
                        logical_cpus: 16, total_ram_bytes: Some(s.min_ram_mib << 20) };
                    let gpu = Gpu { uuid: "GPU-any".into(), name: "NVIDIA GeForce RTX 4090".into(), display_name: None,
                        memory_mib: 24564, compute_capability: Some("8.9".into()) };
                    assert!(p.gpu_groups(std::slice::from_ref(&gpu), &BTreeSet::new()).is_empty());
                    assert_eq!(p.launch_groups(std::slice::from_ref(&gpu), &BTreeSet::new(), &host), vec![Vec::<String>::new()]);
                    for other in crate::cpu_host::ISA_PATHS.iter().filter(|isa| **isa != s.isa) {
                        let other = crate::cpu_host::CpuFacts { isa_path: Some(other), ..host.clone() };
                        assert!(p.launch_groups(&[], &BTreeSet::new(), &other).is_empty(), "{} on {other:?}", p.id);
                    }
                    let small = crate::cpu_host::CpuFacts { total_ram_bytes: Some((s.min_ram_mib << 20) - 1), ..host.clone() };
                    assert!(p.launch_groups(&[], &BTreeSet::new(), &small).is_empty());
                }
                if p.id == "rtx-pro6000-flash-next-smol-q2g64-tp1-c8-128k-int8-screened" {
                    screened_pro_found = true;
                    assert_eq!(p.qualification.tier, QualificationTier::ScreenedStartup);
                    assert_eq!(p.artifact_sha256, "8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08");
                    assert_eq!((p.tp, p.draft_tp, p.max_context, p.concurrency), (1, 0, 131072, 8));
                    assert_eq!(p.options.kv_dtype, "int8");
                    assert_eq!(p.options.kv_arena_bytes, None);
                    assert_eq!(p.options.kv_arena_headroom_bytes, HEADROOM_BYTES);
                    assert_eq!(p.qualification.free_bytes_per_gpu, Some(18581880832));
                    assert!(!p.options.vision && p.options.structured_outputs);
                    assert_eq!((p.options.spec.as_str(), p.options.draft_policy.as_str(), p.options.draft_tokens), ("mtp", "fixed", 3));
                }
            }
        }
        assert_eq!(screened_pro_found, screened_pro_supplied);
        assert_eq!(laptop_ids, expected_laptop_ids);
        assert_eq!(consumer_ids, expected_consumer_ids);
        assert_eq!(muse_ids, expected_muse_ids);
        assert_eq!(flash_ids, expected_flash_ids);
        assert_eq!(cpu_ids, expected_cpu_ids);
    }

    fn cpu_profile() -> LaunchProfile {
        let mut p = profile();
        p.identity = ArtifactIdentity { model_id: "qwen3.6-35b-a3b".into(), weights_id: "groupwise-int".into() };
        p.tp = 1;
        p.gpu_name.clear();
        p.compute_capability.clear();
        p.vram_tier_gib = 0;
        p.min_memory_mib_per_gpu = 0;
        p.cpu = Some(CpuRequirement { isa: "avx512".into(), min_ram_mib: 60_000 });
        p.max_context = 262144;
        p.concurrency = 1;
        p.options = LaunchOptions { device: "cpu".into(), vision: false, spec: "none".into(), kv_dtype: "int8".into(), ..LaunchOptions::default() };
        p.qualification = Qualification {
            tier: QualificationTier::ScreenedStartup, evidence: "synthetic test only".into(),
            engine_revision: "fixture".into(), free_bytes_per_gpu: None, full_context_requests: 0,
            host_free_bytes: Some(CPU_DEFAULT_HEADROOM_GIB << 30), calculation: None, smoke_requests: Some(1),
        };
        p
    }

    #[test]
    fn cpu_profiles_name_a_processor_path_and_ram_class_instead_of_a_gpu() {
        let p = cpu_profile();
        p.validate().unwrap();
        let host = crate::cpu_host::CpuFacts { model_name: None, isa_path: Some("avx512"), logical_cpus: 32,
            total_ram_bytes: Some(60_000 << 20) };
        let gpus = vec![Gpu { uuid: "GPU-a".into(), name: "Fixture GPU".into(), display_name: None,
            memory_mib: 32607, compute_capability: Some("12.0".into()) }];
        assert_eq!(p.launch_groups(&gpus, &BTreeSet::new(), &host), vec![Vec::<String>::new()]);
        assert!(p.gpu_groups(&gpus, &BTreeSet::new()).is_empty());
        for other in [
            crate::cpu_host::CpuFacts { isa_path: Some("amx"), ..host.clone() },
            crate::cpu_host::CpuFacts { isa_path: None, ..host.clone() },
            crate::cpu_host::CpuFacts { total_ram_bytes: Some((60_000 << 20) - 1), ..host.clone() },
        ] {
            assert!(p.launch_groups(&gpus, &BTreeSet::new(), &other).is_empty(), "{other:?}");
        }
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["cpu"], serde_json::json!({"isa": "avx512", "min_ram_mib": 60000}));
        let reread: LaunchProfile = serde_json::from_value(json).unwrap();
        reread.validate().unwrap();
        for invalid in [
            LaunchProfile { cpu: None, ..p.clone() },
            LaunchProfile { cpu: Some(CpuRequirement { isa: "sse4".into(), min_ram_mib: 1 }), ..p.clone() },
            LaunchProfile { gpu_name: "Fixture GPU".into(), ..p.clone() },
            LaunchProfile { tp: 2, ..p.clone() },
            LaunchProfile { options: LaunchOptions { vision: true, ..p.options.clone() }, ..p.clone() },
            LaunchProfile { qualification: Qualification { host_free_bytes: Some((4 << 30) - 1), ..p.qualification.clone() }, ..p.clone() },
            LaunchProfile { qualification: Qualification { host_free_bytes: None, ..p.qualification.clone() }, ..p.clone() },
            LaunchProfile { qualification: Qualification { free_bytes_per_gpu: Some(HEADROOM_BYTES), ..p.qualification.clone() }, ..p.clone() },
            LaunchProfile { qualification: Qualification { smoke_requests: Some(2), ..p.qualification.clone() }, ..p.clone() },
            LaunchProfile { options: LaunchOptions { device: "gpu".into(), ..p.options.clone() }, ..p.clone() },
        ] {
            assert!(invalid.validate().is_err(), "{}", invalid.id);
        }
        // A GPU entry cannot carry CPU requirements.
        assert!(LaunchProfile { cpu: p.cpu.clone(), ..profile() }.validate().is_err());
    }

    /// The CPU image (GINFER_CUDA=OFF) of the NEW-ENGINE-BUNDLE commit; host minima from each smoke.
    const CPU_ENGINE: &str = "2d54a4e318079fe0ac18c125992fb83a0f66fc24";
    const CPU_AMX_HOST_FREE: u64 = 0;
    const CPU_AVX2_HOST_FREE: u64 = 15864188928;

    #[test]
    fn screened_profiles_require_startup_guard_without_claiming_full_context_capacity() {
        let mut p = profile();
        p.qualification.tier = QualificationTier::ScreenedStartup;
        p.qualification.full_context_requests = 0;
        p.qualification.smoke_requests = Some(p.concurrency);
        p.options.kv_arena_bytes = None;
        p.validate().unwrap();
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["qualification"]["tier"], "screened-startup");
        p.qualification.full_context_requests = p.concurrency;
        assert!(p.validate().is_err());
        p.qualification.full_context_requests = 0;
        p.qualification.smoke_requests = Some(1);
        assert!(p.validate().is_err());
        p.qualification.smoke_requests = Some(p.concurrency);
        p.qualification.calculation = Some(CapacityCalculation {
            required_kv_bytes_per_rank: 4096,
            available_kv_bytes_per_rank: Some(4096),
        });
        assert!(p.validate().is_err());
        p.qualification.calculation = None;
        p.qualification.free_bytes_per_gpu = None;
        assert!(p.validate().is_err());
        p.qualification.free_bytes_per_gpu = Some(p.options.kv_arena_headroom_bytes - 1);
        assert!(p.validate().is_err());
    }

    #[test]
    fn calculated_profiles_require_capacity_and_concurrent_smoke_evidence() {
        let mut p = profile();
        p.qualification.tier = QualificationTier::CalculatedStartupSmoke;
        assert!(p.validate().is_err());
        p.qualification.full_context_requests = 0;
        p.qualification.smoke_requests = Some(p.concurrency);
        p.qualification.calculation = Some(CapacityCalculation {
            required_kv_bytes_per_rank: 4096,
            available_kv_bytes_per_rank: Some(4096),
        });
        p.validate().unwrap();
        p.qualification.smoke_requests = Some(1);
        assert!(p.validate().is_err());
        p.qualification.smoke_requests = Some(p.concurrency);
        p.qualification.calculation.as_mut().unwrap().required_kv_bytes_per_rank = 4097;
        assert!(p.validate().is_err());
        p.qualification.calculation.as_mut().unwrap().required_kv_bytes_per_rank = 4096;
        p.qualification.calculation.as_mut().unwrap().available_kv_bytes_per_rank = Some(4095);
        assert!(p.validate().is_err());
        p.qualification.calculation.as_mut().unwrap().available_kv_bytes_per_rank = Some(4096);
        p.qualification.free_bytes_per_gpu = Some(p.options.kv_arena_headroom_bytes - 1);
        assert!(p.validate().is_err());
    }

    #[test]
    fn profiles_require_full_context_headroom_and_exact_per_gpu_groups() {
        let mut p = profile();
        p.validate().unwrap();
        let mut gpus: Vec<_> = (0..4)
            .map(|i| Gpu {
                uuid: format!("GPU-{i}"),
                name: "Fixture GPU".into(), display_name: None,
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
        p.qualification.free_bytes_per_gpu = Some(HEADROOM_BYTES - 1);
        assert!(p.validate().is_err());
        p.qualification.free_bytes_per_gpu = Some(HEADROOM_BYTES);
        p.qualification.full_context_requests = 1;
        assert!(p.validate().is_err());
    }

    #[test]
    fn gpu_group_choices_preserve_input_order_and_reserved_members() {
        let mut p = profile();
        let gpus: Vec<_> = ["GPU-d", "GPU-a", "GPU-c", "GPU-b"].into_iter().map(|uuid| Gpu {
            uuid: uuid.into(), name: "Fixture GPU".into(), display_name: None,
            memory_mib: 32607, compute_capability: Some("12.0".into()),
        }).collect();
        p.tp = 1;
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::new()), vec![
            vec!["GPU-d"], vec!["GPU-a"], vec!["GPU-c"], vec!["GPU-b"],
        ]);
        p.tp = 2;
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::new()), vec![
            vec!["GPU-d", "GPU-a"], vec!["GPU-d", "GPU-c"], vec!["GPU-d", "GPU-b"],
            vec!["GPU-a", "GPU-c"], vec!["GPU-a", "GPU-b"], vec!["GPU-c", "GPU-b"],
        ]);
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::from(["GPU-a".into()])), vec![
            vec!["GPU-d", "GPU-c"], vec!["GPU-d", "GPU-b"], vec!["GPU-c", "GPU-b"],
        ]);
        p.tp = 4;
        assert_eq!(p.gpu_groups(&gpus, &BTreeSet::new()), vec![vec!["GPU-d", "GPU-a", "GPU-c", "GPU-b"]]);
        assert!(p.gpu_groups(&gpus, &BTreeSet::from(["GPU-a".into()])).is_empty());
    }
    #[test]
    fn profile_evidence_must_meet_its_selected_headroom() {
        let mut p = profile();
        for margin in [MIN_PROFILE_HEADROOM_BYTES, 500 * 1024 * 1024, HEADROOM_BYTES] {
            p.options.kv_arena_headroom_bytes = margin;
            p.qualification.free_bytes_per_gpu = Some(margin);
            p.validate().unwrap();
            p.qualification.free_bytes_per_gpu = Some(margin - 1);
            assert!(p.validate().is_err());
        }
        p.options.kv_arena_headroom_bytes = MIN_PROFILE_HEADROOM_BYTES - 1;
        p.qualification.free_bytes_per_gpu = Some(HEADROOM_BYTES);
        assert!(p.validate().is_err());
    }
    #[test]
    fn prebuilt_profiles_accept_dynamic_or_positive_explicit_arenas() {
        let mut p = profile();
        p.options.kv_arena_bytes = None;
        p.validate().unwrap();
        p.options.kv_arena_bytes = Some(0);
        assert!(p.validate().is_err());
        p.options.kv_arena_bytes = Some(4096);
        p.validate().unwrap();
        LaunchOptions::default().validate(1).unwrap();
    }
    #[test]
    fn dynamic_catalog_preserves_policy_and_capacity_evidence() {
        assert!(serde_json::from_str::<LaunchOptions>("{}").unwrap().structured_outputs);
        let mut p = profile();
        p.options.kv_arena_bytes = None;
        p.qualification.tier = QualificationTier::CalculatedStartupSmoke;
        p.qualification.full_context_requests = 0;
        p.qualification.smoke_requests = Some(p.concurrency);
        p.qualification.calculation = Some(CapacityCalculation {
            required_kv_bytes_per_rank: 4096,
            available_kv_bytes_per_rank: Some(8192),
        });
        p.validate().unwrap();
        p.qualification.calculation.as_mut().unwrap().available_kv_bytes_per_rank = Some(4095);
        assert!(p.validate().is_err());
        p.qualification.tier = QualificationTier::CalculatedPendingValidation;
        p.qualification.smoke_requests = None;
        p.qualification.free_bytes_per_gpu = None;
        p.qualification.calculation.as_mut().unwrap().available_kv_bytes_per_rank = None;
        p.validate().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profiles.json");
        let mut json = serde_json::to_value(ProfileCatalog {
            schema: "ginfer-launch-profiles-v1".into(), profiles: vec![p],
        }).unwrap();
        for omitted in [false, true] {
            if omitted {
                let options = json["profiles"][0]["options"].as_object_mut().unwrap();
                options.remove("kv_arena_bytes");
                options.remove("structured_outputs");
            }
            std::fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
            let profile = &ProfileCatalog::read(&path).unwrap()[0];
            assert_eq!(profile.options.kv_arena_bytes, None);
            assert_eq!(profile.options.structured_outputs, !omitted);
            let recorded: LaunchProfile = serde_json::from_value(serde_json::to_value(profile).unwrap()).unwrap();
            assert_eq!(recorded.options.structured_outputs, !omitted);
        }
    }
    #[test]
    fn other_platform_profiles_are_not_launch_choices() {
        let mut p = profile();
        let gpus = vec![Gpu {
            uuid: "GPU-fixture".into(), name: "Fixture GPU".into(), display_name: None,
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
