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
#[cfg(all(desktop, target_os = "macos"))]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
#[cfg(all(desktop, target_os = "macos"))]
use std::os::unix::io::AsRawFd;
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
#[cfg(all(desktop, target_os = "macos"))]
const SERVE_REPAIR_OUTPUT_BYTES: usize = 64 * 1024;
#[cfg(all(desktop, target_os = "macos"))]
const SERVE_REPAIR_OUTPUT_DRAIN: Duration = Duration::from_millis(250);
#[cfg(all(desktop, target_os = "macos"))]
const SERVE_REPAIR_KILL_GRACE: Duration = Duration::from_millis(500);
#[cfg(desktop)]
const TAILSCALE_SERVE_LEASE_FILE: &str = "tailscale-serve-ownership.lock";
#[cfg(desktop)]
const TAILSCALE_SERVE_LEASE_VERSION: u8 = 1;
#[cfg(all(desktop, target_os = "macos"))]
const TAILSCALE_SERVE_LEASE_TIMEOUT: Duration = Duration::from_millis(1500);
#[cfg(all(desktop, target_os = "macos"))]
const TAILSCALE_SERVE_LEASE_POLL: Duration = Duration::from_millis(50);
#[cfg(all(desktop, target_os = "macos"))]
const TAILSCALE_SERVE_RECLAMATION_PORT: u16 = 61_987;

#[cfg(desktop)]
const DAEMON_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(all(desktop, target_os = "macos"))]
static DAEMON_SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

#[cfg(all(desktop, target_os = "macos"))]
static SERVE_REPAIR_STATE: OnceLock<Mutex<ServeRepairState>> = OnceLock::new();

#[cfg(desktop)]
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct ServeMutationLeaseRecord {
    version: u8,
    pid: u32,
    token: String,
}

#[cfg(all(desktop, target_os = "macos"))]
struct ServeMutationLease {
    path: PathBuf,
    candidate_path: PathBuf,
    record: ServeMutationLeaseRecord,
}

#[cfg(all(desktop, target_os = "macos"))]
impl Drop for ServeMutationLease {
    fn drop(&mut self) {
        let current = std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str::<ServeMutationLeaseRecord>(&raw).ok());
        if current
            .as_ref()
            .is_some_and(|current| serve_mutation_lease_matches(&self.record, current))
        {
            let _ = std::fs::remove_file(&self.path);
        }
        let _ = std::fs::remove_file(&self.candidate_path);
    }
}

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

#[cfg(desktop)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ServeProxyTarget {
    Loopback(u16),
    Protected,
}

