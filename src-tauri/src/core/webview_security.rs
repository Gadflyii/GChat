//! Keep the privileged webviews on application pages. Preview documents are
//! unprivileged native-protocol frames, never application origins.
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
        && left.username().is_empty()
        && left.password().is_none()
}

fn preview_url(url: &Url) -> bool {
    (url.scheme() == "gchat-preview" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("gchat-preview.localhost")
            && url.port().is_none())
        || (url.scheme() == "asset" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("asset.localhost")
            && url.port().is_none())
}

fn navigation_allowed(app_origin: &Url, url: &Url, main_frame: bool) -> bool {
    same_origin(url, app_origin) || (!main_frame && preview_url(url))
}

fn app_origin(app: &AppHandle, config: &tauri::utils::config::WindowConfig) -> Url {
    if tauri::is_dev() {
        if let Some(url) = app.config().build.dev_url.as_ref() {
            return url.clone();
        }
    }
    if let Some(tauri::utils::config::FrontendDist::Url(url)) =
        app.config().build.frontend_dist.as_ref()
    {
        return url.clone();
    }
    #[cfg(target_os = "windows")]
    let origin = if config.use_https_scheme {
        "https://tauri.localhost"
    } else {
        "http://tauri.localhost"
    };
    #[cfg(not(target_os = "windows"))]
    let origin = {
        let _ = config;
        "tauri://localhost"
    };
    Url::parse(origin).expect("fixed application origin")
}

pub fn build_window(
    app: &AppHandle,
    config: &tauri::utils::config::WindowConfig,
) -> tauri::Result<WebviewWindow> {
    let origin = app_origin(app, config);
    let initial_url = match &config.url {
        tauri::WebviewUrl::App(path) => origin
            .join(&path.to_string_lossy())
            .map_err(tauri::Error::InvalidUrl)?,
        tauri::WebviewUrl::External(url) | tauri::WebviewUrl::CustomProtocol(url)
            if same_origin(url, &origin) =>
        {
            url.clone()
        }
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "Window URL is outside the application origin",
            )
            .into())
        }
    };
    let cache = app
        .path()
        .app_cache_dir()?
        .join(super::artifact::ARTIFACT_CACHE_DIRECTORY);
    // Keep the initial application origin: Tauri binds asset-protocol CORS
    // headers to it. Wry installs on_navigation before its first URL load;
    // deny that load until both native guards are installed.
    let ready = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let navigation_ready = ready.clone();
    let navigation_origin = origin.clone();
    let opener = app.clone();
    let window = WebviewWindowBuilder::from_config(app, config)?
        .on_navigation(move |url| {
            // WebKit's callback includes subframes. Its response policy below
            // distinguishes them before allowing a document to commit.
            navigation_ready.load(std::sync::atomic::Ordering::Acquire)
                && navigation_allowed(&navigation_origin, url, !cfg!(target_os = "linux"))
        })
        .on_new_window(move |url, _| {
            if matches!(url.scheme(), "https" | "http" | "mailto" | "tel") {
                if let Err(error) = opener.opener().open_url(url.as_str(), None::<&str>) {
                    log::warn!("Could not open external link: {error}");
                }
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    let (installed, result) = std::sync::mpsc::sync_channel(1);
    window.with_webview(move |native| {
        let result = install_frame_guard(&native, origin)
            .and_then(|()| super::preview_protocol::install(&native, cache));
        let _ = installed.send(result);
    })?;
    // Tauri holds its dispatcher lock throughout with_webview. Dispatching
    // navigation or destruction from that callback would deadlock on startup.
    // Wait for installation, then dispatch only after the callback returns.
    if let Err(error) = result.recv().unwrap_or_else(|error| Err(error.to_string())) {
        log::error!("Could not install webview security boundary: {error}");
        let _ = window.destroy();
        return Err(std::io::Error::other(error).into());
    }
    ready.store(true, std::sync::atomic::Ordering::Release);
    window.navigate(initial_url)?;
    Ok(window)
}

#[cfg(target_os = "linux")]
fn install_frame_guard(
    webview: &tauri::webview::PlatformWebview,
    origin: Url,
) -> Result<(), String> {
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        PolicyDecisionExt, ResponsePolicyDecision, ResponsePolicyDecisionExt, URIResponseExt,
        WebViewExt,
    };
    webview
        .inner()
        .connect_decide_policy(move |_, decision, _| {
            let Some(response) = decision.downcast_ref::<ResponsePolicyDecision>() else {
                return false;
            };
            let allowed = response
                .response()
                .and_then(|response| response.uri())
                .and_then(|uri| Url::parse(uri.as_str()).ok())
                .is_some_and(|url| {
                    navigation_allowed(&origin, &url, response.is_main_frame_main_resource())
                });
            if !allowed {
                decision.ignore();
            }
            !allowed
        });
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_frame_guard(
    webview: &tauri::webview::PlatformWebview,
    origin: Url,
) -> Result<(), String> {
    use webview2_com::{take_pwstr, NavigationStartingEventHandler};
    use windows::core::PWSTR;
    // WebView2's NavigationStarting (installed by Wry above) is top-level
    // only. FrameNavigationStarting is a separate event, including redirects.
    unsafe {
        let view = webview
            .controller()
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        let mut token = 0;
        view.add_FrameNavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let allowed = Url::parse(&take_pwstr(uri))
                        .is_ok_and(|url| navigation_allowed(&origin, &url, false));
                    args.SetCancel(!allowed)?;
                }
                Ok(())
            })),
            &mut token,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn install_frame_guard(
    _webview: &tauri::webview::PlatformWebview,
    _origin: Url,
) -> Result<(), String> {
    Ok(())
}

