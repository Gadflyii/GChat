use super::*;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{File, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    sync::Mutex,
};

#[derive(Clone, Serialize, Deserialize)]
struct Blob {
    nonce: [u8; 12],
    ciphertext: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
struct Vault {
    id: [u8; 16],
    salt: [u8; 16],
    kdf: u32,
    wrapped: Blob,
    records: BTreeMap<String, Blob>,
}
#[derive(Default, Serialize, Deserialize)]
struct Document {
    version: u32,
    active: Option<String>,
    vault: Option<Vault>,
    references: BTreeSet<Reference>,
    migration: Option<Migration>,
}
#[derive(Serialize, Deserialize)]
struct Migration {
    references: BTreeSet<Reference>,
    copied: BTreeSet<Reference>,
}
struct Unlocked {
    id: [u8; 16],
    key: Zeroizing<[u8; 32]>,
}
pub struct Store {
    root: PathBuf,
    key: Mutex<Option<Unlocked>>,
    native: Arc<dyn Native>,
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}
fn crypt(key: &[u8], aad: &[u8], bytes: &[u8]) -> Result<Blob, Error> {
    let nonce = random();
    let ciphertext = Aes256Gcm::new_from_slice(key)
        .map_err(|_| Error::InvalidData)?
        .encrypt(&Nonce::from(nonce), Payload { msg: bytes, aad })
        .map_err(|_| Error::InvalidData)?;
    Ok(Blob { nonce, ciphertext })
}
fn decrypt(key: &[u8], aad: &[u8], blob: &Blob) -> Result<Zeroizing<Vec<u8>>, Error> {
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| Error::InvalidData)?
        .decrypt(
            &Nonce::from(blob.nonce),
            Payload {
                msg: &blob.ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Error::InvalidData)
}
fn wrapping_key(passphrase: &[u8], salt: &[u8], kdf: u32) -> Result<Zeroizing<[u8; 32]>, Error> {
    if kdf != 1 {
        return Err(Error::InvalidData);
    }
    let mut key = Zeroizing::new([0; 32]);
    argon2::Argon2::default()
        .hash_password_into(passphrase, salt, key.as_mut())
        .map_err(|_| Error::InvalidData)?;
    Ok(key)
}
fn wrap_identity(id: &[u8]) -> Vec<u8> {
    [b"gchat-vault-v1:argon2id-19m-2t-1p:".as_slice(), id].concat()
}
fn record_identity(vault: &Vault, reference: &Reference) -> Result<Vec<u8>, Error> {
    Ok([vault.id.as_slice(), reference.identity()?.as_bytes()].concat())
}

impl Store {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.join("credentials"),
            key: Mutex::new(None),
            native: Arc::new(NativeProvider),
        }
    }
    #[cfg(test)]
    pub(super) fn with_native(root: &Path, native: Arc<dyn Native>) -> Self {
        Self {
            native,
            ..Self::new(root)
        }
    }
    pub(super) fn root(&self) -> PathBuf {
        self.root.clone()
    }
    fn locked(&self) -> Result<File, Error> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.root)
            .map_err(|_| Error::Unavailable)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(self.root.join("vault.lock"))
            .map_err(|_| Error::Unavailable)?;
        file.lock().map_err(|_| Error::Unavailable)?;
        Ok(file)
    }
    fn read(&self) -> Result<Document, Error> {
        match std::fs::read(self.root.join("vault.json")) {
            Ok(bytes) => {
                let document: Document =
                    serde_json::from_slice(&bytes).map_err(|_| Error::InvalidData)?;
                if document.version != 1
                    || !matches!(
                        document.active.as_deref(),
                        None | Some("native") | Some("passphrase")
                    )
                {
                    return Err(Error::InvalidData);
                }
                Ok(document)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Document {
                version: 1,
                ..Document::default()
            }),
            Err(_) => Err(Error::Unavailable),
        }
    }
    fn save(&self, document: &Document) -> Result<(), Error> {
        let bytes = serde_json::to_vec(document).map_err(|_| Error::InvalidData)?;
        let temporary = self.root.join("vault.next");
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| Error::Unavailable)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| Error::Unavailable)?;
        std::fs::rename(&temporary, self.root.join("vault.json"))
            .map_err(|_| Error::Unavailable)?;
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| Error::Unavailable)
    }
    fn selected(&self, document: &mut Document) -> Result<(), Error> {
        if document.active.is_none() {
            if !self.native.present()? {
                return Err(Error::MissingProvider);
            }
            document.active = Some("native".into());
            self.save(document)?;
        }
        Ok(())
    }
    fn key_for(&self, vault: &Vault) -> Result<Zeroizing<[u8; 32]>, Error> {
        let key = self.key.lock().map_err(|_| Error::Unavailable)?;
        let unlocked = key
            .as_ref()
            .filter(|key| key.id == vault.id)
            .ok_or(Error::Locked)?;
        Ok(Zeroizing::new(*unlocked.key))
    }
    pub fn require_ready(&self) -> Result<(), Error> {
        let _lock = self.locked()?;
        let mut document = self.read()?;
        self.selected(&mut document)?;
        if document.active.as_deref() == Some("native") {
            if !self.native.present()? {
                return Err(Error::MissingProvider);
            }
            self.native.probe()
        } else {
            self.key_for(document.vault.as_ref().ok_or(Error::InvalidData)?)
                .map(|_| ())
        }
    }
    /// Read selection and provider availability without opening the keyring.
    /// Native access is checked only by an explicit credential operation.
    pub fn status(&self) -> Status {
        let inspected = (|| {
            let _lock = self.locked()?;
            let document = self.read()?;
            let tier = match document.active.as_deref() {
                Some("passphrase") => Some(Tier::Passphrase),
                Some("native") => Some(Tier::Native),
                _ => None,
            };
            let availability = if tier == Some(Tier::Passphrase) {
                self.key_for(document.vault.as_ref().ok_or(Error::InvalidData)?)
                    .map(|_| ())
            } else if self.native.present()? {
                Ok(())
            } else {
                Err(Error::MissingProvider)
            };
            Ok::<_, Error>((tier, document.migration.is_some(), availability))
        })();
        let (tier, migrating, error, valid) = match inspected {
            Ok((tier, migrating, availability)) => (tier, migrating, availability.err(), true),
            Err(error) => (None, false, Some(error), false),
        };
        let unchecked = error.is_none() && tier != Some(Tier::Passphrase);
        Status {
            ready: error.is_none() && !unchecked,
            can_create: valid && tier.is_none() && error == Some(Error::MissingProvider),
            tier: if unchecked { Some(Tier::Native) } else { tier },
            migrating,
            state: match error {
                None if unchecked => "unchecked",
                None => "ready",
                Some(Error::Locked) => "locked",
                Some(Error::MissingProvider) => "missing_provider",
                _ => "unavailable",
            }
            .into(),
            error: error.map(|error| error.to_string()),
        }
    }
    pub fn get(&self, service: &str, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
        let _lock = self.locked()?;
        let mut document = self.read()?;
        self.selected(&mut document)?;
        let reference = Reference::new(service, account);
        if document.active.as_deref() == Some("native") {
            let bytes = self.native.get(&reference)?;
            if bytes.is_some() && document.references.insert(reference) {
                self.save(&document)?;
            }
            Ok(bytes.map(Zeroizing::new))
        } else {
            let vault = document.vault.as_ref().ok_or(Error::InvalidData)?;
            let key = self.key_for(vault)?;
            vault
                .records
                .get(&reference.identity()?)
                .map(|blob| decrypt(key.as_ref(), &record_identity(vault, &reference)?, blob))
                .transpose()
        }
    }
    pub fn put(&self, service: &str, account: &str, bytes: &[u8]) -> Result<(), Error> {
        let _lock = self.locked()?;
        let mut document = self.read()?;
        self.selected(&mut document)?;
        let reference = Reference::new(service, account);
        if document.active.as_deref() == Some("native") {
            self.native.put(&reference, bytes)?;
        } else {
            let vault = document.vault.as_mut().ok_or(Error::InvalidData)?;
            let key = self.key_for(vault)?;
            let blob = crypt(key.as_ref(), &record_identity(vault, &reference)?, bytes)?;
            vault.records.insert(reference.identity()?, blob);
        }
        document.references.insert(reference);
        self.save(&document)
    }
    pub fn delete(&self, service: &str, account: &str) -> Result<(), Error> {
        let _lock = self.locked()?;
        let mut document = self.read()?;
        self.selected(&mut document)?;
        let reference = Reference::new(service, account);
        if document.active.as_deref() == Some("native") {
            self.native.delete(&reference)?;
        } else {
            let vault = document.vault.as_mut().ok_or(Error::InvalidData)?;
            self.key_for(vault)?;
            vault.records.remove(&reference.identity()?);
        }
        document.references.remove(&reference);
        if let Some(migration) = &mut document.migration {
            migration.references.remove(&reference);
            migration.copied.remove(&reference);
            if let Some(vault) = &mut document.vault {
                vault.records.remove(&reference.identity()?);
            }
        }
        self.save(&document)
    }
    pub fn lock(&self) -> Result<(), Error> {
        *self.key.lock().map_err(|_| Error::Unavailable)? = None;
        Ok(())
    }
    pub fn unlock(&self, passphrase: &[u8]) -> Result<(), Error> {
        let _lock = self.locked()?;
        let document = self.read()?;
        let vault = document.vault.ok_or(Error::Conflict)?;
        let wrapping = wrapping_key(passphrase, &vault.salt, vault.kdf)?;
        let bytes = decrypt(wrapping.as_ref(), &wrap_identity(&vault.id), &vault.wrapped)?;
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| Error::InvalidData)?;
        *self.key.lock().map_err(|_| Error::Unavailable)? = Some(Unlocked {
            id: vault.id,
            key: Zeroizing::new(key),
        });
        Ok(())
    }
    fn new_vault(&self, passphrase: &[u8]) -> Result<Vault, Error> {
        if passphrase.is_empty() {
            return Err(Error::InvalidData);
        }
        let id = random();
        let salt = random();
        let key = Zeroizing::new(random::<32>());
        let wrapping = wrapping_key(passphrase, &salt, 1)?;
        let wrapped = crypt(wrapping.as_ref(), &wrap_identity(&id), key.as_ref())?;
        *self.key.lock().map_err(|_| Error::Unavailable)? = Some(Unlocked { id, key });
        Ok(Vault {
            id,
            salt,
            kdf: 1,
            wrapped,
            records: BTreeMap::new(),
        })
    }
    /// Source entries remain untouched; ownership changes only after every copy verifies.
    pub fn create_or_migrate(
        &self,
        passphrase: &[u8],
        references: &[Reference],
    ) -> Result<(), Error> {
        let _lock = self.locked()?;
        let mut document = self.read()?;
        if document.active.as_deref() == Some("passphrase") {
            return Err(Error::Conflict);
        }
        let mut pending = document.references.clone();
        pending.extend(references.iter().cloned());
        if document.vault.is_none() {
            document.vault = Some(self.new_vault(passphrase)?);
            document.migration = Some(Migration {
                references: pending.clone(),
                copied: BTreeSet::new(),
            });
            self.save(&document)?;
        } else {
            let vault = document.vault.as_ref().ok_or(Error::InvalidData)?;
            let wrapping = wrapping_key(passphrase, &vault.salt, vault.kdf)?;
            let key = decrypt(wrapping.as_ref(), &wrap_identity(&vault.id), &vault.wrapped)?;
            *self.key.lock().map_err(|_| Error::Unavailable)? = Some(Unlocked {
                id: vault.id,
                key: Zeroizing::new(key.as_slice().try_into().map_err(|_| Error::InvalidData)?),
            });
            pending.extend(
                document
                    .migration
                    .as_ref()
                    .ok_or(Error::Conflict)?
                    .references
                    .iter()
                    .cloned(),
            );
            document
                .migration
                .as_mut()
                .ok_or(Error::Conflict)?
                .references = pending.clone();
            self.save(&document)?;
        }
        for reference in &pending {
            let bytes = Zeroizing::new(self.native.get(reference)?.ok_or(Error::Missing)?);
            let vault = document.vault.as_mut().ok_or(Error::InvalidData)?;
            let key = self.key_for(vault)?;
            let aad = record_identity(vault, reference)?;
            let blob = crypt(key.as_ref(), &aad, &bytes)?;
            if decrypt(key.as_ref(), &aad, &blob)?.as_slice() != bytes.as_slice() {
                return Err(Error::InvalidData);
            }
            vault.records.insert(reference.identity()?, blob);
            document
                .migration
                .as_mut()
                .ok_or(Error::Conflict)?
                .copied
                .insert(reference.clone());
            self.save(&document)?;
            let saved = self.read()?;
            let saved_vault = saved.vault.as_ref().ok_or(Error::InvalidData)?;
            let saved_blob = saved_vault
                .records
                .get(&reference.identity()?)
                .ok_or(Error::InvalidData)?;
            if decrypt(key.as_ref(), &aad, saved_blob)?.as_slice() != bytes.as_slice() {
                return Err(Error::InvalidData);
            }
        }
        document.active = Some("passphrase".into());
        document.references = pending;
        document.migration = None;
        self.save(&document)
    }
    /// Private child-process stdin only; never return this through the webview.
    pub fn session_key(&self) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
        let _lock = self.locked()?;
        let document = self.read()?;
        if document.active.as_deref() != Some("passphrase") {
            return Ok(None);
        }
        let vault = document.vault.ok_or(Error::InvalidData)?;
        let key = self.key_for(&vault)?;
        Ok(Some(Zeroizing::new(
            [vault.id.as_slice(), key.as_ref()].concat(),
        )))
    }
    pub fn accept_session_key(&self, bytes: &[u8]) -> Result<(), Error> {
        if bytes.len() != 48 {
            return Err(Error::InvalidData);
        }
        let _lock = self.locked()?;
        let document = self.read()?;
        let vault = document.vault.ok_or(Error::Conflict)?;
        if document.active.as_deref() != Some("passphrase") || bytes[..16] != vault.id {
            return Err(Error::Conflict);
        }
        let key: [u8; 32] = bytes[16..].try_into().map_err(|_| Error::InvalidData)?;
        if let Some((identity, blob)) = vault.records.first_key_value() {
            decrypt(
                &key,
                &[vault.id.as_slice(), identity.as_bytes()].concat(),
                blob,
            )?;
        }
        *self.key.lock().map_err(|_| Error::Unavailable)? = Some(Unlocked {
            id: vault.id,
            key: Zeroizing::new(key),
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[derive(Default)]
    struct Provider {
        records: Mutex<BTreeMap<Reference, Vec<u8>>>,
        failure: Mutex<Option<Error>>,
        secret_operations: std::sync::atomic::AtomicUsize,
    }
    impl Native for Provider {
        fn present(&self) -> Result<bool, Error> {
            Ok(*self.failure.lock().unwrap() != Some(Error::MissingProvider))
        }
        fn get(&self, r: &Reference) -> Result<Option<Vec<u8>>, Error> {
            self.secret_operations
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(error) = *self.failure.lock().unwrap() {
                return Err(error);
            }
            Ok(self.records.lock().unwrap().get(r).cloned())
        }
        fn put(&self, r: &Reference, v: &[u8]) -> Result<(), Error> {
            self.secret_operations
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some(error) = *self.failure.lock().unwrap() {
                return Err(error);
            }
            self.records.lock().unwrap().insert(r.clone(), v.into());
            Ok(())
        }
        fn delete(&self, r: &Reference) -> Result<(), Error> {
            self.secret_operations
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.records.lock().unwrap().remove(r);
            Ok(())
        }
    }
    fn fixture() -> (tempfile::TempDir, Arc<Store>, Arc<Provider>) {
        let directory = tempfile::tempdir().unwrap();
        let provider = Arc::new(Provider::default());
        let mut store = Store::new(directory.path());
        store.native = provider.clone();
        (directory, Arc::new(store), provider)
    }
    #[test]
    fn status_never_opens_native_storage_even_when_the_login_keyring_is_locked() {
        for previously_selected in [false, true] {
            let (_d, store, provider) = fixture();
            if previously_selected {
                store.require_ready().unwrap();
                assert_eq!(store.read().unwrap().active.as_deref(), Some("native"));
                provider
                    .secret_operations
                    .store(0, std::sync::atomic::Ordering::SeqCst);
            }
            *provider.failure.lock().unwrap() = Some(Error::Locked);
            for _ in 0..2 {
                let status = store.status();
                assert!(!status.ready);
                assert_eq!(status.state, "unchecked");
                assert!(status.tier == Some(Tier::Native));
                assert!(!status.can_create);
                assert!(status.error.is_none());
            }
            assert_eq!(
                provider
                    .secret_operations
                    .load(std::sync::atomic::Ordering::SeqCst),
                0
            );
            assert_eq!(store.require_ready(), Err(Error::Locked));
            assert_eq!(
                provider
                    .secret_operations
                    .load(std::sync::atomic::Ordering::SeqCst),
                1
            );
        }
    }
    #[test]
    fn selected_provider_never_falls_back_when_locked_or_missing() {
        let (_d, store, provider) = fixture();
        store.require_ready().unwrap();
        for error in [Error::Locked, Error::MissingProvider, Error::Unavailable] {
            *provider.failure.lock().unwrap() = Some(error);
            assert_eq!(store.require_ready(), Err(error));
            let status = store.status();
            assert!(!status.ready);
            assert!(status.tier == Some(Tier::Native));
            assert!(!status.can_create);
        }
    }
    #[test]
    fn absent_provider_offers_explicit_vault_and_persists_its_selection() {
        let (d, store, provider) = fixture();
        *provider.failure.lock().unwrap() = Some(Error::MissingProvider);
        assert!(store.status().can_create);
        store.create_or_migrate(b"passphrase", &[]).unwrap();
        let binary = (0..4096).map(|i| (i % 256) as u8).collect::<Vec<_>>();
        store.put("app.gchat.gbot", "ssh-key", &binary).unwrap();
        store
            .put("app.gchat.gbot", "marker", b"large private key")
            .unwrap();
        *provider.failure.lock().unwrap() = None;
        assert!(store.status().tier == Some(Tier::Passphrase));
        let restarted = Store::new(d.path());
        assert!(!restarted.status().ready);
        assert_eq!(restarted.unlock(b"wrong"), Err(Error::InvalidData));
        restarted.unlock(b"passphrase").unwrap();
        assert_eq!(
            restarted
                .get("app.gchat.gbot", "ssh-key")
                .unwrap()
                .unwrap()
                .as_slice(),
            binary.as_slice()
        );
        restarted.lock().unwrap();
        assert_eq!(
            restarted.get("app.gchat.gbot", "ssh-key").err(),
            Some(Error::Locked)
        );
        let bytes = std::fs::read(d.path().join("credentials/vault.json")).unwrap();
        assert!(!String::from_utf8(bytes)
            .unwrap()
            .contains("large private key"));
    }
    #[test]
    fn authenticated_record_identity_and_ciphertext_reject_tampering() {
        let (_d, store, _) = fixture();
        store.create_or_migrate(b"passphrase", &[]).unwrap();
        store.put("app.gchat.gbot", "a", b"secret").unwrap();
        let mut document = store.read().unwrap();
        let vault = document.vault.as_mut().unwrap();
        let blob = vault
            .records
            .remove(&Reference::new("app.gchat.gbot", "a").identity().unwrap())
            .unwrap();
        vault.records.insert(
            Reference::new("app.gchat.gbot", "b").identity().unwrap(),
            blob,
        );
        store.save(&document).unwrap();
        assert_eq!(
            store.get("app.gchat.gbot", "b").err(),
            Some(Error::InvalidData)
        );
        let mut document = store.read().unwrap();
        document
            .vault
            .as_mut()
            .unwrap()
            .records
            .values_mut()
            .next()
            .unwrap()
            .ciphertext[0] ^= 1;
        store.save(&document).unwrap();
        assert_eq!(
            store.get("app.gchat.gbot", "b").err(),
            Some(Error::InvalidData)
        );
    }
    #[test]
    fn interrupted_migration_keeps_source_and_verifies_latest_bytes_before_commit() {
        let (_d, store, provider) = fixture();
        let first = Reference::new("app.gchat.ginfer-host", "first");
        let second = Reference::new("app.gchat.gbot", "second");
        provider.put(&first, b"grant").unwrap();
        assert_eq!(
            store.create_or_migrate(b"passphrase", &[first.clone(), second.clone()]),
            Err(Error::Missing)
        );
        assert_eq!(store.read().unwrap().active, None);
        assert_eq!(provider.get(&first).unwrap().unwrap(), b"grant");
        provider.put(&first, b"updated-grant").unwrap();
        provider.put(&second, b"key").unwrap();
        store.lock().unwrap();
        store
            .create_or_migrate(b"passphrase", &[first.clone(), second.clone()])
            .unwrap();
        assert_eq!(
            store
                .get(&first.service, &first.account)
                .unwrap()
                .unwrap()
                .as_slice(),
            b"updated-grant"
        );
        assert_eq!(provider.get(&first).unwrap().unwrap(), b"updated-grant");
        assert!(store.read().unwrap().migration.is_none());
    }
    #[test]
    fn independent_process_handles_serialize_writes_and_child_unlock() {
        let (d, store, _) = fixture();
        store.create_or_migrate(b"passphrase", &[]).unwrap();
        store.put("app.gchat.gbot", "control", b"token").unwrap();
        let child = Arc::new(Store::new(d.path()));
        child
            .accept_session_key(&store.session_key().unwrap().unwrap())
            .unwrap();
        let mut tasks = Vec::new();
        for index in 0..8 {
            let store = if index % 2 == 0 {
                store.clone()
            } else {
                child.clone()
            };
            tasks.push(std::thread::spawn(move || {
                store
                    .put("app.gchat.gbot", &index.to_string(), &[index])
                    .unwrap()
            }));
        }
        for task in tasks {
            task.join().unwrap();
        }
        for index in 0..8 {
            assert_eq!(
                child
                    .get("app.gchat.gbot", &index.to_string())
                    .unwrap()
                    .unwrap()
                    .as_slice(),
                &[index]
            );
        }
        assert_eq!(
            std::fs::metadata(d.path().join("credentials/vault.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
