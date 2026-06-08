use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

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

/// Surface a fatal startup error to the user. Platform-specific: macOS uses
/// osascript (Cocoa alert), Windows writes to a temp file and opens Notepad,
/// Linux tries zenity/kdialog. Best-effort; ignored on failure.
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

/// Find a usable `node` binary. GUI launches often do NOT inherit the user's
/// full shell PATH, so a bare `Command::new("node")` will fail. We probe
/// well-known install locations per platform, plus a last-ditch shell/where
/// invocation.
fn find_node() -> Option<PathBuf> {
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
fn find_coven() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let candidates = [
            PathBuf::from(format!("{}\\.cargo\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.volta\\bin\\coven.exe", home)),
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
        let candidates = [
            PathBuf::from(format!("{}/.cargo/bin/coven", home)),
            PathBuf::from(format!("{}/.local/bin/coven", home)),
            PathBuf::from(format!("{}/.bun/bin/coven", home)),
            PathBuf::from("/opt/homebrew/bin/coven"),
            PathBuf::from("/usr/local/bin/coven"),
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

struct SidecarState(Mutex<Option<Child>>);

fn find_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

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

#[cfg(target_os = "windows")]
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

#[cfg(not(target_os = "windows"))]
fn node_arg_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

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

mod browser;
mod pty;

fn validate_shell_open_url(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "shell_open requires a valid URL".to_string())?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("shell_open only supports http(s) URLs".to_string()),
    }
}

/// Open an http(s) URL in the system default browser.
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

#[cfg(test)]
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_stop,
            pty::pty_list,
            pty::pty_diagnose,
            webview_probe_report,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_hide,
            browser::browser_hide_all_except,
            browser::browser_close,
            browser::browser_reload,
            browser::browser_report_title,
            shell_open,
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

            check_app_translocation();

            let resource_dir = match app.path().resource_dir() {
                Ok(d) => d,
                Err(e) => fatal_exit(&format!("could not resolve resource dir: {}", e)),
            };
            let server_js = resource_dir
                .join("resources")
                .join("server")
                .join("server.js");

            if !server_js.exists() {
                fatal_exit(&format!(
                    "standalone server not found at {}",
                    server_js.display()
                ));
            }

            let port = match find_free_port() {
                Some(p) => p,
                None => fatal_exit("no free local port available"),
            };
            log::info!("[cave] starting sidecar on port {}", port);

            let node = match find_node() {
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

            // Crucially, run from the directory that contains server.js so
            // Next.js standalone can locate its sibling .next/ and public/.
            let server_dir = server_js
                .parent()
                .ok_or("server_js has no parent dir")?;
            let server_js_arg = node_arg_path(&server_js);
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
                .env("COVEN_CAVE_BUNDLE", "1");

            // Inject the openclaw workspace root so the Next.js project-tree
            // and project-file API routes allow paths under ~/.openclaw in the
            // packaged app (where process.cwd() is the bundle dir, not the
            // user's workspace).
            if let Some(home) = std::env::var("HOME")
                .ok()
                .or_else(|| std::env::var("USERPROFILE").ok())
            {
                let workspace_root = format!("{}/.openclaw", home);
                cmd.env("WORKSPACE_ROOT", &workspace_root);
                log::info!("[cave] sidecar WORKSPACE_ROOT -> {}", workspace_root);
            }
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

            let url = format!("http://127.0.0.1:{}/", port);
            if let Err(e) = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().expect("valid url")),
            )
            .title("CovenCave")
            .inner_size(1320.0, 820.0)
            .min_inner_size(960.0, 600.0)
            .resizable(true)
            // Required for HTML5 drag-and-drop (Coven Board card moves) to
            // work in the webview — otherwise Tauri's OS-level file-drop
            // handler intercepts dragenter/dragover/drop before the DOM sees
            // them.
            .disable_drag_drop_handler()
            .build()
            {
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
            let show_app =
                MenuItem::with_id(app, "show_app", "Show CovenCave", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit CovenCave", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[
                    &open_inbox,
                    &new_reminder,
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
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_inbox" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("tray:open-inbox", ());
                    }
                    "new_reminder" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("tray:new-reminder", ());
                    }
                    "show_app" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
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
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });

            // Apply macOS-only template flag after building the rest of the
            // chain so the non-macOS branch compiles cleanly.
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);

            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    if let Some(mut child) = state.0.lock().expect("sidecar lock").take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
