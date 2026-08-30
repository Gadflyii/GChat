use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Runtime;

const GINFER_V3_MAGIC: [u8; 8] = *b"NINFER\0\x03";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedGinferModel {
    pub model_id: String,
    pub model_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedGinferArtifact {
    pub filename: String,
    pub reason: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GinferAdoptionReport {
    pub adopted: Vec<AdoptedGinferModel>,
    pub rejected: Vec<RejectedGinferArtifact>,
}

#[derive(Serialize)]
struct GinferModelManifest<'a> {
    model_path: &'a str,
    name: &'a str,
    size_bytes: u64,
    embedding: bool,
    source: &'static str,
}

fn is_root_ginfer_artifact(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("ginfer"))
}

fn validate_ginfer_v3(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() < 16 {
        return Err("file is too small to be a GInfer v3 container".to_string());
    }

    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut magic = [0_u8; GINFER_V3_MAGIC.len()];
    file.read_exact(&mut magic)
        .map_err(|error| error.to_string())?;
    if magic != GINFER_V3_MAGIC {
        return Err("artifact does not have the GInfer v3 container magic".to_string());
    }

    Ok(metadata.len())
}

fn available_model_id(models_root: &Path, preferred: &str) -> String {
    if !models_root.join(preferred).exists() {
        return preferred.to_string();
    }

    for suffix in 2_u32.. {
        let candidate = format!("{preferred}-{suffix}");
        if !models_root.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!("the model-id suffix space is unbounded")
}

fn write_manifest(path: &Path, manifest: &GinferModelManifest<'_>) -> Result<(), String> {
    let temporary = path.with_extension("yml.tmp");
    let result = (|| {
        let file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        serde_yaml::to_writer(&mut writer, manifest).map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
        drop(writer);
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn adopt_one(models_root: &Path, source: &Path) -> Result<AdoptedGinferModel, String> {
    let size_bytes = validate_ginfer_v3(source)?;
    let preferred_id = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .ok_or_else(|| "artifact filename has no usable model id".to_string())?;
    let model_id = available_model_id(models_root, preferred_id);
    let model_dir = models_root.join(&model_id);
    let destination = model_dir.join("model.ginfer");
    let manifest_path = model_dir.join("model.yml");
    let model_path = format!("ginfer/models/{model_id}/model.ginfer");

    fs::create_dir(&model_dir).map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(source, &destination) {
        let _ = fs::remove_dir(&model_dir);
        return Err(error.to_string());
    }

    let manifest = GinferModelManifest {
        model_path: &model_path,
        name: &model_id,
        size_bytes,
        embedding: false,
        source: "local",
    };
    if let Err(error) = write_manifest(&manifest_path, &manifest) {
        let rollback = fs::rename(&destination, source);
        let _ = fs::remove_dir(&model_dir);
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; additionally failed to restore {}: {rollback_error}",
                source.display()
            )),
        };
    }

    Ok(AdoptedGinferModel {
        model_id,
        model_path,
    })
}

pub fn adopt_root_ginfer_models_in(data_folder: &Path) -> Result<GinferAdoptionReport, String> {
    let models_root = data_folder.join("ginfer").join("models");
    fs::create_dir_all(&models_root).map_err(|error| error.to_string())?;

    let mut candidates: Vec<PathBuf> = fs::read_dir(&models_root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_root_ginfer_artifact(path))
        .collect();
    candidates.sort();

    let mut report = GinferAdoptionReport::default();
    for source in candidates {
        match adopt_one(&models_root, &source) {
            Ok(adopted) => report.adopted.push(adopted),
            Err(reason) => report.rejected.push(RejectedGinferArtifact {
                filename: source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("<invalid filename>")
                    .to_string(),
                reason,
            }),
        }
    }
    Ok(report)
}

#[tauri::command]
pub fn adopt_root_ginfer_models<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<GinferAdoptionReport, String> {
    let data_folder = crate::core::app::commands::get_jan_data_folder_path(app);
    adopt_root_ginfer_models_in(&data_folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_artifact(path: &Path, valid: bool) {
        let mut bytes = Vec::from(if valid { GINFER_V3_MAGIC } else { *b"NOTMODEL" });
        bytes.extend_from_slice(&[0_u8; 8]);
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn adopts_valid_root_artifacts_and_leaves_invalid_files_untouched() {
        let root = tempfile::tempdir().unwrap();
        let models = root.path().join("ginfer/models");
        fs::create_dir_all(&models).unwrap();
        let valid = models.join("muse_glimmer.ginfer");
        let invalid = models.join("broken.ginfer");
        write_artifact(&valid, true);
        write_artifact(&invalid, false);

        let report = adopt_root_ginfer_models_in(root.path()).unwrap();

        assert_eq!(report.adopted.len(), 1);
        assert_eq!(report.adopted[0].model_id, "muse_glimmer");
        assert_eq!(report.rejected.len(), 1);
        assert_eq!(report.rejected[0].filename, "broken.ginfer");
        assert!(!valid.exists());
        assert!(invalid.exists());
        assert!(models.join("muse_glimmer/model.ginfer").exists());

        let manifest: serde_yaml::Value =
            serde_yaml::from_reader(fs::File::open(models.join("muse_glimmer/model.yml")).unwrap())
                .unwrap();
        assert_eq!(
            manifest["model_path"],
            "ginfer/models/muse_glimmer/model.ginfer"
        );
        assert_eq!(manifest["size_bytes"], 16);
        assert_eq!(manifest["source"], "local");
    }

    #[test]
    fn preserves_existing_model_directories_with_a_unique_adopted_id() {
        let root = tempfile::tempdir().unwrap();
        let models = root.path().join("ginfer/models");
        fs::create_dir_all(models.join("qwen")).unwrap();
        write_artifact(&models.join("qwen.ginfer"), true);

        let report = adopt_root_ginfer_models_in(root.path()).unwrap();

        assert_eq!(report.adopted[0].model_id, "qwen-2");
        assert!(models.join("qwen").is_dir());
        assert!(models.join("qwen-2/model.ginfer").exists());
    }
}
