//! Serve preview documents through native handlers, outside Tauri's protocol
//! registry. Tauri must continue to classify these documents as remote origins.
use std::path::{Path, PathBuf};

use tauri::http::Response;
use url::Url;

fn not_found(cache_directory: &Path) -> Response<Vec<u8>> {
    // The shared responder rejects this origin before consulting the cache and
    // supplies the same restrictive headers as every other preview response.
    let rejected = Url::parse("about:blank").expect("fixed rejected preview URL");
    super::artifact::serve_cached_preview(cache_directory, &rejected)
}

fn response_for_request(cache_directory: &Path, uri: &str, method: &str) -> Response<Vec<u8>> {
    match Url::parse(uri) {
        Ok(url) if method == "GET" => super::artifact::serve_cached_preview(cache_directory, &url),
        _ => not_found(cache_directory),
    }
}

#[cfg(any(target_os = "windows", test))]
fn is_windows_preview_request(url: &Url) -> bool {
    // Match the reserved host even for invalid schemes, ports, credentials or
    // paths. Those requests get a local 404, never a network fallback.
    url.host_str() == Some("gchat-preview.localhost")
}

/// Install before the first application navigation, from `with_webview` on the
/// native UI thread. A failure must destroy the still-blank webview.
#[cfg(target_os = "linux")]
pub fn install(
    platform: &tauri::webview::PlatformWebview,
    cache_directory: PathBuf,
) -> Result<(), String> {
    use std::cell::RefCell;

    use soup3::{MessageHeaders, MessageHeadersType};
    use webkit2gtk::{
        gio::MemoryInputStream, glib::Bytes, SecurityManagerExt, URISchemeRequestExt,
        URISchemeResponse, URISchemeResponseExt, WebContext, WebContextExt, WebViewExt,
    };

    thread_local! {
        // WebKit shares a context across application windows and permits only
        // one handler per scheme/context. Retaining the context also prevents
        // a destroyed context's identity from being reused by a new one.
        static CONTEXTS: RefCell<Vec<(WebContext, PathBuf)>> = const { RefCell::new(Vec::new()) };
    }

    let context = platform
        .inner()
        .context()
        .ok_or_else(|| "Preview webview has no WebKit context".to_string())?;
    CONTEXTS.with(|contexts| {
        let mut contexts = contexts.borrow_mut();
        if let Some((_, installed_cache)) = contexts
            .iter()
            .find(|(installed_context, _)| installed_context == &context)
        {
            return if installed_cache == &cache_directory {
                Ok(())
            } else {
                Err("Preview context is already bound to another cache".to_string())
            };
        }
        // Secure avoids mixed-content blocking. Do not mark the scheme local
        // or add it to Tauri/Wry's custom-protocol registry.
        context
            .security_manager()
            .ok_or_else(|| "Preview WebKit context has no security manager".to_string())?
            .register_uri_scheme_as_secure("gchat-preview");
        let request_cache = cache_directory.clone();
        context.register_uri_scheme("gchat-preview", move |request| {
            let uri = request.uri();
            let method = request.http_method();
            let response = response_for_request(
                &request_cache,
                uri.as_deref().unwrap_or_default(),
                // WebKit may omit the method for a scheme load; Wry's own
                // scheme adapter likewise keeps the request's default GET.
                method.as_deref().unwrap_or("GET"),
            );
            let (parts, body) = response.into_parts();
            let body_length = body.len() as i64;
            let stream = MemoryInputStream::from_bytes(&Bytes::from_owned(body));
            let native = URISchemeResponse::new(&stream, body_length);
            native.set_status(parts.status.as_u16() as u32, None);
            if let Some(content_type) = parts
                .headers
                .get(tauri::http::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
            {
                native.set_content_type(content_type);
            }
            let headers = MessageHeaders::new(MessageHeadersType::Response);
            for (name, value) in &parts.headers {
                if let Ok(value) = value.to_str() {
                    headers.append(name.as_str(), value);
                }
            }
            native.set_http_headers(headers);
            request.finish_with_response(&native);
        });
        contexts.push((context, cache_directory));
        Ok(())
    })
}

#[cfg(target_os = "windows")]
pub fn install(
    platform: &tauri::webview::PlatformWebview,
    cache_directory: PathBuf,
) -> Result<(), String> {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        },
        WebResourceRequestedEventHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};

    unsafe {
        let view = platform
            .controller()
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        // Requiring the source-kind-aware API covers iframe and worker
        // requests too. Older runtimes fail installation before navigation.
        let filtered_view = view
            .cast::<ICoreWebView2_22>()
            .map_err(|error| error.to_string())?;
        let environment = platform.environment();
        let missing = windows_response(&environment, not_found(&cache_directory))
            .map_err(|error| error.to_string())?;
        let mut token = 0;
        view.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
                let result = (|| {
                    let args = args.ok_or_else(windows::core::Error::from_win32)?;
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    let url = Url::parse(&uri).map_err(|_| {
                        windows::core::Error::new(
                            windows::core::HRESULT(0x80070057_u32 as i32),
                            "Invalid resource URL",
                        )
                    })?;
                    if !is_windows_preview_request(&url) {
                        return Ok(());
                    }
                    // Establish a closed response before any file access.
                    // Even a missing/invalid cache entry stays intercepted.
                    args.SetResponse(&missing)?;
                    let mut method = PWSTR::null();
                    request.Method(&mut method)?;
                    let response =
                        response_for_request(&cache_directory, &uri, &take_pwstr(method));
                    args.SetResponse(&windows_response(&environment, response)?)
                })();
                if result.is_err() {
                    // A callback/COM failure must not release this request to
                    // the network with an unset response.
                    if let Some(sender) = sender {
                        let _ = sender.Stop();
                    }
                }
                result
            })),
            &mut token,
        )
        .map_err(|error| error.to_string())?;
        // Inspect all URLs so explicit ports or another scheme at the reserved
        // host cannot evade interception. Other hosts are left untouched.
        filtered_view
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn windows_response(
    environment: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
    response: Response<Vec<u8>>,
) -> windows::core::Result<
    webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceResponse,
