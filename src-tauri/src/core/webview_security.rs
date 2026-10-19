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

fn initial_url(origin: &Url, url: &tauri::WebviewUrl) -> tauri::Result<Url> {
    Ok(match url {
        // Match Tauri's App URL resolution: the default index document maps
        // to the application root, where the client router starts.
        tauri::WebviewUrl::App(path) if path.to_str() == Some("index.html") => origin.clone(),
        tauri::WebviewUrl::App(path) => origin
            .join(&path.to_string_lossy())
            .map_err(tauri::Error::InvalidUrl)?,
        tauri::WebviewUrl::External(url) | tauri::WebviewUrl::CustomProtocol(url)
            if same_origin(url, origin) =>
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
    })
}

pub fn build_window(
    app: &AppHandle,
    config: &tauri::utils::config::WindowConfig,
) -> tauri::Result<WebviewWindow> {
    let origin = app_origin(app, config);
    let initial_url = initial_url(&origin, &config.url)?;
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
    fn resumed_navigation_preserves_application_entry_routes() {
        for app in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "http://localhost:1420/",
        ] {
            let origin = Url::parse(app).unwrap();
            assert_eq!(
                initial_url(&origin, &tauri::WebviewUrl::App("index.html".into())).unwrap(),
                origin
            );
            assert_eq!(
                initial_url(&origin, &tauri::WebviewUrl::App("logs".into())).unwrap(),
                origin.join("logs").unwrap()
            );
            assert!(initial_url(
                &origin,
                &tauri::WebviewUrl::External(Url::parse("https://example.test/").unwrap())
            )
            .is_err());
        }
    }

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

