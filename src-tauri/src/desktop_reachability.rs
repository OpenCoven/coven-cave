#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::*;

#[cfg(desktop)]
use serde::{Deserialize, Serialize};
#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

#[cfg(desktop)]
const REACHABILITY_CONFIG_FILE: &str = "desktop-reachability.json";
#[cfg(desktop)]
const GUI_ACTIVE_FILE: &str = "desktop-gui-active.json";
#[cfg(desktop)]
const DAEMON_STATE_FILE: &str = "desktop-daemon-state.json";
#[cfg(desktop)]
const LAUNCH_AGENT_LABEL: &str = "ai.opencoven.cave";
#[cfg(desktop)]
const MOBILE_PAIRED_FILE: &str = "mobile-paired.json";
#[cfg(desktop)]
const POWER_MONITOR_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(desktop)]
const SERVE_REPAIR_INTERVAL: Duration = Duration::from_secs(30);

#[cfg(desktop)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct DesktopReachabilityConfig {
    pub(super) prevent_sleep: bool,
    pub(super) prevent_sleep_on_ac_only: bool,
    pub(super) daemon_mode: bool,
}

#[cfg(desktop)]
impl Default for DesktopReachabilityConfig {
    fn default() -> Self {
        Self {
            prevent_sleep: false,
            prevent_sleep_on_ac_only: true,
            daemon_mode: false,
        }
    }
}

#[cfg(desktop)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopReachabilityStatus {
    supported: bool,
    config: DesktopReachabilityConfig,
    paired_phone_seen: bool,
    launch_agent_installed: bool,
    prevent_sleep_active: bool,
    detail: Option<String>,
}

#[cfg(desktop)]
struct PowerAssertion {
    child: Child,
    on_ac_only: bool,
}

#[cfg(desktop)]
#[derive(Default)]
pub(super) struct DesktopReachabilityRuntime {
    target_pid: AtomicU32,
    power_assertion: Mutex<Option<PowerAssertion>>,
    monitor_started: AtomicBool,
}

#[cfg(desktop)]
impl DesktopReachabilityRuntime {
    fn set_target_pid(&self, pid: u32) {
        self.target_pid.store(pid, Ordering::Release);
    }

    fn clear_target_pid(&self) {
        self.target_pid.store(0, Ordering::Release);
    }

    fn target_pid(&self) -> Option<u32> {
        match self.target_pid.load(Ordering::Acquire) {
            0 => None,
            pid => Some(pid),
        }
    }

    fn start_monitor(self: &Arc<Self>, config_path: PathBuf, paired_path: PathBuf) {
        if self.monitor_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = Arc::downgrade(self);
        thread::spawn(move || loop {
            let Some(runtime) = runtime.upgrade() else {
                break;
            };
            runtime.reconcile_power(&config_path, &paired_path);
            drop(runtime);
            thread::sleep(POWER_MONITOR_INTERVAL);
        });
    }

    fn reconcile_power(&self, config_path: &Path, paired_path: &Path) {
        #[cfg(target_os = "macos")]
        {
            let config = read_reachability_config(config_path);
            let paired = paired_phone_seen(paired_path);
            let target_pid = self.target_pid();
            let desired =
                config.prevent_sleep && paired && mobile_mode_enabled() && target_pid.is_some();
            let mut assertion = match self.power_assertion.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(current) = assertion.as_mut() {
                let still_running = current.child.try_wait().ok().flatten().is_none();
                if !desired
                    || !still_running
                    || current.on_ac_only != config.prevent_sleep_on_ac_only
                {
                    let _ = current.child.kill();
                    let _ = current.child.wait();
                    *assertion = None;
                }
            }

            if assertion.is_none() && desired {
                let pid = target_pid.expect("desired assertion has a target pid");
                match spawn_power_assertion(pid, config.prevent_sleep_on_ac_only) {
                    Ok(child) => {
                        log::info!(
                            "[cave] prevent-sleep assertion active for sidecar pid {pid} ({})",
                            if config.prevent_sleep_on_ac_only {
                                "AC power only"
                            } else {
                                "battery and AC power"
                            }
                        );
                        *assertion = Some(PowerAssertion {
                            child,
                            on_ac_only: config.prevent_sleep_on_ac_only,
                        });
                    }
                    Err(error) => {
                        log::warn!("[cave] could not start prevent-sleep assertion: {error}");
                    }
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (config_path, paired_path);
        }
    }

    fn power_active(&self) -> bool {
        let mut assertion = match self.power_assertion.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some(current) = assertion.as_mut() else {
            return false;
        };
        if current.child.try_wait().ok().flatten().is_some() {
            *assertion = None;
            return false;
        }
        true
    }
}

#[cfg(desktop)]
impl Drop for DesktopReachabilityRuntime {
    fn drop(&mut self) {
        let assertion = match self.power_assertion.get_mut() {
            Ok(assertion) => assertion,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(mut assertion) = assertion.take() {
            let _ = assertion.child.kill();
            let _ = assertion.child.wait();
        }
    }
}

#[cfg(desktop)]
fn cave_home_path() -> PathBuf {
    if let Ok(explicit) = std::env::var("COVEN_CAVE_HOME") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit);
        }
    }
    if let Ok(coven_home) = std::env::var("COVEN_HOME") {
        if !coven_home.trim().is_empty() {
            return PathBuf::from(coven_home).join("cave");
        }
    }
    let home = std::env::var(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".coven").join("cave")
}

