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

#[cfg(target_os = "linux")]
struct LinuxReaderCancellation {
    stopped: std::sync::atomic::AtomicBool,
    wake: std::os::unix::net::UnixStream,
    finished: Mutex<bool>,
    finished_changed: Condvar,
}

#[cfg(target_os = "linux")]
impl LinuxReaderCancellation {
    fn cancel(&self) {
        if !self.stopped.swap(true, std::sync::atomic::Ordering::AcqRel) {
            // One byte wakes poll even when no child writes to the terminal.
            // Repeated Stop and waiter completion share this idempotent wakeup.
            let _ = (&self.wake).write_all(&[1]);
        }
    }

    fn wait_finished(&self) -> std::io::Result<()> {
        let finished = self
            .finished
            .lock()
            .map_err(|_| std::io::Error::other("Linux terminal reader state is unavailable"))?;
        let (finished, _) = self
            .finished_changed
            .wait_timeout_while(finished, std::time::Duration::from_secs(2), |done| !*done)
            .map_err(|_| std::io::Error::other("Linux terminal reader state is unavailable"))?;
        if !*finished {
            // Normal exit drains the PTY to EOF. An escaped slave handle or a
            // broken reader must still have a bounded, retryable cancellation.
            self.cancel();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Linux terminal output did not drain before the deadline",
            ));
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
struct LinuxPtyReader {
    pty: std::fs::File,
    wake: std::os::unix::net::UnixStream,
    cancellation: Arc<LinuxReaderCancellation>,
}

#[cfg(target_os = "linux")]
impl LinuxPtyReader {
    fn new(master: &dyn MasterPty) -> std::io::Result<(Self, Arc<LinuxReaderCancellation>)> {
        use std::os::fd::BorrowedFd;
        let fd = master
            .as_raw_fd()
            .ok_or_else(|| std::io::Error::other("The Linux terminal has no PTY descriptor"))?;
        // The master remains alive while its descriptor is duplicated.
        let pty = unsafe { BorrowedFd::borrow_raw(fd) }.try_clone_to_owned()?;
        let (wake, signal) = std::os::unix::net::UnixStream::pair()?;
        signal.set_nonblocking(true)?;
        let cancellation = Arc::new(LinuxReaderCancellation {
            stopped: std::sync::atomic::AtomicBool::new(false),
            wake: signal,
            finished: Mutex::new(false),
            finished_changed: Condvar::new(),
        });
        // File owns the duplicate, independently of the writer/master handles.
        Ok((
            Self {
                pty: std::fs::File::from(pty),
                wake,
                cancellation: cancellation.clone(),
            },
            cancellation,
        ))
    }
}

#[cfg(target_os = "linux")]
impl Read for LinuxPtyReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        use nix::libc;
        use std::os::fd::AsRawFd;
        if buffer.is_empty() {
            return Ok(0);
        }
        loop {
            if self
                .cancellation
                .stopped
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return Ok(0);
            }
            let mut fds = [
                libc::pollfd {
                    fd: self.pty.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
                libc::pollfd {
                    fd: self.wake.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
            ];
            if unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, -1) } < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            if fds[1].revents != 0 {
                return Ok(0);
            }
            if fds[0].revents != 0 {
                // This is the sole reader of this PTY. Match portable-pty's
                // Linux EIO-as-EOF behavior after the final slave closes.
                return match self.pty.read(buffer) {
                    Err(error) if error.raw_os_error() == Some(libc::EIO) => Ok(0),
                    result => result,
                };
            }
        }
    }
}

#[cfg(target_os = "linux")]
impl Drop for LinuxPtyReader {
    fn drop(&mut self) {
        if let Ok(mut finished) = self.cancellation.finished.lock() {
            // The reader thread has already published every byte it consumed.
            *finished = true;
            self.cancellation.finished_changed.notify_all();
        }
    }
}

#[cfg(target_os = "linux")]
struct LinuxSessionChild {
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    status: Option<portable_pty::ExitStatus>,
}

#[cfg(target_os = "linux")]
struct LinuxPtySession {
    sid: nix::libc::pid_t,
    child: Mutex<LinuxSessionChild>,
    reader: Arc<LinuxReaderCancellation>,
}

#[cfg(target_os = "linux")]
impl LinuxPtySession {
    fn new(
        child: Box<dyn portable_pty::Child + Send + Sync>,
        reader: Arc<LinuxReaderCancellation>,
    ) -> Self {
        // portable-pty calls setsid before exec and its Unix child always has a PID.
        let sid = child
            .process_id()
            .expect("Linux PTY child has a process ID") as _;
        Self {
            sid,
            child: Mutex::new(LinuxSessionChild {
                child: Some(child),
                status: None,
            }),
            reader,
        }
    }

    fn members(&self) -> std::io::Result<Vec<std::os::fd::OwnedFd>> {
        use nix::libc;
        use std::os::fd::{AsRawFd, FromRawFd};
        let mut members = Vec::new();
        for entry in std::fs::read_dir("/proc")? {
            let entry = entry?;
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<libc::pid_t>().ok())
            else {
                continue;
            };
            if unsafe { libc::getsid(pid) } != self.sid {
                continue;
            }
            let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
            if fd < 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ESRCH) {
                    continue;
                }
                return Err(error);
            }
            let fd = unsafe { std::os::fd::OwnedFd::from_raw_fd(fd as _) };
            // Recheck membership after pinning. Signals always target the pinned
            // process, never a numeric PID that could have been reused meanwhile.
            if unsafe { libc::getsid(pid) } != self.sid {
                continue;
            }
            let mut exited = libc::pollfd {
                fd: fd.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            if unsafe { libc::poll(&mut exited, 1, 0) } < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if exited.revents == 0 {
                members.push(fd);
            }
        }
        Ok(members)
    }

    fn signal(members: &[std::os::fd::OwnedFd], signal: i32) -> std::io::Result<()> {
        use nix::libc;
        use std::os::fd::AsRawFd;
        for member in members {
            if unsafe {
                libc::syscall(
                    libc::SYS_pidfd_send_signal,
                    member.as_raw_fd(),
                    signal,
                    std::ptr::null::<libc::siginfo_t>(),
                    0,
                )
            } < 0
            {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::ESRCH) {
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn request_stop(&self) -> std::io::Result<()> {
        use nix::libc;
        let owned = self
            .child
            .lock()
            .map_err(|_| std::io::Error::other("Linux terminal ownership is unavailable"))?;
        if owned.status.is_none() {
            let members = self.members()?;
            Self::signal(&members, libc::SIGCONT)?;
            Self::signal(&members, libc::SIGHUP)?;
        }
        self.reader.cancel();
        Ok(())
    }

    fn terminate(&self) -> std::io::Result<portable_pty::ExitStatus> {
        self.reader.cancel();
        self.drain()
    }

    fn drain(&self) -> std::io::Result<portable_pty::ExitStatus> {
        use nix::libc;
        use std::time::{Duration, Instant};
        let mut owned = self
            .child
            .lock()
            .map_err(|_| std::io::Error::other("Linux terminal ownership is unavailable"))?;
        if let Some(status) = owned.status.as_ref() {
            return Ok(status.clone());
        }
        // The leader stays live or unreaped throughout this scan/escalation. Its
        // reserved PID therefore cannot become an unrelated session's ID, even
        // after its descendants have been reparented to init.
        for (signal, grace) in [
            (libc::SIGHUP, Duration::from_millis(200)),
            (libc::SIGTERM, Duration::from_millis(200)),
            (libc::SIGKILL, Duration::from_secs(1)),
        ] {
            let deadline = Instant::now() + grace;
            loop {
                let members = self.members()?;
                if members.is_empty() {
                    let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
                    if unsafe {
                        libc::waitid(
                            libc::P_PID,
                            self.sid as _,
                            info.as_mut_ptr(),
                            libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
                        )
                    } < 0
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    if unsafe { info.assume_init().si_pid() } != self.sid {
                        return Err(std::io::Error::other(
                            "Linux terminal leader has not exited",
                        ));
                    }
                    // A pidfd reports zombies as exited; wait() is now a reap,
                    // not a wait for a live shell. Only here release the SID.
                    let status = owned
                        .child
                        .as_mut()
                        .expect("unreaped Linux PTY child")
                        .wait()?;
                    owned.child = None;
                    owned.status = Some(status.clone());
                    return Ok(status);
                }
                // A job-control stopped foreground group cannot act on TERM
                // until continued. KILL also covers HUP/TERM-resistant jobs.
                Self::signal(&members, libc::SIGCONT)?;
                Self::signal(&members, signal)?;
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!(
                "Linux terminal session {} did not exit after SIGKILL",
                self.sid
            ),
        ))
    }

    fn wait_for_exit(&self) -> std::io::Result<()> {
        use nix::libc;
        use std::os::fd::{AsRawFd, FromRawFd};
        let leader = {
            let owned = self
                .child
                .lock()
                .map_err(|_| std::io::Error::other("Linux terminal ownership is unavailable"))?;
            if owned.status.is_some() {
                return Ok(());
            }
            // Pin while the unreaped child still reserves the numeric PID.
            // A concurrent stop can subsequently reap it; waiting on this fd
            // must never attach to a later child that reuses the number.
            let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, self.sid, 0) };
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            unsafe { std::os::fd::OwnedFd::from_raw_fd(fd as _) }
        };
        // Observe shell exit without reaping it: a shell may exit while an
        // orphaned foreground job still owns the slave and a different PGID.
        loop {
            let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
            if unsafe {
                libc::waitid(
                    libc::P_PIDFD,
                    leader.as_raw_fd() as _,
                    info.as_mut_ptr(),
                    libc::WEXITED | libc::WNOWAIT,
                )
            } == 0
            {
                break;
            }
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            // A concurrent stop may already have drained and reaped this child.
            if error.raw_os_error() == Some(libc::ECHILD) {
                break;
            }
            return Err(error);
        }
        Ok(())
    }
}

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

