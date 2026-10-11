//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.
//!
//! The CLI targets the app's single inference provider: `ginfer`. Models are
//! stored in the shared selected model root as a `.ginfer` artifact plus a
//! `model.yml`, with existing model locations remaining discoverable. Engines
//! live under `<data>/ginfer/linux/<architecture>/bin` on
//! Linux and `<data>/ginfer/bin` on Windows. App downloads are available here.

pub mod integrations;

use std::path::{Path, PathBuf};

use crate::core::app::commands::resolve_data_folder;

// Re-export impl functions and config types so the binary can call them directly.
// `load_ginfer_model_impl` is explicitly documented as usable without an AppHandle.
pub use tauri_plugin_ginfer::{
    load_ginfer_model_impl, CliEndpointSettings, GinferConfig, GinferLoadRequest, GinferState,
};

/// The only inference provider the CLI runs: ginfer. Its runtime state and
/// binaries live under `<data_folder>/<LOCAL_PROVIDER>/`.
pub const LOCAL_PROVIDER: &str = "ginfer";

// ── State constructors ─────────────────────────────────────────────────────

pub fn init_ginfer_state() -> std::sync::Arc<GinferState> {
    static STATE: std::sync::OnceLock<std::sync::Arc<GinferState>> = std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Arc::new(GinferState::default())).clone()
}

// ── Model discovery ───────────────────────────────────────────────────────

/// Parsed representation of a `model.yml` file.
#[derive(Debug, serde::Deserialize)]
pub struct ModelYml {
    pub model_path: String,
    pub name: Option<String>,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub embedding: bool,
}

/// A discovered model entry: `(model_id, yml)`.
pub type ModelEntry = (String, ModelYml);

/// List the chat models installed for the local provider.
///
/// Embedding models are excluded: they cannot serve `/v1/chat/completions`, so
/// offering them anywhere the CLI leads is a dead end.
pub fn list_chat_models() -> Vec<ModelEntry> {
    let data_folder = resolve_data_folder();
    match crate::core::ginfer_models::adopt_root_ginfer_models_in(&data_folder) {
        Ok(report) => {
            for adopted in report.adopted {
                log::info!(
                    "Adopted root GInfer artifact as model '{}'",
                    adopted.model_id
                );
            }
            for rejected in report.rejected {
                log::warn!(
                    "Did not adopt root GInfer artifact '{}': {}",
                    rejected.filename,
                    rejected.reason
                );
            }
        }
        Err(error) => log::warn!("Could not scan root GInfer artifacts: {error}"),
    }
    list_chat_models_in(&data_folder)
}

/// Same as [`list_chat_models`], against an explicit data folder.
pub fn list_chat_models_in(data_folder: &Path) -> Vec<ModelEntry> {
    let locations = match crate::core::ginfer_models::enumerate_model_locations_in(data_folder) {
        Ok(locations) => locations,
        Err(error) => {
            log::warn!("Could not enumerate GInfer models: {error}");
            return Vec::new();
        }
    };
    let mut results = Vec::new();
    for location in locations {
        if let Ok(content) = std::fs::read_to_string(&location.manifest_path) {
            if let Ok(yml) = serde_yaml::from_str::<ModelYml>(&content) {
                if !yml.embedding {
                    results.push((location.model_id, yml));
                }
            }
        }
    }
    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}

/// Resolve the absolute model file path for a model ID.
///
/// `model_path` in the YAML can be:
///   - absolute (`/…` or `C:\…`) — used verbatim
///   - relative — joined with the GChat data folder
pub fn resolve_model_by_id(model_id: &str) -> Result<PathBuf, String> {
    resolve_model_by_id_in(&resolve_data_folder(), model_id)
}

