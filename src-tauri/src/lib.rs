// Desktop-only imports — pulled in conditionally so the mobile build
// doesn't reach for std::process::Child, std::net::TcpListener, or the
// Tauri tray/menu/webview-builder APIs that aren't available on iOS or
// Android. Mobile binaries are thin shells: webview only, no sidecar.
#[cfg(desktop)]
use rand::{rngs::OsRng, RngCore};
#[cfg(all(desktop, target_os = "windows"))]
use serde::Serialize;
#[cfg(desktop)]
use std::net::TcpListener;
#[cfg(all(desktop, target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "windows"))]
use std::process::Command;
#[cfg(desktop)]
use std::process::{Child, Stdio};
#[cfg(all(desktop, target_os = "windows"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::{Arc, Mutex};
#[cfg(desktop)]
use std::thread;
#[cfg(desktop)]
use std::time::{Duration, Instant};
#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(all(desktop, target_os = "windows"))]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, WAIT_OBJECT_0, WPARAM},
    System::Threading::{
        CreateEventW, GetCurrentProcess, SetEvent, TerminateProcess, WaitForSingleObject, INFINITE,
    },
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{SC_CLOSE, WM_CLOSE, WM_NCDESTROY, WM_SYSCOMMAND},
    },
};
#[cfg(desktop)]
const QUICK_CHAT_WINDOW_LABEL: &str = "quick-chat";
#[cfg(desktop)]
const QUICK_CHAT_WIDTH: f64 = 390.0;
#[cfg(desktop)]
const QUICK_CHAT_HEIGHT: f64 = 520.0;

#[cfg(desktop)]
fn coven_tray_icon() -> Image<'static> {
    // The Coven fox-and-trident mark, pre-rendered from
    // icons/icon-source-1024.png as 36×36 (18pt @2x) white+alpha raw RGBA —
    // regenerate with scripts/generate-tray-icon.py. macOS renders it as a
    // template image (alpha only, adapts to menu-bar appearance); the white
    // fill keeps dark Windows/Linux trays legible. Raw RGBA avoids pulling
    // tauri's `image-png` decoder feature for a single build-time asset.
    const SIZE: u32 = 36;
    const RGBA: &[u8] = include_bytes!("../icons/tray-icon-36.rgba");
    Image::new(RGBA, SIZE, SIZE)
}

#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
fn quick_chat_position(app: &tauri::AppHandle) -> (f64, f64) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();
        let screen_x = position.x as f64 / scale;
        let screen_y = position.y as f64 / scale;
        let screen_w = size.width as f64 / scale;
        return (
            screen_x + screen_w - QUICK_CHAT_WIDTH - 14.0,
            screen_y + 34.0,
        );
    }
    (24.0, 40.0)
}

#[cfg(desktop)]
fn quick_chat_url_from_main(mut url: Url) -> Option<Url> {
    let trusted_loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
        && url.port().is_some();
    if !trusted_loopback {
        return None;
    }
    url.set_path("/quick-chat");
    Some(url)
}

#[cfg(desktop)]
fn show_quick_chat_from_main(app: &tauri::AppHandle) {
    let Some(url) = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok())
        .and_then(quick_chat_url_from_main)
    else {
        focus_main_window(app);
        return;
    };
    show_quick_chat_window(app, &url);
}

#[cfg(desktop)]
fn show_quick_chat_window(app: &tauri::AppHandle, quick_chat_url: &Url) {
    if let Some(window) = app.get_webview_window(QUICK_CHAT_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // On macOS the window opens transparent with an NSVisualEffectView behind
    // it (applied after build), and `?glass=1` tells the page to drop its
    // opaque background — the glassmorphic quick chat. Other platforms keep
    // the opaque window and never receive the flag, so the page stays solid.
    #[cfg(target_os = "macos")]
    let quick_chat_url = {
        let mut glass_url = quick_chat_url.clone();
        glass_url.query_pairs_mut().append_pair("glass", "1");
        glass_url
    };

    let (x, y) = quick_chat_position(app);
    let builder = WebviewWindowBuilder::new(
        app,
        QUICK_CHAT_WINDOW_LABEL,
        WebviewUrl::External(quick_chat_url.clone()),
    )
    .title("CovenCave Quick Chat")
    .inner_size(QUICK_CHAT_WIDTH, QUICK_CHAT_HEIGHT)
    .min_inner_size(340.0, 420.0)
    // Resizable since the window holds multiple chats now — the min size
    // keeps a single tab's composer + thread usable.
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(x, y)
    .shadow(true)
    .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    let builder = builder.transparent(true);

    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                // 14.0 matches .tray-quick-chat__frame's border-radius so the
                // vibrancy layer and the DOM frame round together.
                if let Err(e) =
                    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(14.0))
                {
                    log::warn!("[cave] quick chat vibrancy unavailable: {}", e);
                }
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(e) => log::warn!("[cave] failed to open quick chat window: {}", e),
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    if let Some(message) = payload.downcast_ref::<&str>() {
        return message.to_string();
    }
    "unknown panic".to_string()
}

#[cfg(all(desktop, target_os = "linux"))]
fn log_linux_tray_unavailable(reason: &str) {
    let guidance = "CovenCave will continue without tray shortcuts. For tray support, install a compatible AppIndicator runtime, for example `libayatana-appindicator3-1` on Ubuntu/Debian or `libappindicator-gtk3` on Arch.";
    log::warn!("[cave] Linux tray disabled: {}. {}", reason, guidance);
    eprintln!(
        "[cave] Linux tray disabled: {}\n[cave] {}",
        reason, guidance
    );
}

/// Surface a fatal startup error to the user. Platform-specific: macOS uses
/// osascript (Cocoa alert), Windows writes to a temp file and opens Notepad,
/// Linux tries zenity/kdialog. Best-effort; ignored on failure.
#[cfg(desktop)]
fn show_fatal_dialog(msg: &str) {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display alert \"CovenCave failed to start\" message \"{}\" as critical",
            msg.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let _ = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        // Write error to a temp file and open it in Notepad — reliable and
        // doesn't require any additional dependencies (e.g. winapi crate).
        let temp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".into());
        let path = format!("{}\\CovenCave-error.txt", temp);
        let _ = std::fs::write(&path, msg);
        let _ = std::process::Command::new("notepad.exe").arg(&path).spawn();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Try zenity (GNOME) then kdialog (KDE); fall back to stderr only.
        let shown = std::process::Command::new("zenity")
            .args(["--error", "--text", msg])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !shown {
            let _ = std::process::Command::new("kdialog")
                .args(["--error", msg])
                .output();
        }
    }
}

/// Show the dialog and exit the process cleanly. Returning Err from setup()
/// instead causes Tauri to panic inside the macOS NSApplicationDelegate's
/// didFinishLaunching callback, which can't unwind across the Objective-C FFI
/// boundary and aborts with SIGABRT. process::exit() avoids that path.
#[cfg(desktop)]
fn fatal_exit(msg: &str) -> ! {
    eprintln!("[cave] FATAL: {}", msg);
    show_fatal_dialog(msg);
    std::process::exit(1);
}

/// macOS AppTranslocation: if the user launches the app from the DMG or
/// downloads folder without first dragging it to /Applications, Gatekeeper
/// runs it from a randomized read-only path under
/// `/private/var/folders/.../AppTranslocation/`. Bundled resources still work
/// but anything that needs writable state (or that the user expects to be
/// "installed") breaks. Surface a clear "Move to Applications" prompt instead
/// of silently running translocated.
///
/// On non-macOS platforms this is a no-op.
#[cfg(desktop)]
fn check_app_translocation() {
    #[cfg(target_os = "macos")]
    {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let path = exe.to_string_lossy().to_string();
        if !path.contains("/AppTranslocation/") && !path.contains("/Volumes/") {
            return;
        }
        let msg = format!(
            "CovenCave is running from a read-only quarantine path:\n\n{}\n\nTo install properly, quit, then drag CovenCave.app into your /Applications folder and launch it from there.",
            path
        );
        show_fatal_dialog(&msg);
        std::process::exit(1);
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node.exe")
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node")
}

/// Find a usable `node` binary. Release builds include a Node runtime under
/// bundled resources so clean user machines can boot the sidecar. Development
/// builds can still fall back to common local Node installs.
#[cfg(desktop)]
fn find_node(resource_dir: &Path) -> Option<PathBuf> {
    let bundled = bundled_node_path(resource_dir);
    if bundled.exists() {
        return Some(bundled);
    }

    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();

        // nvm-windows stores versions under %APPDATA%\nvm\v<version>\node.exe
        let nvm_root = PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("nvm");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort(); // lexicographic; good enough for v20 < v24, etc.
            if let Some(latest) = versions.into_iter().next_back() {
                let node = latest.join("node.exe");
                if node.exists() {
                    return Some(node);
                }
            }
        }

        // Standard / tool-manager install locations
        let candidates = [
            PathBuf::from(
                std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into()),
            )
            .join("nodejs")
            .join("node.exe"),
            PathBuf::from(
                std::env::var("ProgramFiles(x86)")
                    .unwrap_or_else(|_| "C:\\Program Files (x86)".into()),
            )
            .join("nodejs")
            .join("node.exe"),
            PathBuf::from(format!("{}\\.volta\\bin\\node.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\node.exe", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }

        // Last ditch: where.exe (Windows equivalent of `which`)
        if let Ok(out) = std::process::Command::new("where.exe").arg("node").output() {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(&path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }

        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;

        // Prefer nvm — its installs are the most common dev managed-version
        // layout and it tends to lag a step behind the bleeding edge that
        // Homebrew ships, which avoids native-module ABI mismatches with
        // whatever the developer used to build CovenCave's bundled
        // node_modules.
        let nvm_root = PathBuf::from(format!("{}/.nvm/versions/node", home));
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.into_iter().next_back() {
                let node = latest.join("bin").join("node");
                if node.exists() {
                    return Some(node);
                }
            }
        }

        // Other fixed install locations, in order of likelihood
        let candidates = [
            PathBuf::from(format!("{}/.volta/bin/node", home)),
            PathBuf::from(format!("{}/.local/bin/node", home)),
            PathBuf::from(format!("{}/.bun/bin/node", home)),
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }

        // Last ditch: ask a login shell where node lives
        if let Ok(out) = Command::new("/bin/zsh")
            .args(["-lic", "command -v node"])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }

        None
    }
}

