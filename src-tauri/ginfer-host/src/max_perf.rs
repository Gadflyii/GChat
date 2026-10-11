//! Versioned GBench session policy, separate from measured capacity profiles.

use crate::{engine_host::LaunchOptions, engine_inventory::ArtifactIdentity, service::Gpu};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, fmt};

pub const PROFILE_ID: &str = "gbench-max-perf";
pub const PROFILE_VERSION: u32 = 1;
pub const INPUT_TOKENS: u32 = 2048;
pub const OUTPUT_TOKENS: u32 = 500;
pub const CONCURRENCIES: [u32; 3] = [1, 4, 8];
pub const WARMUP_ROUNDS: u32 = 1;
pub const MEASURED_ROUNDS: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaxPerfModelClass {
    #[serde(rename = "qwen27-int-dflash-q4")]
    Qwen27IntDflashQ4,
    #[serde(rename = "qwen27-nvfp4-dflash-q4")]
    Qwen27Nvfp4DflashQ4,
    #[serde(rename = "flash-smol-mtp")]
    FlashSmolMtp,
    #[serde(rename = "flash-int-mtp")]
    FlashIntMtp,
}

impl MaxPerfModelClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Qwen27IntDflashQ4 => "qwen27-int-dflash-q4",
            Self::Qwen27Nvfp4DflashQ4 => "qwen27-nvfp4-dflash-q4",
            Self::FlashSmolMtp => "flash-smol-mtp",
            Self::FlashIntMtp => "flash-int-mtp",
        }
    }

    fn identity(self) -> (&'static str, &'static str) {
        match self {
            Self::Qwen27IntDflashQ4 => ("qwen3.8-27b", "groupwise-int-dflash2-q4"),
            Self::Qwen27Nvfp4DflashQ4 => ("qwen3.8-27b", "nvfp4-dflash2-q4"),
            Self::FlashSmolMtp => ("qwen3.8-flash-next", "smol-q2g64"),
            Self::FlashIntMtp => ("qwen3.8-flash-next", "groupwise-int"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaxPerfProfileRef {
    pub id: String,
    pub version: u32,
    pub model_class: MaxPerfModelClass,
}

impl MaxPerfProfileRef {
    pub fn new(model_class: MaxPerfModelClass) -> Self {
        Self {
            id: PROFILE_ID.into(),
            version: PROFILE_VERSION,
            model_class,
        }
    }

    pub fn resolve(&self) -> Result<MaxPerfProfile, MaxPerfError> {
        if self.id != PROFILE_ID || self.version != PROFILE_VERSION {
            return Err(MaxPerfError::UnknownProfile);
        }
        Ok(MaxPerfProfile::new(self.model_class))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MaxPerfProfile {
    pub id: String,
    pub reference: MaxPerfProfileRef,
    pub name: String,
    pub max_context: u32,
    pub concurrency: u32,
    pub tp: u32,
    pub options: LaunchOptions,
}

impl MaxPerfProfile {
    fn new(model_class: MaxPerfModelClass) -> Self {
        let dense = matches!(
            model_class,
            MaxPerfModelClass::Qwen27IntDflashQ4 | MaxPerfModelClass::Qwen27Nvfp4DflashQ4
        );
        Self {
            id: format!("{PROFILE_ID}-v{PROFILE_VERSION}-{}", model_class.as_str()),
            reference: MaxPerfProfileRef::new(model_class),
            name: format!(
                "GBench Max Perf · {}",
                match model_class {
                    MaxPerfModelClass::Qwen27IntDflashQ4 => "Qwen 3.8 27B INT",
                    MaxPerfModelClass::Qwen27Nvfp4DflashQ4 => "Qwen 3.8 27B NVFP4",
                    MaxPerfModelClass::FlashSmolMtp => "Qwen 3.8 Flash SMOL",
                    MaxPerfModelClass::FlashIntMtp => "Qwen 3.8 Flash INT",
                }
            ),
            max_context: 8181,
            concurrency: 8,
            tp: 1,
            options: LaunchOptions {
                spec: if dense { "dflash" } else { "mtp" }.into(),
                draft_policy: "fixed".into(),
                draft_tokens: if dense { 7 } else { 3 },
                draft_tp: u32::from(dense),
                kv_dtype: if model_class == MaxPerfModelClass::Qwen27Nvfp4DflashQ4 {
                    "nvfp4"
                } else {
                    "int8"
                }
                .into(),
                ..Default::default()
            },
        }
    }

    pub fn for_configuration(configuration: &Value) -> Result<Self, String> {
        let identity = ArtifactIdentity {
            model_id: configuration["model"]
                .as_str()
                .ok_or_else(|| MaxPerfError::ConfigurationMismatch("model").to_string())?
                .into(),
            weights_id: configuration["weights"]
                .as_str()
                .ok_or_else(|| MaxPerfError::ConfigurationMismatch("weights").to_string())?
                .into(),
        };
        // A served NVFP4 KV configuration has passed the Engine's calibration binding.
        let profile = profile_for_identity(
            &identity,
            number(configuration, "tp").map_err(|e| e.to_string())?,
            number(configuration, "draft_tp").map_err(|e| e.to_string())?,
            configuration["kv_dtype"] == "nvfp4",
        )
        .map_err(|e| e.to_string())?;
        profile.validate_configuration(configuration)?;
        Ok(profile)
    }

    pub fn validate_configuration(&self, configuration: &Value) -> Result<(), String> {
        validate_configuration(&self.reference, configuration).map_err(|error| error.to_string())
    }

    pub fn gpu_groups(&self, gpus: &[Gpu], reserved: &BTreeSet<String>) -> Vec<Vec<String>> {
        gpus.iter()
            .filter(|gpu| {
                !reserved.contains(&gpu.uuid)
                    && gpu
                        .compute_capability
                        .as_deref()
                        .is_some_and(|architecture| {
                            if self.options.kv_dtype == "nvfp4" {
                                architecture == "12.0"
                            } else {
                                matches!(architecture, "8.0" | "8.6" | "8.9" | "12.0")
                            }
                        })
            })
            .map(|gpu| vec![gpu.uuid.clone()])
            .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaxPerfError {
    UnknownProfile,
    UnsupportedArtifact,
    CalibrationRequired,
    ConfigurationMismatch(&'static str),
    WorkloadMismatch,
}

impl fmt::Display for MaxPerfError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownProfile => {
                formatter.write_str("unknown GBench Max Perf profile or version")
            }
            Self::UnsupportedArtifact => formatter
                .write_str("this artifact and TP/drafter identity have no GBench Max Perf profile"),
            Self::CalibrationRequired => formatter
                .write_str("GBench NVFP4 requires the artifact's complete NVFP4 KV calibration"),
            Self::ConfigurationMismatch(field) => write!(
                formatter,
                "served configuration does not match GBench Max Perf: {field}"
            ),
            Self::WorkloadMismatch => formatter
                .write_str("Standard requires 2048/500, C1/C4/C8, and one warmup/measured wave"),
        }
    }
}
impl std::error::Error for MaxPerfError {}

pub fn profile_for_identity(
    identity: &ArtifactIdentity,
    tp: u32,
    draft_tp: u32,
    nvfp4_kv_available: bool,
) -> Result<MaxPerfProfile, MaxPerfError> {
    if tp != 1 {
        return Err(MaxPerfError::UnsupportedArtifact);
    }
    let class = match (
        identity.model_id.as_str(),
        identity.weights_id.as_str(),
        draft_tp,
    ) {
        ("qwen3.8-27b", "groupwise-int-dflash2-q4", 1) => MaxPerfModelClass::Qwen27IntDflashQ4,
        ("qwen3.8-27b", "nvfp4-dflash2-q4", 1) => MaxPerfModelClass::Qwen27Nvfp4DflashQ4,
        ("qwen3.8-flash-next", "smol-q2g64", 0) => MaxPerfModelClass::FlashSmolMtp,
        ("qwen3.8-flash-next", "groupwise-int", 0) => MaxPerfModelClass::FlashIntMtp,
        _ => return Err(MaxPerfError::UnsupportedArtifact),
    };
    if class == MaxPerfModelClass::Qwen27Nvfp4DflashQ4 && !nvfp4_kv_available {
        return Err(MaxPerfError::CalibrationRequired);
    }
    Ok(MaxPerfProfile::new(class))
}

fn number(configuration: &Value, field: &'static str) -> Result<u32, MaxPerfError> {
    configuration[field]
        .as_u64()
        .and_then(|value| value.try_into().ok())
        .ok_or(MaxPerfError::ConfigurationMismatch(field))
}

pub fn validate_configuration(
    reference: &MaxPerfProfileRef,
    configuration: &Value,
) -> Result<(), MaxPerfError> {
    let profile = reference.resolve()?;
    let (model, weights) = reference.model_class.identity();
    for (field, expected) in [
        ("model", Value::from(model)),
        ("weights", Value::from(weights)),
        ("tp", Value::from(profile.tp)),
        ("draft_tp", Value::from(profile.options.draft_tp)),
        ("max_context", Value::from(profile.max_context)),
        ("max_concurrency", Value::from(profile.concurrency)),
        ("kv_dtype", Value::from(profile.options.kv_dtype)),
        ("spec", Value::from(profile.options.spec)),
        ("draft_tokens", Value::from(profile.options.draft_tokens)),
        ("draft_policy", Value::from(profile.options.draft_policy)),
        ("cuda_graph", Value::from(!profile.options.no_cuda_graph)),
        ("vision", Value::from(profile.options.vision)),
    ] {
        if configuration[field] != expected {
            return Err(MaxPerfError::ConfigurationMismatch(field));
        }
    }
    if configuration
        .get("prefix_reuse")
        .is_some_and(|value| value != &Value::Bool(true))
    {
        return Err(MaxPerfError::ConfigurationMismatch("prefix_reuse"));
    }
    Ok(())
}

pub fn validate_standard_workload(
    prompt_tokens: u32,
    output_tokens: u32,
    concurrencies: &[u32],
    warmup_rounds: u32,
    measured_rounds: u32,
) -> Result<(), MaxPerfError> {
    if prompt_tokens != INPUT_TOKENS
        || output_tokens != OUTPUT_TOKENS
        || concurrencies != CONCURRENCIES
        || warmup_rounds != WARMUP_ROUNDS
        || measured_rounds != MEASURED_ROUNDS
    {
        return Err(MaxPerfError::WorkloadMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configuration(class: MaxPerfModelClass) -> Value {
        let (model, weights) = class.identity();
        let profile = MaxPerfProfile::new(class);
        serde_json::json!({"model":model,"weights":weights,"tp":1,"draft_tp":profile.options.draft_tp,
            "max_context":8181,"max_concurrency":8,"kv_dtype":profile.options.kv_dtype,
            "spec":profile.options.spec,"draft_tokens":profile.options.draft_tokens,"draft_policy":"fixed",
            "cuda_graph":true,"vision":true})
    }

    #[test]
    fn max_perf_selection_matches_exact_released_class_and_hardware() {
        for class in [
            MaxPerfModelClass::Qwen27IntDflashQ4,
            MaxPerfModelClass::Qwen27Nvfp4DflashQ4,
            MaxPerfModelClass::FlashSmolMtp,
            MaxPerfModelClass::FlashIntMtp,
        ] {
            let config = configuration(class);
            let profile = MaxPerfProfile::for_configuration(&config).unwrap();
            assert_eq!(profile.reference.model_class, class);
            assert_eq!(profile.id, format!("gbench-max-perf-v1-{}", class.as_str()));
            assert!(profile.options.kv_arena_bytes.is_none());
            assert!(profile.options.host_kv_cache_bytes.is_none());
            assert_eq!(profile.options.prefill_chunk, 0);
            assert!(profile.options.vision && profile.options.structured_outputs);
            let gpus = vec![
                Gpu {
                    uuid: "GPU-Ampere".into(),
                    name: "Fixture Ampere".into(),
                    display_name: None,
                    memory_mib: 1,
                    compute_capability: Some("8.6".into()),
                },
                Gpu {
                    uuid: "GPU-Blackwell".into(),
                    name: "Fixture Blackwell".into(),
                    display_name: None,
                    memory_mib: 1,
                    compute_capability: Some("12.0".into()),
                },
            ];
            let groups = profile.gpu_groups(&gpus, &Default::default());
            assert_eq!(
                groups.len(),
                if class == MaxPerfModelClass::Qwen27Nvfp4DflashQ4 {
                    1
                } else {
                    2
                }
            );
            assert!(groups.iter().all(|group| group.len() == 1));
        }
        for (model, weights, tp, draft_tp) in [
            ("muse-glimmer-30b", "groupwise-int-dflash-q4", 1, 1),
            ("qwen3.8-27b", "nvfp4-dflash2-nvfp4", 1, 1),
            ("qwen3.8-27b", "groupwise-int-dflash2-q4-g32", 1, 1),
            ("qwen3.8-27b", "groupwise-int-dflash2-q4", 2, 1),
            ("qwen3.8-27b", "groupwise-int-dflash2-q4", 1, 0),
            ("qwen3.8-flash-next", "smol-q2g64", 1, 1),
        ] {
            assert_eq!(
                profile_for_identity(
                    &ArtifactIdentity {
                        model_id: model.into(),
                        weights_id: weights.into()
                    },
                    tp,
                    draft_tp,
                    true
                ),
                Err(MaxPerfError::UnsupportedArtifact)
            );
        }
        assert_eq!(
            profile_for_identity(
                &ArtifactIdentity {
                    model_id: "qwen3.8-27b".into(),
                    weights_id: "nvfp4-dflash2-q4".into()
                },
                1,
                1,
                false
            ),
            Err(MaxPerfError::CalibrationRequired)
        );
    }

    #[test]
    fn max_perf_reference_and_resolved_configuration_reject_mismatch_without_changing_v1() {
        let config = configuration(MaxPerfModelClass::FlashSmolMtp);
        let before = config.clone();
        let profile = MaxPerfProfile::for_configuration(&config).unwrap();
        profile.validate_configuration(&config).unwrap();
        assert_eq!(config, before);
        assert!(config.get("prefix_reuse").is_none());
        for (field, wrong) in [
            ("model", Value::from("muse-glimmer-30b")),
            ("weights", Value::from("nvfp4")),
            ("tp", Value::from(2)),
            ("draft_tp", Value::from(1)),
            ("max_context", Value::from(8192)),
            ("max_concurrency", Value::from(4)),
            ("kv_dtype", Value::from("auto")),
            ("spec", Value::from("auto")),
            ("draft_tokens", Value::from(7)),
            ("draft_policy", Value::from("auto")),
            ("cuda_graph", Value::from(false)),
            ("vision", Value::from(false)),
            ("prefix_reuse", Value::from(false)),
        ] {
            let mut changed = config.clone();
            changed[field] = wrong;
            assert_eq!(
                validate_configuration(&profile.reference, &changed),
                Err(MaxPerfError::ConfigurationMismatch(field))
            );
        }
        let mut unknown = profile.reference.clone();
        unknown.version += 1;
        assert_eq!(
            validate_configuration(&unknown, &config),
            Err(MaxPerfError::UnknownProfile)
        );
        unknown = profile.reference.clone();
        unknown.id = "custom".into();
        assert_eq!(
            validate_configuration(&unknown, &config),
            Err(MaxPerfError::UnknownProfile)
        );
        validate_standard_workload(2048, 500, &[1, 4, 8], 1, 1).unwrap();
        assert_eq!(
            validate_standard_workload(2048, 500, &[1, 4], 1, 1),
            Err(MaxPerfError::WorkloadMismatch)
        );
    }
}
