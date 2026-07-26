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
    assert!(
        quick_chat_url_from_main(Url::parse("https://example.test/").expect("external URL"))
            .is_none()
    );
    assert!(quick_chat_url_from_main(
        Url::parse("tauri://localhost/startup.html").expect("local startup URL")
    )
    .is_none());
}

// The main window's auth bridge strips covenCaveToken from the visible URL
// after load (the token moves into per-window sessionStorage), so a child
// window scraped from the live URL would open /quick-chat without the
// sidecar token and 401 "unauthorized" on every /api/ call. Detach and the
// tray Quick Chat must reuse the remembered token-bearing startup URL.
#[test]
fn child_windows_reuse_the_remembered_token_bearing_startup_url() {
    let startup = Url::parse("http://127.0.0.1:43123/?covenCaveToken=tok&coven_access_token=acc")
        .expect("startup URL");
    remember_main_startup_url(&startup);

    let remembered = MAIN_STARTUP_URL
        .lock()
        .expect("startup URL lock")
        .clone()
        .expect("remembered startup URL");
    let quick_chat = quick_chat_url_from_main(remembered).expect("trusted quick chat URL");
    assert_eq!(quick_chat.path(), "/quick-chat");
    assert_eq!(
        quick_chat.query(),
        Some("covenCaveToken=tok&coven_access_token=acc")
    );
}

#[test]
fn notch_url_requires_a_loopback_sidecar_origin() {
    let sidecar = Url::parse("http://127.0.0.1:43123/?token=secret").expect("sidecar URL");
    let notch = notch_url_from_main(sidecar).expect("trusted notch URL");

    assert_eq!(notch.path(), "/quick-chat");
    assert_eq!(notch.query(), Some("token=secret&notch=1"));
    assert!(
        notch_url_from_main(Url::parse("https://example.test/").expect("external URL")).is_none()
    );
    assert!(notch_url_from_main(
        Url::parse("tauri://localhost/startup.html").expect("local startup URL")
    )
    .is_none());
}

#[test]
fn notch_centered_x_keeps_the_pill_inside_the_monitor() {
    // Centering lands the pill under the requested center…
    assert_eq!(notch_centered_x(500.0, 0.0, 1000.0, 200.0), 400.0);
    // …until either edge stops it.
    assert_eq!(notch_centered_x(10.0, 0.0, 1000.0, 200.0), 0.0);
    assert_eq!(notch_centered_x(995.0, 0.0, 1000.0, 200.0), 800.0);
    // Secondary monitors offset the clamp window.
    assert_eq!(notch_centered_x(-1900.0, -2000.0, 2000.0, 200.0), -2000.0);
    // A pill wider than the monitor pins to the left edge, no panic.
    assert_eq!(notch_centered_x(100.0, 0.0, 150.0, 200.0), 0.0);
}

#[test]
fn notch_centers_exactly_on_the_monitor_middle() {
    // The notch must sit dead-center on the target monitor's top bar.
    // Centering on `monitor_x + monitor_w/2` yields a window whose own
    // center equals the monitor's center, on any monitor.
    for (monitor_x, monitor_w, width) in [
        (0.0, 1000.0, 200.0),
        (0.0, 1512.0, 480.0),
        (-2000.0, 2000.0, 640.0),
        (1512.0, 3840.0, 900.0),
    ] {
        let center_x = monitor_x + monitor_w / 2.0;
        let x = notch_centered_x(center_x, monitor_x, monitor_w, width);
        // The window's center lands exactly on the monitor's center.
        assert_eq!(x + width / 2.0, monitor_x + monitor_w / 2.0);
    }
}

#[test]
fn notch_config_defaults_fit_the_menu_bar_and_forgive_legacy_keys() {
    let config = NotchConfig::default();
    assert!(config.fit_menu_bar);

    // Partial JSON keeps the other defaults, and keys from the retired
    // follow-mouse era are ignored — hand-edits and old configs stay
    // forgiving.
    let partial: NotchConfig =
        serde_json::from_str(r#"{"followMouse":true,"fitMenuBar":false}"#).expect("legacy config");
    assert!(!partial.fit_menu_bar);
    assert_eq!(partial.collapsed_width, NOTCH_COLLAPSED_WIDTH);

    // Out-of-range custom sizes clamp instead of wedging the window.
    let wild =
        serde_json::from_str::<NotchConfig>(r#"{"collapsedHeight":1.0,"expandedWidth":10000.0}"#)
            .expect("wild config")
            .sanitized();
    assert_eq!(wild.collapsed_height, 20.0);
    assert_eq!(wild.expanded_width, 900.0);
}

#[test]
fn notch_collapsed_size_fits_the_menu_bar_strip_when_asked() {
    let config = NotchConfig::default();
    // Fit on + a reported strip → the pill squeezes into it.
    assert_eq!(notch_collapsed_size(&config, Some(24.0)), (190.0, 24.0));
    // No strip reported (auto-hidden bar, most Linux WMs) → configured
    // height instead of a zero-height pill.
    assert_eq!(notch_collapsed_size(&config, None), (190.0, 38.0));
    // Fit off → configured height even when a strip exists.
    let fixed = NotchConfig {
        fit_menu_bar: false,
        ..config
    };
    assert_eq!(notch_collapsed_size(&fixed, Some(24.0)), (190.0, 38.0));
}

#[test]
fn notch_url_carries_the_presentation_state_to_the_page() {
    let url = Url::parse("http://127.0.0.1:43123/notch?token=secret").expect("notch URL");
    let seeded = notch_url_with_config(url, &NotchConfig::default(), Some(37.0));
    let query = seeded.query().expect("seeded query");
    assert!(query.contains("fit=1"));
    // The retired follow-mouse era's param is gone for good.
    assert!(!query.contains("follow="));
    assert!(query.contains("pillw=190"));
    assert!(query.contains("pillh=38"));
    assert!(query.contains("barh=37"));
    // The original query (the auth token) survives.
    assert!(query.contains("token=secret"));
}

#[test]
fn sidecar_port_wait_is_cancellable_and_detects_readiness() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind readiness fixture");
    let port = listener.local_addr().expect("fixture address").port();
    let log_dir = std::env::temp_dir().join(format!(
        "covencave-sidecar-ready-test-{}-{}",
        std::process::id(),
        port
    ));
    std::fs::create_dir_all(&log_dir).expect("create log fixture dir");
    let log_path = log_dir.join("sidecar.log");

    // A listening port without the sidecar's own ready log line must NOT
    // be trusted — that's the port-squatting scenario this guards against.
    std::fs::write(&log_path, "starting up\n").expect("write log fixture");
    assert!(matches!(
        wait_for_sidecar_ready(port, &log_path, Duration::from_millis(600), || false),
        PortWaitResult::TimedOut
    ));

    std::fs::write(
        &log_path,
        format!("starting up\n> Ready on http://127.0.0.1:{}\n", port),
    )
    .expect("write ready log fixture");
    assert!(matches!(
        wait_for_sidecar_ready(port, &log_path, Duration::from_secs(1), || false),
        PortWaitResult::Ready
    ));
    drop(listener);

    assert!(matches!(
        wait_for_sidecar_ready(port, &log_path, Duration::from_secs(1), || true),
        PortWaitResult::Cancelled
    ));

    let _ = std::fs::remove_dir_all(&log_dir);
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
    let value =
        serde_json::to_value(SidecarStartupStatus::waiting()).expect("serialize startup status");

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
const WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT: &str = "COVEN_CAVE_WINDOWS_CLOSE_WATCHDOG_HELPER_EVENT";

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
            "app_lifecycle_tests::windows_close_watchdog_helper_process",
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
