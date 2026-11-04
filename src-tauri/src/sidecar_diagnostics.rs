use super::reliability_metrics::write_private_atomic;
use fs2::FileExt;
use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub(super) const CORRELATION_ID_ENV: &str = "COVEN_CAVE_CORRELATION_ID";
pub(super) const DIAGNOSTIC_GENERATION_ENV: &str = "COVEN_CAVE_DIAGNOSTIC_GENERATION";
pub(super) const DIAGNOSTIC_OPERATION_ENV: &str = "COVEN_CAVE_DIAGNOSTIC_OPERATION";
pub(super) const DIAGNOSTIC_ATTEMPT_ENV: &str = "COVEN_CAVE_DIAGNOSTIC_ATTEMPT";
pub(super) const NATIVE_VERSION_ENV: &str = "COVEN_CAVE_NATIVE_VERSION";
pub(super) const NATIVE_PROTOCOL_VERSION_ENV: &str = "COVEN_CAVE_NATIVE_PROTOCOL_VERSION";
pub(super) const NATIVE_DIAGNOSTICS_FILE_ENV: &str = "COVEN_CAVE_NATIVE_DIAGNOSTICS_FILE";
pub(super) const NATIVE_DIAGNOSTICS_FILE_NAME: &str = "daemon-diagnostics.jsonl";

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
static DIAGNOSTIC_FILE_LOCK: Mutex<()> = Mutex::new(());
const MAX_NATIVE_DIAGNOSTIC_BYTES: usize = 256 * 1024;

pub(super) struct SidecarDiagnosticContext {
    pub(super) correlation_id: String,
    pub(super) generation: u64,
    pub(super) operation: &'static str,
    pub(super) attempt: u32,
    pub(super) cave_version: String,
    pub(super) diagnostics_file: Option<PathBuf>,
    current_phase: Mutex<&'static str>,
    started_at: Instant,
}

impl SidecarDiagnosticContext {
    pub(super) fn new(
        operation: &'static str,
        attempt: u32,
        cave_version: String,
        diagnostics_file: Option<PathBuf>,
    ) -> Self {
        let mut bytes = [0_u8; 16];
        OsRng.fill_bytes(&mut bytes);
        let correlation_id = bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Self {
            correlation_id,
            generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
            operation,
            attempt: attempt.max(1),
            cave_version,
            diagnostics_file,
            current_phase: Mutex::new("startup"),
            started_at: Instant::now(),
        }
    }

    pub(super) fn current_phase(&self) -> &'static str {
        *self
            .current_phase
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn event_value(
        &self,
        phase: &'static str,
        outcome: &'static str,
        endpoint_classification: &'static str,
        error_classification: Option<&'static str>,
        os_error_code: Option<i32>,
    ) -> Value {
        let timestamp_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default();
        json!({
            "schemaVersion": 1,
            "eventId": format!(
                "{}:{}:native:{}:{}:{}",
                self.correlation_id,
                self.generation,
                phase,
                outcome,
                timestamp_unix_ms,
            ),
            "correlationId": self.correlation_id,
            "generation": self.generation,
            "timestampUnixMs": timestamp_unix_ms,
            "component": "tauri",
            "operation": self.operation,
            "phase": phase,
            "attempt": self.attempt,
            "durationMs": self.started_at.elapsed().as_millis(),
            "outcome": outcome,
            "process": {
                "pid": std::process::id(),
                "platformBirthId": Value::Null,
            },
            "versions": {
                "cave": self.cave_version,
                "protocol": "1",
            },
            "endpoint": {
                "kind": "loopback-http",
                "classification": endpoint_classification,
                "status": Value::Null,
            },
            "error": error_classification.map(|classification| json!({
                "classification": classification,
                "code": os_error_code,
                "message": Value::Null,
            })),
        })
    }

    pub(super) fn record(
        &self,
        phase: &'static str,
        outcome: &'static str,
        endpoint_classification: &'static str,
        error_classification: Option<&'static str>,
        os_error_code: Option<i32>,
    ) {
        *self
            .current_phase
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = phase;
        let event = self.event_value(
            phase,
            outcome,
            endpoint_classification,
            error_classification,
            os_error_code,
        );
        log::info!(
            target: "coven_sidecar_diagnostics",
            "{}",
            event
        );
        if let Some(path) = self.diagnostics_file.as_deref() {
            if append_bounded_event(path, &event).is_err() {
                log::warn!("[cave] native diagnostic event retention was unavailable");
            }
        }
    }

    pub(super) fn record_io_error(
        &self,
        phase: &'static str,
        endpoint_classification: &'static str,
        error: &std::io::Error,
    ) {
        self.record(
            phase,
            "failed",
            endpoint_classification,
            Some("os-error"),
            error.raw_os_error(),
        );
    }
}

