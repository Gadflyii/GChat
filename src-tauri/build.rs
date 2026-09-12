use std::fs;
use std::path::Path;

/// Embed Common Controls v6 so Windows libtest harnesses can start.
///
/// Libtest binaries import `TaskDialogIndirect` / window-subclass APIs from
/// `comctl32.dll`. Without a v6 activation context they load the system v5
/// DLL and die at process start with `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139).
/// Keep this manifest test-only: Tauri embeds the application manifest in
/// `resource.lib`, and adding another manifest to the app binary creates a
/// duplicate resource with id 1.
#[cfg(all(windows, feature = "test-tauri"))]
fn embed_windows_test_manifest() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test.manifest");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}

#[cfg(all(windows, feature = "test-tauri"))]
fn build_tauri() {
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run Tauri build helpers");
}

#[cfg(not(all(windows, feature = "test-tauri")))]
fn build_tauri() {
    tauri_build::build();
}

fn main() {
    stage_launch_profiles();

    #[cfg(all(windows, feature = "test-tauri"))]
    embed_windows_test_manifest();

    #[cfg(not(feature = "cli"))]
    build_tauri()
}

fn stage_launch_profiles() {
    println!("cargo:rerun-if-env-changed=GINFER_PROFILE_CATALOGS");
    let platform = std::env::var("CARGO_CFG_TARGET_OS").expect("missing target OS");
    let mut profiles = Vec::new();
    let mut ids = std::collections::BTreeSet::new();
    if let Some(paths) =
        std::env::var_os("GINFER_PROFILE_CATALOGS").filter(|value| !value.is_empty())
    {
        for path in std::env::split_paths(&paths) {
            println!("cargo:rerun-if-changed={}", path.display());
            let catalog: serde_json::Value = serde_json::from_slice(
                &fs::read(&path).expect("cannot read selected GInfer profile catalog"),
            )
            .expect("invalid GInfer profile catalog JSON");
            assert_eq!(
                catalog["schema"], "ginfer-launch-profiles-v1",
                "unsupported profile catalog"
            );
            for profile in catalog["profiles"]
                .as_array()
                .expect("missing profiles array")
            {
                assert_eq!(
                    profile["platform"], platform,
                    "profile qualification platform differs from desktop target"
                );
                let id = profile["id"].as_str().expect("profile missing id");
                assert!(ids.insert(id.to_owned()), "duplicate launch profile: {id}");
                profiles.push(profile.clone());
            }
        }
    }
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/bin/launch-profiles.json");
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema": "ginfer-launch-profiles-v1", "profiles": profiles,
    }))
    .expect("cannot serialize bundled profiles");
    fs::create_dir_all(output.parent().unwrap()).expect("cannot create resource directory");
    if fs::read(&output).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(&output, bytes).expect("cannot stage bundled profiles");
    }
}
