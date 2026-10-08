//! GChat stores session references; OpenCode owns every Code transcript.
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Mutex, OnceLock},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

use super::threads::{file_store, helpers::get_lock_for_thread, utils};

#[derive(Clone)]
pub struct CodeRuntime {
    pub terminal_id: String,
    pub directory: String,
    pub port: u16,
    pub password: String,
    pub executable: Option<String>,
}

static RUNTIMES: OnceLock<Mutex<HashMap<String, CodeRuntime>>> = OnceLock::new();
static CALLERS: OnceLock<Mutex<HashMap<(String, String), String>>> = OnceLock::new();
fn runtimes() -> &'static Mutex<HashMap<String, CodeRuntime>> {
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn callers() -> &'static Mutex<HashMap<(String, String), String>> {
    CALLERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Runtime-only ancestry, established through OpenCode's public session API.
/// The bridge independently checks the resulting persisted root and its policy.
pub fn caller_origin(bridge_id: &str, caller_sid: &str) -> Result<String, String> {
    validate_session_id(&json!({"id":caller_sid}))?;
    if !runtimes()
        .lock()
        .map_err(|_| "Code runtime registry unavailable")?
        .contains_key(bridge_id)
    {
        return Err("This Code runtime has closed".into());
    }
    Ok(callers()
        .lock()
        .map_err(|_| "Code caller registry unavailable")?
        .get(&(bridge_id.into(), caller_sid.into()))
        .cloned()
        .unwrap_or_else(|| format!("code-{caller_sid}")))
}

pub fn register_runtime(bridge_id: &str, runtime: CodeRuntime) -> Result<(), String> {
    let mut registry = runtimes()
        .lock()
        .map_err(|_| "Code runtime registry unavailable")?;
    if registry
        .iter()
        .any(|(id, existing)| id != bridge_id && existing.directory == runtime.directory)
    {
        return Err("This Code workspace already has a live runtime".into());
    }
    registry.insert(bridge_id.into(), runtime);
    Ok(())
}

pub fn close_runtime(bridge_id: &str) {
    if let Ok(mut runtimes) = runtimes().lock() {
        runtimes.remove(bridge_id);
    }
    if let Ok(mut callers) = callers().lock() {
        callers.retain(|(bridge, _), _| bridge != bridge_id);
    }
}

fn runtime_for_terminal(terminal_id: &str) -> Result<CodeRuntime, String> {
    runtimes()
        .lock()
        .map_err(|_| "Code runtime registry unavailable")?
        .values()
        .find(|runtime| runtime.terminal_id == terminal_id)
        .cloned()
        .ok_or_else(|| "This Code workspace is not running".into())
}

fn validate_session_id(info: &Value) -> Result<&str, String> {
    let id = info
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing OpenCode session ID")?;
    if !id.starts_with("ses") || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        return Err("Invalid OpenCode session ID".into());
    }
    Ok(id)
}

pub fn code_reference(thread: &Value) -> Option<&Value> {
    let metadata = thread.get("metadata")?;
    (metadata.get("runtime").and_then(Value::as_str) == Some("code"))
        .then(|| metadata.get("code"))
        .flatten()
}

