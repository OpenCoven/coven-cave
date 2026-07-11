use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use zstd::stream::read::Decoder as ZstdDecoder;

const MANIFEST_SCHEMA_VERSION: u32 = 3;
const COMPLETION_MARKER_SCHEMA_VERSION: u32 = 1;
const DIAGNOSTICS_SCHEMA_VERSION: u32 = 1;
const ARCHIVE_FORMAT: &str = "tar.zst";
const ARCHIVE_FILE_NAME: &str = "server.tar.zst";
const DIAGNOSTICS_FILE_NAME: &str = "sidecar-runtime-latest.json";
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 768 * 1024 * 1024;
const MAX_FILE_COUNT: u64 = 50_000;
const STALE_EXTRACTION_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const REQUIRED_RUNTIME_PATHS: [&str; 7] = [
    "server.mjs",
    ".next/required-server-files.json",
    ".next/BUILD_ID",
    "node_modules/@next/env/package.json",
    "node_modules/@swc/helpers/_",
    "node_modules/node-pty/package.json",
    "node_modules/sharp/package.json",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SidecarArchiveManifest {
    schema_version: u32,
    archive_format: String,
    archive_sha256: String,
    archive_bytes: u64,
    unpacked_bytes: u64,
    file_count: u64,
    directory_count: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletionMarker {
    schema_version: u32,
    package_version: String,
    archive_sha256: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimePhaseDiagnostics {
    manifest_read_ms: f64,
    cache_lookup_ms: f64,
    archive_metadata_ms: f64,
    archive_hash_ms: f64,
    recovery_cleanup_ms: f64,
    staging_create_ms: f64,
    archive_decompression_ms: f64,
    file_creation_ms: f64,
    archive_extract_ms: f64,
    tree_verify_ms: f64,
    marker_write_ms: f64,
    activation_ms: f64,
    total_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRuntimeDiagnostics {
    schema_version: u32,
    archive_format: &'static str,
    package_version: String,
    cache_outcome: &'static str,
    cache_path: String,
    archive_path: String,
    archive_hash_verified: bool,
    compressed_bytes: u64,
    expanded_bytes: u64,
    file_count: u64,
    directory_count: u64,
    defender_relevant_file_entries: u64,
    windows_defender_process_detected: Option<bool>,
    defender_probe_ms: f64,
    existing_complete_generations_before: u64,
    existing_cache_logical_bytes_before: u64,
    staging_disk_bytes_estimate: u64,
    peak_cache_logical_bytes_estimate: u64,
    phases: RuntimePhaseDiagnostics,
}

#[derive(Debug)]
struct PreparedSidecarRuntime {
    path: PathBuf,
    diagnostics: SidecarRuntimeDiagnostics,
}

struct ExtractionDiagnostics {
    archive_decompression_ms: f64,
    file_creation_ms: f64,
    archive_extract_ms: f64,
    tree_verify_ms: f64,
}

#[derive(Clone, Debug, Default)]
struct FailureContext {
    failed_phase: &'static str,
    phases: RuntimePhaseDiagnostics,
    cache_path: String,
    existing_complete_generations_before: u64,
    existing_cache_logical_bytes_before: u64,
}

fn record_phase_context(
    context: &Mutex<FailureContext>,
    failed_phase: &'static str,
    phases: &RuntimePhaseDiagnostics,
) {
    if let Ok(mut context) = context.lock() {
        context.failed_phase = failed_phase;
        context.phases = phases.clone();
    }
}

struct TimedRead<R> {
    inner: R,
    read_elapsed: Duration,
}

impl<R: Read> Read for TimedRead<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let started = Instant::now();
        let result = self.inner.read(buffer);
        self.read_elapsed = self.read_elapsed.saturating_add(started.elapsed());
        result
    }
}

struct RuntimeDiagnosticsInput<'a> {
    package_version: &'a str,
    archive_path: &'a Path,
    cache_path: &'a Path,
    cache_outcome: &'static str,
    archive_hash_verified: bool,
    existing_complete_generations_before: u64,
    existing_cache_logical_bytes_before: u64,
    staging_disk_bytes_estimate: u64,
    phases: RuntimePhaseDiagnostics,
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000.0
}

fn read_manifest(path: &Path) -> Result<SidecarArchiveManifest, String> {
    let contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "could not read sidecar manifest {}: {error}",
            path.display()
        )
    })?;
    let manifest: SidecarArchiveManifest = serde_json::from_str(&contents)
        .map_err(|error| format!("invalid sidecar manifest {}: {error}", path.display()))?;

    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "unsupported sidecar manifest schema {}",
            manifest.schema_version
        ));
    }
    if manifest.archive_format != ARCHIVE_FORMAT {
        return Err(format!(
            "unsupported sidecar archive format {}",
            manifest.archive_format
        ));
    }
    if manifest.archive_sha256.len() != 64
        || !manifest
            .archive_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("sidecar manifest has an invalid SHA-256 digest".to_string());
    }
    if manifest.archive_bytes == 0 || manifest.archive_bytes > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "sidecar archive size {} is outside the supported range",
            manifest.archive_bytes
        ));
    }
    if manifest.unpacked_bytes == 0 || manifest.unpacked_bytes > MAX_UNPACKED_BYTES {
        return Err(format!(
            "sidecar expanded size {} is outside the supported range",
            manifest.unpacked_bytes
        ));
    }
    if manifest.file_count == 0 || manifest.file_count > MAX_FILE_COUNT {
        return Err(format!(
            "sidecar file count {} is outside the supported range",
            manifest.file_count
        ));
    }
    if manifest.directory_count > MAX_FILE_COUNT {
        return Err(format!(
            "sidecar directory count {} is outside the supported range",
            manifest.directory_count
        ));
    }

    Ok(manifest)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("could not open sidecar archive {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("could not hash sidecar archive: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn cache_key(package_version: &str, archive_sha256: &str) -> String {
    let version: String = package_version
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    format!("{version}-{}", &archive_sha256[..16])
}

fn runtime_has_required_files(root: &Path) -> bool {
    REQUIRED_RUNTIME_PATHS
        .iter()
        .all(|relative| root.join(relative).exists())
}

fn cache_is_ready(destination: &Path, package_version: &str, archive_sha256: &str) -> bool {
    if !runtime_has_required_files(destination) {
        return false;
    }
    let marker = match fs::read_to_string(destination.join(".complete.json")) {
        Ok(contents) => contents,
        Err(_) => return false,
    };
    match serde_json::from_str::<CompletionMarker>(&marker) {
        Ok(marker) => {
            marker.schema_version == COMPLETION_MARKER_SCHEMA_VERSION
                && marker.package_version == package_version
                && marker.archive_sha256 == archive_sha256
        }
        Err(_) => false,
    }
}

fn complete_cache_generation_count(cache_root: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir() && has_complete_marker(&entry.path()))
        .count() as u64
}

