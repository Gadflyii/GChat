use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use serde_json::Value;

// OpenCode loads global configuration in this order. Later documents override
// earlier values while preserving non-conflicting object keys.
const LOAD_ORDER: [&str; 3] = ["config.json", "opencode.json", "opencode.jsonc"];
// This matches OpenCode's own choice of the document it edits: prefer JSONC,
// then JSON, then the legacy filename, and create JSONC for a new install.
const WRITE_ORDER: [&str; 3] = ["opencode.jsonc", "opencode.json", "config.json"];

pub(crate) fn config_directory(data: &Path) -> PathBuf {
    data.join("code").join("opencode")
}

pub(crate) fn child_env(directory: &Path) -> Vec<(OsString, OsString)> {
    vec![
        (
            "XDG_CONFIG_HOME".into(),
            directory
                .parent()
                .expect("managed OpenCode directory has a parent")
                .as_os_str()
                .to_owned(),
        ),
        (
            "OPENCODE_CONFIG_DIR".into(),
            directory.as_os_str().to_owned(),
        ),
        (
            "OPENCODE_CONFIG".into(),
            writable_config_path(directory).into_os_string(),
        ),
    ]
}

pub(crate) fn writable_config_path(directory: &Path) -> PathBuf {
    WRITE_ORDER
        .iter()
        .map(|name| directory.join(name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| directory.join(WRITE_ORDER[0]))
}

pub(crate) fn read_config_file(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let value = if text.trim().is_empty() {
        serde_json::json!({})
    } else {
        json5::from_str(&text).map_err(|error| {
            format!(
                "Could not parse {}: {error}. Fix the reported location and try again.",
                path.display()
            )
        })?
    };
    if !value.is_object() {
        return Err(format!("{} is not a JSON object", path.display()));
    }
    Ok(value)
}

pub(crate) fn read_merged_global_config(directory: &Path) -> Result<Option<Value>, String> {
    let mut merged = serde_json::json!({});
    let mut found = false;
    for name in LOAD_ORDER {
        let path = directory.join(name);
        if !path.is_file() {
            continue;
        }
        found = true;
        merge_value(&mut merged, read_config_file(&path)?);
    }
    Ok(found.then_some(merged))
}

fn merge_value(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base), Value::Object(overlay)) => {
            for (key, value) in overlay {
                if let Some(existing) = base.get_mut(&key) {
                    merge_value(existing, value);
                } else {
                    base.insert(key, value);
                }
            }
        }
        (base, overlay) => *base = overlay,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonc_is_the_preferred_writable_global_config() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            writable_config_path(temp.path()),
            temp.path().join("opencode.jsonc")
        );
        std::fs::write(temp.path().join("opencode.json"), "{}").unwrap();
        assert_eq!(
            writable_config_path(temp.path()),
            temp.path().join("opencode.json")
        );
        std::fs::write(temp.path().join("opencode.jsonc"), "{}").unwrap();
        assert_eq!(
            writable_config_path(temp.path()),
            temp.path().join("opencode.jsonc")
        );
    }

    #[test]
    fn global_jsonc_overrides_json_without_discarding_other_keys() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("opencode.json"),
            r#"{"provider":{"gchat":{"name":"GChat"}},"model":"gchat/old"}"#,
        )
        .unwrap();
        std::fs::write(
            temp.path().join("opencode.jsonc"),
            r#"{
                // JSONC is the final global precedence layer.
                "model": "gchat/current",
            }"#,
        )
        .unwrap();

        let merged = read_merged_global_config(temp.path()).unwrap().unwrap();
        assert_eq!(merged.pointer("/provider/gchat/name").unwrap(), "GChat");
        assert_eq!(merged.get("model").unwrap(), "gchat/current");
    }
}