fn read_thread(data: &Path, id: &str) -> Result<Option<Value>, String> {
    let path = utils::get_thread_metadata_path(data, id);
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_reference(data: &Path, id: &str) -> Result<Option<Value>, String> {
    Ok(read_thread(data, id)?.filter(|thread| code_reference(thread).is_some()))
}

/// Frontend writes own labels, favorites and project assignment. Retain the
/// latest upstream reference when its snapshot predates a plugin update.
pub fn merge_reference_update(data: &Path, mut thread: Value) -> Result<Value, String> {
    let id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing thread id")?;
    if let Some(current) = get_reference(data, id)? {
        let incoming_code_title = code_reference(&thread)
            .and_then(|code| code.get("title"))
            .and_then(Value::as_str);
        let incoming_title = thread.get("title").and_then(Value::as_str);
        if incoming_title == incoming_code_title {
            // Favoriting or assigning a project from a stale frontend snapshot
            // must not turn its old automatic title into a custom label.
            thread["title"] = current["title"].clone();
        }
        thread["metadata"]["runtime"] = json!("code");
        thread["metadata"]["code"] = current["metadata"]["code"].clone();
        let updated = current
            .get("updated")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(thread.get("updated").and_then(Value::as_f64).unwrap_or(0.0));
        thread["updated"] = json!(updated);
    }
    Ok(thread)
}

fn write_reference(
    data: &Path,
    info: &Value,
    directory: &str,
    executable: Option<&str>,
) -> Result<Value, String> {
    let id = format!("code-{}", validate_session_id(info)?);
    let mut thread = read_thread(data, &id)?.unwrap_or_else(|| json!({"id":id,"metadata":{}}));
    let title = info
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Coding session");
    let previous_title = code_reference(&thread)
        .and_then(|code| code.get("title"))
        .and_then(Value::as_str);
    // A GChat rename is a history label. Keep it across OpenCode title updates.
    let renamed =
        previous_title.is_some() && thread.get("title").and_then(Value::as_str) != previous_title;
    if !renamed {
        thread["title"] = json!(title);
    }
    let updated = info
        .pointer("/time/updated")
        .and_then(Value::as_u64)
        .unwrap_or(0) as f64
        / 1000.0;
    let existing_updated = thread.get("updated").and_then(Value::as_f64).unwrap_or(0.0);
    thread["updated"] = json!(updated.max(existing_updated));
    thread["metadata"]["runtime"] = json!("code");
    thread["metadata"]["code"] = json!({
        "session_id":validate_session_id(info)?, "directory":directory, "title":title,
        "executable":executable,
    });
    utils::ensure_thread_dir_exists(data, &id)?;
    super::agent::storage::atomic_write(
        &utils::get_thread_metadata_path(data, &id),
        &serde_json::to_vec_pretty(&thread).map_err(|error| error.to_string())?,
        "Code session reference",
    )?;
    Ok(thread)
}

pub async fn record_event<R: Runtime>(
    app: &AppHandle<R>,
    project: &Path,
    bridge_id: &str,
    event: Value,
) -> Result<Value, String> {
    let runtime = runtimes()
        .lock()
        .map_err(|_| "Code runtime registry unavailable")?
        .get(bridge_id)
        .cloned()
        .ok_or("This Code runtime has closed")?;
    let reported_info = event
        .get("info")
        .ok_or("Missing OpenCode session information")?;
    let kind = event
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("updated");
    let caller_sid = validate_session_id(reported_info)?.to_owned();
    let ancestry = if kind == "caller" {
        Some(verify_caller_ancestry(&runtime, project, &event).await?)
    } else {
        check_workspace(reported_info, project)?;
        if reported_info
            .get("parentID")
            .and_then(Value::as_str)
            .is_some()
        {
            return Err("Child Code sessions are owned by their saved parent".into());
        }
        None
    };
    let info = ancestry
        .as_ref()
        .and_then(|chain| chain.last())
        .unwrap_or(reported_info);
    let id = format!("code-{}", validate_session_id(info)?);
    let lock = get_lock_for_thread(&id).await;
    let _guard = lock.lock().await;
    let data = super::app::commands::get_jan_data_folder_path(app.clone());
    let payload = if kind == "deleted" {
        file_store::delete_thread(&data, &id)?;
        json!({"kind":"deleted","threadId":id,"terminalId":runtime.terminal_id})
    } else {
        let thread = write_reference(
            &data,
            info,
            &runtime.directory,
            runtime.executable.as_deref(),
        )?;
        json!({"kind":if kind == "caller" { "updated" } else { kind },"thread":thread,"terminalId":runtime.terminal_id})
    };
    drop(_guard);
    if let Some(chain) = ancestry {
        let mut callers = callers()
            .lock()
            .map_err(|_| "Code caller registry unavailable")?;
        for session in chain {
            callers.insert(
                (bridge_id.into(), validate_session_id(&session)?.into()),
                id.clone(),
            );
        }
    }
    app.emit("gchat:code-session", &payload)
        .map_err(|error| error.to_string())?;
    if kind == "caller" {
        super::code_bridge::wait_origin_policy(bridge_id, &caller_sid).await?;
    }
    Ok(payload)
}

fn check_workspace(info: &Value, project: &Path) -> Result<(), String> {
    let directory = info
        .get("directory")
        .and_then(Value::as_str)
        .ok_or("Missing Code workspace")?;
    let canonical = Path::new(directory)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if canonical != project {
        return Err("Code session belongs to a different workspace".into());
    }
    Ok(())
}

fn check_ancestry(chain: &[Value], project: &Path) -> Result<(), String> {
    let mut seen = HashSet::new();
    for (index, info) in chain.iter().enumerate() {
        let id = validate_session_id(info)?;
        if !seen.insert(id) {
            return Err("Cyclic Code session ancestry".into());
        }
        check_workspace(info, project)?;
        let parent = info.get("parentID").and_then(Value::as_str);
        let next = chain.get(index + 1).map(validate_session_id).transpose()?;
        if parent != next {
            return Err("Incomplete Code session ancestry".into());
        }
    }
    if chain.is_empty() {
        return Err("Missing Code caller ancestry".into());
    }
    Ok(())
}

async fn verify_caller_ancestry(
    runtime: &CodeRuntime,
    project: &Path,
    event: &Value,
) -> Result<Vec<Value>, String> {
    let mut reported = vec![event.get("info").ok_or("Missing Code caller")?.clone()];
    reported.extend(
        event
            .get("parents")
            .and_then(Value::as_array)
            .ok_or("Missing Code caller ancestry")?
            .iter()
            .cloned(),
    );
    check_ancestry(&reported, project)?;
    let mut verified = Vec::with_capacity(reported.len());
    for info in reported {
        let sid = validate_session_id(&info)?;
        let actual = request(
            runtime,
            reqwest::Method::GET,
            &format!("/session/{sid}"),
            None,
        )
        .await?;
        if validate_session_id(&actual)? != sid {
            return Err("Code caller session changed".into());
        }
        verified.push(actual);
    }
    check_ancestry(&verified, project)?;
    Ok(verified)
}

async fn request(
    runtime: &CodeRuntime,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:{}{path}", runtime.port))
        .basic_auth("opencode", Some(&runtime.password))
        .query(&[("directory", &runtime.directory)]);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not contact Code: {error}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenCode returned {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|error| format!("Invalid OpenCode response: {error}"))
}

#[tauri::command]
pub async fn code_session_select(terminal_id: String, session_id: String) -> Result<(), String> {
    validate_session_id(&json!({"id":session_id.clone()}))?;
    let runtime = runtime_for_terminal(&terminal_id)?;
    let info = request(
        &runtime,
        reqwest::Method::GET,
        &format!("/session/{session_id}"),
        None,
    )
    .await?;
    let project = Path::new(&runtime.directory)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    check_workspace(&info, &project)?;
    request(
        &runtime,
        reqwest::Method::POST,
        "/tui/select-session",
        Some(json!({"sessionID":session_id})),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn code_session_new(terminal_id: String) -> Result<(), String> {
    request(
        &runtime_for_terminal(&terminal_id)?,
        reqwest::Method::POST,
        "/tui/execute-command",
        Some(json!({"command":"session_new"})),
    )
    .await?;
    Ok(())
}

/// Explicit deletion uses OpenCode's public API or CLI, including when the
/// workspace has no live terminal. A failed upstream delete retains our row.
pub async fn delete_reference(data: &Path, thread: &Value) -> Result<(), String> {
    let code = code_reference(thread).ok_or("Not a Code session")?;
    let id = code
        .get("session_id")
        .and_then(Value::as_str)
        .ok_or("Missing OpenCode session ID")?;
    validate_session_id(&json!({"id":id}))?;
    let directory = code
        .get("directory")
        .and_then(Value::as_str)
        .ok_or("Missing Code workspace")?;
    let runtime = runtimes()
        .lock()
        .map_err(|_| "Code runtime registry unavailable")?
        .values()
        .find(|runtime| runtime.directory == directory)
        .cloned();
    if let Some(runtime) = runtime {
        request(
            &runtime,
            reqwest::Method::DELETE,
            &format!("/session/{id}"),
            None,
        )
        .await?;
    } else {
        let executable =
            code.get("executable")
                .and_then(Value::as_str)
                .unwrap_or(if cfg!(windows) {
                    "opencode.cmd"
                } else {
                    "opencode"
                });
        let output = tokio::process::Command::new(executable)
            .args(["session", "delete", id])
            .current_dir(directory)
            .output()
            .await
            .map_err(|error| format!("Could not delete Code session: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "OpenCode could not delete the session: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    file_store::delete_thread(
        data,
        thread
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Missing reference ID")?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_ancestry_requires_complete_same_workspace_chain_and_never_creates_child_rows() {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let directory = project.path().to_string_lossy().into_owned();
        let child = json!({"id":"ses_child","parentID":"ses_root","directory":directory});
        let root = json!({"id":"ses_root","directory":directory,"title":"Root task"});
        check_ancestry(&[child.clone(), root.clone()], project.path()).unwrap();
        assert!(check_ancestry(&[child.clone()], project.path()).is_err());
        assert!(check_ancestry(
            &[
                child.clone(),
                json!({"id":"ses_root","directory":other.path()})
            ],
            project.path()
        )
        .is_err());
        assert!(check_ancestry(
            &[
                child.clone(),
                json!({"id":"ses_root","parentID":"ses_child","directory":directory}),
                child
            ],
            project.path()
        )
        .is_err());
        write_reference(data.path(), &root, &directory, None).unwrap();
        assert_eq!(file_store::list_threads(data.path()).unwrap().len(), 1);
        assert!(get_reference(data.path(), "code-ses_child")
            .unwrap()
            .is_none());
        register_runtime(
            "ancestry-test",
            CodeRuntime {
                terminal_id: "code:ancestry-test".into(),
                directory,
                port: 1,
                password: "unused".into(),
                executable: None,
            },
        )
        .unwrap();
        assert!(register_runtime(
            "duplicate-workspace",
            runtime_for_terminal("code:ancestry-test").unwrap()
        )
        .is_err());
        callers().lock().unwrap().insert(
            ("ancestry-test".into(), "ses_child".into()),
            "code-ses_root".into(),
        );
        assert_eq!(
            caller_origin("ancestry-test", "ses_child").unwrap(),
            "code-ses_root"
        );
        assert_eq!(
            caller_origin("ancestry-test", "ses_other").unwrap(),
            "code-ses_other"
        );
        close_runtime("ancestry-test");
        assert!(!callers()
            .lock()
            .unwrap()
            .contains_key(&("ancestry-test".into(), "ses_child".into())));
    }
    #[test]
    fn reference_reload_preserves_transcript_ownership_and_user_metadata() {
        let data = tempfile::tempdir().unwrap();
        let info = json!({"id":"ses_test","title":"First task","time":{"updated":1000}});
        let mut row = write_reference(data.path(), &info, "/workspace", None).unwrap();
        row["title"] = json!("My saved code");
        row["metadata"]["is_favorite"] = json!(true);
        row["metadata"]["project"] = json!({"id":"project-1","name":"Work"});
        file_store::modify_thread(data.path(), row).unwrap();
        let updated = write_reference(
            data.path(),
            &json!({"id":"ses_test","title":"Automatic title","time":{"updated":2000}}),
            "/workspace",
            None,
        )
        .unwrap();
        assert_eq!(updated["title"], "My saved code");
        assert_eq!(updated["metadata"]["is_favorite"], true);
        assert_eq!(updated["metadata"]["project"]["id"], "project-1");
        let reloaded = file_store::list_threads(data.path()).unwrap();
        assert_eq!(reloaded, vec![updated]);
        assert!(!utils::get_messages_path(data.path(), "code-ses_test").exists());
    }
    #[test]
    fn remote_title_updates_until_the_history_label_is_renamed() {
        let data = tempfile::tempdir().unwrap();
        write_reference(
            data.path(),
            &json!({"id":"ses_test","title":"Untitled"}),
            "/workspace",
            None,
        )
        .unwrap();
        let row = write_reference(
            data.path(),
            &json!({"id":"ses_test","title":"Fix tests"}),
            "/workspace",
            None,
        )
        .unwrap();
        assert_eq!(row["title"], "Fix tests");
        assert!(validate_session_id(&json!({"id":"../other"})).is_err());
    }

    #[test]
    fn favorite_write_from_an_older_snapshot_retains_the_latest_upstream_title_and_reference() {
        let data = tempfile::tempdir().unwrap();
        let mut stale = write_reference(
            data.path(),
            &json!({"id":"ses_stale","title":"Untitled"}),
            "/workspace",
            None,
        )
        .unwrap();
        write_reference(
            data.path(),
            &json!({"id":"ses_stale","title":"Actual task"}),
            "/workspace",
            None,
        )
        .unwrap();
        stale["metadata"]["is_favorite"] = json!(true);
        let merged = merge_reference_update(data.path(), stale).unwrap();
        file_store::modify_thread(data.path(), merged).unwrap();
        let reloaded = get_reference(data.path(), "code-ses_stale")
            .unwrap()
            .unwrap();
        assert_eq!(reloaded["title"], "Actual task");
        assert_eq!(reloaded["metadata"]["code"]["title"], "Actual task");
        assert_eq!(reloaded["metadata"]["is_favorite"], true);
    }

    #[tokio::test]
    async fn public_tui_selection_preserves_the_live_runtime_and_failed_delete_retains_the_reference(
    ) {
        use hyper::{
            service::{make_service_fn, service_fn},
            Body, Response, Server,
        };
        use std::{convert::Infallible, sync::Arc};
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let directory = project.path().to_string_lossy().into_owned();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let observed = requests.clone();
        let server_directory = directory.clone();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let server = Server::from_tcp(listener)
            .unwrap()
            .serve(make_service_fn(move |_| {
                let observed = observed.clone();
                let directory = server_directory.clone();
                async move {
                    Ok::<_, Infallible>(service_fn(move |request: hyper::Request<Body>| {
                        let observed = observed.clone();
                        let directory = directory.clone();
                        async move {
                            let method = request.method().clone();
                            let uri = request.uri().to_string();
                            let auth = request
                                .headers()
                                .get("authorization")
                                .unwrap()
                                .to_str()
                                .unwrap()
                                .to_owned();
                            let body = hyper::body::to_bytes(request.into_body()).await.unwrap();
                            observed.lock().unwrap().push((
                                method.clone(),
                                uri,
                                auth,
                                body.to_vec(),
                            ));
                            let response = if method == hyper::Method::DELETE {
                                Response::builder()
                                    .status(503)
                                    .body(Body::from("busy"))
                                    .unwrap()
                            } else if method == hyper::Method::GET {
                                Response::new(Body::from(
                                    json!({"id":"ses_saved","directory":directory}).to_string(),
                                ))
                            } else {
                                Response::new(Body::from("true"))
                            };
                            Ok::<_, Infallible>(response)
                        }
                    }))
                }
            }));
        let task = tokio::spawn(server);
        register_runtime(
            "selection-test",
            CodeRuntime {
                terminal_id: "code:test-workspace".into(),
                directory: directory.clone(),
                port,
                password: "test-password".into(),
                executable: None,
            },
        )
        .unwrap();
        code_session_select("code:test-workspace".into(), "ses_saved".into())
            .await
            .unwrap();
        let row = write_reference(
            data.path(),
            &json!({"id":"ses_saved","title":"Saved task"}),
            &directory,
            None,
        )
        .unwrap();
        assert!(delete_reference(data.path(), &row)
            .await
            .unwrap_err()
            .contains("503"));
        assert!(get_reference(data.path(), "code-ses_saved")
            .unwrap()
            .is_some());
        assert!(runtime_for_terminal("code:test-workspace").is_ok());
        let requests = requests.lock().unwrap();
        assert!(requests[0].1.starts_with("/session/ses_saved?directory="));
        assert!(requests[1].1.starts_with("/tui/select-session?directory="));
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[1].3).unwrap(),
            json!({"sessionID":"ses_saved"})
        );
        assert!(requests
            .iter()
            .all(|request| request.2 == "Basic b3BlbmNvZGU6dGVzdC1wYXNzd29yZA=="));
        close_runtime("selection-test");
        task.abort();
    }
}
