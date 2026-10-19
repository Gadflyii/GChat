use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use url::Url;

pub const ARTIFACT_CACHE_DIRECTORY: &str = "artifacts";
pub const PREVIEW_CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid artifact preview identifier".to_string());
    }
    Ok(())
}

fn require_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Artifact preview cache must be a directory, not a link".to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Artifact preview cache must not be a reparse point".to_string());
        }
    }
    Ok(())
}

fn cache_directory(cache_root: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    if create {
        let mut builder = DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(cache_root)
            .map_err(|error| error.to_string())?;
    } else if !cache_root.try_exists().map_err(|error| error.to_string())? {
        return Ok(None);
    }
    require_directory(cache_root)?;

    let directory = cache_root.join(ARTIFACT_CACHE_DIRECTORY);
    if create {
        let mut builder = DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        if let Err(error) = builder.create(&directory) {
            if error.kind() != ErrorKind::AlreadyExists {
                return Err(error.to_string());
            }
        }
    } else {
        match fs::symlink_metadata(&directory) {
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
            Ok(_) => {}
        }
    }
    require_directory(&directory)?;
    #[cfg(unix)]
    if create {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(Some(directory))
}

fn write_artifact(cache_root: &Path, id: &str, html: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let directory = cache_directory(cache_root, true)?
        .ok_or_else(|| "Artifact preview cache is unavailable".to_string())?;
    let path = directory.join(format!("{id}.html"));
    let mut options = OpenOptions::new();
    // Each render owns an immutable file. Never follow or overwrite an existing
    // entry, including a symlink planted at an otherwise valid identifier.
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(html.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path)
}

fn clear_artifact(cache_root: &Path, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let Some(directory) = cache_directory(cache_root, false)? else {
        return Ok(());
    };
    match fs::remove_file(directory.join(format!("{id}.html"))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Cache a settled preview and return only its opaque identifier. The native
/// preview scheme is registered outside Tauri's trusted application protocols;
/// the frontend also keeps the iframe sandboxed without `allow-same-origin`.
#[tauri::command]
pub fn set_artifact_html<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    html: String,
) -> Result<String, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    write_artifact(&cache_root, &id, &html)?;
    Ok(id)
}

fn read_preview(directory: &Path, url: &Url) -> Result<Vec<u8>, String> {
    let preview_origin = matches!(
        (url.scheme(), url.host_str()),
        ("gchat-preview", Some("localhost")) | ("http", Some("gchat-preview.localhost"))
    );
    if !preview_origin
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Invalid artifact preview URL".to_string());
    }
    // Only an unescaped, single opaque ID is accepted. No URL input is ever
    // interpreted as a filesystem path or percent-decoded into one.
    let id = url
        .path()
        .strip_prefix('/')
        .ok_or_else(|| "Invalid artifact preview URL".to_string())?;
    validate_id(id)?;
    require_directory(directory)?;
    let path = directory.join(format!("{id}.html"));
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Artifact preview cache entry must be a file, not a link".to_string());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Artifact preview cache entry must be a file".to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Artifact preview cache entry must not be a reparse point".to_string());
        }
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

/// Shared by the native Linux scheme and Windows intercepted preview origin.
/// `cache_directory` is exactly `app_cache_dir()/ARTIFACT_CACHE_DIRECTORY`.
pub fn serve_cached_preview(cache_directory: &Path, url: &Url) -> tauri::http::Response<Vec<u8>> {
    let (status, content_type, body) = match read_preview(cache_directory, url) {
        Ok(bytes) => (200, "text/html; charset=utf-8", bytes),
        Err(_) => (
            404,
            "text/plain; charset=utf-8",
            b"Preview not found".to_vec(),
        ),
    };
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Security-Policy", PREVIEW_CONTENT_SECURITY_POLICY)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .expect("static preview response headers are valid")
}

#[tauri::command]
pub fn clear_artifact_html<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    clear_artifact(
        &app.path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?,
        &id,
    )
}

fn clear_cache(cache_root: &Path) -> Result<(), String> {
    let Some(directory) = cache_directory(cache_root, false)? else {
        return Ok(());
    };
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".html")) else {
            continue;
        };
        if validate_id(id).is_ok() {
            clear_artifact(cache_root, id)?;
        }
    }
    Ok(())
}

