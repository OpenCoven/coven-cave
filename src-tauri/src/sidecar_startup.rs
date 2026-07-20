use super::*;

#[cfg(desktop)]
pub(super) fn find_free_port() -> Option<u16> {
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
    log_path: &Path,
    timeout: Duration,
    should_cancel: impl Fn() -> bool,
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
        let logged_ready = std::fs::read_to_string(log_path)
            .map(|log| log.lines().any(|line| line.trim() == ready_line))
            .unwrap_or(false);
        if logged_ready && TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return PortWaitResult::Ready;
        }
        thread::sleep(Duration::from_millis(150));
    }
    PortWaitResult::TimedOut
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

#[cfg(desktop)]
pub(super) fn start_sidecar_runtime(
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
    match wait_for_sidecar_ready(port, &log_path, sidecar_start_timeout, &should_cancel) {
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
                    remember_main_startup_url(&url);
                    let navigation = app
                        .get_webview_window("main")
                        .ok_or_else(|| "startup window is unavailable".to_string())
                        .and_then(|window| {
                            // location.replace() swaps startup.html out of the
                            // webview's session history; window.navigate() pushes
                            // a new entry instead, so the shell's Back control
                            // (history.back) could land users on the dead splash
                            // screen. Fall back to navigate() if eval cannot
                            // reach the page — a stale history entry beats a
                            // startup failure.
                            let escaped = url.to_string().replace('"', "%22");
                            window
                                .eval(format!("window.location.replace(\"{escaped}\");"))
                                .or_else(|_| window.navigate(url))
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
    spawn_sidecar_startup(app, Arc::clone(state.inner()))
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
