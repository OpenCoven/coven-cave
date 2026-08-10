use super::*;
use std::collections::VecDeque;
use std::io::Read;

#[cfg(desktop)]
pub(super) const SIDECAR_OUTPUT_TAIL_BYTES: usize = 256 * 1024;

#[cfg(desktop)]
#[derive(Default)]
pub(super) struct SidecarOutputTail {
    bytes: VecDeque<u8>,
}

#[cfg(desktop)]
impl SidecarOutputTail {
    pub(super) fn push(&mut self, chunk: &[u8]) {
        if chunk.len() >= SIDECAR_OUTPUT_TAIL_BYTES {
            self.bytes.clear();
            self.bytes.extend(
                chunk[chunk.len() - SIDECAR_OUTPUT_TAIL_BYTES..]
                    .iter()
                    .copied(),
            );
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(SIDECAR_OUTPUT_TAIL_BYTES);
        if overflow > 0 {
            self.bytes.drain(..overflow);
        }
        self.bytes.extend(chunk.iter().copied());
    }

    #[cfg(test)]
    pub(super) fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    pub(super) fn text(&self) -> String {
        let bytes: Vec<u8> = self.bytes.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[cfg(desktop)]
pub(super) fn capture_sidecar_output(
    mut reader: impl Read + Send + 'static,
    output: Arc<Mutex<SidecarOutputTail>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut output) = output.lock() {
                        output.push(&buffer[..read]);
                    } else {
                        break;
                    }
                }
                Err(error) => {
                    log::warn!("[cave] sidecar output capture stopped: {error}");
                    break;
                }
            }
        }
    })
}

#[cfg(desktop)]
pub(super) fn sidecar_output_text(output: &Arc<Mutex<SidecarOutputTail>>) -> String {
    let captured = output
        .lock()
        .map(|output| output.text())
        .unwrap_or_else(|_| "(could not read sidecar output)".to_string());
    if captured.is_empty() {
        "(no output captured)".to_string()
    } else {
        captured
    }
}

/// Whether anything is already listening on the dedicated loopback port.
///
/// Replaces `find_free_port()`, which bound `127.0.0.1:0` and let the kernel
/// pick — that is what made the packaged app's port different on every launch.
/// See src-tauri/src/sidecar_ports.rs and scripts/ports.mjs for why a moving
/// port is more than an inconvenience.
///
/// A busy port is NOT worked around by relocating. The desktop app already
/// refuses to run a second GUI (the reachability owner check), so a stranger on
/// the dedicated port is an operator-visible conflict, not something to route
/// around silently — relocating is exactly how the address stopped being
/// dependable in the first place.
#[cfg(desktop)]
pub(super) fn port_is_occupied(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Dev builds only: the dev-server URL from tauri.conf.json `build.devUrl`,
/// returned only when something is actually listening on it. Release builds
/// always get `None` so they can never be pointed away from the bundled
/// sidecar.
#[cfg(desktop)]
pub(super) fn live_dev_server_url(app: &tauri::App) -> Option<tauri::Url> {
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
pub(super) fn wait_for_sidecar_ready(
    port: u16,
    output: &Arc<Mutex<SidecarOutputTail>>,
    timeout: Duration,
    should_cancel: impl Fn() -> bool,
    mut child_exited: impl FnMut() -> bool,
) -> PortWaitResult {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    // Require the launched sidecar's own ready log line, not just a listening
    // port — otherwise another process squatting the port would be trusted.
    let ready_line = format!("> Ready on http://127.0.0.1:{}", port);
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if should_cancel() {
            return PortWaitResult::Cancelled;
        }
        if child_exited() {
            return PortWaitResult::Exited;
        }
        let logged_ready = output
            .lock()
            .map(|output| output.text().lines().any(|line| line.trim() == ready_line))
            .unwrap_or(false);
        if logged_ready && TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return PortWaitResult::Ready;
        }
        thread::sleep(Duration::from_millis(150));
    }
    PortWaitResult::TimedOut
}

