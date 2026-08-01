use super::*;

#[cfg(desktop)]
pub(super) fn validate_shell_open_url(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "shell_open requires a valid URL".to_string())?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("shell_open only supports http(s) URLs".to_string()),
    }
}

#[cfg(desktop)]
pub(super) fn validate_shell_open_path(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("shell_open_path requires a path".to_string());
    }

    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("shell_open_path requires an absolute path".to_string());
    }

    let metadata =
        std::fs::metadata(&path).map_err(|_| "shell_open_path path does not exist".to_string())?;
    if !metadata.is_dir() {
        return Err("shell_open_path only opens directories".to_string());
    }

    Ok(path)
}

#[cfg(desktop)]
pub(super) fn normalize_picked_directory(path: &str) -> Result<Option<String>, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }

    let path_buf = PathBuf::from(path);
    if !path_buf.is_absolute() {
        return Err("folder picker returned a relative path".to_string());
    }
    if !path_buf.is_dir() {
        return Err("folder picker returned a non-directory path".to_string());
    }

    Ok(Some(path_buf.to_string_lossy().to_string()))
}

#[cfg(desktop)]
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub(super) fn windows_system32_binary(binary: &str) -> std::path::PathBuf {
    let system_root = std::env::var_os("SystemRoot")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"));
    system_root.join("System32").join(binary)
}
