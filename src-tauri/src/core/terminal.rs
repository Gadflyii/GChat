use std::{
    collections::VecDeque,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread::JoinHandle,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};

const REPLAY_CAPACITY_BYTES: usize = 1024 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_TERMINAL_DIMENSION: u16 = 1000;
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalLaunch {
    Shell,
    OpenCode,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalPhase {
    Idle,
    Running,
    Stopping,
    Exited,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatus {
    pub phase: TerminalPhase,
    pub generation: u64,
    pub cwd: Option<String>,
    pub launch: Option<TerminalLaunch>,
    pub exit_code: Option<u32>,
    pub signal: Option<String>,
    pub replay_complete: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnRequest {
    pub cwd: String,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
    pub launch: TerminalLaunch,
    pub executable: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInput {
    pub generation: u64,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub generation: u64,
    pub rows: u16,
    pub cols: u16,
    #[serde(default)]
    pub pixel_width: u16,
    #[serde(default)]
    pub pixel_height: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFlowRequest {
    pub generation: u64,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
    Started {
        generation: u64,
        sequence: u64,
        cwd: String,
        launch: TerminalLaunch,
    },
    Output {
        generation: u64,
        sequence: u64,
        data: String,
    },
    Exited {
        generation: u64,
        sequence: u64,
        exit_code: u32,
        signal: Option<String>,
    },
    ReplayUnavailable {
        generation: u64,
        sequence: u64,
    },
    Error {
        generation: u64,
        sequence: u64,
        message: String,
    },
}

impl TerminalEvent {
    fn replay_cost(&self) -> usize {
        match self {
            Self::Output { data, .. } => data.len(),
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenCodeReadinessReason {
    NotInstalled,
    WslOnly,
    MissingConfiguration,
    InvalidConfiguration,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeReadiness {
    pub ready: bool,
    pub installed: bool,
    pub configured: bool,
    pub via_wsl: bool,
    pub config_path: String,
    pub reason: Option<OpenCodeReadinessReason>,
}

struct ReplayLog {
    events: VecDeque<TerminalEvent>,
    bytes: usize,
    complete: bool,
}

impl Default for ReplayLog {
    fn default() -> Self {
        Self {
            events: VecDeque::new(),
            bytes: 0,
            complete: true,
        }
    }
}

impl ReplayLog {
    fn push(&mut self, event: TerminalEvent) {
        if !self.complete {
            return;
        }

        let cost = event.replay_cost();
        if cost > REPLAY_CAPACITY_BYTES {
            self.mark_unavailable();
            return;
        }

        self.bytes += cost;
        self.events.push_back(event);
        if self.bytes > REPLAY_CAPACITY_BYTES {
            self.mark_unavailable();
        }
    }

    fn mark_unavailable(&mut self) {
        self.events.clear();
        self.bytes = 0;
        self.complete = false;
    }

    fn reset(&mut self) {
        self.events.clear();
        self.bytes = 0;
        self.complete = true;
    }
}

struct Session {
    phase: TerminalPhase,
    generation: u64,
    sequence: u64,
    cwd: Option<String>,
    launch: Option<TerminalLaunch>,
    exit_code: Option<u32>,
    signal: Option<String>,
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
    channel: Option<Channel<TerminalEvent>>,
    replay: ReplayLog,
    flow_paused: bool,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            phase: TerminalPhase::Idle,
            generation: 0,
            sequence: 0,
            cwd: None,
            launch: None,
            exit_code: None,
            signal: None,
            master: None,
            writer: None,
            killer: None,
            channel: None,
            replay: ReplayLog::default(),
            flow_paused: false,
        }
    }
}

impl Session {
    fn status(&self) -> TerminalStatus {
        TerminalStatus {
            phase: self.phase,
            generation: self.generation,
            cwd: self.cwd.clone(),
            launch: self.launch,
            exit_code: self.exit_code,
            signal: self.signal.clone(),
            replay_complete: self.replay.complete,
        }
    }

    fn next_sequence(&mut self) -> u64 {
        self.sequence += 1;
        self.sequence
    }

    fn publish(&mut self, event: TerminalEvent) {
        if let Some(channel) = self.channel.as_ref() {
            if let Err(error) = channel.send(event) {
                log::debug!("Code terminal channel disconnected: {error}");
                self.channel = None;
                // A later frontend has no xterm parser state from this session,
                // so a byte tail is not a valid reconstruction of the screen.
                self.replay.mark_unavailable();
            }
        } else {
            self.replay.push(event);
        }
    }
}

struct SharedTerminal {
    session: Mutex<Session>,
    flow_changed: Condvar,
}

pub struct TerminalState {
    shared: Arc<SharedTerminal>,
    spawn_gate: Mutex<()>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            shared: Arc::new(SharedTerminal {
                session: Mutex::new(Session::default()),
                flow_changed: Condvar::new(),
            }),
            spawn_gate: Mutex::new(()),
            threads: Mutex::new(Vec::new()),
        }
    }
}

impl TerminalState {
    fn session(&self) -> Result<MutexGuard<'_, Session>, String> {
        self.shared
            .session
            .lock()
            .map_err(|_| "Code terminal state is unavailable".to_string())
    }

    fn reap_finished_threads(&self) {
        let Ok(mut threads) = self.threads.lock() else {
            return;
        };
        let mut pending = Vec::with_capacity(threads.len());
        for handle in threads.drain(..) {
            if handle.is_finished() {
                let _ = handle.join();
            } else {
                pending.push(handle);
            }
        }
        *threads = pending;
    }

    fn push_thread(&self, handle: JoinHandle<()>) -> Result<(), String> {
        self.threads
            .lock()
            .map_err(|_| "Code terminal thread state is unavailable".to_string())?
            .push(handle);
        Ok(())
    }

    pub fn shutdown(&self) {
        let (mut killer, writer, master) = match self.session() {
            Ok(mut session) => {
                if session.phase == TerminalPhase::Running {
                    session.phase = TerminalPhase::Stopping;
                }
                session.flow_paused = false;
                let resources = (
                    session.killer.take(),
                    session.writer.take(),
                    session.master.take(),
                );
                self.shared.flow_changed.notify_all();
                resources
            }
            Err(error) => {
                log::warn!("{error}");
                return;
            }
        };

        if let Some(killer) = killer.as_mut() {
            if let Err(error) = killer.kill() {
                log::debug!("Code terminal child was already stopped: {error}");
            }
        }
        drop(writer);
        drop(master);

        if let Ok(mut threads) = self.threads.lock() {
            for handle in threads.drain(..) {
                if handle.join().is_err() {
                    log::warn!("Code terminal worker panicked during shutdown");
                }
            }
        }
    }
}

fn default_rows() -> u16 {
    DEFAULT_ROWS
}

fn default_cols() -> u16 {
    DEFAULT_COLS
}

fn validate_size(rows: u16, cols: u16) -> Result<(), String> {
    if !(2..=MAX_TERMINAL_DIMENSION).contains(&rows)
        || !(2..=MAX_TERMINAL_DIMENSION).contains(&cols)
    {
        return Err(format!(
            "Terminal size must be between 2 and {MAX_TERMINAL_DIMENSION} rows and columns"
        ));
    }
    Ok(())
}

fn canonical_working_directory(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("A Code workspace is required".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err("The Code workspace must be an absolute path".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not open Code workspace {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Code workspace is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn command_for_shell(cwd: &Path) -> CommandBuilder {
    #[cfg(windows)]
    let mut command = {
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoExit"]);
        command
    };

    #[cfg(not(windows))]
    let mut command = CommandBuilder::new_default_prog();

    command.cwd(cwd.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command
}

fn quote_open_code_command(executable: Option<&str>) -> Result<Vec<u8>, String> {
    let executable = executable.map(str::trim).filter(|path| !path.is_empty());
    if let Some(path) = executable {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() {
            return Err("The custom OpenCode executable must be an absolute file path".to_string());
        }
    }

    #[cfg(windows)]
    let command = match executable {
        Some(path) => format!("& '{}'\r", path.replace('\'', "''")),
        None => "opencode\r".to_string(),
    };

    #[cfg(not(windows))]
    let command = match executable {
        Some(path) => format!("'{}'\r", path.replace('\'', "'\\''")),
        None => "opencode\r".to_string(),
    };

    Ok(command.into_bytes())
}

fn start_reader(
    shared: Arc<SharedTerminal>,
    generation: u64,
    mut reader: Box<dyn Read + Send>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!("code-terminal-reader-{generation}"))
        .spawn(move || {
            let mut buffer = [0_u8; 16 * 1024];
            loop {
                {
                    let Ok(mut session) = shared.session.lock() else {
                        return;
                    };
                    while session.generation == generation && session.flow_paused {
                        let Ok(next) = shared.flow_changed.wait(session) else {
                            return;
                        };
                        session = next;
                    }
                    if session.generation != generation
                        || !matches!(
                            session.phase,
                            TerminalPhase::Running | TerminalPhase::Stopping
                        )
                    {
                        return;
                    }
                }

                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(count) => {
                        let Ok(mut session) = shared.session.lock() else {
                            return;
                        };
                        if session.generation != generation {
                            return;
                        }
                        let sequence = session.next_sequence();
                        session.publish(TerminalEvent::Output {
                            generation,
                            sequence,
                            data: BASE64.encode(&buffer[..count]),
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        let Ok(mut session) = shared.session.lock() else {
                            return;
                        };
                        if session.generation == generation
                            && session.phase == TerminalPhase::Running
                        {
                            let sequence = session.next_sequence();
                            session.publish(TerminalEvent::Error {
                                generation,
                                sequence,
                                message: format!("Terminal output stopped: {error}"),
                            });
                        }
                        return;
                    }
                }
            }
        })
        .expect("failed to spawn Code terminal reader")
}

fn start_waiter(
    shared: Arc<SharedTerminal>,
    generation: u64,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!("code-terminal-waiter-{generation}"))
        .spawn(move || {
            let waited = child.wait();
            let Ok(mut session) = shared.session.lock() else {
                return;
            };
            if session.generation != generation {
                return;
            }

            session.master = None;
            session.writer = None;
            session.killer = None;
            session.flow_paused = false;
            shared.flow_changed.notify_all();

            match waited {
                Ok(status) => {
                    let exit_code = status.exit_code();
                    let signal = status.signal().map(str::to_string);
                    session.phase = TerminalPhase::Exited;
                    session.exit_code = Some(exit_code);
                    session.signal.clone_from(&signal);
                    let sequence = session.next_sequence();
                    session.publish(TerminalEvent::Exited {
                        generation,
                        sequence,
                        exit_code,
                        signal,
                    });
                }
                Err(error) => {
                    session.phase = TerminalPhase::Exited;
                    session.exit_code = None;
                    session.signal = None;
                    let sequence = session.next_sequence();
                    session.publish(TerminalEvent::Error {
                        generation,
                        sequence,
                        message: format!("Could not wait for terminal process: {error}"),
                    });
                }
            }
        })
        .expect("failed to spawn Code terminal waiter")
}

#[tauri::command]
pub fn terminal_attach(
    state: State<'_, TerminalState>,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalStatus, String> {
    let mut session = state.session()?;
    let replacing_live_view = session.channel.is_some() && session.generation != 0;
    if session.replay.complete && !replacing_live_view {
        for event in &session.replay.events {
            on_event
                .send(event.clone())
                .map_err(|error| format!("Could not attach Code terminal channel: {error}"))?;
        }
    } else {
        let generation = session.generation;
        let sequence = session.next_sequence();
        on_event
            .send(TerminalEvent::ReplayUnavailable {
                generation,
                sequence,
            })
            .map_err(|error| format!("Could not attach Code terminal channel: {error}"))?;
    }
    session.replay.reset();
    session.channel = Some(on_event);
    Ok(session.status())
}

#[tauri::command]
pub fn terminal_status(state: State<'_, TerminalState>) -> Result<TerminalStatus, String> {
    Ok(state.session()?.status())
}

#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalState>,
    request: TerminalSpawnRequest,
) -> Result<TerminalStatus, String> {
    validate_size(request.rows, request.cols)?;
    let cwd = canonical_working_directory(&request.cwd)?;
    let cwd_text = cwd
        .to_str()
        .ok_or_else(|| "The Code workspace path must be valid Unicode".to_string())?
        .to_string();
    let launch_command = match request.launch {
        TerminalLaunch::Shell => None,
        TerminalLaunch::OpenCode => Some(quote_open_code_command(request.executable.as_deref())?),
    };

    let _spawn_guard = state
        .spawn_gate
        .lock()
        .map_err(|_| "Code terminal spawn state is unavailable".to_string())?;
    state.reap_finished_threads();

    {
        let session = state.session()?;
        if matches!(
            session.phase,
            TerminalPhase::Running | TerminalPhase::Stopping
        ) {
            if session.phase == TerminalPhase::Running
                && session.cwd.as_deref() == Some(cwd_text.as_str())
                && session.launch == Some(request.launch)
            {
                return Ok(session.status());
            }
            return Err(
                "A Code terminal is already running; stop it before changing workspace or launch mode"
                    .to_string(),
            );
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not create Code terminal: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not open Code terminal output: {error}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not open Code terminal input: {error}"))?;
    let command = command_for_shell(&cwd);
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not start Code terminal shell: {error}"))?;
    drop(pair.slave);
    let mut killer = child.clone_killer();

    if let Some(command) = launch_command {
        if let Err(error) = writer.write_all(&command).and_then(|_| writer.flush()) {
            let _ = killer.kill();
            drop(writer);
            drop(pair.master);
            let _ = child.wait();
            return Err(format!("Could not launch OpenCode: {error}"));
        }
    }

    let generation;
    {
        let mut session = state.session()?;
        generation = session.generation.saturating_add(1).max(1);
        session.phase = TerminalPhase::Running;
        session.generation = generation;
        session.sequence = 0;
        session.cwd = Some(cwd_text.clone());
        session.launch = Some(request.launch);
        session.exit_code = None;
        session.signal = None;
        session.master = Some(pair.master);
        session.writer = Some(writer);
        session.killer = Some(killer);
        session.flow_paused = false;
        session.replay.reset();

        let sequence = session.next_sequence();
        session.publish(TerminalEvent::Started {
            generation,
            sequence,
            cwd: cwd_text,
            launch: request.launch,
        });
    }

    state.push_thread(start_reader(state.shared.clone(), generation, reader))?;
    state.push_thread(start_waiter(state.shared.clone(), generation, child))?;
    Ok(state.session()?.status())
}

#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalState>, input: TerminalInput) -> Result<(), String> {
    let bytes = BASE64
        .decode(input.data)
        .map_err(|_| "Terminal input is not valid base64".to_string())?;
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Terminal input exceeds the {MAX_INPUT_BYTES}-byte limit"
        ));
    }

    let mut session = state.session()?;
    if session.generation != input.generation || session.phase != TerminalPhase::Running {
        return Err("The Code terminal generation is no longer running".to_string());
    }
    let writer = session
        .writer
        .as_mut()
        .ok_or_else(|| "Code terminal input is unavailable".to_string())?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Could not write to Code terminal: {error}"))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    validate_size(request.rows, request.cols)?;
    let session = state.session()?;
    if session.generation != request.generation || session.phase != TerminalPhase::Running {
        return Err("The Code terminal generation is no longer running".to_string());
    }
    session
        .master
        .as_ref()
        .ok_or_else(|| "Code terminal is unavailable".to_string())?
        .resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: request.pixel_width,
            pixel_height: request.pixel_height,
        })
        .map_err(|error| format!("Could not resize Code terminal: {error}"))
}

#[tauri::command]
pub fn terminal_set_flow(
    state: State<'_, TerminalState>,
    request: TerminalFlowRequest,
) -> Result<(), String> {
    let mut session = state.session()?;
    if session.generation != request.generation || session.phase != TerminalPhase::Running {
        return Err("The Code terminal generation is no longer running".to_string());
    }
    session.flow_paused = request.paused;
    if !request.paused {
        state.shared.flow_changed.notify_all();
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_stop(state: State<'_, TerminalState>) -> Result<TerminalStatus, String> {
    let (status, mut killer, writer, master) = {
        let mut session = state.session()?;
        if session.phase != TerminalPhase::Running {
            return Ok(session.status());
        }
        session.phase = TerminalPhase::Stopping;
        session.flow_paused = false;
        state.shared.flow_changed.notify_all();
        let status = session.status();
        (
            status,
            session.killer.take(),
            session.writer.take(),
            session.master.take(),
        )
    };
    if let Some(killer) = killer.as_mut() {
        killer
            .kill()
            .map_err(|error| format!("Could not stop Code terminal: {error}"))?;
    }
    drop(writer);
    drop(master);
    Ok(status)
}

fn opencode_config_path() -> Result<PathBuf, String> {
    Ok(PathBuf::from(super::system::commands::agent_home_dir()?)
        .join(".config")
        .join("opencode")
        .join("opencode.json"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenCodeConfigurationState {
    Missing,
    Invalid,
    Ready,
}

fn opencode_configuration_state(path: &Path) -> Result<OpenCodeConfigurationState, String> {
    if !path.is_file() {
        return Ok(OpenCodeConfigurationState::Missing);
    }
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let root: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;
    let Some(provider) = root
        .pointer("/provider/gchat")
        .and_then(|value| value.as_object())
    else {
        return Ok(OpenCodeConfigurationState::Missing);
    };
    if provider.get("npm").and_then(|value| value.as_str()) != Some("@ai-sdk/openai-compatible") {
        return Ok(OpenCodeConfigurationState::Invalid);
    }
    let Some(base_url) = provider
        .get("options")
        .and_then(|value| value.get("baseURL"))
        .and_then(|value| value.as_str())
    else {
        return Ok(OpenCodeConfigurationState::Invalid);
    };
    let Ok(base_url) = url::Url::parse(base_url) else {
        return Ok(OpenCodeConfigurationState::Invalid);
    };
    let loopback = matches!(
        base_url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    );
    if !loopback || !matches!(base_url.scheme(), "http" | "https") {
        return Ok(OpenCodeConfigurationState::Invalid);
    }
    let api_key = provider
        .get("options")
        .and_then(|value| value.get("apiKey"))
        .and_then(|value| value.as_str());
    if !matches!(api_key, Some(value) if !value.is_empty()) {
        return Ok(OpenCodeConfigurationState::Invalid);
    }
    let Some(model) = root.get("model").and_then(|value| value.as_str()) else {
        return Ok(OpenCodeConfigurationState::Invalid);
    };
    let Some(model_id) = model
        .strip_prefix("gchat/")
        .filter(|value| !value.is_empty())
    else {
        return Ok(OpenCodeConfigurationState::Invalid);
    };
    if provider
        .get("models")
        .and_then(|value| value.as_object())
        .is_some_and(|models| models.contains_key(model_id))
    {
        Ok(OpenCodeConfigurationState::Ready)
    } else {
        Ok(OpenCodeConfigurationState::Invalid)
    }
}

#[tauri::command]
pub async fn opencode_readiness(custom_path: Option<String>) -> Result<OpenCodeReadiness, String> {
    let detection =
        super::system::commands::detect_agent_installed("opencode".to_string(), custom_path).await;
    let config_path = opencode_config_path()?;
    let config_state = match opencode_configuration_state(&config_path) {
        Ok(state) => state,
        Err(error) => {
            log::debug!("OpenCode readiness config error: {error}");
            OpenCodeConfigurationState::Invalid
        }
    };
    let configured = config_state == OpenCodeConfigurationState::Ready;
    let reason = if !detection.installed {
        Some(OpenCodeReadinessReason::NotInstalled)
    } else if detection.via_wsl {
        Some(OpenCodeReadinessReason::WslOnly)
    } else if config_state == OpenCodeConfigurationState::Invalid {
        Some(OpenCodeReadinessReason::InvalidConfiguration)
    } else if config_state == OpenCodeConfigurationState::Missing {
        Some(OpenCodeReadinessReason::MissingConfiguration)
    } else {
        None
    };
    Ok(OpenCodeReadiness {
        ready: reason.is_none(),
        installed: detection.installed,
        configured,
        via_wsl: detection.via_wsl,
        config_path: config_path.to_string_lossy().into_owned(),
        reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output_event(sequence: u64, bytes: usize) -> TerminalEvent {
        TerminalEvent::Output {
            generation: 1,
            sequence,
            data: "x".repeat(bytes),
        }
    }

    #[test]
    fn replay_log_refuses_a_truncated_terminal_tail() {
        let mut replay = ReplayLog::default();
        replay.push(output_event(1, REPLAY_CAPACITY_BYTES));
        replay.push(output_event(2, 1));
        assert!(!replay.complete);
        assert!(replay.events.is_empty());
    }

    #[test]
    fn terminal_dimensions_are_bounded() {
        assert!(validate_size(24, 80).is_ok());
        assert!(validate_size(1, 80).is_err());
        assert!(validate_size(24, MAX_TERMINAL_DIMENSION + 1).is_err());
    }

    #[test]
    fn workspace_must_be_absolute_and_existing() {
        assert!(canonical_working_directory("relative").is_err());
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            canonical_working_directory(temp.path().to_str().unwrap()).unwrap(),
            temp.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn gchat_opencode_configuration_requires_the_selected_registered_model() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("opencode.json");
        assert_eq!(
            opencode_configuration_state(&path),
            Ok(OpenCodeConfigurationState::Missing)
        );
        std::fs::write(
            &path,
            serde_json::json!({
                "provider": {
                    "gchat": {
                        "npm": "@ai-sdk/openai-compatible",
                        "options": { "baseURL": "http://localhost:2468/custom-openai", "apiKey": "gchat" },
                        "models": { "qwen": { "name": "qwen" } }
                    }
                },
                "model": "gchat/qwen"
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            opencode_configuration_state(&path),
            Ok(OpenCodeConfigurationState::Ready)
        );

        std::fs::write(
            &path,
            serde_json::json!({
                "provider": {
                    "gchat": {
                        "npm": "@ai-sdk/openai-compatible",
                        "options": { "baseURL": "http://127.0.0.1:1337/v1" },
                        "models": { "other": { "name": "other" } }
                    }
                },
                "model": "gchat/qwen"
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            opencode_configuration_state(&path),
            Ok(OpenCodeConfigurationState::Invalid)
        );
    }

    #[cfg(unix)]
    #[test]
    fn real_pty_runs_a_shell_and_captures_output() {
        let state = TerminalState::default();
        let temp = tempfile::tempdir().unwrap();
        let request = TerminalSpawnRequest {
            cwd: temp.path().to_string_lossy().into_owned(),
            rows: 24,
            cols: 80,
            launch: TerminalLaunch::Shell,
            executable: None,
        };

        // Exercise the same portable-pty primitives as the command without a
        // Tauri runtime; command/state extraction itself is generated by Tauri.
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize::default()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut command = command_for_shell(&canonical_working_directory(&request.cwd).unwrap());
        command.env("PS1", "");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        writer.write_all(b"printf '__GCHAT_PTY_OK__\\n'\r").unwrap();
        writer.write_all(b"exit\r").unwrap();
        writer.flush().unwrap();
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();
        let status = child.wait().unwrap();
        assert!(status.success());
        assert!(output.contains("__GCHAT_PTY_OK__"));
        state.shutdown();
    }
}
