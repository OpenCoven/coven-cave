use fs2::FileExt as Fs2FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use zstd::stream::read::Decoder as ZstdDecoder;

const MANIFEST_SCHEMA_VERSION: u32 = 3;
const ARCHIVE_FORMAT: &str = "tar.zst";
const MAX_ARCHIVE_BYTES: u64 = 80 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 200 * 1024 * 1024 - 1;
const MAX_FILE_COUNT: u64 = 5_250;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SidecarArchiveManifest {
    schema_version: u32,
    archive_format: String,
    payload_sha256: String,
    tree_sha256: String,
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

struct CacheLock {
    _file: File,
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hex_digest(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
    if !is_sha256(&manifest.payload_sha256) {
        return Err("sidecar manifest has an invalid payload SHA-256 digest".to_string());
    }
    if !is_sha256(&manifest.tree_sha256) {
        return Err("sidecar manifest has an invalid tree SHA-256 digest".to_string());
    }
    if !is_sha256(&manifest.archive_sha256) {
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
    Ok(hex_digest(hasher.finalize()))
}

fn cache_key(manifest: &SidecarArchiveManifest) -> String {
    // Cache identity follows canonical payload content, not the app version or
    // zstd envelope, so unchanged runtimes survive consecutive upgrades.
    format!("v{}-{}", manifest.schema_version, manifest.payload_sha256)
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

fn lock_is_contended(error: &io::Error) -> bool {
    let expected = fs2::lock_contended_error();
    match (error.raw_os_error(), expected.raw_os_error()) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => error.kind() == expected.kind(),
    }
}

fn acquire_cache_lock(cache_root: &Path) -> Result<CacheLock, String> {
    // Advisory OS locks are released when a crashed process closes its handle,
    // unlike sentinel directories that can strand every later startup.
    let lock_path = cache_root.join(".runtime-cache.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "could not open sidecar cache lock {}: {error}",
                lock_path.display()
            )
        })?;
    let started = Instant::now();
    loop {
        match Fs2FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(CacheLock { _file: file }),
            Err(error) if lock_is_contended(&error) && started.elapsed() < CACHE_LOCK_TIMEOUT => {
                thread::sleep(CACHE_LOCK_RETRY);
            }
            Err(error) if lock_is_contended(&error) => {
                return Err(format!(
                    "timed out waiting for another process to prepare the sidecar runtime after {} seconds",
                    CACHE_LOCK_TIMEOUT.as_secs()
                ));
            }
            Err(error) => {
                return Err(format!(
                    "could not lock sidecar runtime cache {}: {error}",
                    lock_path.display()
                ));
            }
        }
    }
}

fn try_acquire_cache_lock(cache_root: &Path) -> Result<Option<CacheLock>, String> {
    let lock_path = cache_root.join(".runtime-cache.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "could not open sidecar cache lock {}: {error}",
                lock_path.display()
            )
        })?;
    match Fs2FileExt::try_lock_exclusive(&file) {
        Ok(()) => Ok(Some(CacheLock { _file: file })),
        Err(error) if lock_is_contended(&error) => Ok(None),
        Err(error) => Err(format!(
            "could not lock sidecar runtime cache {}: {error}",
            lock_path.display()
        )),
    }
}

fn required_free_space(manifest: &SidecarArchiveManifest) -> Result<u64, String> {
    let reserve = MIN_FREE_SPACE_RESERVE_BYTES.max(manifest.unpacked_bytes / 10);
    manifest
        .unpacked_bytes
        .checked_add(reserve)
        .ok_or_else(|| "sidecar free-space requirement overflow".to_string())
}

fn remove_cache_path(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "could not inspect sidecar cache path {}: {error}",
                path.display()
            ));
        }
    };
    let removal = if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    removal.map_err(|error| {
        format!(
            "could not remove sidecar cache path {}: {error}",
            path.display()
        )
    })
}

