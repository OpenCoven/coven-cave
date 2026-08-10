#[allow(unused_imports)]
use super::*;
#[cfg(target_os = "windows")]
use std::process::Command;

// The dev launcher cannot read a signal death out of `tauri dev`, which
// returns 0 for one. It reads this marker instead, so an unwritten or empty
// marker has to mean "startup never finished" and nothing else. cave-g8n5v.
#[test]
fn dev_startup_marker_is_skipped_when_no_launcher_is_watching() {
    assert_eq!(dev_startup_marker_path(None), None, "unset means nobody asked");
    assert_eq!(
        dev_startup_marker_path(Some(String::new())),
        None,
        "an empty variable is not a path to write"
    );
    assert_eq!(
        dev_startup_marker_path(Some("   ".to_string())),
        None,
        "a blank variable is not a path to write"
    );
    assert_eq!(
        dev_startup_marker_path(Some("/tmp/cave-marker".to_string())),
        Some(std::path::PathBuf::from("/tmp/cave-marker")),
        "a named path is the launcher watching"
    );
}

#[test]
fn dev_startup_marker_only_fills_in_the_launchers_own_placeholder() {
    let dir = std::env::temp_dir().join(format!(
        "cave-startup-marker-guard-{}-{}",
        std::process::id(),
        sidecar_auth_token()
    ));
    std::fs::create_dir_all(&dir).expect("marker test dir");

    let placeholder = dir.join("mktemp-placeholder");
    std::fs::write(&placeholder, "").expect("empty placeholder");
    assert!(
        marker_is_the_launchers_placeholder(&placeholder),
        "the empty file mktemp created is exactly what the launcher hands over"
    );

    // A stale COVEN_CAVE_DEV_STARTUP_MARKER in someone's shell profile must
    // not turn every launch into a truncation of whatever it names.
    let real_file = dir.join("someones-real-file");
    std::fs::write(&real_file, "please do not clobber me\n").expect("real file");
    assert!(
        !marker_is_the_launchers_placeholder(&real_file),
        "a file with content is not a marker placeholder"
    );

    assert!(
        !marker_is_the_launchers_placeholder(&dir),
        "a directory is not a marker placeholder"
    );
    assert!(
        !marker_is_the_launchers_placeholder(&dir.join("nothing-here")),
        "the app must never create the marker, only fill one in"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn dev_startup_marker_is_non_empty_so_the_launcher_can_test_it() {
    let dir = std::env::temp_dir().join(format!(
        "cave-startup-marker-test-{}-{}",
        std::process::id(),
        sidecar_auth_token()
    ));
    std::fs::create_dir_all(&dir).expect("marker test dir");
    let path = dir.join("startup-marker");

    write_dev_startup_marker(&path).expect("marker written");

    let written = std::fs::read_to_string(&path).expect("marker readable");
    // `[ -s "$DEV_STARTUP_MARKER" ]` in scripts/dev-app.sh is the consumer:
    // an empty file is indistinguishable from the crash this detects.
    assert!(
        !written.is_empty(),
        "an empty marker reads exactly like a GUI that never finished startup"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

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
fn sidecar_output_tail_retains_only_the_newest_256_kibibytes() {
    let mut output = SidecarOutputTail::default();
    output.push(&vec![b'a'; SIDECAR_OUTPUT_TAIL_BYTES]);
    output.push(b"newest");

    let captured = output.snapshot();
    assert_eq!(captured.len(), SIDECAR_OUTPUT_TAIL_BYTES);
    assert!(captured.ends_with(b"newest"));

    output.push(&vec![b'b'; SIDECAR_OUTPUT_TAIL_BYTES + 32]);
    assert_eq!(output.snapshot(), vec![b'b'; SIDECAR_OUTPUT_TAIL_BYTES]);
}

#[test]
fn stdout_and_stderr_feed_one_shared_bounded_sidecar_tail() {
    let output = Arc::new(Mutex::new(SidecarOutputTail::default()));
    let stdout = capture_sidecar_output(
        std::io::Cursor::new(b"stdout line\n".to_vec()),
        Arc::clone(&output),
    );
    let stderr = capture_sidecar_output(
        std::io::Cursor::new(b"stderr line\n".to_vec()),
        Arc::clone(&output),
    );

    stdout.join().expect("join stdout capture");
    stderr.join().expect("join stderr capture");
    let text = output.lock().expect("output tail").text();
    assert!(text.contains("stdout line"));
    assert!(text.contains("stderr line"));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn packaged_sidecar_start_timeout_allows_slow_cold_start() {
    assert_eq!(sidecar_start_timeout(), Duration::from_secs(60));
}

#[test]
fn sidecar_port_wait_is_cancellable_and_detects_readiness() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind readiness fixture");
    let port = listener.local_addr().expect("fixture address").port();
    let output = Arc::new(Mutex::new(SidecarOutputTail::default()));

    // A listening port without the sidecar's own ready log line must NOT
    // be trusted — that's the port-squatting scenario this guards against.
    output.lock().expect("output tail").push(b"starting up\n");
    assert!(matches!(
        wait_for_sidecar_ready(
            port,
            "test-token",
            &output,
            Duration::from_millis(600),
            || false,
            || false
        ),
        PortWaitResult::TimedOut
    ));

    assert!(matches!(
        wait_for_sidecar_ready(
            port,
            "test-token",
            &output,
            Duration::from_secs(1),
            || false,
            || true
        ),
        PortWaitResult::Exited
    ));

    output
        .lock()
        .expect("output tail")
        .push(format!("> Ready on http://127.0.0.1:{}\n", port).as_bytes());
    let responder = std::thread::spawn(move || {
        use std::io::{Read, Write};
        let (mut stream, _) = listener.accept().expect("accept readiness request");
        let mut request = Vec::new();
        let mut chunk = [0_u8; 256];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut chunk).expect("read readiness request");
            assert!(read > 0, "readiness request ended before its headers");
            request.extend_from_slice(&chunk[..read]);
        }
        let request = String::from_utf8_lossy(&request);
        assert!(request.contains("GET /api/app/native-readiness HTTP/1.1"));
        assert!(request.contains("x-coven-cave-token: test-token"));
        let body = format!(
            r#"{{"service":"CovenCave","version":"{}","protocol":{{"name":"coven-cave-native-readiness","version":1}},"runtime":{{"bundle":true,"api":"ready"}}}}"#,
            env!("CARGO_PKG_VERSION")
        );
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write readiness response");
    });
    assert!(matches!(
        wait_for_sidecar_ready(
            port,
            "test-token",
            &output,
            Duration::from_secs(1),
            || false,
            || false
        ),
        PortWaitResult::Ready
    ));
    responder.join().expect("readiness responder");

    assert!(matches!(
        wait_for_sidecar_ready(
            port,
            "test-token",
            &output,
            Duration::from_secs(1),
            || true,
            || false
        ),
        PortWaitResult::Cancelled
    ));
}

#[test]
fn native_readiness_rejects_wrong_identity_protocol_version_and_dependencies() {
    fn response(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    let wrong_service = response(&format!(
        r#"{{"service":"NotCoven","version":"{}","protocol":{{"name":"coven-cave-native-readiness","version":1}},"runtime":{{"bundle":true,"api":"ready"}}}}"#,
        env!("CARGO_PKG_VERSION")
    ));
    assert!(validate_readiness_response(&wrong_service)
        .expect_err("wrong service must fail")
        .contains("unexpected service"));

    let wrong_protocol = response(&format!(
        r#"{{"service":"CovenCave","version":"{}","protocol":{{"name":"coven-cave-native-readiness","version":2}},"runtime":{{"bundle":true,"api":"ready"}}}}"#,
        env!("CARGO_PKG_VERSION")
    ));
    assert!(validate_readiness_response(&wrong_protocol)
        .expect_err("wrong protocol must fail")
        .contains("unsupported native readiness protocol"));

    let incompatible = response(
        r#"{"service":"CovenCave","version":"999.0.0","protocol":{"name":"coven-cave-native-readiness","version":1},"runtime":{"bundle":true,"api":"ready"}}"#,
    );
    assert!(validate_readiness_response(&incompatible)
        .expect_err("wrong app version must fail")
        .contains("incompatible"));

    let partial = response(&format!(
        r#"{{"service":"CovenCave","version":"{}","protocol":{{"name":"coven-cave-native-readiness","version":1}},"runtime":{{"bundle":true,"api":"starting"}}}}"#,
        env!("CARGO_PKG_VERSION")
    ));
    assert!(validate_readiness_response(&partial)
        .expect_err("partial runtime must fail")
        .contains("dependencies are not ready"));
}

#[test]
fn native_readiness_accepts_chunked_http_and_rejects_malformed_chunks() {
    let body = format!(
        r#"{{"service":"CovenCave","version":"{}","protocol":{{"name":"coven-cave-native-readiness","version":1}},"runtime":{{"bundle":true,"api":"ready"}}}}"#,
        env!("CARGO_PKG_VERSION")
    );
    let midpoint = body.len() / 2;
    let chunked = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n{:x}\r\n{}\r\n0\r\n\r\n",
        midpoint,
        &body[..midpoint],
        body.len() - midpoint,
        &body[midpoint..]
    );
    validate_readiness_response(chunked.as_bytes()).expect("valid chunked readiness");

    let malformed =
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n20\r\n{}\r\n0\r\n\r\n";
    assert!(validate_readiness_response(malformed)
        .expect_err("truncated chunks must fail")
        .contains("truncated chunk"));

    let truncated_terminator = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n",
        body.len(),
        body
    );
    assert!(validate_readiness_response(truncated_terminator.as_bytes())
        .expect_err("truncated terminal chunks must fail")
        .contains("malformed chunk terminator"));
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

#[cfg(unix)]
const UNIX_PARENT_DEATH_HELPER_ROLE: &str = "COVEN_CAVE_TEST_PARENT_DEATH_ROLE";

#[cfg(unix)]
#[test]
fn unix_parent_death_parent_helper() {
    use std::io::{BufRead, BufReader, Write};

    if std::env::var(UNIX_PARENT_DEATH_HELPER_ROLE).as_deref() != Ok("parent") {
        return;
    }

    let mut command = Command::new("sh");
    command
        .args([
            "-c",
            "sleep 30 & descendant=$!; echo CHILD_READY $descendant; cat >/dev/null; kill -KILL 0",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_unix_sidecar_parent_watchdog(&mut command);
    let mut child = command.spawn().expect("spawn watched sidecar fixture");
    let mut readiness = String::new();
    BufReader::new(child.stdout.take().expect("child stdout"))
        .read_line(&mut readiness)
        .expect("read child readiness");
    println!("PARENT_READY {} {}", child.id(), readiness.trim());
    std::io::stdout().flush().expect("flush parent readiness");

    // Skip every Rust destructor to model a crash/force-quit. Kernel fd close
    // is the only notification the child receives.
    unsafe { libc::_exit(0) }
}

#[cfg(unix)]
#[test]
fn repeated_abrupt_parent_exit_reaps_the_exact_sidecar_process_group() {
    use std::io::{BufRead, BufReader};

    for cycle in 1..=3 {
        let mut parent = Command::new(std::env::current_exe().expect("current test executable"))
            .args([
                "--exact",
                "app_lifecycle_tests::unix_parent_death_parent_helper",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(UNIX_PARENT_DEATH_HELPER_ROLE, "parent")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn abrupt parent fixture");
        let mut reader = BufReader::new(parent.stdout.take().expect("parent stdout"));
        let mut readiness = String::new();
        loop {
            readiness.clear();
            let read = reader
                .read_line(&mut readiness)
                .expect("read parent readiness");
            assert_ne!(read, 0, "cycle {cycle}: parent exited before readiness");
            if readiness.contains("PARENT_READY") {
                break;
            }
        }
        let readiness = readiness
            .split_once("PARENT_READY")
            .map(|(_, fields)| format!("PARENT_READY{fields}"))
            .expect("readiness marker");
        let fields = readiness.split_whitespace().collect::<Vec<_>>();
        assert_eq!(fields.first(), Some(&"PARENT_READY"), "{readiness}");
        assert_eq!(fields.get(2), Some(&"CHILD_READY"), "{readiness}");
        let child_pid: i32 = fields[1].parse().expect("numeric child pid");
        let descendant_pid: i32 = fields[3].parse().expect("numeric descendant pid");
        assert!(parent.wait().expect("wait for abrupt parent").success());

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let child_gone = unsafe { libc::kill(child_pid, 0) } != 0;
            let descendant_gone = unsafe { libc::kill(descendant_pid, 0) } != 0;
            if child_gone && descendant_gone {
                break;
            }
            if Instant::now() >= deadline {
                unsafe {
                    libc::kill(-child_pid, libc::SIGKILL);
                }
                panic!(
                    "crash/relaunch cycle {cycle}: parent EOF did not promptly reap sidecar {child_pid} and descendant {descendant_pid}"
                );
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

#[cfg(unix)]
#[test]
fn normal_cleanup_closes_the_parent_lease_and_reaps_the_sidecar_group() {
    use std::io::{BufRead, BufReader};

    let mut command = Command::new("sh");
    command
        .args([
            "-c",
            "sleep 30 & descendant=$!; echo CHILD_READY $descendant; cat >/dev/null; kill -KILL 0",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_unix_sidecar_parent_watchdog(&mut command);
    let mut child = command.spawn().expect("spawn watched sidecar fixture");
    let mut readiness = String::new();
    BufReader::new(child.stdout.take().expect("child stdout"))
        .read_line(&mut readiness)
        .expect("read child readiness");
    let fields = readiness.split_whitespace().collect::<Vec<_>>();
    assert_eq!(fields.first(), Some(&"CHILD_READY"), "{readiness}");
    let descendant_pid: i32 = fields[1].parse().expect("numeric descendant pid");

    stop_sidecar_child(SidecarProcess::new(child)).expect("stop watched sidecar group");

    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(descendant_pid, 0) } == 0 {
        if Instant::now() >= deadline {
            unsafe {
                libc::kill(descendant_pid, libc::SIGKILL);
            }
            panic!("normal cleanup left descendant {descendant_pid} alive");
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(not(target_os = "windows"))]
#[test]
fn startup_failure_stops_and_reaps_owned_sidecar() {
    let child = Command::new("sleep")
        .arg("30")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn startup failure fixture");
    let child_pid = child.id();
    let slot = Arc::new(Mutex::new(Some(SidecarProcess::new(child))));
    let state = SidecarState(Arc::clone(&slot));

    let message = state.stop_after_startup_error("startup timed out".to_string());

    assert_eq!(message, "startup timed out");
    assert!(slot.lock().expect("sidecar slot").is_none());
    let probe = Command::new("kill")
        .arg("-0")
        .arg(child_pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("probe reaped startup failure fixture");
    assert!(
        !probe.success(),
        "startup failure fixture should no longer exist"
    );
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
