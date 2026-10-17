use super::super::{Error, Native, Reference};
use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Records {
    values: BTreeMap<Reference, Vec<u8>>,
    // A manifest is the sole commit point; chunk failures can happen after staging began.
    fail_write: Option<(bool, usize)>,
    fail_delete: bool,
    write_lengths: Vec<usize>,
    before_chunk_get: Option<Box<dyn FnOnce() + Send>>,
}

#[derive(Default)]
struct MemoryNative(Mutex<Records>);

impl MemoryNative {
    fn fail_chunk_after(&self, successful_chunks: usize) {
        self.0.lock().unwrap().fail_write = Some((false, successful_chunks));
    }

    fn fail_manifest(&self) {
        self.0.lock().unwrap().fail_write = Some((true, 0));
    }

    fn fail_next_delete(&self) {
        self.0.lock().unwrap().fail_delete = true;
    }

    fn before_next_chunk_get(&self, action: impl FnOnce() + Send + 'static) {
        self.0.lock().unwrap().before_chunk_get = Some(Box::new(action));
    }

    fn is_empty(&self) -> bool {
        self.0.lock().unwrap().values.is_empty()
    }

    fn assert_bounded_writes(&self) {
        let records = self.0.lock().unwrap();
        assert!(!records.write_lengths.is_empty());
        assert!(records.write_lengths.iter().all(|length| *length <= 2560));
    }
}

impl Native for MemoryNative {
    fn present(&self) -> Result<bool, Error> {
        Ok(true)
    }

    fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error> {
        let action = if reference.account.contains(':') {
            self.0.lock().unwrap().before_chunk_get.take()
        } else {
            None
        };
        // A second handle may replace the published generation after a reader
        // fetched its manifest. Never invoke that writer while holding the lock.
        if let Some(action) = action {
            action();
        }
        Ok(self.0.lock().unwrap().values.get(reference).cloned())
    }

    fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error> {
        let mut records = self.0.lock().unwrap();
        records.write_lengths.push(bytes.len());
        if bytes.len() > 2560 {
            return Err(Error::InvalidCredential);
        }
        let manifest = !reference.account.contains(':');
        let fail = match records.fail_write.as_mut() {
            Some((fail_manifest, remaining)) if *fail_manifest == manifest => {
                if *remaining == 0 {
                    true
                } else {
                    *remaining -= 1;
                    false
                }
            }
            _ => false,
        };
        if fail {
            records.fail_write = None;
            return Err(Error::Unavailable);
        }
        records.values.insert(reference.clone(), bytes.to_vec());
        Ok(())
    }

    fn delete(&self, reference: &Reference) -> Result<(), Error> {
        let mut records = self.0.lock().unwrap();
        if std::mem::take(&mut records.fail_delete) {
            return Err(Error::Unavailable);
        }
        records.values.remove(reference);
        Ok(())
    }
}

fn manifest_reference(reference: &Reference) -> Reference {
    let digest = Sha256::digest(reference.identity().unwrap().as_bytes());
    Reference::new("app.gchat.credentials.v1", &format!("{digest:x}"))
}

fn first_chunk(storage: &MemoryNative, reference: &Reference) -> Reference {
    let manifest = manifest_reference(reference);
    let value: serde_json::Value =
        serde_json::from_slice(&storage.get(&manifest).unwrap().unwrap()).unwrap();
    let generation = value["generation"].as_str().unwrap();
    assert_eq!(generation.len(), 32);
    Reference::new(
        &manifest.service,
        &format!("{}:{generation}:0", manifest.account),
    )
}

#[test]
fn oversized_binary_and_ascii_credentials_survive_a_new_backend_handle() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    let binary_reference = Reference::new("app.gchat.gbot", "same-account");
    let token_reference = Reference::new("app.gchat.microsoft", "same-account");
    let binary: Vec<u8> = (0..10_241).map(|index| (index % 256) as u8).collect();
    // This also exceeds Credential Manager's old UTF-16 password limit of 1280 chars.
    let token = vec![b'x'; 1901];
    store.put(&binary_reference, &binary).unwrap();
    store.put(&token_reference, &token).unwrap();
    drop(store);

    let reopened = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reopened.get(&binary_reference).unwrap(), Some(binary));
    assert_eq!(reopened.get(&token_reference).unwrap(), Some(token));
    storage.assert_bounded_writes();
}

