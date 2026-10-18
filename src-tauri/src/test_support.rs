use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{Builder, WebviewWindow, WebviewWindowBuilder};
use tempfile::{tempdir, TempDir};

pub(crate) struct TestDataRoot(pub(crate) PathBuf);

pub(crate) struct IpcTestHarness {
    _app: tauri::App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    temp_dir: TempDir,
}

impl IpcTestHarness {
    pub(crate) fn new(
        configure: impl FnOnce(Builder<MockRuntime>) -> Builder<MockRuntime>,
    ) -> Self {
        let temp_dir = tempdir().expect("failed to create IPC test data directory");
        let (resources, completion) = crate::core::setup::BundledResources::pending();
        completion.send_replace(Some(Ok(())));
        let builder = mock_builder()
            .manage(TestDataRoot(temp_dir.path().to_path_buf()))
            .manage(resources);
        let app = configure(builder)
            .build(mock_context(noop_assets()))
            .expect("failed to build IPC test app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build IPC test webview");

        Self {
            _app: app,
            webview,
            temp_dir,
        }
    }

    pub(crate) fn data_root(&self) -> &Path {
        self.temp_dir.path()
    }

    pub(crate) fn invoke<T: DeserializeOwned>(
        &self,
        command: &str,
        args: Value,
    ) -> Result<T, Value> {
        get_ipc_response(&self.webview, invoke_request(command, args)).and_then(|body| {
            body.deserialize::<T>()
                .map_err(|error| Value::String(error.to_string()))
        })
    }
}

fn invoke_request(command: &str, args: Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "http://tauri.localhost"
            .parse()
            .expect("invalid IPC test URL"),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

// The desktop context resolves the capabilities selected by tauri.conf.json.
// CLI builds skip tauri_build, so run this test with test-tauri alone.
#[cfg(not(feature = "cli"))]
mod capability_scope {
    use tauri::ipc::Origin;

    #[test]
    fn desktop_plugins_stay_local_and_label_scoped() {
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let authority = context.runtime_authority_mut();
        let labels = [
            "main",
            "logs-app-window",
            "logs-window-local-api-server",
            "system-monitor-window",
        ];
        let hardware = "plugin:hardware|get_system_info";
        let shell = "plugin:shell|spawn";

        for label in labels {
            assert!(
                authority
                    .resolve_access(hardware, label, label, &Origin::Local)
                    .is_some(),
                "the local {label} webview must retain hardware access"
            );
            for url in [
                "http://example.test/page",
                "https://example.test/page",
                "http://127.0.0.1:17491/",
            ] {
                let origin = Origin::Remote {
                    url: url.parse().unwrap(),
                };
                for command in [hardware, shell] {
                    assert!(
                        authority
                            .resolve_access(command, label, label, &origin)
                            .is_none(),
                        "remote {url} in {label} must not receive {command}"
                    );
                }
            }
            assert!(
                authority
                    .resolve_access(hardware, label, "unrelated-webview", &Origin::Local)
                    .is_none(),
                "sharing the {label} window must not grant another webview access"
            );
        }

        assert!(authority
            .resolve_access(shell, "main", "main", &Origin::Local)
            .is_some());
        for label in &labels[1..] {
            assert!(
                authority
                    .resolve_access(shell, label, label, &Origin::Local)
                    .is_none(),
                "the auxiliary {label} webview must not receive main-window shell access"
            );
        }
        assert!(authority
            .resolve_access(shell, "main", "unrelated-webview", &Origin::Local)
            .is_none());
        assert!(authority
            .resolve_access(
                hardware,
                "unrelated-window",
                "unrelated-webview",
                &Origin::Local
            )
            .is_none());
    }
}
