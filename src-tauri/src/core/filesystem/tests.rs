use super::commands::*;
use crate::core::app::commands::get_jan_data_folder_path;
use std::fs::{self, File};
use std::io::Write;
use tauri::test::mock_app;
use tauri::Manager;

#[test]
fn test_rm() {
    let app = mock_app();
    let path = "test_rm_dir";
    fs::create_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path)).unwrap();
    let args = vec![format!("file://{path}").to_string()];
    let result = rm(app.handle().clone(), args);
    assert!(result.is_ok());
    assert!(!get_jan_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
}

#[test]
fn test_mkdir() {
    let app = mock_app();
    let path = "test_mkdir_dir";
    let args = vec![format!("file://{path}").to_string()];
    let result = mkdir(app.handle().clone(), args);
    assert!(result.is_ok());
    assert!(get_jan_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
    let _ = fs::remove_dir_all(get_jan_data_folder_path(app.handle().clone()).join(path));
}

#[test]
fn test_join_path() {
    let app = mock_app();
    let path = "file://test_dir";
    let args = vec![path.to_string(), "test_file".to_string()];
    let result = join_path(app.handle().clone(), args).unwrap();
    assert_eq!(
        result,
        get_jan_data_folder_path(app.handle().clone())
            .join(format!("test_dir{}test_file", std::path::MAIN_SEPARATOR))
            .to_string_lossy()
            .to_string()
    );
}

#[test]
fn test_exists_sync() {
    let app = mock_app();
    let path = "file://test_exists_sync_file";
    let dir_path = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_exists_sync_file");
    File::create(&file_path).unwrap();
    let args: Vec<String> = vec![path.to_string()];
    let result = exists_sync(app.handle().clone(), args).unwrap();
    assert!(result);
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_read_file_sync() {
    let app = mock_app();
    let path = "file://test_read_file_sync_file";
    let dir_path = get_jan_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_read_file_sync_file");
    let mut file = File::create(&file_path).unwrap();
    file.write_all(b"test content").unwrap();
    let args = vec![path.to_string()];
    let result = read_file_sync(app.handle().clone(), args).unwrap();
    assert_eq!(result, "test content".to_string());
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_readdir_sync() {
    let app = mock_app();
    let dir_path = get_jan_data_folder_path(app.handle().clone()).join("test_readdir_sync_dir");
    fs::create_dir_all(&dir_path).unwrap();
    File::create(dir_path.join("file1.txt")).unwrap();
    File::create(dir_path.join("file2.txt")).unwrap();

    let args = vec![dir_path.to_string_lossy().to_string()];
    let result = readdir_sync(app.handle().clone(), args).unwrap();
    assert_eq!(result.len(), 2);

    let _ = fs::remove_dir_all(dir_path);
}

#[cfg(unix)]
#[test]
fn yaml_reads_discovered_models_through_symlinked_data_folder() {
    let directory = tempfile::tempdir().unwrap();
    let data_folder = directory.path().join("data");
    let model_dir = data_folder.join("ginfer/models/local-model");
    fs::create_dir_all(&model_dir).unwrap();
    fs::write(model_dir.join("model.yml"), "name: Local model\n").unwrap();
    let alias = directory.path().join("data-alias");
    std::os::unix::fs::symlink(&data_folder, &alias).unwrap();
    let app = mock_app();
    app.manage(crate::test_support::TestDataRoot(alias.clone()));

    let locations = crate::core::ginfer_models::enumerate_model_locations_in(&alias).unwrap();
    assert_eq!(locations.len(), 1);
    let manifest_path = &locations[0].manifest_path;
    assert_eq!(
        std::path::Path::new(manifest_path),
        model_dir.join("model.yml").canonicalize().unwrap()
    );
    let original = serde_json::json!({"name": "Local model"});
    assert_eq!(
        read_yaml(app.handle().clone(), manifest_path).unwrap(),
        original
    );
    let lexical_path = alias.join("ginfer/models/local-model/model.yml");
    assert_eq!(
        read_yaml(app.handle().clone(), lexical_path.to_str().unwrap()).unwrap(),
        original
    );

    let updated = serde_json::json!({"name": "Renamed model"});
    write_yaml(app.handle().clone(), updated.clone(), manifest_path).unwrap();
    assert_eq!(
        read_yaml(app.handle().clone(), "ginfer/models/local-model/model.yml").unwrap(),
        updated
    );
    let new_path = model_dir.canonicalize().unwrap().join("new.yml");
    write_yaml(
        app.handle().clone(),
        original.clone(),
        new_path.to_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        read_yaml(app.handle().clone(), new_path.to_str().unwrap()).unwrap(),
        original
    );
}

#[test]
fn yaml_rejects_paths_outside_data_folder() {
    let directory = tempfile::tempdir().unwrap();
    let data_folder = directory.path().join("data");
    fs::create_dir(&data_folder).unwrap();
    let outside = directory.path().join("outside.yml");
    let contents = "name: Outside model\n";
    fs::write(&outside, contents).unwrap();
    let app = mock_app();
    app.manage(crate::test_support::TestDataRoot(data_folder.clone()));

    for path in [outside.to_str().unwrap(), "../outside.yml"] {
        assert!(read_yaml(app.handle().clone(), path).is_err());
        assert!(write_yaml(app.handle().clone(), serde_json::json!({}), path).is_err());
    }
    #[cfg(unix)]
    {
        let escape = data_folder.join("outside-link.yml");
        std::os::unix::fs::symlink(&outside, &escape).unwrap();
        assert!(read_yaml(app.handle().clone(), escape.to_str().unwrap()).is_err());
        assert!(write_yaml(
            app.handle().clone(),
            serde_json::json!({}),
            escape.to_str().unwrap(),
        )
        .is_err());

        let escape_dir = data_folder.join("outside-directory");
        std::os::unix::fs::symlink(directory.path(), &escape_dir).unwrap();
        let new_outside = escape_dir.join("new-outside.yml");
        assert!(write_yaml(
            app.handle().clone(),
            serde_json::json!({}),
            new_outside.to_str().unwrap(),
        )
        .is_err());
        assert!(!directory.path().join("new-outside.yml").exists());

        let missing_target = directory.path().join("missing-outside.yml");
        let dangling = data_folder.join("dangling.yml");
        std::os::unix::fs::symlink(&missing_target, &dangling).unwrap();
        assert!(write_yaml(
            app.handle().clone(),
            serde_json::json!({}),
            dangling.to_str().unwrap(),
        )
        .is_err());
        assert!(!missing_target.exists());
    }
    assert_eq!(fs::read_to_string(outside).unwrap(), contents);
}
