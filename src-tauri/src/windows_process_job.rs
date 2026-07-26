//! Windows ownership boundary for processes started by CovenCave.
//!
//! A Job Object with KILL_ON_JOB_CLOSE is the only cleanup mechanism here
//! that also survives TerminateProcess/Task Manager, where Rust destructors do
//! not run. Each owned root gets its own job before it is published to shared
//! state; descendants inherit membership automatically.

use std::ffi::{OsStr, OsString};
use std::io;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::os::windows::process::CommandExt;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command};

use rand::{rngs::OsRng, RngCore};
use windows_sys::Win32::Foundation::{
    CloseHandle, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, OpenEventW, OpenProcess, SetEvent, WaitForMultipleObjects, WaitForSingleObject,
    EVENT_MODIFY_STATE, INFINITE, PROCESS_SET_QUOTA, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    SYNCHRONIZATION_SYNCHRONIZE,
};

/// Private argv marker for the tiny process that waits until its parent has
/// assigned it to a Job Object before it launches the real program.
const GATED_CHILD_SENTINEL: &str = "--coven-cave-internal-gated-child-v1";
const GATED_CHILD_ERROR_EXIT_CODE: i32 = 125;
const GATED_CHILD_NO_WINDOW_ENV: &str = "COVENCAVE_INTERNAL_GATED_CHILD_NO_WINDOW";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const GATE_READY_TIMEOUT_MS: u32 = 5_000;

/// A named manual-reset event used to hold a launcher process before it starts
/// the real child. Keep this value alive until after [`Self::release`] returns;
/// its handle keeps the named event available while the launcher opens it.
#[derive(Debug)]
pub struct ProcessLaunchGate {
    release_handle: HANDLE,
    ready_handle: HANDLE,
    event_name: String,
    ready_event_name: String,
}

// Event handles can be signalled and closed from a different thread than the
// one that created them.
unsafe impl Send for ProcessLaunchGate {}
unsafe impl Sync for ProcessLaunchGate {}

impl ProcessLaunchGate {
    pub fn new() -> io::Result<Self> {
        let mut nonce = [0u8; 16];
        OsRng.fill_bytes(&mut nonce);
        let nonce = nonce
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let event_stem = format!(
            r"Local\CovenCave.ProcessLaunchGate.{}.{}",
            std::process::id(),
            nonce
        );
        let event_name = format!("{event_stem}.Release");
        let ready_event_name = format!("{event_stem}.Ready");
        let wide_name = wide_null(&event_name);
        let release_handle = unsafe {
            CreateEventW(
                std::ptr::null(),
                1, // manual reset: a release cannot be consumed by the wrong waiter
                0,
                wide_name.as_ptr(),
            )
        };
        if release_handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let wide_ready_name = wide_null(&ready_event_name);
        let ready_handle =
            unsafe { CreateEventW(std::ptr::null(), 1, 0, wide_ready_name.as_ptr()) };
        if ready_handle.is_null() {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(release_handle) };
            return Err(error);
        }

        Ok(Self {
            release_handle,
            ready_handle,
            event_name,
            ready_event_name,
        })
    }

    #[cfg(test)]
    pub fn event_name(&self) -> &str {
        &self.event_name
    }

    /// Build the private current-executable launcher command line. The caller
    /// may use [`GatedChildLauncher::into_std_command`] or feed its executable
    /// and arguments to `portable_pty::CommandBuilder`.
    pub fn launcher<P, I, S>(&self, program: P, args: I) -> io::Result<GatedChildLauncher>
    where
        P: AsRef<OsStr>,
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        if program.as_ref().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "gated child program cannot be empty",
            ));
        }

        let executable = std::env::current_exe()?;
        let mut arguments = vec![
            OsString::from(GATED_CHILD_SENTINEL),
            OsString::from(&self.event_name),
            OsString::from(&self.ready_event_name),
            OsString::from(std::process::id().to_string()),
            program.as_ref().to_owned(),
        ];
        arguments.extend(
            args.into_iter()
                .map(|argument| argument.as_ref().to_owned()),
        );
        Ok(GatedChildLauncher {
            executable,
            arguments,
        })
    }

    /// Allow the already-spawned and Job-assigned launcher to start the real
    /// program. A bounded ready handshake ensures the launcher owns its event
    /// handle before this method returns, so the gate may then be dropped.
    pub fn release(&self) -> io::Result<()> {
        let released = unsafe { SetEvent(self.release_handle) };
        if released == 0 {
            return Err(io::Error::last_os_error());
        }

        match unsafe { WaitForSingleObject(self.ready_handle, GATE_READY_TIMEOUT_MS) } {
            WAIT_OBJECT_0 => Ok(()),
            WAIT_TIMEOUT => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "gated child launcher did not become ready",
            )),
            WAIT_FAILED => Err(io::Error::last_os_error()),
            value => Err(io::Error::other(format!(
                "unexpected process gate ready result {value}"
            ))),
        }
    }
}