fn cache_logical_bytes(cache_root: &Path) -> u64 {
    let mut total = 0_u64;
    let mut pending = vec![cache_root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    total
}

fn defender_process_context() -> (Option<bool>, f64) {
    let started = Instant::now();
    let mut command = Command::new(super::windows_system32_binary("tasklist.exe"));
    command
        .args(["/FI", "IMAGENAME eq MsMpEng.exe", "/NH"])
        .creation_flags(0x08000000);
    let detected = match command.output() {
        Ok(output) if output.status.success() => Some(
            String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains("msmpeng.exe"),
        ),
        Ok(_) | Err(_) => None,
    };
    (detected, elapsed_ms(started))
}

fn write_diagnostics(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("diagnostics path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "could not create sidecar diagnostics directory {}: {error}",
            parent.display()
        )
    })?;
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("could not serialize sidecar diagnostics: {error}"))?;
    let temporary = parent.join(format!(
        ".{DIAGNOSTICS_FILE_NAME}.{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&temporary, format!("{json}\n")).map_err(|error| {
        format!(
            "could not write sidecar diagnostics staging file {}: {error}",
            temporary.display()
        )
    })?;
    atomic_replace_file(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!(
            "could not activate sidecar diagnostics {}: {error}",
            path.display()
        )
    })
}

fn atomic_replace_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination);
    }
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: both path buffers are NUL-terminated and remain alive for the
    // call; backup, exclude, and reserved pointers are intentionally null.
    let replaced = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn tree_metrics(root: &Path) -> Result<(u64, u64, u64), String> {
    let mut pending = vec![root.to_path_buf()];
    let mut file_count = 0_u64;
    let mut directory_count = 0_u64;
    let mut unpacked_bytes = 0_u64;

    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "could not inspect extracted sidecar directory {}: {error}",
                directory.display()
            )
        })?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("could not inspect sidecar entry: {error}"))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| format!("could not inspect sidecar metadata: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "extracted sidecar contains a forbidden symlink: {}",
                    entry.path().display()
                ));
            }
            if metadata.is_dir() {
                directory_count = directory_count
                    .checked_add(1)
                    .ok_or_else(|| "sidecar directory count overflow".to_string())?;
                pending.push(entry.path());
            } else if metadata.is_file() {
                file_count = file_count
                    .checked_add(1)
                    .ok_or_else(|| "sidecar file count overflow".to_string())?;
                unpacked_bytes = unpacked_bytes
                    .checked_add(metadata.len())
                    .ok_or_else(|| "sidecar expanded size overflow".to_string())?;
            } else {
                return Err(format!(
                    "extracted sidecar contains an unsupported entry: {}",
                    entry.path().display()
                ));
            }
        }
    }

    Ok((file_count, directory_count, unpacked_bytes))
}

