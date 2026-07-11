// PTY backend for the bottom terminal pane in CovenCave.
//
// Mirrors the design that ships in BunsDev/comux/native/macos/comux-tauri:
// each terminal session is keyed by a stable id (so the JS layer can have
// multiple terminals, eg. one per tab), a HashMap holds the master ends,
// and a background thread pumps bytes from the slave's read side back to
// the webview via `app.emit("pty:data", ...)`.
//
// Surfaced as tauri::commands:
//   pty_start(StartOptions)
//   pty_write(thread_id, bytes)
//   pty_resize(thread_id, cols, rows)
//   pty_stop(thread_id)
//   pty_list() -> Vec<String>
//
// Events emitted to the frontend:
//   pty:data { thread_id, bytes }
//   pty:exit { thread_id, code }

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Url, Webview};
use log::{debug, info, warn};

struct PtySession {
    /// Declare the job before the ConPTY master so any ordinary session drop
    /// kills clients before ClosePseudoConsole runs. Older Windows releases
    /// can otherwise block ClosePseudoConsole while clients remain attached.
    #[cfg(target_os = "windows")]
    process_job: crate::windows_process_job::ProcessJob,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Bounded ring of recent output. Terminal views remount on tab switches
    /// (the PTY deliberately outlives them); replaying this on reattach
    /// restores the screen instead of presenting a blank-but-alive shell.
    scrollback: Arc<Mutex<Vec<u8>>>,
}

/// Cap on replayed output per session (~enough to repaint a busy screen).
const SCROLLBACK_LIMIT_BYTES: usize = 256 * 1024;

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static STARTING_SESSIONS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static TRUSTED_MAIN_ORIGINS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Terminate every owned PTY process tree without dropping ConPTY masters on
/// the Windows UI thread. ClosePseudoConsole could block indefinitely before
/// Windows 11 24H2 while clients or output pipes remained attached; process
/// exit will reclaim the retained handles after the bounded job termination.
#[cfg(target_os = "windows")]
pub fn terminate_all_owned_processes() {
    if let Some(sessions) = SESSIONS.try_lock() {
        for (thread_id, session) in sessions.iter() {
            if let Err(error) = session.process_job.terminate() {
                warn!(
                    "pty shutdown[{}]: could not terminate process job: {}",
                    thread_id, error
                );
            }
        }
    }
}

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 40;

fn url_origin(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;
    Some(format!("{}://{}:{}", url.scheme(), host, port))
}

pub fn trust_main_origin(url: &Url) {
    if let Some(origin) = url_origin(url) {
        info!("trusting main webview origin for PTY IPC: {}", origin);
        let mut trusted = TRUSTED_MAIN_ORIGINS.lock();
        trusted.clear();
        trusted.insert(origin);
    } else {
        warn!("not trusting main webview origin for PTY IPC: {}", url);
    }
}

fn ensure_trusted_pty_caller(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        warn!("denied PTY IPC from non-main webview: {}", webview.label());
        return Err("PTY commands are only available to the main app webview".to_string());
    }

    let url = webview.url().map_err(|e| format!("could not resolve caller URL: {e}"))?;
    let origin = url_origin(&url).ok_or_else(|| format!("untrusted PTY caller URL: {url}"))?;
    if TRUSTED_MAIN_ORIGINS.lock().contains(&origin) {
        Ok(())
    } else {
        warn!("denied PTY IPC from untrusted main webview origin: {}", origin);
        Err("PTY commands are not available to this origin".to_string())
    }
}

/// RAII guard: makes sure a thread_id we reserved in STARTING_SESSIONS
/// is always removed even if start fails partway through.
struct PendingPtyStart {
    thread_id: String,
}

impl PendingPtyStart {
    fn reserve(thread_id: &str) -> Result<Self, String> {
        let sessions = SESSIONS.lock();
        let mut starting = STARTING_SESSIONS.lock();
        if sessions.contains_key(thread_id) || starting.contains(thread_id) {
            return Err(format!("pty '{}' already running", thread_id));
        }
        starting.insert(thread_id.to_string());
        Ok(Self {
            thread_id: thread_id.to_string(),
        })
    }
}

