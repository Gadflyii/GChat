//! Native ownership of one suspended hardware profiler and its private Job.
use std::{
    cmp::Ordering,
    ffi::{c_void, OsStr},
    io,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::ExitStatusExt,
    },
    path::Path,
    process::{Command, ExitStatus},
    ptr::{null, null_mut},
    sync::Arc,
};
use tokio::{fs::File, sync::oneshot};

type Handle = *mut c_void;
const INVALID_HANDLE: Handle = -1_isize as Handle;
const WAIT_OBJECT_0: u32 = 0;
const INFINITE: u32 = u32::MAX;
const CREATE_SUSPENDED: u32 = 0x0000_0004;
const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;
const EXTENDED_STARTUPINFO_PRESENT: u32 = 0x0008_0000;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const PROC_THREAD_ATTRIBUTE_JOB_LIST: usize = 0x0002_000d;

#[repr(C)]
struct SecurityAttributes {
    length: u32,
    descriptor: *mut c_void,
    inherit: i32,
}
#[repr(C)]
struct StartupInfo {
    size: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    x_size: u32,
    y_size: u32,
    x_chars: u32,
    y_chars: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved_bytes: *mut u8,
    stdin: Handle,
    stdout: Handle,
    stderr: Handle,
}
#[repr(C)]
struct StartupInfoEx {
    startup: StartupInfo,
    attributes: *mut c_void,
}
#[repr(C)]
struct ProcessInformation {
    process: Handle,
    thread: Handle,
    pid: u32,
    thread_id: u32,
}
#[repr(C)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    minimum_working_set: usize,
    maximum_working_set: usize,
    process_count: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[repr(C)]
struct ExtendedLimits {
    basic: BasicLimits,
    io_counters: [u64; 6],
    process_memory: usize,
    job_memory: usize,
    peak_process_memory: usize,
    peak_job_memory: usize,
}

const _: [(); 24] = [(); size_of::<SecurityAttributes>()];
const _: [(); 104] = [(); size_of::<StartupInfo>()];
const _: [(); 112] = [(); size_of::<StartupInfoEx>()];
const _: [(); 24] = [(); size_of::<ProcessInformation>()];
const _: [(); 64] = [(); size_of::<BasicLimits>()];
const _: [(); 144] = [(); size_of::<ExtendedLimits>()];

#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *const SecurityAttributes, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
    fn IsProcessInJob(process: Handle, job: Handle, result: *mut i32) -> i32;
    fn CreatePipe(read: *mut Handle, write: *mut Handle, attributes: *const SecurityAttributes, size: u32) -> i32;
    fn SetHandleInformation(handle: Handle, mask: u32, flags: u32) -> i32;
    fn CreateFileW(name: *const u16, access: u32, share: u32, attributes: *const SecurityAttributes, disposition: u32, flags: u32, template: Handle) -> Handle;
    fn InitializeProcThreadAttributeList(list: *mut c_void, count: u32, flags: u32, size: *mut usize) -> i32;
    fn UpdateProcThreadAttribute(list: *mut c_void, flags: u32, attribute: usize, value: *const c_void, size: usize, previous: *mut c_void, returned: *mut usize) -> i32;
    fn DeleteProcThreadAttributeList(list: *mut c_void);
    fn CreateProcessW(application: *const u16, command: *mut u16, process_attributes: *const SecurityAttributes, thread_attributes: *const SecurityAttributes, inherit: i32, flags: u32, environment: *const c_void, directory: *const u16, startup: *const StartupInfoEx, information: *mut ProcessInformation) -> i32;
    fn ResumeThread(thread: Handle) -> u32;
    fn TerminateProcess(process: Handle, code: u32) -> i32;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn GetExitCodeProcess(process: Handle, code: *mut u32) -> i32;
    fn RegisterWaitForSingleObject(wait: *mut Handle, object: Handle, callback: unsafe extern "system" fn(*mut c_void, u8), context: *mut c_void, milliseconds: u32, flags: u32) -> i32;
    fn UnregisterWaitEx(wait: Handle, completion: Handle) -> i32;
    fn GetEnvironmentStringsW() -> *mut u16;
    fn FreeEnvironmentStringsW(environment: *mut u16) -> i32;
    fn CompareStringOrdinal(first: *const u16, first_len: i32, second: *const u16, second_len: i32, ignore_case: i32) -> i32;
}

fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut value: Vec<_> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "native profiling input contains NUL"));
    }
    value.push(0);
    Ok(value)
}

fn append_argument(output: &mut Vec<u16>, argument: &OsStr) -> io::Result<()> {
    let argument = wide(argument)?;
    output.push(b'"' as u16);
    let mut slashes = 0;
    for &unit in &argument[..argument.len() - 1] {
        if unit == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        let escaped_slashes = slashes * if unit == b'"' as u16 { 2 } else { 1 };
        output.resize(output.len() + escaped_slashes, b'\\' as u16);
        if unit == b'"' as u16 {
            output.push(b'\\' as u16);
        }
        slashes = 0;
        output.push(unit);
    }
    output.resize(output.len() + slashes * 2, b'\\' as u16);
    output.push(b'"' as u16);
    Ok(())
}

fn key(entry: &[u16]) -> &[u16] {
    let offset = usize::from(entry.first() == Some(&(b'=' as u16)));
    let end = entry[offset..].iter().position(|unit| *unit == b'=' as u16)
        .map_or(entry.len(), |index| offset + index);
    &entry[..end]
}
fn compare(first: &[u16], second: &[u16]) -> io::Result<Ordering> {
    let first_len = i32::try_from(first.len()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "environment name is too long"))?;
    let second_len = i32::try_from(second.len()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "environment name is too long"))?;
    match unsafe { CompareStringOrdinal(first.as_ptr(), first_len, second.as_ptr(), second_len, 1) } {
        1 => Ok(Ordering::Less),
        2 => Ok(Ordering::Equal),
        3 => Ok(Ordering::Greater),
        _ => Err(io::Error::last_os_error()),
    }
}
fn environment(command: &Command) -> io::Result<Vec<u16>> {
    struct Inherited(*mut u16);
    impl Drop for Inherited {
        fn drop(&mut self) {
            unsafe { FreeEnvironmentStringsW(self.0) };
        }
    }
    let inherited = Inherited(unsafe { GetEnvironmentStringsW() });
    if inherited.0.is_null() {
        return Err(io::Error::last_os_error());
    }
    let mut entries = Vec::new();
    let mut offset = 0;
    unsafe {
        while *inherited.0.add(offset) != 0 {
            let start = offset;
            while *inherited.0.add(offset) != 0 {
                offset += 1;
            }
            entries.push(std::slice::from_raw_parts(inherited.0.add(start), offset - start).to_vec());
            offset += 1;
        }
    }
    // The prepared profiling command inherits Host environment and overlays its group/PATH.
    for (name, value) in command.get_envs() {
        let name = wide(name)?;
        let name = &name[..name.len() - 1];
        if name.is_empty() || name.contains(&(b'=' as u16)) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid profiling environment name"));
        }
        let mut index = 0;
        while index < entries.len() {
            if compare(key(&entries[index]), name)? == Ordering::Equal {
                entries.remove(index);
            } else {
                index += 1;
            }
        }
        if let Some(value) = value {
            let value = wide(value)?;
            let mut entry = name.to_vec();
            entry.push(b'=' as u16);
            entry.extend_from_slice(&value[..value.len() - 1]);
            entries.push(entry);
        }
    }
    let mut error = None;
    entries.sort_by(|first, second| compare(key(first), key(second)).unwrap_or_else(|cause| {
        error = Some(cause);
        Ordering::Equal
    }));
    if let Some(error) = error {
        return Err(error);
    }
    let mut output = Vec::new();
    for entry in entries {
        output.extend(entry);
        output.push(0);
    }
    if output.is_empty() {
        output.push(0);
    }
    output.push(0);
    Ok(output)
}