/// Opt-in native acceptance; never starts the product or its credential/Host
/// services. Run alone on an explicitly booked Windows desktop host.
#[cfg(all(test, target_os = "windows", not(feature = "cli")))]
mod windows_native_admission {
    use super::*;
    use serde_json::{json, Value};
    use std::{
        borrow::Cow,
        path::PathBuf,
        sync::{mpsc, Arc, Mutex},
        time::{Duration, Instant},
    };
    use std::{cell::RefCell, rc::Rc};
    use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
    use webview2_com::{
        take_pwstr, FrameCreatedEventHandler, FrameWebMessageReceivedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Frame2, ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2_2,
            ICoreWebView2_4,
        },
        NavigationStartingEventHandler, NewWindowRequestedEventHandler,
        WebMessageReceivedEventHandler, WebResourceResponseReceivedEventHandler,
    };
    use windows::{
        core::{Interface, BOOL, HSTRING, PCWSTR, PWSTR},
        Win32::System::{StationsAndDesktops::GetThreadDesktop, Threading::GetCurrentThreadId},
    };

    const FIXTURE_TEST: &str = "core::webview_security::windows_native_admission::windows_hidden_window_enforces_frame_and_command_admission";
    const CHILD_RECEIPT: &str = "GCHAT_WINDOWS_NATIVE_ADMISSION_CHILD_RECEIPT";

    struct NativeInitLogger;

    impl log::Log for NativeInitLogger {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() <= log::Level::Warn
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                // Wry logs a failed native creation but still returns a
                // detached dispatcher. Preserve that error before a later
                // with_webview callback is dropped with a closed channel.
                eprintln!(
                    "GCHAT_WINDOWS_NATIVE_ADMISSION_RUNTIME {}",
                    json!({"level":record.level().as_str(),"target":record.target(),"message":record.args().to_string()})
                );
            }
        }

        fn flush(&self) {}
    }

    static NATIVE_INIT_LOGGER: NativeInitLogger = NativeInitLogger;

    struct FixtureOutcome {
        result: Result<(), String>,
        cleanup: Value,
    }

    /// These paths did not exist before this fixture and have a UUID identifier
    /// as their final component. Never call any product data-folder resolver.
    /// The parent removes them after the fixture process exits: WebView2 keeps
    /// its user-data folder open until its host process is gone.
    struct PrivateData {
        paths: Vec<PathBuf>,
        identifier: String,
    }

    impl PrivateData {
        fn new(identifier: &str) -> Result<Self, String> {
            let data = Self::owned(identifier)?;
            for path in &data.paths {
                if path.exists() {
                    return Err(format!(
                        "Refusing existing fixture data: {}",
                        path.display()
                    ));
                }
            }
            Ok(data)
        }

        fn owned(identifier: &str) -> Result<Self, String> {
            identifier
                .strip_prefix("app.gchat.windows-native-admission.")
                .filter(|uuid| uuid.len() == 32 && uuid.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("Invalid private fixture identifier")?;
            let mut paths = vec![
                dirs::data_local_dir()
                    .ok_or("No Windows local data directory")?
                    .join(identifier),
                dirs::cache_dir()
                    .ok_or("No Windows cache directory")?
                    .join(identifier),
            ];
            paths.sort();
            paths.dedup();
            Ok(Self {
                paths,
                identifier: identifier.into(),
            })
        }

        fn cleanup(&self) -> Result<(), String> {
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let mut errors = Vec::new();
                for path in &self.paths {
                    if path.file_name().and_then(|v| v.to_str()) != Some(&self.identifier) {
                        return Err("Private-data ownership check failed".into());
                    }
                    match std::fs::remove_dir_all(path) {
                        Ok(()) => (),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                        Err(error) => errors.push(format!("{}: {error}", path.display())),
                    }
                }
                if errors.is_empty() {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err(errors.join("; "));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    struct FixtureAssets {
        html: Vec<u8>,
        script: Vec<u8>,
    }

    impl tauri::Assets<tauri::Wry> for FixtureAssets {
        fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
            match key.as_ref() {
                "/probe.js" => Some(Cow::Borrowed(&self.script)),
                "/" | "/index.html" | "/logs" => Some(Cow::Borrowed(&self.html)),
                _ => None,
            }
        }

        fn iter(&self) -> Box<AssetsIter<'_>> {
            Box::new(
                [
                    (
                        Cow::Borrowed("/index.html"),
                        Cow::Borrowed(self.html.as_slice()),
                    ),
                    (
                        Cow::Borrowed("/probe.js"),
                        Cow::Borrowed(self.script.as_slice()),
                    ),
                ]
                .into_iter(),
            )
        }

        fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
            Box::new(std::iter::empty())
        }
    }

    #[derive(Default)]
    struct Observations {
        events: Vec<Value>,
        result: Option<Value>,
        app_route: bool,
    }

    fn observe(state: &Arc<Mutex<Observations>>, event: Value) {
        state.lock().unwrap().events.push(event);
    }

    // No bridge shim or parent command relay: these are calls made by the
    // actual sandboxed document, through whatever bridge WebView2 gave it.
    fn preview_html(metadata: &Value) -> String {
        let script = r#"
const m = __METADATA__;
const violations = [];
addEventListener('securitypolicyviolation', e => violations.push({directive:e.effectiveDirective, blocked:e.blockedURI}));
const bounded = p => Promise.race([p, new Promise(r => setTimeout(() => r({kind:'timeout'}), 4000))]);
async function invoke(command, payload) {
  try {
    return await bounded(window.__TAURI_INTERNALS__.invoke(command, payload).then(
      value => ({kind:'success',value}),
      error => { const text=String(error); return {kind: /not allowed|not permitted|denied.*permission|permission.*denied/i.test(text) ? 'native-acl-rejection' : /Origin header is not a valid URL/i.test(text) ? 'invalid-null-origin' : 'other-rejection',error:text}; }
    ));
  } catch(error) {
    return {kind:typeof window.__TAURI_INTERNALS__?.invoke !== 'function' && error instanceof TypeError ? 'missing-bridge' : 'other-rejection',error:String(error)};
  }
}
(async () => {
  let parentAccess;
  try { void parent.document.body; parentAccess='allowed'; } catch(e) { parentAccess=String(e); }
  const app=invoke('join_path',{args:[m.directory,'joined.txt']});
  const plugin=invoke('plugin:os|locale',{});
  const asset=bounded(fetch(m.asset).then(r=>r.text()).then(value=>({kind:'success',value}),error=>({kind:'rejected',error:String(error)})));
  const channels={webview:typeof window.chrome?.webview?.postMessage,ipc:typeof window.ipc?.postMessage};
  const result={app:await app,plugin:await plugin,asset:await asset,parentAccess,violations,channels,bridge:typeof window.__TAURI_INTERNALS__?.invoke,href:location.href};
  parent.postMessage({fixture:m.fixture,type:'preview',result},'*');
})();
"#;
        format!("<!doctype html><meta charset=\"utf-8\"><title>Private preview probe</title><script>{}</script>", script.replace("__METADATA__", &metadata.to_string()))
    }

    fn main_script(metadata: &Value) -> Vec<u8> {
        r#"
const m = __METADATA__;
// A string body keeps Wry's own IPC listener from failing ahead of the observer.
const send = data => window.chrome.webview.postMessage(JSON.stringify({fixture:m.fixture,...data}));
if (location.pathname === '/logs') {
  send({type:'app-route',href:location.href});
} else {
  const bounded = (p,ms=6500) => Promise.race([p,new Promise(r=>setTimeout(()=>r({kind:'timeout'}),ms))]);
  const call = (command,payload) => bounded(window.__TAURI_INTERNALS__.invoke(command,payload).then(value=>({kind:'success',value}),error=>({kind:'rejected',error:String(error)})));
  // Tauri answers postMessage IPC by evaluating runCallback in this top
  // document. Record every answer addressed to a callback this document did
  // not register (the preview's), so a preview call that reached the host is
  // seen with its actual rejection or result.
  const foreign=[];
  const callbacks=window.__TAURI_INTERNALS__.callbacks;
  const ownCallback=Map.prototype.get;
  Object.defineProperty(callbacks,'get',{value(id){return ownCallback.call(this,id)??(data=>{foreign.push({id,data:typeof data==='string'?data:JSON.stringify(data)});});}});
  (async () => {
    const mainApp=await call('join_path',{args:[m.directory,'joined.txt']});
    const mainPlugin=await call('plugin:os|locale',{});
    const mainAsset=await bounded(fetch(m.asset).then(r=>r.text()).then(value=>({kind:'success',value}),error=>({kind:'rejected',error:String(error)})));
    const frame=document.createElement('iframe');
    frame.setAttribute('sandbox','allow-scripts');
    // A hidden page aligns timers to one second; leave the preview's own
    // four-second bounds room to report.
    const preview=bounded(new Promise(resolve=>addEventListener('message',function receipt(e) {
      if(e.source===frame.contentWindow && e.origin==='null' && e.data?.fixture===m.fixture && e.data.type==='preview') {
        removeEventListener('message',receipt); resolve({...e.data.result,eventOrigin:e.origin});
      }
    })),15000);
    frame.src=m.preview; document.body.append(frame);
    const child=await preview;
    // Resource requests use the real native filter. A native observer, rather
    // than an opaque no-cors JS response, verifies every status/header below.
    for(const uri of m.invalidResources) await bounded(fetch(uri,{mode:'no-cors'}).catch(()=>null));
    const blob=URL.createObjectURL(new Blob(['<!doctype html><title>blocked</title>'],{type:'text/html'}));
    const badFrame=document.createElement('iframe'); badFrame.src=blob; document.body.append(badFrame);
    window.open('gchat-preview://localhost/'+m.id,'_blank');
    location.href=m.preview;
    await new Promise(r=>setTimeout(r,250));
    location.href='https://example.invalid/gchat-native-admission';
    await new Promise(r=>setTimeout(r,500));
    send({type:'result',mainApp,mainPlugin,mainAsset,child,foreign});
    URL.revokeObjectURL(blob);
    setTimeout(()=>{location.href='/logs';},200);
  })().catch(error=>send({type:'result',fatal:String(error)}));
}
"#.replace("__METADATA__", &metadata.to_string()).into_bytes()
    }

    fn install_observers(
        window: &WebviewWindow,
        state: Arc<Mutex<Observations>>,
        fixture: String,
    ) -> Result<(), String> {
        let app = window.app_handle().clone();
        let (sent, received) = mpsc::sync_channel(1);
        window.with_webview(move |native| {
            let result = (|| unsafe {
                let view = native.controller().CoreWebView2()?;
                let mut token = 0;
                let messages = state.clone();
                // Wry completes its popup decision asynchronously through a
                // deferral; read each final Handled value on this UI thread
                // when the main document reports its result.
                let popup_requests: Rc<RefCell<Vec<(String, ICoreWebView2NewWindowRequestedEventArgs)>>> = Rc::default();
                let pending_popups = popup_requests.clone();
                view.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut source=PWSTR::null(); args.Source(&mut source)?;
                    let source=take_pwstr(source);
                    let mut text=PWSTR::null();
                    let text=args.TryGetWebMessageAsString(&mut text).ok().map(|()| take_pwstr(text));
                    if !source.starts_with("http://tauri.localhost/") {
                        // A preview IPC fallback reaching the top-level channel.
                        let cmd=text.as_deref().and_then(|t| serde_json::from_str::<Value>(t).ok()).and_then(|v| v["cmd"].as_str().map(str::to_owned));
                        observe(&messages,json!({"kind":"foreign-message","channel":"webview","source":source,"cmd":cmd}));
                        return Ok(());
                    }
                    let Some(text)=text else { return Ok(()) };
                    let Ok(value)=serde_json::from_str::<Value>(&text) else { return Ok(()) };
                    if value["fixture"] != fixture { return Ok(()) }
                    let done = {
                        let mut state=messages.lock().unwrap();
                        state.events.push(json!({"kind":"message","source":source,"value":value}));
                        if value["type"] == "result" {
                            for (uri, request) in pending_popups.borrow_mut().drain(..) {
                                let mut handled=BOOL::default(); request.Handled(&mut handled)?;
                                state.events.push(json!({"kind":"popup","uri":uri,"handled":handled.as_bool()}));
                            }
                            state.result=Some(value);
                        }
                        else if value["type"] == "app-route" { state.app_route=true; }
                        state.result.is_some() && state.app_route
                    };
                    if done { app.exit(0); }
                    Ok(())
                })), &mut token)?;
                for (main_frame, observer) in [(true,state.clone()),(false,state.clone())] {
                    let handler=NavigationStartingEventHandler::create(Box::new(move |_,args| {
                        if let Some(args)=args {
                            let mut uri=PWSTR::null(); args.Uri(&mut uri)?;
                            let mut cancel=BOOL::default(); args.Cancel(&mut cancel)?;
                            observe(&observer,json!({"kind":"navigation","mainFrame":main_frame,"uri":take_pwstr(uri),"cancelled":cancel.as_bool()}));
                        }
                        Ok(())
                    }));
                    if main_frame { view.add_NavigationStarting(&handler,&mut token)?; }
                    else { view.add_FrameNavigationStarting(&handler,&mut token)?; }
                }
                view.add_NewWindowRequested(&NewWindowRequestedEventHandler::create(Box::new(move |_,args| {
                    if let Some(args)=args {
                        let mut uri=PWSTR::null(); args.Uri(&mut uri)?;
                        popup_requests.borrow_mut().push((take_pwstr(uri), args));
                    }
                    Ok(())
                })),&mut token)?;
                // Wry does not listen on frame channels; record any preview
                // IPC fallback delivered there, which no handler executes.
                let frames=state.clone();
                view.cast::<ICoreWebView2_4>()?.add_FrameCreated(&FrameCreatedEventHandler::create(Box::new(move |_,args| {
                    let Some(args)=args else { return Ok(()) };
                    let frame=args.Frame()?.cast::<ICoreWebView2Frame2>()?;
                    let observer=frames.clone();
                    let mut frame_token=0;
                    frame.add_WebMessageReceived(&FrameWebMessageReceivedEventHandler::create(Box::new(move |_,args| {
                        if let Some(args)=args {
                            let mut source=PWSTR::null(); args.Source(&mut source)?;
                            let mut text=PWSTR::null();
                            let cmd=args.TryGetWebMessageAsString(&mut text).ok().map(|()| take_pwstr(text)).and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["cmd"].as_str().map(str::to_owned));
                            observe(&observer,json!({"kind":"foreign-message","channel":"frame","source":take_pwstr(source),"cmd":cmd}));
                        }
                        Ok(())
                    })),&mut frame_token)?;
                    Ok(())
                })),&mut token)?;
                let responses=view.cast::<ICoreWebView2_2>()?;
                responses.add_WebResourceResponseReceived(&WebResourceResponseReceivedEventHandler::create(Box::new(move |_,args| {
                    if let Some(args)=args {
                        let request=args.Request()?;
                        let mut uri=PWSTR::null(); request.Uri(&mut uri)?;
                        let uri=take_pwstr(uri);
                        if Url::parse(&uri).is_ok_and(|u|u.host_str()==Some("gchat-preview.localhost")) {
                            let response=args.Response()?;
                            let mut status=0; response.StatusCode(&mut status)?;
                            let headers=response.Headers()?;
                            let mut csp=PWSTR::null(); headers.GetHeader(&HSTRING::from("Content-Security-Policy"),&mut csp)?;
                            let mut nosniff=PWSTR::null(); headers.GetHeader(&HSTRING::from("X-Content-Type-Options"),&mut nosniff)?;
                            observe(&state,json!({"kind":"response","uri":uri,"status":status,"csp":take_pwstr(csp),"nosniff":take_pwstr(nosniff)}));
                        }
                    }
                    Ok(())
                })),&mut token)?;
                Ok::<_,windows::core::Error>(())
            })().map_err(|error|error.to_string());
            let _=sent.send(result);
        }).map_err(|error|error.to_string())?;
        received.recv().map_err(|error| error.to_string())?
    }

    fn validate(state: &Observations, metadata: &Value, exit: i32) -> Result<(), String> {
        let require = |condition, message: &str| {
            if condition {
                Ok(())
            } else {
                Err(message.to_string())
            }
        };
        require(
            exit == 0,
            "Native event-loop timeout/failure (not a denial PASS)",
        )?;
        require(state.app_route, "Allowed same-origin route did not commit")?;
        let result = state
            .result
            .as_ref()
            .ok_or("No main result (not a denial PASS)")?;
        // join_path resolves its base with canonicalize, which yields the
        // verbatim \\?\ form on Windows.
        let expected_join = metadata["expectedJoin"].as_str().unwrap_or_default();
        require(
            result["mainApp"]["kind"] == "success"
                && result["mainApp"]["value"].as_str().is_some_and(|joined| {
                    joined.strip_prefix(r"\\?\").unwrap_or(joined) == expected_join
                }),
            "Main application invoke did not succeed",
        )?;
        require(
            result["mainPlugin"]["kind"] == "success" && result["mainPlugin"]["value"].is_string(),
            "Main os.locale invoke did not succeed",
        )?;
        require(
            result["mainAsset"]["kind"] == "success"
                && result["mainAsset"]["value"] == metadata["marker"],
            "Main asset marker was not readable",
        )?;
        let child = &result["child"];
        require(
            child["eventOrigin"] == "null",
            "Preview did not report from its opaque sandbox",
        )?;
        // Host answers addressed to the preview's callbacks, captured in the
        // containing document: every one must be a rejection.
        let rejection = |text: &str| {
            let text = text.to_ascii_lowercase();
            [
                "not allowed",
                "not permitted",
                "denied",
                "permission",
                "origin header",
            ]
            .iter()
            .any(|phrase| text.contains(phrase))
        };
        let foreign = result["foreign"]
            .as_array()
            .ok_or("Missing foreign callback record")?;
        require(
            foreign
                .iter()
                .all(|answer| answer["data"].as_str().is_some_and(rejection)),
            &format!("A preview call received a non-rejection host answer: {foreign:?}"),
        )?;
        let reached_host = state
            .events
            .iter()
            .filter(|e| e["kind"] == "foreign-message" && e["channel"] == "webview")
            .count();
        require(
            foreign.len() >= reached_host,
            "A preview call reached the host without an observed rejection",
        )?;
        let ipc_blocked = child["violations"].as_array().is_some_and(|v| {
            v.iter().any(|e| {
                e["directive"] == "connect-src"
                    && e["blocked"]
                        .as_str()
                        .is_some_and(|uri| uri.starts_with("http://ipc.localhost"))
            })
        });
        for command in ["app", "plugin"] {
            let outcome = &child[command];
            let explicit = outcome["kind"] == "native-acl-rejection"
                || outcome["kind"] == "invalid-null-origin"
                || (outcome["kind"] == "missing-bridge"
                    && outcome["error"]
                        .as_str()
                        .is_some_and(|error| error.starts_with("TypeError:")));
            // The preview's own promise can stay unsettled: CSP blocks the
            // IPC protocol and Tauri answers any postMessage fallback in the
            // containing document. That counts only with the CSP block and
            // the host-side record above.
            let unanswered = outcome["kind"] == "timeout" && ipc_blocked;
            require(explicit || unanswered, &format!("Preview {command} lacks an observed invoke rejection or a CSP-blocked IPC call with no executed host answer: {outcome}"))?;
        }
        require(
            child["asset"]["kind"] == "rejected",
            "Preview asset fetch was not rejected",
        )?;
        require(
            child["violations"]
                .as_array()
                .is_some_and(|v| v.iter().any(|e| e["directive"] == "connect-src")),
            "Preview asset rejection lacks actual connect-src CSP evidence",
        )?;
        require(
            child["parentAccess"]
                .as_str()
                .is_some_and(|s| s.contains("SecurityError")),
            "Sandbox preview accessed parent document",
        )?;
        let events = &state.events;
        for uri in metadata["invalidResources"]
            .as_array()
            .ok_or("Missing resource expectations")?
        {
            require(
                events.iter().any(|e| {
                    e["kind"] == "response"
                        && e["uri"] == *uri
                        && e["status"] == 404
                        && e["nosniff"] == "nosniff"
                        && e["csp"] == super::super::artifact::PREVIEW_CONTENT_SECURITY_POLICY
                }),
                &format!("Reserved request lacks native local 404/CSP/no-sniff response: {uri}"),
            )?;
        }
        require(
            events.iter().any(|e| {
                e["kind"] == "response" && e["uri"] == metadata["preview"] && e["status"] == 200
            }),
            "Valid preview did not receive native 200",
        )?;
        for uri in [
            metadata["preview"].as_str().unwrap(),
            "https://example.invalid/gchat-native-admission",
        ] {
            require(
                events.iter().any(|e| {
                    e["kind"] == "navigation"
                        && e["mainFrame"] == true
                        && e["uri"] == uri
                        && e["cancelled"] == true
                }),
                &format!("Top navigation lacks actual native cancellation: {uri}"),
            )?;
        }
        require(
            events.iter().any(|e| {
                e["kind"] == "navigation"
                    && e["mainFrame"] == false
                    && e["uri"].as_str().is_some_and(|s| s.starts_with("blob:"))
                    && e["cancelled"] == true
            }),
            "Inherited-origin Blob frame lacks native cancellation",
        )?;
        require(
            events
                .iter()
                .any(|e| e["kind"] == "popup" && e["handled"] == true),
            "Native popup was not denied",
        )
    }

    fn run_fixture() -> Result<FixtureOutcome, String> {
        log::set_logger(&NATIVE_INIT_LOGGER)
            .map_err(|e| format!("Could not capture native initialization errors: {e}"))?;
        log::set_max_level(log::LevelFilter::Warn);
        let uuid = uuid::Uuid::new_v4().simple().to_string();
        let identifier = format!("app.gchat.windows-native-admission.{uuid}");
        PrivateData::new(&identifier)?;
        // Name the browser data before WebView2 creates it, so the parent can
        // remove it even if this process stops early.
        if let Some(receipt) = std::env::var_os(CHILD_RECEIPT) {
            std::fs::write(receipt, json!({"identifier":identifier}).to_string())
                .map_err(|e| format!("Could not write fixture receipt: {e}"))?;
        }
        let root = fixture_root()?;
        let temp = tempfile::Builder::new()
            .prefix("gchat-native-admission-")
            .tempdir_in(&root)
            .map_err(|e| e.to_string())?;
        let marker = "gchat-private-asset-marker";
        let marker_path = temp.path().join("asset-marker.txt");
        std::fs::write(&marker_path, marker).map_err(|e| e.to_string())?;
        let id = format!("windows-native-{uuid}");
        let preview = format!("http://gchat-preview.localhost/{id}");
        let encoded: String =
            url::form_urlencoded::byte_serialize(marker_path.to_string_lossy().as_bytes())
                .collect();
        // encodeURIComponent semantics for a native absolute Windows path
        // (form_urlencoded differs only for space, absent in the UUID child).
        let asset = format!("http://asset.localhost/{}", encoded.replace('+', "%20"));
        let metadata = json!({"fixture":uuid,"id":id,"directory":temp.path(),"expectedJoin":temp.path().join("joined.txt"),"asset":asset,"marker":marker,"preview":preview,"invalidResources":[
            format!("https://gchat-preview.localhost/{id}"),
            format!("http://gchat-preview.localhost:43121/{id}"),
            "http://gchat-preview.localhost/missing",
            format!("http://gchat-preview.localhost/{id}?query=1"),
            "http://gchat-preview.localhost/%2Foutside"
        ]});
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        context.config_mut().identifier = identifier.clone();
        context.config_mut().app.windows.clear();
        context.config_mut().build.dev_url = None;
        context.config_mut().build.frontend_dist = None;
        // Deliberately retain the generated real capabilities and CSP.
        context.set_assets(Box::new(FixtureAssets {
            html:b"<!doctype html><meta charset=\"utf-8\"><title>Private native admission fixture</title><script src=\"/probe.js\" defer></script><body></body>".to_vec(),
            script:main_script(&metadata),
        }));
        let app = tauri::Builder::default()
            .any_thread()
            .plugin(tauri_plugin_os::init())
            .invoke_handler(tauri::generate_handler![
                crate::core::filesystem::commands::join_path
            ])
            .build(context)
            .map_err(|e| e.to_string())?;
        let run_result = (|| {
            super::super::artifact::set_artifact_html(
                app.handle().clone(),
                id,
                preview_html(&metadata),
            )?;
            let rejected = tauri::utils::config::WindowConfig {
                label: "rejected-native-fixture".into(),
                url: tauri::WebviewUrl::External(Url::parse("https://example.invalid/").unwrap()),
                ..Default::default()
            };
            if build_window(app.handle(), &rejected).is_ok() {
                return Err("Initial foreign URL was accepted".to_string());
            }
            let config = tauri::utils::config::WindowConfig {
                label: "main".into(),
                title: "Private GChat native admission".into(),
                // Hidden and unfocused: nothing appears on, or takes input
                // from, the host desktop.
                visible: false,
                focus: false,
                data_directory: None,
                ..Default::default()
            };
            let window = build_window(app.handle(), &config)
                .map_err(|e| format!("Protected main webview creation failed: {e}"))?;
            let state = Arc::new(Mutex::new(Observations::default()));
            install_observers(&window, state.clone(), uuid)
                .map_err(|e| format!("Native observer installation failed: {e}"))?;
            window
                .navigate(Url::parse("http://tauri.localhost/").unwrap())
                .map_err(|e| e.to_string())?;
            drop(window);
            let (finished, wait) = mpsc::channel();
            let watchdog_app = app.handle().clone();
            let timed_out = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let watchdog_fired = timed_out.clone();
            let watchdog = std::thread::spawn(move || {
                if wait.recv_timeout(Duration::from_secs(40)).is_err() {
                    watchdog_fired.store(true, std::sync::atomic::Ordering::Release);
                    watchdog_app.exit(124);
                }
            });
            let exit = app.run_return(|_, _| {});
            let _ = finished.send(());
            let _ = watchdog.join();
            // The event loop can report 0 after a requested exit; a watchdog
            // stop is never a completed run.
            let watchdog = timed_out.load(std::sync::atomic::Ordering::Acquire);
            let exit = if watchdog { 124 } else { exit };
            let state = state.lock().unwrap();
            let result = validate(&state, &metadata, exit);
            println!(
                "GCHAT_WINDOWS_NATIVE_ADMISSION {}",
                json!({"metadata":metadata,"exit":exit,"watchdog":watchdog,"events":state.events,"result":state.result,"validation":result.as_ref().err(),"productSetup":false,"credentialManager":false})
            );
            result
        })();
        // Cleanup is mandatory even for failed evidence. The explicit owned
        // input root is removed here; the parent removes the browser/cache
        // UUID children once this process and its WebView2 processes exit.
        let input_cleanup = temp.close().map_err(|e| e.to_string());
        Ok(FixtureOutcome {
            cleanup: json!({"identifier":identifier,"inputs":input_cleanup.as_ref().err()}),
            result: run_result.and(input_cleanup),
        })
    }

    fn current_desktop() -> String {
        use windows::Win32::{
            Foundation::HANDLE,
            System::StationsAndDesktops::{GetUserObjectInformationW, UOI_NAME},
        };
        let mut name = [0u16; 256];
        let mut needed = 0;
        let read = unsafe {
            GetThreadDesktop(GetCurrentThreadId()).and_then(|desktop| {
                GetUserObjectInformationW(
                    HANDLE(desktop.0),
                    UOI_NAME,
                    Some(name.as_mut_ptr().cast()),
                    (name.len() * 2) as u32,
                    Some(&mut needed),
                )
            })
        };
        match read {
            Ok(()) => String::from_utf16_lossy(
                &name[..name.iter().position(|&c| c == 0).unwrap_or(name.len())],
            ),
            Err(error) => format!("unknown: {error}"),
        }
    }

    fn fixture_root() -> Result<PathBuf, String> {
        let root = std::env::var_os("GCHAT_WINDOWS_NATIVE_ADMISSION_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        if !root.is_absolute() || !root.is_dir() {
            return Err("Fixture root must be an existing absolute owned directory".into());
        }
        Ok(root)
    }

    /// Run this test binary again as the fixture process. WebView2 keeps its
    /// UUID user-data folder open until that process exits, so the parent
    /// removes it afterwards. A private Win32 desktop cannot host WebView2:
    /// the pinned runtime starts its browser process through explorer.exe on
    /// the default desktop (observed on the laptop, 0x80070578), so the
    /// fixture window stays hidden and unfocused instead.
    fn run_fixture_process(receipt: &std::path::Path) -> Result<u32, String> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::{
                CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0,
            },
            System::Threading::{
                CreateProcessW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
                PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
            },
        };
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut command: Vec<u16> = format!(
            "\"{}\" --ignored --exact {FIXTURE_TEST} --nocapture --test-threads=1",
            exe.display()
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();
        let stdout = HANDLE(std::io::stdout().as_raw_handle());
        let stderr = HANDLE(std::io::stderr().as_raw_handle());
        for handle in [stdout, stderr] {
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
                .map_err(|e| format!("Could not share fixture output: {e}"))?;
        }
        let startup = STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdOutput: stdout,
            hStdError: stderr,
            ..Default::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        std::env::set_var(CHILD_RECEIPT, receipt);
        let created = unsafe {
            CreateProcessW(
                PCWSTR::null(),
                Some(PWSTR(command.as_mut_ptr())),
                None,
                None,
                true,
                PROCESS_CREATION_FLAGS(0),
                None,
                PCWSTR::null(),
                &startup,
                &mut process,
            )
        };
        std::env::remove_var(CHILD_RECEIPT);
        created.map_err(|e| format!("Could not start fixture process: {e}"))?;
        unsafe {
            let _ = CloseHandle(process.hThread);
            let waited = WaitForSingleObject(process.hProcess, 90_000);
            if waited != WAIT_OBJECT_0 {
                let _ = TerminateProcess(process.hProcess, 124);
                let _ = WaitForSingleObject(process.hProcess, 15_000);
            }
            let mut exit = 0;
            let code = GetExitCodeProcess(process.hProcess, &mut exit)
                .map(|()| exit)
                .map_err(|e| e.to_string());
            let _ = CloseHandle(process.hProcess);
            if waited != WAIT_OBJECT_0 {
                return Err("Fixture process timed out".into());
            }
            code
        }
    }

    #[test]
    #[ignore = "Requires an explicitly booked Windows host; opens one hidden unfocused window and removes UUID browser data"]
    fn windows_hidden_window_enforces_frame_and_command_admission() {
        if let Some(receipt) = std::env::var_os(CHILD_RECEIPT) {
            // Child: the fixture process. An early failure keeps the
            // identifier-only receipt for the parent's cleanup.
            eprintln!(
                "GCHAT_WINDOWS_NATIVE_ADMISSION_DESKTOP {}",
                current_desktop()
            );
            let outcome = run_fixture().unwrap_or_else(|error| panic!("{error}"));
            std::fs::write(receipt, outcome.cleanup.to_string())
                .expect("Could not write fixture cleanup receipt");
            assert!(outcome.result.is_ok(), "{}", outcome.result.unwrap_err());
            return;
        }
        let root = fixture_root().expect("Invalid fixture root");
        let uuid = uuid::Uuid::new_v4().simple().to_string();
        let receipt = root.join(format!("gchat-native-admission-receipt-{uuid}.json"));
        assert!(!receipt.exists(), "Refusing existing fixture receipt");
        let child = run_fixture_process(&receipt);
        let receipt_value = std::fs::read_to_string(&receipt)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let receipt_cleanup = match std::fs::remove_file(&receipt) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        };
        let private = receipt_value
            .as_ref()
            .and_then(|value| value["identifier"].as_str())
            .ok_or_else(|| "Fixture process exited before naming its browser data".to_string())
            .and_then(PrivateData::owned);
        let data_cleanup = private
            .as_ref()
            .map_err(Clone::clone)
            .and_then(PrivateData::cleanup);
        let inputs = match receipt_value {
            Some(value) if value.get("inputs").is_some() => value["inputs"].clone(),
            _ => json!("fixture exited before cleanup receipt"),
        };
        let cleanup = json!({"privateData":data_cleanup.as_ref().err(),"inputs":inputs,"paths":private.as_ref().map(|p| p.paths.clone()).unwrap_or_default()});
        println!("GCHAT_WINDOWS_NATIVE_ADMISSION_CLEANUP {cleanup}");
        let result = child
            .and_then(|exit| match exit {
                0 => Ok(()),
                exit => Err(format!("Fixture process failed with exit {exit}")),
            })
            .and(data_cleanup)
            .and(receipt_cleanup);
        assert!(result.is_ok(), "{}", result.unwrap_err());
    }
}
