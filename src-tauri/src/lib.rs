// Desktop-only imports — pulled in conditionally so the mobile build
// doesn't reach for std::process::Child, std::net::TcpListener, or the
// Tauri tray/menu/webview-builder APIs that aren't available on iOS or
// Android. Mobile binaries are thin shells: webview only, no sidecar.
#[cfg(desktop)]
use rand::{rngs::OsRng, RngCore};
#[cfg(desktop)]
use std::net::TcpListener;
#[cfg(all(desktop, target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::sync::Mutex;
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

#[cfg(desktop)]
const QUICK_CHAT_WINDOW_LABEL: &str = "quick-chat";
#[cfg(desktop)]
const QUICK_CHAT_WIDTH: f64 = 390.0;
#[cfg(desktop)]
const QUICK_CHAT_HEIGHT: f64 = 520.0;

#[cfg(desktop)]
fn coven_tray_icon() -> Image<'static> {
    const SIZE: u32 = 18;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    let center = (SIZE as f32 - 1.0) / 2.0;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let in_c_ring = (4.3..=7.7).contains(&dist) && !(dx > 1.2 && dy.abs() < 4.2);
            let in_core = dx.abs() <= 1.2 && dy.abs() <= 5.8;
            let in_mark = in_c_ring || in_core;
            if !in_mark {
                continue;
            }

            let idx = ((y * SIZE + x) * 4) as usize;
            rgba[idx] = 255;
            rgba[idx + 1] = 255;
            rgba[idx + 2] = 255;
            rgba[idx + 3] = 255;
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
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
        return (screen_x + screen_w - QUICK_CHAT_WIDTH - 14.0, screen_y + 34.0);
    }
    (24.0, 40.0)
}

