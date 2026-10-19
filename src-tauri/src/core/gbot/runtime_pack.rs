//! The Windows installer ships the Gbot Cua runtime as one zip so the installer payload stays under
//! NSIS's 2 GB limit. This unpacks it once into the data folder: the zip's SHA-256 is checked first,
//! files go to a temporary folder that is renamed into place only when complete, and it is unpacked
//! again when the app version or the zip changes. Any other platform, or a build without the zip,
//! uses the resources as installed.
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

const ZIP: &str = "resources/gbot/runtime.zip";
const PIN: &str = "resources/gbot/runtime-zip.json";
const MARKER: &str = ".unpacked.json";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn plain(action: &str, error: impl std::fmt::Display) -> String {
    format!("Gbot could not {action}: {error}. Free up disk space or check that GChat may write to its data folder, then start Gbot again.")
}

fn zip_digest(path: &Path) -> io::Result<(String, u64)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        total += n as u64;
    }
    Ok((hex(&hasher.finalize()), total))
}

/// Returns the resource directory `ExecutorProcesses::packaged` should read: the installed one when the
/// runtime is not zipped, otherwise a verified unpacked copy under `<data>/gbot/runtime/`.
pub fn ensure(resources: &Path, data_root: &Path, app_version: &str) -> Result<PathBuf, String> {
    let zip = resources.join(ZIP);
    if !zip.is_file() {
        return Ok(resources.to_path_buf());
    }
    let pin: serde_json::Value = serde_json::from_slice(
        &fs::read(resources.join(PIN)).map_err(|e| plain("read the Cua runtime description", e))?,
    )
    .map_err(|e| plain("read the Cua runtime description", e))?;
    let expected = pin["zip_sha256"].as_str().ok_or_else(|| plain("read the Cua runtime description", "missing checksum"))?;
    let expected_bytes = pin["zip_bytes"].as_u64().ok_or_else(|| plain("read the Cua runtime description", "missing size"))?;
    let runtimes = data_root.join("gbot").join("runtime");
    let id = &expected[..expected.len().min(16)];
    let ready = runtimes.join(id);
    let marker = serde_json::json!({"zip_sha256": expected, "app_version": app_version});
    if fs::read(ready.join(MARKER)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).as_ref() == Some(&marker) {
        return Ok(ready);
    }
    // Check the zip before touching the disk.
    let (actual, bytes) = zip_digest(&zip).map_err(|e| plain("read the installed Cua runtime", e))?;
    if actual != expected || bytes != expected_bytes {
        return Err("Gbot's installed Cua runtime is damaged (its checksum does not match). Reinstall GChat to repair it.".into());
    }
    fs::create_dir_all(&runtimes).map_err(|e| plain("prepare its runtime folder", e))?;
    let temporary = runtimes.join(format!("{id}.unpacking"));
    let _ = fs::remove_dir_all(&temporary);
    let result = unpack(&zip, resources, &temporary, &marker);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(plain("unpack its runtime", error));
    }
    let _ = fs::remove_dir_all(&ready);
    fs::rename(&temporary, &ready).map_err(|e| {
        let _ = fs::remove_dir_all(&temporary);
        plain("finish unpacking its runtime", e)
    })?;
    // Older unpacked runtimes are no longer needed.
    if let Ok(entries) = fs::read_dir(&runtimes) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy() != id {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(ready)
}