#[cfg(desktop)]
fn paired_phone_path() -> PathBuf {
    cave_home_path().join(MOBILE_PAIRED_FILE)
}

#[cfg(desktop)]
fn paired_phone_seen(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("lastSeenAt").and_then(|seen| seen.as_f64()))
        .is_some_and(f64::is_finite)
}

#[cfg(desktop)]
fn read_reachability_config(path: &Path) -> DesktopReachabilityConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[cfg(desktop)]
fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let json = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("could not serialize {}: {error}", path.display()))?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|error| format!("could not open {}: {error}", temp.display()))?;
    file.write_all(&json)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write {}: {error}", temp.display()))?;
    std::fs::rename(&temp, path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[cfg(desktop)]
fn mobile_mode_enabled() -> bool {
    let path = cave_home_path().join("preferences.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("phone")
                .and_then(|phone| phone.get("mobileMode"))
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false)
}

#[cfg(desktop)]
fn power_assertion_arguments(target_pid: u32, on_ac_only: bool) -> Vec<String> {
    vec![
        if on_ac_only { "-s" } else { "-i" }.to_string(),
        "-w".to_string(),
        target_pid.to_string(),
    ]
}

#[cfg(all(desktop, target_os = "macos"))]
fn spawn_power_assertion(target_pid: u32, on_ac_only: bool) -> std::io::Result<Child> {
    Command::new("/usr/bin/caffeinate")
        .args(power_assertion_arguments(target_pid, on_ac_only))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(desktop)]
fn serve_arguments(port: u16) -> [String; 3] {
    [
        "serve".to_string(),
        "--bg".to_string(),
        format!("http://127.0.0.1:{port}"),
    ]
}

#[cfg(all(desktop, target_os = "macos"))]
fn tailscale_binary() -> PathBuf {
    if let Some(explicit) = std::env::var_os("TAILSCALE_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return path;
        }
    }
    [
        "/Applications/Tailscale.app/Contents/MacOS/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/usr/bin/tailscale",
        "/bin/tailscale",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
    .unwrap_or_else(|| PathBuf::from("tailscale"))
}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn repair_tailscale_serve_for_port(port: u16) {
    if !mobile_mode_enabled() {
        return;
    }
    thread::spawn(move || {
        let args = serve_arguments(port);
        match Command::new(tailscale_binary())
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
        {
            Ok(output) if output.status.success() => {
                log::info!("[cave] Tailscale Serve points at 127.0.0.1:{port}");
            }
            Ok(output) => {
                let detail = String::from_utf8_lossy(&output.stderr);
                log::warn!(
                    "[cave] could not repair Tailscale Serve for port {port}: {}",
                    detail.trim()
                );
            }
            Err(error) => {
                log::warn!(
                    "[cave] could not launch Tailscale Serve repair for port {port}: {error}"
                );
            }
        }
    });
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn repair_tailscale_serve_for_port(_port: u16) {}

#[cfg(desktop)]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(desktop)]
fn launch_agent_plist(executable: &Path, stdout_path: &Path, stderr_path: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{executable}</string>
    <string>--cave-sidecar-daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>30</integer>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>{stdout}</string>
  <key>StandardErrorPath</key>
  <string>{stderr}</string>
</dict>
</plist>
"#,
        label = LAUNCH_AGENT_LABEL,
        executable = xml_escape(&executable.to_string_lossy()),
        stdout = xml_escape(&stdout_path.to_string_lossy()),
        stderr = xml_escape(&stderr_path.to_string_lossy()),
    )
}

#[cfg(desktop)]
fn launch_agent_path_for(home: &Path) -> PathBuf {
    home.join("Library")
        .join("LaunchAgents")
        .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
}

#[cfg(desktop)]
fn write_launch_agent_file(path: &Path, plist: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "LaunchAgents path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let temp = path.with_extension(format!("plist.tmp-{}", std::process::id()));
    std::fs::write(&temp, plist)
        .map_err(|error| format!("could not write {}: {error}", temp.display()))?;
    std::fs::rename(&temp, path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[cfg(desktop)]
fn remove_launch_agent_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", path.display())),
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is unavailable".to_string())?;
    Ok(launch_agent_path_for(Path::new(&home)))
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_domain() -> Result<String, String> {
    let output = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|error| format!("could not determine macOS user id: {error}"))?;
    if !output.status.success() {
        return Err("could not determine macOS user id".to_string());
    }
    Ok(format!(
        "gui/{}",
        String::from_utf8_lossy(&output.stdout).trim()
    ))
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_service() -> Result<String, String> {
    Ok(format!("{}/{}", launch_agent_domain()?, LAUNCH_AGENT_LABEL))
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_launchctl(args: &[&str]) -> Result<(), String> {
    let output = Command::new("/bin/launchctl")
        .args(args)
        .output()
        .map_err(|error| format!("could not run launchctl: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[cfg(all(desktop, target_os = "macos"))]
fn bootout_launch_agent() {
    if let Ok(service) = launch_agent_service() {
        let _ = run_launchctl(&["bootout", &service]);
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn install_launch_agent(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("could not resolve app resources: {error}"))?;
    if !resource_dir
        .join("resources")
        .join("server")
        .join("server.mjs")
        .is_file()
    {
        return Err(
            "Background availability requires a packaged CovenCave build with server.mjs."
                .to_string(),
        );
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("could not resolve CovenCave executable: {error}"))?;
    let log_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is unavailable".to_string())?
        .join("Library")
        .join("Logs")
        .join("CovenCave");
    std::fs::create_dir_all(&log_dir)
        .map_err(|error| format!("could not create {}: {error}", log_dir.display()))?;
    let plist_path = launch_agent_path()?;
    let plist = launch_agent_plist(
        &executable,
        &log_dir.join("sidecar-daemon.out.log"),
        &log_dir.join("sidecar-daemon.err.log"),
    );
    write_launch_agent_file(&plist_path, &plist)?;

    bootout_launch_agent();
    let domain = launch_agent_domain()?;
    let plist_arg = plist_path.to_string_lossy().into_owned();
    run_launchctl(&["bootstrap", &domain, &plist_arg])
        .map_err(|error| format!("could not load background availability: {error}"))
}

#[cfg(all(desktop, target_os = "macos"))]
fn uninstall_launch_agent() -> Result<(), String> {
    bootout_launch_agent();
    remove_launch_agent_file(&launch_agent_path()?)
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_installed() -> bool {
    launch_agent_path().is_ok_and(|path| path.is_file())
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn launch_agent_installed() -> bool {
    false
}

#[cfg(all(desktop, target_os = "macos"))]
fn app_data_path_without_handle() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is unavailable".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join(LAUNCH_AGENT_LABEL))
}

#[cfg(all(desktop, target_os = "macos"))]
fn process_is_running(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(all(desktop, target_os = "macos"))]
fn gui_is_active(app_data_dir: &Path) -> bool {
    let marker = app_data_dir.join(GUI_ACTIVE_FILE);
    let pid = std::fs::read_to_string(&marker)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("pid").and_then(serde_json::Value::as_u64))
        .and_then(|pid| u32::try_from(pid).ok());
    match pid {
        Some(pid) if process_is_running(pid) => true,
        _ => {
            let _ = std::fs::remove_file(marker);
            false
        }
    }
}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn prepare_gui_reachability(app: &tauri::AppHandle) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = app_data_dir.join(GUI_ACTIVE_FILE);
    if let Err(error) =
        write_private_json(&marker, &serde_json::json!({ "pid": std::process::id() }))
    {
        log::warn!("[cave] could not mark desktop GUI active: {error}");
    }

    let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
    let config = read_reachability_config(&config_path);
    if config.daemon_mode {
        if let Err(error) = install_launch_agent(app) {
            log::warn!("[cave] could not reconcile background availability: {error}");
        }
        if let Ok(service) = launch_agent_service() {
            let _ = run_launchctl(&["kill", "SIGTERM", &service]);
        }
    } else if launch_agent_installed() {
        if let Err(error) = uninstall_launch_agent() {
            log::warn!("[cave] could not remove disabled background availability: {error}");
        }
    }
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn prepare_gui_reachability(_app: &tauri::AppHandle) {}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn handoff_to_background_daemon(app: &tauri::AppHandle) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::remove_file(app_data_dir.join(GUI_ACTIVE_FILE));
    let config = read_reachability_config(&app_data_dir.join(REACHABILITY_CONFIG_FILE));
    if !config.daemon_mode {
        return;
    }
    if let Err(error) = install_launch_agent(app) {
        log::warn!("[cave] could not load background availability: {error}");
        return;
    }
    if let Ok(service) = launch_agent_service() {
        if let Err(error) = run_launchctl(&["kickstart", "-k", &service]) {
            log::warn!("[cave] could not start background availability: {error}");
        }
    }
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn handoff_to_background_daemon(_app: &tauri::AppHandle) {}

#[cfg(desktop)]
pub(super) fn sidecar_reachability_ready(app: &tauri::AppHandle, port: u16, pid: u32) {
    repair_tailscale_serve_for_port(port);
    let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() else {
        return;
    };
    runtime.set_target_pid(pid);
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    runtime.start_monitor(
        app_data_dir.join(REACHABILITY_CONFIG_FILE),
        paired_phone_path(),
    );
}

#[cfg(desktop)]
pub(super) fn sidecar_reachability_stopped(app: &tauri::AppHandle) {
    let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() else {
        return;
    };
    runtime.clear_target_pid();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        runtime.reconcile_power(
            &app_data_dir.join(REACHABILITY_CONFIG_FILE),
            &paired_phone_path(),
        );
    }
}

#[cfg(desktop)]
fn status_for_app(app: &tauri::AppHandle) -> Result<DesktopReachabilityStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data: {error}"))?;
    let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
    let config = read_reachability_config(&config_path);
    let runtime = app.try_state::<Arc<DesktopReachabilityRuntime>>();
    Ok(DesktopReachabilityStatus {
        supported: cfg!(target_os = "macos"),
        config,
        paired_phone_seen: paired_phone_seen(&paired_phone_path()),
        launch_agent_installed: launch_agent_installed(),
        prevent_sleep_active: runtime
            .as_ref()
            .is_some_and(|runtime| runtime.power_active()),
        detail: if cfg!(target_os = "macos") {
            None
        } else {
            Some("Desktop reachability controls are available in the macOS app.".to_string())
        },
    })
}

#[cfg(desktop)]
#[tauri::command]
pub(super) fn desktop_reachability_status(
    app: tauri::AppHandle,
) -> Result<DesktopReachabilityStatus, String> {
    status_for_app(&app)
}

#[cfg(desktop)]
#[tauri::command]
pub(super) fn desktop_reachability_configure(
    app: tauri::AppHandle,
    config: DesktopReachabilityConfig,
) -> Result<DesktopReachabilityStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("could not resolve app data: {error}"))?;
        let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
        let previous = read_reachability_config(&config_path);
        write_private_json(&config_path, &config)?;
        let launch_agent_result = if config.daemon_mode {
            install_launch_agent(&app)
        } else {
            uninstall_launch_agent()
        };
        if let Err(error) = launch_agent_result {
            let _ = write_private_json(&config_path, &previous);
            return Err(error);
        }
        if let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() {
            runtime.reconcile_power(&config_path, &paired_phone_path());
        }
        return status_for_app(&app);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = config;
        status_for_app(&app)
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn daemon_resource_dir(executable: &Path) -> Result<PathBuf, String> {
    let macos_dir = executable
        .parent()
        .ok_or_else(|| "daemon executable has no parent".to_string())?;
    let contents = macos_dir
        .parent()
        .ok_or_else(|| "daemon executable is not inside an app bundle".to_string())?;
    let resources = contents.join("Resources");
    if !resources.is_dir() {
        return Err(format!(
            "packaged resource directory is missing at {}",
            resources.display()
        ));
    }
    Ok(resources)
}

#[cfg(all(desktop, target_os = "macos"))]
fn daemon_port() -> Result<u16, String> {
    for port in 3000..=3010 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    find_free_port().ok_or_else(|| "no free loopback port is available".to_string())
}

#[cfg(all(desktop, target_os = "macos"))]
fn append_log_file(path: &Path) -> Option<std::fs::File> {
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

#[cfg(all(desktop, target_os = "macos"))]
fn daemon_augmented_path(node: &Path) -> String {
    let mut directories = Vec::new();
    if let Some(directory) = node.parent() {
        directories.push(directory.to_path_buf());
    }
    if let Some(coven) = find_coven() {
        if let Some(directory) = coven.parent() {
            directories.push(directory.to_path_buf());
        }
    }
    directories.extend(
        std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .unwrap_or_else(|| {
                vec![
                    PathBuf::from("/usr/bin"),
                    PathBuf::from("/bin"),
                    PathBuf::from("/usr/sbin"),
                    PathBuf::from("/sbin"),
                ]
            }),
    );
    std::env::join_paths(directories)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_sidecar_daemon() -> Result<i32, String> {
    let app_data_dir = app_data_path_without_handle()?;
    let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
    let config = read_reachability_config(&config_path);
    if !config.daemon_mode || gui_is_active(&app_data_dir) {
        return Ok(0);
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("could not resolve daemon executable: {error}"))?;
    let resource_dir = daemon_resource_dir(&executable)?;
    let server_dir = resource_dir.join("resources").join("server");
    let server_entry = server_dir.join("server.mjs");
    if !server_entry.is_file() {
        return Err(format!(
            "server.mjs is missing at {}",
            server_entry.display()
        ));
    }
    let node = find_node(&resource_dir)
        .ok_or_else(|| "packaged Node.js runtime is unavailable".to_string())?;
    let port = daemon_port()?;
    let auth_token = sidecar_auth_token();
    let mobile_access_token =
        load_or_create_mobile_access_token(&app_data_dir.join(MOBILE_ACCESS_TOKEN_FILE));
    let log_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is unavailable".to_string())?
        .join("Library")
        .join("Logs")
        .join("CovenCave");
    std::fs::create_dir_all(&log_dir)
        .map_err(|error| format!("could not create {}: {error}", log_dir.display()))?;
    let server_log = log_dir.join("sidecar-daemon-server.log");
    let stdout = append_log_file(&server_log);
    let stderr = stdout.as_ref().and_then(|file| file.try_clone().ok());

    let mut command = Command::new(&node);
    command
        .arg(&server_entry)
        .current_dir(&server_dir)
        .env("PATH", daemon_augmented_path(&node))
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("COVEN_CAVE_BUNDLE", "1")
        .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
        .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token)
        .stdin(Stdio::null());
    if let Some(stdout) = stdout {
        command.stdout(Stdio::from(stdout));
    } else {
        command.stdout(Stdio::null());
    }
    if let Some(stderr) = stderr {
        command.stderr(Stdio::from(stderr));
    } else {
        command.stderr(Stdio::null());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start background sidecar: {error}"))?;
    let child_pid = child.id();
    match wait_for_sidecar_ready(port, &server_log, Duration::from_secs(30), || {
        gui_is_active(&app_data_dir)
    }) {
        PortWaitResult::Ready => {}
        PortWaitResult::Cancelled => {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(0);
        }
        PortWaitResult::TimedOut => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "background sidecar did not become ready on port {port}"
            ));
        }
    }

    write_private_json(
        &app_data_dir.join(DAEMON_STATE_FILE),
        &serde_json::json!({ "pid": child_pid, "port": port }),
    )?;
    repair_tailscale_serve_for_port(port);

    let mut assertion: Option<PowerAssertion> = None;
    let mut last_serve_repair = Instant::now();
    loop {
        if gui_is_active(&app_data_dir) || !read_reachability_config(&config_path).daemon_mode {
            let _ = child.kill();
            let _ = child.wait();
            if let Some(mut assertion) = assertion.take() {
                let _ = assertion.child.kill();
                let _ = assertion.child.wait();
            }
            let _ = std::fs::remove_file(app_data_dir.join(DAEMON_STATE_FILE));
            return Ok(0);
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("could not inspect background sidecar: {error}"))?
        {
            let _ = std::fs::remove_file(app_data_dir.join(DAEMON_STATE_FILE));
            return Ok(status.code().unwrap_or(1));
        }

        let current = read_reachability_config(&config_path);
        let desired_power = current.prevent_sleep
            && mobile_mode_enabled()
            && paired_phone_seen(&paired_phone_path());
        if let Some(active) = assertion.as_mut() {
            let exited = active.child.try_wait().ok().flatten().is_some();
            if !desired_power || exited || active.on_ac_only != current.prevent_sleep_on_ac_only {
                let _ = active.child.kill();
                let _ = active.child.wait();
                assertion = None;
            }
        }
        if desired_power && assertion.is_none() {
            if let Ok(power_child) =
                spawn_power_assertion(child_pid, current.prevent_sleep_on_ac_only)
            {
                assertion = Some(PowerAssertion {
                    child: power_child,
                    on_ac_only: current.prevent_sleep_on_ac_only,
                });
            }
        }

        if last_serve_repair.elapsed() >= SERVE_REPAIR_INTERVAL {
            repair_tailscale_serve_for_port(port);
            last_serve_repair = Instant::now();
        }
        thread::sleep(POWER_MONITOR_INTERVAL);
    }
}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn run_sidecar_daemon_if_requested() -> Option<i32> {
    if !std::env::args().any(|arg| arg == "--cave-sidecar-daemon") {
        return None;
    }
    Some(match run_sidecar_daemon() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("[cave] background sidecar failed: {error}");
            1
        }
    })
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn run_sidecar_daemon_if_requested() -> Option<i32> {
    None
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn reachability_defaults_are_opt_in_with_ac_only_ready() {
        assert_eq!(
            DesktopReachabilityConfig::default(),
            DesktopReachabilityConfig {
                prevent_sleep: false,
                prevent_sleep_on_ac_only: true,
                daemon_mode: false,
            }
        );
    }

    #[test]
    fn caffeinate_policy_uses_system_assertion_on_ac_and_idle_assertion_on_battery() {
        assert_eq!(power_assertion_arguments(42, true), ["-s", "-w", "42"]);
        assert_eq!(power_assertion_arguments(42, false), ["-i", "-w", "42"]);
    }

    #[test]
    fn launch_agent_is_background_retryable_and_runs_the_daemon_entrypoint() {
        let plist = launch_agent_plist(
            Path::new("/Applications/Coven&Cave.app/Contents/MacOS/CovenCave"),
            Path::new("/tmp/cave.out"),
            Path::new("/tmp/cave.err"),
        );
        assert!(plist.contains("<string>ai.opencoven.cave</string>"));
        assert!(plist.contains("<string>--cave-sidecar-daemon</string>"));
        assert!(plist.contains("<key>StartInterval</key>"));
        assert!(plist.contains("<key>SuccessfulExit</key>"));
        assert!(plist.contains("Coven&amp;Cave.app"));
    }

    #[test]
    fn launch_agent_file_installs_and_removes_idempotently() {
        let home = std::env::temp_dir().join(format!(
            "coven-launch-agent-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let path = launch_agent_path_for(&home);
        write_launch_agent_file(&path, "<plist/>").expect("install launch agent file");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read launch agent file"),
            "<plist/>"
        );
        remove_launch_agent_file(&path).expect("remove launch agent file");
        remove_launch_agent_file(&path).expect("removing a missing launch agent stays safe");
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn serve_repair_targets_the_actual_loopback_port() {
        assert_eq!(
            serve_arguments(3007),
            [
                "serve".to_string(),
                "--bg".to_string(),
                "http://127.0.0.1:3007".to_string(),
            ]
        );
    }
}
