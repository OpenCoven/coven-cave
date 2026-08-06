#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::*;

#[cfg(all(desktop, target_os = "macos"))]
use fs2::FileExt;
#[cfg(desktop)]
use serde::{Deserialize, Serialize};
#[cfg(all(desktop, target_os = "macos"))]
use std::io::Read;
#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
#[cfg(all(desktop, target_os = "macos"))]
use std::sync::OnceLock;

#[cfg(desktop)]
const REACHABILITY_CONFIG_FILE: &str = "desktop-reachability.json";
#[cfg(desktop)]
const GUI_ACTIVE_FILE: &str = "desktop-gui-active.json";
#[cfg(desktop)]
const DAEMON_STATE_FILE: &str = "desktop-daemon-state.json";
#[cfg(all(desktop, target_os = "macos"))]
const OWNERSHIP_LOCK_FILE: &str = "desktop-reachability-ownership.lock";
#[cfg(desktop)]
const LAUNCH_AGENT_LABEL: &str = "ai.opencoven.cave";
#[cfg(desktop)]
const MOBILE_PAIRED_FILE: &str = "mobile-paired.json";
#[cfg(desktop)]
const POWER_MONITOR_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(desktop)]
const SERVE_REPAIR_INTERVAL: Duration = Duration::from_secs(30);
#[cfg(all(desktop, target_os = "macos"))]
const SERVE_REPAIR_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg(desktop)]
const DAEMON_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(all(desktop, target_os = "macos"))]
static DAEMON_SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

#[cfg(all(desktop, target_os = "macos"))]
static SERVE_REPAIR_STATE: OnceLock<Mutex<ServeRepairState>> = OnceLock::new();

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
    background_availability_supported: bool,
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
#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProcessLease {
    pid: u32,
    identity: String,
}

#[cfg(desktop)]
#[derive(Clone, Debug, Deserialize, Serialize)]
struct DaemonSidecarState {
    #[serde(flatten)]
    lease: ProcessLease,
    port: u16,
}

/// The GUI marker is also the recovery record for its independently spawned
/// Node child.  A force-quit can leave that child alive after the GUI process
/// has gone away, so the daemon must be able to identity-check and reap it
/// before selecting a fallback port.
#[cfg(desktop)]
#[derive(Clone, Debug, Deserialize, Serialize)]
struct GuiOwnershipState {
    #[serde(flatten)]
    lease: ProcessLease,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sidecar: Option<DaemonSidecarState>,
}

#[cfg(desktop)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TailscaleServeMode {
    Https,
    Http(u16),
}

#[cfg(all(desktop, target_os = "macos"))]
#[derive(Default)]
struct ServeRepairState {
    running: bool,
    pending_port: Option<u16>,
}

/// An advisory lock shared by GUI startup and the launchd daemon. Holding it
/// from the last GUI-marker check through daemon-state persistence prevents an
/// unrecorded daemon child from racing a newly-started GUI sidecar.
#[cfg(all(desktop, target_os = "macos"))]
struct ReachabilityOwnershipLease {
    file: std::fs::File,
}

#[cfg(all(desktop, target_os = "macos"))]
impl Drop for ReachabilityOwnershipLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
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

    fn start_monitor(
        self: &Arc<Self>,
        app: tauri::AppHandle,
        config_path: PathBuf,
        paired_path: PathBuf,
    ) {
        if self.monitor_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = Arc::downgrade(self);
        thread::spawn(move || loop {
            let Some(runtime) = runtime.upgrade() else {
                break;
            };
            runtime.reconcile_power(&app, &config_path, &paired_path);
            drop(runtime);
            thread::sleep(POWER_MONITOR_INTERVAL);
        });
    }

    fn reconcile_power(&self, app: &tauri::AppHandle, config_path: &Path, paired_path: &Path) {
        #[cfg(target_os = "macos")]
        {
            let config = read_reachability_config(config_path);
            let paired = paired_phone_seen(paired_path);
            let target_pid = self
                .target_pid()
                .filter(|pid| owned_sidecar_is_live(app, *pid));
            if target_pid.is_none() {
                self.clear_target_pid();
            }
            let desired = config.prevent_sleep
                && paired
                && mobile_mode_enabled()
                && target_pid.is_some()
                && power_assertion_is_effective(
                    config.prevent_sleep_on_ac_only,
                    mac_is_on_ac_power(),
                );
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
            let _ = (app, config_path, paired_path);
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
        #[cfg(target_os = "macos")]
        if current.on_ac_only && !mac_is_on_ac_power() {
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
fn launch_agent_reconciliation_required(
    previous: &DesktopReachabilityConfig,
    next: &DesktopReachabilityConfig,
) -> bool {
    previous.daemon_mode != next.daemon_mode
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

#[cfg(all(desktop, target_os = "macos"))]
fn acquire_reachability_ownership_lease(
    app_data_dir: &Path,
) -> Result<ReachabilityOwnershipLease, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("could not create {}: {error}", app_data_dir.display()))?;
    let path = app_data_dir.join(OWNERSHIP_LOCK_FILE);
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    file.lock_exclusive()
        .map_err(|error| format!("could not acquire reachability ownership: {error}"))?;
    Ok(ReachabilityOwnershipLease { file })
}

#[cfg(desktop)]
fn mobile_mode_enabled() -> bool {
    let path = cave_home_path().join("preferences.json");
    let raw = std::fs::read_to_string(path).ok();
    mobile_mode_enabled_from_preferences(raw.as_deref())
}

#[cfg(desktop)]
fn mobile_mode_enabled_from_preferences(raw: Option<&str>) -> bool {
    raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("phone")
                .and_then(|phone| phone.get("mobileMode"))
                .and_then(serde_json::Value::as_bool)
        })
        // Match the preference schema: mobile mode is enabled until the user
        // explicitly persists it as false.
        .unwrap_or(true)
}