#[cfg(desktop)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ServeRepairDecision {
    Noop,
    Preserve,
    Repair(TailscaleServeMode),
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
    launch_agent_is_ready: bool,
    launch_agent_is_present: bool,
) -> bool {
    previous.daemon_mode != next.daemon_mode
        || (next.daemon_mode && !launch_agent_is_ready)
        || (!next.daemon_mode && launch_agent_is_present)
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

#[cfg(desktop)]
fn parse_loopback_proxy_port(proxy: &str) -> Option<u16> {
    let target = proxy.trim();
    let rest = target.strip_prefix("http://")?;
    let authority = rest.split('/').next()?;
    if authority.contains(['@', '?', '#']) {
        return None;
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix("[::1]:") {
        ("::1", rest)
    } else {
        authority.rsplit_once(':')?
    };
    if host != "127.0.0.1" && !host.eq_ignore_ascii_case("localhost") && host != "::1" {
        return None;
    }
    port.parse().ok()
}

#[cfg(desktop)]
fn serve_proxy_targets(status: &serde_json::Value) -> Vec<ServeProxyTarget> {
    let Some(web) = status.get("Web") else {
        return Vec::new();
    };
    let Some(web) = web.as_object() else {
        return vec![ServeProxyTarget::Protected];
    };
    let mut targets = Vec::new();
    for config in web.values() {
        let Some(config) = config.as_object() else {
            targets.push(ServeProxyTarget::Protected);
            continue;
        };
        let Some(handlers) = config.get("Handlers") else {
            targets.push(ServeProxyTarget::Protected);
            continue;
        };
        let Some(handlers) = handlers.as_object() else {
            targets.push(ServeProxyTarget::Protected);
            continue;
        };
        for handler in handlers.values() {
            let target = handler
                .get("Proxy")
                .and_then(serde_json::Value::as_str)
                .and_then(parse_loopback_proxy_port)
                .map(ServeProxyTarget::Loopback)
                .unwrap_or(ServeProxyTarget::Protected);
            targets.push(target);
        }
    }
    targets
}

#[cfg(desktop)]
fn serve_route_owned_by_port(status: &serde_json::Value, port: u16) -> bool {
    let targets = serve_proxy_targets(status);
    !targets.is_empty()
        && targets
            .iter()
            .all(|target| *target == ServeProxyTarget::Loopback(port))
}

#[cfg(desktop)]
fn decide_serve_repair(
    status: &serde_json::Value,
    requested_port: u16,
    packaged: bool,
    mut responds: impl FnMut(u16) -> bool,
) -> ServeRepairDecision {
    let Some(mode) = serve_mode_from_status(status) else {
        return ServeRepairDecision::Preserve;
    };
    let targets = serve_proxy_targets(status);
    if targets.is_empty() || targets.contains(&ServeProxyTarget::Protected) {
        return ServeRepairDecision::Preserve;
    }
    if targets
        .iter()
        .all(|target| *target == ServeProxyTarget::Loopback(requested_port))
    {
        return ServeRepairDecision::Noop;
    }
    if packaged && requested_port == super::sidecar_ports::CAVE_PRODUCTION_PORT {
        return ServeRepairDecision::Repair(mode);
    }
    if targets.iter().any(|target| match target {
        ServeProxyTarget::Loopback(port) if *port != requested_port => responds(*port),
        _ => false,
    }) {
        ServeRepairDecision::Preserve
    } else {
        ServeRepairDecision::Repair(mode)
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn loopback_backend_responds(port: u16) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&address, Duration::from_millis(500))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET /api/familiars HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut first_byte = [0_u8; 1];
    stream.read(&mut first_byte).is_ok_and(|read| read > 0)
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

#[cfg(desktop)]
fn tailscale_serve_lease_path_for(home: &Path) -> PathBuf {
    home.join(".coven")
        .join("cave")
        .join(TAILSCALE_SERVE_LEASE_FILE)
}

#[cfg(desktop)]
fn serve_mutation_lease_record_is_valid(record: &ServeMutationLeaseRecord) -> bool {
    record.version == TAILSCALE_SERVE_LEASE_VERSION
        && !record.token.is_empty()
        && record.token.len() <= 128
        && record
            .token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && record.pid > 0
        && record.pid <= i32::MAX as u32
}

#[cfg(desktop)]
fn serve_mutation_lease_is_stale(
    record: &ServeMutationLeaseRecord,
    is_process_alive: impl FnOnce(u32) -> bool,
) -> bool {
    serve_mutation_lease_record_is_valid(record) && !is_process_alive(record.pid)
}

#[cfg(desktop)]
fn serve_mutation_lease_matches(
    expected: &ServeMutationLeaseRecord,
    current: &ServeMutationLeaseRecord,
) -> bool {
    serve_mutation_lease_record_is_valid(current)
        && current.pid == expected.pid
        && current.token == expected.token
}

#[cfg(desktop)]
fn stale_lease_matches_under_fence(
    expected: &ServeMutationLeaseRecord,
    current: &ServeMutationLeaseRecord,
    is_process_alive: impl FnOnce(u32) -> bool,
) -> bool {
    serve_mutation_lease_matches(expected, current) && !is_process_alive(current.pid)
}

#[cfg(all(desktop, target_os = "macos"))]
fn serve_mutation_lease_candidate_path(
    lease_path: &Path,
    record: &ServeMutationLeaseRecord,
) -> PathBuf {
    PathBuf::from(format!(
        "{}.{}.{}.owner",
        lease_path.display(),
        record.pid,
        record.token
    ))
}

#[cfg(all(desktop, target_os = "macos"))]
fn process_is_alive(pid: u32) -> bool {
    if unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(all(desktop, target_os = "macos"))]
fn recover_stale_tailscale_serve_lease(lease_path: &Path) -> bool {
    let Ok(first_raw) = std::fs::read_to_string(lease_path) else {
        return false;
    };
    let Ok(first_metadata) = std::fs::metadata(lease_path) else {
        return false;
    };
    let Ok(first_record) = serde_json::from_str::<ServeMutationLeaseRecord>(&first_raw) else {
        return false;
    };
    if !serve_mutation_lease_is_stale(&first_record, process_is_alive) {
        return false;
    }

    // Node binds the same loopback port before stale reclamation. The kernel
    // releases this fence on crash, so only one reclaimer can reread and
    // remove the canonical path while a delayed contender waits.
    let Ok(_reclamation_fence) =
        std::net::TcpListener::bind(("127.0.0.1", TAILSCALE_SERVE_RECLAMATION_PORT))
    else {
        return false;
    };
    let Ok(second_raw) = std::fs::read_to_string(lease_path) else {
        return false;
    };
    let Ok(second_metadata) = std::fs::metadata(lease_path) else {
        return false;
    };
    let Ok(second_record) = serde_json::from_str::<ServeMutationLeaseRecord>(&second_raw) else {
        return false;
    };
    if !stale_lease_matches_under_fence(&first_record, &second_record, process_is_alive)
        || first_metadata.dev() != second_metadata.dev()
        || first_metadata.ino() != second_metadata.ino()
    {
        return false;
    }

    if std::fs::remove_file(lease_path).is_err() {
        return false;
    }
    let _ = std::fs::remove_file(serve_mutation_lease_candidate_path(
        lease_path,
        &first_record,
    ));
    true
}

#[cfg(all(desktop, target_os = "macos"))]
fn acquire_tailscale_serve_lease() -> Result<Option<ServeMutationLease>, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is unavailable".to_string())?;
    let path = tailscale_serve_lease_path_for(&home);
    let parent = path
        .parent()
        .ok_or_else(|| "Serve lease path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not create Serve lease directory: {error}"))?;

    let record = ServeMutationLeaseRecord {
        version: TAILSCALE_SERVE_LEASE_VERSION,
        pid: std::process::id(),
        token: format!("{:032x}", rand::random::<u128>()),
    };
    let candidate_path = serve_mutation_lease_candidate_path(&path, &record);
    // Node uses this same hard-link protocol: write the complete unique owner
    // record first, then atomically link it to the shared machine lock path.
    let mut candidate = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&candidate_path)
        .map_err(|error| format!("could not create Serve lease candidate: {error}"))?;
    if let Err(error) = serde_json::to_writer(&mut candidate, &record) {
        let _ = std::fs::remove_file(&candidate_path);
        return Err(format!("could not write Serve lease candidate: {error}"));
    }
    if let Err(error) = candidate
        .write_all(b"\n")
        .and_then(|_| candidate.sync_all())
    {
        let _ = std::fs::remove_file(&candidate_path);
        return Err(format!("could not sync Serve lease candidate: {error}"));
    }

    let deadline = Instant::now() + TAILSCALE_SERVE_LEASE_TIMEOUT;
    loop {
        match std::fs::hard_link(&candidate_path, &path) {
            Ok(()) => {
                return Ok(Some(ServeMutationLease {
                    path,
                    candidate_path,
                    record,
                }));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                let _ = std::fs::remove_file(&candidate_path);
                return Err(format!("could not link Serve lease: {error}"));
            }
        }

        if recover_stale_tailscale_serve_lease(&path) {
            continue;
        }
        if Instant::now() >= deadline {
            let _ = std::fs::remove_file(&candidate_path);
            return Ok(None);
        }
        thread::sleep(
            TAILSCALE_SERVE_LEASE_POLL.min(deadline.saturating_duration_since(Instant::now())),
        );
    }
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
    let _lease = match acquire_tailscale_serve_lease() {
        Ok(Some(lease)) => lease,
        Ok(None) => {
            log::warn!(
                "[cave] Tailscale Serve ownership is busy; preserving the current route for port {port}"
            );
            return;
        }
        Err(error) => {
            log::warn!(
                "[cave] could not acquire Tailscale Serve ownership lease for port {port}: {error}"
            );
            return;
        }
    };
    let status_args = [
        "serve".to_string(),
        "status".to_string(),
        "--json".to_string(),
    ];
    let decision = match run_tailscale_command(&status_args) {
        Ok(output) if output.status.success() => {
            serde_json::from_slice(&output.stdout).ok().map(|status| {
                decide_serve_repair(
                    &status,
                    port,
                    !cfg!(debug_assertions),
                    loopback_backend_responds,
                )
            })
        }
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
    let Some(decision) = decision else {
        // There is no paired Serve route to repair. Avoid creating an HTTPS
        // listener that could overwrite an unavailable or managed fallback.
        return;
    };
    let mode = match decision {
        ServeRepairDecision::Noop => return,
        ServeRepairDecision::Preserve => {
            log::info!(
                "[cave] preserving Tailscale Serve owned by another backend instead of repairing port {port}"
            );
            return;
        }
        ServeRepairDecision::Repair(mode) => mode,
    };
    let args = match mode {
        TailscaleServeMode::Https => serve_arguments(port).to_vec(),
        TailscaleServeMode::Http(http_port) => http_serve_arguments(port, http_port).to_vec(),
    };
    match run_tailscale_command(&args) {
        Ok(output) => {
            let mutation_succeeded = output.status.success();
            let verified = run_tailscale_command(&status_args)
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| serde_json::from_slice(&output.stdout).ok())
                .is_some_and(|status| serve_route_owned_by_port(&status, port));
            if verified && mutation_succeeded {
                log::info!("[cave] Tailscale Serve points at 127.0.0.1:{port}");
            } else if verified {
                log::warn!(
                    "[cave] Tailscale Serve reported {}, but the verified route points at 127.0.0.1:{port}",
                    output.status
                );
            } else {
                log::warn!(
                    "[cave] Tailscale Serve repair for port {port} lost ownership verification after {}",
                    output.status
                );
            }
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
fn set_nonblocking(file: &impl AsRawFd) -> Result<(), String> {
    let fd = file.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
fn drain_tailscale_stdout(
    stdout: &mut impl Read,
    output: &mut Vec<u8>,
) -> Result<bool, String> {
    let mut buffer = [0_u8; 8192];
    loop {
        if output.len() >= SERVE_REPAIR_OUTPUT_BYTES {
            return Err(format!(
                "Tailscale output exceeded {} bytes",
                SERVE_REPAIR_OUTPUT_BYTES
            ));
        }
        let want = buffer.len().min(SERVE_REPAIR_OUTPUT_BYTES - output.len());
        match stdout.read(&mut buffer[..want]) {
            Ok(0) => return Ok(true),
            Ok(read) => output.extend_from_slice(&buffer[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn terminate_tailscale_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let deadline = Instant::now() + SERVE_REPAIR_KILL_GRACE;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
        }
    }
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
    let mut stdout = child.stdout.take();
    if let Some(stdout_ref) = stdout.as_ref() {
        if let Err(error) = set_nonblocking(stdout_ref) {
            terminate_tailscale_child(&mut child);
            return Err(format!(
                "could not make Tailscale {command_name} output nonblocking: {error}"
            ));
        }
    }
    let mut output = Vec::with_capacity(SERVE_REPAIR_OUTPUT_BYTES.min(8192));
    let deadline = Instant::now() + SERVE_REPAIR_TIMEOUT;
    loop {
        let drain_result = stdout
            .as_mut()
            .map(|stdout| drain_tailscale_stdout(stdout, &mut output));
        match drain_result {
            Some(Ok(true)) => stdout = None,
            Some(Ok(false)) | None => {}
            Some(Err(error)) => {
                terminate_tailscale_child(&mut child);
                return Err(format!(
                    "could not read Tailscale {command_name} output: {error}"
                ));
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                // A direct child normally closes stdout with its exit. Give a
                // short, bounded drain window for the final bytes, but never
                // join a reader that a descendant inherited and kept open.
                let drain_deadline = Instant::now() + SERVE_REPAIR_OUTPUT_DRAIN;
                while stdout.is_some() && Instant::now() < drain_deadline {
                    let drain_result = stdout
                        .as_mut()
                        .map(|stdout| drain_tailscale_stdout(stdout, &mut output));
                    match drain_result {
                        Some(Ok(true)) => stdout = None,
                        Some(Ok(false)) => thread::sleep(Duration::from_millis(10)),
                        None => break,
                        Some(Err(error)) => {
                            drop(stdout);
                            return Err(format!(
                                "could not read Tailscale {command_name} output: {error}"
                            ));
                        }
                    }
                }
                drop(stdout);
                return Ok(TailscaleCommandOutput {
                    status,
                    stdout: output,
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                terminate_tailscale_child(&mut child);
                return Err(format!(
                    "Tailscale {command_name} timed out after {}s",
                    SERVE_REPAIR_TIMEOUT.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                terminate_tailscale_child(&mut child);
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
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    if detail.is_empty() {
        Err(format!("launchctl exited with {}", output.status))
    } else {
        Err(detail)
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn bootout_launch_agent() -> Result<(), String> {
    let domain = launch_agent_domain()?;
    let service = format!("{domain}/{LAUNCH_AGENT_LABEL}");
    match run_launchctl(&["bootout", &service]) {
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
fn bootstrap_launch_agent(domain: &str, plist_path: &str) -> Result<(), String> {
    match run_launchctl(&["bootstrap", domain, plist_path]) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            // launchd can briefly retain a just-booted-out service label. Reset
            // it once and retry after a bounded handoff instead of making the
            // user toggle Background availability repeatedly.
            bootout_launch_agent().map_err(|cleanup_error| {
                format!("{first_error}; launchd retry cleanup failed: {cleanup_error}")
            })?;
            thread::sleep(Duration::from_millis(200));
            run_launchctl(&["bootstrap", domain, plist_path]).map_err(|retry_error| {
                if retry_error == first_error {
                    retry_error
                } else {
                    format!("{first_error}; retry failed: {retry_error}")
                }
            })
        }
    }
}

#[cfg(all(desktop, target_os = "macos"))]
fn expected_launch_agent_plist() -> Result<String, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("could not resolve CovenCave executable: {error}"))?;
    let log_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is unavailable".to_string())?
        .join("Library")
        .join("Logs")
        .join("CovenCave");
    Ok(launch_agent_plist(
        &executable,
        &log_dir.join("sidecar-daemon.out.log"),
        &log_dir.join("sidecar-daemon.err.log"),
    ))
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_loaded() -> bool {
    let Ok(domain) = launch_agent_domain() else {
        return false;
    };
    let service = format!("{domain}/{LAUNCH_AGENT_LABEL}");
    run_launchctl(&["print", &service]).is_ok()
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_configuration_is_current() -> bool {
    let Ok(path) = launch_agent_path() else {
        return false;
    };
    let Ok(expected) = expected_launch_agent_plist() else {
        return false;
    };
    std::fs::read_to_string(path).is_ok_and(|actual| actual == expected)
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
    let plist = expected_launch_agent_plist()?;
    stop_recorded_daemon_sidecar(app_data_dir)?;
    bootout_launch_agent()?;
    write_launch_agent_file(&plist_path, &plist)?;
    let domain = launch_agent_domain()?;
    let plist_arg = plist_path.to_string_lossy().into_owned();
    if let Err(error) = bootstrap_launch_agent(&domain, &plist_arg) {
        let _ = remove_launch_agent_file(&plist_path);
        return Err(format!(
            "launchd could not load the CovenCave LaunchAgent: {error}"
        ));
    }
    if !launch_agent_configuration_is_current() || !launch_agent_loaded() {
        let _ = bootout_launch_agent();
        let _ = remove_launch_agent_file(&plist_path);
        return Err(
            "background availability did not load the current CovenCave LaunchAgent"
                .to_string(),
        );
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
    if launch_agent_present() {
        bootout_launch_agent()?;
    }
    Ok(())
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_installed() -> bool {
    launch_agent_configuration_is_current() && launch_agent_loaded()
}

#[cfg(all(desktop, target_os = "macos"))]
fn launch_agent_present() -> bool {
    launch_agent_path().is_ok_and(|path| path.is_file()) || launch_agent_loaded()
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn launch_agent_installed() -> bool {
    false
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn launch_agent_present() -> bool {
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

/// Take reachability ownership for this GUI, or report the GUI that already
/// holds it.
///
/// A live second owner returns `Ok(GuiReachability::AlreadyOwnedBy)` rather
/// than `Err`. This is not cosmetic: the caller runs inside Tauri's setup hook,
/// which on macOS executes within tao's `did_finish_launching` — an
/// Objective-C callback that cannot unwind. An `Err` there becomes a `panic!`
/// in a non-unwinding frame, which the runtime escalates to SIGABRT, so a
/// perfectly ordinary "it's already running" turned into a crash report.
/// `Err` is therefore reserved for genuine failures to determine ownership.
#[cfg(all(desktop, target_os = "macos"))]
pub(super) fn prepare_gui_reachability(app: &tauri::AppHandle) -> Result<GuiReachability, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data: {error}"))?;
    let _ownership = acquire_reachability_ownership_lease(&app_data_dir)?;
    let current_gui = current_process_lease()?;
    if let Some(existing) = read_gui_ownership_state(&app_data_dir) {
        if conflicts_with_live_gui(
            &existing.lease,
            &current_gui,
            process_identity(existing.lease.pid).as_deref(),
        ) {
            return Ok(GuiReachability::AlreadyOwnedBy {
                pid: existing.lease.pid,
            });
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
    } else if launch_agent_present() {
        uninstall_launch_agent(&app_data_dir)?;
    }
    Ok(GuiReachability::Acquired)
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(super) fn prepare_gui_reachability(
    _app: &tauri::AppHandle,
) -> Result<GuiReachability, String> {
    Ok(GuiReachability::Acquired)
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

/// What starting this GUI meant for reachability ownership.
///
/// Finding a live owner is an ordinary second-instance outcome, not a setup
/// failure, so it is reported as `Ok` and left for the caller to act on. See
/// `prepare_gui_reachability` for why the distinction is load-bearing.
#[cfg(desktop)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum GuiReachability {
    /// This process now owns reachability.
    Acquired,
    /// A different, still-live GUI owns it; this process must not take over.
    // Only macOS records GUI ownership, so nothing constructs this elsewhere.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    AlreadyOwnedBy { pid: u32 },
}

/// Whether a recorded ownership lease belongs to a *different* GUI that is
/// still alive.
///
/// Split out from `prepare_gui_reachability` so the conflict decision can be
/// tested without a live `AppHandle` — and kept on `cfg(desktop)` rather than
/// macOS so that test actually runs in CI, which has no macOS runner.
///
/// A recorded PID alone proves nothing: PIDs are reused. `lease_matches`
/// compares the kernel-recorded birth timestamp, so a reused PID reads as a
/// dead owner and this GUI is free to claim ownership.
#[cfg(desktop)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn conflicts_with_live_gui(
    existing: &ProcessLease,
    current: &ProcessLease,
    existing_identity: Option<&str>,
) -> bool {
    existing.pid != current.pid && lease_matches(existing, existing_identity)
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
        let installing_background_availability =
            config.daemon_mode && background_availability_supported();
        let launch_agent_result = if !launch_agent_reconciliation_required(
            &previous,
            &config,
            launch_agent_installed(),
            launch_agent_present(),
        ) {
            Ok(())
        } else if installing_background_availability {
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
            if installing_background_availability {
                return Err(format!(
                    "Background availability couldn’t start: {error}. Quit other Cave copies, reopen /Applications/CovenCave.app, and try again."
                ));
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
        if let Some(directory) = coven.path.parent() {
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
        // Same chosen old-space ceiling as the GUI's sidecar. This spawn site is
        // the daemon lane for the SAME server entry, so leaving it on V8's
        // host-derived default would mean the ceiling depended on which lane
        // started the server. See src-tauri/src/sidecar_heap.rs.
        .args(crate::sidecar_heap::sidecar_node_args(&server_entry))
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
        &auth_token,
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
        PortWaitResult::Refused(refusal) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&state_path);
            return Err(format!(
                "background sidecar failed its authenticated readiness handshake on port {port}: {}. Bounded sidecar output tail:\n{}",
                refusal.message,
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
            &changed_sleep_policy,
            true,
            true,
        ));
        assert!(launch_agent_reconciliation_required(
            &enabled,
            &DesktopReachabilityConfig::default(),
            true,
            true,
        ));
        assert!(
            launch_agent_reconciliation_required(&enabled, &enabled, false, false),
            "an enabled setting must repair a missing LaunchAgent"
        );
        assert!(
            launch_agent_reconciliation_required(&enabled, &enabled, false, true),
            "an enabled setting must repair a stale or unloaded LaunchAgent"
        );
        let disabled = DesktopReachabilityConfig::default();
        assert!(
            launch_agent_reconciliation_required(&disabled, &disabled, false, true),
            "a disabled setting must remove a stray LaunchAgent"
        );
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

    #[cfg(target_os = "macos")]
    #[test]
    fn tailscale_output_drain_rejects_output_beyond_the_cap() {
        let mut stdout = std::io::Cursor::new(vec![b'x'; SERVE_REPAIR_OUTPUT_BYTES + 1]);
        let mut output = Vec::new();

        let error = drain_tailscale_stdout(&mut stdout, &mut output)
            .expect_err("oversized Tailscale output must be rejected");

        assert!(error.contains("output exceeded"));
        assert_eq!(output.len(), SERVE_REPAIR_OUTPUT_BYTES);
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
    fn serve_repair_same_owner_is_a_noop() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://localhost:3007/" } } } }
        });
        assert_eq!(
            decide_serve_repair(&status, 3007, false, |_| panic!("same owner is not probed")),
            ServeRepairDecision::Noop
        );
    }

    #[test]
    fn serve_repair_preserves_a_competing_healthy_dev_backend() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3008" } } } }
        });
        assert_eq!(
            decide_serve_repair(&status, 3007, false, |port| port == 3008),
            ServeRepairDecision::Preserve
        );
    }

    #[test]
    fn serve_repair_takes_over_an_unreachable_stale_dev_backend() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3008" } } } }
        });
        assert_eq!(
            decide_serve_repair(&status, 3007, false, |_| false),
            ServeRepairDecision::Repair(TailscaleServeMode::Https)
        );
    }

    #[test]
    fn serve_repair_protects_non_loopback_targets_without_probing_them() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "https://example.com/backend" } } } }
        });
        let mut probes = 0;
        assert_eq!(
            decide_serve_repair(&status, 3007, false, |_| {
                probes += 1;
                false
            }),
            ServeRepairDecision::Preserve
        );
        assert_eq!(
            decide_serve_repair(&status, 3020, true, |_| {
                probes += 1;
                false
            }),
            ServeRepairDecision::Preserve
        );
        assert_eq!(probes, 0);
    }

    #[test]
    fn serve_proxy_inventory_protects_malformed_per_host_configs() {
        let status = serde_json::json!({
            "Web": {
                "null.tailnet.ts.net:443": null,
                "primitive.tailnet.ts.net:443": 42,
                "array.tailnet.ts.net:443": [],
                "missing-handlers.tailnet.ts.net:443": {}
            }
        });
        assert_eq!(
            serve_proxy_targets(&status),
            vec![
                ServeProxyTarget::Protected,
                ServeProxyTarget::Protected,
                ServeProxyTarget::Protected,
                ServeProxyTarget::Protected,
            ]
        );
    }

    #[test]
    fn packaged_serve_repair_has_precedence_over_a_healthy_dev_backend() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3007" } } } }
        });
        assert_eq!(
            decide_serve_repair(&status, 3020, true, |_| true),
            ServeRepairDecision::Repair(TailscaleServeMode::Https)
        );
    }

    #[test]
    fn packaged_serve_repair_override_preserves_a_healthy_different_owner() {
        let status = serde_json::json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "cave.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3008" } } } }
        });
        assert_eq!(
            decide_serve_repair(&status, 3007, true, |port| port == 3008),
            ServeRepairDecision::Preserve
        );
    }

    #[test]
    fn serve_mutation_lease_uses_the_cross_language_machine_path() {
        assert_eq!(
            tailscale_serve_lease_path_for(Path::new("/Users/coven")),
            PathBuf::from("/Users/coven/.coven/cave/tailscale-serve-ownership.lock")
        );
    }

    #[test]
    fn serve_mutation_lease_recovers_only_dead_well_formed_owners() {
        let owner = ServeMutationLeaseRecord {
            version: 1,
            pid: 4001,
            token: "owner-token".to_string(),
        };
        assert!(!serve_mutation_lease_is_stale(&owner, |_| true));
        assert!(serve_mutation_lease_is_stale(&owner, |_| false));

        let incompatible = ServeMutationLeaseRecord {
            version: 2,
            ..owner.clone()
        };
        assert!(!serve_mutation_lease_is_stale(&incompatible, |_| false));
    }

    #[test]
    fn serve_mutation_lease_release_cannot_remove_a_replacement_owner() {
        let owner = ServeMutationLeaseRecord {
            version: 1,
            pid: 4001,
            token: "owner-token".to_string(),
        };
        let replacement = ServeMutationLeaseRecord {
            version: 1,
            pid: 4002,
            token: "replacement-token".to_string(),
        };
        assert!(serve_mutation_lease_matches(&owner, &owner));
        assert!(!serve_mutation_lease_matches(&owner, &replacement));
    }

    #[test]
    fn delayed_reclaimer_revalidates_after_the_fence_before_removing() {
        let stale = ServeMutationLeaseRecord {
            version: 1,
            pid: 4001,
            token: "stale-owner".to_string(),
        };
        let third_owner = ServeMutationLeaseRecord {
            version: 1,
            pid: 4003,
            token: "third-owner".to_string(),
        };
        assert!(stale_lease_matches_under_fence(&stale, &stale, |_| false));
        assert!(
            !stale_lease_matches_under_fence(&stale, &third_owner, |pid| pid == 4003),
            "a second reclaimer authorized before the wait cannot remove the third acquirer"
        );
    }

    #[test]
    fn serve_repair_acquires_the_lease_before_its_first_status_read() {
        let source = include_str!("desktop_reachability.rs");
        let start = source
            .find("fn run_tailscale_serve_repair(port: u16)")
            .expect("repair function");
        let body = &source[start
            ..source[start..]
                .find(
                    "\n#[cfg(all(desktop, target_os = \"macos\"))]\nstruct TailscaleCommandOutput",
                )
                .map(|offset| start + offset)
                .expect("repair function end")];
        let lease = body
            .find("acquire_tailscale_serve_lease")
            .expect("shared lease acquisition");
        let status = body
            .find("run_tailscale_command(&status_args)")
            .expect("status read");
        let mutation = body
            .find("run_tailscale_command(&args)")
            .expect("Serve mutation");
        let verification = body
            .rfind("run_tailscale_command(&status_args)")
            .expect("post-mutation status read");
        assert!(lease < status);
        assert!(status < mutation);
        assert!(mutation < verification);
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

    fn lease(pid: u32, identity: &str) -> ProcessLease {
        ProcessLease {
            pid,
            identity: identity.to_string(),
        }
    }

    #[test]
    fn gui_conflict_detects_a_live_second_gui() {
        let existing = lease(4001, "birth-a");
        let current = lease(4002, "birth-b");
        assert!(conflicts_with_live_gui(
            &existing,
            &current,
            Some("birth-a")
        ));
    }

    #[test]
    fn gui_conflict_ignores_reentrant_setup_by_the_same_gui() {
        // macOS lifecycle restoration can re-enter setup in the same process.
        // Treating that as a second instance would make the app exit on resume.
        let same = lease(4001, "birth-a");
        assert!(!conflicts_with_live_gui(&same, &same, Some("birth-a")));
    }

    #[test]
    fn gui_conflict_ignores_a_recycled_pid() {
        // The recorded owner died and the OS handed its PID to something else.
        // Comparing PIDs alone would lock the user out of their own app.
        let existing = lease(4001, "birth-a");
        let current = lease(4002, "birth-b");
        assert!(!conflicts_with_live_gui(
            &existing,
            &current,
            Some("birth-of-some-unrelated-process")
        ));
    }

    #[test]
    fn gui_conflict_ignores_a_dead_owner() {
        // No identity at all means the recorded PID is not running.
        let existing = lease(4001, "birth-a");
        let current = lease(4002, "birth-b");
        assert!(!conflicts_with_live_gui(&existing, &current, None));
    }

    #[test]
    fn gui_conflict_is_a_success_outcome_not_an_error() {
        // The regression this guards (cave-4wnxo): reporting a second GUI as
        // `Err` propagates out of Tauri's setup hook, which on macOS cannot
        // unwind, so the process aborts with SIGABRT rather than saying what
        // happened. Keeping the conflict inside `Ok` makes that unrepresentable
        // — a caller cannot `?` it into a panic.
        let conflict: Result<GuiReachability, String> =
            Ok(GuiReachability::AlreadyOwnedBy { pid: 4001 });
        assert!(conflict.is_ok());
        assert_ne!(
            conflict.expect("a live second GUI is not a setup failure"),
            GuiReachability::Acquired
        );
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
