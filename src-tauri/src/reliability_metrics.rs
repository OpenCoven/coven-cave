use super::*;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const RELIABILITY_SCHEMA_VERSION: u8 = 1;
pub(super) const RELIABILITY_RECORD_LIMIT: usize = 512;
pub(super) const RELIABILITY_BYTE_LIMIT: usize = 256 * 1024;
pub(super) const RELIABILITY_MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const RELIABILITY_FILE: &str = "daemon-reliability-v1.json";
const RELIABILITY_BACKUP_LIMIT: usize = 4;
const RELIABILITY_BACKUP_MIN_STALE_AGE_MS: u64 = 5 * 60 * 1_000;
const RELIABILITY_BACKUP_MAX_AGE_MS: u64 = RELIABILITY_MAX_AGE_MS;
const MAX_DURATION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_DELAY_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_COUNTER: u32 = 1_000;
static NEXT_STAGING_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ReliabilityOperation {
    NativeStartup,
    FrontendReconnect,
    SupervisedRecovery,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ReliabilityOutcome {
    Success,
    Failure,
    Blocked,
    Cancelled,
    Unverified,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ReliabilityFailureClass {
    Contention,
    Compatibility,
    Permissions,
    Transport,
    Authentication,
    Timeout,
    ProcessExit,
    Cancellation,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ReliabilityReadiness {
    Authenticated,
    Transport,
    None,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReliabilitySource {
    Native,
    Frontend,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct FrontendReliabilityInput {
    operation: ReliabilityOperation,
    outcome: ReliabilityOutcome,
    failure_class: Option<ReliabilityFailureClass>,
    readiness: ReliabilityReadiness,
    duration_ms: u64,
    attempts: u32,
    backoff_ms: u64,
    timeout_ms: u64,
    crash_count: u32,
    restart_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ReliabilityMeasurementInput {
    pub(super) operation: ReliabilityOperation,
    pub(super) outcome: ReliabilityOutcome,
    pub(super) failure_class: Option<ReliabilityFailureClass>,
    pub(super) readiness: ReliabilityReadiness,
    pub(super) duration_ms: u64,
    pub(super) attempts: u32,
    pub(super) backoff_ms: u64,
    pub(super) timeout_ms: u64,
    pub(super) crash_count: u32,
    pub(super) restart_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum NativeStartupTerminalEvidence {
    AuthenticatedReady,
    TransportReady,
    Cancelled,
    Failed(ReliabilityFailureClass),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReliabilityMeasurement {
    schema_version: u8,
    recorded_at_unix_ms: u64,
    source: ReliabilitySource,
    operation: ReliabilityOperation,
    outcome: ReliabilityOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_class: Option<ReliabilityFailureClass>,
    readiness: ReliabilityReadiness,
    duration_ms: u64,
    attempts: u32,
    backoff_ms: u64,
    timeout_ms: u64,
    crash_count: u32,
    restart_count: u32,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReliabilityStore {
    schema_version: u8,
    records: Vec<ReliabilityMeasurement>,
}

#[derive(Default)]
struct RecorderState {
    path: Option<PathBuf>,
}

#[derive(Default)]
pub(super) struct ReliabilityRecorder {
    state: Mutex<RecorderState>,
    warned: AtomicBool,
}

impl ReliabilityRecorder {
    pub(super) fn configure(&self, app_data_dir: PathBuf) {
        let path = app_data_dir.join(RELIABILITY_FILE);
        match self.state.lock() {
            Ok(mut state) => state.path = Some(path.clone()),
            Err(_) => {
                self.warn_once();
                return;
            }
        }
        let now = unix_time_ms();
        let cleanup_failed = cleanup_stale_backups(&path, now).is_err();
        let prune_failed = prune_store(&path, now).is_err();
        if cleanup_failed || prune_failed {
            self.warn_once();
        }
    }

    fn record(&self, input: ReliabilityMeasurementInput, source: ReliabilitySource) {
        let now = unix_time_ms();
        let mut cleanup_failed = false;
        let result = self
            .state
            .lock()
            .map_err(|_| "reliability recorder lock is poisoned".to_string())
            .and_then(|state| {
                let path = state
                    .path
                    .as_ref()
                    .ok_or_else(|| "reliability recorder is not configured".to_string())?;
                cleanup_failed = cleanup_stale_backups(path, now).is_err();
                append_measurement(path, input, source, now)
            });
        if cleanup_failed || result.is_err() {
            self.warn_once();
        }
    }

    fn warn_once(&self) {
        if !self.warned.swap(true, Ordering::AcqRel) {
            log::warn!("[cave] daemon reliability measurement persistence is unavailable");
        }
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn normalized_measurement(
    input: ReliabilityMeasurementInput,
    source: ReliabilitySource,
    recorded_at_unix_ms: u64,
) -> ReliabilityMeasurement {
    let outcome = if input.failure_class == Some(ReliabilityFailureClass::Contention) {
        ReliabilityOutcome::Blocked
    } else if input.outcome == ReliabilityOutcome::Success
        && input.readiness != ReliabilityReadiness::Authenticated
    {
        ReliabilityOutcome::Unverified
    } else {
        input.outcome
    };
    let readiness = match outcome {
        ReliabilityOutcome::Success => ReliabilityReadiness::Authenticated,
        ReliabilityOutcome::Unverified if input.readiness == ReliabilityReadiness::Transport => {
            ReliabilityReadiness::Transport
        }
        _ => ReliabilityReadiness::None,
    };
    ReliabilityMeasurement {
        schema_version: RELIABILITY_SCHEMA_VERSION,
        recorded_at_unix_ms,
        source,
        operation: input.operation,
        outcome,
        failure_class: if outcome == ReliabilityOutcome::Success {
            None
        } else {
            input.failure_class
        },
        readiness,
        duration_ms: input.duration_ms.min(MAX_DURATION_MS),
        attempts: input.attempts.min(MAX_COUNTER),
        backoff_ms: input.backoff_ms.min(MAX_DELAY_MS),
        timeout_ms: input.timeout_ms.min(MAX_DELAY_MS),
        crash_count: input.crash_count.min(MAX_COUNTER),
        restart_count: input.restart_count.min(MAX_COUNTER),
    }
}

fn empty_store() -> ReliabilityStore {
    ReliabilityStore {
        schema_version: RELIABILITY_SCHEMA_VERSION,
        records: Vec::new(),
    }
}

fn load_store(path: &Path) -> Result<ReliabilityStore, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.len() > RELIABILITY_BYTE_LIMIT as u64 => {
            return Err("reliability records exceed the storage budget".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(empty_store()),
        Err(_) => return Err("could not inspect reliability records".to_string()),
    }
    let raw = std::fs::read(path).map_err(|_| "could not read reliability records".to_string())?;
    let store = serde_json::from_slice::<ReliabilityStore>(&raw)
        .map_err(|_| "could not parse reliability records".to_string())?;
    if store.schema_version != RELIABILITY_SCHEMA_VERSION {
        return Err("reliability record schema is unsupported".to_string());
    }
    Ok(store)
}

fn prune_records(
    store: &mut ReliabilityStore,
    recorded_at_unix_ms: u64,
) -> Result<Vec<u8>, String> {
    let oldest_allowed = recorded_at_unix_ms.saturating_sub(RELIABILITY_MAX_AGE_MS);
    store
        .records
        .retain(|record| record.recorded_at_unix_ms >= oldest_allowed);
    if store.records.len() > RELIABILITY_RECORD_LIMIT {
        let overflow = store.records.len() - RELIABILITY_RECORD_LIMIT;
        store.records.drain(..overflow);
    }
    let mut json = serialized_store_within_limit(store)?;
    while json.len() > RELIABILITY_BYTE_LIMIT && store.records.len() > 1 {
        store.records.remove(0);
        json = serialized_store_within_limit(store)?;
    }
    if json.len() > RELIABILITY_BYTE_LIMIT {
        return Err("reliability record exceeds the storage budget".to_string());
    }
    Ok(json)
}

fn prune_store(path: &Path, recorded_at_unix_ms: u64) -> Result<(), String> {
    match std::fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("could not inspect reliability records".to_string()),
        Ok(_) => {}
    }
    let mut store = load_store(path)?;
    let original = serde_json::to_vec(&store)
        .map_err(|_| "could not serialize reliability records".to_string())?;
    let json = prune_records(&mut store, recorded_at_unix_ms)?;
    if json != original {
        write_private_atomic(path, &json)?;
    }
    Ok(())
}

fn serialized_store_within_limit(store: &ReliabilityStore) -> Result<Vec<u8>, String> {
    serde_json::to_vec(store).map_err(|_| "could not serialize reliability records".to_string())
}

fn append_measurement(
    path: &Path,
    input: ReliabilityMeasurementInput,
    source: ReliabilitySource,
    recorded_at_unix_ms: u64,
) -> Result<(), String> {
    let mut store = load_store(path)?;
    store
        .records
        .push(normalized_measurement(input, source, recorded_at_unix_ms));
    let json = prune_records(&mut store, recorded_at_unix_ms)?;
    write_private_atomic(path, &json)
}

fn unique_sibling_path(path: &Path, kind: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "reliability path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "reliability path has no file name".to_string())?
        .to_string_lossy();
    let sequence = NEXT_STAGING_FILE.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        "{file_name}.{kind}-{}-{sequence}",
        std::process::id()
    )))
}

#[derive(Debug, PartialEq, Eq)]
struct ReliabilityBackupCandidate {
    path: PathBuf,
    modified_unix_ms: u64,
}

fn is_reliability_backup_sibling(path: &Path, candidate_name: &std::ffi::OsStr) -> bool {
    is_reliability_sibling(path, candidate_name, "bak")
}

fn is_reliability_staging_sibling(path: &Path, candidate_name: &std::ffi::OsStr) -> bool {
    is_reliability_sibling(path, candidate_name, "tmp")
}

fn is_reliability_sibling(path: &Path, candidate_name: &std::ffi::OsStr, kind: &str) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(candidate_name) = candidate_name.to_str() else {
        return false;
    };
    let prefix = format!("{file_name}.{kind}-");
    let Some(suffix) = candidate_name.strip_prefix(&prefix) else {
        return false;
    };
    let Some((process_id, sequence)) = suffix.split_once('-') else {
        return false;
    };
    !process_id.is_empty()
        && !sequence.is_empty()
        && process_id.bytes().all(|byte| byte.is_ascii_digit())
        && sequence.bytes().all(|byte| byte.is_ascii_digit())
}

fn stale_reliability_backups(
    mut candidates: Vec<ReliabilityBackupCandidate>,
    recorded_at_unix_ms: u64,
) -> Vec<PathBuf> {
    candidates.sort_by(|left, right| {
        right
            .modified_unix_ms
            .cmp(&left.modified_unix_ms)
            .then_with(|| left.path.cmp(&right.path))
    });
    candidates
        .into_iter()
        .filter(|candidate| {
            recorded_at_unix_ms.saturating_sub(candidate.modified_unix_ms)
                >= RELIABILITY_BACKUP_MIN_STALE_AGE_MS
        })
        .enumerate()
        .filter_map(|(index, candidate)| {
            let age = recorded_at_unix_ms.saturating_sub(candidate.modified_unix_ms);
            (age > RELIABILITY_BACKUP_MAX_AGE_MS || index >= RELIABILITY_BACKUP_LIMIT)
                .then_some(candidate.path)
        })
        .collect()
}

fn cleanup_stale_backups(path: &Path, recorded_at_unix_ms: u64) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "reliability path has no parent".to_string())?;
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("could not inspect reliability backups".to_string()),
    };
    let mut candidates = Vec::new();
    let mut failed = false;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        if !is_reliability_backup_sibling(path, &entry.file_name())
            && !is_reliability_staging_sibling(path, &entry.file_name())
        {
            continue;
        }
        match entry.file_type() {
            Ok(file_type) if file_type.is_file() => {}
            Ok(_) => continue,
            Err(_) => {
                failed = true;
                continue;
            }
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        let modified_unix_ms = metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        candidates.push(ReliabilityBackupCandidate {
            path: entry.path(),
            modified_unix_ms,
        });
    }
    for backup in stale_reliability_backups(candidates, recorded_at_unix_ms) {
        match std::fs::remove_file(backup) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => failed = true,
        }
    }
    if failed {
        Err("could not clean reliability backups".to_string())
    } else {
        Ok(())
    }
}

#[cfg(any(windows, test))]
fn replace_staged_file_preserving_existing_with<R, C>(
    path: &Path,
    temp: &Path,
    backup: &Path,
    mut rename: R,
    mut copy: C,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> std::io::Result<()>,
    C: FnMut(&Path, &Path) -> std::io::Result<u64>,
{
    let had_existing = match rename(path, backup) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err("could not stage existing reliability records".to_string()),
    };
    if rename(temp, path).is_err() {
        if had_existing && rename(backup, path).is_err() {
            copy(backup, path).map_err(|_| {
                "could not restore reliability records after replacement failed".to_string()
            })?;
            let _ = std::fs::remove_file(backup);
        }
        return Err("could not replace reliability records".to_string());
    }
    if had_existing {
        std::fs::remove_file(backup)
            .map_err(|_| "could not remove reliability backup".to_string())?;
    }
    Ok(())
}

fn write_private_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "reliability path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "could not create reliability storage directory".to_string())?;
    let temp = unique_sibling_path(path, "tmp")?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|_| "could not open reliability staging file".to_string())?;
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "could not secure reliability staging file".to_string())?;
        }
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|_| "could not write reliability staging file".to_string())?;
        drop(file);

        #[cfg(windows)]
        {
            let backup = unique_sibling_path(path, "bak")?;
            replace_staged_file_preserving_existing_with(
                path,
                &temp,
                &backup,
                |from, to| std::fs::rename(from, to),
                |from, to| std::fs::copy(from, to),
            )?;
        }
        #[cfg(not(windows))]
        std::fs::rename(&temp, path)
            .map_err(|_| "could not replace reliability records".to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "could not secure reliability records".to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub(super) fn record_native_reliability(
    app: &tauri::AppHandle,
    input: ReliabilityMeasurementInput,
) {
    if let Some(recorder) = app.try_state::<Arc<ReliabilityRecorder>>() {
        recorder.record(input, ReliabilitySource::Native);
    }
}

fn native_startup_measurement(
    duration: Duration,
    evidence: NativeStartupTerminalEvidence,
) -> ReliabilityMeasurementInput {
    let (outcome, failure_class, readiness) = match evidence {
        NativeStartupTerminalEvidence::AuthenticatedReady => (
            ReliabilityOutcome::Success,
            None,
            ReliabilityReadiness::Authenticated,
        ),
        NativeStartupTerminalEvidence::TransportReady => (
            ReliabilityOutcome::Unverified,
            None,
            ReliabilityReadiness::Transport,
        ),
        NativeStartupTerminalEvidence::Cancelled => (
            ReliabilityOutcome::Cancelled,
            Some(ReliabilityFailureClass::Cancellation),
            ReliabilityReadiness::None,
        ),
        NativeStartupTerminalEvidence::Failed(failure_class) => (
            if failure_class == ReliabilityFailureClass::Contention {
                ReliabilityOutcome::Blocked
            } else {
                ReliabilityOutcome::Failure
            },
            Some(failure_class),
            ReliabilityReadiness::None,
        ),
    };
    ReliabilityMeasurementInput {
        operation: ReliabilityOperation::NativeStartup,
        outcome,
        failure_class,
        readiness,
        duration_ms: duration.as_millis().min(u128::from(u64::MAX)) as u64,
        attempts: 1,
        backoff_ms: 0,
        timeout_ms: sidecar_start_timeout()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64,
        crash_count: 0,
        restart_count: 0,
    }
}

pub(super) fn record_native_startup_terminal(
    app: &tauri::AppHandle,
    duration: Duration,
    evidence: NativeStartupTerminalEvidence,
) {
    record_native_reliability(app, native_startup_measurement(duration, evidence));
}

fn validate_frontend_operation(operation: ReliabilityOperation) -> Result<(), String> {
    if operation == ReliabilityOperation::FrontendReconnect {
        Ok(())
    } else {
        Err("invalid daemon reliability measurement".to_string())
    }
}

#[tauri::command]
pub(super) fn record_daemon_reliability_measurement(
    state: tauri::State<'_, Arc<ReliabilityRecorder>>,
    input: FrontendReliabilityInput,
) -> Result<(), String> {
    validate_frontend_operation(input.operation)?;
    state.record(
        ReliabilityMeasurementInput {
            operation: input.operation,
            outcome: input.outcome,
            failure_class: input.failure_class,
            readiness: input.readiness,
            duration_ms: input.duration_ms,
            attempts: input.attempts,
            backoff_ms: input.backoff_ms,
            timeout_ms: input.timeout_ms,
            crash_count: input.crash_count,
            restart_count: input.restart_count,
        },
        ReliabilitySource::Frontend,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);

    fn test_path(name: &str) -> PathBuf {
        let id = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
        PathBuf::from("target")
            .join("reliability-metrics-tests")
            .join(format!("{}-{}-{}", std::process::id(), id, name))
            .join(RELIABILITY_FILE)
    }

    fn input(outcome: ReliabilityOutcome) -> ReliabilityMeasurementInput {
        ReliabilityMeasurementInput {
            operation: ReliabilityOperation::NativeStartup,
            outcome,
            failure_class: None,
            readiness: ReliabilityReadiness::Transport,
            duration_ms: 10,
            attempts: 1,
            backoff_ms: 0,
            timeout_ms: 60_000,
            crash_count: 0,
            restart_count: 0,
        }
    }

    #[test]
    fn schema_rejects_arbitrary_diagnostic_text_and_locations() {
        let result = serde_json::from_value::<FrontendReliabilityInput>(serde_json::json!({
            "operation": "frontend_reconnect",
            "outcome": "failure",
            "failureClass": "transport",
            "readiness": "none",
            "durationMs": 1,
            "attempts": 1,
            "backoffMs": 0,
            "timeoutMs": 0,
            "crashCount": 0,
            "restartCount": 0,
            "url": "http://token@example.test/private",
            "error": "/Users/private/secret"
        }));
        assert!(result.is_err(), "unknown text fields must be rejected");
    }

    #[test]
    fn frontend_command_validation_rejects_non_frontend_operations_generically() {
        for operation in [
            ReliabilityOperation::NativeStartup,
            ReliabilityOperation::SupervisedRecovery,
        ] {
            assert_eq!(
                validate_frontend_operation(operation),
                Err("invalid daemon reliability measurement".to_string())
            );
        }
        assert_eq!(
            validate_frontend_operation(ReliabilityOperation::FrontendReconnect),
            Ok(())
        );
    }

    #[test]
    fn retention_enforces_age_and_record_limits() {
        let path = test_path("retention");
        append_measurement(
            &path,
            input(ReliabilityOutcome::Failure),
            ReliabilitySource::Native,
            1,
        )
        .unwrap();
        let now = RELIABILITY_MAX_AGE_MS + 10;
        for index in 0..(RELIABILITY_RECORD_LIMIT + 20) {
            append_measurement(
                &path,
                input(ReliabilityOutcome::Unverified),
                ReliabilitySource::Native,
                now + index as u64,
            )
            .unwrap();
        }
        let store: ReliabilityStore =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(store.schema_version, RELIABILITY_SCHEMA_VERSION);
        assert_eq!(store.records.len(), RELIABILITY_RECORD_LIMIT);
        assert!(store
            .records
            .iter()
            .all(|record| record.recorded_at_unix_ms > 1));
        assert!(std::fs::metadata(&path).unwrap().len() <= RELIABILITY_BYTE_LIMIT as u64);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_store_is_preserved_instead_of_treated_as_empty() {
        let path = test_path("invalid-store");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = b"{not valid json".to_vec();
        std::fs::write(&path, &original).unwrap();

        assert!(append_measurement(
            &path,
            input(ReliabilityOutcome::Failure),
            ReliabilitySource::Native,
            10,
        )
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn oversized_store_is_rejected_before_read_and_preserved() {
        let path = test_path("oversized-store");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = vec![b'x'; RELIABILITY_BYTE_LIMIT + 1];
        std::fs::write(&path, &original).unwrap();

        assert!(append_measurement(
            &path,
            input(ReliabilityOutcome::Failure),
            ReliabilitySource::Native,
            10,
        )
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn configure_prunes_expired_records_before_the_next_append() {
        let path = test_path("configure-prune");
        let now = unix_time_ms();
        let store = ReliabilityStore {
            schema_version: RELIABILITY_SCHEMA_VERSION,
            records: vec![
                normalized_measurement(
                    input(ReliabilityOutcome::Failure),
                    ReliabilitySource::Native,
                    now.saturating_sub(RELIABILITY_MAX_AGE_MS + 1),
                ),
                normalized_measurement(
                    input(ReliabilityOutcome::Unverified),
                    ReliabilitySource::Native,
                    now,
                ),
            ],
        };
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_vec(&store).unwrap()).unwrap();

        let recorder = ReliabilityRecorder::default();
        recorder.configure(path.parent().unwrap().to_path_buf());
        let store = load_store(&path).unwrap();
        assert_eq!(store.records.len(), 1);
        assert_eq!(store.records[0].recorded_at_unix_ms, now);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reliability_sibling_matching_is_exact_for_backups_and_staging_files() {
        use std::ffi::OsStr;

        let path = PathBuf::from("records").join(RELIABILITY_FILE);
        assert!(is_reliability_backup_sibling(
            &path,
            OsStr::new("daemon-reliability-v1.json.bak-42-7")
        ));
        assert!(is_reliability_staging_sibling(
            &path,
            OsStr::new("daemon-reliability-v1.json.tmp-42-7")
        ));
        for candidate in [
            RELIABILITY_FILE,
            "daemon-reliability-v1.json.bak-42",
            "daemon-reliability-v1.json.bak-42-7-extra",
            "other-daemon-reliability-v1.json.bak-42-7",
        ] {
            assert!(
                !is_reliability_backup_sibling(&path, OsStr::new(candidate)),
                "unexpected backup candidate: {candidate}"
            );
        }
    }

    #[test]
    fn stale_backup_selection_enforces_age_and_count_bounds() {
        let now = RELIABILITY_BACKUP_MAX_AGE_MS + 1_000_000;
        let candidate = |name: &str, age: u64| ReliabilityBackupCandidate {
            path: PathBuf::from(name),
            modified_unix_ms: now.saturating_sub(age),
        };
        let fresh = PathBuf::from("fresh");
        let over_limit_one = PathBuf::from("over-limit-1");
        let over_limit_two = PathBuf::from("over-limit-2");
        let expired = PathBuf::from("expired");
        let stale = stale_reliability_backups(
            vec![
                candidate(
                    fresh.to_str().unwrap(),
                    RELIABILITY_BACKUP_MIN_STALE_AGE_MS - 1,
                ),
                candidate("retained-1", RELIABILITY_BACKUP_MIN_STALE_AGE_MS),
                candidate("retained-2", RELIABILITY_BACKUP_MIN_STALE_AGE_MS + 1),
                candidate("retained-3", RELIABILITY_BACKUP_MIN_STALE_AGE_MS + 2),
                candidate("retained-4", RELIABILITY_BACKUP_MIN_STALE_AGE_MS + 3),
                candidate(
                    over_limit_one.to_str().unwrap(),
                    RELIABILITY_BACKUP_MIN_STALE_AGE_MS + 4,
                ),
                candidate(
                    over_limit_two.to_str().unwrap(),
                    RELIABILITY_BACKUP_MIN_STALE_AGE_MS + 5,
                ),
                candidate(expired.to_str().unwrap(), RELIABILITY_BACKUP_MAX_AGE_MS + 1),
            ],
            now,
        );

        assert!(!stale.contains(&fresh));
        assert!(stale.contains(&over_limit_one));
        assert!(stale.contains(&over_limit_two));
        assert!(stale.contains(&expired));
        assert_eq!(stale.len(), 3);
    }

    #[test]
    fn failed_replacement_cleans_up_unique_staging_file() {
        let path = test_path("replace-failure");
        std::fs::create_dir_all(&path).unwrap();

        assert!(write_private_atomic(&path, b"[]").is_err());
        let parent = path.parent().unwrap();
        let staging_prefix = format!("{RELIABILITY_FILE}.tmp-");
        assert!(std::fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(&staging_prefix)));
        let _ = std::fs::remove_dir_all(parent);
    }

    #[test]
    fn failed_replacement_and_rename_restore_preserve_existing_bytes() {
        let path = test_path("replacement-preserves-existing");
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        let temp = unique_sibling_path(&path, "tmp").unwrap();
        let backup = unique_sibling_path(&path, "bak").unwrap();
        let original = b"existing reliability bytes";
        std::fs::write(&path, original).unwrap();
        std::fs::write(&temp, b"replacement reliability bytes").unwrap();
        let mut rename_calls = 0;

        let result = replace_staged_file_preserving_existing_with(
            &path,
            &temp,
            &backup,
            |from, to| {
                rename_calls += 1;
                match rename_calls {
                    1 => std::fs::rename(from, to),
                    2 | 3 => Err(std::io::Error::other("injected rename failure")),
                    _ => unreachable!("unexpected rename call"),
                }
            },
            |from, to| std::fs::copy(from, to),
        );

        assert_eq!(
            result,
            Err("could not replace reliability records".to_string())
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let _ = std::fs::remove_dir_all(parent);
    }

    #[cfg(unix)]
    #[test]
    fn records_are_private_on_unix() {
        use std::os::unix::fs::PermissionsExt;

        let path = test_path("permissions");
        append_measurement(
            &path,
            input(ReliabilityOutcome::Unverified),
            ReliabilitySource::Native,
            10,
        )
        .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn stored_schema_contains_only_bounded_classified_fields() {
        let path = test_path("schema");
        let mut record = input(ReliabilityOutcome::Failure);
        record.failure_class = Some(ReliabilityFailureClass::Compatibility);
        record.duration_ms = u64::MAX;
        append_measurement(&path, record, ReliabilitySource::Native, 10).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let stored = &value["records"][0];
        assert_eq!(stored["schemaVersion"], RELIABILITY_SCHEMA_VERSION);
        assert_eq!(stored["failureClass"], "compatibility");
        assert_eq!(stored["durationMs"], MAX_DURATION_MS);
        assert!(stored.get("url").is_none());
        assert!(stored.get("error").is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transport_only_success_is_normalized_to_unverified() {
        let stored = normalized_measurement(
            ReliabilityMeasurementInput {
                outcome: ReliabilityOutcome::Success,
                ..input(ReliabilityOutcome::Success)
            },
            ReliabilitySource::Native,
            10,
        );
        assert_eq!(stored.outcome, ReliabilityOutcome::Unverified);
        assert_eq!(stored.readiness, ReliabilityReadiness::Transport);
    }

    #[test]
    fn native_startup_terminal_evidence_is_one_replaceable_measurement() {
        let transport = native_startup_measurement(
            Duration::from_millis(750),
            NativeStartupTerminalEvidence::TransportReady,
        );
        assert_eq!(transport.outcome, ReliabilityOutcome::Unverified);
        assert_eq!(transport.readiness, ReliabilityReadiness::Transport);

        let authenticated = native_startup_measurement(
            Duration::from_millis(750),
            NativeStartupTerminalEvidence::AuthenticatedReady,
        );
        assert_eq!(authenticated.outcome, ReliabilityOutcome::Success);
        assert_eq!(authenticated.readiness, ReliabilityReadiness::Authenticated);
    }

    #[test]
    fn contention_is_normalized_to_blocked() {
        let stored = normalized_measurement(
            ReliabilityMeasurementInput {
                outcome: ReliabilityOutcome::Failure,
                failure_class: Some(ReliabilityFailureClass::Contention),
                ..input(ReliabilityOutcome::Failure)
            },
            ReliabilitySource::Native,
            10,
        );
        assert_eq!(stored.outcome, ReliabilityOutcome::Blocked);
        assert_eq!(stored.readiness, ReliabilityReadiness::None);
    }
}
