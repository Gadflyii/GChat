use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread::JoinHandle,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Runtime, State};

const REPLAY_CAPACITY_BYTES: usize = 1024 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_TERMINAL_DIMENSION: u16 = 1000;
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;
const GCHAT_OPENCODE_THEME: &str = include_str!("../../resources/opencode/gchat.json");
const GCHAT_OPENCODE_TUI_CONFIG: &str = include_str!("../../resources/opencode/gchat-tui.json");
const GCHAT_OPENCODE_CALLER: &str = include_str!("../../resources/opencode/gchat-caller.mjs");
const GCHAT_OPENCODE_STARTUP: &str = include_str!("../../resources/opencode/gchat-startup.mjs");
const GCHAT_HERMES_DARK_SKIN: &str = include_str!("../../resources/hermes/gchat-dark.yaml");
const GCHAT_HERMES_LIGHT_SKIN: &str = include_str!("../../resources/hermes/gchat-light.yaml");

#[cfg(windows)]
#[derive(Debug, Clone)]
struct WindowsTerminalKiller {
    process: Arc<std::os::windows::io::OwnedHandle>,
}

#[cfg(windows)]
impl WindowsTerminalKiller {
    fn duplicate(process: std::os::windows::io::RawHandle) -> std::io::Result<Self> {
        // The child still owns this handle while we duplicate it for the stop path.
        let process = unsafe { std::os::windows::io::BorrowedHandle::borrow_raw(process) }
            .try_clone_to_owned()?;
        Ok(Self {
            process: Arc::new(process),
        })
    }

    fn terminate(process: std::os::windows::io::RawHandle) -> std::io::Result<()> {
        use windows_sys::Win32::{
            Foundation::WAIT_OBJECT_0,
            System::Threading::{TerminateProcess, WaitForSingleObject},
        };

        if unsafe { TerminateProcess(process, 1) } != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        // Access denied also occurs after exit; only the pinned handle proves that exit.
        if unsafe { WaitForSingleObject(process, 0) } == WAIT_OBJECT_0 {
            Ok(())
        } else {
            Err(error)
        }
    }
}

#[cfg(windows)]
impl ChildKiller for WindowsTerminalKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        Self::terminate(self.process.as_raw_handle())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(self.clone())
    }
}

fn terminal_child_killer(
    child: &(dyn portable_pty::Child + Send + Sync),
) -> std::io::Result<Box<dyn ChildKiller + Send + Sync>> {
    #[cfg(windows)]
    {
        let process = child.as_raw_handle().ok_or_else(|| {
            std::io::Error::other("The terminal child has no Windows process handle")
        })?;
        Ok(Box::new(WindowsTerminalKiller::duplicate(process)?))
    }
    #[cfg(not(windows))]
    {
        Ok(child.clone_killer())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalId {
    Code,
    CodeWorkspace(String),
    Hermes,
}

impl Serialize for TerminalId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.key())
    }
}
impl<'de> Deserialize<'de> for TerminalId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "code" => Ok(Self::Code),
            "hermes" => Ok(Self::Hermes),
            value if value.starts_with("code:") && value.len() > 5 => {
                Ok(Self::CodeWorkspace(value[5..].into()))
            }
            _ => Err(serde::de::Error::custom("Unknown embedded terminal")),
        }
    }
}