#[cfg(desktop)]
fn power_assertion_arguments(target_pid: u32, on_ac_only: bool) -> Vec<String> {
    vec![
        if on_ac_only { "-s" } else { "-i" }.to_string(),
        "-w".to_string(),
        target_pid.to_string(),
    ]
}

#[cfg(desktop)]
fn power_assertion_is_effective(on_ac_only: bool, on_ac_power: bool) -> bool {
    !on_ac_only || on_ac_power
}

#[cfg(all(desktop, target_os = "macos"))]
fn mac_is_on_ac_power() -> bool {
    Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).contains("AC Power"))
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

#[cfg(desktop)]
fn http_serve_arguments(port: u16, http_port: u16) -> [String; 4] {
    [
        "serve".to_string(),
        "--bg".to_string(),
        format!("--http={http_port}"),
        format!("http://127.0.0.1:{port}"),
    ]
}

#[cfg(desktop)]
fn serve_mode_from_status(status: &serde_json::Value) -> Option<TailscaleServeMode> {
    let web = status.get("Web")?.as_object()?;
    if web.is_empty() {
        return None;
    }
    let http_port = status
        .get("TCP")
        .and_then(serde_json::Value::as_object)
        .and_then(|tcp| {
            tcp.iter().find_map(|(port, config)| {
                (config.get("HTTP").and_then(serde_json::Value::as_bool) == Some(true))
                    .then(|| port.parse::<u16>().ok())
                    .flatten()
            })
        })
        .or_else(|| {
            web.keys().find_map(|host| {
                host.rsplit_once(':')
                    .and_then(|(_, port)| port.parse::<u16>().ok())
                    .filter(|port| *port != 443)
            })
        });
    Some(match http_port {
        Some(port) => TailscaleServeMode::Http(port),
        None => TailscaleServeMode::Https,
    })
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
    // The desktop must never adopt an arbitrary user-managed Serve route just
    // because mobile mode has its schema default. A paired-device heartbeat is
    // the persisted proof that this Cave has actually exposed a phone route.
    if !mobile_mode_enabled() || !paired_phone_seen(&paired_phone_path()) {
        return;
    }
    let state = SERVE_REPAIR_STATE.get_or_init(|| Mutex::new(ServeRepairState::default()));
    let should_spawn = {
        let mut state = match state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.pending_port = Some(port);
        if state.running {
            false
        } else {
            state.running = true;
            true
        }
    };
    if should_spawn {
        thread::spawn(run_queued_tailscale_serve_repairs);
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_queued_tailscale_serve_repairs() {
    let state = SERVE_REPAIR_STATE.get_or_init(|| Mutex::new(ServeRepairState::default()));
    loop {
        let port = {
            let mut state = match state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            match state.pending_port.take() {
                Some(port) => port,
                None => {
                    state.running = false;
                    return;
                }
            }
        };
        run_tailscale_serve_repair(port);
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_tailscale_serve_repair(port: u16) {
    let status_args = [
        "serve".to_string(),
        "status".to_string(),
        "--json".to_string(),
    ];
    let mode = match run_tailscale_command(&status_args) {
        Ok(output) if output.status.success() => serde_json::from_slice(&output.stdout)
            .ok()
            .and_then(|status| serve_mode_from_status(&status)),
        Ok(output) => {
            log::warn!(
                "[cave] could not inspect Tailscale Serve before repairing port {port}: exited with {}",
                output.status
            );
            None
        }
        Err(error) => {
            log::warn!(
                "[cave] could not inspect Tailscale Serve before repairing port {port}: {error}"
            );
            None
        }
    };
    let Some(mode) = mode else {
        // There is no paired Serve route to repair. Avoid creating an HTTPS
        // listener that could overwrite an unavailable or managed fallback.
        return;
    };
    let args = match mode {
        TailscaleServeMode::Https => serve_arguments(port).to_vec(),
        TailscaleServeMode::Http(http_port) => http_serve_arguments(port, http_port).to_vec(),
    };
    match run_tailscale_command(&args) {
        Ok(output) if output.status.success() => {
            log::info!("[cave] Tailscale Serve points at 127.0.0.1:{port}");
        }
        Ok(output) => {
            log::warn!(
                "[cave] could not repair Tailscale Serve for port {port}: exited with {}",
                output.status
            );
        }
        Err(error) => {
            log::warn!("[cave] could not repair Tailscale Serve for port {port}: {error}");
        }
    }
}

#[cfg(all(desktop, target_os = "macos"))]
struct TailscaleCommandOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_tailscale_command(args: &[String]) -> Result<TailscaleCommandOutput, String> {
    let command_name = args.join(" ");
    let mut child = Command::new(tailscale_binary())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not launch Tailscale {command_name}: {error}"))?;
    let stdout = child.stdout.take().map(|mut stdout| {
        thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout.read_to_end(&mut output);
            output
        })
    });
    let deadline = Instant::now() + SERVE_REPAIR_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                return Ok(TailscaleCommandOutput { status, stdout });
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(reader) = stdout {
                    let _ = reader.join();
                }
                return Err(format!(
                    "Tailscale {command_name} timed out after {}s",
                    SERVE_REPAIR_TIMEOUT.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(reader) = stdout {
                    let _ = reader.join();
                }
                return Err(format!(
                    "could not wait for Tailscale {command_name}: {error}"
                ));
            }
        }
    }
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
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>AbandonProcessGroup</key>
  <false/>
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
fn bootout_launch_agent() -> Result<(), String> {
    let domain = launch_agent_domain()?;
    let plist_path = launch_agent_path()?;
    let plist_arg = plist_path.to_string_lossy().into_owned();
    match run_launchctl(&["bootout", &domain, &plist_arg]) {
        Ok(()) => Ok(()),
        // A missing service is normal on first install and after a clean
        // handoff. All other launchd failures are ownership failures: do not
        // start another sidecar until the caller can report/retry them.
        Err(error)
            if error.contains("Could not find service")
                || error.contains("No such process")
                || error.contains("No such file")
                || error.contains("not found") =>
        {
            Ok(())
        }
        Err(error) => Err(format!("could not unload background availability: {error}")),
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn install_launch_agent(app: &tauri::AppHandle, app_data_dir: &Path) -> Result<(), String> {
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
    // Development binaries can have staged resources but cannot execute as a
    // LaunchAgent. Validate the exact bundle layout before creating a plist.
    daemon_resource_dir(&executable)?;
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
    stop_recorded_daemon_sidecar(app_data_dir)?;
    bootout_launch_agent()?;
    write_launch_agent_file(&plist_path, &plist)?;
    let domain = launch_agent_domain()?;
    let plist_arg = plist_path.to_string_lossy().into_owned();
    if let Err(error) = run_launchctl(&["bootstrap", &domain, &plist_arg]) {
        let _ = remove_launch_agent_file(&plist_path);
        return Err(format!("could not load background availability: {error}"));
    }
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
fn uninstall_launch_agent(app_data_dir: &Path) -> Result<(), String> {
    stop_recorded_daemon_sidecar(app_data_dir)?;
    bootout_launch_agent()?;
    remove_launch_agent_file(&launch_agent_path()?)
}

#[cfg(all(desktop, target_os = "macos"))]
fn suspend_background_launch_agent(app_data_dir: &Path) -> Result<(), String> {
    stop_recorded_daemon_sidecar(app_data_dir)?;
    if launch_agent_installed() {
        bootout_launch_agent()?;
    }
    Ok(())
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
fn gui_is_active(app_data_dir: &Path) -> bool {
    read_gui_ownership_state(app_data_dir).is_some_and(|state| {
        lease_matches(&state.lease, process_identity(state.lease.pid).as_deref())
    })
}

#[cfg(all(desktop, target_os = "macos"))]
fn read_gui_ownership_state(app_data_dir: &Path) -> Option<GuiOwnershipState> {
    std::fs::read_to_string(app_data_dir.join(GUI_ACTIVE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<GuiOwnershipState>(&raw).ok())
}

#[cfg(all(desktop, target_os = "macos"))]
fn write_gui_ownership_state(app_data_dir: &Path, state: &GuiOwnershipState) -> Result<(), String> {
    write_private_json(&app_data_dir.join(GUI_ACTIVE_FILE), state)
}

#[cfg(all(desktop, target_os = "macos"))]
fn remove_gui_ownership_if_owned(app_data_dir: &Path, owner: &ProcessLease) {
    if read_gui_ownership_state(app_data_dir)
        .is_some_and(|state| state.lease.pid == owner.pid && state.lease.identity == owner.identity)
    {
        let _ = std::fs::remove_file(app_data_dir.join(GUI_ACTIVE_FILE));
    }
}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn prepare_gui_reachability(app: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data: {error}"))?;
    let _ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
    let current_gui = current_process_lease()?;
    if let Some(existing) = read_gui_ownership_state(&app_data_dir) {
        if lease_matches(
            &existing.lease,
            process_identity(existing.lease.pid).as_deref(),
        ) && existing.lease.pid != current_gui.pid
        {
            return Err("another CovenCave GUI already owns desktop reachability".to_string());
        }
        if existing.lease.pid == current_gui.pid && existing.lease.identity == current_gui.identity
        {
            // Setup can be re-entered during macOS lifecycle restoration. Keep
            // this GUI's existing sidecar lease rather than replacing it.
        } else {
            stop_recorded_gui_sidecar(&app_data_dir)?;
            write_gui_ownership_state(
                &app_data_dir,
                &GuiOwnershipState {
                    lease: current_gui.clone(),
                    sidecar: None,
                },
            )?;
        }
    } else {
        write_gui_ownership_state(
            &app_data_dir,
            &GuiOwnershipState {
                lease: current_gui.clone(),
                sidecar: None,
            },
        )?;
    }

    let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
    let config = read_reachability_config(&config_path);
    if config.daemon_mode {
        if background_availability_supported() {
            install_launch_agent(app, &app_data_dir)?;
        } else {
            // A development executable cannot be launched by launchd. Preserve
            // the user's packaged-build opt-in, but stop any old packaged
            // daemon before this GUI sidecar takes ownership.
            suspend_background_launch_agent(&app_data_dir)?;
            log::info!(
                "[cave] background availability is unavailable in this development build; preserving its saved setting"
            );
        }
    } else if launch_agent_installed() {
        uninstall_launch_agent(&app_data_dir)?;
    }
    Ok(())
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn prepare_gui_reachability(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn handoff_to_background_daemon(app: &tauri::AppHandle) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(_ownership) = acquire_reachability_ownership_lease(&app_data_dir) else {
        log::warn!("[cave] could not acquire reachability ownership for daemon handoff");
        return;
    };
    let config = read_reachability_config(&app_data_dir.join(REACHABILITY_CONFIG_FILE));
    if !config.daemon_mode || !background_availability_supported() {
        if let Ok(owner) = current_process_lease() {
            remove_gui_ownership_if_owned(&app_data_dir, &owner);
        }
        return;
    }

    if !launch_agent_installed() {
        // Keep the marker in place until launchd has started its wrapper. That
        // wrapper then waits rather than racing the GUI's teardown to spawn a
        // second sidecar.
        if let Err(error) = install_launch_agent(app, &app_data_dir) {
            log::warn!("[cave] could not load background availability: {error}");
            return;
        }
    }
    if let Ok(owner) = current_process_lease() {
        remove_gui_ownership_if_owned(&app_data_dir, &owner);
    }
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn handoff_to_background_daemon(_app: &tauri::AppHandle) {}

#[cfg(desktop)]
pub(super) fn sidecar_reachability_ready(app: &tauri::AppHandle, port: u16, pid: u32) {
    #[cfg(target_os = "macos")]
    if let Err(error) = record_gui_sidecar(app, pid, port) {
        log::warn!("[cave] could not record GUI sidecar ownership: {error}");
    }
    repair_tailscale_serve_for_port(port);
    let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() else {
        return;
    };
    runtime.set_target_pid(pid);
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    runtime.start_monitor(
        app.clone(),
        app_data_dir.join(REACHABILITY_CONFIG_FILE),
        paired_phone_path(),
    );
}

#[cfg(all(desktop, target_os = "macos"))]
#[repr(C)]
struct ProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [u8; 16],
    name: [u8; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    tdev: u32,
    tpgid: u32,
    nice: i32,
    start_seconds: u64,
    start_microseconds: u64,
}

#[cfg(all(desktop, target_os = "macos"))]
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidinfo(
        pid: std::os::raw::c_int,
        flavor: std::os::raw::c_int,
        arg: u64,
        buffer: *mut std::ffi::c_void,
        buffer_size: std::os::raw::c_int,
    ) -> std::os::raw::c_int;
}

#[cfg(all(desktop, target_os = "macos"))]
fn process_identity(pid: u32) -> Option<String> {
    // PROC_PIDTBSDINFO exposes the kernel-recorded birth timestamp with
    // microsecond precision. Unlike `ps -o lstart`, it cannot confuse a
    // process that reuses the same PID during the same wall-clock second.
    const PROC_PIDTBSDINFO: std::os::raw::c_int = 3;
    let mut info = std::mem::MaybeUninit::<ProcBsdInfo>::zeroed();
    let written = unsafe {
        proc_pidinfo(
            pid as std::os::raw::c_int,
            PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            std::mem::size_of::<ProcBsdInfo>() as std::os::raw::c_int,
        )
    };
    if written < std::mem::size_of::<ProcBsdInfo>() as std::os::raw::c_int {
        return None;
    }
    let info = unsafe { info.assume_init() };
    (info.pid == pid).then(|| format!("{}.{}", info.start_seconds, info.start_microseconds))
}

#[cfg(desktop)]
fn lease_matches(lease: &ProcessLease, current_identity: Option<&str>) -> bool {
    current_identity.is_some_and(|current| current == lease.identity)
}

#[cfg(all(desktop, target_os = "macos"))]
fn current_process_lease() -> Result<ProcessLease, String> {
    let pid = std::process::id();
    let identity = process_identity(pid)
        .ok_or_else(|| "could not establish the GUI process identity".to_string())?;
    Ok(ProcessLease { pid, identity })
}

#[cfg(all(desktop, target_os = "macos"))]
fn record_gui_sidecar(app: &tauri::AppHandle, pid: u32, port: u16) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data: {error}"))?;
    let _ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
    let owner = current_process_lease()?;
    let Some(mut state) = read_gui_ownership_state(&app_data_dir) else {
        return Err("GUI reachability ownership is missing".to_string());
    };
    if state.lease.pid != owner.pid || state.lease.identity != owner.identity {
        return Err("this GUI does not own desktop reachability".to_string());
    }
    let identity = process_identity(pid)
        .ok_or_else(|| "could not establish GUI sidecar identity".to_string())?;
    state.sidecar = Some(DaemonSidecarState {
        lease: ProcessLease { pid, identity },
        port,
    });
    write_gui_ownership_state(&app_data_dir, &state)
}

#[cfg(all(desktop, target_os = "macos"))]
fn clear_recorded_gui_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data: {error}"))?;
    let _ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
    let owner = current_process_lease()?;
    let Some(mut state) = read_gui_ownership_state(&app_data_dir) else {
        return Ok(());
    };
    if state.lease.pid != owner.pid || state.lease.identity != owner.identity {
        return Ok(());
    }
    state.sidecar = None;
    write_gui_ownership_state(&app_data_dir, &state)
}

#[cfg(all(desktop, target_os = "macos"))]
fn read_daemon_sidecar_state(app_data_dir: &Path) -> Option<DaemonSidecarState> {
    std::fs::read_to_string(app_data_dir.join(DAEMON_STATE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

#[cfg(all(desktop, target_os = "macos"))]
fn stop_recorded_sidecar(state_path: &Path, state: &DaemonSidecarState) -> Result<(), String> {
    if !lease_matches(&state.lease, process_identity(state.lease.pid).as_deref()) {
        let _ = std::fs::remove_file(state_path);
        return Ok(());
    }
    let pid = state.lease.pid.to_string();
    if let Err(error) = run_process_signal("TERM", &pid) {
        // A natural child exit can land between the identity check and TERM.
        // Treat that race as a successful cleanup, but never hide an error for
        // a still-live process that we verified as ours.
        if !lease_matches(&state.lease, process_identity(state.lease.pid).as_deref()) {
            let _ = std::fs::remove_file(state_path);
            return Ok(());
        }
        return Err(error);
    }
    if !wait_for_process_exit(&state.lease, DAEMON_STOP_TIMEOUT) {
        if let Err(error) = run_process_signal("KILL", &pid) {
            if !lease_matches(&state.lease, process_identity(state.lease.pid).as_deref()) {
                let _ = std::fs::remove_file(state_path);
                return Ok(());
            }
            return Err(error);
        }
        if !wait_for_process_exit(&state.lease, Duration::from_secs(1)) {
            return Err(format!(
                "background sidecar {} did not stop",
                state.lease.pid
            ));
        }
    }
    let _ = std::fs::remove_file(state_path);
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
fn stop_recorded_gui_sidecar(app_data_dir: &Path) -> Result<(), String> {
    let state_path = app_data_dir.join(GUI_ACTIVE_FILE);
    let Some(state) = read_gui_ownership_state(app_data_dir) else {
        return Ok(());
    };
    match state.sidecar {
        Some(sidecar) => stop_recorded_sidecar(&state_path, &sidecar),
        None => {
            let _ = std::fs::remove_file(state_path);
            Ok(())
        }
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn wait_for_process_exit(lease: &ProcessLease, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !lease_matches(lease, process_identity(lease.pid).as_deref()) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    !lease_matches(lease, process_identity(lease.pid).as_deref())
}

#[cfg(all(desktop, target_os = "macos"))]
fn run_process_signal(signal: &str, pid: &str) -> Result<(), String> {
    let output = Command::new("/bin/kill")
        .args(["-s", signal, pid])
        .output()
        .map_err(|error| format!("could not signal background sidecar: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "could not signal background sidecar: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn stop_recorded_daemon_sidecar(app_data_dir: &Path) -> Result<(), String> {
    let state_path = app_data_dir.join(DAEMON_STATE_FILE);
    let Some(state) = read_daemon_sidecar_state(app_data_dir) else {
        return Ok(());
    };
    stop_recorded_sidecar(&state_path, &state)
}

#[cfg(all(desktop, target_os = "macos"))]
fn owned_sidecar_is_live(app: &tauri::AppHandle, pid: u32) -> bool {
    let Some(state) = app.try_state::<SidecarState>() else {
        return false;
    };
    let mut sidecar = match state.0.lock() {
        Ok(sidecar) => sidecar,
        Err(_) => return false,
    };
    match sidecar.as_mut() {
        Some(process) => match process.is_live_with_pid(pid) {
            Ok(live) => live,
            Err(error) => {
                log::warn!("[cave] could not verify reachability sidecar ownership: {error}");
                false
            }
        },
        None => false,
    }
}

#[cfg(desktop)]
pub(super) fn sidecar_reachability_stopped(app: &tauri::AppHandle) {
    let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() else {
        return;
    };
    runtime.clear_target_pid();
    #[cfg(target_os = "macos")]
    if let Err(error) = clear_recorded_gui_sidecar(app) {
        log::warn!("[cave] could not clear GUI sidecar ownership: {error}");
    }
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        runtime.reconcile_power(
            app,
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
        background_availability_supported: background_availability_supported(),
        config,
        paired_phone_seen: paired_phone_seen(&paired_phone_path()),
        launch_agent_installed: launch_agent_installed(),
        prevent_sleep_active: runtime
            .as_ref()
            .is_some_and(|runtime| runtime.power_active()),
        detail: if cfg!(target_os = "macos") && !background_availability_supported() {
            Some(
                "Background availability is available in packaged macOS builds; this development build preserves the saved setting."
                    .to_string(),
            )
        } else if cfg!(target_os = "macos") {
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
        // This covers the config write and launchd reconciliation together so
        // window teardown cannot hand off a daemon while a settings mutation
        // is rolling back its opt-in state.
        let _ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
        let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
        let previous = read_reachability_config(&config_path);
        write_private_json(&config_path, &config)?;
        // Sleep-policy changes do not alter the LaunchAgent. Avoid replacing a
        // healthy background service merely because an unrelated option was
        // toggled; this also preserves the prior service if launchd is
        // temporarily unavailable.
        let launch_agent_result = if !launch_agent_reconciliation_required(&previous, &config) {
            Ok(())
        } else if config.daemon_mode && background_availability_supported() {
            install_launch_agent(&app, &app_data_dir)
        } else if config.daemon_mode {
            suspend_background_launch_agent(&app_data_dir)
        } else {
            uninstall_launch_agent(&app_data_dir)
        };
        if let Err(error) = launch_agent_result {
            let _ = write_private_json(&config_path, &previous);
            let restore_result = if previous.daemon_mode && background_availability_supported() {
                install_launch_agent(&app, &app_data_dir)
            } else if previous.daemon_mode {
                suspend_background_launch_agent(&app_data_dir)
            } else {
                uninstall_launch_agent(&app_data_dir)
            };
            if let Err(restore_error) = restore_result {
                log::warn!(
                    "[cave] could not restore background availability after a failed settings change: {restore_error}"
                );
            }
            return Err(error);
        }
        if let Some(runtime) = app.try_state::<Arc<DesktopReachabilityRuntime>>() {
            runtime.reconcile_power(&app, &config_path, &paired_phone_path());
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
fn background_availability_supported() -> bool {
    !cfg!(debug_assertions)
        && std::env::current_exe()
            .ok()
            .is_some_and(|executable| daemon_resource_dir(&executable).is_ok())
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn background_availability_supported() -> bool {
    false
}

/// The background-availability daemon serves the SAME address the GUI does.
///
/// This is the point of the dedicated port. LaunchAgent mode is a handoff — the
/// GUI's sidecar exits and `server.mjs` keeps serving so paired phones stay
/// reachable — and a handoff that changes the port is not a handoff at all: the
/// phone's stored host stops resolving and `tailscale serve` is left pointing
/// at a loopback port nothing answers on. Previously the GUI took a random port
/// and this daemon scanned 3000..=3010, so the two essentially never agreed.
///
/// The old scan survives only as a last resort. Here, unlike the GUI path, not
/// starting is worse than moving: the GUI can show the user an error, whereas a
/// background daemon that refuses to bind leaves the phone silently unreachable
/// with nothing on screen to explain it. The fallback logs loudly, and the
/// serve-repair pass re-points Tailscale at whatever port was actually taken.
#[cfg(all(desktop, target_os = "macos"))]
fn daemon_port() -> Result<u16, String> {
    let dedicated = crate::sidecar_ports::dedicated_port();
    if TcpListener::bind(("127.0.0.1", dedicated)).is_ok() {
        return Ok(dedicated);
    }
    log::warn!(
        "[cave] dedicated port {dedicated} is occupied; the background daemon is falling back to \
         a scanned port, so paired phones depend on the Tailscale serve repair pass to follow it"
    );
    for port in 3000..=3010 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("no free loopback port is available".to_string())
}

#[cfg(all(desktop, target_os = "macos"))]
fn daemon_shutdown_requested() -> bool {
    DAEMON_SHUTDOWN_REQUESTED.load(Ordering::Acquire)
}

#[cfg(all(desktop, target_os = "macos"))]
fn install_daemon_shutdown_handler() -> Result<(), String> {
    DAEMON_SHUTDOWN_REQUESTED.store(false, Ordering::Release);
    for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        unsafe {
            signal_hook_registry::register(signal, || {
                DAEMON_SHUTDOWN_REQUESTED.store(true, Ordering::Release);
            })
        }
        .map_err(|error| format!("could not install daemon shutdown handler: {error}"))?;
    }
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
fn wait_for_daemon_activity(duration: Duration) {
    let deadline = Instant::now() + duration;
    while !daemon_shutdown_requested() && Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        thread::sleep(remaining.min(Duration::from_millis(100)));
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn stop_daemon_children(
    child: &mut std::process::Child,
    assertion: &mut Option<PowerAssertion>,
    state_path: &Path,
) {
    let _ = child.kill();
    let _ = child.wait();
    if let Some(mut assertion) = assertion.take() {
        let _ = assertion.child.kill();
        let _ = assertion.child.wait();
    }
    let _ = std::fs::remove_file(state_path);
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
    install_daemon_shutdown_handler()?;
    let app_data_dir = app_data_path_without_handle()?;
    let config_path = app_data_dir.join(REACHABILITY_CONFIG_FILE);
    if !read_reachability_config(&config_path).daemon_mode {
        return Ok(0);
    }
    // Keep one launchd wrapper alive while the GUI owns the server. This gives
    // crash recovery without StartInterval repeatedly launching app processes.
    while gui_is_active(&app_data_dir) {
        if daemon_shutdown_requested() {
            return Ok(0);
        }
        if !read_reachability_config(&config_path).daemon_mode {
            return Ok(0);
        }
        wait_for_daemon_activity(Duration::from_secs(1));
    }
    // A force-quit GUI or a previous daemon wrapper can leave Node alive. Both
    // ownership records are identity-checked and reaped before a restart can
    // select a fallback port.
    stop_recorded_gui_sidecar(&app_data_dir)?;
    stop_recorded_daemon_sidecar(&app_data_dir)?;

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
    let piper = bundled_piper_path(&resource_dir);
    if !piper.is_file() {
        return Err(format!(
            "bundled Piper runtime is unavailable at {}",
            piper.display()
        ));
    }
    let kokoro = bundled_kokoro_path(&resource_dir);
    if !kokoro.is_file() {
        return Err(format!(
            "bundled Kokoro runtime is unavailable at {}",
            kokoro.display()
        ));
    }
    let port = daemon_port()?;
    let auth_token = sidecar_auth_token();
    let mobile_access_token =
        load_or_create_mobile_access_token(&app_data_dir.join(MOBILE_ACCESS_TOKEN_FILE));
    let sidecar_output = Arc::new(Mutex::new(SidecarOutputTail::default()));

    let mut command = Command::new(&node);
    command
        .arg(&server_entry)
        .current_dir(&server_dir)
        .env("PATH", daemon_augmented_path(&node))
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("COVEN_CAVE_BUNDLE", "1")
        .env("COVEN_PIPER_BIN", &piper)
        .env("COVEN_KOKORO_BIN", &kokoro)
        .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
        .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Take the same lease as GUI startup immediately before creating the
    // child. A GUI that wins this lease writes its marker first; a daemon that
    // wins records its child before releasing it, so the GUI can stop it
    // during takeover instead of leaving an untracked fallback-port server.
    let ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
    if gui_is_active(&app_data_dir)
        || daemon_shutdown_requested()
        || !read_reachability_config(&config_path).daemon_mode
    {
        return Ok(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start background sidecar: {error}"))?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("background sidecar stdout pipe was unavailable".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("background sidecar stderr pipe was unavailable".to_string());
        }
    };
    capture_sidecar_output(stdout, Arc::clone(&sidecar_output));
    capture_sidecar_output(stderr, Arc::clone(&sidecar_output));
    let child_pid = child.id();
    let identity = match process_identity(child_pid) {
        Some(identity) => identity,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("could not establish background sidecar identity".to_string());
        }
    };
    let lease = ProcessLease {
        pid: child_pid,
        identity,
    };
    let state = DaemonSidecarState { lease, port };
    let state_path = app_data_dir.join(DAEMON_STATE_FILE);
    if let Err(error) = write_private_json(&state_path, &state) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    drop(ownership);

    match wait_for_sidecar_ready(
        port,
        &sidecar_output,
        Duration::from_secs(30),
        || gui_is_active(&app_data_dir) || daemon_shutdown_requested(),
        || child.try_wait().ok().flatten().is_some(),
    ) {
        PortWaitResult::Ready => {}
        PortWaitResult::Cancelled => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&state_path);
            return Ok(0);
        }
        PortWaitResult::Exited => {
            let _ = child.wait();
            let _ = std::fs::remove_file(&state_path);
            return Err(format!(
                "background sidecar exited before becoming ready on port {port}. Bounded sidecar output tail:\n{}",
                sidecar_output_text(&sidecar_output)
            ));
        }
        PortWaitResult::TimedOut => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&state_path);
            return Err(format!(
                "background sidecar did not become ready on port {port}. Bounded sidecar output tail:\n{}",
                sidecar_output_text(&sidecar_output)
            ));
        }
    }

    if daemon_shutdown_requested() {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&state_path);
        return Ok(0);
    }

    repair_tailscale_serve_for_port(port);

    let mut assertion: Option<PowerAssertion> = None;
    let mut last_serve_repair = Instant::now();
    loop {
        if daemon_shutdown_requested()
            || gui_is_active(&app_data_dir)
            || !read_reachability_config(&config_path).daemon_mode
        {
            stop_daemon_children(
                &mut child,
                &mut assertion,
                &app_data_dir.join(DAEMON_STATE_FILE),
            );
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
            && paired_phone_seen(&paired_phone_path())
            && power_assertion_is_effective(current.prevent_sleep_on_ac_only, mac_is_on_ac_power());
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
        wait_for_daemon_activity(POWER_MONITOR_INTERVAL);
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
    fn ac_only_sleep_prevention_is_inactive_on_battery() {
        assert!(power_assertion_is_effective(true, true));
        assert!(!power_assertion_is_effective(true, false));
        assert!(power_assertion_is_effective(false, false));
    }

    #[test]
    fn sleep_policy_changes_do_not_replace_an_enabled_launch_agent() {
        let enabled = DesktopReachabilityConfig {
            daemon_mode: true,
            ..DesktopReachabilityConfig::default()
        };
        let changed_sleep_policy = DesktopReachabilityConfig {
            prevent_sleep: true,
            ..enabled.clone()
        };
        assert!(!launch_agent_reconciliation_required(
            &enabled,
            &changed_sleep_policy
        ));
        assert!(launch_agent_reconciliation_required(
            &enabled,
            &DesktopReachabilityConfig::default()
        ));
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
        assert!(plist.contains("<key>SuccessfulExit</key>"));
        assert!(plist.contains("<key>AbandonProcessGroup</key>\n  <false/>"));
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

    #[test]
    fn mobile_mode_uses_the_schema_default_until_explicitly_disabled() {
        assert!(mobile_mode_enabled_from_preferences(None));
        assert!(mobile_mode_enabled_from_preferences(Some("{}")));
        assert!(!mobile_mode_enabled_from_preferences(Some(
            r#"{"phone":{"mobileMode":false}}"#
        )));
    }

    #[test]
    fn serve_repair_preserves_the_existing_http_fallback_port() {
        let http_status = serde_json::json!({
            "TCP": { "3000": { "HTTP": true } },
            "Web": { "100.101.102.103:3000": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } }
        });
        assert_eq!(
            serve_mode_from_status(&http_status),
            Some(TailscaleServeMode::Http(3000))
        );
        assert_eq!(
            http_serve_arguments(3007, 3000),
            [
                "serve".to_string(),
                "--bg".to_string(),
                "--http=3000".to_string(),
                "http://127.0.0.1:3007".to_string(),
            ]
        );

        let https_status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } }
        });
        assert_eq!(
            serve_mode_from_status(&https_status),
            Some(TailscaleServeMode::Https)
        );
        assert_eq!(serve_mode_from_status(&serde_json::json!({})), None);
    }

    #[test]
    fn process_leases_reject_pid_reuse_with_a_different_identity() {
        let lease = ProcessLease {
            pid: 42,
            identity: "Thu Jul 24 12:00:00 2026 /Applications/CovenCave".to_string(),
        };
        assert!(lease_matches(&lease, Some(&lease.identity)));
        assert!(!lease_matches(
            &lease,
            Some("Thu Jul 24 12:00:01 2026 /usr/bin/unrelated")
        ));
        assert!(!lease_matches(&lease, None));
    }

    #[test]
    fn gui_ownership_persists_its_sidecar_lease_for_crash_recovery() {
        let state = GuiOwnershipState {
            lease: ProcessLease {
                pid: 10,
                identity: "gui-birth".to_string(),
            },
            sidecar: Some(DaemonSidecarState {
                lease: ProcessLease {
                    pid: 11,
                    identity: "sidecar-birth".to_string(),
                },
                port: 3007,
            }),
        };
        let restored: GuiOwnershipState = serde_json::from_value(
            serde_json::to_value(&state).expect("GUI ownership state serializes"),
        )
        .expect("GUI ownership state deserializes");
        assert_eq!(restored.sidecar.expect("sidecar is retained").port, 3007);
    }
}