#[test]
fn an_existing_legacy_credential_is_read_when_no_manifest_exists() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "legacy-account");
    let expected = b"synthetic legacy refresh token";
    legacy.put(&reference, expected).unwrap();
    let store = WindowsNative::with_backends(storage, legacy);
    assert_eq!(store.get(&reference).unwrap(), Some(expected.to_vec()));
}

#[test]
fn an_empty_credential_is_distinct_from_a_missing_credential() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "empty-token");
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    store.put(&reference, &[]).unwrap();
    drop(store);

    let reopened = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reopened.get(&reference).unwrap(), Some(Vec::new()));
    reopened.delete(&reference).unwrap();
    assert_eq!(reopened.get(&reference).unwrap(), None);
    assert!(storage.is_empty());
}

#[test]
fn replacement_and_deletion_remove_chunked_and_legacy_credentials() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "replace-account");
    legacy.put(&reference, b"old synthetic token").unwrap();
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());

    for secret in [vec![1; 7800], b"small".to_vec(), vec![0xff; 10_001]] {
        store.put(&reference, &secret).unwrap();
        assert_eq!(store.get(&reference).unwrap(), Some(secret));
    }
    store.delete(&reference).unwrap();
    assert_eq!(store.get(&reference).unwrap(), None);
    assert_eq!(legacy.get(&reference).unwrap(), None);
    assert!(
        storage.is_empty(),
        "replacement generations must not remain"
    );
    storage.assert_bounded_writes();
}

#[test]
fn a_reader_retries_a_generation_replaced_before_its_first_chunk_read() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "concurrent-replacement");
    let writer = Arc::new(WindowsNative::with_backends(
        storage.clone(),
        legacy.clone(),
    ));
    writer.put(&reference, &vec![1; 7000]).unwrap();
    let retired_chunk = first_chunk(&storage, &reference);
    let replacement: Vec<u8> = (0..9103).map(|index| (index % 251) as u8).collect();
    let replacement_for_write = replacement.clone();
    let reference_for_write = reference.clone();
    storage.before_next_chunk_get(move || {
        writer
            .put(&reference_for_write, &replacement_for_write)
            .unwrap();
    });

    let reader = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reader.get(&reference).unwrap(), Some(replacement));
    assert_eq!(storage.get(&retired_chunk).unwrap(), None);
    storage.assert_bounded_writes();
}

#[test]
fn repeated_replacement_during_a_read_returns_a_bounded_conflict() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "repeated-concurrent-replacement");
    let writer = Arc::new(WindowsNative::with_backends(
        storage.clone(),
        legacy.clone(),
    ));
    writer.put(&reference, &vec![1; 7000]).unwrap();
    let storage_for_write = storage.clone();
    let reference_for_write = reference.clone();
    storage.before_next_chunk_get(move || {
        writer.put(&reference_for_write, &vec![2; 8000]).unwrap();
        storage_for_write.before_next_chunk_get(move || {
            writer.put(&reference_for_write, &vec![3; 9000]).unwrap();
        });
    });

    let reader = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reader.get(&reference), Err(Error::Conflict));
    // The conflict belongs to this raced read; the last committed value survives.
    assert_eq!(reader.get(&reference).unwrap(), Some(vec![3; 9000]));
    storage.assert_bounded_writes();
}

#[test]
fn a_failed_legacy_delete_keeps_the_committed_credential_available() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "legacy-delete-failure");
    legacy.put(&reference, b"stale synthetic token").unwrap();
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    let current = vec![8; 7000];
    store.put(&reference, &current).unwrap();
    legacy.fail_next_delete();

    assert_eq!(store.delete(&reference), Err(Error::Unavailable));
    assert_eq!(store.get(&reference).unwrap(), Some(current));
    store.delete(&reference).unwrap();
    assert_eq!(store.get(&reference).unwrap(), None);
    assert!(storage.is_empty());
    assert!(legacy.is_empty());
}

#[test]
fn a_failed_chunk_write_preserves_the_previously_committed_credential() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "chunk-failure");
    let previous = vec![7; 3500];
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    store.put(&reference, &previous).unwrap();
    storage.fail_chunk_after(1);
    assert_eq!(
        store.put(&reference, &vec![9; 8000]),
        Err(Error::Unavailable)
    );
    drop(store);

    let reopened = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reopened.get(&reference).unwrap(), Some(previous));
    storage.assert_bounded_writes();
}

