use super::validate_shell_open_url;

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
    let src = include_str!("lib.rs");
    // Windows: the FolderBrowserDialog gets a TopMost owner form passed to
    // ShowDialog so it can't open buried/unfocused.
    assert!(
        src.contains("$owner.TopMost = $true") && src.contains("$d.ShowDialog($owner)"),
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