/// Keep raw failure text on the local error surface, not in retained telemetry.
/// The durable record uses the same redacted schema as sidecar lifecycle events.
pub(super) fn startup_failure_message(
    cause: &str,
    path: Option<&Path>,
    version: &str,
    phase: &'static str,
) -> String {
    let saved = path.and_then(|path| {
        let context = SidecarDiagnosticContext::new(
            "startup",
            1,
            version.to_string(),
            Some(path.to_path_buf()),
        );
        let event = context.event_value(
            phase,
            "failed",
            "unavailable",
            Some("startup-failure"),
            None,
        );
        append_bounded_event(path, &event).ok().map(|()| path)
    });
    match saved {
        Some(path) => format!("{cause}\n\nStartup diagnostics: {}", path.display()),
        None => format!("{cause}\n\nStartup diagnostics could not be saved. Check that your local application data folder is writable."),
    }
}

// Keep the lock in a stable sibling: the diagnostic file itself is atomically
// replaced, so locking its old inode would not serialize other processes.
struct NativeDiagnosticLock(fs::File);

impl Drop for NativeDiagnosticLock {
    fn drop(&mut self) {
        // A concurrent fork can retain the open file description until exec.
        // Explicit unlock ends this operation even while that duplicate lives.
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

fn lock_native_diagnostics(path: &Path) -> Result<NativeDiagnosticLock, String> {
    let parent = path
        .parent()
        .ok_or("native diagnostics path has no parent")?;
    fs::create_dir_all(parent).map_err(|_| "could not create native diagnostics directory")?;
    let lock_path = path.with_extension("jsonl.lock");
    if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
        if !metadata.file_type().is_file() {
            return Err("native diagnostics lock is not a regular file".into());
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(lock_path)
        .map_err(|_| "could not open native diagnostics lock")?;
    // Diagnostics must never hold up startup or recovery waiting for another
    // process. Contention is a best-effort logging failure, not permission to
    // overwrite a writer's data. Closing the handle releases the OS lock.
    file.try_lock_exclusive()
        .map_err(|_| "native diagnostics are busy or unavailable")?;
    Ok(NativeDiagnosticLock(file))
}

pub(super) fn retain_native_diagnostics_file(path: &Path) -> Result<(), String> {
    let _guard = DIAGNOSTIC_FILE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let _file_lock = lock_native_diagnostics(path)?;
    let bytes = read_bounded_event_file(path)?;
    write_private_atomic(path, &bytes)
}

fn read_bounded_event_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("could not inspect native diagnostics".into()),
    };
    if !metadata.file_type().is_file() {
        return Err("native diagnostics are not a regular file".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "could not read native diagnostics")?;
    let size = file
        .metadata()
        .map_err(|_| "could not inspect opened native diagnostics")?
        .len();
    let keep = size.min(MAX_NATIVE_DIAGNOSTIC_BYTES as u64);
    file.seek(SeekFrom::End(-(keep as i64)))
        .map_err(|_| "could not seek native diagnostics")?;
    let mut bytes = Vec::with_capacity(keep as usize);
    file.take(keep)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not read native diagnostics")?;
    if size > keep {
        // The retained tail may begin inside an event. Drop that partial line.
        let start = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|offset| offset + 1)
            .unwrap_or(bytes.len());
        bytes.drain(..start);
    }
    Ok(bytes)
}

fn append_bounded_event(path: &Path, event: &Value) -> Result<(), String> {
    let _guard = DIAGNOSTIC_FILE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let _file_lock = lock_native_diagnostics(path)?;
    let mut bytes = read_bounded_event_file(path)?;
    bytes.extend_from_slice(event.to_string().as_bytes());
    bytes.push(b'\n');
    if bytes.len() > MAX_NATIVE_DIAGNOSTIC_BYTES {
        let target = bytes.len() - MAX_NATIVE_DIAGNOSTIC_BYTES;
        let start = bytes[target..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|offset| target + offset + 1)
            .unwrap_or(target);
        bytes.drain(..start);
    }
    write_private_atomic(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_event_is_structured_and_contains_no_raw_error_text() {
        let context =
            SidecarDiagnosticContext::new("sidecar-recovery", 2, "0.2.5".to_string(), None);
        let serialized = context
            .event_value(
                "startup",
                "failed",
                "spawn-failed",
                Some("os-error"),
                Some(13),
            )
            .to_string();

        assert_eq!(context.correlation_id.len(), 32);
        assert!(context
            .correlation_id
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert!(serialized.contains(r#""operation":"sidecar-recovery""#));
        assert!(serialized.contains(r#""attempt":2"#));
        assert!(serialized.contains(r#""classification":"os-error""#));
        assert!(serialized.contains(r#""code":13"#));
        assert!(!serialized.contains("/Users/"));
        assert!(!serialized.contains("token="));

        context.record(
            "sidecar-spawn",
            "failed",
            "spawn-failed",
            Some("os-error"),
            Some(13),
        );
        assert_eq!(context.current_phase(), "sidecar-spawn");
    }

    #[test]
    fn native_event_file_retention_is_bounded_on_complete_lines() {
        let path = std::env::temp_dir().join(format!(
            "coven-sidecar-diagnostics-{}-{}.jsonl",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
        ));
        let large = json!({
            "schemaVersion": 1,
            "eventId": "bounded-test",
            "padding": "x".repeat(8_192),
        });
        for _ in 0..64 {
            append_bounded_event(&path, &large).expect("append bounded event");
        }
        let retained = fs::read(&path).expect("read bounded events");
        assert!(retained.len() <= MAX_NATIVE_DIAGNOSTIC_BYTES);
        assert_eq!(retained.first(), Some(&b'{'));
        assert_eq!(retained.last(), Some(&b'\n'));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn native_event_append_caps_a_preexisting_oversized_file_before_reading_it() {
        let path = std::env::temp_dir().join(format!(
            "coven-sidecar-diagnostics-oversized-{}-{}.jsonl",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
        ));
        let oversized = format!("{}\n", "x".repeat(MAX_NATIVE_DIAGNOSTIC_BYTES * 2));
        fs::write(&path, oversized).expect("write oversized diagnostics fixture");

        append_bounded_event(&path, &json!({ "eventId": "newest" }))
            .expect("append bounded event after oversized input");

        let retained = fs::read(&path).expect("read retained diagnostics");
        assert!(retained.len() <= MAX_NATIVE_DIAGNOSTIC_BYTES);
        assert!(
            String::from_utf8_lossy(&retained).contains("\"eventId\":\"newest\""),
            "the newest event must survive bounded tail retention"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn failure_surface_identifies_saved_log_without_retaining_raw_cause() {
        let root = std::env::temp_dir().join(format!(
            "c5979-failure-{}-{}",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("events.jsonl");
        let cause = "WebView2 failed: secret-test-token";
        let message = startup_failure_message(cause, Some(&path), "1.2.3", "native-setup");
        assert!(message.contains(cause));
        assert!(message.contains(path.to_str().unwrap()));
        let stored = fs::read_to_string(&path).unwrap();
        assert!(stored.contains("native-setup"));
        assert!(stored.contains("startup-failure"));
        assert!(!stored.contains("secret-test-token"));
        retain_native_diagnostics_file(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), stored);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failure_surface_does_not_claim_an_unsaved_log_exists() {
        let message =
            startup_failure_message("window creation failed", None, "1.2.3", "native-setup");
        assert!(message.contains("window creation failed"));
        assert!(message.contains("could not be saved"));
        assert!(!message.contains("Startup diagnostics:"));
    }

    #[test]
    fn completed_diagnostic_lock_releases_even_with_a_duplicated_handle() {
        let root = std::env::temp_dir().join(format!(
            "c5979-inherited-lock-{}-{}",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("events.jsonl");
        let owner = lock_native_diagnostics(&path).unwrap();
        // A concurrent Unix process spawn can briefly inherit the open file
        // description before exec closes it. A duplicate models its lifetime.
        let inherited = owner.0.try_clone().unwrap();
        drop(owner);
        retain_native_diagnostics_file(&path)
            .expect("completed operation explicitly releases its lock");
        drop(inherited);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn contended_diagnostics_preserve_existing_data_without_waiting() {
        let root = std::env::temp_dir().join(format!(
            "c5979-lock-{}-{}",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("events.jsonl");
        append_bounded_event(&path, &json!({"eventId": "original"})).unwrap();
        let before = fs::read(&path).unwrap();
        let owner = lock_native_diagnostics(&path).unwrap();
        assert!(retain_native_diagnostics_file(&path).is_err());
        assert!(append_bounded_event(&path, &json!({"eventId": "contender"})).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        drop(owner);
        append_bounded_event(&path, &json!({"eventId": "recovered"})).unwrap();
        let events = fs::read_to_string(&path).unwrap();
        assert!(events.contains("original") && events.contains("recovered"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unreadable_diagnostic_shape_is_not_replaced_on_startup() {
        let root = std::env::temp_dir().join(format!(
            "c5979-shape-{}-{}",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
        ));
        let path = root.join("events.jsonl");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("sentinel"), b"keep").unwrap();
        assert!(retain_native_diagnostics_file(&path).is_err());
        assert!(append_bounded_event(&path, &json!({"eventId": "new"})).is_err());
        assert_eq!(fs::read(path.join("sentinel")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn app_start_preserves_native_events_from_prior_processes() {
        let path = std::env::temp_dir().join(format!(
            "coven-sidecar-diagnostics-reset-{}-{}.jsonl",
            std::process::id(),
            NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
        ));
        append_bounded_event(&path, &json!({ "eventId": "prior-launch" }))
            .expect("write prior launch event");

        retain_native_diagnostics_file(&path).expect("retain native diagnostics");

        let retained = fs::read_to_string(&path).expect("read retained diagnostics");
        assert!(
            retained.contains("prior-launch"),
            "startup must retain prior failure evidence: {retained}"
        );
        let _ = fs::remove_file(path);
    }
}
