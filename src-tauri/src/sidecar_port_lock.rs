//! Cross-process exclusion on the dedicated sidecar port.
//!
//! The old `port_is_occupied()` could only answer whether the port was busy *at
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

/// Say it twice, because neither channel covers every caller.
///
/// The claim is taken near the top of the Tauri setup hook, above the only
/// `log` implementation this binary has (`tauri_plugin_log`, registered further
/// down and only in debug builds) — so a bare `log::warn!` from here reaches a
/// facade with no logger and is dropped. But `release_all_claims` is also
/// reached from fatal-exit paths well BELOW that registration, where the log
/// file is the only place a double-clicked packaged build can leave a trace.
#[cfg(desktop)]
fn warn_without_a_logger(message: &str) {
    log::warn!("{message}");
    eprintln!("{message}");
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
            pid: await_port_owner(state_dir, port),
        }),
        Err(error) => Err(format!(
            "could not evaluate the claim on port {port} ({}): {error}",
            lock_path.display()
        )),
    }
}

/// Drop every claim this process holds.
///
/// For an exit path that holds a claim, will never bind the port, and then
/// blocks. On macOS/Linux `show_fatal_dialog` waits on `osascript`/`zenity`
/// until someone clicks, so holding the claim across that wait would refuse
/// the next copy while naming a process that never binds anything.
///
/// The live cases are `report_existing_gui_owner`, and the two `fatal_exit`
/// arms in `tauri_setup.rs` that reap the child before showing their dialog.
/// NOT `check_app_translocation`: that runs before the claim is taken, and
/// scripts/port-contract.test.mjs pins that ordering.
///
/// Deliberately NOT called from `show_fatal_dialog` itself. `fatal_exit` also
/// goes through that dialog, and one of its call sites fires after the sidecar
/// has started; releasing there would drop the claim while `node` still holds
/// the port, and the next copy would then be told a stale story about its own
/// predecessor's orphan.
///
/// Removing the registry entry as well as unlocking means a caller that somehow
/// continues can re-claim cleanly rather than short-circuit on a lock it no
/// longer holds.
#[cfg(desktop)]
pub(super) fn release_all_claims() {
    let Ok(mut held) = held_claims().lock() else {
        return;
    };
    for (port, file) in held.drain() {
        if let Err(error) = Fs2FileExt::unlock(&file) {
            // Dropping `file` at the end of this iteration closes the handle,
            // which releases the lock on both platforms regardless — so this is
            // a report, not a leak.
            warn_without_a_logger(&format!(
                "[cave] could not release the claim on port {port}: {error}"
            ));
        }
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
            warn_without_a_logger(&format!(
                "[cave] could not encode the port {port} owner record: {error}"
            ));
            remove_stale_port_owner(&path, port);
            return;
        }
    };
    if let Err(error) = fs::write(&path, encoded) {
        warn_without_a_logger(&format!(
            "[cave] could not record this process as the owner of port {port} ({}): {error}",
            path.display()
        ));
        remove_stale_port_owner(&path, port);
    }
}

/// If this process could not name itself, make sure the previous owner's name
/// does not outlive it. A pid is recycled freely, so a record left behind by a
/// dead owner would have the next refusal point confidently at an unrelated
/// process. No name at all is the honest answer, and the message degrades to it
/// cleanly.
#[cfg(desktop)]
fn remove_stale_port_owner(path: &Path, port: u16) {
    match fs::remove_file(path) {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => warn_without_a_logger(&format!(
            "[cave] could not clear the stale owner record for port {port} ({}): {error}",
            path.display()
        )),
    }
}

/// How long a loser will wait for the winner to name itself. Deliberately
/// short: this runs on a path that is already refusing to start, and a missing
/// name costs a nicety, never correctness.
#[cfg(desktop)]
const OWNER_RECORD_WAIT: Duration = Duration::from_millis(60);

#[cfg(desktop)]
const OWNER_RECORD_POLL: Duration = Duration::from_millis(10);

