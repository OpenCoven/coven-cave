//! The Rust half of the heap contract. Rust cannot import
//! `scripts/heap-limits.mjs`, so this number is duplicated on purpose and
//! `scripts/heap-limits.test.mjs` fails if the two copies ever disagree — the
//! same two-place convention `sidecar_ports.rs` uses for the port contract.
//!
//! Before this, `start_sidecar` spawned `node <server.mjs>` with the entry path
//! as its only argument and set no NODE_OPTIONS, so the packaged desktop app ran
//! at whatever old-space ceiling V8 derives from host memory. See
//! `scripts/heap-limits.mjs` for why an unchosen, per-machine ceiling is worth
//! replacing, and for the measurements behind the value.
//!
//! This is a guardrail, not a leak fix: the sidecar's steady state has been
//! measured at a 39-42 MB heap and a 300 MB peak RSS, and no leak was found in
//! it (cave-ksjt, cave-wgbk). The long-session OOM lives in the Next DEV server
//! and its retention is upstream (cave-r13x).

use std::ffi::OsString;
use std::path::Path;

/// Old-space ceiling, in MiB, for the packaged sidecar. Mirrors
/// CAVE_HEAP_LIMIT_MB in scripts/heap-limits.mjs.
pub(super) const CAVE_HEAP_LIMIT_MB: u32 = 4096;

/// Operator override, checked before the default. Mirrors CAVE_HEAP_LIMIT_ENV.
pub(super) const CAVE_HEAP_LIMIT_ENV: &str = "COVEN_CAVE_HEAP_LIMIT_MB";

/// Bounds on an override. The floor keeps a typo from making the desktop app
/// die on ordinary traffic; the ceiling only rejects nonsense.
pub(super) const CAVE_HEAP_LIMIT_MIN_MB: u32 = 512;
pub(super) const CAVE_HEAP_LIMIT_MAX_MB: u32 = 65536;

/// Parses an override, rejecting anything that is not bare digits inside the
/// usable range. `4096mb` and `4g` are refused rather than silently truncated
/// to a limit the operator did not ask for.
pub(super) fn parse_heap_limit_mb(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    trimmed
        .parse::<u32>()
        .ok()
        .filter(|mb| (CAVE_HEAP_LIMIT_MIN_MB..=CAVE_HEAP_LIMIT_MAX_MB).contains(mb))
}

/// The ceiling the sidecar should run with: `COVEN_CAVE_HEAP_LIMIT_MB` when it
/// parses, otherwise the pinned default. A malformed override is ignored rather
/// than fatal — the same reasoning as `sidecar_ports::dedicated_port`: a typo in
/// a shell profile should not stop the desktop app from starting, and the
/// resolved value is visible in the child's own argv.
pub(super) fn heap_limit_mb() -> u32 {
    std::env::var(CAVE_HEAP_LIMIT_ENV)
        .ok()
        .as_deref()
        .and_then(parse_heap_limit_mb)
        .unwrap_or(CAVE_HEAP_LIMIT_MB)
}

/// The complete argument vector for the sidecar's `node` invocation.
///
/// ORDER IS LOAD-BEARING. Node only reads V8 flags that appear BEFORE the script
/// path; anything after it is handed to the script as `process.argv` and the
/// process runs uncapped. Building the whole vector here — rather than letting
/// each call site append a flag to an existing arg list — is what keeps that
/// from being re-derived at two spawn sites (Windows goes through the process
/// launch gate, everything else through `Command::arg`).
pub(super) fn sidecar_node_args(entry: &Path) -> Vec<OsString> {
    node_args_with_limit(entry, heap_limit_mb())
}

