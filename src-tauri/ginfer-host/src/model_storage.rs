//! Filesystem placement shared by managed model installers and downloaders.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

#[cfg(target_os = "linux")]
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
pub struct StorageRecommendation {
    pub requested_path: PathBuf,
    pub recommended_path: Option<PathBuf>,
    pub required_bytes: u64,
    pub candidates: Vec<StorageCandidate>,
}

#[derive(Debug, Serialize)]
pub struct StorageCandidate {
    pub path: PathBuf,
    pub measured_read_bytes_per_second: Option<f64>,
    pub available_bytes: Option<u64>,
    pub eligible: bool,
    pub reason: Option<String>,
}

// These are the native schema-v2 producer fields, not estimates from disk type,
// PCIe generation, or historical free_bytes. Keep unavailable measurements visible.
#[derive(Clone, Default, Deserialize)]
#[serde(default)]
struct SavedDisk {
    path: PathBuf,
    filesystem_uuid: String,
    model: String,
    serial: String,
    direct_io: bool,
    sequential_read_supported: bool,
    sequential_read: SavedMeasurement,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
struct SavedMeasurement {
    status: String,
    value: Option<f64>,
    reason: String,
}

#[derive(Clone, Debug, Default)]
struct DiskIdentity {
    filesystem_id: String,
    filesystem_uuid: String,
    model: String,
    serial: String,
}

struct InspectedCandidate {
    path: PathBuf,
    identity: Option<DiskIdentity>,
    available_bytes: Option<u64>,
    failures: Vec<String>,
}

/// Recommend placement using saved native measurements and current filesystem
/// checks. No benchmark runs, model moves, or storage-setting changes occur here.
/// The only write is a temporary empty writability check, removed immediately.
pub async fn recommend_storage(
    profile: &serde_json::Value,
    requested_root: &Path,
    required_bytes: u64,
) -> Result<StorageRecommendation, String> {
    if profile
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(2)
    {
        return Err(
            "Storage recommendations require a native schema-version 2 hardware profile".into(),
        );
    }
    if !requested_root.is_absolute() {
        return Err("Model storage must be an absolute path".into());
    }
    let disks: Vec<SavedDisk> = serde_json::from_value(
        profile
            .get("disks")
            .cloned()
            .ok_or("Hardware profile has no disk inventory")?,
    )
    .map_err(|error| format!("Invalid hardware profile disk inventory: {error}"))?;
    let mut inspected = Vec::with_capacity(disks.len());
    for disk in &disks {
        inspected.push(inspect_candidate(disk.clone(), requested_root.to_path_buf()).await);
    }
    Ok(select_storage(
        &disks,
        inspected,
        requested_root,
        required_bytes,
    ))
}

fn saved_rate(disk: &SavedDisk) -> Option<f64> {
    disk.sequential_read.value.filter(|rate| {
        disk.direct_io
            && disk.sequential_read_supported
            && disk.sequential_read.status == "measured"
            && rate.is_finite()
            && *rate > 0.0
    })
}

// Match the native producer/reader contract. Device numbers and paths are not
// stable identities. A known live serial must match; no live serial permits a
// unique UUID/model match. Filesystem UUIDs are case-insensitive in the producer.
fn disk_identity_matches(saved: &SavedDisk, live: &DiskIdentity) -> bool {
    !live.filesystem_uuid.is_empty()
        && !live.model.is_empty()
        && saved
            .filesystem_uuid
            .eq_ignore_ascii_case(&live.filesystem_uuid)
        && saved.model == live.model
        && (live.serial.is_empty() || saved.serial == live.serial)
}

fn select_storage(
    disks: &[SavedDisk],
    inspected: Vec<InspectedCandidate>,
    requested_root: &Path,
    required_bytes: u64,
) -> StorageRecommendation {
    let mut candidates: Vec<StorageCandidate> = disks.iter().zip(inspected).map(|(disk, live)| {
        let rate = saved_rate(disk);
        let mut failures = live.failures;
        if rate.is_none() {
            failures.push(if disk.sequential_read.reason.is_empty() {
                "No measured direct-I/O sequential read rate in the saved profile".into()
            } else {
                format!("No measured direct-I/O sequential read rate: {}", disk.sequential_read.reason)
            });
        }
        if let Some(identity) = &live.identity {
            if !disk_identity_matches(disk, identity) {
                failures.push("Saved disk UUID/model/serial does not match a verified live disk identity".into());
            } else if disks.iter().filter(|saved| disk_identity_matches(saved, identity)).count() != 1 {
                failures.push("Saved disk identity is ambiguous; its measured rate cannot be reused".into());
            }
        } else if failures.is_empty() {
            failures.push("Live disk identity is unavailable".into());
        }
        if let Some(available) = live.available_bytes {
            if available < required_bytes {
                failures.push(format!("Insufficient live free space: {available} bytes available, {required_bytes} required"));
            }
        } else if failures.is_empty() {
            failures.push("Live free space is unavailable".into());
        }
        StorageCandidate {
            path: live.path,
            measured_read_bytes_per_second: rate,
            available_bytes: live.available_bytes,
            eligible: failures.is_empty(),
            reason: (!failures.is_empty()).then(|| failures.join("; ")),
        }
    }).collect();
    // Stable ordering retains the profile's order for equal rates, except that
    // an existing requested root wins a tie without changing its spelling.
    candidates.sort_by(|a, b| {
        b.measured_read_bytes_per_second
            .partial_cmp(&a.measured_read_bytes_per_second)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| (b.path == requested_root).cmp(&(a.path == requested_root)))
    });
    let recommended_path = candidates
        .iter()
        .find(|candidate| candidate.eligible)
        .map(|candidate| candidate.path.clone());
    StorageRecommendation {
        requested_path: requested_root.to_path_buf(),
        recommended_path,
        required_bytes,
        candidates,
    }
}