fn cleanup_staging_before_extraction(cache_root: &Path, key: &str) -> Result<(), String> {
    let entries = fs::read_dir(cache_root).map_err(|error| {
        format!(
            "could not inspect sidecar cache {}: {error}",
            cache_root.display()
        )
    })?;
    let current_prefix = format!(".extract-{key}-");
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("could not inspect sidecar cache entry: {error}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(".extract-") {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_EXTRACTION_AGE);
        if name.starts_with(&current_prefix) || stale {
            remove_cache_path(&entry.path())?;
        }
    }
    Ok(())
}

fn create_staging_directory(cache_root: &Path, key: &str) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 0..100_u32 {
        let staging = cache_root.join(format!(
            ".extract-{key}-{}-{nonce}-{attempt}",
            std::process::id()
        ));
        match fs::create_dir(&staging) {
            Ok(()) => return Ok(staging),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "could not create sidecar staging directory {}: {error}",
                    staging.display()
                ));
            }
        }
    }
    Err("could not allocate a unique sidecar staging directory".to_string())
}

fn tree_metrics(root: &Path) -> Result<(u64, u64, u64, String), String> {
    let mut pending = vec![root.to_path_buf()];
    let mut paths = Vec::new();
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
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path)
                .map_err(|error| format!("could not inspect sidecar metadata: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "extracted sidecar contains a forbidden symlink: {}",
                    entry_path.display()
                ));
            }
            let relative = entry_path
                .strip_prefix(root)
                .map_err(|error| format!("could not resolve sidecar relative path: {error}"))?
                .components()
                .map(|component| {
                    component.as_os_str().to_str().ok_or_else(|| {
                        format!("sidecar path is not valid UTF-8: {}", entry_path.display())
                    })
                })
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            if relative == ".complete.json" {
                continue;
            }
            if metadata.is_dir() {
                directory_count = directory_count
                    .checked_add(1)
                    .ok_or_else(|| "sidecar directory count overflow".to_string())?;
                pending.push(entry_path.clone());
                paths.push((relative, entry_path, true, 0));
            } else if metadata.is_file() {
                file_count = file_count
                    .checked_add(1)
                    .ok_or_else(|| "sidecar file count overflow".to_string())?;
                unpacked_bytes = unpacked_bytes
                    .checked_add(metadata.len())
                    .ok_or_else(|| "sidecar expanded size overflow".to_string())?;
                paths.push((relative, entry_path, false, metadata.len()));
            } else {
                return Err(format!(
                    "extracted sidecar contains an unsupported entry: {}",
                    entry_path.display()
                ));
            }
        }
    }
    paths.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    for (relative, path, is_directory, size) in paths {
        hasher.update(if is_directory { b"d" } else { b"f" });
        hasher.update((relative.len() as u64).to_be_bytes());
        hasher.update(relative.as_bytes());
        if !is_directory {
            hasher.update(size.to_be_bytes());
            let mut file = File::open(&path).map_err(|error| {
                format!(
                    "could not open cached sidecar file {}: {error}",
                    path.display()
                )
            })?;
            loop {
                let read = file.read(&mut buffer).map_err(|error| {
                    format!(
                        "could not hash cached sidecar file {}: {error}",
                        path.display()
                    )
                })?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
        }
    }

    Ok((
        file_count,
        directory_count,
        unpacked_bytes,
        hex_digest(hasher.finalize()),
    ))
}

