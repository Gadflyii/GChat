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
const GCHAT_OPENCODE_THEME: &str = include_str!("../../resources/opencode/gchat.json");
const GCHAT_OPENCODE_TUI_CONFIG: &str = include_str!("../../resources/opencode/gchat-tui.json");
const GCHAT_HERMES_DARK_SKIN: &str = include_str!("../../resources/hermes/gchat-dark.yaml");
const GCHAT_HERMES_LIGHT_SKIN: &str = include_str!("../../resources/hermes/gchat-light.yaml");

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalId {
    Code,
    Hermes,
}

impl TerminalId {
    fn label(self) -> &'static str {
        match self {
            Self::Code => "Code",
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
                log::debug!(
                    "{} terminal child was already stopped: {error}",
                    self.id.label()
                );
            }
        }
        drop(writer);
        drop(master);

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
    code: TerminalSlot,
    hermes: TerminalSlot,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            code: TerminalSlot::new(TerminalId::Code),
            hermes: TerminalSlot::new(TerminalId::Hermes),
        }
    }
}

impl TerminalState {
    fn slot(&self, id: TerminalId) -> &TerminalSlot {
        match id {
            TerminalId::Code => &self.code,
            TerminalId::Hermes => &self.hermes,
        }
    }

    pub fn shutdown(&self) {
        self.code.shutdown();
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
        .expect("failed to spawn embedded terminal waiter")
}

#[tauri::command]
pub fn terminal_attach(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalStatus, String> {
    let slot = state.slot(terminal_id);
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
    Ok(state.slot(terminal_id).session()?.status())
}

#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalState>,
    request: TerminalSpawnRequest,
) -> Result<TerminalStatus, String> {
    let terminal_id = request.terminal_id;
    let slot = state.slot(terminal_id);
    match (terminal_id, request.launch) {
        (TerminalId::Code, TerminalLaunch::Hermes)
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
    let launch_command = match request.launch {
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
    let command = command_for_shell(&cwd, opencode_tui_config.as_deref(), hermes_appearance);
    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        format!(
            "Could not start {} terminal shell: {error}",
            terminal_id.label()
        )
    })?;
    drop(pair.slave);
    let mut killer = child.clone_killer();

    if let Some(command) = launch_command {
        if let Err(error) = writer.write_all(&command).and_then(|_| writer.flush()) {
            let _ = killer.kill();
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

    slot.push_thread(start_reader(
        terminal_id,
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
    Ok(slot.session()?.status())
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

    let slot = state.slot(input.terminal_id);
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
    let slot = state.slot(request.terminal_id);
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
    let slot = state.slot(request.terminal_id);
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
    let slot = state.slot(terminal_id);
    let (status, mut killer, writer, master) = {
        let mut session = slot.session()?;
        if session.phase != TerminalPhase::Running {
            return Ok(session.status());
        }
        session.phase = TerminalPhase::Stopping;
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
    if let Some(killer) = killer.as_mut() {
        killer
            .kill()
            .map_err(|error| format!("Could not stop {} terminal: {error}", terminal_id.label()))?;
    }
    drop(writer);
    drop(master);
    Ok(status)
}

fn opencode_config_directory() -> Result<PathBuf, String> {
    Ok(super::system::opencode_config::config_directory(
        &super::system::commands::agent_home_dir()?,
    ))
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
    let tui_config = config_directory.join("gchat-tui.json");
    write_managed_terminal_asset(&tui_config, GCHAT_OPENCODE_TUI_CONFIG)?;
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
