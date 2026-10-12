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
            match fs::remove_file(&temporary) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
            continue;
        }
        // A previous interrupted copy is disposable, including a copied read-only
        // mode; recreate it so retry never depends on the partial's permissions.
        match fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        fs::copy(source.join(&asset.filename), &temporary)?;
        verify(&temporary, asset)?;
        File::open(&temporary)?.sync_all()?;
        fs::rename(&temporary, &target)?;
        File::open(destination)?.sync_all()?;
        changed = true;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_guest_delivery_retries_interruption_and_refuses_mismatches() {
        let pins = accepted();
        assert_eq!(pins.iter().map(|a| (a.filename.as_str(), a.algorithm.as_str(), a.digest.as_str(), a.bytes)).collect::<Vec<_>>(), vec![
            ("debian-13-genericcloud-amd64-20261001-2618.qcow2", "sha512", "f46f0671a6e5bdec5291ab8972bae2f10e5408c2f64a74078f11efc2f06a436a9d0313ed50e0472542eeabf780e9f7c792ac0a314c6c20507fcd9fd81b468c3d", Some(341508096)),
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
        let partial = destination.join(format!(".{}.installing", fixture[1].filename));
        fs::write(&partial, "interrupted").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&partial, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(install_from(&source, &destination, &fixture).unwrap());
        assert!(!partial.exists());
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
    }
}