/// Find the `coven` CLI on disk so API routes spawned from the sidecar can
/// reach it. Same GUI-launch PATH problem as `find_node`. Returns the full
/// path to the binary so callers can prepend its parent directory to PATH.
#[cfg(desktop)]
fn find_coven() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let candidates = [
            PathBuf::from(format!("{}\\.volta\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.cargo\\bin\\coven.exe", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }
        if let Ok(out) = std::process::Command::new("where.exe")
            .arg("coven")
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(&path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        let nvm_root = PathBuf::from(format!("{}/.nvm/versions/node", home));
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.into_iter().next_back() {
                let coven = latest.join("bin").join("coven");
                if coven.exists() {
                    return Some(coven);
                }
            }
        }

        let candidates = [
            PathBuf::from(format!("{}/.bun/bin/coven", home)),
            PathBuf::from("/opt/homebrew/bin/coven"),
            PathBuf::from("/usr/local/bin/coven"),
            PathBuf::from(format!("{}/.local/bin/coven", home)),
            // ~/.cargo/bin often holds an older Rust-installed Coven CLI.
            PathBuf::from(format!("{}/.cargo/bin/coven", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }
        if let Ok(out) = Command::new("/bin/zsh")
            .args(["-lic", "command -v coven"])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }
        None
    }
}

#[cfg(desktop)]
fn sidecar_auth_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(desktop)]
const MOBILE_ACCESS_TOKEN_FILE: &str = "mobile-access-token";

#[cfg(desktop)]
fn is_valid_persisted_token(token: &str) -> bool {
    token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit())
}

/// The mobile access secret must survive desktop restarts: phones sign their
/// tokens against it, so minting a fresh one per launch would force every
/// paired phone back through QR pairing after any restart. Load-or-create it
/// from disk; the per-launch webview token (`COVEN_CAVE_AUTH_TOKEN`) stays
/// ephemeral because the desktop webview receives a fresh URL each launch.
#[cfg(desktop)]
fn load_or_create_mobile_access_token(secret_path: &Path) -> String {
    match std::fs::read_to_string(secret_path) {
        Ok(existing) => {
            let trimmed = existing.trim();
            if is_valid_persisted_token(trimmed) {
                return trimmed.to_string();
            }
            log::warn!(
                "[cave] persisted mobile access token at {} is malformed - regenerating (paired phones will need to re-pair)",
                secret_path.display()
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            log::warn!(
                "[cave] could not read mobile access token at {}: {error}",
                secret_path.display()
            );
        }
    }

    let token = sidecar_auth_token();
    if let Some(parent) = secret_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!(
                "[cave] could not create {} ({error}) - mobile access token will not persist across launches",
                parent.display()
            );
            return token;
        }
    }
    if let Err(error) = write_secret_file(secret_path, &token) {
        log::warn!(
            "[cave] could not persist mobile access token to {} ({error}) - paired phones will need to re-pair after restart",
            secret_path.display()
        );
    }
    token
}

#[cfg(desktop)]
fn write_secret_file(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())
}

#[cfg(desktop)]
fn mobile_access_token_for_app(app: &tauri::AppHandle) -> String {
    match app.path().app_data_dir() {
        Ok(dir) => load_or_create_mobile_access_token(&dir.join(MOBILE_ACCESS_TOKEN_FILE)),
        Err(error) => {
            log::warn!(
                "[cave] could not resolve app data dir ({error}) - mobile access token will not persist across launches"
            );
            sidecar_auth_token()
        }
    }
}

#[cfg(desktop)]
struct SidecarProcess {
    child: Child,
    #[cfg(target_os = "windows")]
    job: windows_process_job::ProcessJob,
}

#[cfg(desktop)]
impl SidecarProcess {
    #[cfg(target_os = "windows")]
    fn from_gated(child: Child, job: windows_process_job::ProcessJob) -> Self {
        Self { child, job }
    }

    #[cfg(not(target_os = "windows"))]
    fn new(child: Child) -> Self {
        Self { child }
    }
}

#[cfg(desktop)]
struct SidecarState(Arc<Mutex<Option<SidecarProcess>>>);

#[cfg(desktop)]
#[derive(Clone, Copy)]
enum SidecarStartupStep {
    PreparingRuntime,
    StartingService,
    WaitingForService,
}

#[cfg(desktop)]
enum SidecarStartError {
    Cancelled,
    Failed(String),
}

#[cfg(desktop)]
enum PortWaitResult {
    Ready,
    Cancelled,
    TimedOut,
}

#[cfg(all(desktop, target_os = "windows"))]
const SIDECAR_STARTUP_EVENT: &str = "sidecar-startup-progress";

#[cfg(all(desktop, target_os = "windows"))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStartupStatus {
    phase: &'static str,
    progress: u8,
    message: String,
    can_retry: bool,
    can_cancel: bool,
}

#[cfg(all(desktop, target_os = "windows"))]
impl SidecarStartupStatus {
    fn preparing() -> Self {
        Self {
            phase: "preparing",
            progress: 10,
            message: "Verifying and preparing the application runtime".to_string(),
            can_retry: false,
            can_cancel: false,
        }
    }

    fn starting() -> Self {
        Self {
            phase: "starting",
            progress: 70,
            message: "Starting local services".to_string(),
            can_retry: false,
            can_cancel: true,
        }
    }

    fn waiting() -> Self {
        Self {
            phase: "waiting",
            progress: 85,
            message: "Waiting for CovenCave to become ready".to_string(),
            can_retry: false,
            can_cancel: true,
        }
    }

    fn ready() -> Self {
        Self {
            phase: "ready",
            progress: 100,
            message: "CovenCave is ready".to_string(),
            can_retry: false,
            can_cancel: false,
        }
    }

    fn failed(message: String) -> Self {
        Self {
            phase: "failed",
            progress: 0,
            message,
            can_retry: true,
            can_cancel: false,
        }
    }

    fn cancelled() -> Self {
        Self {
            phase: "cancelled",
            progress: 0,
            message: "Startup was cancelled. The prepared runtime is safe to reuse.".to_string(),
            can_retry: true,
            can_cancel: false,
        }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
struct SidecarStartupControl {
    status: Mutex<SidecarStartupStatus>,
    running: AtomicBool,
    cancel_requested: AtomicBool,
    shutdown_requested: AtomicBool,
}

#[cfg(all(desktop, target_os = "windows"))]
impl SidecarStartupControl {
    fn new() -> Self {
        Self {
            status: Mutex::new(SidecarStartupStatus::preparing()),
            running: AtomicBool::new(false),
            cancel_requested: AtomicBool::new(false),
            shutdown_requested: AtomicBool::new(false),
        }
    }

    fn begin(&self) -> Result<(), String> {
        if self.shutdown_requested.load(Ordering::Acquire) {
            return Err("application shutdown is in progress".to_string());
        }
        self.running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "sidecar startup is already running".to_string())?;
        self.cancel_requested.store(false, Ordering::Release);
        Ok(())
    }

    fn finish(&self) {
        self.running.store(false, Ordering::Release);
    }

    fn request_cancel(&self) -> Result<(), String> {
        if !self.running.load(Ordering::Acquire) {
            return Err("sidecar startup is not running".to_string());
        }
        self.cancel_requested.store(true, Ordering::Release);
        Ok(())
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::Acquire)
            || self.shutdown_requested.load(Ordering::Acquire)
    }