/// Discard previews left by an interrupted process at startup or normal exit.
/// Only preview filenames in the dedicated cache are removed; links are never
/// followed and unrelated cache entries are left alone.
pub fn clear_artifact_cache<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    clear_cache(
        &app.path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_preview_origins_serve_only_cached_html_with_restrictive_csp() {
        let cache = tempfile::tempdir().unwrap();
        let html = "<script>document.body.textContent = 'Preview ready'</script>";
        write_artifact(cache.path(), "preview-123", html).unwrap();
        let directory = cache.path().join(ARTIFACT_CACHE_DIRECTORY);
        for address in [
            "gchat-preview://localhost/preview-123",
            "http://gchat-preview.localhost/preview-123",
        ] {
            let response = serve_cached_preview(&directory, &Url::parse(address).unwrap());
            assert_eq!(response.status(), 200);
            assert_eq!(response.body(), html.as_bytes());
            assert_eq!(
                response.headers()["Content-Type"],
                "text/html; charset=utf-8"
            );
            assert_eq!(
                response.headers()["Content-Security-Policy"],
                "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"
            );
            assert_eq!(response.headers()["Cache-Control"], "no-store");
            assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
            assert!(!response
                .headers()
                .contains_key("Access-Control-Allow-Origin"));
        }
        clear_artifact(cache.path(), "preview-123").unwrap();
        assert_eq!(
            serve_cached_preview(
                &directory,
                &Url::parse("gchat-preview://localhost/preview-123").unwrap()
            )
            .status(),
            404
        );
    }

    #[test]
    fn preview_requests_cannot_read_outside_the_cache_or_accept_other_origins() {
        let cache = tempfile::tempdir().unwrap();
        write_artifact(cache.path(), "owned", "owned preview").unwrap();
        fs::write(cache.path().join("secret.html"), "outside secret").unwrap();
        let directory = cache.path().join(ARTIFACT_CACHE_DIRECTORY);
        for address in [
            "gchat-preview://localhost/",
            "gchat-preview://localhost/missing",
            "gchat-preview://localhost/../secret",
            "gchat-preview://localhost/%2e%2e/secret",
            "gchat-preview://localhost/%2fsecret",
            "gchat-preview://localhost/owned/secret",
            "gchat-preview://localhost/%6fwned",
            "gchat-preview://localhost/owned.html",
            "gchat-preview://localhost/owned?path=../secret",
            "gchat-preview://localhost/owned#fragment",
            "gchat-preview://localhost:123/owned",
            "gchat-preview://user@localhost/owned",
            "gchat-preview://other/owned",
            "http://localhost/owned",
            "https://gchat-preview.localhost/owned",
            "asset://localhost/owned",
            "file:///owned",
        ] {
            let response = serve_cached_preview(&directory, &Url::parse(address).unwrap());
            assert_eq!(response.status(), 404, "{address}");
            assert_eq!(response.body(), b"Preview not found", "{address}");
            assert_eq!(
                response.headers()["Content-Security-Policy"],
                PREVIEW_CONTENT_SECURITY_POLICY
            );
        }
    }

    #[test]
    fn previews_use_private_immutable_files_and_idempotent_cleanup() {
        let cache = tempfile::tempdir().unwrap();
        let html = "<script>document.body.textContent = 'Preview ready'</script>";
        let path = write_artifact(cache.path(), "preview-123", html).unwrap();
        assert_eq!(path, cache.path().join("artifacts/preview-123.html"));
        assert_eq!(fs::read_to_string(&path).unwrap(), html);
        assert!(write_artifact(cache.path(), "preview-123", "replacement").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), html);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        clear_artifact(cache.path(), "preview-123").unwrap();
        clear_artifact(cache.path(), "preview-123").unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn preview_ids_cannot_escape_the_cache_and_cleanup_preserves_other_files() {
        let cache = tempfile::tempdir().unwrap();
        for id in [
            "",
            "..",
            "../outside",
            "/absolute",
            "a/b",
            "a\\b",
            "a.html",
            "a?b",
            "a\0b",
        ] {
            assert!(write_artifact(cache.path(), id, "untrusted").is_err());
            assert!(clear_artifact(cache.path(), id).is_err());
        }
        assert!(write_artifact(cache.path(), &"a".repeat(129), "untrusted").is_err());
        let preview = write_artifact(cache.path(), "owned", "preview").unwrap();
        let unrelated = preview.parent().unwrap().join("keep.txt");
        fs::write(&unrelated, "keep").unwrap();
        clear_cache(cache.path()).unwrap();
        assert!(!preview.exists());
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "keep");
    }

    #[cfg(unix)]
    #[test]
    fn preview_cache_never_writes_through_directory_or_file_links() {
        use std::os::unix::fs::symlink;
        let cache = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), cache.path().join("artifacts")).unwrap();
        let url = Url::parse("gchat-preview://localhost/owned").unwrap();
        assert_eq!(
            serve_cached_preview(&cache.path().join("artifacts"), &url).status(),
            404
        );
        assert!(write_artifact(cache.path(), "owned", "preview").is_err());
        assert!(clear_artifact(cache.path(), "owned").is_err());
        assert!(clear_cache(cache.path()).is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);

        fs::remove_file(cache.path().join("artifacts")).unwrap();
        fs::create_dir(cache.path().join("artifacts")).unwrap();
        let target = outside.path().join("original.html");
        fs::write(&target, "original").unwrap();
        symlink(&target, cache.path().join("artifacts/owned.html")).unwrap();
        assert!(write_artifact(cache.path(), "owned", "replacement").is_err());
        assert_eq!(
            serve_cached_preview(&cache.path().join("artifacts"), &url).status(),
            404
        );
        clear_artifact(cache.path(), "owned").unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), "original");
    }
}