impl Drop for PendingPtyStart {
    fn drop(&mut self) {
        STARTING_SESSIONS.lock().remove(&self.thread_id);
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartOptions {
    pub thread_id: String,
    pub project_root: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PtyDataEvent {
    pub thread_id: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PtyExitEvent {
    pub thread_id: String,
    pub code: Option<i32>,
}

#[tauri::command]
pub fn pty_start(app: AppHandle, webview: Webview, options: StartOptions) -> Result<(), String> {
    ensure_trusted_pty_caller(&webview)?;
    let thread_id = options.thread_id.clone();
    info!("pty_start: thread_id={} project_root={:?} cols={:?} rows={:?}",
        thread_id, options.project_root, options.cols, options.rows);
    let pending = PendingPtyStart::reserve(&thread_id)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size_from_options(&options))
        .map_err(|e| e.to_string())?;

    // Do not accept renderer-supplied command/args/env. PTY permissions are
    // available to the main webview, so keeping process authority native-side
    // prevents injected renderer JS from turning pty_start into an arbitrary
    // process launcher. The terminal still opens the platform default shell.
    let command = default_shell();
    let args = default_shell_args();
    info!("pty_start[{}]: spawning {} {:?}", thread_id, command, args);
    #[cfg(target_os = "windows")]
    let (mut cmd, process_job, launch_gate) = {
        let process_job = crate::windows_process_job::ProcessJob::new()
            .map_err(|error| format!("could not create PTY process job: {error}"))?;
        let launch_gate = crate::windows_process_job::ProcessLaunchGate::new()
            .map_err(|error| format!("could not create PTY launch gate: {error}"))?;
        let launcher = launch_gate
            .launcher(&command, &args)
            .map_err(|error| format!("could not prepare PTY launch gate: {error}"))?;
        (
            CommandBuilder::from_argv(launcher.into_argv()),
            process_job,
            launch_gate,
        )
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = CommandBuilder::new(&command);
    #[cfg(not(target_os = "windows"))]
    cmd.args(&args);
    if let Some(root) = validated_cwd(options.project_root.as_deref())? {
        info!("pty_start[{}]: cwd={}", thread_id, root);
        cmd.cwd(&root);
    }
    // Sensible defaults so xterm.js renders unicode + truecolor; when launched
    // from Finder, launchd hands us a stripped PATH so we backfill with the
    // common locations needed for git, gh, node, brew tools, etc.
    cmd.env("PATH", augmented_path());
    cmd.env("COVENCAVE", "1");
    // TERM/COLORTERM/LANG are Unix-only; skip on Windows to avoid confusing
    // cmd.exe / PowerShell which don't interpret these variables.
    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "en_US.UTF-8");
        }
        if std::env::var("LC_ALL").is_err() {
            cmd.env("LC_ALL", "en_US.UTF-8");
        }
    }
    // Drop nesting-tripwires inherited from the Tauri parent.
    cmd.env_remove("TMUX");
    cmd.env_remove("npm_config_prefix");
    cmd.env_remove("NPM_CONFIG_PREFIX");
    cmd.env_remove("PREFIX");

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => {
            info!("pty_start[{}]: child spawned, pid={:?}", thread_id, c.process_id());
            c
        }
        Err(e) => {
            warn!("pty_start[{}]: spawn failed: {}", thread_id, e);
            return Err(e.to_string());
        }
    };
    #[cfg(target_os = "windows")]
    {
        let pid = match child.process_id() {
            Some(pid) => pid,
            None => {
                let _ = child.kill();
                return Err("PTY child did not expose a process id".to_string());
            }
        };
        if let Err(error) = process_job.assign_pid(pid) {
            let _ = child.kill();
            return Err(format!("could not assign PTY to process job: {error}"));
        }
        if let Err(error) = launch_gate.release() {
            let _ = process_job.terminate();
            let _ = child.kill();
            return Err(format!("could not release PTY launch gate: {error}"));
        }
    }
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let scrollback = Arc::new(Mutex::new(Vec::new()));
    {
        let mut guard = SESSIONS.lock();
        guard.insert(
            thread_id.clone(),
            PtySession {
                #[cfg(target_os = "windows")]
                process_job,
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                scrollback: scrollback.clone(),
            },
        );
    }
    // PTY committed to SESSIONS; pending guard can release without rolling back.
    drop(pending);