#[cfg(not(target_os = "linux"))]
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
    #[cfg(target_os = "linux")]
    linux_session: Option<Arc<LinuxPtySession>>,
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
            #[cfg(target_os = "linux")]
            linux_session: None,
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

    fn begin_generation(&mut self) -> u64 {
        self.generation = self.generation.saturating_add(1).max(1);
        self.phase = TerminalPhase::Running;
        self.sequence = 0;
        self.exit_code = None;
        self.signal = None;
        self.flow_paused = false;
        self.replay.reset();
        self.generation
    }

    fn publish(&mut self, event: TerminalEvent) {
        // Retain the complete generation before attempting live delivery.
        if self.replay.complete {
            self.replay.push(event.clone());
        }
        if let Some(channel) = self.channel.as_ref() {
            if let Err(error) = channel.send(event) {
                log::debug!("Embedded terminal channel disconnected: {error}");
                self.channel = None;
            }
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

    fn request_stop(&self) -> Result<TerminalStatus, String> {
        // A stop must also own a launch that is still constructing its child.
        let _spawn_guard = self
            .spawn_gate
            .lock()
            .map_err(|_| format!("{} terminal spawn state is unavailable", self.id.label()))?;
        #[cfg(target_os = "linux")]
        {
            let owner = self.session()?.linux_session.clone();
            if let Some(owner) = owner {
                // Never hold Session while waiting for processes: output and the
                // waiter must remain able to make progress during escalation.
                owner.request_stop().map_err(|error| {
                    format!("Could not stop {} terminal: {error}", self.id.label())
                })?;
                let mut session = self.session()?;
                session.flow_paused = false;
                self.shared.flow_changed.notify_all();
                if session.phase == TerminalPhase::Running {
                    session.phase = TerminalPhase::Stopping;
                    session.next_sequence();
                }
                session.bridge = None;
                return Ok(session.status());
            }
        }
        #[cfg(windows)]
        let startup_child;
        let (status, killer, writer, master) = {
            let mut session = self.session()?;
            if session.phase != TerminalPhase::Running {
                return Ok(session.status());
            }
            // Do not relinquish the handles, bridge or Running state until the
            // termination request succeeds: a denied stop must remain retryable.
            #[cfg(windows)]
            session
                .request_windows_stop()
                .map_err(|error| format!("Could not stop {} terminal: {error}", self.id.label()))?;
            #[cfg(not(windows))]
            if let Some(killer) = session.killer.as_mut() {
                killer.kill().map_err(|error| {
                    format!("Could not stop {} terminal: {error}", self.id.label())
                })?;
            }
            #[cfg(windows)]
            {
                startup_child = session.startup_child.take();
            }
            session.phase = TerminalPhase::Stopping;
            // Order the command snapshot against the waiter's exit event.
            session.next_sequence();
            session.bridge = None;
            session.flow_paused = false;
            self.shared.flow_changed.notify_all();
            (
                session.status(),
                session.killer.take(),
                session.writer.take(),
                session.master.take(),
            )
        };
        drop(killer);
        drop(writer);
        drop(master);
        #[cfg(windows)]
        if let Some(child) = startup_child {
            self.push_thread(start_waiter(
                self.id.clone(),
                self.shared.clone(),
                status.generation,
                child,
            ))?;
        }
        Ok(status)
    }

    fn finish_stop(&self, generation: u64) -> Result<(), String> {
        #[cfg(not(target_os = "linux"))]
        let _ = generation;
        #[cfg(target_os = "linux")]
        {
            let owner = {
                let session = self.session()?;
                if session.generation != generation {
                    return Ok(());
                }
                session.linux_session.clone()
            };
            if let Some(owner) = owner {
                let waited = owner.terminate().and_then(|status| {
                    owner.reader.wait_finished()?;
                    Ok(status)
                });
                let error = waited
                    .as_ref()
                    .err()
                    .map(|error| format!("Could not stop {} terminal: {error}", self.id.label()));
                // Also complete retries whose first waiter reported a failure
                // and returned. No second worker or detached join is needed.
                publish_wait_result(&self.shared, generation, waited);
                if let Some(error) = error {
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn stop(&self) -> Result<TerminalStatus, String> {
        let status = self.request_stop()?;
        self.finish_stop(status.generation)?;
        Ok(status)
    }

    fn join_threads(&self) -> Result<(), String> {
        let threads =
            std::mem::take(&mut *self.threads.lock().map_err(|_| {
                format!("{} terminal thread state is unavailable", self.id.label())
            })?);
        #[cfg(target_os = "linux")]
        let threads = {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            let mut pending = threads;
            let mut finished = Vec::new();
            loop {
                let (done, running): (Vec<_>, Vec<_>) =
                    pending.into_iter().partition(JoinHandle::is_finished);
                finished.extend(done);
                pending = running;
                if pending.is_empty() || std::time::Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if !pending.is_empty() {
                // Keep unfinished workers owned for a retry; a timeout must not
                // turn a blocked reader into a detached thread.
                self.threads
                    .lock()
                    .map_err(|_| {
                        format!("{} terminal thread state is unavailable", self.id.label())
                    })?
                    .extend(pending);
                for thread in finished {
                    let _ = thread.join();
                }
                return Err(format!(
                    "{} terminal workers did not stop before the deadline",
                    self.id.label()
                ));
            }
            finished
        };
        let mut panicked = false;
        for thread in threads {
            panicked |= thread.join().is_err();
        }
        if panicked {
            Err(format!(
                "{} terminal worker failed while stopping",
                self.id.label()
            ))
        } else {
            Ok(())
        }
    }

    #[cfg(not(target_os = "linux"))]
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
    code_lifecycle: Mutex<()>,
    hermes: Arc<TerminalSlot>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            code: Arc::new(TerminalSlot::new(TerminalId::Code)),
            code_workspaces: Mutex::new(HashMap::new()),
            code_lifecycle: Mutex::new(()),
            hermes: Arc::new(TerminalSlot::new(TerminalId::Hermes)),
        }
    }
}

impl TerminalState {
    fn code_launch_guard(&self, id: &TerminalId) -> Result<Option<MutexGuard<'_, ()>>, String> {
        if id.is_code() {
            self.code_lifecycle
                .lock()
                .map(Some)
                .map_err(|_| "Code terminal launch state is unavailable".to_owned())
        } else {
            Ok(None)
        }
    }

    fn stop_code(&self) -> Result<(), String> {
        // Registering a new workspace and publishing its child belongs to the
        // same boundary as stopping the family. Hermes has a separate lifetime.
        let _code_guard = self
            .code_lifecycle
            .lock()
            .map_err(|_| "Code terminal launch state is unavailable".to_owned())?;
        let mut slots = vec![self.code.clone()];
        slots.extend(
            self.code_workspaces
                .lock()
                .map_err(|_| "Code workspace registry is unavailable".to_owned())?
                .values()
                .cloned(),
        );
        let mut errors = Vec::new();
        let mut stopped = Vec::new();
        for slot in slots {
            match slot.request_stop() {
                Ok(status) => stopped.push((slot, status.generation)),
                Err(error) => errors.push(format!("{}: {error}", slot.id.key())),
            }
        }
        // Request every stop before waiting; one refused child must not leave
        // unrelated Code workspaces running. Success means owned workers reaped.
        for (slot, generation) in stopped {
            if let Err(error) = slot.finish_stop(generation) {
                errors.push(format!("{}: {error}", slot.id.key()));
            }
            if let Err(error) = slot.join_threads() {
                errors.push(format!("{}: {error}", slot.id.key()));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Could not stop all Code terminals: {}",
                errors.join("; ")
            ))
        }
    }

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
        #[cfg(target_os = "linux")]
        {
            let _code_guard = match self.code_lifecycle.lock() {
                Ok(guard) => guard,
                Err(error) => {
                    log::warn!("Code terminal launch state is unavailable: {error}");
                    return;
                }
            };
            let mut slots = vec![self.code.clone(), self.hermes.clone()];
            match self.code_workspaces.lock() {
                Ok(workspaces) => slots.extend(workspaces.values().cloned()),
                Err(error) => log::warn!("Code workspace registry is unavailable: {error}"),
            }
            // Include hidden and previously exited workspace shells; their
            // foreground jobs can still own the PTY after the shell has exited.
            let mut stopped = Vec::new();
            for slot in &slots {
                match slot.request_stop() {
                    Ok(status) => stopped.push((slot, status.generation)),
                    Err(error) => log::warn!("{error}"),
                }
            }
            for (slot, generation) in stopped {
                if let Err(error) = slot.finish_stop(generation) {
                    log::warn!("{error}");
                }
            }
            for slot in slots {
                if let Err(error) = slot.join_threads() {
                    log::warn!("{error}");
                }
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            self.code.shutdown();
            if let Ok(workspaces) = self.code_workspaces.lock() {
                for workspace in workspaces.values() {
                    workspace.shutdown();
                }
            }
            self.hermes.shutdown();
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
    opencode_directory: Option<&Path>,
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
    if let Some(directory) = opencode_directory {
        for (key, value) in super::system::opencode_config::child_env(directory) {
            command.env(key, value);
        }
        command.env(
            "OPENCODE_TUI_CONFIG",
            directory.join("gchat-tui.json").as_os_str(),
        );
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

fn format_open_code_command(executable: &Path, cwd: &Path, windows: bool) -> String {
    let workspace = if windows {
        windows_cli_path(cwd)
    } else {
        cwd.to_string_lossy().into_owned()
    };
    let executable = if windows {
        format!("& {}", shell_literal(&windows_cli_path(executable), true))
    } else {
        shell_literal(&executable.to_string_lossy(), false)
    };
    format!("{executable} {}\r", shell_literal(&workspace, windows))
}

fn quote_open_code_command(
    data: &Path,
    custom_path: Option<&str>,
    cwd: &Path,
) -> Result<(PathBuf, Vec<u8>), String> {
    let executable = super::system::opencode_runtime::resolve(data, custom_path)?
        .ok_or("OpenCode is not installed. Set up Code before starting a workspace.")?
        .executable;

    #[cfg(windows)]
    let command = format_open_code_command(&executable, cwd, true);

    #[cfg(not(windows))]
    let command = format_open_code_command(&executable, cwd, false);

    Ok((executable, command.into_bytes()))
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

#[cfg(any(not(target_os = "linux"), test))]
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
            publish_wait_result(&shared, generation, waited);
        })
        .expect("failed to spawn embedded terminal waiter")
}

#[cfg(target_os = "linux")]
fn start_linux_waiter(
    terminal_id: TerminalId,
    shared: Arc<SharedTerminal>,
    generation: u64,
    owner: Arc<LinuxPtySession>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!(
            "{}-terminal-waiter-{generation}",
            terminal_id.label().to_ascii_lowercase()
        ))
        .spawn(move || {
            let waited = owner.wait_for_exit().and_then(|()| {
                {
                    let mut session = shared.session.lock().map_err(|_| {
                        std::io::Error::other("Linux terminal state is unavailable")
                    })?;
                    if session.generation == generation && session.linux_session.is_some() {
                        if session.phase == TerminalPhase::Running {
                            session.phase = TerminalPhase::Stopping;
                            session.next_sequence();
                        }
                        // Natural shell exit must also release frontend flow
                        // control, and Stopping rejects any later pause request.
                        session.flow_paused = false;
                        shared.flow_changed.notify_all();
                    }
                }
                let status = owner.drain()?;
                // No cancellation on natural exit: deliver buffered final
                // output before the Exited event can end the generation.
                owner.reader.wait_finished()?;
                Ok(status)
            });
            publish_wait_result(&shared, generation, waited);
        })
        .expect("failed to spawn embedded terminal waiter")
}

fn publish_wait_result(
    shared: &SharedTerminal,
    generation: u64,
    waited: std::io::Result<portable_pty::ExitStatus>,
) {
    let Ok(mut session) = shared.session.lock() else {
        return;
    };
    if session.generation != generation {
        return;
    }

    #[cfg(target_os = "linux")]
    if session.phase == TerminalPhase::Exited && session.linux_session.is_none() {
        return;
    }

    #[cfg(target_os = "linux")]
    if let Err(error) = waited.as_ref() {
        if session.linux_session.is_some() {
            // Retain session ownership, including any unreaped leader, for
            // retry after a failed process/output drain. Do not claim exit.
            session.phase = TerminalPhase::Stopping;
            session.flow_paused = false;
            shared.flow_changed.notify_all();
            let sequence = session.next_sequence();
            let status = session.status();
            session.publish(TerminalEvent::Error {
                generation,
                sequence,
                message: format!("Could not stop terminal session: {error}"),
                status,
            });
            return;
        }
    }

    #[cfg(target_os = "linux")]
    {
        session.linux_session = None;
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
}

#[tauri::command]
pub fn terminal_attach(
    state: State<'_, TerminalState>,
    terminal_id: TerminalId,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalStatus, String> {
    let slot = state.slot(terminal_id.clone());
    let mut session = slot.session()?;
    if session.replay.complete {
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
    session.channel = Some(on_event);
    session.flow_paused = false;
    slot.shared.flow_changed.notify_all();
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
    let _code_guard = state.code_launch_guard(&terminal_id)?;
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
    let mut opencode_executable = None;
    let mut opencode_directory = None;
    let mut launch_command = match request.launch {
        TerminalLaunch::Shell => None,
        TerminalLaunch::OpenCode => {
            let data = super::app::commands::get_jan_data_folder_path(app.clone());
            let (executable, command) =
                quote_open_code_command(&data, request.executable.as_deref(), &cwd)?;
            opencode_executable = Some(windows_cli_path(&executable));
            let directory = super::system::opencode_config::config_directory(&data);
            install_gchat_opencode_theme(&directory)?;
            opencode_directory = Some(directory);
            Some(command)
        }
        TerminalLaunch::Hermes => Some(quote_hermes_command(request.executable.as_deref())?),
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
    #[cfg(not(target_os = "linux"))]
    let reader = pair.master.try_clone_reader().map_err(|error| {
        format!(
            "Could not open {} terminal output: {error}",
            terminal_id.label()
        )
    })?;
    #[cfg(target_os = "linux")]
    let (reader, reader_cancellation) =
        LinuxPtyReader::new(pair.master.as_ref()).map_err(|error| {
            format!(
                "Could not open {} terminal output: {error}",
                terminal_id.label()
            )
        })?;
    #[cfg(target_os = "linux")]
    let reader: Box<dyn Read + Send> = Box::new(reader);
    let mut writer = pair.master.take_writer().map_err(|error| {
        format!(
            "Could not open {} terminal input: {error}",
            terminal_id.label()
        )
    })?;
    let mut command = command_for_shell(&cwd, opencode_directory.as_deref(), hermes_appearance);
    let mut bridge = None;
    if let Some(config_directory) = opencode_directory.as_deref() {
        let inherited_config = std::env::var("OPENCODE_CONFIG_CONTENT").ok();
        let configured =
            super::system::opencode_config::read_merged_global_config(config_directory)?;
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
                executable: opencode_executable,
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
            &config_directory.join("gchat-caller.mjs"),
        )?;
        command.env("OPENCODE_CONFIG_CONTENT", config);
        command.env("GCHAT_BRIDGE_TOKEN", connection.token);
    }
    #[allow(unused_mut)]
    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        format!(
            "Could not start {} terminal shell: {error}",
            terminal_id.label()
        )
    })?;
    drop(pair.slave);
    #[cfg(target_os = "linux")]
    let linux_session = Arc::new(LinuxPtySession::new(child, reader_cancellation));
    #[cfg(not(target_os = "linux"))]
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
                    session.begin_generation();
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

    #[cfg(target_os = "linux")]
    let launch_failure = if let Some(command) = launch_command {
        match writer.write_all(&command).and_then(|_| writer.flush()) {
            Ok(()) => None,
            Err(error) => match linux_session.terminate() {
                Ok(_) => {
                    return Err(format!(
                        "Could not launch {} terminal: {error}",
                        terminal_id.label()
                    ))
                }
                Err(cleanup_error) => Some(format!(
                    "Could not launch {} terminal: {error}; child cleanup failed: {cleanup_error}",
                    terminal_id.label()
                )),
            },
        }
    } else {
        None
    };

    #[cfg(not(target_os = "linux"))]
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
                    session.begin_generation();
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
        generation = session.begin_generation();
        session.cwd = Some(cwd_text.clone());
        session.launch = Some(request.launch);
        session.master = Some(pair.master);
        session.writer = Some(writer);
        #[cfg(not(target_os = "linux"))]
        {
            session.killer = Some(killer);
        }
        #[cfg(target_os = "linux")]
        {
            session.linux_session = Some(linux_session.clone());
            if launch_failure.is_some() {
                session.phase = TerminalPhase::Stopping;
            }
        }
        session.bridge = bridge;

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
    #[cfg(not(target_os = "linux"))]
    slot.push_thread(start_waiter(
        terminal_id,
        slot.shared.clone(),
        generation,
        child,
    ))?;
    #[cfg(target_os = "linux")]
    slot.push_thread(start_linux_waiter(
        terminal_id,
        slot.shared.clone(),
        generation,
        linux_session,
    ))?;
    #[cfg(target_os = "linux")]
    if let Some(error) = launch_failure {
        return Err(error);
    }
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
    state.slot(terminal_id).stop()
}

#[tauri::command]
pub fn terminal_stop_code(state: State<'_, TerminalState>) -> Result<(), String> {
    state.stop_code()
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
/// The embedded process receives OPENCODE_TUI_CONFIG and the selected managed
/// directory contains its theme and plugins.
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
pub async fn opencode_readiness<R: Runtime>(
    app: AppHandle<R>,
    custom_path: Option<String>,
) -> Result<OpenCodeReadiness, String> {
    let data = super::app::commands::get_jan_data_folder_path(app);
    let config_directory = super::system::opencode_config::config_directory(&data);
    let installed = tokio::task::spawn_blocking(move || {
        super::system::opencode_runtime::resolve(&data, custom_path.as_deref())
    })
    .await
    .map_err(|error| format!("Could not check OpenCode installation: {error}"))??
    .is_some();
    let config_path = super::system::opencode_config::writable_config_path(&config_directory);
    let config_state = match opencode_configuration_state(&config_directory) {
        Ok(state) => state,
        Err(error) => {
            log::debug!("OpenCode readiness config error: {error}");
            OpenCodeConfigurationState::Invalid
        }
    };
    let configured = config_state == OpenCodeConfigurationState::Ready;
    let reason = if !installed {
        Some(OpenCodeReadinessReason::NotInstalled)
    } else if config_state == OpenCodeConfigurationState::Invalid {
        Some(OpenCodeReadinessReason::InvalidConfiguration)
    } else if config_state == OpenCodeConfigurationState::Missing {
        Some(OpenCodeReadinessReason::MissingConfiguration)
    } else {
        None
    };
    Ok(OpenCodeReadiness {
        ready: reason.is_none(),
        installed,
        configured,
        via_wsl: false,
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
    let detection = super::system::commands::detect_external_agent_installed(
        "hermes".to_string(),
        custom_path,
    )
    .await;
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
    fn opencode_receives_the_workspace_as_its_project_path() {
        assert_eq!(
            format_open_code_command(
                Path::new(r"\\?\C:\GChat Data\code\opencode\runtime\node_modules\.bin\opencode.cmd"),
                Path::new(r"\\?\C:\Users\Ron\Agent Work"),
                true,
            ),
            "& 'C:\\GChat Data\\code\\opencode\\runtime\\node_modules\\.bin\\opencode.cmd' 'C:\\Users\\Ron\\Agent Work'\r"
        );
        assert_eq!(
            format_open_code_command(
                Path::new("/home/ron/GChat Data/code/opencode/runtime/node_modules/.bin/opencode"),
                Path::new("/home/ron/agent work"),
                false,
            ),
            "'/home/ron/GChat Data/code/opencode/runtime/node_modules/.bin/opencode' '/home/ron/agent work'\r"
        );
    }

    #[cfg(unix)]
    #[test]
    fn embedded_opencode_launch_runs_the_selected_managed_executable_with_spaced_paths() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("GChat's data");
        let project = root.path().join("Agent's work");
        std::fs::create_dir_all(&project).unwrap();
        let executable = super::super::system::opencode_runtime::managed_executable(&data);
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s' \"$1\" > launch-witness\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(data.join("code/opencode/runtime/.gchat-verified"), "1.2.3").unwrap();

        let (resolved, command) = quote_open_code_command(&data, None, &project).unwrap();
        assert_eq!(resolved, executable);
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", String::from_utf8(command).unwrap().trim_end_matches('\r')])
            .current_dir(&project)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            std::fs::read_to_string(project.join("launch-witness")).unwrap(),
            project.to_str().unwrap(),
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

    #[derive(Debug, Default)]
    struct ControlledChildState {
        stopped: bool,
        deny_stop: bool,
        waited: bool,
    }

    #[derive(Debug, Default)]
    struct ControlledChildShared {
        state: Mutex<ControlledChildState>,
        changed: Condvar,
    }

    #[derive(Debug, Clone, Default)]
    struct ControlledChild(Arc<ControlledChildShared>);

    impl ChildKiller for ControlledChild {
        fn kill(&mut self) -> std::io::Result<()> {
            let mut state = self.0.state.lock().unwrap();
            if state.deny_stop {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "test child refused termination",
                ));
            }
            state.stopped = true;
            self.0.changed.notify_all();
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    impl portable_pty::Child for ControlledChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(self
                .0
                .state
                .lock()
                .unwrap()
                .stopped
                .then(|| portable_pty::ExitStatus::with_exit_code(0)))
        }

        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            let state = self.0.state.lock().unwrap();
            let (mut state, timeout) = self
                .0
                .changed
                .wait_timeout_while(state, std::time::Duration::from_secs(5), |state| {
                    !state.stopped
                })
                .unwrap();
            if timeout.timed_out() && !state.stopped {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "test child was not terminated",
                ));
            }
            state.waited = true;
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    fn controlled_terminal(state: &TerminalState, id: TerminalId) -> ControlledChild {
        let child = ControlledChild::default();
        let slot = state.slot(id.clone());
        let generation = {
            let mut session = slot.session().unwrap();
            let generation = session.begin_generation();
            session.killer = Some(child.clone_killer());
            session.writer = Some(Box::new(Vec::<u8>::new()));
            session.flow_paused = true;
            session.bridge = Some(BridgeLease(format!("test-stop-{}", id.key())));
            generation
        };
        slot.push_thread(start_waiter(
            id,
            slot.shared.clone(),
            generation,
            Box::new(child.clone()),
        ))
        .unwrap();
        child
    }

    #[test]
    fn terminal_stop_code_reaps_all_workspaces_and_legacy_but_preserves_hermes() {
        let state = TerminalState::default();
        let ids = [
            TerminalId::Code,
            TerminalId::CodeWorkspace("workspace-one".into()),
            TerminalId::CodeWorkspace("workspace-two".into()),
        ];
        let children: Vec<_> = ids
            .iter()
            .map(|id| controlled_terminal(&state, id.clone()))
            .collect();
        let slots: Vec<_> = ids.iter().map(|id| state.slot(id.clone())).collect();
        let hermes = controlled_terminal(&state, TerminalId::Hermes);
        let hermes_slot = state.slot(TerminalId::Hermes);
        let harness = crate::test_support::IpcTestHarness::new(|builder| {
            builder
                .manage(state)
                .invoke_handler(tauri::generate_handler![terminal_stop_code])
        });

        let result = harness.invoke::<()>("terminal_stop_code", serde_json::json!({}));
        let untouched = !hermes.0.state.lock().unwrap().stopped;
        let hermes_status = hermes_slot.session().unwrap().status();
        // Always finish the owned Hermes waiter before making assertions.
        hermes_slot.stop().unwrap();
        hermes_slot.join_threads().unwrap();

        result.unwrap();
        for (child, slot) in children.iter().zip(slots) {
            let child = child.0.state.lock().unwrap();
            assert!(child.stopped && child.waited);
            assert_eq!(slot.session().unwrap().phase, TerminalPhase::Exited);
        }
        assert!(untouched);
        assert_eq!(hermes_status.phase, TerminalPhase::Running);
        // Disabling an already stopped family is harmless.
        harness
            .invoke::<()>("terminal_stop_code", serde_json::json!({}))
            .unwrap();
    }

    #[test]
    fn terminal_stop_code_reports_failure_and_preserves_retry_ownership() {
        let state = TerminalState::default();
        let id = TerminalId::CodeWorkspace("denied-workspace".into());
        let denied = controlled_terminal(&state, id.clone());
        denied.0.state.lock().unwrap().deny_stop = true;
        let other = controlled_terminal(&state, TerminalId::CodeWorkspace("other".into()));
        let slot = state.slot(id);

        let failure = state.stop_code();
        let retained = {
            let session = slot.session().unwrap();
            session.phase == TerminalPhase::Running
                && session.sequence == 0
                && session.flow_paused
                && session.killer.is_some()
                && session.writer.is_some()
                && session.bridge.is_some()
        };
        let other_reaped = other.0.state.lock().unwrap().waited;
        denied.0.state.lock().unwrap().deny_stop = false;
        // Retry the same child; a failed command must not orphan its stop handle.
        state.stop_code().unwrap();

        let error = failure.unwrap_err();
        assert!(error.contains("code:denied-workspace"));
        assert!(error.contains("test child refused termination"));
        assert!(retained);
        assert!(other_reaped, "one refusal must not skip other workspaces");
        assert!(denied.0.state.lock().unwrap().waited);
        assert_eq!(slot.session().unwrap().phase, TerminalPhase::Exited);
    }

    #[test]
    fn terminal_stop_code_waits_for_in_flight_workspace_launch() {
        let state = Arc::new(TerminalState::default());
        let id = TerminalId::CodeWorkspace("in-flight".into());
        let launch_guard = state.code_launch_guard(&id).unwrap();
        let stopping = state.clone();
        let (started, entered) = std::sync::mpsc::channel();
        let (finished, result) = std::sync::mpsc::channel();
        let stop = std::thread::spawn(move || {
            started.send(()).unwrap();
            finished.send(stopping.stop_code()).unwrap();
        });
        entered.recv().unwrap();
        let premature = result
            .recv_timeout(std::time::Duration::from_millis(30))
            .ok();
        // Match terminal_spawn: register/publish under the family launch guard.
        let child = controlled_terminal(&state, id);
        drop(launch_guard);
        let stopped = result.recv_timeout(std::time::Duration::from_secs(2));
        stop.join().unwrap();

        assert!(premature.is_none(), "stop passed an unfinished launch");
        stopped.unwrap().unwrap();
        assert!(child.0.state.lock().unwrap().waited);
    }

    #[cfg(target_os = "linux")]
    struct LinuxTerminalFixture {
        state: TerminalState,
        directory: tempfile::TempDir,
    }

    #[cfg(target_os = "linux")]
    impl LinuxTerminalFixture {
        fn new() -> Self {
            Self {
                state: TerminalState::default(),
                directory: tempfile::tempdir().unwrap(),
            }
        }

        fn spawn(
            &self,
            id: TerminalId,
            name: &str,
            exit_on_release: bool,
        ) -> (Arc<TerminalSlot>, i32, std::os::fd::OwnedFd) {
            use std::os::fd::FromRawFd;
            let pid_file = self.directory.path().join(format!("{name}.pid"));
            let release = self.directory.path().join(format!("{name}.release"));
            let mut command = CommandBuilder::new("/bin/bash");
            command.args([
                "--noprofile",
                "--norc",
                "-c",
                r#"
set -m
trap '' HUP TERM
bash --noprofile --norc -c '
    trap "" HUP TERM
    printf "%s\n" "$$" > "$GCHAT_TEST_PID"
    while :; do sleep 1; done
' &
if [ "$GCHAT_TEST_ORPHAN" = 1 ]; then
    while [ ! -e "$GCHAT_TEST_RELEASE" ]; do sleep 0.01; done
    exit 23
fi
fg
while :; do sleep 1; done
"#,
            ]);
            command.env("GCHAT_TEST_PID", pid_file.as_os_str());
            command.env("GCHAT_TEST_RELEASE", release.as_os_str());
            command.env("GCHAT_TEST_ORPHAN", if exit_on_release { "1" } else { "0" });
            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let (reader, cancellation) = LinuxPtyReader::new(pair.master.as_ref()).unwrap();
            let writer = pair.master.take_writer().unwrap();
            let child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            let owner = Arc::new(LinuxPtySession::new(child, cancellation));
            let slot = self.state.slot(id.clone());
            let generation = {
                let mut session = slot.session().unwrap();
                let generation = session.begin_generation();
                session.master = Some(pair.master);
                session.writer = Some(writer);
                session.linux_session = Some(owner.clone());
                generation
            };
            slot.push_thread(start_reader(
                id.clone(),
                slot.shared.clone(),
                generation,
                Box::new(reader),
            ))
            .unwrap();
            slot.push_thread(start_linux_waiter(
                id,
                slot.shared.clone(),
                generation,
                owner.clone(),
            ))
            .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            let pid = loop {
                if let Some(pid) = std::fs::read_to_string(&pid_file)
                    .ok()
                    .and_then(|value| value.trim().parse::<i32>().ok())
                {
                    break pid;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "PTY child did not become ready"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            };
            // Bash monitor mode gives the launched job its own process group,
            // reproducing the foreground Code process missed by shell-only HUP.
            assert_eq!(unsafe { nix::libc::getsid(pid) }, owner.sid);
            assert_ne!(unsafe { nix::libc::getpgid(pid) }, owner.sid);
            let fd = unsafe { nix::libc::syscall(nix::libc::SYS_pidfd_open, pid, 0) };
            assert!(
                fd >= 0,
                "could not pin test child: {}",
                std::io::Error::last_os_error()
            );
            (slot, pid, unsafe {
                std::os::fd::OwnedFd::from_raw_fd(fd as _)
            })
        }

        fn release(&self, name: &str) {
            std::fs::write(
                self.directory.path().join(format!("{name}.release")),
                b"exit",
            )
            .unwrap();
        }
    }

    #[cfg(target_os = "linux")]
    impl Drop for LinuxTerminalFixture {
        fn drop(&mut self) {
            self.state.shutdown();
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_process_exited(pid: &std::os::fd::OwnedFd) -> bool {
        use std::os::fd::AsRawFd;
        let mut fd = nix::libc::pollfd {
            fd: pid.as_raw_fd(),
            events: nix::libc::POLLIN,
            revents: 0,
        };
        assert!(unsafe { nix::libc::poll(&mut fd, 1, 0) } >= 0);
        fd.revents != 0
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_stop_drains_stopped_resistant_foreground_group() {
        let fixture = LinuxTerminalFixture::new();
        let (slot, pid, child) = fixture.spawn(TerminalId::Code, "selected", false);
        // A stopped Code job defers TERM until CONT; both shell and job also
        // ignore HUP/TERM so this requires bounded KILL escalation.
        assert_eq!(unsafe { nix::libc::kill(pid, nix::libc::SIGSTOP) }, 0);
        slot.session().unwrap().flow_paused = true;
        let started = std::time::Instant::now();
        let stopping = slot.stop().unwrap();
        slot.join_threads().unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        assert_eq!(stopping.phase, TerminalPhase::Stopping);
        let session = slot.session().unwrap();
        assert_eq!(session.phase, TerminalPhase::Exited);
        assert!(session.sequence > stopping.sequence);
        assert!(session.linux_session.is_none());
        assert!(linux_process_exited(&child));
        assert!(slot.threads.lock().unwrap().is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_shell_exit_drains_orphan_before_publishing_exited() {
        let fixture = LinuxTerminalFixture::new();
        let (slot, _, child) =
            fixture.spawn(TerminalId::CodeWorkspace("orphan".into()), "orphan", true);
        fixture.release("orphan");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if slot.session().unwrap().phase == TerminalPhase::Exited {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "shell exit did not drain its orphaned job"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(linux_process_exited(&child));
        slot.join_threads().unwrap();
        let session = slot.session().unwrap();
        assert_eq!(session.exit_code, Some(23));
        assert!(session.linux_session.is_none());
        assert!(slot.threads.lock().unwrap().is_empty());
        drop(session);
        // Completed owners cannot signal a later session through the old SID.
        slot.stop().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_shutdown_drains_hidden_workspaces_and_preserves_unrelated_session() {
        let fixture = LinuxTerminalFixture::new();
        let unrelated = LinuxTerminalFixture::new();
        let (_, _, untouched) = unrelated.spawn(TerminalId::Code, "unrelated", false);
        let children: Vec<_> = [
            TerminalId::Code,
            TerminalId::CodeWorkspace("hidden".into()),
            TerminalId::CodeWorkspace("selected".into()),
            TerminalId::Hermes,
        ]
        .into_iter()
        .enumerate()
        .map(|(index, id)| fixture.spawn(id, &format!("slot-{index}"), false))
        .collect();
        let started = std::time::Instant::now();
        fixture.state.shutdown();
        assert!(started.elapsed() < std::time::Duration::from_secs(8));
        for (slot, _, child) in children {
            assert!(linux_process_exited(&child));
            assert_eq!(slot.session().unwrap().phase, TerminalPhase::Exited);
            assert!(slot.threads.lock().unwrap().is_empty());
        }
        assert!(
            !linux_process_exited(&untouched),
            "shutdown crossed into an unrelated PTY session"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_reader_cancels_while_slave_remains_open() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let (mut reader, cancellation) = LinuxPtyReader::new(pair.master.as_ref()).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || sent.send(reader.read(&mut [0; 16])).unwrap());
        cancellation.cancel();
        cancellation.cancel();
        let result = received.recv_timeout(std::time::Duration::from_secs(1));
        // Close the slave even on failure so the test never leaves a blocked
        // reader behind. Production cancellation must work before this close.
        drop(pair.slave);
        drop(pair.master);
        worker.join().unwrap();
        assert_eq!(result.unwrap().unwrap(), 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_natural_exit_replays_final_output_before_exited_while_paused() {
        let fixture = LinuxTerminalFixture::new();
        let id = TerminalId::Code;
        let slot = fixture.state.slot(id.clone());
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "printf 'gchat-final-output-before-exit\\n'; exit 19"]);
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let (reader, cancellation) = LinuxPtyReader::new(pair.master.as_ref()).unwrap();
        let writer = pair.master.take_writer().unwrap();
        let child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let owner = Arc::new(LinuxPtySession::new(child, cancellation));
        let (channel, live_events) = recording_channel();
        let generation = {
            let mut session = slot.session().unwrap();
            let generation = session.begin_generation();
            session.master = Some(pair.master);
            session.writer = Some(writer);
            session.linux_session = Some(owner.clone());
            session.channel = Some(channel);
            session.flow_paused = true;
            generation
        };
        slot.push_thread(start_reader(
            id.clone(),
            slot.shared.clone(),
            generation,
            Box::new(reader),
        ))
        .unwrap();
        slot.push_thread(start_linux_waiter(
            id,
            slot.shared.clone(),
            generation,
            owner,
        ))
        .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if slot.session().unwrap().phase == TerminalPhase::Exited {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "natural exit did not finish its paused output reader"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        slot.join_threads().unwrap();
        let session = slot.session().unwrap();
        assert_eq!(session.exit_code, Some(19));
        assert!(session.replay.complete);
        let mut output = Vec::new();
        let mut exited = false;
        for event in &session.replay.events {
            match event {
                TerminalEvent::Output { data, .. } => {
                    assert!(!exited, "output was published after Exited");
                    output.extend(BASE64.decode(data).unwrap());
                }
                TerminalEvent::Exited { .. } => exited = true,
                event => panic!("unexpected final-output event: {event:?}"),
            }
        }
        assert!(exited);
        assert!(String::from_utf8(output)
            .unwrap()
            .contains("gchat-final-output-before-exit"));
        // Live delivery and later attachment consume the same ordered replay.
        let replay: Vec<_> = session
            .replay
            .events
            .iter()
            .map(|event| serde_json::to_value(event).unwrap())
            .collect();
        assert_eq!(*live_events.lock().unwrap(), replay);
    }

    fn output_event(sequence: u64, bytes: usize) -> TerminalEvent {
        TerminalEvent::Output {
            generation: 1,
            sequence,
            data: "x".repeat(bytes),
        }
    }

    fn recording_channel() -> (Channel<TerminalEvent>, Arc<Mutex<Vec<serde_json::Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let recorded = events.clone();
        let channel = Channel::new(move |body| {
            recorded.lock().unwrap().push(body.deserialize().unwrap());
            Ok(())
        });
        (channel, events)
    }

    #[test]
    fn terminal_attach_replays_the_complete_generation_across_live_replacements() {
        use tauri::Manager;

        let state = TerminalState::default();
        let slot = state.slot(TerminalId::Code);
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.generation = 1;
            let sequence = session.next_sequence();
            let status = session.status();
            session.publish(TerminalEvent::Started {
                generation: 1,
                sequence,
                status,
            });
        }
        let (first_channel, first) = recording_channel();
        terminal_attach(app.state(), TerminalId::Code, first_channel).unwrap();
        for bytes in [
            b"\x1b[?1049h\x1b[2J".as_slice(),
            b"\x1b[Hsaved screen".as_slice(),
        ] {
            let mut session = slot.session().unwrap();
            let sequence = session.next_sequence();
            session.publish(TerminalEvent::Output {
                generation: 1,
                sequence,
                data: BASE64.encode(bytes),
            });
        }
        let expected = first.lock().unwrap().clone();
        assert_eq!(expected.len(), 3);
        let (second_channel, second) = recording_channel();
        let status = terminal_attach(app.state(), TerminalId::Code, second_channel).unwrap();
        assert_eq!(status.generation, 1);
        assert_eq!(status.sequence, 3);
        assert!(status.replay_complete);
        assert_eq!(*second.lock().unwrap(), expected);
        {
            let mut session = slot.session().unwrap();
            let sequence = session.next_sequence();
            session.publish(TerminalEvent::Output {
                generation: 1,
                sequence,
                data: BASE64.encode(b"continued"),
            });
        }
        assert_eq!(first.lock().unwrap().len(), 3);
        let expected = second.lock().unwrap().clone();
        assert_eq!(expected.last().unwrap()["sequence"], 4);
        let (third_channel, third) = recording_channel();
        let status = terminal_attach(app.state(), TerminalId::Code, third_channel).unwrap();
        assert_eq!(status.sequence, 4);
        assert!(status.replay_complete);
        assert_eq!(*third.lock().unwrap(), expected);
    }

    #[test]
    fn terminal_attach_retains_output_after_channel_failure_and_failed_replacement() {
        use tauri::Manager;

        let state = TerminalState::default();
        let slot = state.slot(TerminalId::Code);
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let disconnected = || {
            Channel::new(|_| {
                Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "renderer closed").into())
            })
        };
        terminal_attach(app.state(), TerminalId::Code, disconnected()).unwrap();
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.generation = 1;
            let sequence = session.next_sequence();
            let status = session.status();
            session.publish(TerminalEvent::Started {
                generation: 1,
                sequence,
                status,
            });
            let sequence = session.next_sequence();
            session.publish(TerminalEvent::Output {
                generation: 1,
                sequence,
                data: BASE64.encode(b"\x1b[Hretained screen"),
            });
        }
        let (recovered_channel, recovered) = recording_channel();
        assert!(
            terminal_attach(app.state(), TerminalId::Code, recovered_channel)
                .unwrap()
                .replay_complete
        );
        let replayed = recovered.lock().unwrap().clone();
        assert_eq!(replayed.len(), 2);
        assert_eq!(replayed[0]["type"], "started");
        assert_eq!(replayed[1]["data"], BASE64.encode(b"\x1b[Hretained screen"));
        terminal_set_flow(
            app.state(),
            TerminalFlowRequest {
                terminal_id: TerminalId::Code,
                generation: 1,
                paused: true,
            },
        )
        .unwrap();
        assert!(
            terminal_attach(app.state(), TerminalId::Code, disconnected())
                .unwrap_err()
                .contains("renderer closed")
        );
        assert!(slot.session().unwrap().flow_paused);
        terminal_set_flow(
            app.state(),
            TerminalFlowRequest {
                terminal_id: TerminalId::Code,
                generation: 1,
                paused: false,
            },
        )
        .unwrap();
        {
            let mut session = slot.session().unwrap();
            let sequence = session.next_sequence();
            session.publish(TerminalEvent::Output {
                generation: 1,
                sequence,
                data: BASE64.encode(b"still connected"),
            });
        }
        let expected = recovered.lock().unwrap().clone();
        assert_eq!(expected.len(), 3);
        assert_eq!(expected[2]["sequence"], 3);
        let (replacement_channel, replacement) = recording_channel();
        let status = terminal_attach(app.state(), TerminalId::Code, replacement_channel).unwrap();
        assert_eq!(status.sequence, 3);
        assert!(status.replay_complete);
        assert_eq!(*replacement.lock().unwrap(), expected);
    }

    #[test]
    fn terminal_attach_keeps_overflow_unavailable_across_replacements() {
        use tauri::Manager;

        let state = TerminalState::default();
        let slot = state.slot(TerminalId::Code);
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let (channel, live) = recording_channel();
        terminal_attach(app.state(), TerminalId::Code, channel).unwrap();
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Running;
            session.generation = 1;
            let sequence = session.next_sequence();
            session.publish(output_event(sequence, REPLAY_CAPACITY_BYTES));
            let sequence = session.next_sequence();
            session.publish(output_event(sequence, 1));
        }
        assert_eq!(live.lock().unwrap().len(), 2);
        assert!(
            !terminal_status(app.state(), TerminalId::Code)
                .unwrap()
                .replay_complete
        );
        for sequence in [3, 4] {
            let (channel, events) = recording_channel();
            let status = terminal_attach(app.state(), TerminalId::Code, channel).unwrap();
            assert_eq!(status.generation, 1);
            assert_eq!(status.sequence, sequence);
            assert!(!status.replay_complete);
            assert_eq!(
                *events.lock().unwrap(),
                vec![serde_json::json!({
                    "type": "replay_unavailable", "generation": 1, "sequence": sequence,
                })]
            );
            assert!(
                !terminal_status(app.state(), TerminalId::Code)
                    .unwrap()
                    .replay_complete
            );
        }
        {
            let mut session = slot.session().unwrap();
            session.phase = TerminalPhase::Exited;
            session.exit_code = Some(7);
            session.signal = Some("TERM".into());
            let generation = session.begin_generation();
            let sequence = session.next_sequence();
            let status = session.status();
            session.publish(TerminalEvent::Started {
                generation,
                sequence,
                status,
            });
        }
        let (channel, events) = recording_channel();
        let status = terminal_attach(app.state(), TerminalId::Code, channel).unwrap();
        assert_eq!(status.generation, 2);
        assert_eq!(status.sequence, 1);
        assert_eq!(status.exit_code, None);
        assert_eq!(status.signal, None);
        assert!(status.replay_complete);
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "started");
        assert_eq!(events[0]["generation"], 2);
    }

    #[test]
    fn terminal_attach_releases_inherited_output_pause_and_wakes_reader() {
        use tauri::Manager;

        let state = TerminalState::default();
        let slot = state.slot(TerminalId::Code);
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        slot.session().unwrap().begin_generation();
        let (channel, _) = recording_channel();
        terminal_attach(app.state(), TerminalId::Code, channel).unwrap();
        terminal_set_flow(
            app.state(),
            TerminalFlowRequest {
                terminal_id: TerminalId::Code,
                generation: 1,
                paused: true,
            },
        )
        .unwrap();

        let shared = slot.shared.clone();
        let (waiting, entered) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let mut session = shared.session.lock().unwrap();
            waiting.send(()).unwrap();
            while session.flow_paused {
                let (next, timeout) = shared
                    .flow_changed
                    .wait_timeout(session, std::time::Duration::from_secs(2))
                    .unwrap();
                session = next;
                if timeout.timed_out() {
                    return false;
                }
            }
            true
        });
        // Sent with the session lock held, so attachment must follow the wait.
        entered
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let (replacement, _) = recording_channel();
        let attached = terminal_attach(app.state(), TerminalId::Code, replacement);
        let resumed = reader.join().unwrap();
        assert!(attached.unwrap().replay_complete);
        assert!(
            resumed,
            "the replacement must release and notify the paused reader"
        );
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
                Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject,
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
                Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject,
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
            Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject,
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
            .invoke::<serde_json::Value>(
                "terminal_status",
                serde_json::json!({"terminalId": "code"}),
            )
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
    fn real_pty_code_environment_uses_selected_data_and_preserves_other_shells() {
        use std::{ffi::OsString, os::unix::ffi::OsStrExt};

        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let directory = super::super::system::opencode_config::config_directory(data.path());
        install_gchat_opencode_theme(&directory).unwrap();
        let config_path = directory.join("opencode.jsonc");
        let config = br#"{"model":"gchat/fixture-selected"}"#;
        std::fs::write(&config_path, config).unwrap();
        let keys = [
            "HOME",
            "XDG_CONFIG_HOME",
            "OPENCODE_CONFIG_DIR",
            "OPENCODE_CONFIG",
            "OPENCODE_TUI_CONFIG",
            "HERMES_TUI_THEME",
        ];
        let inherited: Vec<OsString> = keys
            .iter()
            .map(|key| std::env::var_os(key).unwrap_or_default())
            .collect();

        for launch in [
            TerminalLaunch::OpenCode,
            TerminalLaunch::Shell,
            TerminalLaunch::Hermes,
        ] {
            let witness = project.path().join(format!("{launch:?}-environment"));
            let copied_config = project.path().join(format!("{launch:?}-configuration"));
            let mut command = command_for_shell(
                project.path(),
                (launch == TerminalLaunch::OpenCode).then_some(directory.as_path()),
                (launch == TerminalLaunch::Hermes).then_some(TerminalAppearance::Dark),
            );
            // Run a deterministic child through the real PTY with the production
            // environment, without loading the user's interactive shell profile.
            command.get_argv_mut().extend([
                OsString::from("/bin/sh"),
                OsString::from("-c"),
                OsString::from(
                    r#"printf '%s\0' "$HOME" "$XDG_CONFIG_HOME" "$OPENCODE_CONFIG_DIR" "$OPENCODE_CONFIG" "$OPENCODE_TUI_CONFIG" "$HERMES_TUI_THEME" "$PWD" > "$GCHAT_TEST_ENV_FILE"
if [ "$OPENCODE_CONFIG" = "$GCHAT_TEST_EXPECTED_CONFIG" ]; then
    cat "$OPENCODE_CONFIG" > "$GCHAT_TEST_CONFIG_FILE"
fi
printf '__GCHAT_PTY_OK__\n'"#,
                ),
            ]);
            command.env("GCHAT_TEST_ENV_FILE", witness.as_os_str());
            command.env("GCHAT_TEST_EXPECTED_CONFIG", config_path.as_os_str());
            command.env("GCHAT_TEST_CONFIG_FILE", copied_config.as_os_str());

            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let mut reader = pair.master.try_clone_reader().unwrap();
            let mut child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            let mut output = String::new();
            reader.read_to_string(&mut output).unwrap();
            assert!(child.wait().unwrap().success());
            assert!(output.contains("__GCHAT_PTY_OK__"));

            let mut expected = inherited.clone();
            if launch == TerminalLaunch::OpenCode {
                expected[1] = data.path().join("code").into_os_string();
                expected[2] = data.path().join("code/opencode").into_os_string();
                expected[3] = config_path.clone().into_os_string();
                expected[4] = directory.join("gchat-tui.json").into_os_string();
                assert_eq!(std::fs::read(&copied_config).unwrap(), config);
            } else {
                assert!(!copied_config.exists());
            }
            if launch == TerminalLaunch::Hermes {
                expected[5] = "dark".into();
            }
            expected.push(project.path().as_os_str().to_owned());
            let expected: Vec<u8> = expected
                .iter()
                .flat_map(|value| value.as_os_str().as_bytes().iter().copied().chain([0]))
                .collect();
            assert_eq!(std::fs::read(&witness).unwrap(), expected, "{launch:?}");
        }
        assert_eq!(std::env::var_os("HOME").unwrap_or_default(), inherited[0]);
    }
}
