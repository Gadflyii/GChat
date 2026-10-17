//! Whole-payload verification receipts bound to the file that was actually read.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
#[cfg(not(target_os = "linux"))]
use std::fs::Metadata;
use std::io::Read;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayloadVerification {
    sha256: String,
    fingerprint: FileFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct FileFingerprint {
    bytes: u64,
    modified: Option<FileTimestamp>,
    changed: Option<FileTimestamp>,
    identity: Option<FileIdentity>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct FileTimestamp {
    seconds: i64,
    nanos: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "platform", rename_all = "snake_case")]
enum FileIdentity {
    Linux { device: u64, inode: u64 },
    Windows { volume_serial: u32, file_index: u64 },
}

impl FileFingerprint {
    fn reusable(&self) -> bool {
        self.modified.is_some() && self.changed.is_some() && self.identity.is_some()
    }

    fn same_renamed_file(&self, other: &Self) -> bool {
        self.reusable()
            && other.reusable()
            && self.bytes == other.bytes
            && self.modified == other.modified
            && self.identity == other.identity
    }
}

impl PayloadVerification {
    /// Retain a just-verified receipt across our own publication rename only.
    /// A rename changes the file's change timestamp, but not its content,
    /// modification timestamp or stable identity. Copies must be verified anew.
    pub(crate) fn after_rename(&self, path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let fingerprint = fingerprint(&file)?;
        if !self.fingerprint.reusable() || !fingerprint.reusable() {
            return verify(path, &self.sha256, self.fingerprint.bytes, None);
        }
        if !self.fingerprint.same_renamed_file(&fingerprint) {
            return Err("payload changed before its verified publication".into());
        }
        check_current_path(path, &fingerprint)?;
        Ok(Self {
            sha256: self.sha256.clone(),
            fingerprint,
        })
    }
}

/// `None` requests a full verification, including for an explicit Verify action.
/// A receipt is reusable only for the same expected digest and complete file
/// fingerprint. Platforms/filesystems without stable identity always hash.
pub(crate) fn verify(
    path: &Path,
    sha256: &str,
    bytes: u64,
    previous: Option<&PayloadVerification>,
) -> Result<PayloadVerification, String> {
    verify_with_hasher(path, sha256, bytes, previous, hash_payload)
}

fn verify_with_hasher(
    path: &Path,
    sha256: &str,
    bytes: u64,
    previous: Option<&PayloadVerification>,
    hash: impl FnOnce(&mut File) -> Result<String, String>,
) -> Result<PayloadVerification, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let before = fingerprint(&file)?;
    if before.bytes != bytes {
        return Err("payload size mismatch".into());
    }
    let cached = previous.is_some_and(|record| {
        record.sha256 == sha256 && before.reusable() && record.fingerprint == before
    });
    let actual_sha256 = if cached { None } else { Some(hash(&mut file)?) };
    if fingerprint(&file)? != before {
        return Err("payload changed during verification".into());
    }
    check_current_path(path, &before)?;
    if actual_sha256.is_some_and(|actual| actual != sha256) {
        return Err("SHA256 mismatch".into());
    }
    Ok(PayloadVerification {
        sha256: sha256.to_owned(),
        fingerprint: before,
    })
}

fn hash_payload(file: &mut File) -> Result<String, String> {
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(hex::encode(digest.finalize()));
        }
        digest.update(&buffer[..read]);
    }
}