fn placement_on_disk(
    source: &Path,
    requested: &Path,
    source_identity: &DiskIdentity,
    requested_identity: Option<&DiskIdentity>,
) -> PathBuf {
    if requested_identity
        .is_some_and(|identity| identity.filesystem_id == source_identity.filesystem_id)
    {
        requested.to_path_buf()
    } else {
        source.join("ginfer/models")
    }
}

fn prepare_candidate(
    disk: &SavedDisk,
    requested: &Path,
) -> Result<(PathBuf, PathBuf, DiskIdentity), String> {
    if !disk.path.is_absolute() || !disk.path.is_dir() {
        return Err("Saved disk path is not an existing absolute directory; its filesystem may be unmounted".into());
    }
    let identity = live_disk_identity(&disk.path)?;
    let requested_identity = canonical_existing_prefix(requested)
        .and_then(|(_, ancestor)| live_disk_identity(&ancestor))
        .ok();
    let path = placement_on_disk(
        &disk.path,
        requested,
        &identity,
        requested_identity.as_ref(),
    );
    let (_, ancestor) = canonical_existing_prefix(&path)?;
    if !ancestor.is_dir() {
        return Err("Model storage ancestor is not a directory".into());
    }
    if live_disk_identity(&ancestor)?.filesystem_id != identity.filesystem_id {
        return Err(
            "Model storage resolves onto a different filesystem from the measured directory".into(),
        );
    }
    Ok((path, ancestor, identity))
}

async fn inspect_candidate(disk: SavedDisk, requested: PathBuf) -> InspectedCandidate {
    let fallback_path = disk.path.join("ginfer/models");
    let prepared = tokio::task::spawn_blocking(move || {
        let (path, ancestor, identity) = prepare_candidate(&disk, &requested)?;
        let failure = require_native_model_storage(&path)
            .and_then(|()| check_writable(&ancestor))
            .err();
        Ok::<_, String>((path, ancestor, identity, failure))
    })
    .await
    .map_err(|error| format!("Cannot inspect model storage: {error}"))
    .and_then(|prepared| prepared);
    match prepared {
        Ok((path, ancestor, identity, failure)) => {
            let mut failures: Vec<_> = failure.into_iter().collect();
            let available_bytes = match crate::model_downloads::available_bytes(ancestor).await {
                Ok(available) => Some(available),
                Err(error) => {
                    failures.push(error);
                    None
                }
            };
            InspectedCandidate {
                path,
                identity: Some(identity),
                available_bytes,
                failures,
            }
        }
        Err(error) => InspectedCandidate {
            path: fallback_path,
            identity: None,
            available_bytes: None,
            failures: vec![error],
        },
    }
}

fn check_writable(ancestor: &Path) -> Result<(), String> {
    let path = ancestor.join(format!(
        ".gchat-storage-write-check-{}",
        uuid::Uuid::new_v4()
    ));
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Model storage is not writable: {error}"))?;
    drop(file);
    fs::remove_file(path)
        .map_err(|error| format!("Cannot remove model storage writability check: {error}"))
}

