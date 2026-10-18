//! Deliver immutable guest resources through the existing configured-data installer.
use gbot_service::guest_assets::{accepted, GuestAsset};
use sha2::{Digest, Sha256, Sha512};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::Path,
};

fn verify(path: &Path, asset: &GuestAsset) -> io::Result<()> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || asset.bytes.is_some_and(|bytes| metadata.len() != bytes) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Guest asset size mismatch: {}", path.display()),
        ));
    }
    let mut sha256 = Sha256::new();
    let mut sha512 = Sha512::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        match asset.algorithm.as_str() {
            "sha256" => sha256.update(&buffer[..count]),
            "sha512" => sha512.update(&buffer[..count]),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Unsupported compiled guest asset digest",
                ))
            }
        }
    }
    let digest = match asset.algorithm.as_str() {
        "sha256" => format!("{:x}", sha256.finalize()),
        "sha512" => format!("{:x}", sha512.finalize()),
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Unsupported compiled guest asset digest",
            ))
        }
    };
    if digest != asset.digest {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("Pinned guest asset digest mismatch: {}. Replace it with the accepted GChat release resource and retry.", path.display())));
    }
    Ok(())
}

pub(super) fn install(resource_directory: &Path, data_folder: &Path) -> io::Result<bool> {
    let source = resource_directory.join("resources/gbot/assets");
    // Ordinary GChat and development bundles can omit this opt-in feature.
    if !source.exists() {
        return Ok(false);
    }
    install_from(&source, &data_folder.join("gbot/vms/assets"), &accepted())
}

fn install_from(source: &Path, destination: &Path, assets: &[GuestAsset]) -> io::Result<bool> {
    // Refuse the whole input before delivering any member. Existing immutable files
    // also require their exact pin; do not overwrite a mismatched user-staged file.
    for asset in assets {
        verify(&source.join(&asset.filename), asset)?;
        let target = destination.join(&asset.filename);
        if target.exists() {
            verify(&target, asset)?;
        }
    }
    fs::create_dir_all(destination)?;
    let mut changed = false;
    for asset in assets {
        let target = destination.join(&asset.filename);
        let temporary = destination.join(format!(".{}.installing", asset.filename));
        if target.exists() {
            remove_partial(&temporary)?;
            continue;
        }
        // A previous interrupted copy is disposable, including a copied read-only
        // mode; recreate it so retry never depends on the partial's permissions.
        remove_partial(&temporary)?;
        fs::copy(source.join(&asset.filename), &temporary)?;
        verify(&temporary, asset)?;
        sync_partial(&temporary)?;
        fs::rename(&temporary, &target)?;
        #[cfg(unix)]
        File::open(destination)?.sync_all()?;
        changed = true;
    }
    Ok(changed)
}

fn sync_partial(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        // FlushFileBuffers needs a write handle. A bundled read-only source also
        // makes its owned copy read-only, so restore that mode after flushing.
        let permissions = fs::metadata(path)?.permissions();
        let readonly = permissions.readonly();
        if readonly {
            let mut writable = permissions.clone();
            writable.set_readonly(false);
            fs::set_permissions(path, writable)?;
        }
        let result = fs::OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|file| file.sync_all());
        if readonly {
            fs::set_permissions(path, permissions)?;
        }
        result
    }
    #[cfg(not(windows))]
    File::open(path)?.sync_all()
}