fn unpack(zip: &Path, resources: &Path, target: &Path, marker: &serde_json::Value) -> io::Result<()> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip)?).map_err(io::Error::other)?;
    let gbot = target.join("resources/gbot");
    fs::create_dir_all(&gbot)?;
    for index in 0..archive.len() {
        let mut member = archive.by_index(index).map_err(io::Error::other)?;
        let Some(relative) = member.enclosed_name().map(Path::to_path_buf) else {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "an entry points outside the runtime folder"));
        };
        let destination = gbot.join(relative);
        if member.is_dir() {
            fs::create_dir_all(&destination)?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&destination)?;
        io::copy(&mut member, &mut out)?;
        out.sync_all()?;
    }
    // The runtime runs Bun from the resource folder it is given.
    for name in ["bun.exe", "resources/bin/bun"] {
        let from = resources.join(name);
        if from.is_file() {
            let to = target.join(name);
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&from, &to)?;
        }
    }
    fs::write(target.join(MARKER), serde_json::to_vec(marker).map_err(io::Error::other)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn installed(dir: &Path, files: &[(&str, &[u8])]) -> (PathBuf, String) {
        let resources = dir.join("install");
        fs::create_dir_all(resources.join("resources/gbot")).unwrap();
        fs::write(resources.join("bun.exe"), b"bun").unwrap();
        let path = resources.join(ZIP);
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, data) in files {
            zip.start_file(*name, zip::write::FileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        let (sha, bytes) = zip_digest(&path).unwrap();
        fs::write(resources.join(PIN), serde_json::json!({"zip_sha256": sha, "zip_bytes": bytes}).to_string()).unwrap();
        (resources, sha)
    }

    #[test]
    fn without_a_zip_the_installed_resources_are_used() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(ensure(dir.path(), &dir.path().join("data"), "1").unwrap(), dir.path());
    }

    #[test]
    fn the_runtime_is_unpacked_once_next_to_bun_and_reused_until_the_version_or_zip_changes() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (resources, sha) = installed(dir.path(), &[("runtime.json", b"{}"), ("python/python.exe", b"py")]);
        let ready = ensure(&resources, &data, "2.0.42").unwrap();
        assert_eq!(ready, data.join("gbot/runtime").join(&sha[..16]));
        assert_eq!(fs::read(ready.join("resources/gbot/python/python.exe")).unwrap(), b"py");
        assert_eq!(fs::read(ready.join("bun.exe")).unwrap(), b"bun");
        assert!(!data.join("gbot/runtime").join(format!("{}.unpacking", &sha[..16])).exists());
        // Reused: a file removed from the unpacked copy stays removed only if nothing re-unpacks it.
        fs::write(ready.join("resources/gbot/extra"), b"x").unwrap();
        assert_eq!(ensure(&resources, &data, "2.0.42").unwrap(), ready);
        assert!(ready.join("resources/gbot/extra").exists(), "same version and zip: not unpacked again");
        // A new app version unpacks again, replacing the folder.
        assert_eq!(ensure(&resources, &data, "2.0.43").unwrap(), ready);
        assert!(!ready.join("resources/gbot/extra").exists());
        // A different zip is a different folder and the older one is removed.
        let (resources2, sha2) = installed(&dir.path().join("second"), &[("runtime.json", b"{\"v\":2}")]);
        let second = ensure(&resources2, &data, "2.0.43").unwrap();
        assert_eq!(second, data.join("gbot/runtime").join(&sha2[..16]));
        assert!(!ready.exists());
    }

    #[test]
    fn a_damaged_zip_is_refused_before_anything_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (resources, _) = installed(dir.path(), &[("runtime.json", b"{}")]);
        let zip = resources.join(ZIP);
        let mut bytes = fs::read(&zip).unwrap();
        bytes[10] ^= 0xff;
        fs::write(&zip, bytes).unwrap();
        let error = ensure(&resources, &data, "2.0.42").unwrap_err();
        assert!(error.contains("damaged") && error.contains("Reinstall"), "{error}");
        assert!(!data.exists(), "nothing was created");
    }

    #[test]
    fn a_failed_unpack_leaves_no_half_unpacked_runtime_and_says_why_in_plain_words() {
        let dir = tempfile::tempdir().unwrap();
        // The data folder path is a file, so the runtime folder cannot be created.
        let data = dir.path().join("data");
        fs::write(&data, b"not a folder").unwrap();
        let (resources, _) = installed(dir.path(), &[("runtime.json", b"{}")]);
        let error = ensure(&resources, &data, "2.0.42").unwrap_err();
        assert!(error.starts_with("Gbot could not") && error.contains("Free up disk space"), "{error}");
        // A crash midway (a leftover .unpacking folder) is cleaned and the next start succeeds.
        let data2 = dir.path().join("data2");
        let (_, sha) = installed(&dir.path().join("again"), &[("runtime.json", b"{}")]);
        let leftover = data2.join("gbot/runtime").join(format!("{}.unpacking", &sha[..16]));
        fs::create_dir_all(&leftover).unwrap();
        fs::write(leftover.join("junk"), b"half").unwrap();
        let ready = ensure(&dir.path().join("again/install"), &data2, "2.0.42").unwrap();
        assert!(ready.join("resources/gbot/runtime.json").is_file() && !leftover.exists());
    }

    /// Opt-in proof with the real installed zip on a real profile. Environment:
    /// `GCHAT_RUNTIME_ZIP_RESOURCES` (the directory holding `resources/gbot/runtime.zip`, `runtime-zip.json` and `bun.exe`),
    /// `GCHAT_RUNTIME_ZIP_DATA` (a data folder that persists between runs) and `GCHAT_RUNTIME_ZIP_VERSION`.
    /// It prints `UNPACKED=true|false` (whether this run unpacked again) and checks the Gbot service accepts the result.
    #[test]
    #[ignore]
    fn real_runtime_zip_unpacks_and_is_accepted_by_the_service() {
        let resources = PathBuf::from(std::env::var("GCHAT_RUNTIME_ZIP_RESOURCES").expect("GCHAT_RUNTIME_ZIP_RESOURCES"));
        let data = PathBuf::from(std::env::var("GCHAT_RUNTIME_ZIP_DATA").expect("GCHAT_RUNTIME_ZIP_DATA"));
        let version = std::env::var("GCHAT_RUNTIME_ZIP_VERSION").unwrap_or_else(|_| "real-zip-check".into());
        let before = fs::metadata(data.join("gbot/runtime")).ok().and_then(|_| {
            fs::read_dir(data.join("gbot/runtime")).ok()?.flatten().filter_map(|e| fs::metadata(e.path().join(MARKER)).ok()?.modified().ok()).max()
        });
        let started = std::time::Instant::now();
        let ready = ensure(&resources, &data, &version).unwrap();
        let after = fs::metadata(ready.join(MARKER)).unwrap().modified().unwrap();
        println!("UNPACKED={} elapsed={:?} folder={}", before != Some(after), started.elapsed(), ready.display());
        let entries: Vec<String> = fs::read_dir(data.join("gbot/runtime")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        println!("RUNTIME_FOLDERS={entries:?}");
        let processes = gbot_service::executor::ExecutorProcesses::packaged(&ready).unwrap();
        assert!(processes.is_some(), "the service must accept the unpacked runtime");
    }
}