    // Reader thread — forwards bytes to the webview as pty:data events.
    let tid_read = thread_id.clone();
    let app_read = app.clone();
    let ring = scrollback;
    thread::spawn(move || {
        info!("pty_start[{}]: reader thread started", tid_read);
        let mut buf = [0u8; 8192];
        let mut total = 0usize;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    info!("pty_start[{}]: reader EOF after {} bytes", tid_read, total);
                    break;
                }
                Err(e) => {
                    warn!("pty_start[{}]: reader error after {} bytes: {}", tid_read, total, e);
                    break;
                }
                Ok(n) => {
                    total = total.saturating_add(n);
                    {
                        let mut buffer = ring.lock();
                        buffer.extend_from_slice(&buf[..n]);
                        let len = buffer.len();
                        if len > SCROLLBACK_LIMIT_BYTES {
                            buffer.drain(0..len - SCROLLBACK_LIMIT_BYTES);
                        }
                    }
                    debug!("pty_start[{}]: emit pty:data {} bytes (total {})", tid_read, n, total);
                    let _ = app_read.emit(
                        "pty:data",
                        PtyDataEvent {
                            thread_id: tid_read.clone(),
                            bytes: buf[..n].to_vec(),
                        },
                    );
                }
            }
        }
    });

    // Waiter thread — emits pty:exit when the child terminates and removes
    // the session from the registry.
    let tid_wait = thread_id;
    let app_wait = app;
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.exit_code().try_into().ok());
        warn!("pty_start[{}]: child exited code={:?}", tid_wait, code);
        SESSIONS.lock().remove(&tid_wait);
        let _ = app_wait.emit(
            "pty:exit",
            PtyExitEvent {
                thread_id: tid_wait.clone(),
                code,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(webview: Webview, thread_id: String, bytes: Vec<u8>) -> Result<(), String> {
    ensure_trusted_pty_caller(&webview)?;
    debug!("pty_write[{}]: {} bytes", thread_id, bytes.len());
    let writer = {
        let sessions = SESSIONS.lock();
        sessions
            .get(&thread_id)
            .map(|s| s.writer.clone())
            .ok_or_else(|| {
                warn!("pty_write[{}]: session not found", thread_id);
                format!("pty '{}' not found", thread_id)
            })?
    };
    let mut w = writer.lock();
    w.write_all(&bytes).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(webview: Webview, thread_id: String, cols: u16, rows: u16) -> Result<(), String> {
    ensure_trusted_pty_caller(&webview)?;
    let sessions = SESSIONS.lock();
    let session = sessions
        .get(&thread_id)
        .ok_or_else(|| format!("pty '{}' not found", thread_id))?;
    session
        .master
        .resize(pty_size(cols, rows))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_stop(webview: Webview, thread_id: String) -> Result<(), String> {
    ensure_trusted_pty_caller(&webview)?;
    // Dropping the PtySession drops the master, which closes the slave's
    // controlling tty; the child receives SIGHUP and exits. The waiter
    // thread cleans up SESSIONS and emits pty:exit.
    let session = SESSIONS.lock().remove(&thread_id);
    #[cfg(target_os = "windows")]
    if let Some(session) = session {
        let _ = session.process_job.terminate();
        // Keep ClosePseudoConsole off the IPC/UI dispatcher even after clients
        // have been killed. This is bounded from the caller's perspective.
        thread::spawn(move || drop(session));
    }
    #[cfg(not(target_os = "windows"))]
    drop(session);
    Ok(())
}

#[tauri::command]
pub fn pty_list(webview: Webview) -> Result<Vec<String>, String> {
    ensure_trusted_pty_caller(&webview)?;
    Ok(SESSIONS.lock().keys().cloned().collect())
}

/// Recent output for a running session, replayed by a terminal view that
/// reattaches after a remount. Empty when the session is unknown.
#[tauri::command]
pub fn pty_snapshot(webview: Webview, thread_id: String) -> Result<Vec<u8>, String> {
    ensure_trusted_pty_caller(&webview)?;
    let sessions = SESSIONS.lock();
    Ok(sessions
        .get(&thread_id)
        .map(|session| session.scrollback.lock().clone())
        .unwrap_or_default())
}

/// Diagnostic: spawn a one-shot known-good PTY (`/bin/echo hello && exit`),
/// read all output synchronously, and return what came back. Lets us prove
/// the PTY plumbing works end-to-end without depending on the React layer
/// or on any user shell config.
#[tauri::command]
pub fn pty_diagnose(webview: Webview) -> Result<DiagnoseReport, String> {
    ensure_trusted_pty_caller(&webview)?;
    run_pty_diagnose()
}

fn run_pty_diagnose() -> Result<DiagnoseReport, String> {
    info!("pty_diagnose: starting");
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;

    #[cfg(target_os = "windows")]
    let (mut cmd, process_job, launch_gate) = {
        let process_job = crate::windows_process_job::ProcessJob::new()
            .map_err(|error| format!("create diagnostic process job: {error}"))?;
        let launch_gate = crate::windows_process_job::ProcessLaunchGate::new()
            .map_err(|error| format!("create diagnostic launch gate: {error}"))?;
        let launcher = launch_gate
            .launcher("cmd.exe", ["/C", "echo coven-cave-pty-ok"])
            .map_err(|error| format!("prepare diagnostic launch gate: {error}"))?;
        (
            CommandBuilder::from_argv(launcher.into_argv()),
            process_job,
            launch_gate,
        )
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = CommandBuilder::new("/bin/sh");
        c.args(["-c", "echo coven-cave-pty-ok"]);
        c
    };
    cmd.env("PATH", augmented_path());
    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {e}"))?;
    #[cfg(target_os = "windows")]
    {
        let pid = match child.process_id() {
            Some(pid) => pid,
            None => {
                let _ = child.kill();
                return Err("diagnostic child did not expose a process id".to_string());
            }
        };
        if let Err(error) = process_job.assign_pid(pid) {
            let _ = child.kill();
            return Err(format!("assign diagnostic process job: {error}"));
        }
        if let Err(error) = launch_gate.release() {
            let _ = process_job.terminate();
            let _ = child.kill();
            return Err(format!("release diagnostic launch gate: {error}"));
        }
    }
    let pid = child.process_id();
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
    drop(pair.master);
    drop(pair.slave);

    let mut buf = Vec::with_capacity(256);
    let _ = reader.read_to_end(&mut buf);
    let exit = child.wait().ok().and_then(|s| s.exit_code().try_into().ok());

    let output = String::from_utf8_lossy(&buf).to_string();
    info!("pty_diagnose: pid={:?} exit={:?} bytes={} output={:?}",
        pid, exit, buf.len(), output);
    Ok(DiagnoseReport { pid, exit, bytes: buf.len(), output })
}

#[derive(Debug, Serialize)]
pub struct DiagnoseReport {
    pub pid: Option<u32>,
    pub exit: Option<i32>,
    pub bytes: usize,
    pub output: String,
}

/// Validate and normalize the optional working directory supplied by the UI.
///
/// The renderer may choose which known project root a terminal opens in, but it
/// must not be able to smuggle command-line authority through cwd edge cases.
/// Invalid or non-directory values are rejected before process spawn.
fn validated_cwd(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };

    let normalized = normalize_cwd(raw);
    let path = std::path::Path::new(&normalized);
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("invalid project_root '{}': {}", normalized, e))?;
    if !metadata.is_dir() {
        return Err(format!("invalid project_root '{}': not a directory", normalized));
    }

    Ok(Some(normalized))
}

/// Normalize a working directory path so portable-pty / Node's lstat
/// doesn't trip on edge cases.
///
/// - Windows bare drive letter "C:" → "C:\" (lstat("C:") returns EISDIR)
/// - Windows drive letter with forward slashes "C:/foo" → "C:\foo"
/// - Everything else: returned as-is.
fn normalize_cwd(raw: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        // "C:" or "c:" with nothing after → append backslash
        if raw.len() == 2 && raw.as_bytes()[1] == b':' {
            return format!("{}\\" , raw);
        }
        // Replace forward slashes with backslashes on Windows
        return raw.replace('/', "\\");
    }
    #[cfg(not(target_os = "windows"))]
    raw.to_string()
}

fn pty_size_from_options(options: &StartOptions) -> PtySize {
    pty_size(
        options.cols.unwrap_or(DEFAULT_PTY_COLS),
        options.rows.unwrap_or(DEFAULT_PTY_ROWS),
    )
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: if rows == 0 { DEFAULT_PTY_ROWS } else { rows },
        cols: if cols == 0 { DEFAULT_PTY_COLS } else { cols },
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Default shell for the current platform.
fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // Prefer PowerShell when available; fall back to cmd.exe.
        let ps_paths = [
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ];
        for p in ps_paths.iter() {
            if std::path::Path::new(p).exists() {
                return p.to_string();
            }
        }
        "cmd.exe".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        "/bin/zsh".to_string()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Default args for the default shell.
fn default_shell_args() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        // PowerShell: -NoLogo for clean startup; cmd.exe takes no login flag.
        let shell = default_shell();
        if shell.ends_with("pwsh.exe") || shell.ends_with("powershell.exe") {
            return vec!["-NoLogo".to_string()];
        }
        vec![]
    }
    #[cfg(not(target_os = "windows"))]
    vec!["-l".to_string()]
}