fn extract_archive(
    archive_path: &Path,
    staging: &Path,
    manifest: &SidecarArchiveManifest,
) -> Result<ExtractionDiagnostics, String> {
    let extraction_started = Instant::now();
    let archive_file = File::open(archive_path).map_err(|error| {
        format!(
            "could not open sidecar archive {}: {error}",
            archive_path.display()
        )
    })?;
    let decoder = ZstdDecoder::new(archive_file)
        .map_err(|error| format!("could not initialize sidecar zstd decoder: {error}"))?;
    let timed_decoder = TimedRead {
        inner: decoder,
        read_elapsed: Duration::ZERO,
    };
    let mut archive = tar::Archive::new(timed_decoder);
    let entries = archive
        .entries()
        .map_err(|error| format!("could not read sidecar archive: {error}"))?;
    let mut archive_file_count = 0_u64;
    let mut archive_directory_count = 0_u64;
    let mut archive_bytes = 0_u64;

    for entry in entries {
        let mut entry = entry.map_err(|error| format!("invalid sidecar archive entry: {error}"))?;
        let relative = entry
            .path()
            .map_err(|error| format!("invalid sidecar archive path: {error}"))?
            .into_owned();
        if relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(format!(
                "sidecar archive path escapes its runtime root: {}",
                relative.display()
            ));
        }

        let entry_type = entry.header().entry_type();
        if entry_type.is_file() || entry_type.is_hard_link() {
            archive_file_count = archive_file_count
                .checked_add(1)
                .ok_or_else(|| "sidecar archive file count overflow".to_string())?;
            if entry_type.is_file() {
                archive_bytes = archive_bytes
                    .checked_add(
                        entry
                            .header()
                            .size()
                            .map_err(|error| format!("invalid sidecar entry size: {error}"))?,
                    )
                    .ok_or_else(|| "sidecar archive expanded size overflow".to_string())?;
            } else {
                let target = entry
                    .link_name()
                    .map_err(|error| format!("invalid sidecar hardlink target: {error}"))?
                    .ok_or_else(|| "sidecar hardlink is missing its target".to_string())?;
                if target.components().any(|component| {
                    matches!(
                        component,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                }) {
                    return Err(format!(
                        "sidecar hardlink target escapes its runtime root: {}",
                        target.display()
                    ));
                }
            }
            if archive_file_count > MAX_FILE_COUNT
                || archive_bytes > manifest.unpacked_bytes
                || archive_bytes > MAX_UNPACKED_BYTES
            {
                return Err("sidecar archive exceeds extraction safety limits".to_string());
            }
        } else if entry_type.is_dir() {
            let is_archive_root = relative
                .components()
                .all(|component| component == Component::CurDir);
            if !is_archive_root {
                archive_directory_count = archive_directory_count
                    .checked_add(1)
                    .ok_or_else(|| "sidecar archive directory count overflow".to_string())?;
                if archive_directory_count > MAX_FILE_COUNT {
                    return Err("sidecar archive exceeds directory safety limits".to_string());
                }
            }
        } else {
            return Err(format!(
                "sidecar archive contains a forbidden non-file entry: {}",
                relative.display()
            ));
        }

        let unpacked = entry
            .unpack_in(staging)
            .map_err(|error| format!("could not extract {}: {error}", relative.display()))?;
        if !unpacked {
            return Err(format!(
                "sidecar archive refused unsafe path {}",
                relative.display()
            ));
        }
    }

    if archive_file_count != manifest.file_count
        || archive_directory_count != manifest.directory_count
    {
        return Err(format!(
            "sidecar archive metrics do not match manifest (files {archive_file_count}/{}, directories {archive_directory_count}/{})",
            manifest.file_count, manifest.directory_count
        ));
    }
    let archive_extract_ms = elapsed_ms(extraction_started);
    let archive_decompression_ms = archive.into_inner().read_elapsed.as_secs_f64() * 1_000.0;
    // Extraction streams decompressed tar bytes directly into filesystem
    // writes. The residual captures tar parsing, path creation, and file I/O;
    // keeping both values exposes whether CPU decompression or filesystem/
    // real-time scanning dominates a release-machine cold launch.
    let file_creation_ms = (archive_extract_ms - archive_decompression_ms).max(0.0);
    let verification_started = Instant::now();
    let (file_count, directory_count, unpacked_bytes) = tree_metrics(staging)?;
    if file_count != manifest.file_count
        || directory_count != manifest.directory_count
        || unpacked_bytes != manifest.unpacked_bytes
    {
        return Err("extracted sidecar metrics do not match manifest".to_string());
    }
    if !runtime_has_required_files(staging) {
        return Err("sidecar archive is missing required runtime files".to_string());
    }

    Ok(ExtractionDiagnostics {
        archive_decompression_ms,
        file_creation_ms,
        archive_extract_ms,
        tree_verify_ms: elapsed_ms(verification_started),
    })
}

fn runtime_diagnostics(
    manifest: &SidecarArchiveManifest,
    input: RuntimeDiagnosticsInput<'_>,
) -> SidecarRuntimeDiagnostics {
    SidecarRuntimeDiagnostics {
        schema_version: DIAGNOSTICS_SCHEMA_VERSION,
        archive_format: ARCHIVE_FORMAT,
        package_version: input.package_version.to_string(),
        cache_outcome: input.cache_outcome,
        cache_path: input.cache_path.to_string_lossy().into_owned(),
        archive_path: input.archive_path.to_string_lossy().into_owned(),
        archive_hash_verified: input.archive_hash_verified,
        compressed_bytes: manifest.archive_bytes,
        expanded_bytes: manifest.unpacked_bytes,
        file_count: manifest.file_count,
        directory_count: manifest.directory_count,
        defender_relevant_file_entries: manifest
            .file_count
            .saturating_add(manifest.directory_count),
        windows_defender_process_detected: None,
        defender_probe_ms: 0.0,
        existing_complete_generations_before: input.existing_complete_generations_before,
        existing_cache_logical_bytes_before: input.existing_cache_logical_bytes_before,
        staging_disk_bytes_estimate: input.staging_disk_bytes_estimate,
        peak_cache_logical_bytes_estimate: input
            .existing_cache_logical_bytes_before
            .saturating_add(input.staging_disk_bytes_estimate),
        phases: input.phases,
    }
}

