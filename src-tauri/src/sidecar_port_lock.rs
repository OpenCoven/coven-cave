//! Cross-process exclusion on the dedicated sidecar port.
//!
//! `port_is_occupied()` could only ever answer whether the port was busy *at
//! the instant it looked*. Seconds pass between that answer and `node`
//! binding — long enough for a second copy to make the same observation and
//! draw the same conclusion. The two copies do not even race by chance: they
//! queue on `.runtime-cache.lock` (sidecar_archive_cache.rs) while one of them
//! extracts the runtime, so the loser is released into precisely the window
//! where the winner has finished extracting and has not yet bound. Its `node`
//! then died on a raw `EADDRINUSE`, which the startup path reported as
//! "exited before becoming ready" with the error object pasted underneath.
//!
//! An advisory OS lock removes that window instead of narrowing it. It is
//! taken before the spawn and held for the whole life of the process, and the
//! kernel releases it when the holder's handle closes — so a crashed or killed
//! owner leaves no stale claim, which a pid file on its own cannot promise.
//!
//! The lock is keyed on the RESOLVED port rather than on the application, and
//! that is deliberate. `COVEN_CAVE_PORT` exists so a second copy *can* run
//! beside the first, and the conflict message tells operators to use it;
//! keying on the app would make that instruction a lie. Two copies collide
//! only when they want the same address, which is the only thing they actually
//! cannot share.

use super::*;
use fs2::FileExt as Fs2FileExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::sync::OnceLock;

/// The outcome of asking for the port. A live second owner is an ordinary
/// result, not an error: `Err` is reserved for failing to *determine*
/// ownership, which the caller treats as "carry on and let the usual
/// diagnostics speak" rather than as a reason to refuse startup.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum PortClaim {
    Acquired,
    HeldBy { pid: Option<u32> },
}

/// Written next to the lock so a refused copy can name the process it lost to.
/// It is a courtesy, never the decision — the lock is what proves the owner is
/// alive, and this file is read only after the lock has already said no.
#[derive(Debug, Deserialize, Serialize)]
struct PortOwnerRecord {
    pid: u32,
}

pub(super) fn port_lock_file_name(port: u16) -> String {
    format!("sidecar-port-{port}.lock")
}

pub(super) fn port_owner_file_name(port: u16) -> String {
    format!("sidecar-port-{port}.owner.json")
}

/// Locks this process holds, keyed by port. The `File` is kept alive here for
/// the life of the process; dropping it would release the lock while the
/// sidecar it protects is still listening.
fn held_claims() -> &'static Mutex<HashMap<u16, File>> {
    static HELD: OnceLock<Mutex<HashMap<u16, File>>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `fs2` reports contention as a platform errno rather than a portable kind,
/// so compare against its own sentinel. Same test as
/// `sidecar_archive_cache::lock_is_contended`, duplicated because that module
/// is Windows-only and this one runs on every desktop target.
fn lock_is_contended(error: &io::Error) -> bool {
    let expected = fs2::lock_contended_error();
    match (error.raw_os_error(), expected.raw_os_error()) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => error.kind() == expected.kind(),
    }
}

/// Take the process-wide claim on `port`, or report the copy that already has
/// it.
pub(super) fn claim_dedicated_port(state_dir: &Path, port: u16) -> Result<PortClaim, String> {
    let mut held = held_claims()
        .lock()
        .map_err(|_| "the dedicated-port claim registry is poisoned".to_string())?;

    if held.contains_key(&port) {
        // Startup is re-entrant: the Windows retry button runs the whole
        // sequence again in the SAME process. Re-locking our own file would be
        // refused on Windows, where the lock is per-handle and does not
        // recognise the holder — so a retry would diagnose itself as the
        // conflicting copy and never recover.
        return Ok(PortClaim::Acquired);
    }

    fs::create_dir_all(state_dir).map_err(|error| {
        format!(
            "could not prepare the port-claim directory {}: {error}",
            state_dir.display()
        )
    })?;

    let lock_path = state_dir.join(port_lock_file_name(port));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "could not open the port claim {}: {error}",
                lock_path.display()
            )
        })?;

    match Fs2FileExt::try_lock_exclusive(&file) {
        Ok(()) => {
            record_port_owner(state_dir, port);
            held.insert(port, file);
            Ok(PortClaim::Acquired)
        }
        Err(error) if lock_is_contended(&error) => Ok(PortClaim::HeldBy {
            pid: read_port_owner(state_dir, port),
        }),
        Err(error) => Err(format!(
            "could not evaluate the claim on port {port} ({}): {error}",
            lock_path.display()
        )),
    }
}

