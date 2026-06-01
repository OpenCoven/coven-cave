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
use tauri::{AppHandle, Emitter};

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static STARTING_SESSIONS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

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
pub struct StartOptions {
    pub thread_id: String,
    pub project_root: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub env: Option<HashMap<String, String>>,
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
pub fn pty_start(app: AppHandle, options: StartOptions) -> Result<(), String> {
    let thread_id = options.thread_id.clone();
    let pending = PendingPtyStart::reserve(&thread_id)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: options.rows.unwrap_or(40),
            cols: options.cols.unwrap_or(120),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let command = options.command.unwrap_or_else(|| "/bin/zsh".to_string());
    let args = options.args.unwrap_or_else(|| vec!["-l".to_string()]);
    let mut cmd = CommandBuilder::new(command);
    cmd.args(args);
    if let Some(root) = &options.project_root {
        cmd.cwd(root);
    }
    // Sensible defaults so xterm.js renders unicode + truecolor; when launched
    // from Finder, launchd hands us a stripped PATH so we backfill with the
    // common locations needed for git, gh, node, brew tools, etc.
    cmd.env("PATH", augmented_path());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("COVENCAVE", "1");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if std::env::var("LC_ALL").is_err() {
        cmd.env("LC_ALL", "en_US.UTF-8");
    }
    if let Some(extra) = options.env {
        for (k, v) in extra {
            if v.is_empty() {
                cmd.env_remove(&k);
            } else {
                cmd.env(k, v);
            }
        }
    }
    // Drop nesting-tripwires inherited from the Tauri parent.
    cmd.env_remove("TMUX");
    cmd.env_remove("npm_config_prefix");
    cmd.env_remove("NPM_CONFIG_PREFIX");
    cmd.env_remove("PREFIX");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut guard = SESSIONS.lock();
        guard.insert(
            thread_id.clone(),
            PtySession {
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
            },
        );
    }
    // PTY committed to SESSIONS; pending guard can release without rolling back.
    drop(pending);

    // Reader thread — forwards bytes to the webview as pty:data events.
    let tid_read = thread_id.clone();
    let app_read = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
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
pub fn pty_write(thread_id: String, bytes: Vec<u8>) -> Result<(), String> {
    let writer = {
        let sessions = SESSIONS.lock();
        sessions
            .get(&thread_id)
            .map(|s| s.writer.clone())
            .ok_or_else(|| format!("pty '{}' not found", thread_id))?
    };
    let mut w = writer.lock();
    w.write_all(&bytes).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(thread_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS.lock();
    let session = sessions
        .get(&thread_id)
        .ok_or_else(|| format!("pty '{}' not found", thread_id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_stop(thread_id: String) {
    // Dropping the PtySession drops the master, which closes the slave's
    // controlling tty; the child receives SIGHUP and exits. The waiter
    // thread cleans up SESSIONS and emits pty:exit.
    let mut sessions = SESSIONS.lock();
    sessions.remove(&thread_id);
}

#[tauri::command]
pub fn pty_list() -> Vec<String> {
    SESSIONS.lock().keys().cloned().collect()
}

fn augmented_path() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
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
        if part.is_empty() || !seen.insert(part) {
            continue;
        }
        if !out.is_empty() {
            out.push(':');
        }
        out.push_str(part);
    }
    out
}
