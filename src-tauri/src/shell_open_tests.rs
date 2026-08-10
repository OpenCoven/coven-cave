use super::{launch_x_oauth_url_with_window, validate_shell_open_url, validate_x_oauth_url};
use std::{io, time::Duration};

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

#[test]
fn windows_system32_binary_uses_an_absolute_system_path() {
    // This contract runs on every CI host. Normalize only for the assertion:
    // Unix PathBuf treats the backslashes in the Windows fallback/root-relative
    // input as literal characters, so its debug string legitimately mixes both
    // separator styles even though Windows resolves the same value normally.
    let windows_path = |path: std::path::PathBuf| path.to_string_lossy().replace('\\', "/");

    let path = windows_path(super::windows_system32_binary("rundll32.exe"));
    assert!(path.starts_with("C:/") || path.contains(":/"));
    assert!(path.ends_with("System32/rundll32.exe"));

    let powershell = windows_path(super::windows_system32_binary(
        r"WindowsPowerShell\v1.0\powershell.exe",
    ));
    assert!(powershell.starts_with("C:/") || powershell.contains(":/"));
    assert!(powershell.ends_with("System32/WindowsPowerShell/v1.0/powershell.exe"));
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

// X OAuth validator coverage, restored alongside the validator itself
// (cave-4f8x4). validate_x_oauth_url is security-critical — it is the only
// thing standing between a caller-supplied string and the system browser — and
// revert #4175 took these tests out with the function. Restoring the validator
// without them would have left the strictest check in this file as the only
// untested one.
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

// Single-mutation rejection cases. The list above differs from a valid URL in
// SEVERAL ways at once — "https://example.com/i/oauth2/authorize" has both the
// wrong host and no query parameters — so deleting the host check leaves it
// rejected by the parameter check and the suite stays green. Verified: with
// `|| parsed.host_str() != Some("x.com")` removed, all ten tests still passed.
//
// Each case here differs from valid_x_oauth_url() in exactly ONE respect, so a
// loosened check has nothing else to hide behind.
#[test]
fn rejects_each_x_oauth_url_constraint_in_isolation() {
    let valid = valid_x_oauth_url();
    assert!(validate_x_oauth_url(&valid).is_ok(), "control must be accepted");

    let swap = |from: &str, to: &str| valid.replacen(from, to, 1);
    let mut credentialed = tauri::Url::parse(&valid).unwrap();
    credentialed.set_username("fixture-user").unwrap();
    credentialed.set_password(Some("fixture-password")).unwrap();
    for (label, denied) in [
        ("host", swap("https://x.com/", "https://evil.example/")),
        ("scheme", swap("https://", "http://")),
        ("port", swap("https://x.com/", "https://x.com:8443/")),
        ("path", swap("/i/oauth2/authorize", "/i/oauth2/authorise")),
        ("credentials", credentialed.to_string()),
        ("fragment", format!("{valid}#fragment")),
        ("extra param", format!("{valid}&next=https%3A%2F%2Fevil.example")),
        ("duplicate param", format!("{valid}&state=CCCC")),
    ] {
        assert!(
            validate_x_oauth_url(&denied).is_err(),
            "{label} must be rejected on its own: {denied}",
        );
    }
}

// These two defend a DELIBERATE decision, and without them it reads as a bug.
// The launcher returns a fixed, opaque message instead of the io::Error text
// that the other shell_open commands propagate — because the string it is
// handling is an X OAuth authorization URL carrying `state` and
// `code_challenge`. A spawn failure can quote its argument, so forwarding the
// OS error is a secret-leak path, not better diagnostics. Review on PR #4178
// asked for the error text to be preserved "like the other commands"; these
// tests are why that must not happen.
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
fn native_x_oauth_launcher_suppresses_secret_bearing_process_output() {
    let src = include_str!("shell_open_commands.rs");

    assert!(
        src.contains(".stdout(std::process::Stdio::null())")
            && src.contains(".stderr(std::process::Stdio::null())"),
        "the native launcher must not forward output that could contain the authorization URL",
    );
}