    fn request_shutdown(&self) {
        self.shutdown_requested.store(true, Ordering::Release);
        self.cancel_requested.store(true, Ordering::Release);
    }

    fn status(&self) -> Result<SidecarStartupStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "sidecar startup status lock is poisoned".to_string())
    }

    fn set_status(&self, status: SidecarStartupStatus) -> Result<(), String> {
        let mut current = self
            .status
            .lock()
            .map_err(|_| "sidecar startup status lock is poisoned".to_string())?;
        *current = status;
        Ok(())
    }
}

#[cfg(desktop)]
struct SidecarCleanupGuard(Arc<Mutex<Option<SidecarProcess>>>);

#[cfg(desktop)]
impl tauri::Resource for SidecarCleanupGuard {}

#[cfg(desktop)]
impl Drop for SidecarCleanupGuard {
    fn drop(&mut self) {
        let state = SidecarState(Arc::clone(&self.0));
        if let Err(error) = state.stop() {
            log::warn!("[cave] could not stop sidecar during application cleanup: {error}");
        }
    }
}

#[cfg(desktop)]
impl SidecarState {
    fn stop(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let mut guard = match self.0.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                // Never stall the Windows UI/exit path on a startup worker.
                // Any locally-held Job Object is closed by process exit.
                return Err("sidecar state is busy; process-job cleanup remains armed".to_string());
            }
        };
        #[cfg(not(target_os = "windows"))]
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "sidecar process lock is poisoned".to_string())?;
        let Some(child) = guard.take() else {
            return Ok(());
        };
        drop(guard);
        stop_sidecar_child(child)
    }
}

#[cfg(desktop)]
fn stop_sidecar_child(mut process: SidecarProcess) -> Result<(), String> {
    if process
        .child
        .try_wait()
        .map_err(|error| format!("could not inspect sidecar process: {error}"))?
        .is_some()
    {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // TerminateJobObject is a bounded kernel operation over the full tree;
        // it does not wait for Node, Coven, pipes, JavaScript, or taskkill.exe.
        // Dropping the KILL_ON_JOB_CLOSE handle is a second fail-safe and also
        // covers Task Manager/TerminateProcess, where Rust cleanup never runs.
        process
            .job
            .terminate()
            .map_err(|error| format!("could not terminate sidecar process job: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if process
            .child
            .try_wait()
            .map_err(|error| format!("could not inspect terminated sidecar: {error}"))?
            .is_none()
        {
            process
                .child
                .kill()
                .map_err(|error| format!("could not stop sidecar process: {error}"))?;
        }
        process
            .child
            .wait()
            .map_err(|error| format!("could not wait for sidecar process shutdown: {error}"))?;
        Ok(())
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn shutdown_owned_processes(app: &tauri::AppHandle) {
    if let Some(control) = app.try_state::<Arc<SidecarStartupControl>>() {
        control.request_shutdown();
    }
    if let Some(sidecar) = app.try_state::<SidecarState>() {
        if let Err(error) = sidecar.stop() {
            log::warn!("[cave] sidecar shutdown deferred to process job: {error}");
        }
    }
    pty::terminate_all_owned_processes();
}

// This hook sits below Tao/Tauri's event dispatch. WRY waits for WebView2
// environment/controller creation inside a nested Windows message pump. A
// WM_CLOSE received there is otherwise buffered by Tao until the active event
// callback returns; if WebView2 never completes, Tauri's CloseRequested handler
// can never run. The hook only signals a process-lifetime kernel event. Two
// waiters are pre-spawned during setup: one performs bounded owned-process
// cleanup and requests a normal Tauri exit; the other terminates this process
// after the deadline if the event loop remains wedged. Kill-on-close Job
// Objects then reap every owned process tree. Quick Chat and every non-Windows
// window keep their existing lifecycle.
#[cfg(all(desktop, target_os = "windows"))]
const WINDOWS_MAIN_CLOSE_SUBCLASS_ID: usize = 0x4341_5645;
#[cfg(all(desktop, target_os = "windows"))]
const WINDOWS_MAIN_CLOSE_EXIT_DEADLINE: Duration = Duration::from_millis(1200);

#[cfg(all(desktop, target_os = "windows"))]
fn signal_windows_main_close(event: HANDLE) -> bool {
    unsafe { SetEvent(event) != 0 }
}

#[cfg(all(desktop, target_os = "windows"))]
fn is_windows_main_close_message(message: u32, wparam: WPARAM) -> bool {
    message == WM_CLOSE || (message == WM_SYSCOMMAND && (wparam & 0xfff0) == SC_CLOSE as usize)
}

#[cfg(all(desktop, target_os = "windows"))]
fn terminate_current_process_now() -> ! {
    unsafe {
        TerminateProcess(GetCurrentProcess(), 0);
    }
    std::process::abort();
}

#[cfg(all(desktop, target_os = "windows"))]
fn run_windows_main_close_hard_deadline(event: HANDLE) -> ! {
    let wait = unsafe { WaitForSingleObject(event, INFINITE) };
    if wait != WAIT_OBJECT_0 {
        std::process::abort();
    }
    thread::sleep(WINDOWS_MAIN_CLOSE_EXIT_DEADLINE);
    terminate_current_process_now();
}

#[cfg(all(desktop, target_os = "windows"))]
unsafe extern "system" fn windows_main_close_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    if is_windows_main_close_message(message, wparam) {
        if !signal_windows_main_close(reference_data as HANDLE) {
            terminate_current_process_now();
        }
        // Consume the native close here so neither a JavaScript listener nor a
        // nested WRY message pump can defer it. The pre-spawned cleanup waiter
        // owns graceful app.exit; the hard waiter owns the deadline.
        return 0;
    }

    if message == WM_NCDESTROY {
        // The event is deliberately process-lifetime: the watchdog may still
        // be waiting on it while the HWND is torn down through another path.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(windows_main_close_subclass), subclass_id);
        }
    }

    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(all(desktop, target_os = "windows"))]
fn install_windows_main_close_fallback(app: &tauri::App) -> Result<(), String> {
    let main = app
        .get_window("main")
        .ok_or_else(|| "main window missing while installing close fallback".to_string())?;
    let hwnd = main.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let close_event = unsafe {
        CreateEventW(
            std::ptr::null(),
            1, // manual-reset: repeated SC_CLOSE/WM_CLOSE messages stay once-only
            0,
            std::ptr::null(),
        )
    };
    if close_event.is_null() {
        return Err("could not create authoritative Windows close event".to_string());
    }

    let cleanup_event_bits = close_event as usize;
    let cleanup_app = app.handle().clone();
    let cleanup_waiter = thread::Builder::new()
        .name("cave-close-cleanup".to_string())
        .spawn(move || {
            let event = cleanup_event_bits as HANDLE;
            if unsafe { WaitForSingleObject(event, INFINITE) } == WAIT_OBJECT_0 {
                shutdown_owned_processes(&cleanup_app);
                cleanup_app.exit(0);
            }
        });
    if cleanup_waiter.is_err() {
        unsafe { CloseHandle(close_event) };
        return Err("could not start authoritative Windows close cleanup".to_string());
    }

    let hard_event_bits = close_event as usize;
    let hard_waiter = thread::Builder::new()
        .name("cave-close-hard-deadline".to_string())
        .spawn(move || {
            let event = hard_event_bits as HANDLE;
            run_windows_main_close_hard_deadline(event);
        });
    if hard_waiter.is_err() {
        // A cleanup waiter is already blocked on this process-lifetime event.
        // Wake it before failing setup; it will reap owned jobs and request exit.
        let _ = signal_windows_main_close(close_event);
        return Err("could not start authoritative Windows close hard deadline".to_string());
    }

    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(windows_main_close_subclass),
            WINDOWS_MAIN_CLOSE_SUBCLASS_ID,
            close_event as usize,
        )
    };
    if installed == 0 {
        let _ = signal_windows_main_close(close_event);
        return Err("could not install authoritative Windows close fallback".to_string());
    }
    Ok(())
}

#[cfg(desktop)]
fn find_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

/// Dev builds only: the dev-server URL from tauri.conf.json `build.devUrl`,
/// returned only when something is actually listening on it. Release builds
/// always get `None` so they can never be pointed away from the bundled
/// sidecar.
#[cfg(desktop)]
fn live_dev_server_url(app: &tauri::App) -> Option<tauri::Url> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let url = app.config().build.dev_url.clone()?;
    let host = url.host_str()?.to_string();
    let port = url.port_or_known_default()?;
    let reachable = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port))
        .ok()
        .map(|addrs| {
            addrs.into_iter().any(|addr| {
                std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok()
            })
        })
        .unwrap_or(false);
    if reachable {
        log::info!(
            "[cave] dev server live at {} — using it for the main webview (bundled sidecar skipped)",
            url
        );
        Some(url)
    } else {
        log::warn!(
            "[cave] dev build but {} is not serving — falling back to the bundled sidecar",
            url
        );
        None
    }
}

