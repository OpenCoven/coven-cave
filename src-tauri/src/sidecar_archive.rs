use fs2::FileExt as Fs2FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod sidecar_archive_cache;
mod sidecar_archive_cleanup;
mod sidecar_archive_extraction;
mod sidecar_archive_manifest;
mod sidecar_archive_preparation;

use sidecar_archive_cache::{
    acquire_cache_lock, cleanup_staging_before_extraction, create_staging_directory,
    remove_cache_path, required_free_space, try_acquire_cache_lock,
};
use sidecar_archive_cleanup::cleanup_stale_sidecar_runtimes;
use sidecar_archive_extraction::{extract_archive, tree_metrics};
use sidecar_archive_manifest::{
    cache_key, is_sha256, read_manifest, SidecarArchiveManifest, ARCHIVE_FORMAT,
    MANIFEST_SCHEMA_VERSION, MAX_ARCHIVE_BYTES, MAX_FILE_COUNT, MAX_UNPACKED_BYTES,
};
use sidecar_archive_preparation::{
    prepare_runtime_from_files, prepare_runtime_from_files_with_space,
};

const MIN_FREE_SPACE_RESERVE_BYTES: u64 = 64 * 1024 * 1024;
const CACHE_LOCK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CACHE_LOCK_RETRY: Duration = Duration::from_millis(100);
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletionMarker {
    schema_version: u32,
    payload_sha256: String,
    tree_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCompletionMarker {
    schema_version: u32,
    #[serde(default)]
    payload_sha256: Option<String>,
    #[serde(default)]
    tree_sha256: Option<String>,
    #[serde(default)]
    package_version: Option<String>,
    #[serde(default)]
    archive_sha256: Option<String>,
}

struct HashingReader<R> {
    inner: R,
    hasher: Sha256,
}

impl<R> HashingReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
        }
    }

    fn finish(self) -> String {
        hex_digest(self.hasher.finalize())
    }
}

impl<R: Read> Read for HashingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buffer)?;
        self.hasher.update(&buffer[..read]);
        Ok(read)
    }
}

fn hex_digest(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
    Ok(hex_digest(hasher.finalize()))
}

fn runtime_has_required_files(root: &Path) -> bool {
    REQUIRED_RUNTIME_PATHS
        .iter()
        .all(|relative| root.join(relative).exists())
}

fn cache_is_ready(destination: &Path, manifest: &SidecarArchiveManifest) -> bool {
    // The marker is written only after extraction has passed a full tree hash
    // and is moved into this content-addressed destination atomically. Trust
    // that durable commit record on later launches: re-hashing the runtime here
    // makes every Windows startup read thousands of files before the sidecar can
    // start (and is especially expensive under real-time antivirus scanning).
    // Required entrypoints are still checked so common partial-cache damage is
    // repaired automatically.
    if !runtime_has_required_files(destination) {
        return false;
    }
    let marker = match fs::read_to_string(destination.join(".complete.json")) {
        Ok(contents) => contents,
        Err(_) => return false,
    };
    match serde_json::from_str::<CompletionMarker>(&marker) {
        Ok(marker) => {
            marker.schema_version == MANIFEST_SCHEMA_VERSION
                && marker.payload_sha256 == manifest.payload_sha256
                && marker.tree_sha256 == manifest.tree_sha256
        }
        Err(_) => false,
    }
}

pub(crate) fn prepare_sidecar_runtime(
    app: &tauri::AppHandle,
    resource_dir: &Path,
) -> Result<PathBuf, String> {
    let archive_dir = resource_dir.join("resources").join("server-archive");
    let archive_path = archive_dir.join("server.tar.zst");
    let manifest_path = archive_dir.join("manifest.json");
    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not resolve sidecar cache directory: {error}"))?
        .join("sidecar-runtime");
    let started = Instant::now();
    let runtime = prepare_runtime_from_files(&archive_path, &manifest_path, &cache_root)?;
    log::info!(
        "[cave] Windows sidecar runtime ready at {} in {:.2?}",
        runtime.display(),
        started.elapsed()
    );
    Ok(runtime)
}

#[cfg(test)]
#[path = "sidecar_archive_tests.rs"]
mod tests;