> {
    use std::fmt::Write;

    use windows::{core::HSTRING, Win32::UI::Shell::SHCreateMemStream};

    let (parts, body) = response.into_parts();
    let mut headers = String::new();
    for (name, value) in &parts.headers {
        let value = value.to_str().map_err(|_| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80070057_u32 as i32),
                "Invalid preview response header",
            )
        })?;
        let _ = write!(headers, "{}: {}\r\n", name.as_str(), value);
    }
    let stream = if body.is_empty() {
        None
    } else {
        Some(SHCreateMemStream(Some(&body)).ok_or_else(windows::core::Error::from_win32)?)
    };
    environment.CreateWebResourceResponse(
        stream.as_ref(),
        parts.status.as_u16() as i32,
        &HSTRING::from(
            parts
                .status
                .canonical_reason()
                .unwrap_or("Preview response"),
        ),
        &HSTRING::from(headers),
    )
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn install(
    _platform: &tauri::webview::PlatformWebview,
    _cache_directory: PathBuf,
) -> Result<(), String> {
    Err("Native preview handling is unsupported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_windows_host_never_falls_through_for_invalid_preview_urls() {
        for uri in [
            "http://gchat-preview.localhost/preview-1",
            "http://gchat-preview.localhost:8080/outside/cache",
            "https://gchat-preview.localhost/preview-1",
            "http://user@gchat-preview.localhost/preview-1",
            "http://gchat-preview.localhost/%2e%2e/secret",
        ] {
            assert!(
                is_windows_preview_request(&Url::parse(uri).unwrap()),
                "{uri}"
            );
        }
        for uri in [
            "http://gchat-preview.localhost.example/preview-1",
            "http://example.test/gchat-preview.localhost/preview-1",
            "http://tauri.localhost/preview-1",
        ] {
            assert!(
                !is_windows_preview_request(&Url::parse(uri).unwrap()),
                "{uri}"
            );
        }
    }

    #[test]
    fn malformed_and_non_get_requests_keep_closed_preview_headers() {
        let cache = tempfile::tempdir().unwrap();
        std::fs::write(cache.path().join("preview-1.html"), b"<p>Preview</p>").unwrap();
        for uri in [
            "gchat-preview://localhost/preview-1",
            "http://gchat-preview.localhost/preview-1",
        ] {
            let response = response_for_request(cache.path(), uri, "GET");
            assert_eq!(response.status(), tauri::http::StatusCode::OK);
            assert_eq!(response.body(), b"<p>Preview</p>");
            assert_eq!(
                response.headers()["content-security-policy"],
                super::super::artifact::PREVIEW_CONTENT_SECURITY_POLICY
            );
        }
        for (uri, method) in [
            ("not a URL", "GET"),
            ("gchat-preview://localhost/preview-1", "POST"),
            ("http://gchat-preview.localhost/outside/cache", "GET"),
        ] {
            let response = response_for_request(cache.path(), uri, method);
            assert_eq!(response.status(), tauri::http::StatusCode::NOT_FOUND);
            assert_eq!(response.body(), b"Preview not found");
            assert_eq!(
                response.headers()["content-security-policy"],
                super::super::artifact::PREVIEW_CONTENT_SECURITY_POLICY
            );
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        }
    }
}