#[cfg(desktop)]
fn wait_for_port(port: u16, timeout: Duration, should_cancel: impl Fn() -> bool) -> PortWaitResult {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if should_cancel() {
            return PortWaitResult::Cancelled;
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return PortWaitResult::Ready;
        }
        thread::sleep(Duration::from_millis(150));
    }
    PortWaitResult::TimedOut
}

#[cfg(all(desktop, target_os = "windows"))]
fn node_arg_path(path: &Path) -> PathBuf {
    let raw = path.as_os_str().to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", stripped));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn node_arg_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(desktop)]
fn start_sidecar_runtime(
    app: &tauri::AppHandle,
    mut on_step: impl FnMut(SidecarStartupStep),
    should_cancel: impl Fn() -> bool,
) -> Result<Url, SidecarStartError> {
    on_step(SidecarStartupStep::PreparingRuntime);
    let resource_dir = app.path().resource_dir().map_err(|error| {
        SidecarStartError::Failed(format!("could not resolve resource dir: {error}"))
    })?;

    #[cfg(target_os = "windows")]
    let server_dir_root =
        sidecar_archive::prepare_sidecar_runtime(app, &resource_dir).map_err(|error| {
            SidecarStartError::Failed(format!("could not prepare sidecar runtime: {error}"))
        })?;
    #[cfg(not(target_os = "windows"))]
    let server_dir_root = resource_dir.join("resources").join("server");

    if should_cancel() {
        return Err(SidecarStartError::Cancelled);
    }

    let server_mjs = server_dir_root.join("server.mjs");
    let server_js = server_dir_root.join("server.js");
    let server_entry = if server_mjs.exists() {
        server_mjs
    } else if server_js.exists() {
        log::warn!(
            "[cave] bundle has no server.mjs - terminal websocket bridge unavailable in this build"
        );
        server_js
    } else {
        return Err(SidecarStartError::Failed(format!(
            "standalone server not found at {}",
            server_js.display()
        )));
    };

    let port = find_free_port()
        .ok_or_else(|| SidecarStartError::Failed("no free local port available".to_string()))?;
    let auth_token = sidecar_auth_token();
    let mobile_access_token = mobile_access_token_for_app(app);
    log::info!("[cave] starting sidecar on port {port}");

    let node = find_node(&resource_dir).ok_or_else(|| {
        SidecarStartError::Failed(
            "Could not find a `node` binary. Install Node.js from https://nodejs.org and re-launch CovenCave."
                .to_string(),
        )
    })?;
    log::info!("[cave] using node at {}", node.display());

    // Capture sidecar logs so startup failures can be surfaced in the local
    // preparation window instead of leaving a blank webview.
    let log_dir = {
        #[cfg(target_os = "macos")]
        {
            std::env::var("HOME")
                .map(|home| PathBuf::from(home).join("Library/Logs/CovenCave"))
                .unwrap_or_else(|_| std::env::temp_dir())
        }
        #[cfg(target_os = "windows")]
        {
            PathBuf::from(
                std::env::var("APPDATA")
                    .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into()),
            )
            .join("CovenCave")
            .join("logs")
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            std::env::var("HOME")
                .map(|home| PathBuf::from(home).join(".local/share/CovenCave/logs"))
                .unwrap_or_else(|_| std::env::temp_dir())
        }
    };
    if let Err(error) = std::fs::create_dir_all(&log_dir) {
        log::warn!(
            "[cave] could not create sidecar log directory {}: {error}",
            log_dir.display()
        );
    }
    let log_path = log_dir.join("sidecar.log");
    log::info!("[cave] sidecar log -> {}", log_path.display());
    let stdout_log = std::fs::File::create(&log_path).ok();
    let stderr_log = stdout_log.as_ref().and_then(|file| file.try_clone().ok());

    let server_dir = server_entry.parent().ok_or_else(|| {
        SidecarStartError::Failed("server entry has no parent directory".to_string())
    })?;
    let server_js_arg = node_arg_path(&server_entry);
    let server_dir_arg = node_arg_path(server_dir);

    let path_sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let default_path = if cfg!(target_os = "windows") {
        std::env::var("PATH").unwrap_or_else(|_| "C:\\Windows\\system32;C:\\Windows".into())
    } else {
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into())
    };
    let mut augmented_path = default_path;
    if let Some(directory) = node.parent() {
        augmented_path = format!("{}{}{}", directory.display(), path_sep, augmented_path);
    }
    match find_coven() {
        Some(coven) => {
            log::info!("[cave] using coven at {}", coven.display());
            if let Some(directory) = coven.parent() {
                augmented_path = format!("{}{}{}", directory.display(), path_sep, augmented_path);
            }
        }
        None => log::warn!("[cave] `coven` CLI not found on disk - onboarding will prompt install"),
    }

    on_step(SidecarStartupStep::StartingService);
    if should_cancel() {
        return Err(SidecarStartError::Cancelled);
    }

    #[cfg(target_os = "windows")]
    let (mut command, process_job, launch_gate) = {
        let process_job = windows_process_job::ProcessJob::new().map_err(|error| {
            SidecarStartError::Failed(format!("could not create sidecar process job: {error}"))
        })?;
        let launch_gate = windows_process_job::ProcessLaunchGate::new().map_err(|error| {
            SidecarStartError::Failed(format!("could not create sidecar launch gate: {error}"))
        })?;
        let launcher = launch_gate
            .launcher(&node, [&server_js_arg])
            .map_err(|error| {
                SidecarStartError::Failed(format!("could not prepare sidecar launch gate: {error}"))
            })?;
        (launcher.into_std_command(), process_job, launch_gate)
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new(&node);
        command.arg(&server_js_arg);
        command
    };
    command
        .current_dir(&server_dir_arg)
        .env("PATH", &augmented_path)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("COVEN_CAVE_BUNDLE", "1")
        .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
        .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token);

    if let Some(output) = stdout_log {
        command.stdout(Stdio::from(output));
    } else {
        command.stdout(Stdio::null());
    }
    if let Some(error_output) = stderr_log {
        command.stderr(Stdio::from(error_output));
    } else {
        command.stderr(Stdio::null());
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command.spawn().map_err(|error| {
        SidecarStartError::Failed(format!("failed to spawn node sidecar: {error}"))
    })?;
    #[cfg(target_os = "windows")]
    let child = {
        if let Err(error) = process_job.assign_child(&child) {
            let _ = child.kill();
            return Err(SidecarStartError::Failed(format!(
                "could not assign sidecar launch gate to process job: {error}"
            )));
        }
        if let Err(error) = launch_gate.release() {
            let _ = process_job.terminate();
            let _ = child.kill();
            return Err(SidecarStartError::Failed(format!(
                "could not release sidecar launch gate: {error}"
            )));
        }
        SidecarProcess::from_gated(child, process_job)
    };
    #[cfg(not(target_os = "windows"))]
    let child = SidecarProcess::new(child);
    let sidecar_state = app.state::<SidecarState>();
    match sidecar_state.0.lock() {
        Ok(mut sidecar) => *sidecar = Some(child),
        Err(_) => {
            let cleanup = stop_sidecar_child(child)
                .err()
                .map(|error| format!("; cleanup also failed: {error}"))
                .unwrap_or_default();
            return Err(SidecarStartError::Failed(format!(
                "sidecar process lock is poisoned{cleanup}"
            )));
        }
    }

    on_step(SidecarStartupStep::WaitingForService);
    let sidecar_start_timeout = if cfg!(target_os = "windows") {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(20)
    };
    match wait_for_port(port, sidecar_start_timeout, &should_cancel) {
        PortWaitResult::Ready => {}
        PortWaitResult::Cancelled => return Err(SidecarStartError::Cancelled),
        PortWaitResult::TimedOut => {
            let tail = std::fs::read_to_string(&log_path)
                .ok()
                .map(|contents| {
                    let lines: Vec<&str> = contents.lines().rev().take(8).collect();
                    let mut tail = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
                    if tail.is_empty() {
                        tail.push_str("(no output captured)");
                    }
                    tail
                })
                .unwrap_or_else(|| "(could not read sidecar log)".to_string());
            return Err(SidecarStartError::Failed(format!(
                "Sidecar (node {}) did not become ready on port {} within {}s.\n\nLast lines from {}:\n{}",
                node.display(),
                port,
                sidecar_start_timeout.as_secs(),
                log_path.display(),
                tail
            )));
        }
    }

    #[cfg(target_os = "windows")]
    sidecar_archive::cleanup_stale_sidecar_runtimes(&server_dir_root);

    format!(
        "http://127.0.0.1:{port}/?covenCaveToken={auth_token}&coven_access_token={mobile_access_token}"
    )
    .parse()
    .map_err(|error| SidecarStartError::Failed(format!("could not build sidecar URL: {error}")))
}