#[cfg(target_os = "linux")]
fn live_disk_identity(path: &Path) -> Result<DiskIdentity, String> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let device = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect disk identity: {error}"))?
        .dev();
    let filesystem_id = format!(
        "{}:{}",
        rustix::fs::major(device),
        rustix::fs::minor(device)
    );
    let mut identity = DiskIdentity {
        filesystem_id: filesystem_id.clone(),
        ..DiskIdentity::default()
    };
    if let Ok(entries) = fs::read_dir("/dev/disk/by-uuid") {
        for entry in entries.flatten() {
            if fs::metadata(entry.path()).is_ok_and(|metadata| {
                metadata.file_type().is_block_device() && metadata.rdev() == device
            }) {
                identity.filesystem_uuid = entry.file_name().to_string_lossy().into_owned();
                break;
            }
        }
    }
    // Mirror the producer: partitions use their owning disk; an md array uses
    // its own UUID/model rather than guessing an arbitrary slave's identity.
    if let Ok(mut block) = fs::canonicalize(Path::new("/sys/dev/block").join(filesystem_id)) {
        if block.join("partition").exists() {
            block.pop();
        }
        let has_slaves =
            fs::read_dir(block.join("slaves")).is_ok_and(|mut entries| entries.next().is_some());
        let line = |suffix: &str| {
            fs::read_to_string(block.join(suffix))
                .unwrap_or_default()
                .trim()
                .to_owned()
        };
        if has_slaves {
            let array_uuid = line("md/uuid");
            if !array_uuid.is_empty() {
                identity.model = "linux-md".into();
                identity.serial = array_uuid;
            }
        } else {
            identity.model = line("device/model");
            identity.serial = line("device/serial");
            if identity.serial.is_empty() {
                identity.serial = line("serial");
            }
        }
    }
    Ok(identity)
}

#[cfg(all(not(target_os = "linux"), not(windows)))]
fn live_disk_identity(_path: &Path) -> Result<DiskIdentity, String> {
    Err("Stable model-storage disk identity is unsupported on this platform".into())
}