impl Drop for ProcessLaunchGate {
    fn drop(&mut self) {
        if !self.ready_handle.is_null() {
            unsafe { CloseHandle(self.ready_handle) };
            self.ready_handle = std::ptr::null_mut();
        }
        if !self.release_handle.is_null() {
            unsafe { CloseHandle(self.release_handle) };
            self.release_handle = std::ptr::null_mut();
        }
    }
}

/// Command-line description for the private current-executable launcher.
#[derive(Debug)]
pub struct GatedChildLauncher {
    executable: PathBuf,
    arguments: Vec<OsString>,
}

impl GatedChildLauncher {
    #[cfg(test)]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    #[cfg(test)]
    pub fn arguments(&self) -> &[OsString] {
        &self.arguments
    }

    pub fn into_argv(self) -> Vec<OsString> {
        let mut argv = Vec::with_capacity(self.arguments.len() + 1);
        argv.push(self.executable.into_os_string());
        argv.extend(self.arguments);
        argv
    }

    pub fn into_std_command(self) -> Command {
        let mut command = Command::new(self.executable);
        command.args(self.arguments);
        command.env(GATED_CHILD_NO_WINDOW_ENV, "1");
        command
    }
}

#[derive(Debug)]
struct GatedChildRequest {
    event_name: String,
    ready_event_name: String,
    parent_pid: u32,
    program: OsString,
    arguments: Vec<OsString>,
}

fn parse_gated_child_request<I>(args: I) -> io::Result<Option<GatedChildRequest>>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(OsStr::new(GATED_CHILD_SENTINEL)) {
        return Ok(None);
    }

    let event_name = args
        .next()
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing gate event name"))?;
    let ready_event_name = args
        .next()
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing ready event name"))?;
    let parent_pid = args
        .next()
        .and_then(|value| value.into_string().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid != 0)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid gate parent pid"))?;
    let program = args
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "missing gated child program")
        })?;

    Ok(Some(GatedChildRequest {
        event_name,
        ready_event_name,
        parent_pid,
        program,
        arguments: args.collect(),
    }))
}

fn wide_null(value: impl AsRef<OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Wait until the parent releases the launch event, or fail when the parent
/// exits first. Watching the parent prevents an unassigned launcher from
/// becoming an orphan if CovenCave crashes between `spawn` and Job assignment.
fn wait_for_gate_release(
    event_name: &str,
    ready_event_name: &str,
    parent_pid: u32,
) -> io::Result<()> {
    let wide_name = wide_null(event_name);
    let event = unsafe { OpenEventW(SYNCHRONIZATION_SYNCHRONIZE, 0, wide_name.as_ptr()) };
    if event.is_null() {
        return Err(io::Error::last_os_error());
    }

    let wide_ready_name = wide_null(ready_event_name);
    let ready_event = unsafe {
        OpenEventW(
            SYNCHRONIZATION_SYNCHRONIZE | EVENT_MODIFY_STATE,
            0,
            wide_ready_name.as_ptr(),
        )
    };
    if ready_event.is_null() {
        let error = io::Error::last_os_error();
        unsafe { CloseHandle(event) };
        return Err(error);
    }

    let parent = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_pid) };
    if parent.is_null() {
        let error = io::Error::last_os_error();
        unsafe {
            CloseHandle(ready_event);
            CloseHandle(event);
        }
        return Err(error);
    }

    if unsafe { SetEvent(ready_event) } == 0 {
        let error = io::Error::last_os_error();
        unsafe {
            CloseHandle(parent);
            CloseHandle(ready_event);
            CloseHandle(event);
        }
        return Err(error);
    }
    unsafe { CloseHandle(ready_event) };

    let handles = [event, parent];
    let wait_result =
        unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
    unsafe {
        CloseHandle(parent);
        CloseHandle(event);
    }

    match wait_result {
        WAIT_OBJECT_0 => Ok(()),
        value if value == WAIT_OBJECT_0 + 1 => Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "gate parent exited before releasing the child",
        )),
        WAIT_FAILED => Err(io::Error::last_os_error()),
        value => Err(io::Error::other(format!(
            "unexpected process gate wait result {value}"
        ))),
    }
}