fn check_current_path(path: &Path, expected: &FileFingerprint) -> Result<(), String> {
    let current = File::open(path).map_err(|e| e.to_string())?;
    if fingerprint(&current)? != *expected {
        return Err("payload path changed during verification".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn fingerprint(file: &File) -> Result<FileFingerprint, String> {
    use std::os::linux::fs::MetadataExt;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    Ok(FileFingerprint {
        bytes: metadata.len(),
        modified: timestamp(metadata.st_mtime(), metadata.st_mtime_nsec()),
        changed: timestamp(metadata.st_ctime(), metadata.st_ctime_nsec()),
        identity: (metadata.st_ino() != 0).then_some(FileIdentity::Linux {
            device: metadata.st_dev(),
            inode: metadata.st_ino(),
        }),
    })
}

#[cfg(target_os = "linux")]
fn timestamp(seconds: i64, nanos: i64) -> Option<FileTimestamp> {
    let nanos = u32::try_from(nanos).ok()?;
    (nanos < 1_000_000_000).then_some(FileTimestamp { seconds, nanos })
}

#[cfg(windows)]
fn fingerprint(file: &File) -> Result<FileFingerprint, String> {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information(
            handle: *mut std::ffi::c_void,
            information: *mut WindowsFileInformation,
        ) -> i32;
        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_ex(
            handle: *mut std::ffi::c_void,
            class: i32,
            information: *mut std::ffi::c_void,
            size: u32,
        ) -> i32;
    }
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let mut information = WindowsFileInformation::default();
    let mut basic = WindowsFileBasicInfo::default();
    // SAFETY: both output structures use the documented C layout and live
    // throughout the calls; the borrowed File retains a valid HANDLE.
    let complete = unsafe {
        get_file_information(file.as_raw_handle(), &mut information) != 0
            && get_file_information_ex(
                file.as_raw_handle(),
                0, // FileBasicInfo
                (&mut basic as *mut WindowsFileBasicInfo).cast(),
                std::mem::size_of::<WindowsFileBasicInfo>() as u32,
            ) != 0
    };
    if complete {
        Ok(windows_fingerprint(&information, &basic))
    } else {
        // An unsupported filesystem/API is safe for full verification, but it
        // cannot produce a reusable receipt.
        Ok(unidentified_fingerprint(&metadata))
    }
}

#[cfg(any(windows, test))]
#[repr(C)]
#[derive(Default)]
struct WindowsFileTime {
    low: u32,
    high: u32,
}

#[cfg(any(windows, test))]
#[repr(C)]
#[derive(Default)]
struct WindowsFileInformation {
    attributes: u32,
    creation_time: WindowsFileTime,
    last_access_time: WindowsFileTime,
    last_write_time: WindowsFileTime,
    volume_serial: u32,
    size_high: u32,
    size_low: u32,
    number_of_links: u32,
    index_high: u32,
    index_low: u32,
}

#[cfg(any(windows, test))]
#[repr(C)]
#[derive(Default)]
struct WindowsFileBasicInfo {
    creation_time: i64,
    last_access_time: i64,
    last_write_time: i64,
    change_time: i64,
    attributes: u32,
}

#[cfg(any(windows, test))]
fn windows_fingerprint(
    information: &WindowsFileInformation,
    basic: &WindowsFileBasicInfo,
) -> FileFingerprint {
    let file_index = (u64::from(information.index_high) << 32) | u64::from(information.index_low);
    FileFingerprint {
        bytes: (u64::from(information.size_high) << 32) | u64::from(information.size_low),
        modified: windows_timestamp(basic.last_write_time),
        changed: windows_timestamp(basic.change_time),
        identity: (information.volume_serial != 0 && file_index != 0).then_some(
            FileIdentity::Windows {
                volume_serial: information.volume_serial,
                file_index,
            },
        ),
    }
}

#[cfg(any(windows, test))]
fn windows_timestamp(ticks: i64) -> Option<FileTimestamp> {
    (ticks > 0).then(|| FileTimestamp {
        seconds: ticks / 10_000_000 - 11_644_473_600,
        nanos: ((ticks % 10_000_000) * 100) as u32,
    })
}

#[cfg(not(target_os = "linux"))]
fn unidentified_fingerprint(metadata: &Metadata) -> FileFingerprint {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|elapsed| {
            Some(FileTimestamp {
                seconds: elapsed.as_secs().try_into().ok()?,
                nanos: elapsed.subsec_nanos(),
            })
        });
    FileFingerprint {
        bytes: metadata.len(),
        modified,
        changed: None,
        identity: None,
    }
}

#[cfg(all(not(target_os = "linux"), not(windows)))]
fn fingerprint(file: &File) -> Result<FileFingerprint, String> {
    Ok(unidentified_fingerprint(
        &file.metadata().map_err(|e| e.to_string())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{FileTimes, OpenOptions};
    use std::time::{Duration, UNIX_EPOCH};

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, String) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("model.ginfer");
        std::fs::write(&path, b"verified").unwrap();
        let sha256 = hex::encode(Sha256::digest(b"verified"));
        (directory, path, sha256)
    }

    #[test]
    fn persisted_unchanged_receipt_avoids_payload_reads() {
        let (_directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        let persisted = serde_json::to_vec(&record).unwrap();
        let restored = serde_json::from_slice(&persisted).unwrap();
        let reused = verify_with_hasher(&path, &sha256, 8, Some(&restored), |_| {
            panic!("unchanged verified payload must not be read")
        })
        .unwrap();
        assert_eq!(record, reused);
    }

    #[test]
    fn explicit_verification_and_changed_expected_digest_hash_again() {
        let (_directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        let mut reads = 0;
        verify_with_hasher(&path, &sha256, 8, None, |file| {
            reads += 1;
            hash_payload(file)
        })
        .unwrap();
        let error = verify_with_hasher(&path, &"0".repeat(64), 8, Some(&record), |file| {
            reads += 1;
            hash_payload(file)
        })
        .unwrap_err();
        assert_eq!(reads, 2);
        assert_eq!(error, "SHA256 mismatch");
    }

    #[test]
    fn receipt_without_stable_identity_cannot_skip_payload_reads() {
        let (_directory, path, sha256) = fixture();
        let mut record = verify(&path, &sha256, 8, None).unwrap();
        record.fingerprint.identity = None;
        let mut read_payload = false;
        verify_with_hasher(&path, &sha256, 8, Some(&record), |file| {
            read_payload = true;
            hash_payload(file)
        })
        .unwrap();
        assert!(read_payload);
    }

    #[test]
    fn same_size_modified_payload_is_reverified_and_rejected() {
        let (_directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        std::fs::write(&path, b"tampered").unwrap();
        OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(1)))
            .unwrap();
        assert_eq!(
            verify(&path, &sha256, 8, Some(&record)).unwrap_err(),
            "SHA256 mismatch"
        );
    }

    #[test]
    fn same_inode_write_with_restored_mtime_is_reverified() {
        let (_directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        let modified = File::open(&path).unwrap().metadata().unwrap().modified().unwrap();
        std::fs::write(&path, b"tampered").unwrap();
        OpenOptions::new().write(true).open(&path).unwrap()
            .set_times(FileTimes::new().set_modified(modified)).unwrap();
        let current = fingerprint(&File::open(&path).unwrap()).unwrap();
        assert_eq!(current.identity, record.fingerprint.identity);
        assert_eq!(current.modified, record.fingerprint.modified);
        assert_ne!(current.changed, record.fingerprint.changed);
        assert_eq!(verify(&path, &sha256, 8, Some(&record)).unwrap_err(), "SHA256 mismatch");
    }

    #[test]
    fn replacement_with_restored_size_and_mtime_is_reverified() {
        let (directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        let modified = File::open(&path).unwrap().metadata().unwrap().modified().unwrap();
        let replacement = directory.path().join("replacement.ginfer");
        std::fs::write(&replacement, b"tampered").unwrap();
        OpenOptions::new()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        assert_ne!(
            fingerprint(&File::open(&path).unwrap()).unwrap().identity,
            record.fingerprint.identity
        );
        assert_eq!(
            verify(&path, &sha256, 8, Some(&record)).unwrap_err(),
            "SHA256 mismatch"
        );
    }

    #[test]
    fn mutation_after_hash_is_rejected_before_receipt_is_created() {
        let (_directory, path, sha256) = fixture();
        let error = verify_with_hasher(&path, &sha256, 8, None, |file| {
            let digest = hash_payload(file)?;
            OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(1)))
                .unwrap();
            Ok(digest)
        })
        .unwrap_err();
        assert_eq!(error, "payload changed during verification");
    }

    #[test]
    fn path_replacement_during_hash_is_rejected() {
        let (directory, path, sha256) = fixture();
        let error = verify_with_hasher(&path, &sha256, 8, None, |file| {
            let digest = hash_payload(file)?;
            let replacement = directory.path().join("replacement.ginfer");
            std::fs::write(&replacement, b"verified").unwrap();
            std::fs::rename(replacement, &path).unwrap();
            Ok(digest)
        })
        .unwrap_err();
        assert!(error.contains("changed during verification"));
    }

    #[test]
    fn owned_rename_retains_receipt_but_copy_or_mutation_does_not() {
        let (directory, path, sha256) = fixture();
        let record = verify(&path, &sha256, 8, None).unwrap();
        let published = directory.path().join("published.ginfer");
        std::fs::rename(&path, &published).unwrap();
        let published_record = record.after_rename(&published).unwrap();
        verify_with_hasher(&published, &sha256, 8, Some(&published_record), |_| {
            panic!("owned publication does not reread the payload")
        })
        .unwrap();
        let copied = directory.path().join("copied.ginfer");
        std::fs::copy(&published, &copied).unwrap();
        assert!(published_record.after_rename(&copied).is_err());
        OpenOptions::new()
            .write(true)
            .open(&published)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(1)))
            .unwrap();
        assert!(published_record.after_rename(&published).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_fingerprint_uses_device_inode_and_change_timestamp() {
        use std::os::linux::fs::MetadataExt;
        let (_directory, path, _sha256) = fixture();
        let file = File::open(path).unwrap();
        let metadata = file.metadata().unwrap();
        let fingerprint = fingerprint(&file).unwrap();
        assert_eq!(
            fingerprint.identity,
            Some(FileIdentity::Linux {
                device: metadata.st_dev(),
                inode: metadata.st_ino(),
            })
        );
        assert_eq!(fingerprint.changed, timestamp(metadata.st_ctime(), metadata.st_ctime_nsec()));
        assert!(fingerprint.reusable());
    }

    #[test]
    fn windows_handle_projection_invalidates_identity_and_time_changes() {
        assert_eq!(std::mem::size_of::<WindowsFileInformation>(), 52);
        assert_eq!(std::mem::size_of::<WindowsFileBasicInfo>(), 40);
        let mut information = WindowsFileInformation {
            volume_serial: 77,
            index_high: 2,
            index_low: 3,
            size_high: 1,
            size_low: 8,
            ..Default::default()
        };
        let mut basic = WindowsFileBasicInfo {
            last_write_time: 133_000_000_000_000_001,
            change_time: 133_000_000_000_000_002,
            ..Default::default()
        };
        let original = windows_fingerprint(&information, &basic);
        assert_eq!(original.bytes, (1_u64 << 32) | 8);
        assert_eq!(original.modified.as_ref().unwrap().nanos, 100);
        assert_eq!(
            original.identity,
            Some(FileIdentity::Windows {
                volume_serial: 77,
                file_index: (2_u64 << 32) | 3,
            })
        );
        assert!(original.reusable());
        information.index_low += 1;
        assert_ne!(original, windows_fingerprint(&information, &basic));
        information.index_low -= 1;
        information.volume_serial += 1;
        assert_ne!(original, windows_fingerprint(&information, &basic));
        information.volume_serial -= 1;
        basic.change_time += 1;
        let changed = windows_fingerprint(&information, &basic);
        assert_ne!(original, changed);
        assert!(original.same_renamed_file(&changed));
        basic.last_write_time += 1;
        assert!(!original.same_renamed_file(&windows_fingerprint(&information, &basic)));
        information.volume_serial = 0;
        assert!(!windows_fingerprint(&information, &basic).reusable());
        information.volume_serial = 77;
        basic.change_time = 0;
        assert!(!windows_fingerprint(&information, &basic).reusable());
    }
}
