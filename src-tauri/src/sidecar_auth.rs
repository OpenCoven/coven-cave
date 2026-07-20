use super::*;

#[cfg(desktop)]
pub(super) fn sidecar_auth_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(desktop)]
pub(super) const MOBILE_ACCESS_TOKEN_FILE: &str = "mobile-access-token";

#[cfg(desktop)]
pub(super) fn is_valid_persisted_token(token: &str) -> bool {
    token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit())
}

/// The mobile access secret must survive desktop restarts: phones sign their
/// tokens against it, so minting a fresh one per launch would force every
/// paired phone back through QR pairing after any restart. Load-or-create it
/// from disk; the per-launch webview token (`COVEN_CAVE_AUTH_TOKEN`) stays
/// ephemeral because the desktop webview receives a fresh URL each launch.
#[cfg(desktop)]
pub(super) fn load_or_create_mobile_access_token(secret_path: &Path) -> String {
    match std::fs::read_to_string(secret_path) {
        Ok(existing) => {
            let trimmed = existing.trim();
            if is_valid_persisted_token(trimmed) {
                return trimmed.to_string();
            }
            log::warn!(
                "[cave] persisted mobile access token at {} is malformed - regenerating (paired phones will need to re-pair)",
                secret_path.display()
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            log::warn!(
                "[cave] could not read mobile access token at {}: {error}",
                secret_path.display()
            );
        }
    }

    let token = sidecar_auth_token();
    if let Some(parent) = secret_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!(
                "[cave] could not create {} ({error}) - mobile access token will not persist across launches",
                parent.display()
            );
            return token;
        }
    }
    if let Err(error) = write_secret_file(secret_path, &token) {
        log::warn!(
            "[cave] could not persist mobile access token to {} ({error}) - paired phones will need to re-pair after restart",
            secret_path.display()
        );
    }
    token
}

#[cfg(desktop)]
pub(super) fn write_secret_file(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())
}

#[cfg(desktop)]
pub(super) fn mobile_access_token_for_app(app: &tauri::AppHandle) -> String {
    match app.path().app_data_dir() {
        Ok(dir) => load_or_create_mobile_access_token(&dir.join(MOBILE_ACCESS_TOKEN_FILE)),
        Err(error) => {
            log::warn!(
                "[cave] could not resolve app data dir ({error}) - mobile access token will not persist across launches"
            );
            sidecar_auth_token()
        }
    }
}
