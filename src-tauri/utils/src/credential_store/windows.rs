//! Windows Credential Manager has a 2560-byte limit per binary entry. Publish a
//! generation only after all its chunks exist, keeping the previous value valid
//! if writing the new value fails. Original password/secret entries remain readable.
use super::{Error, Native, Reference};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use zeroize::Zeroizing;

const SERVICE: &str = "app.gchat.credentials.v1";
const CHUNK_SIZE: usize = 2560;

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    generation: String,
    length: usize,
    sha256: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn root(reference: &Reference) -> Result<Reference, Error> {
    Ok(Reference::new(
        SERVICE,
        &digest(reference.identity()?.as_bytes()),
    ))
}

impl Manifest {
    fn decode(bytes: &[u8]) -> Result<Self, Error> {
        let value: Self = serde_json::from_slice(bytes).map_err(|_| Error::InvalidData)?;
        if value.version != 1
            || value.generation.len() != 32
            || !value
                .generation
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || value.sha256.len() != 64
            || !value.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(Error::InvalidData);
        }
        Ok(value)
    }

    fn chunk(&self, root: &Reference, index: usize) -> Reference {
        Reference::new(
            SERVICE,
            &format!("{}:{}:{index}", root.account, self.generation),
        )
    }

    fn chunks(&self) -> usize {
        self.length.div_ceil(CHUNK_SIZE)
    }
}

pub(super) struct WindowsNative {
    storage: Arc<dyn Native>,
    legacy: Arc<dyn Native>,
}

impl WindowsNative {
    #[cfg(target_os = "windows")]
    pub(super) fn new() -> Self {
        Self {
            storage: Arc::new(BinaryNative),
            legacy: Arc::new(super::NativeProvider),
        }
    }

    #[cfg(test)]
    pub(super) fn with_backends(storage: Arc<dyn Native>, legacy: Arc<dyn Native>) -> Self {
        Self { storage, legacy }
    }

    fn manifest(&self, root: &Reference) -> Result<Option<Manifest>, Error> {
        self.storage
            .get(root)?
            .map(|bytes| Manifest::decode(&bytes))
            .transpose()
    }

    fn remove_chunks(&self, root: &Reference, manifest: &Manifest) -> Result<(), Error> {
        for index in 0..manifest.chunks() {
            self.storage.delete(&manifest.chunk(root, index))?;
        }
        Ok(())
    }
}

impl Native for WindowsNative {
    fn present(&self) -> Result<bool, Error> {
        self.legacy.present()
    }

    fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error> {
        let root = root(reference)?;
        let Some(manifest) = self.manifest(&root)? else {
            // Preserve historical UTF-16 passwords and Gbot byte secrets.
            return self.legacy.get(reference);
        };
        let mut bytes = Zeroizing::new(Vec::new());
        for index in 0..manifest.chunks() {
            let chunk = Zeroizing::new(
                self.storage
                    .get(&manifest.chunk(&root, index))?
                    .ok_or(Error::InvalidData)?,
            );
            let expected = (manifest.length - bytes.len()).min(CHUNK_SIZE);
            if chunk.len() != expected {
                return Err(Error::InvalidData);
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.len() != manifest.length || digest(&bytes) != manifest.sha256 {
            return Err(Error::InvalidData);
        }
        Ok(Some(std::mem::take(&mut *bytes)))
    }

    fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error> {
        let root = root(reference)?;
        let previous = self.manifest(&root)?;
        let mut random = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let manifest = Manifest {
            version: 1,
            generation: random.iter().map(|byte| format!("{byte:02x}")).collect(),
            length: bytes.len(),
            sha256: digest(bytes),
        };
        let encoded = serde_json::to_vec(&manifest).map_err(|_| Error::InvalidData)?;
        for (index, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
            if let Err(error) = self.storage.put(&manifest.chunk(&root, index), chunk) {
                let _ = self.remove_chunks(&root, &manifest);
                return Err(error);
            }
        }
        // CredWrite atomically replaces this single binary entry. No partial
        // generation is visible, and no legacy secret is removed on failed save.
        if let Err(error) = self.storage.put(&root, &encoded) {
            let _ = self.remove_chunks(&root, &manifest);
            return Err(error);
        }
        if let Some(previous) = previous {
            // Publication succeeded. Cleanup failure must not report a failed
            // save or delete the newly committed generation.
            let _ = self.remove_chunks(&root, &previous);
        }
        Ok(())
    }

    fn delete(&self, reference: &Reference) -> Result<(), Error> {
        let root = root(reference)?;
        let previous = self.manifest(&root)?;
        // Remove legacy first: a failed delete keeps the committed new value,
        // and successful deletion cannot expose an older password on fallback.
        self.legacy.delete(reference)?;
        self.storage.delete(&root)?;
        if let Some(previous) = previous {
            self.remove_chunks(&root, &previous)?;
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
struct BinaryNative;

#[cfg(target_os = "windows")]
impl Native for BinaryNative {
    fn present(&self) -> Result<bool, Error> {
        Ok(true)
    }

    fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error> {
        match keyring::Entry::new(&reference.service, &reference.account)
            .and_then(|entry| entry.get_secret())
        {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(super::native_error(error)),
        }
    }

    fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error> {
        keyring::Entry::new(&reference.service, &reference.account)
            .and_then(|entry| entry.set_secret(bytes))
            .map_err(super::native_error)
    }

    fn delete(&self, reference: &Reference) -> Result<(), Error> {
        match keyring::Entry::new(&reference.service, &reference.account)
            .and_then(|entry| entry.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(super::native_error(error)),
        }
    }
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