#[cfg(test)]
fn prepare_runtime_from_files(
    archive_path: &Path,
    manifest_path: &Path,
    cache_root: &Path,
    package_version: &str,
) -> Result<PreparedSidecarRuntime, String> {
    let failure_context = Mutex::new(FailureContext::default());
    prepare_runtime_from_files_with_context(
        archive_path,
        manifest_path,
        cache_root,
        package_version,
        &failure_context,
    )
}

fn prepare_runtime_from_files_with_context(
    archive_path: &Path,
    manifest_path: &Path,
    cache_root: &Path,
    package_version: &str,
    failure_context: &Mutex<FailureContext>,
) -> Result<PreparedSidecarRuntime, String> {
    let total_started = Instant::now();
    let mut phases = RuntimePhaseDiagnostics::default();

    record_phase_context(failure_context, "manifest-read", &phases);
    let phase_started = Instant::now();
    let manifest = read_manifest(manifest_path)?;
    phases.manifest_read_ms = elapsed_ms(phase_started);
    let destination = cache_root.join(cache_key(package_version, &manifest.archive_sha256));
    let existing_complete_generations = complete_cache_generation_count(cache_root);
    let existing_cache_bytes = cache_logical_bytes(cache_root);
    if let Ok(mut context) = failure_context.lock() {
        context.cache_path = destination.to_string_lossy().into_owned();
        context.existing_complete_generations_before = existing_complete_generations;
        context.existing_cache_logical_bytes_before = existing_cache_bytes;
    }

    record_phase_context(failure_context, "cache-lookup", &phases);
    let phase_started = Instant::now();
    if cache_is_ready(&destination, package_version, &manifest.archive_sha256) {
        phases.cache_lookup_ms = elapsed_ms(phase_started);
        phases.total_ms = elapsed_ms(total_started);
        return Ok(PreparedSidecarRuntime {
            diagnostics: runtime_diagnostics(
                &manifest,
                RuntimeDiagnosticsInput {
                    package_version,
                    archive_path,
                    cache_path: &destination,
                    cache_outcome: "hit",
                    archive_hash_verified: false,
                    existing_complete_generations_before: existing_complete_generations,
                    existing_cache_logical_bytes_before: existing_cache_bytes,
                    staging_disk_bytes_estimate: 0,
                    phases,
                },
            ),
            path: destination,
        });
    }
    phases.cache_lookup_ms = elapsed_ms(phase_started);

    record_phase_context(failure_context, "archive-metadata", &phases);
    let phase_started = Instant::now();
    let metadata = fs::metadata(archive_path).map_err(|error| {
        format!(
            "could not inspect sidecar archive {}: {error}",
            archive_path.display()
        )
    })?;
    phases.archive_metadata_ms = elapsed_ms(phase_started);
    if metadata.len() != manifest.archive_bytes {
        return Err(format!(
            "sidecar archive size does not match manifest ({}/{})",
            metadata.len(),
            manifest.archive_bytes
        ));
    }

    record_phase_context(failure_context, "archive-hash", &phases);
    let phase_started = Instant::now();
    let actual_sha256 = sha256_file(archive_path)?;
    phases.archive_hash_ms = elapsed_ms(phase_started);
    if actual_sha256 != manifest.archive_sha256 {
        return Err("sidecar archive SHA-256 does not match its manifest".to_string());
    }

    fs::create_dir_all(cache_root).map_err(|error| {
        format!(
            "could not create sidecar cache {}: {error}",
            cache_root.display()
        )
    })?;

    let phase_started = Instant::now();
    if cache_is_ready(&destination, package_version, &manifest.archive_sha256) {
        phases.cache_lookup_ms += elapsed_ms(phase_started);
        phases.total_ms = elapsed_ms(total_started);
        return Ok(PreparedSidecarRuntime {
            diagnostics: runtime_diagnostics(
                &manifest,
                RuntimeDiagnosticsInput {
                    package_version,
                    archive_path,
                    cache_path: &destination,
                    cache_outcome: "hit-after-validation-race",
                    archive_hash_verified: true,
                    existing_complete_generations_before: existing_complete_generations,
                    existing_cache_logical_bytes_before: existing_cache_bytes,
                    staging_disk_bytes_estimate: 0,
                    phases,
                },
            ),
            path: destination,
        });
    }
    phases.cache_lookup_ms += elapsed_ms(phase_started);

    let mut cache_outcome = "miss";
    if destination.exists() {
        record_phase_context(failure_context, "recovery-cleanup", &phases);
        let phase_started = Instant::now();
        fs::remove_dir_all(&destination).map_err(|error| {
            format!(
                "could not replace incomplete sidecar cache {}: {error}",
                destination.display()
            )
        })?;
        phases.recovery_cleanup_ms = elapsed_ms(phase_started);
        cache_outcome = "recovered-incomplete";
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let staging = cache_root.join(format!(
        ".extract-{}-{}-{nonce}",
        std::process::id(),
        cache_key(package_version, &manifest.archive_sha256)
    ));
    record_phase_context(failure_context, "staging-create", &phases);
    let phase_started = Instant::now();
    fs::create_dir(&staging).map_err(|error| {
        format!(
            "could not create sidecar staging directory {}: {error}",
            staging.display()
        )
    })?;
    phases.staging_create_ms = elapsed_ms(phase_started);

    record_phase_context(failure_context, "archive-extract", &phases);
    let extraction = (|| -> Result<(), String> {
        let extraction = extract_archive(archive_path, &staging, &manifest)?;
        phases.archive_decompression_ms = extraction.archive_decompression_ms;
        phases.file_creation_ms = extraction.file_creation_ms;
        phases.archive_extract_ms = extraction.archive_extract_ms;
        phases.tree_verify_ms = extraction.tree_verify_ms;
        record_phase_context(failure_context, "marker-write", &phases);
        let marker_started = Instant::now();
        let marker = CompletionMarker {
            schema_version: COMPLETION_MARKER_SCHEMA_VERSION,
            package_version: package_version.to_string(),
            archive_sha256: manifest.archive_sha256.clone(),
        };
        let marker_json = serde_json::to_string_pretty(&marker)
            .map_err(|error| format!("could not serialize sidecar completion marker: {error}"))?;
        fs::write(staging.join(".complete.json"), format!("{marker_json}\n"))
            .map_err(|error| format!("could not write sidecar completion marker: {error}"))?;
        phases.marker_write_ms = elapsed_ms(marker_started);
        Ok(())
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    record_phase_context(failure_context, "activation", &phases);
    let phase_started = Instant::now();
    let activated_path = match fs::rename(&staging, &destination) {
        Ok(()) => destination.clone(),
        Err(_error) if cache_is_ready(&destination, package_version, &manifest.archive_sha256) => {
            let _ = fs::remove_dir_all(&staging);
            cache_outcome = "hit-after-activation-race";
            destination.clone()
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "could not activate extracted sidecar cache {}: {error}",
                destination.display()
            ));
        }
    };
    phases.activation_ms = elapsed_ms(phase_started);
    phases.total_ms = elapsed_ms(total_started);
    Ok(PreparedSidecarRuntime {
        diagnostics: runtime_diagnostics(
            &manifest,
            RuntimeDiagnosticsInput {
                package_version,
                archive_path,
                cache_path: &activated_path,
                cache_outcome,
                archive_hash_verified: true,
                existing_complete_generations_before: existing_complete_generations,
                existing_cache_logical_bytes_before: existing_cache_bytes,
                staging_disk_bytes_estimate: manifest.unpacked_bytes,
                phases,
            },
        ),
        path: activated_path,
    })
}

fn has_complete_marker(runtime: &Path) -> bool {
    if !runtime_has_required_files(runtime) {
        return false;
    }
    let Ok(contents) = fs::read_to_string(runtime.join(".complete.json")) else {
        return false;
    };
    match serde_json::from_str::<CompletionMarker>(&contents) {
        Ok(marker) => {
            marker.schema_version == COMPLETION_MARKER_SCHEMA_VERSION
                && marker.archive_sha256.len() == 64
                && marker
                    .archive_sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
        }
        Err(_) => false,
    }
}

pub(crate) fn cleanup_stale_sidecar_runtimes(current: &Path) {
    let Some(cache_root) = current.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    let mut previous = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() || path == current {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with(".extract-") {
            let stale = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age >= STALE_EXTRACTION_AGE);
            if stale {
                let _ = fs::remove_dir_all(path);
            }
            continue;
        }
        if has_complete_marker(&path) {
            previous.push(entry);
        } else if let Err(error) = fs::remove_dir_all(&path) {
            log::warn!(
                "[cave] could not remove incomplete sidecar cache {}: {}",
                path.display(),
                error
            );
        }
    }
    previous.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    previous.reverse();

    // Keep one previous complete runtime for rollback and for a concurrently
    // running older app. Older generations are best-effort cache cleanup.
    for entry in previous.into_iter().skip(1) {
        if let Err(error) = fs::remove_dir_all(entry.path()) {
            log::warn!(
                "[cave] could not remove stale sidecar cache {}: {}",
                entry.path().display(),
                error
            );
        }
    }
}

