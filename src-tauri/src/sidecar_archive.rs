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

fn prepare_runtime_from_files(
    archive_path: &Path,
    manifest_path: &Path,
    cache_root: &Path,
) -> Result<PathBuf, String> {
    prepare_runtime_from_files_with_space(archive_path, manifest_path, cache_root, &|path| {
        fs2::available_space(path).map_err(|error| {
            format!(
                "could not determine free space for sidecar cache {}: {error}",
                path.display()
            )
        })
    })
}

fn prepare_runtime_from_files_with_space(
    archive_path: &Path,
    manifest_path: &Path,
    cache_root: &Path,
    available_space: &(dyn Fn(&Path) -> Result<u64, String> + Sync),
) -> Result<PathBuf, String> {
    let manifest = read_manifest(manifest_path)?;
    let key = cache_key(&manifest);
    let destination = cache_root.join(&key);
    if cache_is_ready(&destination, &manifest) {
        return Ok(destination);
    }
    fs::create_dir_all(cache_root).map_err(|error| {
        format!(
            "could not create sidecar cache {}: {error}",
            cache_root.display()
        )
    })?;
    let _lock = acquire_cache_lock(cache_root)?;
    if cache_is_ready(&destination, &manifest) {
        return Ok(destination);
    }

    cleanup_staging_before_extraction(cache_root, &key)?;
    remove_cache_path(&destination)?;

    let required_space = required_free_space(&manifest)?;
    let free_space = available_space(cache_root)?;
    if free_space < required_space {
        return Err(format!(
            "not enough free space to prepare the sidecar runtime: {free_space} bytes available, {required_space} required"
        ));
    }

    let metadata = fs::metadata(archive_path).map_err(|error| {
        format!(
            "could not inspect sidecar archive {}: {error}",
            archive_path.display()
        )
    })?;
    if metadata.len() != manifest.archive_bytes {
        return Err(format!(
            "sidecar archive size does not match manifest ({}/{})",
            metadata.len(),
            manifest.archive_bytes
        ));
    }
    let actual_sha256 = sha256_file(archive_path)?;
    if actual_sha256 != manifest.archive_sha256 {
        return Err("sidecar archive SHA-256 does not match its manifest".to_string());
    }

    let staging = create_staging_directory(cache_root, &key)?;

    let extraction = (|| -> Result<(), String> {
        extract_archive(archive_path, &staging, &manifest)?;
        let marker = CompletionMarker {
            schema_version: MANIFEST_SCHEMA_VERSION,
            payload_sha256: manifest.payload_sha256.clone(),
            tree_sha256: manifest.tree_sha256.clone(),
        };
        let marker_json = serde_json::to_string_pretty(&marker)
            .map_err(|error| format!("could not serialize sidecar completion marker: {error}"))?;
        let marker_path = staging.join(".complete.json");
        let mut marker_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker_path)
            .map_err(|error| format!("could not create sidecar completion marker: {error}"))?;
        marker_file
            .write_all(format!("{marker_json}\n").as_bytes())
            .map_err(|error| format!("could not write sidecar completion marker: {error}"))?;
        marker_file
            .sync_all()
            .map_err(|error| format!("could not flush sidecar completion marker: {error}"))?;
        Ok(())
    })();
    if let Err(error) = extraction {
        let _ = remove_cache_path(&staging);
        return Err(error);
    }

    match fs::rename(&staging, &destination) {
        Ok(()) => Ok(destination),
        Err(_error) if cache_is_ready(&destination, &manifest) => {
            let _ = remove_cache_path(&staging);
            Ok(destination)
        }
        Err(error) => {
            let _ = remove_cache_path(&staging);
            Err(format!(
                "could not activate extracted sidecar cache {}: {error}",
                destination.display()
            ))
        }
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