fn auxiliary_config(label: &str) -> Result<tauri::utils::config::WindowConfig, String> {
    let (url, title, width, height) = match label {
        "logs-app-window" => ("logs", "App Logs - GChat", 800.0, 600.0),
        "logs-window-local-api-server" => (
            "local-api-server/logs",
            "Local API Server Logs - GChat",
            800.0,
            600.0,
        ),
        "system-monitor-window" => ("system-monitor", "System Monitor - GChat", 1000.0, 700.0),
        _ => return Err("Unknown application window".to_string()),
    };
    Ok(tauri::utils::config::WindowConfig {
        label: label.to_string(),
        url: tauri::WebviewUrl::App(url.into()),
        title: title.to_string(),
        width,
        height,
        center: true,
        ..Default::default()
    })
}

#[tauri::command]
pub async fn open_auxiliary_window(
    app: AppHandle,
    label: String,
    theme: Option<String>,
) -> Result<(), String> {
    let mut config = auxiliary_config(&label)?;
    config.theme = match theme.as_deref() {
        Some("dark") => Some(tauri::utils::Theme::Dark),
        Some("light") => Some(tauri::utils::Theme::Light),
        None => None,
        _ => return Err("Unknown window theme".to_string()),
    };
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    build_window(&app, &config).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_keeps_previews_in_frames_and_app_pages_on_their_origin() {
        for app in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "http://localhost:1420/",
        ] {
            let origin = Url::parse(app).unwrap();
            assert!(navigation_allowed(
                &origin,
                &origin.join("settings").unwrap(),
                true
            ));
            for target in [
                "gchat-preview://localhost/test",
                "http://gchat-preview.localhost/test",
                "asset://localhost/tmp/preview.html",
                "http://asset.localhost/C:/preview.html",
            ] {
                let target = Url::parse(target).unwrap();
                assert!(!navigation_allowed(&origin, &target, true));
                assert!(navigation_allowed(&origin, &target, false));
            }
            for target in [
                "https://example.test/",
                "http://127.0.0.1:1420/",
                "http://localhost:1421/",
                "tauri://example.test/",
                "http://tauri.localhost.example.test/",
                "file:///tmp/page.html",
                "blob:tauri://localhost/123",
                "blob:http://tauri.localhost/123",
                "data:text/html,<script>window.__TAURI_INTERNALS__.invoke('join_path')</script>",
            ] {
                let target = Url::parse(target).unwrap();
                assert!(!navigation_allowed(&origin, &target, true));
                assert!(!navigation_allowed(&origin, &target, false));
            }
        }
    }

    #[test]
    fn main_origin_blob_html_cannot_become_a_privileged_frame() {
        let origin = Url::parse("tauri://localhost/").unwrap();
        // A text/html Blob made by the application inherits its origin. No
        // desktop frame uses Blob/data documents, so reject both altogether.
        let blob = Url::parse("blob:tauri://localhost/text-html-fixture").unwrap();
        assert!(!navigation_allowed(&origin, &blob, false));
        assert!(!navigation_allowed(&origin, &blob, true));
    }

    #[test]
    fn auxiliary_windows_accept_only_fixed_application_routes() {
        for label in [
            "logs-app-window",
            "logs-window-local-api-server",
            "system-monitor-window",
        ] {
            assert!(matches!(
                auxiliary_config(label).unwrap().url,
                tauri::WebviewUrl::App(_)
            ));
        }
        for label in ["main", "untrusted", "https://example.test/"] {
            assert!(auxiliary_config(label).is_err());
        }
    }
}