/// Same as [`resolve_model_by_id`], against an explicit data folder.
pub fn resolve_model_by_id_in(data_folder: &Path, model_id: &str) -> Result<PathBuf, String> {
    let location = crate::core::ginfer_models::find_model_location_in(data_folder, model_id)?
        .ok_or_else(|| format!("Model '{model_id}' is not installed. Run `gchat-cli models list` to see available models."))?;
    let content = std::fs::read_to_string(location.manifest_path).map_err(|e| e.to_string())?;
    let yml: ModelYml = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
    let path = PathBuf::from(yml.model_path);
    Ok(if path.is_absolute() {
        path
    } else {
        data_folder.join(path)
    })
}

// ── Binary auto-discovery ──────────────────────────────────────────────────

/// Find the ginfer-serve binary inside the GChat data folder.
///
/// The ginfer extension downloads it to
/// Linux: `<data_folder>/ginfer/linux/sm120a/bin/ginfer-serve`.
/// Windows: `<data_folder>/ginfer/bin/ginfer-serve.exe`.
pub fn discover_ginfer_binary() -> Option<PathBuf> {
    discover_ginfer_binary_in(&resolve_data_folder())
}

/// Same as [`discover_ginfer_binary`], against an explicit data folder.
pub fn discover_ginfer_binary_in(data_folder: &Path) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ginfer-serve.exe"
    } else {
        "ginfer-serve"
    };
    #[cfg(target_os = "linux")]
    let candidate = data_folder.join(LOCAL_PROVIDER).join("linux/sm120a/bin").join(exe);
    #[cfg(not(target_os = "linux"))]
    let candidate = data_folder.join(LOCAL_PROVIDER).join("bin").join(exe);
    candidate.is_file().then_some(candidate)
}

// ── HuggingFace download ───────────────────────────────────────────────────

/// A single file entry from a HuggingFace repository.
#[derive(Debug, Clone)]
pub struct HfFileInfo {
    /// Original filename in the repo (e.g. `qwen3-9b.ginfer`)
    pub filename: String,
    /// Total size in bytes (from HF metadata or LFS pointer)
    pub size: u64,
    /// SHA-256 from the LFS pointer, used for integrity validation
    pub sha256: Option<String>,
    /// Direct download URL (`https://huggingface.co/{repo}/resolve/main/{file}`)
    pub download_url: String,
}

/// Return `true` if `s` looks like a HuggingFace repo ID (`owner/repo`).
///
/// A valid HF repo ID has exactly one `/`, both parts non-empty, no
/// filesystem path markers, and only alphanumeric / `-` / `_` / `.` chars.
pub fn looks_like_hf_repo(s: &str) -> bool {
    if s.starts_with('/') || s.starts_with('.') || s.starts_with('~') {
        return false;
    }
    let Some((owner, name)) = s.split_once('/') else {
        return false;
    };
    if owner.is_empty() || name.is_empty() || name.contains('/') {
        return false;
    }
    let ok = |c: char| c.is_alphanumeric() || matches!(c, '-' | '_' | '.');
    owner.chars().all(ok) && name.chars().all(ok)
}

/// Fetch the list of `.ginfer` files available in a HuggingFace repository.
///
/// Results are sorted by size ascending so smaller quantizations appear first.
/// Passes `hf_token` as a Bearer token when provided.
pub async fn fetch_hf_ginfer_files(
    repo_id: &str,
    hf_token: Option<&str>,
) -> Result<Vec<HfFileInfo>, String> {
    let url = format!(
        "https://huggingface.co/api/models/{}?blobs=true&files_metadata=true",
        repo_id
    );

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if let Some(tok) = hf_token {
        req = req.bearer_auth(tok);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();

    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!(
                "HuggingFace returned {status} for '{repo_id}'. \
                The repo may be gated — set the HF_TOKEN environment variable."
            ),
            404 => format!(
                "HuggingFace repo '{repo_id}' not found. \
                Check the repo ID or run `gchat-cli models list` to see local models."
            ),
            _ => format!("HuggingFace API error {status} for '{repo_id}'."),
        });
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let siblings = body["siblings"]
        .as_array()
        .ok_or_else(|| "Unexpected HuggingFace API response format".to_string())?;

    let mut files: Vec<HfFileInfo> = siblings
        .iter()
        .filter_map(|s| {
            let name = s["rfilename"].as_str()?;
            if !name.to_lowercase().ends_with(".ginfer") {
                return None;
            }
            // Prefer LFS size, fall back to top-level size field
            let size = s["lfs"]["size"]
                .as_u64()
                .or_else(|| s["size"].as_u64())
                .unwrap_or(0);
            let sha256 = s["lfs"]["sha256"].as_str().map(str::to_owned);
            let download_url = format!("https://huggingface.co/{}/resolve/main/{}", repo_id, name);
            Some(HfFileInfo {
                filename: name.to_owned(),
                size,
                sha256,
                download_url,
            })
        })
        .collect();

    if files.is_empty() {
        return Err(format!(
            "No .ginfer files found in HuggingFace repo '{repo_id}'."
        ));
    }

    // Smaller quantizations first
    files.sort_by_key(|f| f.size);
    Ok(files)
}