impl TerminalId {
    fn key(&self) -> String {
        match self {
            Self::Code => "code".into(),
            Self::CodeWorkspace(directory) => format!("code:{directory}"),
            Self::Hermes => "hermes".into(),
        }
    }
    fn is_code(&self) -> bool {
        !matches!(self, Self::Hermes)
    }
    fn label(&self) -> &'static str {
        match self {
            Self::Code | Self::CodeWorkspace(_) => "Code",
            Self::Hermes => "Hermes",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalAppearance {
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalLaunch {
    Shell,
    OpenCode,
    Hermes,
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
    pub sequence: u64,
    pub cwd: Option<String>,
    pub launch: Option<TerminalLaunch>,
    pub exit_code: Option<u32>,
    pub signal: Option<String>,
    pub replay_complete: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnRequest {
    pub terminal_id: TerminalId,
    pub cwd: String,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
    pub launch: TerminalLaunch,
    pub executable: Option<String>,
    #[serde(default)]
    pub appearance: Option<TerminalAppearance>,
    #[serde(default)]
    pub code_session_id: Option<String>,
    #[serde(default)]
    pub bridge_policy: Option<super::code_bridge::BridgePolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInput {
    pub terminal_id: TerminalId,
    pub generation: u64,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub terminal_id: TerminalId,
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
    pub terminal_id: TerminalId,
    pub generation: u64,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
    Started {
        generation: u64,
        sequence: u64,
        status: TerminalStatus,
    },
    Output {
        generation: u64,
        sequence: u64,
        data: String,
    },
    Exited {
        generation: u64,
        sequence: u64,
        status: TerminalStatus,
    },
    ReplayUnavailable {
        generation: u64,
        sequence: u64,
    },
    Error {
        generation: u64,
        sequence: u64,
        message: String,
        status: TerminalStatus,
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

pub type HermesReadiness = OpenCodeReadiness;

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

struct BridgeLease(String);

impl Drop for BridgeLease {
    fn drop(&mut self) {
        super::code_sessions::close_runtime(&self.0);
        super::code_bridge::close_session(&self.0);
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
    #[cfg(windows)]
    startup_child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    channel: Option<Channel<TerminalEvent>>,
    replay: ReplayLog,
    flow_paused: bool,
    bridge: Option<BridgeLease>,
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
            #[cfg(windows)]
            startup_child: None,
            channel: None,
            replay: ReplayLog::default(),
            flow_paused: false,
            bridge: None,
        }
    }
}

impl Session {
    #[cfg(windows)]
    fn request_windows_stop(&mut self) -> std::io::Result<()> {
        if let Some(killer) = self.killer.as_mut() {
            killer.kill()?;
        }
        if let Some(child) = self.startup_child.as_ref() {
            let process = child.as_raw_handle().ok_or_else(|| {
                std::io::Error::other("The terminal child has no Windows process handle")
            })?;
            WindowsTerminalKiller::terminate(process)?;
        }
        Ok(())
    }

    fn status(&self) -> TerminalStatus {
        TerminalStatus {
            phase: self.phase,
            generation: self.generation,
            sequence: self.sequence,
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
                log::debug!("Embedded terminal channel disconnected: {error}");
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

struct TerminalSlot {
    id: TerminalId,
    shared: Arc<SharedTerminal>,
    spawn_gate: Mutex<()>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl TerminalSlot {
    fn new(id: TerminalId) -> Self {
        Self {
            id,
            shared: Arc::new(SharedTerminal {
                session: Mutex::new(Session::default()),
                flow_changed: Condvar::new(),
            }),
            spawn_gate: Mutex::new(()),
            threads: Mutex::new(Vec::new()),
        }
    }

    fn session(&self) -> Result<MutexGuard<'_, Session>, String> {
        self.shared
            .session
            .lock()
            .map_err(|_| format!("{} terminal state is unavailable", self.id.label()))
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
            .map_err(|_| format!("{} terminal thread state is unavailable", self.id.label()))?
            .push(handle);
        Ok(())
    }

    fn shutdown(&self) {
        #[cfg(windows)]
        let mut startup_child;
        let (killer, writer, master) = match self.session() {
            Ok(mut session) => {
                #[cfg(windows)]
                if let Err(error) = session.request_windows_stop() {
                    log::warn!(
                        "Could not stop {} terminal during shutdown: {error}",
                        self.id.label()
                    );
                    return;
                }
                #[cfg(windows)]
                {
                    startup_child = session.startup_child.take();
                }
                if session.phase == TerminalPhase::Running {
                    session.phase = TerminalPhase::Stopping;
                    session.next_sequence();
                }
                session.flow_paused = false;
                session.bridge = None;
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

        #[cfg(not(windows))]
        let mut killer = killer;
        #[cfg(not(windows))]
        if let Some(killer) = killer.as_mut() {
            if let Err(error) = killer.kill() {
                log::debug!(
                    "{} terminal child was already stopped: {error}",
                    self.id.label()
                );
            }
        }
        drop(killer);
        drop(writer);
        drop(master);
        #[cfg(windows)]
        if let Some(child) = startup_child.as_mut() {
            if let Err(error) = child.wait() {
                log::warn!("Could not reap {} terminal child: {error}", self.id.label());
            }
        }

        if let Ok(mut threads) = self.threads.lock() {
            for handle in threads.drain(..) {
                if handle.join().is_err() {
                    log::warn!(
                        "{} terminal worker panicked during shutdown",
                        self.id.label()
                    );
                }
            }
        }
    }
}

pub struct TerminalState {
    code: Arc<TerminalSlot>,
    code_workspaces: Mutex<HashMap<String, Arc<TerminalSlot>>>,
    hermes: Arc<TerminalSlot>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            code: Arc::new(TerminalSlot::new(TerminalId::Code)),
            code_workspaces: Mutex::new(HashMap::new()),
            hermes: Arc::new(TerminalSlot::new(TerminalId::Hermes)),
        }
    }
}

impl TerminalState {
    fn slot(&self, id: TerminalId) -> Arc<TerminalSlot> {
        match id {
            TerminalId::Code => self.code.clone(),
            TerminalId::Hermes => self.hermes.clone(),
            TerminalId::CodeWorkspace(ref directory) => self
                .code_workspaces
                .lock()
                .expect("Code workspace registry poisoned")
                .entry(directory.clone())
                .or_insert_with(|| Arc::new(TerminalSlot::new(id.clone())))
                .clone(),
        }
    }

    pub fn shutdown(&self) {
        self.code.shutdown();
        if let Ok(workspaces) = self.code_workspaces.lock() {
            for workspace in workspaces.values() {
                workspace.shutdown();
            }
        }
        self.hermes.shutdown();
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
        return Err("A terminal workspace is required".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err("The terminal workspace must be an absolute path".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "Could not open terminal workspace {}: {error}",
            path.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "Terminal workspace is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

#[tauri::command]
pub async fn code_workspace_resolve<R: Runtime>(
    app_handle: AppHandle<R>,
    cwd: Option<String>,
) -> Result<String, String> {
    let directory = match cwd {
        Some(cwd) => canonical_working_directory(&cwd)?,
        None => {
            super::agent::commands::resolve_working_dir(
                None,
                &super::app::commands::get_jan_data_folder_path(app_handle),
            )
            .await?
        }
    };
    Ok(windows_cli_path(&directory))
}

fn command_for_shell(
    cwd: &Path,
    opencode_tui_config: Option<&Path>,
    hermes_appearance: Option<TerminalAppearance>,
) -> CommandBuilder {
    #[cfg(windows)]
    let mut command = {
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoExit"]);
        command
    };

    #[cfg(not(windows))]
    let mut command = CommandBuilder::new_default_prog();

    // Shells and their Python/Node children expect a normal drive/UNC path,
    // not the verbatim path returned by Windows canonicalization.
    #[cfg(windows)]
    command.cwd(windows_cli_path(cwd));
    #[cfg(not(windows))]
    command.cwd(cwd.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    if let Some(path) = super::system::commands::agent_runtime_path() {
        command.env("PATH", path);
    }
    if let Some(path) = opencode_tui_config {
        command.env("OPENCODE_TUI_CONFIG", path.as_os_str());
    }
    if let Some(appearance) = hermes_appearance {
        command.env(
            "HERMES_TUI_THEME",
            match appearance {
                TerminalAppearance::Dark => "dark",
                TerminalAppearance::Light => "light",
            },
        );
    }
    command
}

fn default_open_code_command(windows: bool) -> &'static str {
    if windows {
        // npm/nvm installs both opencode.ps1 and opencode.cmd. PowerShell's
        // bare-name resolution prefers the .ps1 shim, which is blocked on a
        // default Restricted execution policy. Naming the application shim
        // explicitly preserves the user's policy and works in the same PTY.
        "opencode.cmd"
    } else {
        "opencode"
    }
}

fn shell_literal(value: &str, windows: bool) -> String {
    if windows {
        format!("'{}'", value.replace('\'', "''"))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn windows_cli_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    value
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| value.strip_prefix(r"\\?\").map(str::to_string))
        .unwrap_or_else(|| value.into_owned())
}

fn format_open_code_command(executable: Option<&str>, cwd: &Path, windows: bool) -> String {
    let workspace = if windows {
        windows_cli_path(cwd)
    } else {
        cwd.to_string_lossy().into_owned()
    };
    let executable = match executable {
        Some(path) if windows => format!("& {}", shell_literal(path, true)),
        Some(path) => shell_literal(path, false),
        None => default_open_code_command(windows).to_string(),
    };
    format!("{executable} {}\r", shell_literal(&workspace, windows))
}

fn quote_open_code_command(executable: Option<&str>, cwd: &Path) -> Result<Vec<u8>, String> {
    let executable = executable.map(str::trim).filter(|path| !path.is_empty());
    if let Some(path) = executable {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() {
            return Err("The custom OpenCode executable must be an absolute file path".to_string());
        }
    }

    #[cfg(windows)]
    let command = format_open_code_command(executable, cwd, true);

    #[cfg(not(windows))]
    let command = format_open_code_command(executable, cwd, false);

    Ok(command.into_bytes())
}

fn format_hermes_command(executable: Option<&str>, windows: bool) -> String {
    let executable = match executable {
        Some(path) if windows => format!("& {}", shell_literal(path, true)),
        Some(path) => shell_literal(path, false),
        None => "hermes".to_string(),
    };
    format!("{executable} --tui\r")
}

fn quote_hermes_command(executable: Option<&str>) -> Result<Vec<u8>, String> {
    let executable = executable.map(str::trim).filter(|path| !path.is_empty());
    #[cfg(windows)]
    if executable.is_none() {
        super::system::hermes_runtime::repair_managed_runtime(
            &super::system::commands::resolve_hermes_dir()?,
        )?;
    }
    if let Some(path) = executable {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() {
            return Err("The custom Hermes executable must be an absolute file path".to_string());
        }
    }

    #[cfg(windows)]
    let command = format_hermes_command(executable, true);

    #[cfg(not(windows))]
    let command = format_hermes_command(executable, false);

    Ok(command.into_bytes())
}

fn start_reader(
    terminal_id: TerminalId,
    shared: Arc<SharedTerminal>,
    generation: u64,
    mut reader: Box<dyn Read + Send>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!(
            "{}-terminal-reader-{generation}",
            terminal_id.label().to_ascii_lowercase()
        ))
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
                            let status = session.status();
                            session.publish(TerminalEvent::Error {
                                generation,
                                sequence,
                                message: format!("Terminal output stopped: {error}"),
                                status,
                            });
                        }
                        return;
                    }
                }
            }
        })
        .expect("failed to spawn embedded terminal reader")
}

fn start_waiter(
    terminal_id: TerminalId,
    shared: Arc<SharedTerminal>,
    generation: u64,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!(
            "{}-terminal-waiter-{generation}",
            terminal_id.label().to_ascii_lowercase()
        ))
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
            session.bridge = None;
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
                    let status = session.status();
                    session.publish(TerminalEvent::Exited {
                        generation,
                        sequence,
                        status,
                    });
                }
                Err(error) => {
                    session.phase = TerminalPhase::Exited;
                    session.exit_code = None;
                    session.signal = None;
                    let sequence = session.next_sequence();
                    let status = session.status();
                    session.publish(TerminalEvent::Error {
                        generation,
                        sequence,
                        message: format!("Could not wait for terminal process: {error}"),
                        status,
                    });
                }
            }
        })
        .expect("failed to spawn embedded terminal waiter")
}

#[tauri::command]
pub fn terminal_attach(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalStatus, String> {
    let slot = state.slot(terminal_id.clone());
    let mut session = slot.session()?;
    let replacing_live_view = session.channel.is_some() && session.generation != 0;
    if session.replay.complete && !replacing_live_view {
        for event in &session.replay.events {
            on_event.send(event.clone()).map_err(|error| {
                format!(
                    "Could not attach {} terminal channel: {error}",
                    terminal_id.label()
                )
            })?;
        }
    } else {
        let generation = session.generation;
        let sequence = session.next_sequence();
        on_event
            .send(TerminalEvent::ReplayUnavailable {
                generation,
                sequence,
            })
            .map_err(|error| {
                format!(
                    "Could not attach {} terminal channel: {error}",
                    terminal_id.label()
                )
            })?;
    }
    session.replay.reset();
    session.channel = Some(on_event);
    Ok(session.status())
}

#[tauri::command]
pub fn terminal_status(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
) -> Result<TerminalStatus, String> {
    let slot = state.slot(terminal_id.clone());
    let status = slot.session()?.status();
    Ok(status)
}

#[tauri::command]
pub fn terminal_spawn<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TerminalState>,
    request: TerminalSpawnRequest,
) -> Result<TerminalStatus, String> {
    let terminal_id = request.terminal_id;
    let slot = state.slot(terminal_id.clone());
    match (&terminal_id, request.launch) {
        (TerminalId::Code | TerminalId::CodeWorkspace(_), TerminalLaunch::Hermes)
        | (TerminalId::Hermes, TerminalLaunch::OpenCode) => {
            return Err(format!(
                "{} cannot launch in the {} terminal",
                match request.launch {
                    TerminalLaunch::OpenCode => "OpenCode",
                    TerminalLaunch::Hermes => "Hermes",
                    TerminalLaunch::Shell => "A shell",
                },
                terminal_id.label()
            ));
        }
        _ => {}
    }
    validate_size(request.rows, request.cols)?;
    let cwd = canonical_working_directory(&request.cwd)?;
    let cwd_text = cwd
        .to_str()
        .ok_or_else(|| "The terminal workspace path must be valid Unicode".to_string())?
        .to_string();
    let mut launch_command = match request.launch {
        TerminalLaunch::Shell => None,
        TerminalLaunch::OpenCode => Some(quote_open_code_command(
            request.executable.as_deref(),
            &cwd,
        )?),
        TerminalLaunch::Hermes => Some(quote_hermes_command(request.executable.as_deref())?),
    };
    let opencode_tui_config = match request.launch {
        TerminalLaunch::Shell | TerminalLaunch::Hermes => None,
        TerminalLaunch::OpenCode => {
            Some(install_gchat_opencode_theme(&opencode_config_directory()?)?)
        }
    };
    let hermes_appearance = match request.launch {
        TerminalLaunch::Hermes => Some(request.appearance.unwrap_or(TerminalAppearance::Dark)),
        TerminalLaunch::Shell | TerminalLaunch::OpenCode => None,
    };
    if let Some(appearance) = hermes_appearance {
        install_gchat_hermes_skin(&super::system::commands::resolve_hermes_dir()?, appearance)?;
    }

    let _spawn_guard = slot.spawn_gate.lock().map_err(|_| {
        format!(
            "{} terminal spawn state is unavailable",
            terminal_id.label()
        )
    })?;
    slot.reap_finished_threads();

    {
        let session = slot.session()?;
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
            return Err(format!(
                "The {} terminal is already running; stop it before changing workspace or launch mode",
                terminal_id.label()
            ));
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
        .map_err(|error| format!("Could not create {} terminal: {error}", terminal_id.label()))?;
    let reader = pair.master.try_clone_reader().map_err(|error| {
        format!(
            "Could not open {} terminal output: {error}",
            terminal_id.label()
        )
    })?;
    let mut writer = pair.master.take_writer().map_err(|error| {
        format!(
            "Could not open {} terminal input: {error}",
            terminal_id.label()
        )
    })?;
    let mut command = command_for_shell(&cwd, opencode_tui_config.as_deref(), hermes_appearance);
    let mut bridge = None;
    if request.launch == TerminalLaunch::OpenCode {
        let inherited_config = std::env::var("OPENCODE_CONFIG_CONTENT").ok();
        let configured = super::system::opencode_config::read_merged_global_config(
            &opencode_config_directory()?,
        )?;
        let default_model =
            opencode_bridge_model(configured.as_ref(), inherited_config.as_deref())?;
        let connection = super::code_bridge::prepare_session(
            &app,
            &cwd,
            default_model,
            request.bridge_policy.unwrap_or_default(),
        )?;
        bridge = Some(BridgeLease(connection.session_id.clone()));
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        drop(listener);
        let password = uuid::Uuid::new_v4().simple().to_string();
        super::code_sessions::register_runtime(
            &connection.session_id,
            super::code_sessions::CodeRuntime {
                terminal_id: terminal_id.key(),
                directory: windows_cli_path(&cwd),
                port,
                password: password.clone(),
                executable: request.executable.clone(),
            },
        )?;
        command.env("OPENCODE_SERVER_PASSWORD", password);
        command.env("OPENCODE_SERVER_USERNAME", "opencode");
        command.env("GCHAT_BRIDGE_URL", &connection.url);
        if let Some(session_id) = request.code_session_id.as_deref() {
            if !session_id.starts_with("ses")
                || !session_id
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
            {
                return Err("Invalid OpenCode session ID".into());
            }
            command.env("GCHAT_CODE_SESSION", session_id);
        }
        if let Some(bytes) = launch_command.as_mut() {
            bytes.pop();
            bytes.extend_from_slice(format!(" --hostname 127.0.0.1 --port {port}").as_bytes());
            if let Some(session_id) = request.code_session_id.as_deref() {
                bytes.extend_from_slice(format!(" --session {session_id}").as_bytes());
            }
            bytes.push(b'\r');
        }
        let config = opencode_bridge_config(
            inherited_config.as_deref(),
            &connection.url,
            &opencode_config_directory()?.join("gchat-caller.mjs"),
        )?;
        command.env("OPENCODE_CONFIG_CONTENT", config);
        command.env("GCHAT_BRIDGE_TOKEN", connection.token);
    }
    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        format!(
            "Could not start {} terminal shell: {error}",
            terminal_id.label()
        )
    })?;
    drop(pair.slave);
    let mut killer = match terminal_child_killer(child.as_ref()) {
        Ok(killer) => killer,
        Err(error) => {
            #[cfg(windows)]
            let cleanup = child
                .as_raw_handle()
                .ok_or_else(|| std::io::Error::other("The terminal child has no process handle"))
                .and_then(WindowsTerminalKiller::terminate);
            #[cfg(not(windows))]
            let cleanup = child.kill();
            if let Err(cleanup_error) = cleanup {
                #[cfg(windows)]
                {
                    // Retain the original handle if even cleanup was refused.
                    let mut session = slot.session()?;
                    session.generation = session.generation.saturating_add(1).max(1);
                    session.phase = TerminalPhase::Running;
                    session.cwd = Some(cwd_text);
                    session.launch = Some(request.launch);
                    session.startup_child = Some(child);
                    session.writer = Some(writer);
                    session.master = Some(pair.master);
                    session.bridge = bridge;
                }
                return Err(format!(
                    "Could not own {} terminal stop handle: {error}; child cleanup failed: {cleanup_error}",
                    terminal_id.label()
                ));
            }
            drop(writer);
            drop(pair.master);
            let _ = child.wait();
            return Err(format!(
                "Could not own {} terminal stop handle: {error}",
                terminal_id.label()
            ));
        }
    };

    if let Some(command) = launch_command {
        if let Err(error) = writer.write_all(&command).and_then(|_| writer.flush()) {
            #[cfg(windows)]
            let cleanup = killer.kill();
            #[cfg(not(windows))]
            let _ = killer.kill();
            #[cfg(windows)]
            if let Err(cleanup_error) = cleanup {
                // Retain the exact child and killer so shutdown can retry a refused stop.
                let generation = {
                    let mut session = slot.session()?;
                    session.generation = session.generation.saturating_add(1).max(1);
                    session.phase = TerminalPhase::Running;
                    session.cwd = Some(cwd_text);
                    session.launch = Some(request.launch);
                    session.killer = Some(killer);
                    session.writer = Some(writer);
                    session.master = Some(pair.master);
                    session.bridge = bridge;
                    session.generation
                };
                slot.push_thread(start_waiter(
                    terminal_id.clone(),
                    slot.shared.clone(),
                    generation,
                    child,
                ))?;
                return Err(format!(
                    "Could not launch {} terminal: {error}; child cleanup failed: {cleanup_error}",
                    terminal_id.label()
                ));
            }
            drop(writer);
            drop(pair.master);
            let _ = child.wait();
            return Err(format!(
                "Could not launch {}: {error}",
                match request.launch {
                    TerminalLaunch::OpenCode => "OpenCode",
                    TerminalLaunch::Hermes => "Hermes",
                    TerminalLaunch::Shell => "terminal shell",
                }
            ));
        }
    }

    let generation;
    {
        let mut session = slot.session()?;
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
        session.bridge = bridge;
        session.flow_paused = false;
        session.replay.reset();

        let sequence = session.next_sequence();
        let status = session.status();
        session.publish(TerminalEvent::Started {
            generation,
            sequence,
            status,
        });
    }

    slot.push_thread(start_reader(
        terminal_id.clone(),
        slot.shared.clone(),
        generation,
        reader,
    ))?;
    slot.push_thread(start_waiter(
        terminal_id,
        slot.shared.clone(),
        generation,
        child,
    ))?;
    let status = slot.session()?.status();
    Ok(status)
}

#[tauri::command]
pub fn terminal_update_bridge_policy(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
    policy: super::code_bridge::BridgePolicy,
) -> Result<(), String> {
    if !terminal_id.is_code() {
        return Err("Only Code has a GChat bridge".into());
    }
    let slot = state.slot(terminal_id.clone());
    let session = slot.session()?;
    let bridge = session
        .bridge
        .as_ref()
        .ok_or("This Code workspace is not running")?;
    super::code_bridge::update_session_policy(&bridge.0, policy)
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

    let slot = state.slot(input.terminal_id.clone());
    let mut session = slot.session()?;
    if session.generation != input.generation || session.phase != TerminalPhase::Running {
        return Err(format!(
            "The {} terminal generation is no longer running",
            input.terminal_id.label()
        ));
    }
    let writer = session.writer.as_mut().ok_or_else(|| {
        format!(
            "{} terminal input is unavailable",
            input.terminal_id.label()
        )
    })?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| {
            format!(
                "Could not write to {} terminal: {error}",
                input.terminal_id.label()
            )
        })
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    validate_size(request.rows, request.cols)?;
    let slot = state.slot(request.terminal_id.clone());
    let session = slot.session()?;
    if session.generation != request.generation || session.phase != TerminalPhase::Running {
        return Err(format!(
            "The {} terminal generation is no longer running",
            request.terminal_id.label()
        ));
    }
    session
        .master
        .as_ref()
        .ok_or_else(|| format!("{} terminal is unavailable", request.terminal_id.label()))?
        .resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: request.pixel_width,
            pixel_height: request.pixel_height,
        })
        .map_err(|error| {
            format!(
                "Could not resize {} terminal: {error}",
                request.terminal_id.label()
            )
        })
}

