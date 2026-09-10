use std::fs;
use std::path::Path;

/// Compile-time vars read via `option_env!` in `core::telemetry` that we allow a
/// local `src-tauri/.env` to populate for dev builds. CI sets these in the real
/// environment, which always takes precedence over the file (see `load_dotenv`).
const DOTENV_KEYS: &[&str] = &["SENTRY_DSN_DESKTOP", "SENTRY_RELEASE", "SENTRY_ENVIRONMENT"];

/// ATO-113 (dev convenience): let a gitignored `src-tauri/.env` feed the Sentry
/// compile-time vars so devs don't have to `export` them in every shell. Cargo
/// does not read `.env` itself, so we parse it here and emit `cargo:rustc-env`
/// — but only for keys NOT already present in the ambient environment, so a CI
/// `export` (the production path) is never overridden.
fn load_dotenv() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let env_path = Path::new(&manifest_dir).join(".env");

    println!("cargo:rerun-if-changed={}", env_path.display());
    for key in DOTENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let Ok(contents) = fs::read_to_string(&env_path) else {
        return;
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((raw_key, raw_val)) = line.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if !DOTENV_KEYS.contains(&key) {
            continue;
        }
        // Ambient env (CI export) wins; the file only fills the gap.
        if std::env::var(key).is_ok() {
            continue;
        }
        let val = raw_val.trim().trim_matches(|c| c == '"' || c == '\'');
        println!("cargo:rustc-env={key}={val}");
    }
}

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
    load_dotenv();
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
    if let Some(paths) = std::env::var_os("GINFER_PROFILE_CATALOGS").filter(|value| !value.is_empty()) {
        for path in std::env::split_paths(&paths) {
            println!("cargo:rerun-if-changed={}", path.display());
            let catalog: serde_json::Value = serde_json::from_slice(
                &fs::read(&path).expect("cannot read selected GInfer profile catalog"),
            ).expect("invalid GInfer profile catalog JSON");
            assert_eq!(catalog["schema"], "ginfer-launch-profiles-v1", "unsupported profile catalog");
            for profile in catalog["profiles"].as_array().expect("missing profiles array") {
                assert_eq!(profile["platform"], platform, "profile qualification platform differs from desktop target");
                let id = profile["id"].as_str().expect("profile missing id");
                assert!(ids.insert(id.to_owned()), "duplicate launch profile: {id}");
                profiles.push(profile.clone());
            }
        }
    }
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/bin/launch-profiles.json");
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema": "ginfer-launch-profiles-v1", "profiles": profiles,
    })).expect("cannot serialize bundled profiles");
    fs::create_dir_all(output.parent().unwrap()).expect("cannot create resource directory");
    if fs::read(&output).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(&output, bytes).expect("cannot stage bundled profiles");
    }
}
