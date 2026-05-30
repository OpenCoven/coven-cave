use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Surface a fatal startup error to the user via osascript (Cocoa) so they see
/// something instead of a silent abort(). Best-effort; ignored on failure.
fn show_fatal_dialog(msg: &str) {
    let script = format!(
        "display alert \"CovenCave failed to start\" message \"{}\" as critical",
        msg.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let _ = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output();
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

/// Find a usable `node` binary. macOS GUI launches do NOT inherit the user's
/// shell PATH (`/usr/bin:/bin:/usr/sbin:/sbin` only), so a bare
/// `Command::new("node")` will fail when the user launches Cave from the
/// Finder. We probe well-known install locations + a $HOME/.nvm scan + a
/// last-ditch `which` invocation under a login shell.
fn find_node() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;

    // Fixed candidates, in order of likelihood
    let candidates = [
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from(format!("{}/.local/bin/node", home)),
        PathBuf::from(format!("{}/.bun/bin/node", home)),
        PathBuf::from(format!("{}/.volta/bin/node", home)),
    ];
    for c in candidates.iter() {
        if c.exists() {
            return Some(c.clone());
        }
    }

    // nvm — scan ~/.nvm/versions/node/<version>/bin/node, prefer the newest
    let nvm_root = PathBuf::from(format!("{}/.nvm/versions/node", home));
    if let Ok(entries) = std::fs::read_dir(&nvm_root) {
        let mut versions: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        // Sort lexicographically (good enough for v20 < v24 etc.)
        versions.sort();
        if let Some(latest) = versions.into_iter().rev().next() {
            let node = latest.join("bin").join("node");
            if node.exists() {
                return Some(node);
            }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

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
                     https://nodejs.org or run `brew install node` and re-launch CovenCave.",
                ),
            };
            log::info!("[cave] using node at {}", node.display());

            let child = match Command::new(&node)
                .arg(&server_js)
                .env("PORT", port.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("NODE_ENV", "production")
                .env("COVEN_CAVE_BUNDLE", "1")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(c) => c,
                Err(e) => fatal_exit(&format!("failed to spawn node sidecar: {}", e)),
            };

            *app
                .state::<SidecarState>()
                .0
                .lock()
                .expect("sidecar lock") = Some(child);

            if !wait_for_port(port, Duration::from_secs(20)) {
                fatal_exit(&format!(
                    "Sidecar (node {}) did not become ready on port {} within 20s.",
                    node.display(),
                    port
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
            .build()
            {
                fatal_exit(&format!("failed to build main window: {}", e));
            }

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
