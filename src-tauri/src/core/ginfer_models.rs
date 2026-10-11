use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GinferModelLocation {
    pub model_id: String,
    pub model_dir: String,
    pub manifest_path: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GinferModelImportLocation {
    pub model_dir: String,
    pub artifact_path: String,
    pub manifest_path: String,
    pub model_path: String,
}
#[derive(Deserialize)]
struct JournalLocation {
    status: String,
    #[serde(default)]
    storage_root: PathBuf,
    #[serde(default)]
    path: Option<PathBuf>,
    #[serde(default)]
    release: Option<JournalRelease>,
}
#[derive(Deserialize)]
struct JournalRelease {
    sha256: String,
}
pub fn validate_model_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.contains('\\')
        || id.contains('\0')
        || id
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(id)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Model ID must contain only normal relative path components".into());
    }
    Ok(())
}
fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Model path is not valid Unicode".into())
}
fn absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .map_err(|error| error.to_string())
    }
}
fn canonical_existing_prefix(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path;
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => {
                let canonical = fs::canonicalize(existing).map_err(|error| error.to_string())?;
                let suffix = path
                    .strip_prefix(existing)
                    .map_err(|error| error.to_string())?;
                return Ok(canonical.join(suffix));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing = existing.parent().ok_or_else(|| error.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}
fn reject_import_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "Model import path '{}' is a symlink; choose a real model directory",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
pub(crate) fn model_import_location_at_root(
    data: &Path,
    id: &str,
    root: &Path,
) -> Result<GinferModelImportLocation, String> {
    validate_model_id(id)?;
    if !root.is_absolute() {
        return Err("Model storage root must be a nonempty absolute path".into());
    }
    let data = canonical_existing_prefix(&absolute(data)?)?;
    let root = canonical_existing_prefix(root)?;
    let mut model_dir = root;
    for part in id.split('/') {
        model_dir.push(part);
        reject_import_symlink(&model_dir)?;
    }
    let artifact = model_dir.join("model.ginfer");
    let manifest = model_dir.join("model.yml");
    reject_import_symlink(&artifact)?;
    reject_import_symlink(&manifest)?;
    ginfer_host::model_storage::require_native_model_storage(&artifact)?;
    for job in installed_journal(&data)?
        .into_values()
        .filter(|job| job.status == "installed")
    {
        if let Some(payload) = job.path {
            let payload = canonical_existing_prefix(&absolute(&payload)?)?;
            let owns_package = match job.release {
                Some(release)
                    if !job.storage_root.as_os_str().is_empty()
                        && release.sha256.len() == 64
                        && release.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
                {
                    let package = canonical_existing_prefix(
                        &absolute(&job.storage_root)?.join(release.sha256),
                    )?;
                    payload == package.join("model.ginfer")
                        && package.join("model.yml").is_file()
                        && artifact.starts_with(package)
                }
                _ => false,
            };
            if artifact == payload || owns_package {
                return Err("This package is managed by Host; replace it via Manager".into());
            }
        }
    }
    let model_path = match artifact.strip_prefix(&data) {
        Ok(relative) => path_string(relative)?.replace('\\', "/"),
        Err(_) => path_string(&artifact)?,
    };
    Ok(GinferModelImportLocation {
        model_dir: path_string(&model_dir)?,
        artifact_path: path_string(&artifact)?,
        manifest_path: path_string(&manifest)?,
        model_path,
    })
}
pub fn model_import_location_in(
    data: &Path,
    id: &str,
) -> Result<GinferModelImportLocation, String> {
    validate_model_id(id)?;
    let data = absolute(data)?;
    let root = ginfer_host::model_storage::resolve_artifact_root(&data.join("ginfer/models"))?;
    model_import_location_at_root(&data, id, &root)
}
fn installed_journal(data: &Path) -> Result<BTreeMap<String, JournalLocation>, String> {
    let journal = data.join("ginfer/model-downloads.json");
    match fs::read(&journal) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "Cannot read model locations from '{}': {error}",
                journal.display()
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(error.to_string()),
    }
}
fn catalog_roots(
    data: &Path,
    selected: Option<PathBuf>,
    explicit: Option<&Path>,
) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(root) = explicit {
        if !root.is_absolute() {
            return Err("Model storage root must be a nonempty absolute path".into());
        }
        roots.push(root.to_path_buf());
    }
    roots.extend(selected);
    roots.push(data.join("ginfer/models"));
    let jobs = installed_journal(data)?;
    for job in jobs.into_values() {
        if job.status == "installed" && !job.storage_root.as_os_str().is_empty() {
            roots.push(job.storage_root);
        }
    }
    let mut seen = BTreeSet::new();
    roots
        .into_iter()
        .map(|root| {
            let root = absolute(&root)?;
            match fs::canonicalize(&root) {
                Ok(canonical) => Ok(canonical),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(root),
                Err(error) => Err(error.to_string()),
            }
        })
        .filter_map(|root| match root {
            Ok(root) if seen.insert(root.clone()) => Some(Ok(root)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}
pub fn model_catalog_roots_in(data: &Path) -> Result<Vec<PathBuf>, String> {
    // Existing models remain readable when no new-write fallback is available.
    catalog_roots(
        data,
        ginfer_host::model_storage::resolve_artifact_root(&data.join("ginfer/models")).ok(),
        None,
    )
}
fn locations_at_roots(roots: &[PathBuf]) -> Result<Vec<GinferModelLocation>, String> {
    let mut locations = Vec::new();
    for root in roots {
        let mut pending = vec![(root.clone(), BTreeSet::new())];
        while let Some((directory, mut ancestors)) = pending.pop() {
            let metadata = match fs::metadata(&directory) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            if !metadata.is_dir() {
                continue;
            }
            let canonical = fs::canonicalize(&directory).map_err(|error| error.to_string())?;
            if !ancestors.insert(canonical) {
                continue;
            }
            let manifest = directory.join("model.yml");
            if directory != *root && manifest.is_file() {
                let id = directory
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?;
                let id = path_string(id)?.replace('\\', "/");
                validate_model_id(&id)?;
                locations.push(GinferModelLocation {
                    model_id: id,
                    model_dir: path_string(&directory)?,
                    manifest_path: path_string(&manifest)?,
                });
                continue;
            }
            let mut children = fs::read_dir(&directory)
                .map_err(|error| error.to_string())?
                .map(|entry| {
                    entry
                        .map(|entry| entry.path())
                        .map_err(|error| error.to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            children.sort();
            pending.extend(
                children
                    .into_iter()
                    .rev()
                    .map(|path| (path, ancestors.clone())),
            );
        }
    }
    Ok(locations)
}
fn deduplicate_locations(locations: Vec<GinferModelLocation>) -> Vec<GinferModelLocation> {
    let mut seen = BTreeSet::new();
    locations
        .into_iter()
        .filter(|location| seen.insert(location.model_id.clone()))
        .collect()
}
pub fn enumerate_model_locations_in(data: &Path) -> Result<Vec<GinferModelLocation>, String> {
    Ok(deduplicate_locations(locations_at_roots(
        &model_catalog_roots_in(data)?,
    )?))
}
pub fn find_model_location_in(
    data: &Path,
    id: &str,
) -> Result<Option<GinferModelLocation>, String> {
    validate_model_id(id)?;
    Ok(enumerate_model_locations_in(data)?
        .into_iter()
        .find(|location| location.model_id == id))
}
#[tauri::command]
pub async fn ginfer_model_locations<R: Runtime>(
    app: tauri::AppHandle<R>,
    models_root: Option<String>,
) -> Result<Vec<GinferModelLocation>, String> {
    let data = crate::core::app::commands::get_jan_data_folder_path(app);
    tokio::task::spawn_blocking(move || {
        let roots = catalog_roots(
            &data,
            ginfer_host::model_storage::resolve_artifact_root(&data.join("ginfer/models")).ok(),
            models_root.as_deref().map(Path::new),
        )?;
        Ok(deduplicate_locations(locations_at_roots(&roots)?))
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn ginfer_model_import_location<R: Runtime>(
    app: tauri::AppHandle<R>,
    model_id: String,
    models_root: Option<String>,
) -> Result<GinferModelImportLocation, String> {
    let data = crate::core::app::commands::get_jan_data_folder_path(app);
    tokio::task::spawn_blocking(move || match models_root {
        Some(root) => model_import_location_at_root(&data, &model_id, Path::new(&root)),
        None => model_import_location_in(&data, &model_id),
    })
    .await
    .map_err(|error| error.to_string())?
}

fn deletion_location(
    data: &Path,
    id: &str,
    roots: &[PathBuf],
) -> Result<Option<(PathBuf, Option<PathBuf>)>, String> {
    validate_model_id(id)?;
    let mut matches = BTreeMap::new();
    for location in locations_at_roots(roots)?
        .into_iter()
        .filter(|location| location.model_id == id)
    {
        let directory = fs::canonicalize(&location.model_dir).map_err(|error| error.to_string())?;
        if !roots.iter().any(|root| {
            Path::new(&location.model_dir).starts_with(root)
                && fs::canonicalize(root)
                    .is_ok_and(|root| directory != root && directory.starts_with(root))
        }) {
            return Err(
                "Model directory is outside its catalog root; remove the specific copy in Manager"
                    .into(),
            );
        }
        matches.insert(directory, PathBuf::from(location.manifest_path));
    }
    if matches.len() > 1 {
        return Err(format!(
            "Multiple copies of model '{id}' exist at {}. Remove the specific copy in Manager.",
            matches
                .keys()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let Some((directory, manifest)) = matches.into_iter().next() else {
        return Ok(None);
    };
    let model: serde_yaml::Value =
        serde_yaml::from_slice(&fs::read(&manifest).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let payload = model["model_path"].as_str().map(|path| {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            path
        } else {
            data.join(path)
        }
    });
    let mut managed = BTreeSet::new();
    for job in installed_journal(data)?
        .into_values()
        .filter(|job| job.status == "installed")
    {
        if let Some(path) = job.path {
            let same_payload = payload.as_ref().is_some_and(|payload| {
                payload == &path
                    || fs::canonicalize(payload).is_ok_and(|payload| {
                        fs::canonicalize(&path).is_ok_and(|path| payload == path)
                    })
            });
            if same_payload
                || path.starts_with(&directory)
                || fs::canonicalize(&path).is_ok_and(|path| path.starts_with(&directory))
            {
                managed.insert(path);
            }
        }
    }
    if managed.len() > 1 {
        return Err("This model directory refers to multiple managed packages; remove the specific package in Manager".into());
    }
    Ok(Some((directory, managed.into_iter().next())))
}
#[tauri::command]
pub async fn delete_ginfer_model<R: Runtime>(
    app: tauri::AppHandle<R>,
    model_id: String,
    models_root: Option<String>,
) -> Result<(), String> {
    let data = crate::core::app::commands::get_jan_data_folder_path(app);
    let scan_data = data.clone();
    let disposition = tokio::task::spawn_blocking(move || {
        let roots = catalog_roots(
            &scan_data,
            ginfer_host::model_storage::resolve_artifact_root(&scan_data.join("ginfer/models"))
                .ok(),
            models_root.as_deref().map(Path::new),
        )?;
        deletion_location(&scan_data, &model_id, &roots)
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some((directory, managed)) = disposition else {
        return Err("Model was not found in the local catalog".into());
    };
    if let Some(payload) = managed {
        use ginfer_host::local_host_registry::Owner;
        let owner = ginfer_host::local_host_registry::registered()
            .await?
            .ok_or("The managing local Host is unavailable; remove this package in Manager")?;
        let checked_owner = owner.clone();
        let payload = tokio::task::spawn_blocking(move || {
            let expected = fs::canonicalize(data.join("ginfer/host")).map_err(|error|error.to_string())?;
            let owner_directory = match &checked_owner {
                Owner::Desktop(local) => {
                    if local.desktop_provider.as_ref().map(fs::canonicalize).transpose().map_err(|error|error.to_string())? != Some(fs::canonicalize(data.join("ginfer")).map_err(|error|error.to_string())?) {
                        return Err("The registered Host belongs to a different model provider; remove this package in Manager".into());
                    }
                    &local.directory
                }
                Owner::Service {directory,..} => directory,
            };
            if fs::canonicalize(owner_directory).map_err(|error|error.to_string())? != expected {
                return Err("The registered Host belongs to a different data folder; remove this package in Manager".into());
            }
            fs::canonicalize(payload).map_err(|error|error.to_string())
        }).await.map_err(|error|error.to_string())??;
        let control = owner.connect().await?;
        // Snapshot is passive; deletion must not trigger hardware installation through Scan.
        let snapshot = control.snapshot().await?;
        let models = snapshot["models"]
            .as_array()
            .ok_or("The managing Host has no model inventory")?
            .clone();
        let id = tokio::task::spawn_blocking(move || {
            models.into_iter().find(|entry| entry["path"].as_str().is_some_and(|path|fs::canonicalize(path).is_ok_and(|path|path == payload)))
                .and_then(|entry|entry["id"].as_str().map(str::to_owned))
                .ok_or_else(|| "The managing Host cannot inventory this package; inspect Manager inventory errors".to_string())
        }).await.map_err(|error|error.to_string())??;
        control
            .request(
                "/host/v1/remove-model",
                Some(serde_json::json!({"model_id":id})),
            )
            .await?;
        Ok(())
    } else {
        tokio::task::spawn_blocking(move || {
            fs::remove_dir_all(directory).map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }
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
    fn model_locations_preserve_selected_legacy_and_installed_roots_without_migration() {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let data = base.join("data");
        let selected = base.join("native");
        let captured = base.join("previous-native");
        let pending = base.join("pending");
        let legacy = data.join("ginfer/models");
        let make_model = |root: &Path, id: &str| {
            let model = root.join(id);
            fs::create_dir_all(&model).unwrap();
            write_artifact(&model.join("model.ginfer"), true);
            fs::write(model.join("model.yml"), "model_path: unchanged\n").unwrap();
        };
        make_model(&selected, "duplicate");
        make_model(&selected, "new");
        make_model(&legacy, "duplicate");
        make_model(&legacy, "old");
        make_model(&captured, "captured");
        make_model(&pending, "unfinished");
        fs::create_dir_all(selected.join("new/payload/internal")).unwrap();
        fs::write(
            selected.join("new/payload/internal/model.yml"),
            "not a model",
        )
        .unwrap();
        let journal = data.join("ginfer/model-downloads.json");
        fs::write(&journal,serde_json::to_vec(&serde_json::json!({
            "saved": {"status":"installed","storage_root":captured,"path":captured.join("captured/model.ginfer")},
            "partial": {"status":"paused","storage_root":pending}
        })).unwrap()).unwrap();
        let journal_before = fs::read(&journal).unwrap();
        let roots = catalog_roots(&data, Some(selected.clone()), None).unwrap();
        let all = locations_at_roots(&roots).unwrap();
        let catalog = deduplicate_locations(all.clone());
        assert_eq!(
            catalog
                .iter()
                .map(|location| location.model_id.as_str())
                .collect::<Vec<_>>(),
            vec!["duplicate", "new", "old", "captured"]
        );
        assert_eq!(Path::new(&catalog[0].model_dir), selected.join("duplicate"));
        assert_eq!(
            catalog,
            deduplicate_locations(locations_at_roots(&roots).unwrap())
        );
        let error = deletion_location(&data, "duplicate", &roots).unwrap_err();
        assert!(error.contains("Multiple copies"));
        assert!(error.contains(selected.join("duplicate").to_str().unwrap()));
        assert!(error.contains(legacy.join("duplicate").to_str().unwrap()));
        assert_eq!(fs::read(&journal).unwrap(), journal_before);
        assert!(selected.join("duplicate/model.ginfer").is_file());
        assert!(legacy.join("duplicate/model.ginfer").is_file());
        assert_eq!(
            catalog_roots(&data, None, None).unwrap(),
            vec![legacy.clone(), captured.clone()]
        );
        assert!(find_model_location_in(&data, "old").unwrap().is_some());
        let absent = directory.path().join("absent");
        assert!(enumerate_model_locations_in(&absent).unwrap().is_empty());
        assert!(!absent.exists());
        #[cfg(unix)]
        {
            let alias = directory.path().join("alias");
            std::os::unix::fs::symlink(&selected, &alias).unwrap();
            std::os::unix::fs::symlink(&selected, selected.join("cycle")).unwrap();
            let legacy_payload = fs::read(captured.join("captured/model.ginfer")).unwrap();
            std::os::unix::fs::symlink(captured.join("captured"), selected.join("linked")).unwrap();
            let aliased = catalog_roots(&data, Some(selected.clone()), Some(&alias)).unwrap();
            assert_eq!(aliased, roots);
            let linked_catalog = deduplicate_locations(locations_at_roots(&aliased).unwrap());
            assert_eq!(
                linked_catalog
                    .iter()
                    .map(|location| location.model_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["duplicate", "linked", "new", "old", "captured"]
            );
            assert_eq!(
                linked_catalog
                    .iter()
                    .find(|location| location.model_id == "linked")
                    .unwrap()
                    .model_dir,
                selected.join("linked").to_str().unwrap()
            );
            assert_eq!(
                fs::read(captured.join("captured/model.ginfer")).unwrap(),
                legacy_payload
            );
            assert!(deletion_location(&data, "linked", &aliased)
                .unwrap_err()
                .contains("outside its catalog root"));
        }
    }
    #[test]
    fn model_import_locations_use_absolute_external_paths_and_reject_nonrelative_ids() {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let data = base.join("data");
        let native = base.join("native");
        let external = model_import_location_at_root(&data, "org/model", &native).unwrap();
        assert_eq!(
            external.artifact_path,
            native.join("org/model/model.ginfer").to_str().unwrap()
        );
        assert_eq!(external.model_path, external.artifact_path);
        assert_eq!(
            external.manifest_path,
            native.join("org/model/model.yml").to_str().unwrap()
        );
        let ordinary =
            model_import_location_at_root(&data, "model", &data.join("ginfer/models")).unwrap();
        assert_eq!(ordinary.model_path, "ginfer/models/model/model.ginfer");
        for id in [
            "",
            "/absolute",
            "../parent",
            "model/../parent",
            "./model",
            "model//nested",
            "model\\nested",
            "model\0invalid",
        ] {
            assert!(model_import_location_at_root(&data, id, &native).is_err());
            assert!(find_model_location_in(&data, id).is_err());
        }
        assert!(model_import_location_at_root(&data, "model", Path::new("")).is_err());
        assert!(model_import_location_at_root(&data, "model", Path::new("relative")).is_err());
        assert!(!data.exists());
        assert!(!native.exists());

        let managed_id = "ab".repeat(32);
        let package = native.join(&managed_id);
        fs::create_dir_all(&package).unwrap();
        let payload = package.join("model.ginfer");
        write_artifact(&payload, true);
        fs::write(package.join("model.yml"), "model_path: protected\n").unwrap();
        let journal = data.join("ginfer/model-downloads.json");
        fs::create_dir_all(journal.parent().unwrap()).unwrap();
        fs::write(
            &journal,
            serde_json::to_vec(&serde_json::json!({
                "installed": {"status":"installed", "storage_root":native, "path":payload,
                    "release":{"sha256":managed_id}}
            }))
            .unwrap(),
        )
        .unwrap();
        let original_payload = fs::read(&payload).unwrap();
        let original_manifest = fs::read(package.join("model.yml")).unwrap();
        let original_journal = fs::read(&journal).unwrap();
        for id in [managed_id.clone(), format!("{managed_id}/nested")] {
            assert!(model_import_location_at_root(&data, &id, &native)
                .unwrap_err()
                .contains("managed by Host"));
        }
        assert!(model_import_location_at_root(&data, "other", &native).is_ok());
        assert!(
            model_import_location_at_root(&data, &managed_id, &base.join("another-root")).is_ok()
        );
        assert_eq!(fs::read(&payload).unwrap(), original_payload);
        assert_eq!(
            fs::read(package.join("model.yml")).unwrap(),
            original_manifest
        );
        assert_eq!(fs::read(&journal).unwrap(), original_journal);
        let flat = native.join(format!("{}.ginfer", "cd".repeat(32)));
        write_artifact(&flat, true);
        let mut jobs: serde_json::Value = serde_json::from_slice(&original_journal).unwrap();
        jobs["flat"] = serde_json::json!({"status":"installed", "storage_root":native,
            "path":flat,"release":{"sha256":"cd".repeat(32)}});
        fs::write(&journal, serde_json::to_vec(&jobs).unwrap()).unwrap();
        assert!(model_import_location_at_root(&data, "other", &native).is_ok());
        assert_eq!(fs::read(&flat).unwrap(), original_payload);
        fs::write(&journal, &original_journal).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let alias = base.join("root-alias");
            symlink(&native, &alias).unwrap();
            assert!(model_import_location_at_root(&data, &managed_id, &alias)
                .unwrap_err()
                .contains("managed by Host"));
            assert_eq!(
                model_import_location_at_root(&data, "other", &alias).unwrap(),
                model_import_location_at_root(&data, "other", &native).unwrap()
            );
            let elsewhere = base.join("elsewhere");
            fs::create_dir_all(&elsewhere).unwrap();
            symlink(&elsewhere, native.join("linked")).unwrap();
            assert!(
                model_import_location_at_root(&data, "linked/nested", &native)
                    .unwrap_err()
                    .contains("real model directory")
            );
            let imported = native.join("imported");
            fs::create_dir_all(&imported).unwrap();
            write_artifact(&imported.join("model.ginfer"), true);
            fs::write(imported.join("model.yml"), "regular file\n").unwrap();
            assert!(model_import_location_at_root(&data, "imported", &native).is_ok());
            fs::remove_file(imported.join("model.ginfer")).unwrap();
            symlink(&payload, imported.join("model.ginfer")).unwrap();
            assert!(model_import_location_at_root(&data, "imported", &native).is_err());
            fs::remove_file(imported.join("model.ginfer")).unwrap();
            write_artifact(&imported.join("model.ginfer"), true);
            fs::remove_file(imported.join("model.yml")).unwrap();
            symlink(package.join("model.yml"), imported.join("model.yml")).unwrap();
            assert!(model_import_location_at_root(&data, "imported", &native).is_err());
            assert_eq!(fs::read(&payload).unwrap(), original_payload);
            assert_eq!(fs::read(&journal).unwrap(), original_journal);
        }
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
