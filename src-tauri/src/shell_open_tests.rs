use super::{
    launch_x_oauth_url_with, launch_x_oauth_url_with_window, validate_shell_open_url,
    validate_x_oauth_url,
};
use std::{
    cell::Cell,
    io,
    process::{Child, Command},
    time::{Duration, Instant},
};

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

fn valid_x_oauth_url() -> String {
    let mut url = tauri::Url::parse("https://x.com/i/oauth2/authorize").unwrap();
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", "public-client-id")
        .append_pair("redirect_uri", "http://127.0.0.1:1456/x/oauth/callback")
        .append_pair("scope", "tweet.read users.read offline.access")
        .append_pair("state", &"A".repeat(43))
        .append_pair("code_challenge", &"B".repeat(43))
        .append_pair("code_challenge_method", "S256");
    url.to_string()
}

fn spawn_launcher_test_child(mode: &str) -> io::Result<Child> {
    Command::new(std::env::current_exe()?)
        .args([
            "--exact",
            "tauri_setup::shell_open_tests::x_oauth_launcher_child_process",
            "--nocapture",
        ])
        .env("COVEN_X_OAUTH_LAUNCHER_TEST_MODE", mode)
        .spawn()
}

#[test]
fn x_oauth_launcher_child_process() {
    match std::env::var("COVEN_X_OAUTH_LAUNCHER_TEST_MODE").as_deref() {
        Ok("long-running") => std::thread::sleep(Duration::from_millis(400)),
        Ok("nonzero") => std::process::exit(7),
        _ => {}
    }
}

#[test]
fn allows_only_complete_x_oauth_authorization_urls() {
    assert!(validate_x_oauth_url(&valid_x_oauth_url()).is_ok());
}

#[test]
fn rejects_arbitrary_or_malformed_x_oauth_navigation() {
    let valid = valid_x_oauth_url();
    for denied in [
        "http://x.com/i/oauth2/authorize",
        "https://example.com/i/oauth2/authorize",
        "https://user:pass@x.com/i/oauth2/authorize",
        "https://x.com/i/oauth2/authorize#fragment",
        "https://x.com/other",
        "https://x.com/i/oauth2/authorize",
        "not a URL",
    ] {
        assert!(validate_x_oauth_url(denied).is_err(), "{denied}");
    }
    assert!(validate_x_oauth_url(&format!("{valid}&next=https%3A%2F%2Fevil.example")).is_err());
}

#[test]
fn x_oauth_launcher_reports_successful_exit() {
    let url = valid_x_oauth_url();
    let received = Cell::new(false);

    assert!(
        launch_x_oauth_url_with_window(&url, Duration::from_secs(2), |candidate| {
            received.set(candidate == url);
            spawn_launcher_test_child("success")
        })
        .is_ok()
    );
    assert!(received.get(), "the validated URL must reach the launcher");
}

#[test]
fn x_oauth_launcher_reports_nonzero_exit_without_url_details() {
    let url = valid_x_oauth_url();
    let error = launch_x_oauth_url_with_window(&url, Duration::from_secs(2), |_| {
        spawn_launcher_test_child("nonzero")
    })
    .unwrap_err();

    assert_eq!(error, "System browser launcher exited unsuccessfully.");
    assert!(!error.contains(&url));
}

#[test]
fn x_oauth_launcher_returns_promptly_while_reaping_a_long_running_child() {
    let url = valid_x_oauth_url();
    let started = Instant::now();

    assert!(
        launch_x_oauth_url_with_window(&url, Duration::from_millis(20), |_| {
            spawn_launcher_test_child("long-running")
        })
        .is_ok()
    );
    assert!(
        started.elapsed() < Duration::from_millis(250),
        "a Linux-like long-running opener must not block OAuth polling"
    );
}

#[test]
fn x_oauth_launcher_sanitizes_spawn_failures() {
    let url = valid_x_oauth_url();
    let error = launch_x_oauth_url_with_window(&url, Duration::from_secs(2), |_| {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "secret-bearing launcher detail",
        ))
    })
    .unwrap_err();

    assert_eq!(error, "Could not start the system browser launcher.");
    assert!(!error.contains("secret-bearing"));
    assert!(!error.contains(&url));
}

#[test]
fn x_oauth_launcher_rejects_arbitrary_urls_before_running_command() {
    let called = Cell::new(false);
    let error = launch_x_oauth_url_with("https://example.com/", |_| {
        called.set(true);
        spawn_launcher_test_child("success")
    })
    .unwrap_err();

    assert_eq!(error, "X OAuth URL is not trusted");
    assert!(
        !called.get(),
        "untrusted URLs must never reach the launcher"
    );
}

#[test]
fn native_x_oauth_launcher_uses_a_bounded_os_thread_reaper() {
    let src = include_str!("shell_open_commands.rs");

    assert!(
        src.contains("pub(super) async fn open_x_oauth_url")
            && src.contains("tauri::async_runtime::spawn_blocking")
            && src.contains("std::thread::Builder")
            && src.contains(".recv_timeout(")
            && src.contains(".wait()"),
        "the X OAuth launcher must bound launch detection and reap on a plain OS thread",
    );
}

#[test]
fn native_x_oauth_launcher_suppresses_secret_bearing_process_output() {
    let src = include_str!("shell_open_commands.rs");

    assert!(
        src.contains(".stdout(std::process::Stdio::null())")
            && src.contains(".stderr(std::process::Stdio::null())"),
        "the native launcher must not forward output that could contain the authorization URL",
    );
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
    assert!(
        super::normalize_picked_directory(&current.to_string_lossy())
            .unwrap()
            .is_some()
    );
    assert_eq!(super::normalize_picked_directory("").unwrap(), None);
    assert!(super::normalize_picked_directory("relative/path").is_err());
    assert!(super::normalize_picked_directory(&file!()).is_err());
}

// #2614b: the native folder picker must be summoned to the foreground, not
// opened behind Cave's window. Guard the parenting/activation on each
// platform's picker invocation so a future edit can't silently regress it.
#[test]
fn folder_picker_is_summoned_to_the_foreground() {
    let src = include_str!("shell_open_commands.rs");
    // Windows: IFileOpenDialog gets a TopMost owner form handle so it cannot
    // open buried or unfocused.
    assert!(
        src.contains("$owner.TopMost = $true")
            && src.contains("[CovenFolderPicker]::Pick($owner.Handle)"),
        "the Windows folder picker must own its dialog with a TopMost form (foreground)",
    );
    // macOS: activate before `choose folder` so it comes to the front.
    assert!(
        src.contains("tell application \\\"System Events\\\" to activate"),
        "the macOS folder picker must activate System Events before choosing",
    );
    // Linux: the zenity picker runs modal.
    assert!(
        src.contains("--file-selection") && src.contains("--modal"),
        "the Linux (zenity) folder picker must run modal",
    );
}

#[test]
fn folder_picker_shows_hidden_directories() {
    let src = include_str!("shell_open_commands.rs");
    assert!(
        src.contains("invisibles true"),
        "the macOS folder picker must show dot-prefixed directories",
    );
    assert!(
        src.contains("--show-hidden"),
        "the Linux (zenity) folder picker must show dot-prefixed directories",
    );
    assert!(
        src.contains("FOS_FORCESHOWHIDDEN"),
        "the Windows folder picker must request hidden directories from IFileOpenDialog",
    );
    assert!(
        !src.contains("$d.ShowHiddenFiles"),
        "Windows PowerShell uses .NET Framework, whose FolderBrowserDialog lacks ShowHiddenFiles",
    );
}