#[cfg(desktop)]
pub(super) fn sidecar_start_timeout() -> Duration {
    if cfg!(target_os = "windows") {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(60)
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn node_arg_path(path: &Path) -> PathBuf {
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
pub(super) fn node_arg_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Replace the main webview's dead/startup page without leaving it in session
/// history. Both first startup and later supervisor revivals use this exact
/// path so URL escaping and the native-navigation fallback cannot drift.
#[cfg(desktop)]
fn navigate_sidecar_window(window: &tauri::WebviewWindow, url: Url) -> Result<(), String> {
    let escaped = url.to_string().replace('"', "%22");
    window
        .eval(format!("window.location.replace(\"{escaped}\");"))
        .or_else(|_| window.navigate(url))
        .map_err(|error| format!("could not navigate the {} window: {error}", window.label()))
}

#[cfg(desktop)]
pub(super) fn refreshed_sidecar_window_url(startup_url: &Url, current_url: &Url) -> Url {
    let presentation_query: Vec<_> = current_url
        .query_pairs()
        .filter(|(key, _)| key != "covenCaveToken" && key != "coven_access_token")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let mut refreshed = startup_url.clone();
    refreshed.set_path(current_url.path());
    refreshed.set_fragment(current_url.fragment());
    for (key, value) in presentation_query {
        refreshed.query_pairs_mut().append_pair(&key, &value);
    }
    refreshed
}

#[cfg(desktop)]
pub(super) fn replace_main_window_url(app: &tauri::AppHandle, url: Url) -> Result<(), String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    navigate_sidecar_window(&main_window, url.clone())?;

    for label in [QUICK_CHAT_WINDOW_LABEL, NOTCH_WINDOW_LABEL] {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let target = match window.url() {
            Ok(current) => refreshed_sidecar_window_url(&url, &current),
            Err(error) => {
                log::warn!(
                    "[cave] could not inspect the {label} window during sidecar recovery: {error}; closing the stale auxiliary window"
                );
                let _ = window.close();
                continue;
            }
        };
        if let Err(error) = navigate_sidecar_window(&window, target) {
            log::warn!("[cave] {error}; closing the stale auxiliary window");
            let _ = window.close();
        }
    }

    Ok(())
}

#[cfg(desktop)]
pub(super) fn start_sidecar_runtime(
    app: &tauri::AppHandle,
    operation: &'static str,
    attempt: u32,
    mut on_step: impl FnMut(SidecarStartupStep),
    should_cancel: impl Fn() -> bool,
) -> Result<Url, SidecarStartError> {
    let diagnostics = sidecar_diagnostics::SidecarDiagnosticContext::new(
        operation,
        attempt,
        app.package_info().version.to_string(),
        app.path()
            .app_local_data_dir()
            .ok()
            .map(|directory| directory.join(sidecar_diagnostics::NATIVE_DIAGNOSTICS_FILE_NAME)),
    );
    let lifecycle_phase = if operation == "sidecar-recovery" {
        "recovery"
    } else {
        "startup"
    };
    diagnostics.record(
        lifecycle_phase,
        "started",
        "dedicated-sidecar",
        None,
        None,
    );
    let result = run_sidecar_runtime(app, &diagnostics, &mut on_step, should_cancel);
    match &result {
        Ok(_) => diagnostics.record(lifecycle_phase, "succeeded", "ready", None, None),
        Err(SidecarStartError::Cancelled) => {
            diagnostics.record(lifecycle_phase, "cancelled", "cancelled", None, None)
        }
        Err(SidecarStartError::Failed(_)) => {
            let failed_phase = diagnostics.current_phase();
            diagnostics.record(
                failed_phase,
                "failed",
                "startup-failed",
                Some("sidecar-start-failed"),
                None,
            )
        }
    }
    result
}

#[cfg(desktop)]
fn run_sidecar_runtime(
    app: &tauri::AppHandle,
    diagnostics: &sidecar_diagnostics::SidecarDiagnosticContext,
    on_step: &mut impl FnMut(SidecarStartupStep),
    should_cancel: impl Fn() -> bool,
) -> Result<Url, SidecarStartError> {
    diagnostics.record(
        "preparing-runtime",
        "started",
        "resource-discovery",
        None,
        None,
    );
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

    let port = sidecar_ports::dedicated_port();
    if port_is_occupied(port) {
        // Name the conflict instead of relocating. The old behaviour asked the
        // kernel for any free port, which always "worked" and left the app on a
        // different address every launch — including in the pairing-secret path
        // (`mobile-tailscale-${port}`), so phones could not find it twice.
        return Err(SidecarStartError::Failed(format!(
            "Port {port} is already in use, so CovenCave cannot start its local server.\n\n\
             This is usually another CovenCave that is still running, or a dev server \
             started with `pnpm dev`. Quit that one and re-launch, or start CovenCave with \
             {} set to a free port.",
            sidecar_ports::CAVE_PORT_ENV,
        )));
    }
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
    let piper = bundled_piper_path(&resource_dir);
    if !cfg!(debug_assertions) && !piper.is_file() {
        return Err(SidecarStartError::Failed(format!(
            "bundled Piper runtime not found at {}",
            piper.display()
        )));
    }
    if piper.is_file() {
        log::info!("[cave] using bundled Piper at {}", piper.display());
    } else {
        log::warn!(
            "[cave] bundled Piper is unavailable in development; local voices will use an explicit COVEN_PIPER_BIN or PATH fallback"
        );
    }
    let kokoro = bundled_kokoro_path(&resource_dir);
    if !cfg!(debug_assertions) && !kokoro.is_file() {
        return Err(SidecarStartError::Failed(format!(
            "bundled Kokoro runtime not found at {}",
            kokoro.display()
        )));
    }
    if kokoro.is_file() {
        log::info!("[cave] using bundled Kokoro at {}", kokoro.display());
    } else {
        log::warn!(
            "[cave] bundled Kokoro is unavailable in development; Kokoro voices will use an explicit COVEN_KOKORO_BIN or PATH fallback"
        );
    }
    let whisper_cli = find_bundled_whisper_cli(&resource_dir).ok_or_else(|| {
        SidecarStartError::Failed(
            "Could not find the bundled local Whisper runtime. Reinstall CovenCave or contact support."
                .to_string(),
        )
    })?;
    log::info!("[cave] using bundled Whisper at {}", whisper_cli.display());

    // Keep startup evidence in one fixed-size memory tail. Reader threads keep
    // draining both pipes for the sidecar's lifetime, so successful launches
    // do not leave persistent per-process log files behind.
    let sidecar_output = Arc::new(Mutex::new(SidecarOutputTail::default()));

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

    diagnostics.record(
        "preparing-runtime",
        "succeeded",
        "runtime-ready",
        None,
        None,
    );
    diagnostics.record(
        "sidecar-spawn",
        "started",
        "node-process",
        None,
        None,
    );
    on_step(SidecarStartupStep::StartingService);
    if should_cancel() {
        return Err(SidecarStartError::Cancelled);
    }

    #[cfg(target_os = "windows")]
    let (mut command, process_job, launch_gate) = {
        let process_job = windows_process_job::ProcessJob::new().map_err(|error| {
            diagnostics.record_io_error("sidecar-spawn", "process-job-failed", &error);
            SidecarStartError::Failed(format!("could not create sidecar process job: {error}"))
        })?;
        let launch_gate = windows_process_job::ProcessLaunchGate::new().map_err(|error| {
            diagnostics.record_io_error("sidecar-spawn", "launch-gate-failed", &error);
            SidecarStartError::Failed(format!("could not create sidecar launch gate: {error}"))
        })?;
        let launcher = launch_gate
            .launcher(&node, [&server_js_arg])
            .map_err(|error| {
                diagnostics.record_io_error("sidecar-spawn", "launcher-preparation-failed", &error);
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
        .env("COVEN_WHISPER_CPP_BIN", &whisper_cli)
        .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
        .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token)
        .env(
            sidecar_diagnostics::CORRELATION_ID_ENV,
            &diagnostics.correlation_id,
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_GENERATION_ENV,
            diagnostics.generation.to_string(),
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_OPERATION_ENV,
            diagnostics.operation,
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_ATTEMPT_ENV,
            diagnostics.attempt.to_string(),
        )
        .env(
            sidecar_diagnostics::NATIVE_VERSION_ENV,
            &diagnostics.cave_version,
        )
        .env(
            sidecar_diagnostics::NATIVE_PROTOCOL_VERSION_ENV,
            "1",
        );
    if let Some(path) = diagnostics.diagnostics_file.as_deref() {
        command.env(sidecar_diagnostics::NATIVE_DIAGNOSTICS_FILE_ENV, path);
    }

    if cfg!(debug_assertions) {
        // Development uses the explicit COVEN_PIPER_BIN/PATH fallback from the
        // Node runner. A clean checkout has only the resource placeholder.
        command.env_remove("COVEN_CAVE_BUNDLE");
    } else {
        command.env("COVEN_CAVE_BUNDLE", "1");
    }
    if piper.is_file() {
        command.env("COVEN_PIPER_BIN", node_arg_path(&piper));
    }
    if kokoro.is_file() {
        command.env("COVEN_KOKORO_BIN", node_arg_path(&kokoro));
    }

    // Ubuntu's pinned whisper.cpp archive keeps its shared objects next to the
    // CLI. Constrain the loader path to that bundled directory so the local
    // runner never depends on system libraries or a developer's shell setup.
    #[cfg(target_os = "linux")]
    if let Some(whisper_dir) = whisper_cli.parent() {
        command.env("LD_LIBRARY_PATH", whisper_dir);
    }

    #[cfg(unix)]
    configure_unix_sidecar_parent_watchdog(&mut command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command.spawn().map_err(|error| {
        diagnostics.record_io_error("sidecar-spawn", "spawn-failed", &error);
        SidecarStartError::Failed(format!("failed to spawn node sidecar: {error}"))
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        SidecarStartError::Failed("node sidecar stdout pipe was unavailable".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        SidecarStartError::Failed("node sidecar stderr pipe was unavailable".to_string())
    })?;
    capture_sidecar_output(stdout, Arc::clone(&sidecar_output));
    capture_sidecar_output(stderr, Arc::clone(&sidecar_output));
    #[cfg(target_os = "windows")]
    let child = {
        if let Err(error) = process_job.assign_child(&child) {
            diagnostics.record_io_error("sidecar-spawn", "process-ownership-failed", &error);
            let _ = child.kill();
            return Err(SidecarStartError::Failed(format!(
                "could not assign sidecar launch gate to process job: {error}"
            )));
        }
        if let Err(error) = launch_gate.release() {
            diagnostics.record_io_error("sidecar-spawn", "launch-gate-release-failed", &error);
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
    let sidecar_pid = child.id();
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

    diagnostics.record(
        "sidecar-spawn",
        "succeeded",
        "process-owned",
        None,
        None,
    );
    diagnostics.record(
        "readiness",
        "started",
        "authenticated-loopback",
        None,
        None,
    );
    on_step(SidecarStartupStep::WaitingForService);
    let sidecar_start_timeout = sidecar_start_timeout();
    let child_exited = || {
        sidecar_state
            .0
            .lock()
            .map(|mut sidecar| {
                sidecar
                    .as_mut()
                    .is_none_or(|sidecar| sidecar.has_exited().unwrap_or(true))
            })
            .unwrap_or(true)
    };
    match wait_for_sidecar_ready(
        port,
        &sidecar_output,
        sidecar_start_timeout,
        &should_cancel,
        child_exited,
    ) {
        PortWaitResult::Ready => {}
        PortWaitResult::Cancelled => return Err(SidecarStartError::Cancelled),
        result @ (PortWaitResult::Exited | PortWaitResult::TimedOut) => {
            let reason = match result {
                PortWaitResult::Exited => "exited before becoming ready".to_string(),
                PortWaitResult::TimedOut => format!(
                    "did not become ready within {}s",
                    sidecar_start_timeout.as_secs()
                ),
                _ => unreachable!(),
            };
            return Err(SidecarStartError::Failed(format!(
                "Sidecar (node {}) {} on port {}.\n\nBounded sidecar output tail:\n{}",
                node.display(),
                reason,
                port,
                sidecar_output_text(&sidecar_output)
            )));
        }
    }
    diagnostics.record(
        "readiness",
        "succeeded",
        "authenticated-loopback",
        None,
        None,
    );

    sidecar_reachability_ready(app, port, sidecar_pid);

    #[cfg(target_os = "windows")]
    sidecar_archive::cleanup_stale_sidecar_runtimes(&server_dir_root);

    format!(
        "http://127.0.0.1:{port}/?covenCaveToken={auth_token}&coven_access_token={mobile_access_token}"
    )
    .parse()
    .map_err(|error| SidecarStartError::Failed(format!("could not build sidecar URL: {error}")))
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn publish_sidecar_startup_status(
    app: &tauri::AppHandle,
    control: &SidecarStartupControl,
    status: SidecarStartupStatus,
) -> Result<(), String> {
    control.set_status(status.clone())?;
    app.emit_to("main", SIDECAR_STARTUP_EVENT, status)
        .map_err(|error| format!("could not publish sidecar startup status: {error}"))
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn spawn_sidecar_startup(
    app: tauri::AppHandle,
    control: Arc<SidecarStartupControl>,
    operation: &'static str,
    attempt: u32,
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
                operation,
                attempt,
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
                        if let Err(error) = sidecar.stop_after_startup_attempt() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    SidecarStartupStatus::cancelled()
                }
                Ok(url) => {
                    pty::trust_main_origin(&url);
                    remember_main_startup_url(&url);
                    // location.replace() swaps startup.html out of session
                    // history; native navigation is the shared fallback when
                    // the page's JS context is unreachable.
                    let navigation = replace_main_window_url(&app, url);
                    match navigation {
                        Ok(()) => SidecarStartupStatus::ready(),
                        Err(error) => {
                            if let Some(sidecar) = app.try_state::<SidecarState>() {
                                if let Err(stop_error) = sidecar.stop_after_startup_attempt() {
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
                        if let Err(error) = sidecar.stop_after_startup_attempt() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    SidecarStartupStatus::cancelled()
                }
                Err(SidecarStartError::Failed(error)) => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(stop_error) = sidecar.stop_after_startup_attempt() {
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
pub(super) fn sidecar_startup_status(
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<SidecarStartupStatus, String> {
    state.status()
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub(super) fn retry_sidecar_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<(), String> {
    spawn_sidecar_startup(
        app,
        Arc::clone(state.inner()),
        "sidecar-manual-retry",
        1,
    )
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub(super) fn cancel_sidecar_startup(
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