/// The vector builder itself, with the ceiling passed in.
///
/// Split out only so the tests can drive the REAL builder at a limit no host
/// defaults to. Asserting against the shipped 4096 alone is vacuous on a machine
/// whose V8 default already sits at ~4.3 GB: deleting the flag entirely would
/// still report a ~4 GB ceiling and the assertion would hold. Verified — that
/// mutation passed the shipped-value check and was caught only here.
fn node_args_with_limit(entry: &Path, limit_mb: u32) -> Vec<OsString> {
    vec![
        OsString::from(format!("--max-old-space-size={limit_mb}")),
        entry.as_os_str().to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::Command;

    /// A node script that prints V8's actual old-space ceiling for its own
    /// process, so the assertions below observe the limit that is IN EFFECT
    /// rather than the flag we hoped would take.
    fn heap_limit_probe() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cave-heap-limit-probe-{}-{:?}.mjs",
            std::process::id(),
            std::thread::current().id()
        ));
        let mut file = std::fs::File::create(&path).expect("write heap limit probe");
        file.write_all(
            b"import { getHeapStatistics } from 'node:v8';\n\
              process.stdout.write(String(getHeapStatistics().heap_size_limit));\n",
        )
        .expect("write heap limit probe body");
        path
    }

    /// Runs `node <args>` and returns the heap_size_limit the child reported, in
    /// MiB. Node is a hard dependency of this repository's toolchain, so an
    /// absent `node` is a failure rather than a skip — a skip here would make
    /// the whole assertion vacuous, which is the failure mode this test exists
    /// to avoid.
    fn reported_limit_mb(args: &[OsString]) -> u64 {
        let output = Command::new("node")
            .args(args)
            .output()
            .expect("node must be on PATH to verify the sidecar heap cap");
        assert!(
            output.status.success(),
            "node exited {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let bytes: u64 = stdout
            .trim()
            .parse()
            .unwrap_or_else(|_| panic!("probe printed {stdout:?}, not a byte count"));
        bytes / (1024 * 1024)
    }

    #[test]
    fn overrides_are_parsed_within_bounds() {
        assert_eq!(parse_heap_limit_mb("2048"), Some(2048));
        assert_eq!(parse_heap_limit_mb("  2048  "), Some(2048), "whitespace is tolerated");
        assert_eq!(parse_heap_limit_mb("4096mb"), None, "units are not truncated away");
        assert_eq!(parse_heap_limit_mb("-1"), None);
        assert_eq!(parse_heap_limit_mb(""), None);
        assert_eq!(
            parse_heap_limit_mb(&(CAVE_HEAP_LIMIT_MIN_MB - 1).to_string()),
            None,
            "below the floor a typo would break ordinary traffic"
        );
        assert_eq!(parse_heap_limit_mb(&CAVE_HEAP_LIMIT_MIN_MB.to_string()), Some(CAVE_HEAP_LIMIT_MIN_MB));
        assert_eq!(parse_heap_limit_mb(&CAVE_HEAP_LIMIT_MAX_MB.to_string()), Some(CAVE_HEAP_LIMIT_MAX_MB));
        assert_eq!(parse_heap_limit_mb(&(CAVE_HEAP_LIMIT_MAX_MB as u64 + 1).to_string()), None);
    }

    #[test]
    fn the_flag_precedes_the_entry_path() {
        let entry = PathBuf::from("/opt/cave/server.mjs");
        let args = sidecar_node_args(&entry);
        assert_eq!(args.len(), 2);
        assert_eq!(args[1], entry.as_os_str(), "the entry must come last");
        assert!(
            args[0].to_string_lossy().starts_with("--max-old-space-size="),
            "a V8 flag after the script path is handed to the script, not to V8"
        );
    }

    /// The assertion that matters: a process launched with what
    /// `sidecar_node_args` produced really is capped at the number we chose.
    #[test]
    fn a_process_launched_with_these_args_is_actually_capped() {
        let probe = heap_limit_probe();
        let args = sidecar_node_args(&probe);
        let reported = reported_limit_mb(&args);
        let _ = std::fs::remove_file(&probe);

        // heap_size_limit is old space PLUS the young generation, so it reads a
        // little above the requested old-space size. Bound it on both sides:
        // at least what we asked for, and not so far above that the flag was
        // plainly ignored. Compare against the RESOLVED limit rather than the
        // constant, so a machine that happens to export an override is testing
        // the same property instead of failing on the default.
        let requested = u64::from(heap_limit_mb());
        assert!(
            reported >= requested,
            "requested {requested} MiB of old space, child reported a {reported} MiB limit"
        );
        assert!(
            reported < requested + 512,
            "child reported {reported} MiB against a {requested} MiB request — the flag did not take"
        );
    }

    /// The previous test cannot fail on a host whose V8 default already sits at
    /// ~4.3 GB — deleting the flag outright still reports a ~4 GB ceiling, and
    /// that mutation did pass it. So drive the SAME builder at limits nothing
    /// defaults to and watch the running process follow.
    #[test]
    fn the_builders_output_drives_the_limit_rather_than_the_host_default() {
        let probe = heap_limit_probe();
        let small = reported_limit_mb(&node_args_with_limit(&probe, 512));
        let large = reported_limit_mb(&node_args_with_limit(&probe, 3000));
        let _ = std::fs::remove_file(&probe);

        assert!((512..1024).contains(&small), "a 512 MiB request reported {small} MiB");
        assert!((3000..3512).contains(&large), "a 3000 MiB request reported {large} MiB");
        assert!(large > small, "the limit must track the request");
    }

    /// And the shipped path really does hand the resolved ceiling to that
    /// builder, rather than some other number that happens to be nearby.
    #[test]
    fn the_shipped_args_carry_the_resolved_ceiling() {
        let entry = PathBuf::from("/opt/cave/server.mjs");
        assert_eq!(
            sidecar_node_args(&entry),
            node_args_with_limit(&entry, heap_limit_mb())
        );
    }

    /// The ordering contract, verified against a real process rather than by
    /// reading the argv back. A flag placed after the entry is swallowed as a
    /// script argument, and the child runs on the host default.
    #[test]
    fn a_flag_after_the_entry_path_does_not_cap_the_process() {
        let probe = heap_limit_probe();
        let capped = reported_limit_mb(&[
            OsString::from("--max-old-space-size=512"),
            probe.as_os_str().to_owned(),
        ]);
        let ignored = reported_limit_mb(&[
            probe.as_os_str().to_owned(),
            OsString::from("--max-old-space-size=512"),
        ]);
        let _ = std::fs::remove_file(&probe);

        assert!(
            ignored > capped,
            "a 512 MiB flag after the entry reported {ignored} MiB, the same as before it \
             ({capped} MiB) — the ordering contract this module encodes would be untested"
        );
    }
}