/// The owner's pid, waiting briefly for the winner to write it.
///
/// The winner can only name itself AFTER it holds the lock, so there is a
/// window in which a loser sees the refusal but no record. Measured on Windows
/// with six processes released from a shared wall-clock barrier, the loser read
/// `None` on most attempts — and two copies launched together is exactly the
/// case this whole module exists for, so the anonymous message would be the one
/// operators actually saw. A copy that lost to an already-established owner
/// never needed this: the record was always there.
///
/// Bounded and cheap. Startup is being refused either way; the only question is
/// whether the refusal can say which process to switch to.
#[cfg(desktop)]
fn await_port_owner(state_dir: &Path, port: u16) -> Option<u32> {
    let deadline = Instant::now() + OWNER_RECORD_WAIT;
    loop {
        if let Some(pid) = read_port_owner(state_dir, port) {
            return Some(pid);
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(OWNER_RECORD_POLL);
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

    /// `release_all_claims` drains a process-global registry and `cargo test`
    /// runs these in parallel threads, so without this a release on one thread
    /// can quietly hand another thread's re-claim a FRESH lock — passing the
    /// assertion while never exercising the same-process short-circuit that
    /// test exists to protect. Delete the short-circuit and the run would still
    /// go green, nondeterministically.
    fn claim_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
        GUARD
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

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
        let _serialized = claim_test_guard();
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
        let _serialized = claim_test_guard();
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
        let _serialized = claim_test_guard();
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
        let _serialized = claim_test_guard();
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
    fn releasing_lets_the_next_copy_take_the_port() {
        // The exit paths that show a dialog block until someone clicks it. A
        // copy on its way out must not keep the port reserved for that long —
        // a translocated DMG copy sitting on the "drag me to /Applications"
        // alert would otherwise have the good copy refused, naming a process
        // that never binds anything.
        //
        let _serialized = claim_test_guard();
        let dir = test_dir("release");
        let port = 39_007;
        assert_eq!(
            claim_dedicated_port(&dir, port).expect("claim the port"),
            PortClaim::Acquired
        );

        release_all_claims();

        let next = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join(port_lock_file_name(port)))
            .expect("open the next copy's handle");
        assert!(
            Fs2FileExt::try_lock_exclusive(&next).is_ok(),
            "a released claim must be available to the next copy immediately"
        );

        let _ = Fs2FileExt::unlock(&next);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_loser_waits_briefly_for_the_winner_to_name_itself() {
        // The winner can only write the record AFTER it holds the lock, so two
        // copies launched together race into a window where the refusal is
        // already decided and the name is not yet written. Measured on Windows
        // with six barrier-synchronised processes, the loser read `None` on
        // most attempts — and two copies launched together is precisely what
        // this module exists for, so that would be the message operators
        // actually saw.
        let _serialized = claim_test_guard();
        let dir = test_dir("await-owner");
        let port = 39_008;

        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join(port_lock_file_name(port)))
            .expect("open the stand-in winner's handle");
        Fs2FileExt::lock_exclusive(&other).expect("the stand-in winner takes the lock");

        // The winner names itself only after the loser is already asking.
        let naming_dir = dir.clone();
        let naming = std::thread::spawn(move || {
            // 5ms against a 60ms budget: a 12x margin, because a 3x one
            // flaked on a loaded machine. The test still fails if the wait is
            // removed, since the read would then happen before this write.
            thread::sleep(Duration::from_millis(5));
            fs::write(
                naming_dir.join(port_owner_file_name(port)),
                serde_json::to_vec(&PortOwnerRecord { pid: 7171 }).expect("encode owner"),
            )
            .expect("record the stand-in winner");
        });

        assert_eq!(
            claim_dedicated_port(&dir, port).expect("evaluate the contended claim"),
            PortClaim::HeldBy { pid: Some(7171) },
            "a refusal should name the copy to switch to, not just say one exists"
        );

        let _ = naming.join();
        let _ = Fs2FileExt::unlock(&other);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_owner_record_still_reports_the_conflict() {
        let _serialized = claim_test_guard();
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