/// Name this process as the owner. A failure here costs the next copy a pid in
/// its error message and nothing else, so it warns rather than failing the
/// claim we have already won.
fn record_port_owner(state_dir: &Path, port: u16) {
    let path = state_dir.join(port_owner_file_name(port));
    let record = PortOwnerRecord {
        pid: std::process::id(),
    };
    let encoded = match serde_json::to_vec(&record) {
        Ok(encoded) => encoded,
        Err(error) => {
            log::warn!("[cave] could not encode the port {port} owner record: {error}");
            return;
        }
    };
    if let Err(error) = fs::write(&path, encoded) {
        log::warn!(
            "[cave] could not record this process as the owner of port {port} ({}): {error}",
            path.display()
        );
    }
}

/// The owner's pid, when it can be read. Every failure collapses to `None`:
/// the lock has already established that *someone* live holds the port, and a
/// missing or half-written record only means the message cannot name them.
fn read_port_owner(state_dir: &Path, port: u16) -> Option<u32> {
    let raw = fs::read(state_dir.join(port_owner_file_name(port))).ok()?;
    serde_json::from_slice::<PortOwnerRecord>(&raw)
        .ok()
        .map(|record| record.pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cave-port-claim-{label}-{}-{}",
            std::process::id(),
            sidecar_auth_token()
        ));
        fs::create_dir_all(&dir).expect("port claim test dir");
        dir
    }

    #[test]
    fn a_free_port_is_claimed_and_records_this_process() {
        let dir = test_dir("free");
        let port = 39_001;
        assert_eq!(
            claim_dedicated_port(&dir, port).expect("claim a free port"),
            PortClaim::Acquired
        );
        assert_eq!(
            read_port_owner(&dir, port),
            Some(std::process::id()),
            "the winner names itself so the next copy can point at it"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reclaiming_in_the_same_process_succeeds() {
        // The Windows startup screen's Retry button re-enters the whole
        // sequence. Windows locks are per-handle, so without the registry
        // short-circuit the retry would find its own lock and report itself as
        // the conflicting copy.
        let dir = test_dir("retry");
        let port = 39_002;
        assert_eq!(
            claim_dedicated_port(&dir, port).expect("first claim"),
            PortClaim::Acquired
        );
        assert_eq!(
            claim_dedicated_port(&dir, port).expect("retry claim"),
            PortClaim::Acquired,
            "a retry must not diagnose itself as a second copy"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn distinct_ports_do_not_exclude_each_other() {
        // COVEN_CAVE_PORT is the documented way to run a second copy beside
        // the first. Keying the lock on the app rather than the port would
        // make that instruction a lie.
        let dir = test_dir("distinct");
        assert_eq!(
            claim_dedicated_port(&dir, 39_003).expect("claim the first port"),
            PortClaim::Acquired
        );
        assert_eq!(
            claim_dedicated_port(&dir, 39_004).expect("claim the second port"),
            PortClaim::Acquired
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_lock_held_by_another_handle_reports_the_recorded_owner() {
        // Stands in for a second copy: an independent handle holding the same
        // lock file is exactly what one looks like from here.
        let dir = test_dir("contended");
        let port = 39_005;
        let lock_path = dir.join(port_lock_file_name(port));
        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open the stand-in owner's handle");
        Fs2FileExt::lock_exclusive(&other).expect("the stand-in owner takes the lock");
        fs::write(
            dir.join(port_owner_file_name(port)),
            serde_json::to_vec(&PortOwnerRecord { pid: 4242 }).expect("encode owner"),
        )
        .expect("record the stand-in owner");

        assert_eq!(
            claim_dedicated_port(&dir, port).expect("evaluate the contended claim"),
            PortClaim::HeldBy { pid: Some(4242) },
            "a live owner is an ordinary outcome, reported by pid"
        );

        let _ = Fs2FileExt::unlock(&other);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_owner_record_still_reports_the_conflict() {
        let dir = test_dir("anonymous");
        let port = 39_006;
        let lock_path = dir.join(port_lock_file_name(port));
        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open the stand-in owner's handle");
        Fs2FileExt::lock_exclusive(&other).expect("the stand-in owner takes the lock");

        assert_eq!(
            claim_dedicated_port(&dir, port).expect("evaluate the contended claim"),
            PortClaim::HeldBy { pid: None },
            "the lock decides; the owner record only supplies a name"
        );

        let _ = Fs2FileExt::unlock(&other);
        let _ = fs::remove_dir_all(&dir);
    }
}