fn run_gated_child(request: GatedChildRequest) -> io::Result<i32> {
    wait_for_gate_release(
        &request.event_name,
        &request.ready_event_name,
        request.parent_pid,
    )?;

    // Command inherits the launcher's environment, current directory, and
    // standard handles. The launcher remains the Job-owned root and waits so
    // its exit status mirrors the real program.
    let no_window = std::env::var_os(GATED_CHILD_NO_WINDOW_ENV).as_deref() == Some(OsStr::new("1"));
    let mut command = Command::new(request.program);
    command
        .args(request.arguments)
        .env_remove(GATED_CHILD_NO_WINDOW_ENV);
    if no_window {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let status = command.status()?;
    Ok(status.code().unwrap_or(GATED_CHILD_ERROR_EXIT_CODE))
}

/// Handle the private process-gate launcher mode, if requested. Call this at
/// the very start of the executable, before Tauri or any application services
/// initialize. The returned code should be passed directly to
/// `std::process::exit`.
pub fn run_gated_child_if_requested() -> Option<i32> {
    match parse_gated_child_request(std::env::args_os().skip(1)) {
        Ok(None) => None,
        Ok(Some(request)) => Some(run_gated_child(request).unwrap_or_else(|error| {
            eprintln!("[cave] gated child launcher failed: {error}");
            GATED_CHILD_ERROR_EXIT_CODE
        })),
        Err(error) => {
            eprintln!("[cave] invalid gated child launcher request: {error}");
            Some(GATED_CHILD_ERROR_EXIT_CODE)
        }
    }
}

#[derive(Debug)]
pub struct ProcessJob {
    handle: HANDLE,
}

// A Job handle may be used from the startup worker and dropped during Tauri's
// cleanup path. Windows kernel handles support cross-thread use.
unsafe impl Send for ProcessJob {}
unsafe impl Sync for ProcessJob {}

impl ProcessJob {
    pub fn new() -> io::Result<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(handle) };
            return Err(error);
        }

        Ok(Self { handle })
    }

    pub fn assign_child(&self, child: &Child) -> io::Result<()> {
        self.assign_handle(child.as_raw_handle())
    }

    pub fn assign_pid(&self, pid: u32) -> io::Result<()> {
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err(io::Error::last_os_error());
        }
        let result = self.assign_handle(process as RawHandle);
        unsafe { CloseHandle(process) };
        result
    }

    fn assign_handle(&self, process: RawHandle) -> io::Result<()> {
        let assigned = unsafe { AssignProcessToJobObject(self.handle, process as HANDLE) };
        if assigned == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    /// Termination is a kernel operation over the complete job tree and does
    /// not wait on child cooperation, JavaScript, pipes, or taskkill.exe.
    pub fn terminate(&self) -> io::Result<()> {
        let terminated = unsafe { TerminateJobObject(self.handle, 1) };
        if terminated == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

impl Drop for ProcessJob {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { CloseHandle(self.handle) };
            self.handle = std::ptr::null_mut();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_gated_child_request, wait_for_gate_release, ProcessJob, ProcessLaunchGate,
        GATED_CHILD_SENTINEL,
    };
    use std::ffi::{OsStr, OsString};
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    fn wait_for_pid_exit(pid: u32, timeout: Duration) -> bool {
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            return true;
        }
        let timeout_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        let result = unsafe { WaitForSingleObject(process, timeout_ms) };
        unsafe { CloseHandle(process) };
        result == WAIT_OBJECT_0
    }

    #[test]
    fn launch_gate_builds_private_current_exe_argv_without_losing_arguments() {
        let gate = ProcessLaunchGate::new().expect("create process launch gate");
        let launcher = gate
            .launcher(
                OsStr::new(r"C:\Program Files\Coven\fixture.exe"),
                [
                    OsString::from("--flag"),
                    OsString::from("value with spaces"),
                ],
            )
            .expect("build gated launcher");

        assert_eq!(
            launcher.executable(),
            std::env::current_exe().expect("resolve current test executable")
        );
        assert_eq!(launcher.arguments()[0], GATED_CHILD_SENTINEL);
        assert_eq!(launcher.arguments()[1], gate.event_name());
        assert_eq!(
            launcher.arguments()[3],
            OsString::from(std::process::id().to_string())
        );
        assert_eq!(
            launcher.arguments()[4],
            OsStr::new(r"C:\Program Files\Coven\fixture.exe")
        );
        assert_eq!(launcher.arguments()[5], "--flag");
        assert_eq!(launcher.arguments()[6], "value with spaces");
    }

    #[test]
    fn launch_gate_names_are_unique_and_release_unblocks_waiter() {
        let gate = ProcessLaunchGate::new().expect("create first process launch gate");
        let other = ProcessLaunchGate::new().expect("create second process launch gate");
        assert_ne!(gate.event_name(), other.event_name());

        let event_name = gate.event_name().to_string();
        let ready_event_name = gate.ready_event_name.clone();
        let (result_tx, result_rx) = mpsc::channel();
        let waiter = thread::spawn(move || {
            result_tx
                .send(wait_for_gate_release(
                    &event_name,
                    &ready_event_name,
                    std::process::id(),
                ))
                .expect("publish gate wait result");
        });

        assert!(
            result_rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "the named event holds the launcher before release"
        );
        gate.release().expect("release process launch gate");
        result_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("waiter finishes after release")
            .expect("gate wait succeeds");
        waiter.join().expect("join gate waiter");
    }

    #[test]
    fn private_launcher_parser_rejects_incomplete_requests() {
        assert!(
            parse_gated_child_request([OsString::from("ordinary-argument")])
                .expect("ordinary invocation parses")
                .is_none()
        );
        assert!(parse_gated_child_request([OsString::from(GATED_CHILD_SENTINEL)]).is_err());
        assert!(parse_gated_child_request([
            OsString::from(GATED_CHILD_SENTINEL),
            OsString::from("event"),
            OsString::from("ready-event"),
            OsString::from("not-a-pid"),
            OsString::from("program"),
        ])
        .is_err());
    }

    #[test]
    fn closing_job_kills_root_and_descendant_without_taskkill() {
        let powershell = std::env::var_os("SYSTEMROOT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        let script = r#"$null=[Console]::In.ReadLine(); $p=Start-Process "$env:SystemRoot\System32\ping.exe" -ArgumentList '127.0.0.1','-n','30' -WindowStyle Hidden -PassThru; [Console]::Out.WriteLine($p.Id); Wait-Process -Id $p.Id"#;
        let mut root = Command::new(powershell)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .expect("spawn job root fixture");

        let job = ProcessJob::new().expect("create kill-on-close job");
        job.assign_child(&root)
            .expect("assign root before it spawns child");
        writeln!(root.stdin.take().expect("fixture stdin")).expect("release fixture");
        let mut pid_line = String::new();
        BufReader::new(root.stdout.take().expect("fixture stdout"))
            .read_line(&mut pid_line)
            .expect("read descendant pid");
        let descendant_pid: u32 = pid_line.trim().parse().expect("numeric descendant pid");
        assert!(!wait_for_pid_exit(descendant_pid, Duration::from_millis(0)));

        let started = Instant::now();
        drop(job);
        while root.try_wait().expect("inspect root fixture").is_none()
            && started.elapsed() < Duration::from_secs(3)
        {
            thread::sleep(Duration::from_millis(10));
        }

        assert!(
            started.elapsed() < Duration::from_secs(3),
            "root job process exits within the deadline"
        );
        assert!(
            wait_for_pid_exit(descendant_pid, Duration::from_secs(3)),
            "descendant process exits when the job handle closes",
        );
    }
}