fn extract_archive(
    archive_path: &Path,
    staging: &Path,
    manifest: &SidecarArchiveManifest,
) -> Result<(), String> {
    let archive_file = File::open(archive_path).map_err(|error| {
        format!(
            "could not open sidecar archive {}: {error}",
            archive_path.display()
        )
    })?;
    let decoder = ZstdDecoder::new(archive_file)
        .map_err(|error| format!("could not initialize sidecar zstd decoder: {error}"))?;
    let hashing_reader = HashingReader::new(decoder);
    let mut archive = tar::Archive::new(hashing_reader);
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

    let mut hashing_reader = archive.into_inner();
    io::copy(&mut hashing_reader, &mut io::sink())
        .map_err(|error| format!("could not finish hashing sidecar payload: {error}"))?;
    let payload_sha256 = hashing_reader.finish();
    if payload_sha256 != manifest.payload_sha256 {
        return Err("sidecar payload SHA-256 does not match its manifest".to_string());
    }

    if archive_file_count != manifest.file_count
        || archive_directory_count != manifest.directory_count
    {
        return Err(format!(
            "sidecar archive metrics do not match manifest (files {archive_file_count}/{}, directories {archive_directory_count}/{})",
            manifest.file_count, manifest.directory_count
        ));
    }
    let (file_count, directory_count, unpacked_bytes, tree_sha256) = tree_metrics(staging)?;
    if file_count != manifest.file_count
        || directory_count != manifest.directory_count
        || unpacked_bytes != manifest.unpacked_bytes
    {
        return Err("extracted sidecar metrics do not match manifest".to_string());
    }
    if tree_sha256 != manifest.tree_sha256 {
        return Err("extracted sidecar tree SHA-256 does not match its manifest".to_string());
    }
    if !runtime_has_required_files(staging) {
        return Err("sidecar archive is missing required runtime files".to_string());
    }

    Ok(())
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

fn has_complete_marker(runtime: &Path) -> bool {
    if !runtime_has_required_files(runtime) {
        return false;
    }
    let Ok(contents) = fs::read_to_string(runtime.join(".complete.json")) else {
        return false;
    };
    match serde_json::from_str::<StoredCompletionMarker>(&contents) {
        Ok(marker) if marker.schema_version == MANIFEST_SCHEMA_VERSION => {
            marker.payload_sha256.as_deref().is_some_and(is_sha256)
                && marker.tree_sha256.as_deref().is_some_and(is_sha256)
        }
        Ok(marker) if marker.schema_version == 1 => {
            marker
                .package_version
                .as_deref()
                .is_some_and(|version| !version.is_empty())
                && marker.archive_sha256.as_deref().is_some_and(is_sha256)
        }
        Err(_) => false,
        Ok(_) => false,
    }
}

pub(crate) fn cleanup_stale_sidecar_runtimes(current: &Path) {
    let Some(cache_root) = current.parent() else {
        return;
    };
    let _lock = match try_acquire_cache_lock(cache_root) {
        Ok(Some(cache_lock)) => cache_lock,
        Ok(None) => {
            log::info!(
                "[cave] skipping sidecar cache retirement while another process holds the cache lock"
            );
            return;
        }
        Err(error) => {
            log::warn!("[cave] could not coordinate sidecar cache retirement: {error}");
            return;
        }
    };
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() || path == current {
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
                let _ = remove_cache_path(&path);
            }
            continue;
        }
        // A complete content-addressed generation may still be serving an
        // older concurrently running app. Without process leases there is no
        // safe startup-time proof that it is unused, so explicit uninstall
        // owns complete-generation reclamation.
        if !has_complete_marker(&path) {
            if let Err(error) = remove_cache_path(&path) {
                log::warn!(
                    "[cave] could not remove incomplete sidecar cache {}: {}",
                    path.display(),
                    error
                );
            }
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
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    use zstd::stream::{read::Decoder as TestZstdDecoder, write::Encoder as ZstdEncoder};

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

        let archive_path = root.join("server.tar.zst");
        let archive_file = File::create(&archive_path).expect("create archive");
        let encoder = ZstdEncoder::new(archive_file, 3).expect("create zstd encoder");
        let mut archive = tar::Builder::new(encoder);
        archive
            .append_dir_all(".", &source)
            .expect("append fixture tree");
        let encoder = archive.into_inner().expect("finish tar");
        encoder.finish().expect("finish zstd");
        let archive_file = File::open(&archive_path).expect("open archive for payload digest");
        let decoder = TestZstdDecoder::new(archive_file).expect("open fixture zstd stream");
        let mut payload_reader = HashingReader::new(decoder);
        io::copy(&mut payload_reader, &mut io::sink()).expect("hash fixture payload");
        let payload_sha256 = payload_reader.finish();
        let (file_count, directory_count, unpacked_bytes, tree_sha256) =
            tree_metrics(&source).expect("fixture metrics");
        let manifest = SidecarArchiveManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            archive_format: ARCHIVE_FORMAT.to_string(),
            payload_sha256,
            tree_sha256,
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
                "payloadSha256": manifest.payload_sha256.clone(),
                "treeSha256": manifest.tree_sha256.clone(),
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

    fn create_required_runtime(root: &Path) {
        for relative in REQUIRED_RUNTIME_PATHS {
            let target = root.join(relative);
            if relative.ends_with("/_") {
                fs::create_dir_all(target).expect("create required runtime directory");
            } else {
                fs::create_dir_all(target.parent().expect("required runtime parent"))
                    .expect("create required runtime parent");
                fs::write(target, b"fixture").expect("write required runtime file");
            }
        }
    }

    #[test]
    fn extracts_atomically_and_reuses_complete_cache() {
        let root = test_root("extract");
        let (archive, manifest, _) = write_fixture(&root);
        let cache = root.join("cache");
        let runtime =
            prepare_runtime_from_files(&archive, &manifest, &cache).expect("extract runtime");
        assert!(runtime.join("server.mjs").is_file());
        assert!(runtime.join(".complete.json").is_file());

        fs::remove_file(&archive).expect("remove archive after first extraction");
        assert_eq!(
            prepare_runtime_from_files(&archive, &manifest, &cache).expect("reuse cache"),
            runtime
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn same_payload_is_reused_across_package_versions() {
        let root = test_root("cross-version");
        let version_a = root.join("version-a");
        let version_b = root.join("version-b");
        fs::create_dir_all(&version_a).expect("create version a");
        fs::create_dir_all(&version_b).expect("create version b");
        let (archive_a, manifest_a, manifest) = write_fixture(&version_a);
        let archive_b = version_b.join("server.tar.zst");
        let manifest_b = version_b.join("manifest.json");
        fs::copy(&archive_a, &archive_b).expect("copy archive to version b");
        fs::copy(&manifest_a, &manifest_b).expect("copy manifest to version b");
        let cache = root.join("cache");

        let runtime_a = prepare_runtime_from_files(&archive_a, &manifest_a, &cache)
            .expect("prepare version a runtime");
        fs::remove_file(&archive_b).expect("remove version b archive to prove cache reuse");
        let runtime_b = prepare_runtime_from_files(&archive_b, &manifest_b, &cache)
            .expect("reuse payload cache for version b");

        assert_eq!(runtime_b, runtime_a);
        assert_eq!(
            runtime_a.file_name().and_then(|name| name.to_str()),
            Some(cache_key(&manifest).as_str())
        );
        assert!(!runtime_a.to_string_lossy().contains("version-a"));
        assert!(!runtime_a.to_string_lossy().contains("version-b"));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn concurrent_preparations_extract_once_under_the_process_lock() {
        let root = test_root("concurrent");
        let (archive, manifest, _) = write_fixture(&root);
        let cache = root.join("cache");
        let barrier = Arc::new(Barrier::new(8));
        let probes = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();
        for _ in 0..8 {
            let archive = archive.clone();
            let manifest = manifest.clone();
            let cache = cache.clone();
            let barrier = Arc::clone(&barrier);
            let probes = Arc::clone(&probes);
            workers.push(thread::spawn(move || {
                barrier.wait();
                prepare_runtime_from_files_with_space(&archive, &manifest, &cache, &|_| {
                    probes.fetch_add(1, Ordering::SeqCst);
                    Ok(u64::MAX)
                })
            }));
        }

        let runtimes: Vec<PathBuf> = workers
            .into_iter()
            .map(|worker| {
                worker
                    .join()
                    .expect("join preparation worker")
                    .expect("prepare runtime")
            })
            .collect();
        assert!(runtimes.iter().all(|runtime| runtime == &runtimes[0]));
        assert_eq!(
            probes.load(Ordering::SeqCst),
            1,
            "only the lock winner may extract"
        );
        assert_eq!(
            fs::read_dir(&cache)
                .expect("read cache")
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn low_space_preflight_fails_before_creating_staging() {
        let root = test_root("low-space");
        let (archive, manifest_path, manifest) = write_fixture(&root);
        let cache = root.join("cache");
        let required = required_free_space(&manifest).expect("required space");
        let error =
            prepare_runtime_from_files_with_space(&archive, &manifest_path, &cache, &|_| {
                Ok(required - 1)
            })
            .expect_err("low free space must fail");

        assert!(error.contains("not enough free space"));
        assert!(!cache.join(cache_key(&manifest)).exists());
        assert!(!fs::read_dir(&cache)
            .expect("read cache")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with(".extract-")));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn replaces_an_incomplete_destination() {
        let root = test_root("incomplete");
        let (archive, manifest_path, manifest) = write_fixture(&root);
        let cache = root.join("cache");
        fs::create_dir_all(&cache).expect("create cache");
        let destination = cache.join(cache_key(&manifest));
        fs::create_dir(&destination).expect("create incomplete destination");
        fs::write(destination.join("partial"), b"partial").expect("write partial file");

        let runtime = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect("replace incomplete cache");
        assert!(!runtime.join("partial").exists());
        assert!(runtime.join("server.mjs").is_file());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn recovers_a_damaged_cache_and_cleans_orphaned_staging() {
        let root = test_root("recovery");
        let (archive, manifest_path, manifest) = write_fixture(&root);
        let cache = root.join("cache");
        let runtime = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect("prepare initial runtime");
        fs::remove_file(runtime.join("server.mjs")).expect("damage cached runtime");
        let orphan = cache.join(format!(".extract-{}-orphan", cache_key(&manifest)));
        fs::create_dir(&orphan).expect("create orphaned staging directory");
        fs::write(orphan.join("partial"), b"partial").expect("write orphaned staging file");

        let recovered = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect("recover damaged runtime");
        assert_eq!(recovered, runtime);
        assert!(recovered.join("server.mjs").is_file());
        assert!(!orphan.exists());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn cache_hit_trusts_verified_marker_without_rehashing_runtime_tree() {
        let root = test_root("constant-time-cache-hit");
        let (archive, manifest_path, _) = write_fixture(&root);
        let cache = root.join("cache");
        let runtime = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect("prepare initial runtime");
        let helper = runtime.join("node_modules/@swc/helpers/_/index");
        fs::write(&helper, b"corrupt").expect("corrupt non-sentinel file with same byte length");
        fs::remove_file(&archive).expect("remove archive to require a cache hit");

        let reused = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect("reuse runtime from its verified completion marker");
        assert_eq!(reused, runtime);
        assert_eq!(
            fs::read(reused.join("node_modules/@swc/helpers/_/index"))
                .expect("read untouched helper"),
            b"corrupt",
            "cache hits must not traverse and re-hash unrelated runtime files"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn tree_digest_matches_the_archive_writer_contract() {
        let root = test_root("tree-digest-contract");
        fs::create_dir_all(root.join("a-first")).expect("create digest fixture directory");
        fs::write(root.join("a-first/entry.txt"), b"first\n").expect("write first fixture");
        fs::write(root.join("z-last.txt"), b"last\n").expect("write last fixture");

        let (_, _, _, digest) = tree_metrics(&root).expect("hash fixture tree");
        assert_eq!(
            digest,
            "8b1ba9bbae7c87757dcb92c97532285d679785504c65a52af139e5457ca203a7"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_corrupt_archive_without_activating_it() {
        let root = test_root("corrupt");
        let (archive, manifest, _) = write_fixture(&root);
        fs::write(&archive, b"not a zstd archive").expect("corrupt archive");
        let cache = root.join("cache");
        let error = prepare_runtime_from_files(&archive, &manifest, &cache)
            .expect_err("corrupt archive must fail");
        assert!(error.contains("size does not match") || error.contains("SHA-256"));
        assert!(
            !cache.exists()
                || !fs::read_dir(&cache)
                    .expect("read cache")
                    .filter_map(Result::ok)
                    .any(|entry| entry.path().is_dir())
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_payload_digest_mismatch_without_activation() {
        let root = test_root("payload-digest");
        let (archive, manifest_path, _) = write_fixture(&root);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        manifest["payloadSha256"] = serde_json::json!("0".repeat(64));
        fs::write(
            &manifest_path,
            serde_json::to_vec(&manifest).expect("serialize mismatched manifest"),
        )
        .expect("write mismatched manifest");
        let cache = root.join("cache");

        let error = prepare_runtime_from_files(&archive, &manifest_path, &cache)
            .expect_err("payload digest mismatch must fail");
        assert!(error.contains("payload SHA-256"));
        assert!(!fs::read_dir(&cache)
            .expect("read cache")
            .filter_map(Result::ok)
            .any(|entry| entry.path().is_dir()));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn cleanup_retains_all_complete_generations_without_process_leases() {
        let root = test_root("rollback");
        let current = root.join("v2-current");
        create_required_runtime(&current);
        fs::write(
            current.join(".complete.json"),
            serde_json::to_vec(&CompletionMarker {
                schema_version: MANIFEST_SCHEMA_VERSION,
                payload_sha256: "a".repeat(64),
                tree_sha256: "c".repeat(64),
            })
            .expect("serialize current marker"),
        )
        .expect("write current marker");

        let older = root.join("v2-older");
        create_required_runtime(&older);
        fs::write(
            older.join(".complete.json"),
            serde_json::to_vec(&CompletionMarker {
                schema_version: MANIFEST_SCHEMA_VERSION,
                payload_sha256: "b".repeat(64),
                tree_sha256: "d".repeat(64),
            })
            .expect("serialize older marker"),
        )
        .expect("write older marker");
        thread::sleep(Duration::from_millis(20));

        let legacy = root.join("legacy");
        create_required_runtime(&legacy);
        fs::write(
            legacy.join(".complete.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "packageVersion": "0.0.173",
                "archiveSha256": "c".repeat(64),
            }))
            .expect("serialize legacy marker"),
        )
        .expect("write legacy marker");

        cleanup_stale_sidecar_runtimes(&current);
        assert!(
            legacy.exists(),
            "legacy complete runtime must remain available for rollback"
        );
        assert!(
            older.exists(),
            "content-addressed generations may still serve running older apps"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn cleanup_skips_retirement_while_cache_lock_is_held() {
        let root = test_root("cleanup-lock");
        let current = root.join("current");
        let incomplete = root.join("incomplete");
        create_required_runtime(&current);
        fs::create_dir(&incomplete).expect("create incomplete cache");
        let lock = acquire_cache_lock(&root).expect("hold cache lock");

        cleanup_stale_sidecar_runtimes(&current);
        assert!(
            incomplete.exists(),
            "contended cleanup must not mutate caches"
        );

        drop(lock);
        cleanup_stale_sidecar_runtimes(&current);
        assert!(
            !incomplete.exists(),
            "coordinated cleanup should resume after unlock"
        );
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
    fn manifest_accepts_the_current_runtime_file_count_budget() {
        let root = test_root("file-count-budget");
        let (_, manifest_path, _) = write_fixture(&root);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse manifest");
        value["fileCount"] = serde_json::json!(5_250);
        fs::write(
            &manifest_path,
            serde_json::to_vec(&value).expect("serialize budget manifest"),
        )
        .expect("write budget manifest");
        assert_eq!(
            read_manifest(&manifest_path)
                .expect("current runtime file-count budget should be accepted")
                .file_count,
            5_250
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn extracts_the_built_windows_archive_when_available() {
        let archive_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("server-archive");
        let archive = archive_dir.join("server.tar.zst");
        let manifest = archive_dir.join("manifest.json");
        if !archive.is_file() || !manifest.is_file() {
            // Plain cargo test/check runs do not build release resources. The
            // Windows sidecar-runtime CI leg builds them before this test.
            return;
        }
        let root = test_root("built-archive");
        let runtime = prepare_runtime_from_files(&archive, &manifest, &root)
            .expect("extract built Windows archive with production code");
        assert!(runtime_has_required_files(&runtime));
        fs::remove_dir_all(root).expect("remove built archive fixture");
    }
}