#[cfg(windows)]
fn live_disk_identity(path: &Path) -> Result<DiskIdentity, String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};
    type Handle = *mut c_void;
    #[link(name = "kernel32")]
    extern "system" {
        #[link_name = "GetVolumePathNameW"]
        fn volume_path(path: *const u16, mount: *mut u16, size: u32) -> i32;
        #[link_name = "GetVolumeNameForVolumeMountPointW"]
        fn volume_name(mount: *const u16, name: *mut u16, size: u32) -> i32;
        #[link_name = "CreateFileW"]
        fn open_file(
            name: *const u16,
            access: u32,
            share: u32,
            security: *mut c_void,
            disposition: u32,
            flags: u32,
            template: Handle,
        ) -> Handle;
        #[link_name = "DeviceIoControl"]
        fn control(
            handle: Handle,
            code: u32,
            input: *const c_void,
            input_size: u32,
            output: *mut c_void,
            output_size: u32,
            returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
        #[link_name = "CloseHandle"]
        fn close_handle(handle: Handle) -> i32;
    }
    struct OwnedHandle(Handle);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: this wrapper owns a valid CreateFileW handle.
            unsafe {
                close_handle(self.0);
            }
        }
    }
    fn open(name: &[u16]) -> Option<OwnedHandle> {
        // SAFETY: caller supplies terminated UTF-16; no optional pointers used.
        let handle = unsafe {
            open_file(
                name.as_ptr(),
                0,
                3,
                std::ptr::null_mut(),
                3,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle as isize == -1 {
            None
        } else {
            Some(OwnedHandle(handle))
        }
    }
    fn query(handle: &OwnedHandle, code: u32, input: &[u8], output: &mut [u8]) -> bool {
        let mut returned = 0;
        // SAFETY: input/output slices remain allocated throughout the synchronous
        // call. Kernel32 receives their actual lengths and a valid owned handle.
        unsafe {
            control(
                handle.0,
                code,
                if input.is_empty() {
                    std::ptr::null()
                } else {
                    input.as_ptr().cast()
                },
                input.len() as u32,
                output.as_mut_ptr().cast(),
                output.len() as u32,
                &mut returned,
                std::ptr::null_mut(),
            ) != 0
        }
    }
    fn number(bytes: &[u8], offset: usize) -> Option<u32> {
        Some(u32::from_le_bytes(
            bytes.get(offset..offset + 4)?.try_into().ok()?,
        ))
    }
    fn text(bytes: &[u8], offset_field: usize) -> String {
        let Some(offset) = number(bytes, offset_field).filter(|offset| *offset != 0) else {
            return String::new();
        };
        let Some(tail) = bytes.get(offset as usize..) else {
            return String::new();
        };
        String::from_utf8_lossy(
            &tail[..tail
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(tail.len())],
        )
        .trim_end()
        .to_owned()
    }
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Cannot inspect disk identity: {error}"))?;
    let mut wide: Vec<u16> = canonical.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err("Model storage path contains a NUL character".into());
    }
    wide.push(0);
    let mut mount = vec![0u16; 32768];
    let mut volume = vec![0u16; 32768];
    // SAFETY: all buffers have the declared sizes and wide is NUL terminated.
    if unsafe { volume_path(wide.as_ptr(), mount.as_mut_ptr(), mount.len() as u32) } == 0
        || unsafe { volume_name(mount.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0
    {
        return Err(format!(
            "Cannot inspect storage volume identity: {}",
            std::io::Error::last_os_error()
        ));
    }
    volume.truncate(
        volume
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(volume.len()),
    );
    let uuid = String::from_utf16_lossy(&volume);
    let mut identity = DiskIdentity {
        filesystem_id: uuid.clone(),
        filesystem_uuid: uuid,
        ..DiskIdentity::default()
    };
    if volume.last() == Some(&92) {
        volume.pop();
    }
    volume.push(0);
    if let Some(handle) = open(&volume) {
        // VOLUME_DISK_EXTENTS has its first DISK_EXTENT at offset 8 (8-byte
        // alignment), with DiskNumber at its start. Multi-disk volumes are not
        // guessed from a single member, matching the native producer.
        let mut extents = vec![0u8; 4096];
        if query(&handle, 0x0056_0000, &[], &mut extents) && number(&extents, 0) == Some(1) {
            if let Some(disk_number) = number(&extents, 8) {
                let physical: Vec<_> = format!("\\\\.\\PhysicalDrive{disk_number}")
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                if let Some(physical) = open(&physical) {
                    // StorageDeviceProperty + PropertyStandardQuery. Descriptor
                    // offsets are part of the STORAGE_DEVICE_DESCRIPTOR ABI.
                    let query_input = [0u8; 12];
                    let mut header = [0u8; 8];
                    if query(&physical, 0x002d_1400, &query_input, &mut header) {
                        if let Some(size) =
                            number(&header, 4).filter(|size| (36..=1_048_576).contains(size))
                        {
                            let mut descriptor = vec![0u8; size as usize];
                            if query(&physical, 0x002d_1400, &query_input, &mut descriptor) {
                                let vendor = text(&descriptor, 12);
                                let product = text(&descriptor, 16);
                                identity.model = if vendor.is_empty() {
                                    product
                                } else if product.is_empty() {
                                    vendor
                                } else {
                                    format!("{vendor} {product}")
                                };
                                identity.serial = text(&descriptor, 24);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(identity)
}

/// Resolve implicit managed storage without creating directories or moving files.
pub fn resolve_artifact_root(requested_root: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
        let home = std::env::var_os("HOME").map(PathBuf::from);
        resolve_with(
            requested_root,
            is_wsl()?,
            xdg.as_deref(),
            home.as_deref(),
            &is_windows_filesystem,
        )
    }
    #[cfg(not(target_os = "linux"))]
    Ok(requested_root.to_path_buf())
}

/// Explicit destinations and resumed downloads must remain on native storage.
pub fn require_native_model_storage(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        require_with(path, is_wsl()?, &is_windows_filesystem)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn is_wsl() -> Result<bool, String> {
    let release = fs::read_to_string("/proc/sys/kernel/osrelease")
        .map_err(|error| format!("Cannot determine model storage platform: {error}"))?;
    Ok(release.to_ascii_lowercase().contains("microsoft"))
}

#[cfg(target_os = "linux")]
fn is_windows_filesystem(existing_path: &Path) -> Result<bool, String> {
    let metadata = rustix::fs::statfs(existing_path).map_err(|error| {
        format!(
            "Cannot inspect model storage filesystem '{}': {error}",
            existing_path.display()
        )
    })?;
    Ok(metadata.f_type == 0x0102_1997)
}

#[cfg(target_os = "linux")]
fn resolve_with(
    requested: &Path,
    wsl: bool,
    xdg: Option<&Path>,
    home: Option<&Path>,
    windows_filesystem: &impl Fn(&Path) -> Result<bool, String>,
) -> Result<PathBuf, String> {
    if !wsl {
        return Ok(requested.to_path_buf());
    }
    let (canonical, ancestor) = canonical_existing_prefix(requested)?;
    if !windows_filesystem(&ancestor)? {
        return Ok(requested.to_path_buf());
    }

    let namespace = format!(
        "{:x}",
        Sha256::digest(canonical.as_os_str().as_encoded_bytes())
    );
    let bases = [
        xdg.filter(|path| path.is_absolute()).map(Path::to_path_buf),
        home.filter(|path| path.is_absolute())
            .map(|path| path.join(".local/share")),
    ];
    let mut failures = Vec::new();
    for base in bases.into_iter().flatten() {
        let candidate = base.join("ginfer/managed-models").join(&namespace);
        let inspected = canonical_existing_prefix(&candidate)
            .and_then(|(_, ancestor)| windows_filesystem(&ancestor));
        match inspected {
            Ok(false) => return Ok(candidate),
            Ok(true) => failures.push(format!("'{}' is Windows-backed 9p", candidate.display())),
            Err(error) => failures.push(error),
        }
    }
    let detail = if failures.is_empty() {
        "XDG_DATA_HOME and HOME provide no absolute storage root".to_owned()
    } else {
        failures.join("; ")
    };
    Err(format!(
        "No verified Linux-backed managed model storage is available under WSL: {detail}. \
         Set XDG_DATA_HOME to an absolute Linux-filesystem directory, or choose native model storage explicitly. \
         Existing model files and partial downloads have not been moved."
    ))
}

#[cfg(target_os = "linux")]
fn require_with(
    path: &Path,
    wsl: bool,
    windows_filesystem: &impl Fn(&Path) -> Result<bool, String>,
) -> Result<(), String> {
    if wsl {
        let (_, ancestor) = canonical_existing_prefix(path)?;
        if windows_filesystem(&ancestor)? {
            return Err(format!(
                "Model storage '{}' is on the Windows-backed 9p filesystem under WSL. \
                 Choose a Linux-filesystem directory for new downloads. \
                 A Windows-backed partial download cannot be resumed here; start a new download \
                 in native storage and leave the existing files unchanged.",
                path.display()
            ));
        }
    }
    Ok(())
}

fn canonical_existing_prefix(path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Cannot resolve model storage working directory: {error}"))?
            .join(path)
    };
    let mut resolved = PathBuf::new();
    // Resolve existing links before processing `..`, which can change filesystem ownership.
    for part in absolute.components() {
        match part {
            Component::RootDir => resolved.push(part.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            Component::Normal(name) => {
                let next = resolved.join(name);
                match fs::canonicalize(&next) {
                    Ok(canonical) => resolved = canonical,
                    Err(error) if error.kind() == ErrorKind::NotFound => {
                        match fs::symlink_metadata(&next) {
                            Err(error) if error.kind() == ErrorKind::NotFound => resolved = next,
                            Ok(_) => {
                                return Err(format!(
                                    "Cannot resolve model storage '{}': {error}",
                                    next.display()
                                ))
                            }
                            Err(error) => {
                                return Err(format!(
                                    "Cannot inspect model storage '{}': {error}",
                                    next.display()
                                ))
                            }
                        }
                    }
                    Err(error) => {
                        return Err(format!(
                            "Cannot resolve model storage '{}': {error}",
                            next.display()
                        ))
                    }
                }
            }
            Component::Prefix(_) => {
                #[cfg(windows)]
                resolved.push(part.as_os_str());
                #[cfg(not(windows))]
                return Err("Model storage has an invalid Linux path prefix".into());
            }
        }
    }
    let mut ancestor = resolved.clone();
    loop {
        match fs::metadata(&ancestor) {
            Ok(_) => return Ok((resolved, ancestor)),
            Err(error) if error.kind() == ErrorKind::NotFound && ancestor.pop() => {}
            Err(error) => {
                return Err(format!(
                    "Cannot inspect model storage '{}': {error}",
                    ancestor.display()
                ))
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn measured_disk(path: &str, uuid: &str, rate: f64) -> SavedDisk {
        // The producer emits nested Measurement objects and bytes/second,
        // not a flat disk bandwidth field. Historical free_bytes is ignored.
        serde_json::from_value(serde_json::json!({
            "path": path, "filesystem_uuid": uuid, "model": "Test SSD", "serial": "serial-1",
            "filesystem_id": "old-device-number", "free_bytes": u64::MAX,
            "direct_io": true, "sequential_read_supported": true,
            "sequential_read": {"status": "measured", "value": rate, "bytes": 1048576,
                "operations": 1, "seconds": 0.001, "reason": ""},
            "random_read_4k": {"status": "skipped", "reason": "not requested"}
        }))
        .unwrap()
    }

    fn inspected(
        path: &str,
        uuid: &str,
        available: u64,
        failures: Vec<String>,
    ) -> InspectedCandidate {
        InspectedCandidate {
            path: PathBuf::from(path),
            identity: Some(DiskIdentity {
                filesystem_id: uuid.into(),
                filesystem_uuid: uuid.into(),
                model: "Test SSD".into(),
                serial: "serial-1".into(),
            }),
            available_bytes: Some(available),
            failures,
        }
    }

    #[test]
    fn storage_recommendation_skips_full_unwritable_and_wsl_windows_disks() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("file");
        fs::write(&file, b"existing model stays unchanged").unwrap();
        let unwritable = check_writable(&file).unwrap_err();
        let windows = require_with(directory.path(), true, &|_| Ok(true)).unwrap_err();
        let disks = vec![
            measured_disk("/fast-full", "full", 600.0),
            measured_disk("/windows", "windows", 500.0),
            measured_disk("/unwritable", "unwritable", 400.0),
            measured_disk("/native-fast", "fast", 300.0),
            measured_disk("/native-slow", "slow", 100.0),
        ];
        let result = select_storage(
            &disks,
            vec![
                inspected("/fast-full/ginfer/models", "full", 99, vec![]),
                inspected("/windows/ginfer/models", "windows", 1000, vec![windows]),
                inspected(
                    "/unwritable/ginfer/models",
                    "unwritable",
                    1000,
                    vec![unwritable],
                ),
                inspected("/native-fast/ginfer/models", "fast", 100, vec![]),
                inspected("/native-slow/ginfer/models", "slow", 1000, vec![]),
            ],
            Path::new("/requested/models"),
            100,
        );
        assert_eq!(
            result.recommended_path,
            Some(PathBuf::from("/native-fast/ginfer/models"))
        );
        assert_eq!(result.candidates[0].available_bytes, Some(99));
        assert!(result.candidates[0]
            .reason
            .as_ref()
            .unwrap()
            .contains("Insufficient live free space"));
        assert!(result.candidates[1]
            .reason
            .as_ref()
            .unwrap()
            .contains("Windows-backed 9p"));
        assert!(result.candidates[2]
            .reason
            .as_ref()
            .unwrap()
            .contains("not writable"));
        assert_eq!(fs::read(file).unwrap(), b"existing model stays unchanged");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn storage_recommendation_requires_measured_rates_and_current_unique_stable_identity() {
        let mut unavailable = measured_disk("/inventory-only", "inventory", 9000.0);
        unavailable.sequential_read.status = "skipped".into();
        unavailable.sequential_read.reason =
            "no owned profiler cache directory with matching filesystem identity".into();
        let mut stale_serial = inspected("/changed/models", "changed", 1000, vec![]);
        stale_serial.identity.as_mut().unwrap().serial = "replacement-disk".into();
        let disks = vec![
            unavailable,
            measured_disk("/changed", "changed", 8000.0),
            measured_disk("/current", "CURRENT", 200.0),
        ];
        let result = select_storage(
            &disks,
            vec![
                inspected("/inventory-only/ginfer/models", "inventory", 1000, vec![]),
                stale_serial,
                inspected("/current/ginfer/models", "current", 1000, vec![]),
            ],
            Path::new("/requested"),
            100,
        );
        assert_eq!(
            result.recommended_path,
            Some(PathBuf::from("/current/ginfer/models"))
        );
        let absent = result
            .candidates
            .iter()
            .find(|candidate| candidate.measured_read_bytes_per_second.is_none())
            .unwrap();
        assert!(!absent.eligible);
        assert!(absent
            .reason
            .as_ref()
            .unwrap()
            .contains("no owned profiler cache directory"));
        assert!(!result.candidates[0].eligible);

        let disks = vec![
            measured_disk("/alias-a", "same", 500.0),
            measured_disk("/alias-b", "same", 500.0),
        ];
        let mut first = inspected("/alias-a/ginfer/models", "same", 1000, vec![]);
        first.identity.as_mut().unwrap().serial.clear();
        let result = select_storage(
            &disks,
            vec![
                first,
                inspected("/alias-b/ginfer/models", "same", 1000, vec![]),
            ],
            Path::new("/requested"),
            100,
        );
        assert!(result.recommended_path.is_none());
        assert!(result.candidates.iter().all(|candidate| candidate
            .reason
            .as_ref()
            .unwrap()
            .contains("ambiguous")));
    }

    #[test]
    fn storage_recommendation_preserves_requested_root_on_its_filesystem_and_does_not_create_directories(
    ) {
        let directory = tempfile::tempdir().unwrap();
        let alias = directory.path().join("alias");
        symlink(directory.path(), &alias).unwrap();
        let requested = alias.join("custom/missing/models");
        let disk = measured_disk(directory.path().to_str().unwrap(), "saved", 100.0);
        let (chosen, ancestor, identity) = prepare_candidate(&disk, &requested).unwrap();
        assert_eq!(chosen, requested);
        assert_eq!(ancestor, fs::canonicalize(directory.path()).unwrap());
        check_writable(&ancestor).unwrap();
        assert!(!chosen.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        let other = DiskIdentity {
            filesystem_id: "different-live-device".into(),
            ..identity.clone()
        };
        assert_eq!(
            placement_on_disk(&disk.path, &requested, &identity, Some(&other)),
            disk.path.join("ginfer/models")
        );

        let disks = vec![
            measured_disk("/other", "other", 100.0),
            measured_disk("/requested", "requested", 100.0),
        ];
        let result = select_storage(
            &disks,
            vec![
                inspected("/other/ginfer/models", "other", 1000, vec![]),
                inspected("/requested/models", "requested", 1000, vec![]),
            ],
            Path::new("/requested/models"),
            100,
        );
        assert_eq!(
            result.recommended_path,
            Some(PathBuf::from("/requested/models"))
        );
    }

    #[tokio::test]
    async fn storage_recommendation_rejects_old_profiles_and_relative_roots() {
        let profile = serde_json::json!({"schema_version": 1, "disks": []});
        assert!(recommend_storage(&profile, Path::new("/models"), 1)
            .await
            .unwrap_err()
            .contains("schema-version 2"));
        let profile = serde_json::json!({"schema_version": 2, "disks": []});
        assert!(recommend_storage(&profile, Path::new("relative/models"), 1)
            .await
            .unwrap_err()
            .contains("absolute"));
        let result = recommend_storage(&profile, Path::new("/models"), 1)
            .await
            .unwrap();
        assert!(result.recommended_path.is_none());
    }

    /// Run only against an unchanged native producer profile containing two
    /// measured filesystems on this host. This checks placement, not bandwidth.
    #[tokio::test]
    #[ignore = "requires GCHAT_NATIVE_STORAGE_PROFILE and GCHAT_NATIVE_STORAGE_ROOT on the measured native host"]
    async fn native_profile_storage_acceptance() {
        let profile_path = PathBuf::from(
            std::env::var_os("GCHAT_NATIVE_STORAGE_PROFILE")
                .expect("set GCHAT_NATIVE_STORAGE_PROFILE to the saved native hardware.json"),
        );
        let requested_root = PathBuf::from(
            std::env::var_os("GCHAT_NATIVE_STORAGE_ROOT")
                .expect("set GCHAT_NATIVE_STORAGE_ROOT to the explicit native model root"),
        );
        assert!(profile_path.is_absolute());
        assert!(requested_root.is_absolute());
        let original_profile = fs::read(&profile_path).unwrap();
        let profile: serde_json::Value = serde_json::from_slice(&original_profile).unwrap();
        let disks: Vec<SavedDisk> = serde_json::from_value(profile["disks"].clone()).unwrap();
        let required_bytes = 128 * 1024 * 1024;
        let recommendation = recommend_storage(&profile, &requested_root, required_bytes)
            .await
            .unwrap();
        assert_eq!(recommendation.requested_path, requested_root);

        let mut live_filesystems = std::collections::BTreeSet::new();
        let mut eligible_disks = Vec::new();
        let mut override_checks = Vec::new();
        let mut fastest_rate = 0.0_f64;
        for candidate in recommendation
            .candidates
            .iter()
            .filter(|candidate| candidate.eligible)
        {
            let (_, ancestor) = canonical_existing_prefix(&candidate.path).unwrap();
            let live = live_disk_identity(&ancestor).unwrap();
            assert!(live_filesystems.insert(live.filesystem_id.clone()));
            let matching: Vec<_> = disks
                .iter()
                .filter(|disk| disk_identity_matches(disk, &live))
                .collect();
            assert_eq!(matching.len(), 1, "eligible saved identity must be unique");
            let disk = matching[0];
            let rate = saved_rate(disk).expect("eligible disk must have a measured native rate");
            assert_eq!(candidate.measured_read_bytes_per_second, Some(rate));
            assert!(candidate.reason.is_none());
            assert!(candidate.available_bytes.unwrap() >= required_bytes);
            assert!(
                crate::model_downloads::available_bytes(ancestor.clone())
                    .await
                    .unwrap()
                    >= required_bytes
            );
            require_native_model_storage(&candidate.path).unwrap();
            check_writable(&ancestor).unwrap();
            fastest_rate = fastest_rate.max(rate);
            eligible_disks.push(serde_json::json!({
                "measured_directory": disk.path,
                "candidate_path": candidate.path,
                "filesystem_id": live.filesystem_id,
                "filesystem_uuid": live.filesystem_uuid,
                "model": live.model,
                "serial": live.serial,
                "measured_read_bytes_per_second": rate,
                "available_bytes": candidate.available_bytes,
            }));

            // The saved measurement belongs to the filesystem. Choosing a new
            // root on it must preserve the caller's exact path, including when
            // another disk remains faster. Recommendation must not create it.
            let explicit_root = disk.path.join(format!(
                "gchat-native-storage-acceptance-{}/custom/models",
                uuid::Uuid::new_v4()
            ));
            assert!(!explicit_root.exists());
            let override_result = recommend_storage(&profile, &explicit_root, required_bytes)
                .await
                .unwrap();
            assert_eq!(override_result.requested_path, explicit_root);
            let retained = override_result
                .candidates
                .iter()
                .find(|candidate| candidate.path == explicit_root)
                .expect(
                    "the candidate on the explicitly requested filesystem must retain its path",
                );
            assert!(retained.eligible, "{:?}", retained.reason);
            assert_eq!(retained.measured_read_bytes_per_second, Some(rate));
            assert!(!explicit_root.exists());
            override_checks.push(serde_json::json!({
                "requested_path": explicit_root,
                "retained_candidate": retained,
                "recommended_path": override_result.recommended_path,
            }));
        }
        assert!(
            live_filesystems.len() >= 2,
            "native acceptance requires two eligible measured live filesystems: {:?}",
            recommendation
        );
        let chosen = recommendation
            .candidates
            .iter()
            .find(|candidate| Some(&candidate.path) == recommendation.recommended_path.as_ref())
            .expect("a measured eligible native disk must be recommended");
        assert!(chosen.eligible);
        assert_eq!(chosen.measured_read_bytes_per_second, Some(fastest_rate));
        assert_eq!(fs::read(&profile_path).unwrap(), original_profile);
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "profile_path": profile_path,
                "profile_sha256": format!("{:x}", Sha256::digest(&original_profile)),
                "profile_unchanged": true,
                "recommendation": recommendation,
                "eligible_live_disks": eligible_disks,
                "explicit_path_retention": override_checks,
                "benchmark_ran": false,
            }))
            .unwrap()
        );
    }

    #[test]
    fn placement_preserves_native_paths_and_redirects_only_implicit_wsl_windows_storage() {
        let root = tempfile::tempdir().unwrap();
        let windows = root.path().join("windows");
        let native = root.path().join("native");
        let home = root.path().join("home");
        for directory in [&windows, &native, &home] {
            fs::create_dir(directory).unwrap();
        }
        let windows = fs::canonicalize(windows).unwrap();
        let classify = |path: &Path| Ok(path.starts_with(&windows));
        let requested = windows.join("missing/models");
        let no_probe =
            |_: &Path| -> Result<bool, String> { panic!("non-WSL must not inspect storage") };
        assert_eq!(
            resolve_with(&requested, false, None, None, &no_probe).unwrap(),
            requested
        );
        require_with(&requested, false, &no_probe).unwrap();
        let unchanged = native.join("missing/models");
        assert_eq!(
            resolve_with(&unchanged, true, None, None, &classify).unwrap(),
            unchanged
        );
        require_with(&unchanged, true, &classify).unwrap();

        let chosen = resolve_with(&requested, true, Some(&native), Some(&home), &classify).unwrap();
        assert!(chosen.starts_with(native.join("ginfer/managed-models")));
        assert!(!chosen.exists());
        assert_eq!(chosen.file_name().unwrap().len(), 64);
        let alias = root.path().join("alias");
        symlink(&windows, &alias).unwrap();
        assert_eq!(
            resolve_with(
                &alias.join("missing/./models"),
                true,
                Some(&native),
                None,
                &classify
            )
            .unwrap(),
            chosen
        );
        assert_eq!(
            resolve_with(
                &alias.join("missing/../missing/models"),
                true,
                Some(&native),
                None,
                &classify
            )
            .unwrap(),
            chosen
        );
        assert_ne!(
            resolve_with(
                &windows.join("other/models"),
                true,
                Some(&native),
                None,
                &classify
            )
            .unwrap(),
            chosen
        );

        let fallback =
            resolve_with(&requested, true, Some(&windows), Some(&home), &classify).unwrap();
        assert!(fallback.starts_with(home.join(".local/share/ginfer/managed-models")));
        assert_eq!(
            resolve_with(
                &requested,
                true,
                Some(Path::new("relative")),
                Some(&home),
                &classify
            )
            .unwrap(),
            fallback
        );
        let linked_xdg = root.path().join("linked-xdg");
        symlink(&windows, &linked_xdg).unwrap();
        assert_eq!(
            resolve_with(&requested, true, Some(&linked_xdg), Some(&home), &classify).unwrap(),
            fallback
        );
        assert!(
            resolve_with(&requested, true, Some(&windows), Some(&windows), &classify)
                .unwrap_err()
                .contains("XDG_DATA_HOME")
        );
        assert!(resolve_with(&requested, true, None, None, &classify).is_err());
        assert!(require_with(&requested, true, &classify)
            .unwrap_err()
            .contains("cannot be resumed"));
        assert!(require_with(&alias.join("missing/models"), true, &classify).is_err());
        assert!(!native.join("ginfer").exists());

        fs::create_dir(native.join("ginfer")).unwrap();
        symlink(&windows, native.join("ginfer/managed-models")).unwrap();
        assert_eq!(
            resolve_with(&requested, true, Some(&native), Some(&home), &classify).unwrap(),
            fallback
        );

        let dangling = root.path().join("dangling");
        symlink(windows.join("absent"), &dangling).unwrap();
        assert!(resolve_with(
            &dangling.join("models"),
            true,
            Some(&native),
            None,
            &classify
        )
        .is_err());
        assert!(!home.join(".local").exists());
    }
}