#[test]
fn a_failed_manifest_commit_preserves_the_previously_committed_credential() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "commit-failure");
    let previous = vec![3; 5100];
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    store.put(&reference, &previous).unwrap();
    storage.fail_manifest();
    assert_eq!(
        store.put(&reference, &vec![4; 9000]),
        Err(Error::Unavailable)
    );
    drop(store);

    let reopened = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reopened.get(&reference).unwrap(), Some(previous));
    storage.assert_bounded_writes();
}

#[test]
fn a_failed_initial_manifest_commit_keeps_the_existing_legacy_credential() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "legacy-commit-failure");
    let previous = b"synthetic legacy refresh token";
    legacy.put(&reference, previous).unwrap();
    let store = WindowsNative::with_backends(storage.clone(), legacy.clone());
    storage.fail_manifest();
    assert_eq!(
        store.put(&reference, &vec![4; 9000]),
        Err(Error::Unavailable)
    );
    drop(store);

    let reopened = WindowsNative::with_backends(storage.clone(), legacy);
    assert_eq!(reopened.get(&reference).unwrap(), Some(previous.to_vec()));
    storage.assert_bounded_writes();
}

#[test]
fn a_missing_committed_chunk_fails_closed_instead_of_reading_legacy() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "missing-chunk");
    legacy.put(&reference, b"stale synthetic token").unwrap();
    let store = WindowsNative::with_backends(storage.clone(), legacy);
    store.put(&reference, &vec![5; 7000]).unwrap();
    storage.delete(&first_chunk(&storage, &reference)).unwrap();
    assert_eq!(store.get(&reference), Err(Error::InvalidCredential));
}

#[test]
fn a_tampered_committed_chunk_fails_closed_instead_of_reading_legacy() {
    let storage = Arc::new(MemoryNative::default());
    let legacy = Arc::new(MemoryNative::default());
    let reference = Reference::new("app.gchat.microsoft", "tampered-chunk");
    legacy.put(&reference, b"stale synthetic token").unwrap();
    let store = WindowsNative::with_backends(storage.clone(), legacy);
    store.put(&reference, &vec![6; 7000]).unwrap();
    let chunk = first_chunk(&storage, &reference);
    storage.0.lock().unwrap().values.get_mut(&chunk).unwrap()[0] ^= 1;
    assert_eq!(store.get(&reference), Err(Error::InvalidCredential));
}

#[cfg(windows)]
#[test]
fn windows_native_oversized_synthetic_credentials_round_trip_and_delete() {
    use rand::RngCore;

    assert_eq!(
        super::super::native_error(keyring::Error::TooLong("secret".into(), 2560)),
        Error::CredentialTooLarge
    );
    assert_eq!(
        super::super::native_error(keyring::Error::BadEncoding(vec![0xff])),
        Error::InvalidCredential
    );

    struct Cleanup(Reference);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            // This unique test account is the only native credential the test owns.
            let _ = WindowsNative::new().delete(&self.0);
        }
    }

    let mut nonce = [0; 16];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let account = nonce
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let reference = Reference::new("app.gchat.tests.windows-credentials", &account);
    let _cleanup = Cleanup(reference.clone());
    let secret: Vec<u8> = (0..10_241).map(|index| (index % 256) as u8).collect();
    let store = WindowsNative::new();
    assert_eq!(store.get(&reference).unwrap(), None);
    let legacy = super::super::NativeProvider;
    let legacy_secret = "synthetic UTF-16 credential: Grüß dich 🔐".as_bytes();
    legacy.put(&reference, legacy_secret).unwrap();
    assert_eq!(store.get(&reference).unwrap(), Some(legacy_secret.to_vec()));
    store.put(&reference, &secret).unwrap();
    drop(store);

    let reopened = WindowsNative::new();
    assert_eq!(reopened.get(&reference).unwrap(), Some(secret));
    let replacement = vec![b's'; 1901];
    reopened.put(&reference, &replacement).unwrap();
    assert_eq!(
        WindowsNative::new().get(&reference).unwrap(),
        Some(replacement)
    );
    reopened.delete(&reference).unwrap();
    assert_eq!(WindowsNative::new().get(&reference).unwrap(), None);
    assert_eq!(legacy.get(&reference).unwrap(), None);
}