#[tauri::command]
pub fn terminal_set_flow(
    state: State<'_, TerminalState>,
    request: TerminalFlowRequest,
) -> Result<(), String> {
    let slot = state.slot(request.terminal_id.clone());
    let mut session = slot.session()?;
    if session.generation != request.generation || session.phase != TerminalPhase::Running {
        return Err(format!(
            "The {} terminal generation is no longer running",
            request.terminal_id.label()
        ));
    }
    session.flow_paused = request.paused;
    if !request.paused {
        slot.shared.flow_changed.notify_all();
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_stop(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
) -> Result<TerminalStatus, String> {
    let slot = state.slot(terminal_id.clone());
    #[cfg(windows)]
    let startup_child;
    let (status, killer, writer, master) = {
        let mut session = slot.session()?;
        if session.phase != TerminalPhase::Running {
            return Ok(session.status());
        }
        #[cfg(windows)]
        {
            session.request_windows_stop().map_err(|error| {
                format!("Could not stop {} terminal: {error}", terminal_id.label())
            })?;
            startup_child = session.startup_child.take();
        }
        session.phase = TerminalPhase::Stopping;
        // Order the command snapshot against the waiter's exit event.
        session.next_sequence();
        session.bridge = None;
        session.flow_paused = false;
        slot.shared.flow_changed.notify_all();
        let status = session.status();
        (
            status,
            session.killer.take(),
            session.writer.take(),
            session.master.take(),
        )
    };
    #[cfg(not(windows))]
    let mut killer = killer;
    #[cfg(not(windows))]
    if let Some(killer) = killer.as_mut() {
        killer
            .kill()
            .map_err(|error| format!("Could not stop {} terminal: {error}", terminal_id.label()))?;
    }
    drop(killer);
    drop(writer);
    drop(master);
    #[cfg(windows)]
    if let Some(child) = startup_child {
        slot.push_thread(start_waiter(
            terminal_id,
            slot.shared.clone(),
            status.generation,
            child,
        ))?;
    }
    Ok(status)
}

fn opencode_config_directory() -> Result<PathBuf, String> {
    Ok(super::system::opencode_config::config_directory(
        &super::system::commands::agent_home_dir()?,
    ))
}

fn opencode_bridge_config(
    existing: Option<&str>,
    url: &str,
    caller_plugin: &Path,
) -> Result<String, String> {
    let mut config = match existing.filter(|content| !content.trim().is_empty()) {
        Some(content) => serde_json::from_str::<serde_json::Value>(content)
            .map_err(|_| "OPENCODE_CONFIG_CONTENT must contain a JSON object".to_string())?,
        None => serde_json::json!({}),
    };
    let root = config
        .as_object_mut()
        .ok_or("OPENCODE_CONFIG_CONTENT must contain a JSON object")?;
    let caller = url::Url::from_file_path(caller_plugin)
        .map_err(|_| "OpenCode caller plugin must have an absolute path")?
        .to_string();
    let plugins = root
        .entry("plugin")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or("OpenCode plugin configuration must be an array")?;
    if !plugins
        .iter()
        .any(|plugin| plugin.as_str() == Some(&caller))
    {
        plugins.push(serde_json::json!(caller));
    }
    let servers = root
        .entry("mcp")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("OpenCode MCP configuration must be an object")?;
    servers.insert(
        "gchat".into(),
        serde_json::json!({
            "type": "remote",
            "url": url,
            "enabled": true,
            "oauth": false,
            "headers": { "Authorization": "Bearer {env:GCHAT_BRIDGE_TOKEN}" }
        }),
    );
    serde_json::to_string(&config).map_err(|error| error.to_string())
}

fn opencode_bridge_model(
    configured: Option<&serde_json::Value>,
    inherited: Option<&str>,
) -> Result<Option<String>, String> {
    let inherited = inherited
        .filter(|content| !content.trim().is_empty())
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()
        .map_err(|_| "OPENCODE_CONFIG_CONTENT must contain a JSON object".to_string())?;
    Ok(inherited
        .as_ref()
        .and_then(|value| value.get("model"))
        .or_else(|| configured.and_then(|value| value.get("model")))
        .and_then(|model| model.as_str())
        .and_then(|model| model.strip_prefix("gchat/"))
        .filter(|model| !model.is_empty())
        .map(str::to_owned))
}

fn write_managed_terminal_asset(path: &Path, content: &str) -> Result<(), String> {
    if std::fs::read(path)
        .ok()
        .is_some_and(|existing| existing == content.as_bytes())
    {
        return Ok(());
    }
    std::fs::write(path, content)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

/// Install the GChat theme without changing the user's normal OpenCode theme.
/// Only the embedded process receives OPENCODE_TUI_CONFIG, while OpenCode's
/// required global theme directory contains the shared theme definition.
fn install_gchat_opencode_theme(config_directory: &Path) -> Result<PathBuf, String> {
    let theme_directory = config_directory.join("themes");
    std::fs::create_dir_all(&theme_directory).map_err(|error| {
        format!(
            "Could not create OpenCode theme directory {}: {error}",
            theme_directory.display()
        )
    })?;

    write_managed_terminal_asset(&theme_directory.join("gchat.json"), GCHAT_OPENCODE_THEME)?;
    write_managed_terminal_asset(
        &config_directory.join("gchat-caller.mjs"),
        GCHAT_OPENCODE_CALLER,
    )?;
    let startup = config_directory.join("gchat-startup.mjs");
    write_managed_terminal_asset(&startup, GCHAT_OPENCODE_STARTUP)?;
    let tui_config = config_directory.join("gchat-tui.json");
    let mut config: serde_json::Value =
        serde_json::from_str(GCHAT_OPENCODE_TUI_CONFIG).map_err(|error| error.to_string())?;
    config["plugin"] = serde_json::json!([url::Url::from_file_path(&startup)
        .map_err(|_| "OpenCode startup plugin must have an absolute path")?
        .to_string()]);
    write_managed_terminal_asset(
        &tui_config,
        &serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )?;
    Ok(tui_config)
}

fn patch_hermes_display_skin(content: &str, skin: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let display = lines.iter().position(|line| line.trim_end() == "display:");

    match display {
        Some(display_index) => {
            let block_end = (display_index + 1..lines.len())
                .find(|index| {
                    let line = &lines[*index];
                    !line.trim().is_empty()
                        && !line.starts_with(' ')
                        && !line.starts_with('\t')
                        && !line.starts_with('#')
                })
                .unwrap_or(lines.len());
            if let Some(skin_index) = (display_index + 1..block_end)
                .find(|index| lines[*index].trim_start().starts_with("skin:"))
            {
                lines[skin_index] = format!("  skin: {skin}");
            } else {
                lines.insert(display_index + 1, format!("  skin: {skin}"));
            }
        }
        None => {
            while lines.last().is_some_and(|line| line.trim().is_empty()) {
                lines.pop();
            }
            if !lines.is_empty() {
                lines.push(String::new());
            }
            lines.push("display:".to_string());
            lines.push(format!("  skin: {skin}"));
        }
    }

    let mut patched = lines.join("\n");
    if content.ends_with('\n') {
        patched.push('\n');
    }
    patched
}

/// Install both managed skins and select the one matching GChat's current
/// appearance. Hermes officially resolves custom skins from this directory
/// and reads `display.skin` at TUI startup, so no upstream files are patched.
fn install_gchat_hermes_skin(
    hermes_directory: &Path,
    appearance: TerminalAppearance,
) -> Result<(), String> {
    let skin_directory = hermes_directory.join("skins");
    std::fs::create_dir_all(&skin_directory).map_err(|error| {
        format!(
            "Could not create Hermes skin directory {}: {error}",
            skin_directory.display()
        )
    })?;
    write_managed_terminal_asset(
        &skin_directory.join("gchat-dark.yaml"),
        GCHAT_HERMES_DARK_SKIN,
    )?;
    write_managed_terminal_asset(
        &skin_directory.join("gchat-light.yaml"),
        GCHAT_HERMES_LIGHT_SKIN,
    )?;

    let config_path = hermes_directory.join("config.yaml");
    let content = std::fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "Could not read Hermes configuration {}: {error}",
            config_path.display()
        )
    })?;
    let skin = match appearance {
        TerminalAppearance::Dark => "gchat-dark",
        TerminalAppearance::Light => "gchat-light",
    };
    let patched = patch_hermes_display_skin(&content, skin);
    write_managed_terminal_asset(&config_path, &patched)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenCodeConfigurationState {
    Missing,
    Invalid,
    Ready,
}

fn opencode_configuration_state(directory: &Path) -> Result<OpenCodeConfigurationState, String> {
    let Some(root) = super::system::opencode_config::read_merged_global_config(directory)? else {
        return Ok(OpenCodeConfigurationState::Missing);
    };
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
    let config_directory = opencode_config_directory()?;
    let config_path = super::system::opencode_config::writable_config_path(&config_directory);
    let config_state = match opencode_configuration_state(&config_directory) {
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

fn hermes_configuration_state(directory: &Path) -> Result<OpenCodeConfigurationState, String> {
    let config_path = directory.join("config.yaml");
    if !config_path.is_file() {
        return Ok(OpenCodeConfigurationState::Missing);
    }
    let content = std::fs::read_to_string(&config_path)
        .map_err(|error| format!("Could not read {}: {error}", config_path.display()))?;
    let root: serde_yaml::Value = match serde_yaml::from_str(&content) {
        Ok(value) => value,
        Err(_) => return Ok(OpenCodeConfigurationState::Invalid),
    };
    let Some(model) = root.get("model") else {
        return Ok(OpenCodeConfigurationState::Missing);
    };
    let model_id = model
        .get("default")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default();
    let provider = model
        .get("provider")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default();
    let base_url = model
        .get("base_url")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default();
    let valid_url = url::Url::parse(base_url).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
            )
    });
    if provider != "custom" || model_id.is_empty() || !valid_url {
        return Ok(OpenCodeConfigurationState::Invalid);
    }

    let provider_ready = root
        .get("custom_providers")
        .and_then(serde_yaml::Value::as_sequence)
        .is_some_and(|providers| {
            providers.iter().any(|candidate| {
                candidate.get("name").and_then(serde_yaml::Value::as_str) == Some("gchat")
                    && candidate.get("model").and_then(serde_yaml::Value::as_str) == Some(model_id)
                    && candidate
                        .get("models")
                        .and_then(|models| models.get(model_id))
                        .and_then(|model| model.get("context_length"))
                        .and_then(serde_yaml::Value::as_u64)
                        .is_some_and(|context| context >= 65_536)
            })
        });
    Ok(if provider_ready {
        OpenCodeConfigurationState::Ready
    } else {
        OpenCodeConfigurationState::Invalid
    })
}