/// Download one `.ginfer` file from HuggingFace and write a `model.yml` for it.
///
/// Uses the shared selected model root and canonical `model.ginfer`;
/// existing artifacts and partial downloads in previous roots are left alone.
///
/// The file is streamed to `model.ginfer.part` and renamed only once the download
/// completes, so an interrupted run never leaves a truncated `.ginfer` behind a
/// `model.yml` that claims it is ready.
///
/// `on_progress(downloaded, total)` is called after each chunk.
/// Returns the local model ID (same as `repo_id`).
pub async fn download_hf_model(
    repo_id: &str,
    file: &HfFileInfo,
    hf_token: Option<&str>,
    on_progress: impl Fn(u64, u64) + Send,
) -> Result<String, String> {
    download_hf_model_in(&resolve_data_folder(), repo_id, file, hf_token, on_progress).await
}

/// The same download against the caller's existing resolved data folder.
pub async fn download_hf_model_in(
    data_folder: &Path,
    repo_id: &str,
    file: &HfFileInfo,
    hf_token: Option<&str>,
    on_progress: impl Fn(u64, u64) + Send,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let location = crate::core::ginfer_models::model_import_location_in(data_folder, repo_id)?;
    let model_dir = PathBuf::from(&location.model_dir);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| e.to_string())?;

    let dest_path = PathBuf::from(&location.artifact_path);
    let mut part_name = dest_path.as_os_str().to_owned();
    part_name.push(".part");
    let part_path = PathBuf::from(part_name);

    // ── Download ──────────────────────────────────────────────────────────
    let client = reqwest::Client::new();
    let mut req = client.get(&file.download_url);
    if let Some(tok) = hf_token {
        req = req.bearer_auth(tok);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download request failed: {}", resp.status()));
    }

    // Use the server-reported content-length, fall back to metadata size
    let total = resp.content_length().unwrap_or(file.size);
    let mut downloaded: u64 = 0;

    let mut dest = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(dest);
                let _ = tokio::fs::remove_file(&part_path).await;
                return Err(e.to_string());
            }
        };
        if let Err(e) = dest.write_all(&chunk).await {
            drop(dest);
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(e.to_string());
        }
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }
    dest.flush().await.map_err(|e| e.to_string())?;
    drop(dest);

    tokio::fs::rename(&part_path, &dest_path)
        .await
        .map_err(|e| e.to_string())?;

    // ── Write model.yml ───────────────────────────────────────────────────
    let display_name = repo_id.rsplit('/').next().unwrap_or(repo_id);
    let yml = {
        let mut metadata = serde_json::json!({
            "model_path":location.model_path, "name":display_name,
            "size_bytes":file.size, "embedding":false,
        });
        if let Some(sha) = &file.sha256 {
            metadata["sha256"] = serde_json::json!(sha);
        }
        serde_yaml::to_string(&metadata).map_err(|e| e.to_string())?
    };
    let manifest_path = PathBuf::from(location.manifest_path);
    tokio::fs::write(manifest_path, yml)
        .await
        .map_err(|e| e.to_string())?;

    Ok(repo_id.to_string())
}