pub(crate) fn prepare_sidecar_runtime(
    app: &tauri::App,
    resource_dir: &Path,
) -> Result<PathBuf, String> {
    let archive_dir = resource_dir.join("resources").join("server-archive");
    let archive_path = archive_dir.join(ARCHIVE_FILE_NAME);
    let manifest_path = archive_dir.join("manifest.json");
    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not resolve sidecar cache directory: {error}"))?
        .join("sidecar-runtime");
    let diagnostics_path = app
        .path()
        .app_log_dir()
        .ok()
        .map(|directory| directory.join(DIAGNOSTICS_FILE_NAME));
    let started = Instant::now();
    let failure_context = Mutex::new(FailureContext::default());
    let prepared = match prepare_runtime_from_files_with_context(
        &archive_path,
        &manifest_path,
        &cache_root,
        &app.package_info().version.to_string(),
        &failure_context,
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            if let Some(path) = diagnostics_path.as_deref() {
                let mut context = failure_context
                    .lock()
                    .map(|context| context.clone())
                    .unwrap_or_default();
                context.phases.total_ms = elapsed_ms(started);
                let defender_relevant = matches!(
                    context.failed_phase,
                    "archive-hash"
                        | "staging-create"
                        | "archive-extract"
                        | "marker-write"
                        | "activation"
                );
                let (defender_detected, defender_probe_ms) = if defender_relevant {
                    defender_process_context()
                } else {
                    (None, 0.0)
                };
                let failure = serde_json::json!({
                    "schemaVersion": DIAGNOSTICS_SCHEMA_VERSION,
                    "archiveFormat": ARCHIVE_FORMAT,
                    "cacheOutcome": "error",
                    "cachePath": context.cache_path,
                    "archivePath": archive_path.to_string_lossy(),
                    "failedPhase": context.failed_phase,
                    "existingCompleteGenerationsBefore": context.existing_complete_generations_before,
                    "existingCacheLogicalBytesBefore": context.existing_cache_logical_bytes_before,
                    "windowsDefenderProcessDetected": defender_detected,
                    "defenderProbeMs": defender_probe_ms,
                    "phases": context.phases,
                    "totalMs": elapsed_ms(started),
                    "error": &error,
                });
                if let Err(diagnostic_error) = write_diagnostics(path, &failure) {
                    log::warn!(
                        "[cave] could not persist sidecar failure diagnostics: {diagnostic_error}"
                    );
                }
            }
            return Err(error);
        }
    };
    let mut diagnostics = prepared.diagnostics;
    if diagnostics.cache_outcome != "hit" {
        let (defender_detected, defender_probe_ms) = defender_process_context();
        diagnostics.windows_defender_process_detected = defender_detected;
        diagnostics.defender_probe_ms = defender_probe_ms;
    }
    if let Some(path) = diagnostics_path.as_deref() {
        if let Err(error) = write_diagnostics(path, &diagnostics) {
            log::warn!("[cave] could not persist sidecar runtime diagnostics: {error}");
        }
    }
    if let Ok(json) = serde_json::to_string(&diagnostics) {
        log::info!("[cave] sidecar_runtime_diagnostics={json}");
    }
    log::info!(
        "[cave] Windows sidecar runtime ready at {} in {:.2?}",
        prepared.path.display(),
        started.elapsed()
    );
    Ok(prepared.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use zstd::stream::write::Encoder as ZstdEncoder;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "covencave-sidecar-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("test clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn fixture_files() -> Vec<(&'static str, &'static [u8])> {
        vec![
            ("server.mjs", b"console.log('fixture')"),
            (".next/required-server-files.json", b"{}"),
            (".next/BUILD_ID", b"fixture-build"),
            ("node_modules/@next/env/package.json", b"{}"),
            ("node_modules/@swc/helpers/_/index", b"fixture"),
            ("node_modules/node-pty/package.json", b"{}"),
            ("node_modules/sharp/package.json", b"{}"),
        ]
    }

    fn write_fixture(root: &Path) -> (PathBuf, PathBuf, SidecarArchiveManifest) {
        let source = root.join("source");
        fs::create_dir(&source).expect("create fixture source");
        let files = fixture_files();
        for (path, contents) in &files {
            let destination = source.join(path);
            fs::create_dir_all(destination.parent().expect("fixture parent"))
                .expect("create fixture parent");
            fs::write(destination, contents).expect("write fixture file");
        }

        let archive_path = root.join(ARCHIVE_FILE_NAME);
        let archive_file = File::create(&archive_path).expect("create archive");
        let encoder = ZstdEncoder::new(archive_file, 3).expect("create zstd encoder");
        let mut archive = tar::Builder::new(encoder);
        archive
            .append_dir_all(".", &source)
            .expect("append fixture tree");
        let encoder = archive.into_inner().expect("finish tar");
        encoder.finish().expect("finish zstd");
        let (file_count, directory_count, unpacked_bytes) =
            tree_metrics(&source).expect("fixture metrics");
        let manifest = SidecarArchiveManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            archive_format: ARCHIVE_FORMAT.to_string(),
            archive_sha256: sha256_file(&archive_path).expect("fixture digest"),
            archive_bytes: fs::metadata(&archive_path).expect("archive metadata").len(),
            unpacked_bytes,
            file_count,
            directory_count,
        };
        let manifest_path = root.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": manifest.schema_version,
                "archiveFormat": manifest.archive_format.clone(),
                "archiveSha256": manifest.archive_sha256.clone(),
                "archiveBytes": manifest.archive_bytes,
                "unpackedBytes": manifest.unpacked_bytes,
                "fileCount": manifest.file_count,
                "directoryCount": manifest.directory_count,
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");
        (archive_path, manifest_path, manifest)
    }

    #[test]
    fn extracts_atomically_and_reuses_complete_cache() {
        let root = test_root("extract");
        let (archive, manifest, _) = write_fixture(&root);
        let cache = root.join("cache");
        let cold = prepare_runtime_from_files(&archive, &manifest, &cache, "1.2.3")
            .expect("extract runtime");
        assert!(cold.path.join("server.mjs").is_file());
        assert!(cold.path.join(".complete.json").is_file());
        assert_eq!(cold.diagnostics.archive_format, ARCHIVE_FORMAT);
        assert_eq!(cold.diagnostics.cache_outcome, "miss");
        assert!(cold.diagnostics.archive_hash_verified);
        assert!(cold.diagnostics.compressed_bytes > 0);
        assert!(cold.diagnostics.expanded_bytes > 0);
        assert_eq!(
            cold.diagnostics.defender_relevant_file_entries,
            cold.diagnostics
                .file_count
                .saturating_add(cold.diagnostics.directory_count)
        );
        assert_eq!(
            cold.diagnostics.staging_disk_bytes_estimate,
            cold.diagnostics.expanded_bytes
        );
        assert!(cold.diagnostics.phases.archive_decompression_ms > 0.0);
        assert!(cold.diagnostics.phases.file_creation_ms >= 0.0);
        assert!(
            (cold.diagnostics.phases.archive_decompression_ms
                + cold.diagnostics.phases.file_creation_ms
                - cold.diagnostics.phases.archive_extract_ms)
                .abs()
                < 0.01
        );
        assert!(
            cold.diagnostics.peak_cache_logical_bytes_estimate
                >= cold.diagnostics.staging_disk_bytes_estimate
        );
        let diagnostics_path = root.join(DIAGNOSTICS_FILE_NAME);
        write_diagnostics(&diagnostics_path, &cold.diagnostics).expect("persist cold diagnostics");
        let persisted: serde_json::Value = serde_json::from_slice(
            &fs::read(&diagnostics_path).expect("read persisted diagnostics"),
        )
        .expect("parse persisted diagnostics");
        assert_eq!(persisted["cacheOutcome"], "miss");
        assert_eq!(persisted["archiveFormat"], "tar.zst");
        let runtime_path = cold.path.clone();

        fs::remove_file(&archive).expect("remove archive after first extraction");
        let warm =
            prepare_runtime_from_files(&archive, &manifest, &cache, "1.2.3").expect("reuse cache");
        assert_eq!(warm.path, runtime_path);
        assert_eq!(warm.diagnostics.cache_outcome, "hit");
        assert!(!warm.diagnostics.archive_hash_verified);
        assert_eq!(warm.diagnostics.staging_disk_bytes_estimate, 0);
        assert_eq!(warm.diagnostics.phases.archive_extract_ms, 0.0);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn replaces_an_incomplete_destination() {
        let root = test_root("incomplete");
        let (archive, manifest_path, manifest) = write_fixture(&root);
        let cache = root.join("cache");
        fs::create_dir_all(&cache).expect("create cache");
        let destination = cache.join(cache_key("1.2.3", &manifest.archive_sha256));
        fs::create_dir(&destination).expect("create incomplete destination");
        fs::write(destination.join("partial"), b"partial").expect("write partial file");

        let runtime = prepare_runtime_from_files(&archive, &manifest_path, &cache, "1.2.3")
            .expect("replace incomplete cache");
        assert!(!runtime.path.join("partial").exists());
        assert!(runtime.path.join("server.mjs").is_file());
        assert_eq!(runtime.diagnostics.cache_outcome, "recovered-incomplete");
        assert!(runtime.diagnostics.phases.recovery_cleanup_ms >= 0.0);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_corrupt_archive_without_activating_it() {
        let root = test_root("corrupt");
        let (archive, manifest, _) = write_fixture(&root);
        fs::write(&archive, b"not a zstd archive").expect("corrupt archive");
        let cache = root.join("cache");
        let error = prepare_runtime_from_files(&archive, &manifest, &cache, "1.2.3")
            .expect_err("corrupt archive must fail");
        assert!(error.contains("size does not match") || error.contains("SHA-256"));
        assert!(!cache.exists() || fs::read_dir(&cache).expect("read cache").next().is_none());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn manifest_limits_are_enforced_before_extraction() {
        let root = test_root("limits");
        let (_, manifest_path, _) = write_fixture(&root);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        value["fileCount"] = serde_json::json!(MAX_FILE_COUNT + 1);
        fs::write(
            &manifest_path,
            serde_json::to_vec(&value).expect("serialize oversized manifest"),
        )
        .expect("write oversized manifest");
        assert!(read_manifest(&manifest_path)
            .expect_err("oversized manifest must fail")
            .contains("file count"));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn manifest_rejects_an_unexpected_compression_format() {
        let root = test_root("format");
        let (_, manifest_path, _) = write_fixture(&root);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        value["archiveFormat"] = serde_json::json!("tar.gz");
        fs::write(
            &manifest_path,
            serde_json::to_vec(&value).expect("serialize wrong-format manifest"),
        )
        .expect("write wrong-format manifest");
        assert!(read_manifest(&manifest_path)
            .expect_err("unexpected archive format must fail")
            .contains("archive format"));
        fs::remove_dir_all(root).expect("remove format root");
    }

    #[test]
    fn diagnostics_replace_existing_file_atomically() {
        let root = test_root("diagnostics-replace");
        let diagnostics = root.join(DIAGNOSTICS_FILE_NAME);
        fs::write(&diagnostics, "old\n").expect("write old diagnostics");
        write_diagnostics(&diagnostics, &serde_json::json!({ "value": "new" }))
            .expect("replace diagnostics");
        let contents = fs::read_to_string(&diagnostics).expect("read diagnostics");
        assert!(contents.contains("new"));
        assert!(!contents.contains("old"));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn logical_cache_bytes_sum_actual_generation_files() {
        let root = test_root("logical-cache-bytes");
        fs::create_dir(root.join("a")).expect("create first generation");
        fs::create_dir(root.join("b")).expect("create second generation");
        fs::write(root.join("a/one"), b"123").expect("write first file");
        fs::write(root.join("b/two"), b"12345").expect("write second file");
        assert_eq!(cache_logical_bytes(&root), 8);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn failure_context_records_explicit_phase_and_cache_usage() {
        let root = test_root("failure-context");
        let (archive, manifest_path, _) = write_fixture(&root);
        let cache = root.join("cache");
        fs::create_dir_all(&cache).expect("create cache");
        fs::write(cache.join("existing"), b"1234").expect("write existing cache file");
        fs::write(&archive, b"corrupt").expect("corrupt archive");
        let context = Mutex::new(FailureContext::default());
        let result = prepare_runtime_from_files_with_context(
            &archive,
            &manifest_path,
            &cache,
            "1.2.3",
            &context,
        );
        assert!(result.is_err(), "corrupt archive must fail");
        let context = context.lock().expect("read failure context");
        assert_eq!(context.failed_phase, "archive-metadata");
        assert_eq!(context.existing_cache_logical_bytes_before, 4);
        assert!(context.cache_path.contains("1.2.3-"));
        fs::remove_dir_all(root).expect("remove test root");
    }

    fn write_complete_runtime(
        cache: &Path,
        name: &str,
        version: &str,
        digest_byte: char,
    ) -> PathBuf {
        let runtime = cache.join(name);
        fs::create_dir(&runtime).expect("create complete runtime");
        for (path, contents) in fixture_files() {
            let destination = runtime.join(path);
            fs::create_dir_all(destination.parent().expect("runtime fixture parent"))
                .expect("create runtime fixture parent");
            fs::write(destination, contents).expect("write runtime fixture");
        }
        let marker = CompletionMarker {
            schema_version: COMPLETION_MARKER_SCHEMA_VERSION,
            package_version: version.to_string(),
            archive_sha256: std::iter::repeat(digest_byte).take(64).collect(),
        };
        fs::write(
            runtime.join(".complete.json"),
            serde_json::to_vec(&marker).expect("serialize complete marker"),
        )
        .expect("write complete marker");
        runtime
    }

    #[test]
    fn cleanup_preserves_current_and_one_previous_complete_runtime() {
        let root = test_root("cleanup");
        let cache = root.join("cache");
        fs::create_dir(&cache).expect("create cleanup cache");
        let oldest = write_complete_runtime(&cache, "oldest", "1.0.0", 'a');
        thread::sleep(Duration::from_millis(25));
        let previous = write_complete_runtime(&cache, "previous", "1.1.0", 'b');
        thread::sleep(Duration::from_millis(25));
        let current = write_complete_runtime(&cache, "current", "1.2.0", 'c');
        let incomplete = cache.join("incomplete");
        fs::create_dir(&incomplete).expect("create incomplete cache");
        fs::write(incomplete.join("partial"), b"partial").expect("write incomplete cache");

        cleanup_stale_sidecar_runtimes(&current);

        assert!(current.is_dir());
        assert!(previous.is_dir());
        assert!(!oldest.exists());
        assert!(!incomplete.exists());
        fs::remove_dir_all(root).expect("remove cleanup root");
    }

    #[test]
    fn extracts_the_built_windows_archive_when_available() {
        let archive_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("server-archive");
        let archive = archive_dir.join(ARCHIVE_FILE_NAME);
        let manifest = archive_dir.join("manifest.json");
        if !archive.is_file() || !manifest.is_file() {
            // Plain cargo test/check runs do not build release resources. The
            // Windows sidecar-runtime CI leg builds them before this test.
            return;
        }
        let root = test_root("built-archive");
        let runtime = prepare_runtime_from_files(&archive, &manifest, &root, "ci-fixture")
            .expect("extract built Windows archive with production code");
        assert!(runtime_has_required_files(&runtime.path));
        assert_eq!(runtime.diagnostics.archive_format, "tar.zst");
        fs::remove_dir_all(root).expect("remove built archive fixture");
    }
}
