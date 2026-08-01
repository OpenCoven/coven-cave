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
pub(super) fn validate_x_oauth_url(url: &str) -> Result<(), String> {
    use std::collections::BTreeMap;

    let parsed = Url::parse(url).map_err(|_| "X OAuth requires a valid URL".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("x.com")
        || parsed.port().is_some()
        || parsed.path() != "/i/oauth2/authorize"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("X OAuth URL is not trusted".to_string());
    }

    let mut query = BTreeMap::new();
    for (key, value) in parsed.query_pairs() {
        if query.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err("X OAuth URL contains duplicate parameters".to_string());
        }
    }
    let expected = [
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
    ];
    if query.len() != expected.len() || expected.iter().any(|key| !query.contains_key(*key)) {
        return Err("X OAuth URL parameters are incomplete".to_string());
    }

    let base64url_32 = |value: &str| {
        value.len() == 43
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    let client_id = query
        .get("client_id")
        .map(String::as_str)
        .unwrap_or_default();
    let valid_client_id = !client_id.is_empty()
        && client_id.len() <= 256
        && client_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'));
    let scope = query.get("scope").map(String::as_str);
    if query.get("response_type").map(String::as_str) != Some("code")
        || query.get("redirect_uri").map(String::as_str)
            != Some("http://127.0.0.1:1456/x/oauth/callback")
        || query.get("code_challenge_method").map(String::as_str) != Some("S256")
        || !valid_client_id
        || !base64url_32(query.get("state").map(String::as_str).unwrap_or_default())
        || !base64url_32(
            query
                .get("code_challenge")
                .map(String::as_str)
                .unwrap_or_default(),
        )
        || !matches!(
            scope,
            Some("tweet.read users.read offline.access")
                | Some("tweet.read users.read offline.access tweet.write")
        )
    {
        return Err("X OAuth URL parameters are invalid".to_string());
    }
    Ok(())
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