struct Attributes(Vec<usize>);
impl Attributes {
    fn new() -> io::Result<Self> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes) };
        if bytes == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0_usize; bytes.div_ceil(size_of::<usize>())];
        if unsafe { InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), 2, 0, &mut bytes) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(buffer))
    }
    fn pointer(&mut self) -> *mut c_void {
        self.0.as_mut_ptr().cast()
    }
    fn set(&mut self, attribute: usize, handles: &[Handle]) -> io::Result<()> {
        if unsafe { UpdateProcThreadAttribute(self.pointer(), 0, attribute, handles.as_ptr().cast(), std::mem::size_of_val(handles), null_mut(), null_mut()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.pointer()) };
    }
}
fn pipe(attributes: &SecurityAttributes) -> io::Result<(OwnedHandle, OwnedHandle)> {
    let (mut read, mut write) = (null_mut(), null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, attributes, 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let read = unsafe { OwnedHandle::from_raw_handle(read) };
    let write = unsafe { OwnedHandle::from_raw_handle(write) };
    if unsafe { SetHandleInformation(read.as_raw_handle(), 1, 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((read, write))
}

struct WaitRegistration {
    handle: Handle,
    sender: *mut Option<oneshot::Sender<()>>,
    process: Option<Arc<OwnedHandle>>,
}
// The one-shot callback owns access to sender until synchronous unregistration completes.
unsafe impl Send for WaitRegistration {}
impl Drop for WaitRegistration {
    fn drop(&mut self) {
        if unsafe { UnregisterWaitEx(self.handle, INVALID_HANDLE) } != 0 {
            unsafe { drop(Box::from_raw(self.sender)) };
        } else {
            eprintln!("Cannot unregister native profiler wait: {}", io::Error::last_os_error());
            // An unproven callback lifetime must not access freed context or a closed handle.
            std::mem::forget(self.process.take());
        }
    }
}
unsafe extern "system" fn exited(context: *mut c_void, _timed_out: u8) {
    let sender = unsafe { &mut *context.cast::<Option<oneshot::Sender<()>>>() };
    if let Some(sender) = sender.take() {
        let _ = sender.send(());
    }
}

pub(crate) struct Child {
    wait: Option<(WaitRegistration, oneshot::Receiver<()>)>,
    process: Arc<OwnedHandle>,
    thread: Option<OwnedHandle>,
    job: Option<OwnedHandle>,
    pid: u32,
    stdout: Option<File>,
    stderr: Option<File>,
    preparation_error: Option<String>,
    signaled: bool,
    exit: Option<ExitStatus>,
}
impl Child {
    pub(crate) fn id(&self) -> Option<u32> {
        self.exit.is_none().then_some(self.pid)
    }
    pub(crate) fn take_stdout(&mut self) -> Option<File> {
        self.stdout.take()
    }
    pub(crate) fn take_stderr(&mut self) -> Option<File> {
        self.stderr.take()
    }
    pub(crate) fn resume(&mut self) -> Result<(), String> {
        if let Some(error) = &self.preparation_error {
            return Err(error.clone());
        }
        let Some(thread) = &self.thread else { return Ok(()) };
        let resumed = unsafe { ResumeThread(thread.as_raw_handle()) };
        if resumed == u32::MAX {
            return Err(io::Error::last_os_error().to_string());
        }
        if resumed != 1 {
            return Err(format!("Unexpected native profiler suspend count: {resumed}"));
        }
        self.thread.take();
        Ok(())
    }
    pub(crate) fn start_kill(&mut self) -> io::Result<()> {
        if unsafe { TerminateProcess(self.process.as_raw_handle(), 1) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } == WAIT_OBJECT_0 {
            Ok(())
        } else {
            Err(error)
        }
    }
    pub(crate) async fn wait(&mut self) -> io::Result<ExitStatus> {
        if let Some(exit) = self.exit {
            return Ok(exit);
        }
        if !self.signaled {
            if self.wait.is_none() {
                let (sender, receiver) = oneshot::channel();
                let sender = Box::into_raw(Box::new(Some(sender)));
                let mut handle = null_mut();
                if unsafe { RegisterWaitForSingleObject(&mut handle, self.process.as_raw_handle(), exited, sender.cast(), INFINITE, 8) } == 0 {
                    let error = io::Error::last_os_error();
                    unsafe { drop(Box::from_raw(sender)) };
                    return Err(error);
                }
                self.wait = Some((WaitRegistration { handle, sender, process: Some(self.process.clone()) }, receiver));
            }
            if (&mut self.wait.as_mut().unwrap().1).await.is_err() {
                self.wait.take();
                return Err(io::Error::other("native profiler wait notification was lost"));
            }
            self.signaled = true;
        }
        let mut code = 0;
        if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let exit = ExitStatus::from_raw(code);
        self.exit = Some(exit);
        Ok(exit)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        if self.exit.is_none() {
            if let Err(error) = self.start_kill() {
                eprintln!("Cannot terminate native profiler {}: {error}", self.pid);
            }
        }
        // The noninherited final Job handle also kills owned descendants on Host loss.
        self.job.take();
    }
}

pub(crate) fn spawn(command: &Command) -> Result<Child, String> {
    spawn_native(command).map_err(|error| error.to_string())
}
fn spawn_native(command: &Command) -> io::Result<Child> {
    let program = Path::new(command.get_program());
    let args: Vec<_> = command.get_args().collect();
    if !program.is_absolute() || program.file_name() != Some(OsStr::new("ginfer.exe"))
        || !(args.len() == 3 || args.len() == 4)
        || args[0] != "profile-hardware" || args[1] != "--hardware-profile"
        || (args.len() == 4 && args[3] != "--reprofile")
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "expected the prepared native ginfer profiling command"));
    }
    let application = wide(command.get_program())?;
    let directory = command.get_current_dir().map(|path| wide(path.as_os_str())).transpose()?;
    let environment = environment(command)?;
    let mut line = Vec::new();
    append_argument(&mut line, command.get_program())?;
    for arg in args {
        line.push(b' ' as u16);
        append_argument(&mut line, arg)?;
    }
    line.push(0);
    let raw_job = unsafe { CreateJobObjectW(null(), null()) };
    if raw_job.is_null() {
        return Err(io::Error::last_os_error());
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw_job) };
    let mut limits: ExtendedLimits = unsafe { zeroed() };
    limits.basic.flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe { SetInformationJobObject(job.as_raw_handle(), 9, (&limits as *const ExtendedLimits).cast(), size_of::<ExtendedLimits>() as u32) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let security = SecurityAttributes { length: size_of::<SecurityAttributes>() as u32, descriptor: null_mut(), inherit: 1 };
    let (stdout, stdout_write) = pipe(&security)?;
    let (stderr, stderr_write) = pipe(&security)?;
    let nul = wide(OsStr::new("NUL"))?;
    let input = unsafe { CreateFileW(nul.as_ptr(), 0x8000_0000, 3, &security, 3, 0x80, null_mut()) };
    if input == INVALID_HANDLE {
        return Err(io::Error::last_os_error());
    }
    let input = unsafe { OwnedHandle::from_raw_handle(input) };
    let inherited = [input.as_raw_handle(), stdout_write.as_raw_handle(), stderr_write.as_raw_handle()];
    let jobs = [job.as_raw_handle()];
    let mut attributes = Attributes::new()?;
    attributes.set(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &inherited)?;
    // Native creation assigns the Job before it can return a suspended orphan.
    attributes.set(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
    let mut startup: StartupInfoEx = unsafe { zeroed() };
    startup.startup.size = size_of::<StartupInfoEx>() as u32;
    startup.startup.flags = 0x100;
    startup.startup.stdin = input.as_raw_handle();
    startup.startup.stdout = stdout_write.as_raw_handle();
    startup.startup.stderr = stderr_write.as_raw_handle();
    startup.attributes = attributes.pointer();
    let mut information: ProcessInformation = unsafe { zeroed() };
    if unsafe { CreateProcessW(application.as_ptr(), line.as_mut_ptr(), null(), null(), 1,
        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
        environment.as_ptr().cast(), directory.as_ref().map_or(null(), |value| value.as_ptr()), &startup, &mut information) } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let process = Arc::new(unsafe { OwnedHandle::from_raw_handle(information.process) });
    let thread = unsafe { OwnedHandle::from_raw_handle(information.thread) };
    let mut member = 0;
    let preparation_error = if unsafe { IsProcessInJob(process.as_raw_handle(), job.as_raw_handle(), &mut member) } == 0 {
        Some(format!("Cannot verify native profiler Job ownership: {}", io::Error::last_os_error()))
    } else if member == 0 {
        Some("Native profiler is not in its lifetime Job".into())
    } else {
        None
    };
    Ok(Child {
        wait: None, process, thread: Some(thread), job: Some(job), pid: information.pid,
        stdout: Some(File::from_std(std::fs::File::from(stdout))),
        stderr: Some(File::from_std(std::fs::File::from(stderr))),
        preparation_error, signaled: false, exit: None,
    })
}