#[cfg(all(desktop, target_os = "windows"))]
fn publish_sidecar_startup_status(
    app: &tauri::AppHandle,
    control: &SidecarStartupControl,
    status: SidecarStartupStatus,
) -> Result<(), String> {
    control.set_status(status.clone())?;
    app.emit_to("main", SIDECAR_STARTUP_EVENT, status)
        .map_err(|error| format!("could not publish sidecar startup status: {error}"))
}

#[cfg(all(desktop, target_os = "windows"))]
fn spawn_sidecar_startup(
    app: tauri::AppHandle,
    control: Arc<SidecarStartupControl>,
) -> Result<(), String> {
    control.begin()?;
    if let Err(error) =
        publish_sidecar_startup_status(&app, &control, SidecarStartupStatus::preparing())
    {
        control.finish();
        return Err(error);
    }

    let thread_control = Arc::clone(&control);
    let worker_app = app.clone();
    let spawn_result = thread::Builder::new()
        .name("coven-sidecar-startup".to_string())
        .spawn(move || {
            let app = worker_app;
            let progress_app = app.clone();
            let progress_control = Arc::clone(&thread_control);
            let cancel_control = Arc::clone(&thread_control);
            let result = start_sidecar_runtime(
                &app,
                move |step| {
                    let status = match step {
                        SidecarStartupStep::PreparingRuntime => SidecarStartupStatus::preparing(),
                        SidecarStartupStep::StartingService => SidecarStartupStatus::starting(),
                        SidecarStartupStep::WaitingForService => SidecarStartupStatus::waiting(),
                    };
                    if let Err(error) = publish_sidecar_startup_status(
                        &progress_app,
                        &progress_control,
                        status,
                    ) {
                        log::warn!("[cave] {error}");
                    }
                },
                move || cancel_control.is_cancelled(),
            );

            let final_status = match result {
                Ok(_url) if thread_control.is_cancelled() => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(error) = sidecar.stop() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    SidecarStartupStatus::cancelled()
                }
                Ok(url) => {
                    pty::trust_main_origin(&url);
                    let navigation = app
                        .get_webview_window("main")
                        .ok_or_else(|| "startup window is unavailable".to_string())
                        .and_then(|window| {
                            window
                                .navigate(url)
                                .map_err(|error| format!("could not open CovenCave: {error}"))
                        });
                    match navigation {
                        Ok(()) => SidecarStartupStatus::ready(),
                        Err(error) => {
                            if let Some(sidecar) = app.try_state::<SidecarState>() {
                                if let Err(stop_error) = sidecar.stop() {
                                    log::warn!(
                                        "[cave] could not stop sidecar after navigation failure: {stop_error}"
                                    );
                                }
                            }
                            SidecarStartupStatus::failed(error)
                        }
                    }
                }
                Err(SidecarStartError::Cancelled) => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(error) = sidecar.stop() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    SidecarStartupStatus::cancelled()
                }
                Err(SidecarStartError::Failed(error)) => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(stop_error) = sidecar.stop() {
                            log::warn!(
                                "[cave] could not stop sidecar after startup failure: {stop_error}"
                            );
                        }
                    }
                    SidecarStartupStatus::failed(error)
                }
            };

            if let Err(error) =
                publish_sidecar_startup_status(&app, &thread_control, final_status)
            {
                log::warn!("[cave] {error}");
            }
            thread_control.finish();
        });

    if let Err(error) = spawn_result {
        control.finish();
        let message = format!("could not start sidecar preparation worker: {error}");
        let _ = publish_sidecar_startup_status(
            &app,
            &control,
            SidecarStartupStatus::failed(message.clone()),
        );
        return Err(message);
    }

    Ok(())
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
fn sidecar_startup_status(
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<SidecarStartupStatus, String> {
    state.status()
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
fn retry_sidecar_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<(), String> {
    spawn_sidecar_startup(app, Arc::clone(state.inner()))
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
fn cancel_sidecar_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<(), String> {
    state.request_cancel()?;
    let mut status = state.status()?;
    status.phase = "cancelling";
    status.message = "Finishing the current operation before cancelling".to_string();
    status.can_cancel = false;
    publish_sidecar_startup_status(&app, state.inner(), status)
}

#[cfg(all(test, desktop))]
mod tests {
    #[allow(unused_imports)]
    use super::*;
    #[cfg(target_os = "windows")]
    use std::process::Command;

    #[test]
    fn sidecar_auth_token_is_256_bit_hex() {
        let token = sidecar_auth_token();

        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn mobile_access_token_persists_across_launches() {
        let dir = std::env::temp_dir().join(format!(
            "cave-mobile-token-test-{}-{}",
            std::process::id(),
            sidecar_auth_token()
        ));
        let secret_path = dir.join("nested").join(MOBILE_ACCESS_TOKEN_FILE);

        let first = load_or_create_mobile_access_token(&secret_path);
        let second = load_or_create_mobile_access_token(&secret_path);

        assert_eq!(first, second, "restart must reuse the persisted secret");
        assert!(is_valid_persisted_token(&first));
        assert_eq!(
            std::fs::read_to_string(&secret_path).expect("secret file written"),
            first
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&secret_path)
                .expect("secret metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "secret file must be owner-only");
        }

        std::fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn mobile_access_token_regenerates_when_persisted_secret_is_malformed() {
        let dir = std::env::temp_dir().join(format!(
            "cave-mobile-token-bad-{}-{}",
            std::process::id(),
            sidecar_auth_token()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let secret_path = dir.join(MOBILE_ACCESS_TOKEN_FILE);
        std::fs::write(&secret_path, "not-a-token").expect("write malformed secret");

        let token = load_or_create_mobile_access_token(&secret_path);

        assert!(is_valid_persisted_token(&token));
        assert_eq!(
            std::fs::read_to_string(&secret_path).expect("secret file rewritten"),
            token
        );

        std::fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn quick_chat_url_requires_a_loopback_sidecar_origin() {
        let sidecar = Url::parse("http://127.0.0.1:43123/?token=secret").expect("sidecar URL");
        let quick_chat = quick_chat_url_from_main(sidecar).expect("trusted quick chat URL");

        assert_eq!(quick_chat.path(), "/quick-chat");
        assert_eq!(quick_chat.query(), Some("token=secret"));
        assert!(quick_chat_url_from_main(
            Url::parse("https://example.test/").expect("external URL")
        )
        .is_none());
        assert!(quick_chat_url_from_main(
            Url::parse("tauri://localhost/startup.html").expect("local startup URL")
        )
        .is_none());
    }

    #[test]
    fn sidecar_port_wait_is_cancellable_and_detects_readiness() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind readiness fixture");
        let port = listener.local_addr().expect("fixture address").port();
        assert!(matches!(
            wait_for_port(port, Duration::from_secs(1), || false),
            PortWaitResult::Ready
        ));
        drop(listener);

        assert!(matches!(
            wait_for_port(port, Duration::from_secs(1), || true),
            PortWaitResult::Cancelled
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn startup_control_prevents_concurrent_workers_and_resets_cancellation() {
        let control = SidecarStartupControl::new();

        control.begin().expect("first worker starts");
        assert!(control.begin().is_err());
        control.request_cancel().expect("running worker cancels");
        assert!(control.is_cancelled());
        control.finish();

        control.begin().expect("retry starts after completion");
        assert!(!control.is_cancelled());
        control.finish();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn startup_status_uses_frontend_field_names() {
        let value = serde_json::to_value(SidecarStartupStatus::waiting())
            .expect("serialize startup status");

        assert_eq!(value["phase"], "waiting");
        assert_eq!(value["progress"], 85);
        assert_eq!(value["canRetry"], false);
        assert_eq!(value["canCancel"], true);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn raw_main_close_fallback_recognizes_only_native_close_messages() {
        assert!(is_windows_main_close_message(WM_CLOSE, 0));
        assert!(is_windows_main_close_message(
            WM_SYSCOMMAND,
            SC_CLOSE as usize
        ));
        assert!(is_windows_main_close_message(
            WM_SYSCOMMAND,
            SC_CLOSE as usize | 0x000f
        ));
        assert!(!is_windows_main_close_message(WM_SYSCOMMAND, 0xf020));
        assert!(!is_windows_main_close_message(WM_NCDESTROY, 0));
        assert!(!is_windows_main_close_message(0, SC_CLOSE as usize));

        let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
        assert!(!event.is_null());
        assert!(signal_windows_main_close(event));
        assert!(signal_windows_main_close(event));
        assert_eq!(unsafe { WaitForSingleObject(event, 0) }, WAIT_OBJECT_0);
        unsafe { CloseHandle(event) };
    }

    #[cfg(target_os = "windows")]
    const WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT: &str =
        "COVEN_CAVE_WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT";

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_close_watchdog_helper_process() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Threading::{OpenEventW, SYNCHRONIZATION_SYNCHRONIZE};

        let Some(event_name) = std::env::var_os(WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT) else {
            return;
        };
        let event_name = std::ffi::OsStr::new(&event_name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let event = unsafe { OpenEventW(SYNCHRONIZATION_SYNCHRONIZE, 0, event_name.as_ptr()) };
        assert!(!event.is_null(), "open parent close event");
        println!("COVEN_CAVE_CLOSE_WATCHDOG_READY");
        use std::io::Write as _;
        std::io::stdout().flush().expect("flush helper readiness");
        run_windows_main_close_hard_deadline(event);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn close_hard_deadline_terminates_the_exact_stalled_process() {
        use std::io::{BufRead, BufReader};
        use std::os::windows::{ffi::OsStrExt, process::CommandExt};
        use std::process::{Command, Stdio};
        use std::sync::mpsc;

        let event_name = format!(
            "Local\\CovenCave-close-watchdog-test-{}-{}",
            std::process::id(),
            sidecar_auth_token()
        );
        let wide_event_name = std::ffi::OsStr::new(&event_name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, wide_event_name.as_ptr()) };
        assert!(!event.is_null(), "create named close event");

        let mut child = Command::new(std::env::current_exe().expect("current test executable"))
            .args([
                "--exact",
                "tests::windows_close_watchdog_helper_process",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT, &event_name)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .expect("spawn stalled close-watchdog helper");
        let exact_pid = child.id();
        let stdout = child.stdout.take().expect("helper stdout");
        let (ready_tx, ready_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.contains("COVEN_CAVE_CLOSE_WATCHDOG_READY") {
                    let _ = ready_tx.send(());
                    break;
                }
            }
        });

        if ready_rx.recv_timeout(Duration::from_secs(10)).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            unsafe { CloseHandle(event) };
            panic!("watchdog helper {exact_pid} did not become ready");
        }

        let started = Instant::now();
        assert!(signal_windows_main_close(event));
        let status = loop {
            if let Some(status) = child.try_wait().expect("inspect watchdog helper") {
                break status;
            }
            if started.elapsed() >= Duration::from_secs(5) {
                let _ = child.kill();
                let _ = child.wait();
                unsafe { CloseHandle(event) };
                panic!("watchdog did not terminate exact helper pid {exact_pid}");
            }
            thread::sleep(Duration::from_millis(10));
        };
        reader.join().expect("join helper output reader");
        unsafe { CloseHandle(event) };

        assert_eq!(status.code(), Some(0));
        assert!(
            started.elapsed() >= WINDOWS_MAIN_CLOSE_EXIT_DEADLINE,
            "hard exit fired before its cleanup grace period"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "hard exit exceeded its bounded deadline"
        );
    }

    #[test]
    fn sidecar_cleanup_is_idempotent_when_no_child_is_running() {
        let state = SidecarState(Arc::new(Mutex::new(None)));

        state.stop().expect("first empty cleanup");
        state.stop().expect("second empty cleanup");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn dropping_application_cleanup_guard_stops_and_reaps_sidecar() {
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        let child = command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn cleanup fixture");
        let child = SidecarProcess::new(child);
        let slot = Arc::new(Mutex::new(Some(child)));

        drop(SidecarCleanupGuard(Arc::clone(&slot)));

        assert!(slot.lock().expect("sidecar slot").is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sidecar_state_terminates_root_and_descendant_within_deadline() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::windows::process::CommandExt;
        use std::time::Instant;
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

        let powershell = windows_system32_binary("WindowsPowerShell/v1.0/powershell.exe");
        let script = r#"$null=[Console]::In.ReadLine(); $p=Start-Process "$env:SystemRoot\System32\ping.exe" -ArgumentList '127.0.0.1','-n','30' -WindowStyle Hidden -PassThru; [Console]::Out.WriteLine($p.Id); Wait-Process -Id $p.Id"#;
        let mut child = Command::new(powershell)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .expect("spawn sidecar cleanup fixture");
        let root_pid = child.id();
        let job = windows_process_job::ProcessJob::new().expect("create sidecar process job");
        job.assign_child(&child)
            .expect("assign fixture before descendant launch");
        writeln!(child.stdin.take().expect("fixture stdin")).expect("release fixture");
        let mut descendant_line = String::new();
        BufReader::new(child.stdout.take().expect("fixture stdout"))
            .read_line(&mut descendant_line)
            .expect("read descendant pid");
        let descendant_pid: u32 = descendant_line
            .trim()
            .parse()
            .expect("numeric descendant pid");
        let slot = Arc::new(Mutex::new(Some(SidecarProcess::from_gated(child, job))));

        let started = Instant::now();
        drop(SidecarCleanupGuard(Arc::clone(&slot)));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "sidecar cleanup must return without waiting on child cooperation"
        );
        assert!(slot.lock().expect("sidecar slot").is_none());
        assert!(wait_for_pid_exit(root_pid, Duration::from_secs(3)));
        assert!(wait_for_pid_exit(descendant_pid, Duration::from_secs(3)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn node_arg_path_strips_windows_extended_prefix() {
        let path = PathBuf::from(r"\\?\C:\Program Files\CovenCave\resources\server\server.js");

        assert_eq!(
            node_arg_path(&path),
            PathBuf::from(r"C:\Program Files\CovenCave\resources\server\server.js")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn node_arg_path_converts_verbatim_unc_to_normal_unc() {
        let path = PathBuf::from(r"\\?\UNC\server\share\resources\server\server.js");

        assert_eq!(
            node_arg_path(&path),
            PathBuf::from(r"\\server\share\resources\server\server.js")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn node_arg_path_preserves_regular_windows_paths() {
        let path = PathBuf::from(r"C:\Program Files\CovenCave\resources\server");

        assert_eq!(node_arg_path(&path), path);
    }
}

#[cfg(desktop)]
mod browser;
#[cfg(desktop)]
mod pty;
#[cfg(all(desktop, target_os = "windows"))]
mod sidecar_archive;
#[cfg(all(desktop, target_os = "windows"))]
mod windows_process_job;

#[cfg(desktop)]
fn validate_shell_open_url(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "shell_open requires a valid URL".to_string())?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("shell_open only supports http(s) URLs".to_string()),
    }
}

#[cfg(desktop)]
fn validate_shell_open_path(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("shell_open_path requires a path".to_string());
    }

    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("shell_open_path requires an absolute path".to_string());
    }

    let metadata =
        std::fs::metadata(&path).map_err(|_| "shell_open_path path does not exist".to_string())?;
    if !metadata.is_dir() {
        return Err("shell_open_path only opens directories".to_string());
    }

    Ok(path)
}

#[cfg(desktop)]
fn normalize_picked_directory(path: &str) -> Result<Option<String>, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }

    let path_buf = PathBuf::from(path);
    if !path_buf.is_absolute() {
        return Err("folder picker returned a relative path".to_string());
    }
    if !path_buf.is_dir() {
        return Err("folder picker returned a non-directory path".to_string());
    }

    Ok(Some(path_buf.to_string_lossy().to_string()))
}

#[cfg(desktop)]
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn windows_system32_binary(binary: &str) -> std::path::PathBuf {
    let system_root = std::env::var_os("SystemRoot")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"));
    system_root.join("System32").join(binary)
}

/// Show or hide the macOS traffic lights (close/minimize/zoom) on the
/// invoking window. The main window's title bar is an Overlay (see the main
/// window builder), so the buttons float over web content — when the app's
/// side panel is closed the shell asks for them to disappear, Dia-style, and
/// brings them back the moment the panel (or its hover-peek) opens. AppKit
/// must be touched on the main thread; a no-op elsewhere.
#[cfg(desktop)]
#[tauri::command]
fn set_traffic_lights_visible(window: tauri::WebviewWindow, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(ns_ptr) = win.ns_window() else { return };
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                let ns_window = ns_ptr as *mut AnyObject;
                // NSWindowButton: close = 0, miniaturize = 1, zoom = 2.
                for kind in 0u64..=2u64 {
                    let button: *mut AnyObject = msg_send![&*ns_window, standardWindowButton: kind];
                    if !button.is_null() {
                        let _: () = msg_send![&*button, setHidden: !visible];
                    }
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, visible);
    }
}

/// Open an http(s) URL in the system default browser.
#[cfg(desktop)]
#[tauri::command]
fn shell_open(url: String) -> Result<(), String> {
    validate_shell_open_url(&url)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // Use the Windows URL protocol handler directly instead of routing
        // attacker-controlled URLs through `cmd.exe /c start`, where shell
        // metacharacters such as `&` can execute additional commands.
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open an absolute local directory in the system file explorer.
#[cfg(desktop)]
#[tauri::command]
fn shell_open_path(path: String) -> Result<(), String> {
    let path = validate_shell_open_path(&path)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system32_binary("explorer.exe"))
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ask the OS for a local directory and return its absolute path.
#[cfg(desktop)]
#[tauri::command]
fn shell_pick_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // `tell app "System Events" ... activate` pulls the picker to the
        // foreground so it isn't summoned behind Cave's window (issue #2614b).
        let output = std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to activate",
                "-e",
                "POSIX path of (choose folder with prompt \"Choose a folder for CovenCave\")",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") || stderr.to_lowercase().contains("user canceled") {
            return Ok(None);
        }
        return Err(stderr.trim().to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // A bare FolderBrowserDialog has no owner window, so Windows opens it
        // *behind* every other window, unfocused, with no taskbar entry — it
        // looks like the click did nothing (issue #2614b). Give it a TopMost,
        // ShowInTaskbar owner form (created off-screen) and pass that form as
        // the ShowDialog owner so the picker is summoned to the foreground.
        let script = r#"Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'Manual'; $owner.Location = New-Object System.Drawing.Point(-32000, -32000); $owner.Size = New-Object System.Drawing.Size(1, 1); $owner.Show(); $owner.Activate(); $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder for CovenCave'; $result = $d.ShowDialog($owner); $owner.Close(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }"#;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Sta", "-Command", script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "folder picker failed".to_string()
            } else {
                stderr
            });
        }
        return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
    }

    #[cfg(target_os = "linux")]
    {
        let zenity = std::process::Command::new("zenity")
            .args([
                "--file-selection",
                "--directory",
                "--modal",
                "--title",
                "Choose a folder for CovenCave",
            ])
            .output();
        if let Ok(output) = zenity {
            if output.status.success() {
                return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
            }
            return Ok(None);
        }

        let kdialog = std::process::Command::new("kdialog")
            .args(["--getexistingdirectory"])
            .output()
            .map_err(|_| "No folder picker is available; install zenity or kdialog.".to_string())?;
        if kdialog.status.success() {
            return normalize_picked_directory(&String::from_utf8_lossy(&kdialog.stdout));
        }
        Ok(None)
    }
}

#[cfg(all(test, desktop))]
mod shell_open_tests {
    use super::validate_shell_open_url;

    #[test]
    fn validates_http_and_https_urls() {
        assert!(validate_shell_open_url("http://example.test").is_ok());
        assert!(validate_shell_open_url("https://example.test/?x=1&calc.exe").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(validate_shell_open_url("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(validate_shell_open_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_invalid_urls() {
        assert!(validate_shell_open_url("example.test").is_err());
        assert!(validate_shell_open_url("https://").is_err());
    }

    #[test]
    fn windows_system32_binary_uses_an_absolute_system_path() {
        let path = super::windows_system32_binary("rundll32.exe");
        let path = path.to_string_lossy();
        assert!(path.starts_with(r"C:\") || path.contains(r":\"));
        assert!(
            path.ends_with(r"System32\rundll32.exe") || path.ends_with("System32/rundll32.exe")
        );
    }

    #[test]
    fn validates_absolute_existing_directories_for_path_open() {
        let current = std::env::current_dir().expect("current dir");
        assert!(super::validate_shell_open_path(&current.to_string_lossy()).is_ok());
        assert!(super::validate_shell_open_path("relative/path").is_err());
        assert!(super::validate_shell_open_path(&file!()).is_err());
    }

    #[test]
    fn normalizes_only_absolute_existing_picked_directories() {
        let current = std::env::current_dir().expect("current dir");
        assert!(
            super::normalize_picked_directory(&current.to_string_lossy())
                .unwrap()
                .is_some()
        );
        assert_eq!(super::normalize_picked_directory("").unwrap(), None);
        assert!(super::normalize_picked_directory("relative/path").is_err());
        assert!(super::normalize_picked_directory(&file!()).is_err());
    }

    // #2614b: the native folder picker must be summoned to the foreground, not
    // opened behind Cave's window. Guard the parenting/activation on each
    // platform's picker invocation so a future edit can't silently regress it.
    #[test]
    fn folder_picker_is_summoned_to_the_foreground() {
        let src = include_str!("lib.rs");
        // Windows: the FolderBrowserDialog gets a TopMost owner form passed to
        // ShowDialog so it can't open buried/unfocused.
        assert!(
            src.contains("$owner.TopMost = $true") && src.contains("$d.ShowDialog($owner)"),
            "the Windows folder picker must own its dialog with a TopMost form (foreground)",
        );
        // macOS: activate before `choose folder` so it comes to the front.
        assert!(
            src.contains("tell application \\\"System Events\\\" to activate"),
            "the macOS folder picker must activate System Events before choosing",
        );
        // Linux: the zenity picker runs modal.
        assert!(
            src.contains("--file-selection") && src.contains("--modal"),
            "the Linux (zenity) folder picker must run modal",
        );
    }
}

#[tauri::command]
fn webview_probe_report(report: String) -> Result<(), String> {
    // Dev-only diagnostic hook. In release builds, keep this as a no-op to avoid
    // creating a writable IPC sink for arbitrary/unbounded data.
    if !cfg!(debug_assertions) {
        return Ok(());
    }

    // Prevent unbounded growth if something chatty forwards logs.
    let report = if report.chars().count() > 16_384 {
        let mut s: String = report.chars().take(16_384).collect();
        s.push_str("…<truncated>");
        s
    } else {
        report
    };

    let path = std::env::temp_dir().join("covencave-webview-probe.log");
    use std::io::Write as _;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", report).map_err(|e| e.to_string())?;
    log::debug!("[webview-probe] {}", report);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(desktop, target_os = "windows"))]
    if let Some(code) = windows_process_job::run_gated_child_if_requested() {
        std::process::exit(code);
    }

    let builder = tauri::Builder::default().plugin(tauri_plugin_os::init());

    // Mobile-Tauri shell: no sidecar, no tray, no embedded browser/pty.
    // The webview points at the configured devUrl (Tailscale Serve URL
    // in dev, the bundled frontend stub at build) and the daemon lives
    // remote — see docs/mobile-tailscale.md. Notification plugin still
    // initialises so push permissions flow through the OS sheet.
    #[cfg(mobile)]
    {
        builder
            .invoke_handler(tauri::generate_handler![webview_probe_report])
            .setup(|app| {
                if cfg!(debug_assertions) {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Debug)
                            .build(),
                    )?;
                }
                app.handle().plugin(tauri_plugin_notification::init())?;

                // Debug mobile builds are launched by scripts/mobile-tailscale.sh
                // with a live Tailscale Serve dev URL. Release/TestFlight builds
                // cannot receive that env var, so they must open the bundled
                // connection screen instead of silently trying localhost:3000.
                let webview_url = if cfg!(debug_assertions) {
                    // Resolve the Tailscale Serve URL.
                    // Priority: CAVE_MOBILE_DEV_URL env var -> tauri.conf.json devUrl -> localhost:3000
                    // Security: only https://*.ts.net and http(s)://localhost accepted.
                    let resolved_url: tauri::Url = {
                        let from_env = std::env::var("CAVE_MOBILE_DEV_URL")
                            .ok()
                            .and_then(|s| tauri::Url::parse(&s).ok());

                        let url = from_env
                            .or_else(|| app.config().build.dev_url.clone())
                            .unwrap_or_else(|| {
                                tauri::Url::parse("http://localhost:3000")
                                    .expect("fallback url is valid")
                            });

                        let host = url.host_str().unwrap_or("");
                        let scheme = url.scheme();
                        let allowed = (scheme == "https"
                            && (host.ends_with(".ts.net") || host == "localhost"))
                            || (scheme == "http"
                                && (host == "localhost" || host == "127.0.0.1"));

                        if !allowed {
                            panic!(
                                "CAVE_MOBILE_DEV_URL must be https://<host>.ts.net, https://localhost, http://localhost, or http://127.0.0.1 - got: {}",
                                url
                            );
                        }
                        log::info!("[cave-mobile] webview URL: {}", url);
                        url
                    };
                    tauri::WebviewUrl::External(resolved_url)
                } else {
                    tauri::WebviewUrl::App("index.html".into())
                };

                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    webview_url,
                )
                .title("CovenCave")
                .build()?;

                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
        return;
    }

    // Desktop body — sidecar bootstrap, embedded browser, terminal,
    // tray icon. Everything below this point is gated to `cfg(desktop)`
    // by the imports at the top of the file.
    #[cfg(desktop)]
    let sidecar_process = Arc::new(Mutex::new(None));
    #[cfg(desktop)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_stop,
            pty::pty_list,
            pty::pty_snapshot,
            pty::pty_diagnose,
            webview_probe_report,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_hide,
            browser::browser_hide_all_except,
            browser::browser_close,
            browser::browser_deactivate_all,
            browser::browser_close_all,
            browser::browser_reload,
            browser::browser_report_user_navigation,
            browser::browser_report_title,
            browser::browser_report_scroll,
            shell_open,
            shell_open_path,
            shell_pick_directory,
            set_traffic_lights_visible,
            #[cfg(target_os = "windows")]
            sidecar_startup_status,
            #[cfg(target_os = "windows")]
            retry_sidecar_startup,
            #[cfg(target_os = "windows")]
            cancel_sidecar_startup,
        ])
        .manage(SidecarState(Arc::clone(&sidecar_process)))
        .manage(browser::BrowserLifecycleState::default());
    #[cfg(all(desktop, target_os = "windows"))]
    let builder = builder.manage(Arc::new(SidecarStartupControl::new()));
    #[cfg(desktop)]
    builder
        .setup(move |app| {
            // The updater's Windows pre-exit path clears the application
            // resource table after validating the package and before starting
            // msiexec. Dropping this guard stops/reaps the sidecar even though
            // std::process::exit bypasses window destruction and RunEvent.
            let _ = app
                .resources_table()
                .add(SidecarCleanupGuard(Arc::clone(&sidecar_process)));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            app.handle().plugin(tauri_plugin_notification::init())?;

            // Desktop auto-update: updater checks/downloads/installs signed
            // release artifacts; process provides relaunch() after install.
            let updater_builder = tauri_plugin_updater::Builder::new();
            #[cfg(target_os = "windows")]
            let updater_builder = {
                let log_dir = app.path().app_log_dir()?;
                std::fs::create_dir_all(&log_dir)?;
                let log_path = log_dir.join(format!(
                    "msi-upgrade-from-{}-{}.log",
                    app.package_info().version,
                    std::process::id()
                ));
                log::info!("[cave] updater MSI log -> {}", log_path.display());
                updater_builder.installer_args([
                    std::ffi::OsString::from("/L*V"),
                    std::ffi::OsString::from(format!("\"{}\"", log_path.display())),
                ])
            };
            app.handle().plugin(updater_builder.build())?;
            app.handle().plugin(tauri_plugin_process::init())?;

            check_app_translocation();

            // Dev builds: when the configured dev server (tauri.conf.json
            // `build.devUrl` — `pnpm dev`) is live, point the main webview
            // straight at it and skip the bundled sidecar entirely. The
            // sidecar bundle only exists after a release build
            // (scripts/sidecar-bundle.sh), so requiring it here meant a clean
            // checkout could not boot `pnpm dev:app` at all — and when a
            // stale bundle did exist, the dev app silently rendered an old
            // production build instead of live code.
            let main_url: Option<tauri::Url> = if let Some(dev_url) = live_dev_server_url(app) {
                Some(dev_url)
            } else {
                #[cfg(target_os = "windows")]
                {
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("startup.html".into()))
                        .title("CovenCave")
                        .inner_size(1320.0, 820.0)
                        .min_inner_size(960.0, 600.0)
                        .resizable(true)
                        .disable_drag_drop_handler()
                        .build()?;

                    let startup_control =
                        Arc::clone(app.state::<Arc<SidecarStartupControl>>().inner());
                    spawn_sidecar_startup(app.handle().clone(), startup_control)?;
                    None
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let sidecar_url = match start_sidecar_runtime(app.handle(), |_| {}, || false) {
                        Ok(url) => url,
                        Err(SidecarStartError::Cancelled) => {
                            fatal_exit("sidecar startup was cancelled")
                        }
                        Err(SidecarStartError::Failed(error)) => fatal_exit(&error),
                    };
                    Some(sidecar_url)
                }
            };

            if let Some(main_url) = main_url {
                pty::trust_main_origin(&main_url);
                let mut main_window =
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(main_url))
                        .title("CovenCave")
                        .inner_size(1320.0, 820.0)
                        .min_inner_size(960.0, 600.0)
                        .resizable(true)
                        // Required for HTML5 drag-and-drop (Coven Board card moves) to
                        // work in the webview — otherwise Tauri's OS-level file-drop
                        // handler intercepts dragenter/dragover/drop before the DOM sees
                        // them.
                        .disable_drag_drop_handler();
                // macOS: dissolve the seam between the native title bar and the
                // app's top toolbar. `Overlay` lets the webview content fill to the
                // very top (the traffic-light buttons float over it) and
                // `hidden_title` drops the centered "CovenCave" label, so the
                // toolbar reads as one continuous strip. The web side reserves room
                // for the traffic lights (`[data-tauri-titlebar]` in globals.css)
                // and marks the bar `data-tauri-drag-region="deep"`; the drag is
                // an ACL-gated IPC call, granted to this loopback origin by
                // capabilities/loopback-window-drag.json. No-op on Windows/Linux.
                #[cfg(target_os = "macos")]
                {
                    main_window = main_window
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .hidden_title(true);
                }
                // Dev-only automation hook: WKWebView has no external driver
                // protocol, so dev tooling (terminal e2e checks, screenshots)
                // can inject a script that runs before the page loads. No-op in
                // release builds.
                if cfg!(debug_assertions) {
                    if let Ok(script) = std::env::var("COVEN_CAVE_DEV_INIT_SCRIPT") {
                        if !script.is_empty() {
                            log::info!(
                                "[cave] injecting COVEN_CAVE_DEV_INIT_SCRIPT ({} bytes)",
                                script.len()
                            );
                            main_window = main_window.initialization_script(&script);
                        }
                    }
                }
                if let Err(e) = main_window.build() {
                    fatal_exit(&format!("failed to build main window: {}", e));
                }
            }

            #[cfg(target_os = "windows")]
            install_windows_main_close_fallback(app).map_err(std::io::Error::other)?;

            // Status bar / system-tray menu — quick access to inbox + reminder
            // creation when CovenCave is in the background. Menu actions either
            // bring the main window forward or emit a `tray:*` event the
            // WebView listens for.
            let open_inbox =
                MenuItem::with_id(app, "open_inbox", "Open Inbox", true, None::<&str>)?;
            let new_reminder =
                MenuItem::with_id(app, "new_reminder", "New Reminder…", true, None::<&str>)?;
            let quick_chat =
                MenuItem::with_id(app, "quick_chat", "Quick Chat…", true, None::<&str>)?;
            let show_app =
                MenuItem::with_id(app, "show_app", "Show CovenCave", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit CovenCave", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[
                    &open_inbox,
                    &new_reminder,
                    &quick_chat,
                    &separator,
                    &show_app,
                    &separator,
                    &quit,
                ],
            )?;

            // `icon_as_template(true)` is a macOS-only concept (renders the
            // icon as a template image so the system can adapt it to dark/light
            // menu bar). On other platforms the call doesn't exist — guard it.
            let tray_builder = TrayIconBuilder::with_id("cave-tray")
                .icon(coven_tray_icon())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("CovenCave")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open_inbox" => {
                        focus_main_window(app);
                        let _ = app.emit("tray:open-inbox", ());
                    }
                    "new_reminder" => {
                        focus_main_window(app);
                        let _ = app.emit("tray:new-reminder", ());
                    }
                    "quick_chat" => show_quick_chat_from_main(app),
                    "show_app" => focus_main_window(app),
                    "quit" => {
                        #[cfg(target_os = "windows")]
                        shutdown_owned_processes(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click brings the main window forward; right-click
                    // is reserved for the native menu.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main_window(tray.app_handle());
                    }
                });

            // Apply macOS-only template flag after building the rest of the
            // chain so the non-macOS branch compiles cleanly.
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);

            #[cfg(target_os = "linux")]
            {
                let previous_hook = std::panic::take_hook();
                std::panic::set_hook(Box::new(|_| {}));
                let tray_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    tray_builder.build(app)
                }));
                std::panic::set_hook(previous_hook);

                match tray_result {
                    Ok(Ok(_tray)) => {}
                    Ok(Err(e)) => log_linux_tray_unavailable(&e.to_string()),
                    Err(payload) => {
                        log_linux_tray_unavailable(&panic_payload_message(payload.as_ref()))
                    }
                }
            }

            #[cfg(not(target_os = "linux"))]
            let _tray = tray_builder.build(app)?;

            let app_handle = app.handle().clone();
            app.listen("quick-chat:open-session", move |_| {
                focus_main_window(&app_handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Tauri automatically prevents a native close when any JS
            // `tauri://close-requested` listener is registered. If WebView2's
            // JS thread is wedged (the same failure that makes the UI ignore
            // clicks), that listener can never finish the close and Windows'
            // title-bar X becomes permanently inert. The main Windows window
            // has no supported close-to-tray contract, so make its native close
            // request authoritative and independent of WebView responsiveness.
            // Application cleanup drops SidecarCleanupGuard and reaps the
            // sidecar process tree.
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && window.label() == "main"
            {
                shutdown_owned_processes(window.app_handle());
                window.app_handle().exit(0);
                return;
            }

            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                        if let Err(error) = state.stop() {
                            log::warn!(
                                "[cave] could not stop sidecar during window teardown: {error}"
                            );
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
