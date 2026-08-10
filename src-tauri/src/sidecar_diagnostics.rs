use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use std::fs;
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

fn append_bounded_event(path: &Path, event: &Value) -> Result<(), std::io::Error> {
    let _guard = DIAGNOSTIC_FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut bytes = fs::read(path).unwrap_or_default();
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
    fs::write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_event_is_structured_and_contains_no_raw_error_text() {
        let context = SidecarDiagnosticContext::new(
            "sidecar-recovery",
            2,
            "0.2.5".to_string(),
            None,
        );
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
}