fn augmented_path() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        // On Windows, augment with common tool locations not always on PATH.
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
        let extras = [
            format!("{}\\nodejs", pf),
            format!("{}\\Git\\cmd", pf),
            format!("{}\\Git\\bin", pf),
            format!("{}\\PowerShell\\7", pf),
            format!("{}\\.cargo\\bin", home),
            format!("{}\\.volta\\bin", home),
            format!("{}\\.bun\\bin", home),
        ];
        let sep = ';';
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut out = String::new();
        for part in inherited.split(sep).chain(extras.iter().map(|s| s.as_str())) {
            if part.is_empty() || !seen.insert(part.to_string()) { continue; }
            if !out.is_empty() { out.push(sep); }
            out.push_str(part);
        }
        return out;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let extras = [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ];
        let mut seen: HashSet<&str> = HashSet::new();
        let mut out = String::new();
        for part in inherited.split(':').chain(extras.iter().copied()) {
            if part.is_empty() || !seen.insert(part) { continue; }
            if !out.is_empty() { out.push(':'); }
            out.push_str(part);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_options_rejects_renderer_supplied_process_authority() {
        let payload = r#"{
            "thread_id": "cave.comux.test",
            "command": "/bin/sh",
            "args": ["-c", "echo owned"],
            "env": { "PATH": "/tmp" }
        }"#;

        let err = serde_json::from_str::<StartOptions>(payload)
            .expect_err("process authority fields must not deserialize");
        assert!(
            err.to_string().contains("unknown field"),
            "unexpected serde error: {err}"
        );
    }

    #[test]
    fn start_options_accepts_terminal_shape() {
        let payload = r#"{
            "thread_id": "cave.comux.test",
            "project_root": null,
            "cols": 120,
            "rows": 40
        }"#;

        let options = serde_json::from_str::<StartOptions>(payload)
            .expect("terminal pty_start options should deserialize");
        assert_eq!(options.thread_id, "cave.comux.test");
        assert_eq!(options.cols, Some(120));
        assert_eq!(options.rows, Some(40));
    }

    #[test]
    fn pty_size_from_options_rejects_zero_sized_terminal_startup() {
        let options = StartOptions {
            thread_id: "cave.comux.test".to_string(),
            project_root: None,
            cols: Some(0),
            rows: Some(0),
        };

        let size = pty_size_from_options(&options);
        assert_eq!(size.cols, 120);
        assert_eq!(size.rows, 40);
        assert_eq!(size.pixel_width, 0);
        assert_eq!(size.pixel_height, 0);
    }

    #[test]
    fn validated_cwd_rejects_non_directories() {
        let file = std::env::temp_dir().join(format!(
            "coven-cave-pty-test-{}",
            std::process::id()
        ));
        std::fs::write(&file, b"not a directory").expect("write temp file");

        let err = validated_cwd(file.to_str()).expect_err("files are not valid cwd roots");
        assert!(err.contains("not a directory"), "unexpected error: {err}");

        let _ = std::fs::remove_file(file);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn pty_diagnose_spawns_shell_and_reads_output() {
        let report = run_pty_diagnose().expect("pty diagnostic should run");

        assert!(
            report.output.contains("coven-cave-pty-ok"),
            "expected diagnostic marker in PTY output, got {:?}",
            report.output,
        );
        assert!(report.bytes > 0, "diagnostic PTY should produce output bytes");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn pty_diagnostic_uses_the_private_gated_launcher() {
        let gate = crate::windows_process_job::ProcessLaunchGate::new()
            .expect("create diagnostic launch gate");
        let argv = gate
            .launcher("cmd.exe", ["/C", "echo coven-cave-pty-ok"])
            .expect("build diagnostic launcher")
            .into_argv();

        assert_eq!(
            argv[0],
            std::env::current_exe().expect("current executable")
        );
        assert_eq!(argv[1], "--coven-cave-internal-gated-child-v1");
        assert_eq!(argv[5], "cmd.exe");
        assert_eq!(argv[6], "/C");
        assert_eq!(argv[7], "echo coven-cave-pty-ok");
    }
}