#[tauri::command]
pub async fn hermes_readiness(custom_path: Option<String>) -> Result<HermesReadiness, String> {
    let detection =
        super::system::commands::detect_agent_installed("hermes".to_string(), custom_path).await;
    let directory = super::system::commands::resolve_hermes_dir()?;
    let config_path = directory.join("config.yaml");
    let config_state = match hermes_configuration_state(&directory) {
        Ok(state) => state,
        Err(error) => {
            log::debug!("Hermes readiness config error: {error}");
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
    Ok(HermesReadiness {
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

    #[test]
    fn default_opencode_command_uses_the_windows_application_shim() {
        assert_eq!(default_open_code_command(true), "opencode.cmd");
        assert_eq!(default_open_code_command(false), "opencode");
    }

    #[test]
    fn opencode_receives_the_workspace_as_its_project_path() {
        assert_eq!(
            format_open_code_command(None, Path::new(r"\\?\C:\Users\Ron\Agent Work"), true),
            "opencode.cmd 'C:\\Users\\Ron\\Agent Work'\r"
        );
        assert_eq!(
            format_open_code_command(None, Path::new("/home/ron/agent work"), false),
            "opencode '/home/ron/agent work'\r"
        );
    }

    #[test]
    fn embedded_bridge_preserves_other_opencode_configuration() {
        let config = opencode_bridge_config(
            Some(r#"{"model":"gchat/model","plugin":["file:///user/custom.mjs"],"mcp":{"other":{"type":"local","command":["tool"]}}}"#),
            "http://127.0.0.1:12345/mcp/session",
            &std::env::temp_dir().join("gchat-caller.mjs"),
        )
        .unwrap();
        let config: serde_json::Value = serde_json::from_str(&config).unwrap();
        assert_eq!(config["plugin"][0], "file:///user/custom.mjs");
        assert_eq!(
            config["plugin"][1],
            url::Url::from_file_path(std::env::temp_dir().join("gchat-caller.mjs"))
                .unwrap()
                .to_string()
        );
        assert_eq!(config["model"], "gchat/model");
        assert_eq!(config["mcp"]["other"]["command"][0], "tool");
        assert_eq!(
            config["mcp"]["gchat"]["url"],
            "http://127.0.0.1:12345/mcp/session"
        );
        assert_eq!(
            config["mcp"]["gchat"]["headers"]["Authorization"],
            "Bearer {env:GCHAT_BRIDGE_TOKEN}"
        );
        assert_eq!(config["mcp"]["gchat"]["oauth"], false);
    }

    #[test]
    fn embedded_bridge_rejects_invalid_inherited_configuration() {
        for config in ["not json", "[]", r#"{"mcp":false}"#, r#"{"plugin":false}"#] {
            assert!(opencode_bridge_config(
                Some(config),
                "http://127.0.0.1:1/mcp",
                &std::env::temp_dir().join("gchat-caller.mjs")
            )
            .is_err());
        }
        assert!(opencode_bridge_config(
            None,
            "http://127.0.0.1:1/mcp",
            &std::env::temp_dir().join("gchat-caller.mjs")
        )
        .is_ok());
    }

    #[test]
    fn bridge_inherits_the_configured_gchat_model() {
        let global = serde_json::json!({"model":"gchat/qwen/model"});
        assert_eq!(
            opencode_bridge_model(Some(&global), None)
                .unwrap()
                .as_deref(),
            Some("qwen/model")
        );
        assert_eq!(
            opencode_bridge_model(Some(&global), Some(r#"{"model":"gchat/muse"}"#))
                .unwrap()
                .as_deref(),
            Some("muse")
        );
        assert!(
            opencode_bridge_model(Some(&global), Some(r#"{"model":"other/model"}"#))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn hermes_uses_the_modern_tui_entry_point() {
        assert_eq!(format_hermes_command(None, false), "hermes --tui\r");
        assert_eq!(
            format_hermes_command(Some(r"C:\Program Files\Hermes\hermes.exe"), true),
            "& 'C:\\Program Files\\Hermes\\hermes.exe' --tui\r"
        );
    }

    #[test]
    fn code_and_hermes_sessions_are_independent() {
        let state = TerminalState::default();
        state.slot(TerminalId::Code).session().unwrap().phase = TerminalPhase::Running;
        assert_eq!(
            state.slot(TerminalId::Code).session().unwrap().phase,
            TerminalPhase::Running
        );
        assert_eq!(
            state.slot(TerminalId::Hermes).session().unwrap().phase,
            TerminalPhase::Idle
        );
    }

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

    #[cfg(windows)]
    #[test]
    fn native_shell_uses_normal_windows_workspace_paths() {
        for (input, expected) in [
            (
                r"\\?\C:\Users\Ron\agent-workspace",
                r"C:\Users\Ron\agent-workspace",
            ),
            (
                r"\\?\UNC\server\share\workspace",
                r"\\server\share\workspace",
            ),
        ] {
            let command = command_for_shell(Path::new(input), None, Some(TerminalAppearance::Dark));
            assert_eq!(command.get_cwd().unwrap(), std::ffi::OsStr::new(expected));
        }
    }

    #[test]
    fn gchat_opencode_configuration_requires_the_selected_registered_model() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            opencode_configuration_state(temp.path()),
            Ok(OpenCodeConfigurationState::Missing)
        );
        std::fs::write(
            temp.path().join("opencode.jsonc"),
            r#"{
                // GChat accepts the same JSONC syntax as OpenCode.
                "provider": {
                    "gchat": {
                        "npm": "@ai-sdk/openai-compatible",
                        "options": { "baseURL": "http://localhost:2468/custom-openai", "apiKey": "gchat" },
                        "models": { "qwen": { "name": "qwen" } },
                    },
                },
                "model": "gchat/qwen",
            }"#,
        )
        .unwrap();
        assert_eq!(
            opencode_configuration_state(temp.path()),
            Ok(OpenCodeConfigurationState::Ready)
        );

        std::fs::write(
            temp.path().join("opencode.jsonc"),
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
            opencode_configuration_state(temp.path()),
            Ok(OpenCodeConfigurationState::Invalid)
        );
    }

    #[test]
    fn embedded_opencode_theme_is_complete_and_does_not_replace_global_selection() {
        const REQUIRED_THEME_KEYS: [&str; 41] = [
            "primary",
            "secondary",
            "accent",
            "error",
            "warning",
            "success",
            "info",
            "text",
            "textMuted",
            "background",
            "backgroundPanel",
            "backgroundElement",
            "border",
            "borderActive",
            "borderSubtle",
            "diffAdded",
            "diffRemoved",
            "diffContext",
            "diffHunkHeader",
            "diffHighlightAdded",
            "diffHighlightRemoved",
            "diffAddedBg",
            "diffRemovedBg",
            "diffContextBg",
            "diffLineNumber",
            "diffAddedLineNumberBg",
            "diffRemovedLineNumberBg",
            "markdownText",
            "markdownHeading",
            "markdownLink",
            "markdownLinkText",
            "markdownCode",
            "markdownBlockQuote",
            "markdownEmph",
            "markdownStrong",
            "markdownHorizontalRule",
            "markdownListItem",
            "markdownListEnumeration",
            "markdownImage",
            "markdownImageText",
            "markdownCodeBlock",
        ];

        let theme: serde_json::Value = serde_json::from_str(GCHAT_OPENCODE_THEME).unwrap();
        let tokens = theme
            .get("theme")
            .and_then(|value| value.as_object())
            .unwrap();
        assert_eq!(tokens["secondary"], tokens["primary"]);
        for key in REQUIRED_THEME_KEYS {
            assert!(
                tokens.contains_key(key),
                "missing OpenCode theme token {key}"
            );
        }
        for key in [
            "syntaxComment",
            "syntaxKeyword",
            "syntaxFunction",
            "syntaxVariable",
            "syntaxString",
            "syntaxNumber",
            "syntaxType",
            "syntaxOperator",
            "syntaxPunctuation",
        ] {
            assert!(
                tokens.contains_key(key),
                "missing OpenCode syntax token {key}"
            );
        }

        let temp = tempfile::tempdir().unwrap();
        let tui_path = install_gchat_opencode_theme(temp.path()).unwrap();
        assert_eq!(tui_path, temp.path().join("gchat-tui.json"));
        assert_eq!(
            std::fs::read_to_string(temp.path().join("themes/gchat.json")).unwrap(),
            GCHAT_OPENCODE_THEME
        );
        let tui: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&tui_path).unwrap()).unwrap();
        assert_eq!(
            tui.get("theme").and_then(|value| value.as_str()),
            Some("gchat")
        );
        assert!(!temp.path().join("tui.json").exists());

        std::fs::write(temp.path().join("themes/gchat.json"), "{}").unwrap();
        install_gchat_opencode_theme(temp.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(temp.path().join("themes/gchat.json")).unwrap(),
            GCHAT_OPENCODE_THEME
        );
    }

    #[test]
    fn embedded_hermes_skins_are_valid_and_select_the_current_appearance() {
        for skin in [GCHAT_HERMES_DARK_SKIN, GCHAT_HERMES_LIGHT_SKIN] {
            let value: serde_yaml::Value = serde_yaml::from_str(skin).unwrap();
            assert_eq!(
                value
                    .get("colors")
                    .and_then(|colors| colors.get("ui_accent"))
                    .and_then(serde_yaml::Value::as_str),
                Some(if skin == GCHAT_HERMES_DARK_SKIN {
                    "#3DD3C8"
                } else {
                    "#0B6B6B"
                })
            );
        }

        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.yaml"),
            "model:\n  default: qwen\ndisplay:\n  skin: default\n",
        )
        .unwrap();
        install_gchat_hermes_skin(temp.path(), TerminalAppearance::Dark).unwrap();
        let configured = std::fs::read_to_string(temp.path().join("config.yaml")).unwrap();
        assert!(configured.contains("  skin: gchat-dark"));
        assert!(temp.path().join("skins/gchat-dark.yaml").is_file());
        assert!(temp.path().join("skins/gchat-light.yaml").is_file());

        install_gchat_hermes_skin(temp.path(), TerminalAppearance::Light).unwrap();
        let configured = std::fs::read_to_string(temp.path().join("config.yaml")).unwrap();
        assert!(configured.contains("  skin: gchat-light"));
        assert_eq!(configured.matches("  skin:").count(), 1);
    }

    #[test]
    fn hermes_readiness_requires_the_exact_local_provider_contract() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.yaml"),
            "model:\n  default: qwen\n  provider: custom\n  base_url: http://127.0.0.1:1337/v1\ncustom_providers:\n- name: gchat\n  base_url: http://127.0.0.1:1337/v1\n  model: qwen\n  models:\n    qwen:\n      context_length: 65536\n",
        )
        .unwrap();
        assert_eq!(
            hermes_configuration_state(temp.path()),
            Ok(OpenCodeConfigurationState::Ready)
        );

        std::fs::write(
            temp.path().join("config.yaml"),
            "model:\n  default: qwen\n  provider: custom\n  base_url: https://remote.example/v1\ncustom_providers: []\n",
        )
        .unwrap();
        assert_eq!(
            hermes_configuration_state(temp.path()),
            Ok(OpenCodeConfigurationState::Invalid)
        );
    }

    #[cfg(windows)]
    struct WindowsPtyChild {
        child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
        killer: WindowsTerminalKiller,
        master: Option<Box<dyn MasterPty + Send>>,
        writer: Option<Box<dyn Write + Send>>,
    }

    #[cfg(windows)]
    impl WindowsPtyChild {
        fn spawn(executable: &str, arguments: &[&str]) -> Self {
            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let writer = pair.master.take_writer().unwrap();
            let mut command = CommandBuilder::new(executable);
            command.args(arguments);
            let child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            let killer = WindowsTerminalKiller::duplicate(child.as_raw_handle().unwrap()).unwrap();
            Self {
                child: Some(child),
                killer,
                master: Some(pair.master),
                writer: Some(writer),
            }
        }

        fn wait_for_exit(&self) {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::WAIT_OBJECT_0,
                System::Threading::WaitForSingleObject,
            };
            assert_eq!(
                unsafe { WaitForSingleObject(self.killer.process.as_raw_handle(), 5000) },
                WAIT_OBJECT_0,
                "native terminal child did not exit within five seconds"
            );
        }
    }

    #[cfg(windows)]
    impl Drop for WindowsPtyChild {
        fn drop(&mut self) {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::WAIT_OBJECT_0,
                System::Threading::WaitForSingleObject,
            };
            let _ = self.killer.kill();
            self.writer.take();
            self.master.take();
            if unsafe { WaitForSingleObject(self.killer.process.as_raw_handle(), 5000) }
                == WAIT_OBJECT_0
            {
                if let Some(child) = self.child.as_mut() {
                    let _ = child.wait();
                }
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_killer_stops_real_conpty_child_and_retains_clone() {
        let mut process = WindowsPtyChild::spawn(
            "powershell.exe",
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 15",
            ],
        );
        let killer = terminal_child_killer(process.child.as_ref().unwrap().as_ref()).unwrap();
        let mut clone = killer.clone_killer();
        drop(killer);
        let slot = TerminalSlot::new(TerminalId::Code);
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.generation = 1;
        }
        let waiter = start_waiter(
            TerminalId::Code,
            slot.shared.clone(),
            1,
            process.child.take().unwrap(),
        );
        clone.kill().unwrap();
        process.wait_for_exit();
        waiter.join().unwrap();
        let status = slot.session().unwrap().status();
        assert_eq!(status.phase, TerminalPhase::Exited);
        assert_eq!(status.exit_code, Some(1));
        // The waiter has dropped the source child handle; the clone still owns its handle.
        clone.kill().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_killer_accepts_only_proven_already_exited_child() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{
            Foundation::WAIT_OBJECT_0,
            System::Threading::WaitForSingleObject,
        };

        let mut process = WindowsPtyChild::spawn("cmd.exe", &["/D", "/C", "exit 7"]);
        let mut reader = process.master.as_ref().unwrap().try_clone_reader().unwrap();
        let mut writer = process.writer.take().unwrap();
        // Match the terminal's cursor report while continuously draining ConPTY output.
        let consumer = std::thread::spawn(move || -> std::io::Result<(Vec<u8>, usize)> {
            let mut output = Vec::new();
            let mut replies = 0;
            let mut buffer = [0; 256];
            loop {
                let count = reader.read(&mut buffer)?;
                if count == 0 {
                    return Ok((output, replies));
                }
                let search_from = output.len().saturating_sub(3);
                output.extend_from_slice(&buffer[..count]);
                for _ in 0..output[search_from..]
                    .windows(4)
                    .filter(|sequence| *sequence == b"\x1b[6n")
                    .count()
                {
                    writer.write_all(b"\x1b[1;1R")?;
                    writer.flush()?;
                    replies += 1;
                }
            }
        });
        let mut killer = process.killer.clone();
        let observed = unsafe { WaitForSingleObject(killer.process.as_raw_handle(), 5000) };
        let natural_status = if observed == WAIT_OBJECT_0 {
            Some(process.child.as_mut().unwrap().wait())
        } else {
            None
        };
        // Close ConPTY with its output consumer alive, then join before any material assertion.
        drop(process);
        let consumed = consumer.join().unwrap();
        eprintln!("ConPTY natural-exit output/cursor replies: {consumed:?}");
        let (_, replies) = consumed.unwrap();
        assert_eq!(
            observed, WAIT_OBJECT_0,
            "native terminal child did not exit within five seconds"
        );
        assert!(replies > 0, "ConPTY did not emit a cursor-position query");
        assert_eq!(natural_status.unwrap().unwrap().exit_code(), 7);
        // The source child handle is closed; only the pinned duplicate remains.
        killer.kill().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_denied_live_stop_preserves_shutdown_retry_ownership() {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::{
            Foundation::{DuplicateHandle, WAIT_TIMEOUT},
            System::Threading::{GetCurrentProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };

        let mut process = WindowsPtyChild::spawn(
            "powershell.exe",
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 15",
            ],
        );
        let mut restricted = std::ptr::null_mut();
        assert_ne!(
            unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    process.killer.process.as_raw_handle(),
                    GetCurrentProcess(),
                    &mut restricted,
                    PROCESS_SYNCHRONIZE,
                    0,
                    0,
                )
            },
            0
        );
        let restricted = unsafe { OwnedHandle::from_raw_handle(restricted) };
        let mut denied = WindowsTerminalKiller {
            process: Arc::new(restricted),
        };
        assert_eq!(denied.kill().unwrap_err().raw_os_error(), Some(5));
        assert_eq!(
            unsafe { WaitForSingleObject(denied.process.as_raw_handle(), 0) },
            WAIT_TIMEOUT
        );

        let state = TerminalState::default();
        let slot = state.slot(TerminalId::Code);
        let harness = crate::test_support::IpcTestHarness::new(|builder| {
            builder
                .manage(state)
                .invoke_handler(tauri::generate_handler![terminal_status, terminal_stop])
        });
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.generation = 1;
            session.flow_paused = true;
            session.bridge = Some(BridgeLease("oi068-denied-live-test".into()));
            session.killer = Some(Box::new(denied));
            session.writer = process.writer.take();
            session.master = process.master.take();
        }
        let error = harness
            .invoke::<serde_json::Value>("terminal_stop", serde_json::json!({"terminalId": "code"}))
            .unwrap_err();
        let error = error.as_str().unwrap();
        assert!(error.starts_with("Could not stop Code terminal:"));
        assert!(error.contains("os error 5"));
        assert_eq!(slot.session().unwrap().status().sequence, 0);
        slot.shutdown();
        {
            let mut session = slot.session().unwrap();
            assert_eq!(session.phase, TerminalPhase::Running);
            assert!(session.flow_paused);
            assert!(session.bridge.is_some());
            assert!(session.writer.is_some());
            assert!(session.master.is_some());
            assert!(session.killer.is_some());
            session.killer = Some(Box::new(process.killer.clone()));
        }
        let waiter = start_waiter(
            TerminalId::Code,
            slot.shared.clone(),
            1,
            process.child.take().unwrap(),
        );
        let stopped_wire = harness
            .invoke::<serde_json::Value>("terminal_stop", serde_json::json!({"terminalId": "code"}))
            .unwrap();
        assert_eq!(stopped_wire["phase"], "stopping");
        assert_eq!(stopped_wire["generation"], 1);
        assert_eq!(stopped_wire["sequence"], 1);
        let stopped_sequence = stopped_wire["sequence"].as_u64().unwrap();
        process.wait_for_exit();
        waiter.join().unwrap();
        let status = slot.session().unwrap().status();
        assert_eq!(status.phase, TerminalPhase::Exited);
        assert_eq!(status.exit_code, Some(1));
        assert!(status.sequence > stopped_sequence);
        let exited_wire = harness
            .invoke::<serde_json::Value>("terminal_status", serde_json::json!({"terminalId": "code"}))
            .unwrap();
        assert_eq!(exited_wire["phase"], "exited");
        assert_eq!(exited_wire["exitCode"], 1);
        assert_eq!(exited_wire["sequence"], status.sequence);
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_shutdown_reaps_owned_startup_child() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Threading::GetExitCodeProcess;

        let mut process = WindowsPtyChild::spawn(
            "powershell.exe",
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 15",
            ],
        );
        let slot = TerminalSlot::new(TerminalId::Code);
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.startup_child = process.child.take();
            session.writer = process.writer.take();
            session.master = process.master.take();
        }
        slot.shutdown();
        process.wait_for_exit();
        let mut code = 0;
        assert_ne!(
            unsafe { GetExitCodeProcess(process.killer.process.as_raw_handle(), &mut code) },
            0
        );
        assert_eq!(code, 1);
        assert!(slot.session().unwrap().startup_child.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn real_pty_runs_a_shell_and_captures_output() {
        let state = TerminalState::default();
        let temp = tempfile::tempdir().unwrap();
        let request = TerminalSpawnRequest {
            terminal_id: TerminalId::Code,
            cwd: temp.path().to_string_lossy().into_owned(),
            rows: 24,
            cols: 80,
            launch: TerminalLaunch::Shell,
            executable: None,
            appearance: None,
            code_session_id: None,
            bridge_policy: None,
        };

        // Exercise the same portable-pty primitives as the command without a
        // Tauri runtime; command/state extraction itself is generated by Tauri.
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize::default()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let tui_config = temp.path().join("gchat-tui.json");
        let mut command = command_for_shell(
            &canonical_working_directory(&request.cwd).unwrap(),
            Some(&tui_config),
            None,
        );
        command.env("PS1", "");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        writer.write_all(b"printf '__GCHAT_PTY_OK__\\n'\r").unwrap();
        writer
            .write_all(b"printf '__GCHAT_TUI__%s\\n' \"$OPENCODE_TUI_CONFIG\"\r")
            .unwrap();
        writer.write_all(b"exit\r").unwrap();
        writer.flush().unwrap();
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();
        let status = child.wait().unwrap();
        assert!(status.success());
        assert!(output.contains("__GCHAT_PTY_OK__"));
        assert!(output.contains("__GCHAT_TUI__"));
        assert!(output.contains("gchat-tui.json"));
        state.shutdown();
    }
}
