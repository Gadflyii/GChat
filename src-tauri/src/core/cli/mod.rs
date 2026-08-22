//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.
//!
//! The CLI targets the app's single inference provider: `ginfer`. Models are
//! stored in `<data>/ginfer/models/<model_id>/` as a `.ginfer` artifact plus a
//! `model.yml`, and the backend binary lives at `<data>/ginfer/bin/`. Models
//! the user downloads in the app therefore show up here without any extra
//! wiring.

pub mod integrations;

use std::path::{Path, PathBuf};

use crate::core::app::commands::resolve_jan_data_folder;

// Re-export impl functions and config types so the binary can call them directly.
// `load_ginfer_model_impl` is explicitly documented as usable without an AppHandle.
pub use tauri_plugin_ginfer::{load_ginfer_model_impl, GinferConfig, GinferState};

/// The only inference provider the CLI runs: ginfer. Its binary and models
/// live under `<data_folder>/<LOCAL_PROVIDER>/`.
pub const LOCAL_PROVIDER: &str = "ginfer";

/// On-disk subfolder holding the model tree, at `<data_folder>/<MODELS_ROOT>/models/`.
pub const MODELS_ROOT: &str = "ginfer";

// ── State constructors ─────────────────────────────────────────────────────

pub fn init_ginfer_state() -> GinferState {
    GinferState::default()
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
    list_chat_models_in(&resolve_jan_data_folder())
}

/// Same as [`list_chat_models`], against an explicit data folder.
pub fn list_chat_models_in(data_folder: &Path) -> Vec<ModelEntry> {
    use std::fs;

    let models_root = data_folder.join(MODELS_ROOT).join("models");

    if !models_root.exists() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut stack = vec![models_root.clone()];

    while let Some(dir) = stack.pop() {
        let yml_path = dir.join("model.yml");
        if yml_path.exists() {
            if let Ok(content) = fs::read_to_string(&yml_path) {
                if let Ok(yml) = serde_yaml::from_str::<ModelYml>(&content) {
                    // model_id = path relative to models_root, always using
                    // forward slashes so Windows `\` separators never leak
                    // into config files (e.g. TOML) or API responses.
                    let model_id = dir
                        .strip_prefix(&models_root)
                        .unwrap_or(&dir)
                        .to_string_lossy()
                        .into_owned()
                        .replace('\\', "/");
                    if !yml.embedding {
                        results.push((model_id, yml));
                    }
                    continue; // don't recurse into a model directory
                }
            }
        }
        // Recurse into subdirectories
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    stack.push(entry.path());
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
    resolve_model_by_id_in(&resolve_jan_data_folder(), model_id)
}

/// Same as [`resolve_model_by_id`], against an explicit data folder.
pub fn resolve_model_by_id_in(data_folder: &Path, model_id: &str) -> Result<PathBuf, String> {
    let yml_path = data_folder
        .join(MODELS_ROOT)
        .join("models")
        .join(model_id)
        .join("model.yml");

    if !yml_path.exists() {
        return Err(format!(
            "Model '{model_id}' is not installed. \
            Run `gchat-cli models list` to see available models."
        ));
    }

    let content = std::fs::read_to_string(&yml_path).map_err(|e| e.to_string())?;
    let yml: ModelYml = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;

    let pb = PathBuf::from(&yml.model_path);
    if pb.is_absolute() {
        Ok(pb)
    } else {
        Ok(data_folder.join(pb))
    }
}

// ── Binary auto-discovery ──────────────────────────────────────────────────

/// Find the ginfer-serve binary inside the GChat data folder.
///
/// The ginfer extension downloads it to
/// `<data_folder>/ginfer/bin/ginfer-serve[.exe]`.
pub fn discover_ginfer_binary() -> Option<PathBuf> {
    discover_ginfer_binary_in(&resolve_jan_data_folder())
}

/// Same as [`discover_ginfer_binary`], against an explicit data folder.
pub fn discover_ginfer_binary_in(data_folder: &Path) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ginfer-serve.exe"
    } else {
        "ginfer-serve"
    };
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
/// The model is stored at `<data_folder>/ginfer/models/<repo_id>/<filename>`
/// — the model tree the desktop app downloads into, so the two stay
/// interchangeable.
///
/// The file is streamed to `<filename>.part` and renamed only once the download
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
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let data_folder = resolve_jan_data_folder();
    let model_dir = data_folder.join(MODELS_ROOT).join("models").join(repo_id);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| e.to_string())?;

    let dest_path = model_dir.join(&file.filename);
    let part_path = model_dir.join(format!("{}.part", file.filename));

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
    // model_path is relative to the GChat data folder
    let rel_path = format!("{MODELS_ROOT}/models/{repo_id}/{}", file.filename);
    let display_name = repo_id.rsplit('/').next().unwrap_or(repo_id);

    let mut yml = format!(
        "model_path: {rel_path}\nname: {display_name}\nsize_bytes: {}\nembedding: false\n",
        file.size
    );
    if let Some(sha) = &file.sha256 {
        yml.push_str(&format!("sha256: {sha}\n"));
    }

    tokio::fs::write(model_dir.join("model.yml"), yml)
        .await
        .map_err(|e| e.to_string())?;

    Ok(repo_id.to_string())
}

// ── App config ────────────────────────────────────────────────────────────

pub fn cli_get_data_folder() -> PathBuf {
    resolve_jan_data_folder()
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
        let dir = data_folder.join(MODELS_ROOT).join("models").join(model_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("model.yml"), yml).unwrap();
    }

    #[test]
    fn lists_models_and_skips_embeddings() {
        let data = temp_data_folder("list-models");

        write_model(
            &data,
            "GadflyII/Qwen3.5-9B",
            "model_path: ginfer/models/GadflyII/Qwen3.5-9B/model.ginfer\n\
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
        std::fs::create_dir_all(data.join(MODELS_ROOT).join("models").join("junk")).unwrap();

        let models = list_chat_models_in(&data);
        let ids: Vec<&str> = models.iter().map(|(id, _)| id.as_str()).collect();

        assert_eq!(ids, vec!["GadflyII/Qwen3.5-9B"]);
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
        let bin_dir = data.join(LOCAL_PROVIDER).join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::write(bin_dir.join(exe), b"stub").unwrap();

        let found = discover_ginfer_binary_in(&data).expect("binary discovered");
        assert_eq!(found, data.join(LOCAL_PROVIDER).join("bin").join(exe));

        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn no_bin_folder_discovers_nothing() {
        let data = temp_data_folder("no-bin");
        assert!(discover_ginfer_binary_in(&data).is_none());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn recognises_huggingface_repo_ids() {
        assert!(looks_like_hf_repo("GadflyII/Qwen3.5-9B"));
        assert!(!looks_like_hf_repo("./local/path"));
        assert!(!looks_like_hf_repo("/abs/path"));
        assert!(!looks_like_hf_repo("~/home"));
        assert!(!looks_like_hf_repo("nolash"));
        assert!(!looks_like_hf_repo("too/many/parts"));
    }
}