#[cfg(desktop)]
fn show_quick_chat_window(app: &tauri::AppHandle, quick_chat_url: &Url) {
    if let Some(window) = app.get_webview_window(QUICK_CHAT_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let (x, y) = quick_chat_position(app);
    match WebviewWindowBuilder::new(
        app,
        QUICK_CHAT_WINDOW_LABEL,
        WebviewUrl::External(quick_chat_url.clone()),
    )
    .title("CovenCave Quick Chat")
    .inner_size(QUICK_CHAT_WIDTH, QUICK_CHAT_HEIGHT)
    .min_inner_size(340.0, 420.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(x, y)
    .shadow(true)
    .disable_drag_drop_handler()
    .build()
    {
        Ok(window) => {
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
        let Ok(exe) = std::env::current_exe() else { return };
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
        let nvm_root =
            PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("nvm");
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
                std::env::var("ProgramFiles")
                    .unwrap_or_else(|_| "C:\\Program Files".into()),
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
        if let Ok(out) = std::process::Command::new("where.exe").arg("coven").output() {
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
struct SidecarState(Mutex<Option<Child>>);

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
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    use std::net::TcpStream;
    let addr = format!("127.0.0.1:{}", port);
    let parsed = addr.parse().expect("valid sidecar addr");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&parsed, Duration::from_millis(200)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
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

#[cfg(all(test, desktop))]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn sidecar_auth_token_is_256_bit_hex() {
        let token = sidecar_auth_token();

        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
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

    let metadata = std::fs::metadata(&path)
        .map_err(|_| "shell_open_path path does not exist".to_string())?;
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
        let output = std::process::Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose folder with prompt \"Choose a folder for Graphify\")",
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
        let script = r#"Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder for Graphify'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }"#;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Sta", "-Command", script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() { "folder picker failed".to_string() } else { stderr });
        }
        return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
    }

    #[cfg(target_os = "linux")]
    {
        let zenity = std::process::Command::new("zenity")
            .args(["--file-selection", "--directory", "--title", "Choose a folder for Graphify"])
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
        assert!(path.ends_with(r"System32\rundll32.exe") || path.ends_with("System32/rundll32.exe"));
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
        assert!(super::normalize_picked_directory(&current.to_string_lossy()).unwrap().is_some());
        assert_eq!(super::normalize_picked_directory("").unwrap(), None);
        assert!(super::normalize_picked_directory("relative/path").is_err());
        assert!(super::normalize_picked_directory(&file!()).is_err());
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
    builder
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
            browser::browser_reload,
            browser::browser_report_title,
            browser::browser_report_scroll,
            shell_open,
            shell_open_path,
            shell_pick_directory,
        ])
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
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
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
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
            let main_url: tauri::Url = if let Some(dev_url) = live_dev_server_url(app) {
                dev_url
            } else {
            let resource_dir = match app.path().resource_dir() {
                Ok(d) => d,
                Err(e) => fatal_exit(&format!("could not resolve resource dir: {}", e)),
            };
            // Prefer the custom server (server.ts → server.mjs): it carries
            // the /api/pty-ws terminal websocket bridge. server.js is Next's
            // generated standalone entrypoint, kept as a fallback for old
            // bundles — it serves the app but has no terminal bridge.
            let server_dir_root = resource_dir.join("resources").join("server");
            let server_mjs = server_dir_root.join("server.mjs");
            let server_js = server_dir_root.join("server.js");
            let server_entry = if server_mjs.exists() {
                server_mjs
            } else if server_js.exists() {
                log::warn!(
                    "[cave] bundle has no server.mjs — terminal websocket bridge unavailable in this build"
                );
                server_js
            } else {
                fatal_exit(&format!(
                    "standalone server not found at {}",
                    server_js.display()
                ));
            };

            let port = match find_free_port() {
                Some(p) => p,
                None => fatal_exit("no free local port available"),
            };
            let auth_token = sidecar_auth_token();
            let mobile_access_token = sidecar_auth_token();
            log::info!("[cave] starting sidecar on port {}", port);

            let node = match find_node(&resource_dir) {
                Some(p) => p,
                None => fatal_exit(
                    "Could not find a `node` binary. Install Node.js from \
                     https://nodejs.org and re-launch CovenCave.",
                ),
            };
            log::info!("[cave] using node at {}", node.display());

            // Capture sidecar logs so we can show what went wrong if it never
            // becomes ready. Platform-specific log directory:
            //   macOS:   ~/Library/Logs/CovenCave/sidecar.log
            //   Windows: %APPDATA%\CovenCave\logs\sidecar.log
            //   Linux:   ~/.local/share/CovenCave/logs/sidecar.log
            let log_dir = {
                #[cfg(target_os = "macos")]
                {
                    std::env::var("HOME")
                        .map(|h| PathBuf::from(h).join("Library/Logs/CovenCave"))
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
                        .map(|h| PathBuf::from(h).join(".local/share/CovenCave/logs"))
                        .unwrap_or_else(|_| std::env::temp_dir())
                }
            };
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("sidecar.log");
            log::info!("[cave] sidecar log → {}", log_path.display());

            let stdout_log = std::fs::File::create(&log_path).ok();
            let stderr_log = stdout_log
                .as_ref()
                .and_then(|f| f.try_clone().ok());

            // Crucially, run from the directory that contains the server
            // entrypoint so Next.js can locate its sibling .next/ and public/.
            let server_dir = server_entry
                .parent()
                .ok_or("server entry has no parent dir")?;
            let server_js_arg = node_arg_path(&server_entry);
            let server_dir_arg = node_arg_path(server_dir);

            // GUI launches often inherit a stripped PATH. Prepend the
            // directories holding `node` and `coven` so the sidecar's API
            // routes can spawn them by name. Missing `coven` is non-fatal —
            // onboarding surfaces it.
            //
            // PATH separator is ':' on Unix and ';' on Windows.
            let path_sep = if cfg!(target_os = "windows") { ";" } else { ":" };
            let default_path = if cfg!(target_os = "windows") {
                std::env::var("PATH").unwrap_or_else(|_| "C:\\Windows\\system32;C:\\Windows".into())
            } else {
                std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into())
            };
            let mut augmented_path = default_path;
            if let Some(dir) = node.parent() {
                augmented_path = format!("{}{}{}", dir.display(), path_sep, augmented_path);
            }
            match find_coven() {
                Some(coven) => {
                    log::info!("[cave] using coven at {}", coven.display());
                    if let Some(dir) = coven.parent() {
                        augmented_path =
                            format!("{}{}{}", dir.display(), path_sep, augmented_path);
                    }
                }
                None => log::warn!(
                    "[cave] `coven` CLI not found on disk — onboarding will prompt install"
                ),
            }

            let mut cmd = Command::new(&node);
            cmd.arg(&server_js_arg)
                .current_dir(&server_dir_arg)
                .env("PATH", &augmented_path)
                .env("PORT", port.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("NODE_ENV", "production")
                .env("COVEN_CAVE_BUNDLE", "1")
                .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
                .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token);

            if let Some(out) = stdout_log {
                cmd.stdout(Stdio::from(out));
            } else {
                cmd.stdout(Stdio::null());
            }
            if let Some(err) = stderr_log {
                cmd.stderr(Stdio::from(err));
            } else {
                cmd.stderr(Stdio::null());
            }

            #[cfg(target_os = "windows")]
            {
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            let child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => fatal_exit(&format!("failed to spawn node sidecar: {}", e)),
            };

            *app
                .state::<SidecarState>()
                .0
                .lock()
                .expect("sidecar lock") = Some(child);

            if !wait_for_port(port, Duration::from_secs(20)) {
                // Read the tail of the sidecar log to give the user a clue.
                let tail = std::fs::read_to_string(&log_path)
                    .ok()
                    .map(|s| {
                        let lines: Vec<&str> = s.lines().rev().take(8).collect();
                        let mut tail = lines
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                            .join("\n");
                        if tail.is_empty() {
                            tail.push_str("(no output captured)");
                        }
                        tail
                    })
                    .unwrap_or_else(|| "(could not read sidecar log)".to_string());
                fatal_exit(&format!(
                    "Sidecar (node {}) did not become ready on port {} within 20s.\n\nLast lines from {}:\n{}",
                    node.display(),
                    port,
                    log_path.display(),
                    tail
                ));
            }

            format!(
                "http://127.0.0.1:{}/?covenCaveToken={}&coven_access_token={}",
                port, auth_token, mobile_access_token
            )
            .parse()
            .expect("valid url")
            };

            pty::trust_main_origin(&main_url);
            let mut quick_chat_url = main_url.clone();
            quick_chat_url.set_path("/quick-chat");
            let mut main_window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(main_url),
            )
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

            // Status bar / system-tray menu — quick access to inbox + reminder
            // creation when CovenCave is in the background. Menu actions either
            // bring the main window forward or emit a `tray:*` event the
            // WebView listens for.
            let open_inbox =
                MenuItem::with_id(app, "open_inbox", "Open Inbox", true, None::<&str>)?;
            let new_reminder = MenuItem::with_id(
                app,
                "new_reminder",
                "New Reminder…",
                true,
                None::<&str>,
            )?;
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
            let quick_chat_url_for_menu = quick_chat_url.clone();
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
                    "quick_chat" => show_quick_chat_window(app, &quick_chat_url_for_menu),
                    "show_app" => focus_main_window(app),
                    "quit" => app.exit(0),
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
                let tray_result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
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
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                        if let Some(mut child) = state.0.lock().expect("sidecar lock").take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
