use super::*;

#[cfg(desktop)]
use super::secret_path_acl::{
    protect_secret_path, Protection, MOBILE_SECRET_DIR_SUBJECT, MOBILE_SECRET_SUBJECT,
};

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

/// How a path holding a plaintext secret is made exclusive to the current user.
///
/// A seam, not indirection for its own sake. The real implementation is a
/// no-op everywhere except Windows, so without it every assertion about what
/// this file does when protection is REFUSED would be unreachable on the Linux
/// CI runner -- which is exactly how the Windows branch of the JavaScript
/// sibling stayed inert long enough for `cave-hdt3f` to be filed.
#[cfg(desktop)]
pub(super) type SecretPathGuard<'a> = &'a dyn Fn(&Path, &str) -> Protection;

#[cfg(desktop)]
fn default_secret_path_guard(path: &Path, subject: &str) -> Protection {
    protect_secret_path(path, subject)
}

/// Log a guard verdict, and say whether the caller may proceed.
#[cfg(desktop)]
fn accept(protection: Protection) -> bool {
    match protection {
        Protection::Enforced { notice } => {
            if let Some(notice) = notice {
                log::warn!("[cave] {notice}");
            }
            true
        }
        Protection::Waived { disclosure } => {
            log::warn!("[cave] {disclosure}");
            true
        }
        Protection::Refused { message } => {
            log::error!("[cave] {message}");
            false
        }
    }
}

/// The mobile access secret must survive desktop restarts: phones sign their
/// tokens against it, so minting a fresh one per launch would force every
/// paired phone back through QR pairing after any restart. Load-or-create it
/// from disk; the per-launch webview token (`COVEN_CAVE_AUTH_TOKEN`) stays
/// ephemeral because the desktop webview receives a fresh URL each launch.
#[cfg(desktop)]
pub(super) fn load_or_create_mobile_access_token(secret_path: &Path) -> String {
    load_or_create_mobile_access_token_with(secret_path, &default_secret_path_guard)
}

/// Refusing to persist is LOUD BUT NOT FATAL, deliberately.
///
/// `cave-37fxr` exists because the sibling guard turned an unverifiable path
/// into `process.exit(1)` and a hardened Windows host then could not boot Cave
/// at all, with no remedy reachable from inside the app. Nothing here can do
/// that: every refusal falls through to a per-launch token, so the app starts,
/// the sidecar still gets a gate secret, and the operator loses phone pairing
/// across restarts rather than the application. That is also why the guard
/// runs before the file is touched -- a host that cannot protect the secret
/// leaves the existing one exactly as it found it.
#[cfg(desktop)]
pub(super) fn load_or_create_mobile_access_token_with(
    secret_path: &Path,
    guard: SecretPathGuard<'_>,
) -> String {
    // The directory comes first. A file's own DACL cannot stop a principal
    // holding FILE_DELETE_CHILD on the directory above it from deleting the
    // secret and writing its own in place -- and `(M,DC)` is exactly what
    // `%APPDATA%\ai.opencoven.cave` was MEASURED granting to three foreign
    // principals on the author's host. Protecting it first also means the
    // secret file is born exclusive by inheritance rather than created open
    // and repaired afterwards.
    if let Some(parent) = secret_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!(
                "[cave] could not create {} ({error}) - mobile access token will not persist across launches",
                parent.display()
            );
            return sidecar_auth_token();
        }
        if !accept(guard(parent, MOBILE_SECRET_DIR_SUBJECT)) {
            log::warn!(
                "[cave] mobile access token will not persist across launches (paired phones will need to re-pair after restart) because {} could not be made exclusive to this user",
                parent.display()
            );
            return sidecar_auth_token();
        }
    }

    // Only trust a persisted secret whose own path is exclusive. Without this
    // the reuse path is the whole defect: an install that ran a version with
    // no access control keeps handing the sidecar a token any other principal
    // on the machine could have read or replaced.
    let mut refused_existing = false;
    let protected = match std::fs::symlink_metadata(secret_path) {
        Ok(_) => {
            let protected = accept(guard(secret_path, MOBILE_SECRET_SUBJECT));
            refused_existing = !protected;
            protected
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            log::warn!(
                "[cave] could not inspect mobile access token at {}: {error}",
                secret_path.display()
            );
            refused_existing = true;
            false
        }
    };

    if protected {
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
            Err(error) => {
                log::warn!(
                    "[cave] could not read mobile access token at {}: {error}",
                    secret_path.display()
                );
            }
        }
    }

    if refused_existing {
        // Do NOT overwrite it. Minting into this path would truncate a secret
        // this launch just declined to trust, so a transient refusal -- a
        // scanner holding the file open, a DACL momentarily unreadable --
        // would permanently unpair every phone. The refusal above already
        // named the remedy (`icacls <path> /reset`); until an operator runs it
        // this install uses a per-launch token and leaves the file alone.
        log::warn!(
            "[cave] leaving the existing mobile access token at {} untouched and using a per-launch secret instead (paired phones will need to re-pair after restart)",
            secret_path.display()
        );
        return sidecar_auth_token();
    }

    let token = sidecar_auth_token();
    if let Err(error) = write_secret_file_with(secret_path, &token, guard) {
        log::warn!(
            "[cave] could not persist mobile access token to {} ({error}) - paired phones will need to re-pair after restart",
            secret_path.display()
        );
    }
    token
}

/// Persist a secret whose path has been made exclusive to the current user.
///
/// The guard is a parameter rather than a call to `protect_secret_path`
/// because the refusal branch is otherwise unreachable on any runner CI owns.
#[cfg(desktop)]
pub(super) fn write_secret_file_with(
    path: &Path,
    contents: &str,
    guard: SecretPathGuard<'_>,
) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;

    // The file is EMPTY at this point on purpose. Windows has no create-time
    // equivalent of `mode(0o600)`, so the access control is applied while
    // there is nothing to read; if it cannot be applied, not one byte of the
    // secret has been written and the empty file goes away again.
    match guard(path, MOBILE_SECRET_SUBJECT) {
        Protection::Enforced { notice } => {
            if let Some(notice) = notice {
                log::warn!("[cave] {notice}");
            }
        }
        Protection::Waived { disclosure } => log::warn!("[cave] {disclosure}"),
        Protection::Refused { message } => {
            drop(file);
            let _ = std::fs::remove_file(path);
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                message,
            ));
        }
    }

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