fn remove_partial(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    // Only the exact installer-owned regular partial can have its permissions
    // changed. Never follow a link to a different file during Windows cleanup.
    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Guest asset partial is not a regular file: {}", path.display()),
        ));
    }
    #[cfg(windows)]
    if metadata.permissions().readonly() {
        let mut permissions = metadata.permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions)?;
    }
    fs::remove_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_guest_delivery_retries_interruption_and_refuses_mismatches() {
        let pins = accepted();
        #[cfg(target_os = "windows")]
        let first_pin = (
            "debian-13-genericcloud-amd64-20261001-2618.vhdx",
            "sha256",
            "9feafe51b36dccdcd79c2e97653a2ec04d9901ea7b69d75be9712f10c95f7c19",
            Some(1233125376),
        );
        #[cfg(not(target_os = "windows"))]
        let first_pin = (
            "debian-13-genericcloud-amd64-20261001-2618.qcow2",
            "sha512",
            "f46f0671a6e5bdec5291ab8972bae2f10e5408c2f64a74078f11efc2f06a436a9d0313ed50e0472542eeabf780e9f7c792ac0a314c6c20507fcd9fd81b468c3d",
            Some(341508096),
        );
        assert_eq!(pins.iter().map(|a| (a.filename.as_str(), a.algorithm.as_str(), a.digest.as_str(), a.bytes)).collect::<Vec<_>>(), vec![
            first_pin,
            ("cua-driver-c549ab4d7.tar.gz", "sha256", "2532c8bb8c6bef4f179285c58241a2f46c8fd2e1f6228c65bb65a1e6176261c6", None),
            ("cua-spacesd-native-20261012.tar.gz", "sha256", "f7d2d547ad4d94759aba93a5eb37ad1b5b93d5272074273a5ed4a130ee0b0ed7", None),
        ]);
        let root = tempfile::tempdir().unwrap();
        let resource = root.path().join("bundle");
        let data = root.path().join("custom-data");
        assert!(!install(&resource, &data).unwrap());
        assert!(!data.exists());
        let source = resource.join("resources/gbot/assets");
        let destination = data.join("gbot/vms/assets");
        fs::create_dir_all(&source).unwrap();
        // Tiny represented inputs exercise real hashing/copy/publication; these are
        // fixture pins, never evidence that the large accepted payloads were bundled.
        let mut fixture = pins.clone();
        for (index, asset) in fixture.iter_mut().enumerate() {
            let bytes = format!("guest payload {index}");
            asset.bytes = Some(bytes.len() as u64);
            asset.digest = if asset.algorithm == "sha512" {
                format!("{:x}", Sha512::digest(bytes.as_bytes()))
            } else {
                format!("{:x}", Sha256::digest(bytes.as_bytes()))
            };
            fs::write(source.join(&asset.filename), bytes).unwrap();
        }
        // Real accepted pins refuse synthetic resources rather than admitting Ready.
        assert!(install(&resource, &data).is_err());
        assert!(!destination.exists());
        fs::create_dir_all(&destination).unwrap();
        fs::write(data.join("keep-state"), "unrelated state").unwrap();
        let first = &fixture[0].filename;
        fs::copy(source.join(first), destination.join(first)).unwrap();
        let partials = [first, &fixture[1].filename].map(|filename| {
            let partial = destination.join(format!(".{filename}.installing"));
            fs::write(&partial, "interrupted").unwrap();
            let mut permissions = fs::metadata(&partial).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(&partial, permissions).unwrap();
            partial
        });
        let readonly_source = source.join(&fixture[1].filename);
        let mut permissions = fs::metadata(&readonly_source).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&readonly_source, permissions).unwrap();
        assert!(install_from(&source, &destination, &fixture).unwrap());
        assert!(partials.iter().all(|partial| !partial.exists()));
        assert!(fs::metadata(destination.join(&fixture[1].filename))
            .unwrap()
            .permissions()
            .readonly());
        for asset in &fixture {
            assert_eq!(
                fs::read(source.join(&asset.filename)).unwrap(),
                fs::read(destination.join(&asset.filename)).unwrap()
            );
        }
        assert!(!install_from(&source, &destination, &fixture).unwrap());
        fs::write(source.join(&fixture[2].filename), "mismatch").unwrap();
        assert!(install_from(&source, &destination, &fixture).is_err());
        verify(&destination.join(&fixture[2].filename), &fixture[2]).unwrap();
        fs::copy(
            destination.join(&fixture[2].filename),
            source.join(&fixture[2].filename),
        )
        .unwrap();
        fs::write(destination.join(first), "mismatch").unwrap();
        assert!(install_from(&source, &destination, &fixture).is_err());
        assert_eq!(fs::read(destination.join(first)).unwrap(), b"mismatch");
        assert_eq!(
            fs::read(data.join("keep-state")).unwrap(),
            b"unrelated state"
        );
        #[cfg(windows)]
        for path in [readonly_source, destination.join(&fixture[1].filename)] {
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn guest_delivery_refuses_a_linked_partial_without_changing_its_target() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let mut asset = accepted().remove(0);
        asset.algorithm = "sha256".into();
        asset.bytes = Some(7);
        asset.digest = format!("{:x}", Sha256::digest(b"fixture"));
        fs::write(source.join(&asset.filename), "fixture").unwrap();
        let unrelated = root.path().join("keep-state");
        fs::write(&unrelated, "unrelated state").unwrap();
        let partial = destination.join(format!(".{}.installing", asset.filename));
        std::os::unix::fs::symlink(&unrelated, &partial).unwrap();

        let error = install_from(&source, &destination, std::slice::from_ref(&asset)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(fs::symlink_metadata(&partial)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&unrelated).unwrap(), b"unrelated state");
        assert!(!destination.join(&asset.filename).exists());
    }
}