// ── App config ────────────────────────────────────────────────────────────

pub fn cli_get_data_folder() -> PathBuf {
    resolve_data_folder()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_data_folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("gchat-cli-tests").join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp data folder");
        dir
    }

    fn write_model(data_folder: &Path, model_id: &str, yml: &str) {
        let dir = data_folder.join("ginfer/models").join(model_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("model.yml"), yml).unwrap();
    }

    #[test]
    fn lists_models_and_skips_embeddings() {
        let data = temp_data_folder("list-models");

        write_model(
            &data,
            "SectileLabs/Qwen3.5-9B",
            "model_path: ginfer/models/SectileLabs/Qwen3.5-9B/model.ginfer\n\
             name: Qwen3.5-9B\nsize_bytes: 123\nembedding: false\n",
        );
        // Embedding models cannot serve /v1/chat/completions.
        write_model(
            &data,
            "some/embedder",
            "model_path: ginfer/models/some/embedder/model.ginfer\n\
             name: Embedder\nembedding: true\n",
        );
        // A directory with no model.yml is not a model.
        std::fs::create_dir_all(data.join("ginfer/models/junk")).unwrap();

        let models = list_chat_models_in(&data);
        let ids: Vec<&str> = models.iter().map(|(id, _)| id.as_str()).collect();

        assert_eq!(ids, vec!["SectileLabs/Qwen3.5-9B"]);
        assert_eq!(models[0].1.name.as_deref(), Some("Qwen3.5-9B"));

        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn missing_provider_folder_lists_nothing() {
        let data = temp_data_folder("no-provider");
        assert!(list_chat_models_in(&data).is_empty());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn resolves_relative_and_absolute_model_paths() {
        let data = temp_data_folder("resolve-paths");

        write_model(
            &data,
            "rel/model",
            "model_path: ginfer/models/rel/model/model.ginfer\n",
        );
        let model_path = resolve_model_by_id_in(&data, "rel/model").unwrap();
        assert_eq!(model_path, data.join("ginfer/models/rel/model/model.ginfer"));

        let absolute = if cfg!(windows) {
            "C:\\models\\abs.ginfer"
        } else {
            "/models/abs.ginfer"
        };
        write_model(&data, "abs/model", &format!("model_path: {absolute}\n"));
        let model_path = resolve_model_by_id_in(&data, "abs/model").unwrap();
        assert_eq!(model_path, PathBuf::from(absolute));

        let err = resolve_model_by_id_in(&data, "nope").unwrap_err();
        assert!(err.contains("not installed"), "unexpected error: {err}");

        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn discovers_ginfer_binary() {
        let data = temp_data_folder("discover-binary");
        let exe = if cfg!(windows) {
            "ginfer-serve.exe"
        } else {
            "ginfer-serve"
        };
        #[cfg(target_os = "linux")]
        let bin_dir = data.join(LOCAL_PROVIDER).join("linux/sm120a/bin");
        #[cfg(not(target_os = "linux"))]
        let bin_dir = data.join(LOCAL_PROVIDER).join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::write(bin_dir.join(exe), b"stub").unwrap();

        let found = discover_ginfer_binary_in(&data).expect("binary discovered");
        assert_eq!(found, bin_dir.join(exe));

        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn no_bin_folder_discovers_nothing() {
        let data = temp_data_folder("no-bin");
        assert!(discover_ginfer_binary_in(&data).is_none());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn hf_download_uses_shared_placement_and_preserves_legacy_partial() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let temporary = tempfile::tempdir().unwrap();
        let admitted_data = std::env::var_os("GCHAT_WSL_PLACEMENT_FIXTURE_DATA_PATH");
        let data = admitted_data.as_ref().map(PathBuf::from)
            .unwrap_or_else(|| temporary.path().join("data"));
        std::fs::create_dir_all(&data).unwrap();
        let repo = "fixture/wsl-cli";
        let original = data.join("ginfer/models").join(repo);
        std::fs::create_dir_all(&original).unwrap();
        let legacy_partial = original.join("fixture.ginfer.part");
        assert!(!legacy_partial.exists());
        std::fs::write(&legacy_partial, b"retained interrupted download").unwrap();
        write_model(&data, "fixture/legacy-cli", "model_path: ginfer/models/fixture/legacy-cli/model.ginfer\nname: Legacy CLI\n");
        let legacy_model = data.join("ginfer/models/fixture/legacy-cli/model.ginfer");
        std::fs::write(&legacy_model, b"retained legacy artifact").unwrap();

        let location = crate::core::ginfer_models::model_import_location_in(&data, repo).unwrap();
        let destination = PathBuf::from(&location.artifact_path);
        assert!(!destination.exists());
        if admitted_data.is_some() {
            assert!(!destination.starts_with(&data), "admitted 9p storage must redirect to native storage");
            assert!(Path::new(&location.model_path).is_absolute());
            ginfer_host::model_storage::require_native_model_storage(destination.parent().unwrap()).unwrap();
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let payload = b"NINFER\0\x03loopback fixture";
        let server = tokio::spawn(async move {
            let (mut socket, _) = tokio::time::timeout(std::time::Duration::from_secs(5), listener.accept())
                .await.unwrap().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = tokio::time::timeout(std::time::Duration::from_secs(5), socket.read(&mut buffer))
                    .await.unwrap().unwrap();
                assert!(count > 0 && request.len() + count <= 4096);
                request.extend_from_slice(&buffer[..count]);
            }
            assert!(request.starts_with(b"GET /fixture.ginfer HTTP/1.1\r\n"));
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", payload.len()).as_bytes())
                .await.unwrap();
            socket.write_all(payload).await.unwrap();
        });
        let file = HfFileInfo {
            filename: "fixture.ginfer".into(), size: payload.len() as u64, sha256: None,
            download_url: format!("http://{address}/fixture.ginfer"),
        };
        let progress = AtomicU64::new(0);
        let model_id = tokio::time::timeout(std::time::Duration::from_secs(10),
            download_hf_model_in(&data, repo, &file, None, |downloaded, total| {
                assert_eq!(total, payload.len() as u64);
                progress.store(downloaded, Ordering::SeqCst);
            }))
            .await.unwrap().unwrap();
        server.await.unwrap();
        assert_eq!(model_id, repo);
        assert_eq!(progress.load(Ordering::SeqCst), payload.len() as u64);
        assert_eq!(std::fs::read(&destination).unwrap(), payload);
        assert!(!destination.with_extension("ginfer.part").exists());
        assert_eq!(std::fs::read(&legacy_partial).unwrap(), b"retained interrupted download");
        assert_eq!(std::fs::read(&legacy_model).unwrap(), b"retained legacy artifact");
        let metadata: ModelYml = serde_yaml::from_str(&std::fs::read_to_string(&location.manifest_path).unwrap()).unwrap();
        assert_eq!(metadata.model_path, location.model_path);
        assert_eq!(metadata.size_bytes, payload.len() as u64);
        let listed = list_chat_models_in(&data);
        let ids: Vec<&str> = listed.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, vec!["fixture/legacy-cli", repo]);
        assert_eq!(resolve_model_by_id_in(&data, repo).unwrap(), destination);
        assert_eq!(resolve_model_by_id_in(&data, "fixture/legacy-cli").unwrap(), legacy_model);
    }

    #[test]
    fn recognises_huggingface_repo_ids() {
        assert!(looks_like_hf_repo("SectileLabs/Qwen3.5-9B"));
        assert!(!looks_like_hf_repo("./local/path"));
        assert!(!looks_like_hf_repo("/abs/path"));
        assert!(!looks_like_hf_repo("~/home"));
        assert!(!looks_like_hf_repo("nolash"));
        assert!(!looks_like_hf_repo("too/many/parts"));
    }
}
