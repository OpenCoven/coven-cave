use flate2::read::GzDecoder;
use fs2::FileExt;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tar::Archive;

const MANIFEST_SCHEMA_VERSION: u32 = 1;
const ARCHIVE_NAME: &str = "server.tar.gz";
const MANIFEST_NAME: &str = "server-manifest.json";
const COMPLETE_MARKER: &str = ".complete.json";
const STAGING_MAX_AGE: Duration = Duration::from_secs(60 * 60);
const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(2 * 60);
const REQUIRED_ENTRIES: &[&str] = &[
    "server/server.mjs",
    "server/.next/required-server-files.json",
    "server/node_modules/node-pty/package.json",
    "server/node_modules/sharp/package.json",
    "server/marketplace/marketplace.json",
    "server/workflows/bug-diagnosis.yaml",
    "server/public/manifest.webmanifest",
    "server/vault.yaml",
];

#[derive(Clone, Copy, Debug)]
pub(crate) struct RuntimeArchiveLimits {
    pub max_entries: u64,
    pub max_unpacked_bytes: u64,
    pub max_archive_bytes: u64,
}

impl Default for RuntimeArchiveLimits {
    fn default() -> Self {
        Self {
            max_entries: 30_000,
            max_unpacked_bytes: 700 * 1024 * 1024,
            max_archive_bytes: 128 * 1024 * 1024,
        }
    }
}

#[derive(Debug)]
pub(crate) struct RuntimeArchiveError {
    category: &'static str,
    detail: String,
}

impl RuntimeArchiveError {
    fn new(category: &'static str, detail: impl Into<String>) -> Self {
        Self {
            category,
            detail: detail.into(),
        }
    }

    fn io(context: &str, error: impl fmt::Display) -> Self {
        Self::new("io", format!("{context}: {error}"))
    }
}

impl fmt::Display for RuntimeArchiveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.category, self.detail)
    }
}

impl std::error::Error for RuntimeArchiveError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerManifest {
    schema_version: u32,
    sha256: String,
    archive_bytes: u64,
    unpacked_bytes: u64,
    file_count: u64,
    required_entries: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteMarker {
    schema_version: u32,
    sha256: String,
}

struct CacheLock {
    file: File,
}

impl CacheLock {
    fn acquire(cache_root: &Path, hash: &str) -> Result<Self, RuntimeArchiveError> {
        let path = cache_root.join(format!(".lock-{hash}"));
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| RuntimeArchiveError::io("open sidecar cache lock", error))?;
        let started = Instant::now();
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Self { file }),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed() >= LOCK_WAIT_TIMEOUT {
                        return Err(RuntimeArchiveError::new(
                            "cache lock",
                            format!("timed out waiting for {}", path.display()),
                        ));
                    }
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => {
                    return Err(RuntimeArchiveError::io("acquire sidecar cache lock", error));
                }
            }
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn is_lower_hex_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_safe_archive_path(path: &Path) -> bool {
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(root)) if root == "server")
        && components.all(|component| matches!(component, Component::Normal(_)))
}

fn validate_manifest(
    manifest: ServerManifest,
    limits: RuntimeArchiveLimits,
) -> Result<ServerManifest, RuntimeArchiveError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(RuntimeArchiveError::new(
            "manifest schema",
            format!(
                "unsupported schema version {} (expected {})",
                manifest.schema_version, MANIFEST_SCHEMA_VERSION
            ),
        ));
    }
    if !is_lower_hex_hash(&manifest.sha256) {
        return Err(RuntimeArchiveError::new(
            "manifest",
            "sha256 must be 64 lowercase hexadecimal characters",
        ));
    }
    if manifest.archive_bytes == 0 || manifest.archive_bytes > limits.max_archive_bytes {
        return Err(RuntimeArchiveError::new(
            "archive byte budget",
            format!(
                "{} is outside 1..={}",
                manifest.archive_bytes, limits.max_archive_bytes
            ),
        ));
    }
    if manifest.file_count == 0 || manifest.file_count > limits.max_entries {
        return Err(RuntimeArchiveError::new(
            "entry budget",
            format!(
                "{} is outside 1..={}",
                manifest.file_count, limits.max_entries
            ),
        ));
    }
    if manifest.unpacked_bytes == 0 || manifest.unpacked_bytes > limits.max_unpacked_bytes {
        return Err(RuntimeArchiveError::new(
            "unpacked byte budget",
            format!(
                "{} is outside 1..={}",
                manifest.unpacked_bytes, limits.max_unpacked_bytes
            ),
        ));
    }
    let expected: Vec<String> = REQUIRED_ENTRIES.iter().map(|path| (*path).into()).collect();
    if manifest.required_entries != expected {
        return Err(RuntimeArchiveError::new(
            "required runtime entry",
            "manifest requiredEntries does not match the application contract",
        ));
    }
    Ok(manifest)
}

fn read_manifest(
    path: &Path,
    limits: RuntimeArchiveLimits,
) -> Result<ServerManifest, RuntimeArchiveError> {
    let bytes = fs::read(path).map_err(|error| RuntimeArchiveError::io("read manifest", error))?;
    let manifest = serde_json::from_slice(&bytes)
        .map_err(|error| RuntimeArchiveError::new("manifest", error.to_string()))?;
    validate_manifest(manifest, limits)
}

fn hash_file(path: &Path) -> Result<(String, u64), RuntimeArchiveError> {
    let mut file =
        File::open(path).map_err(|error| RuntimeArchiveError::io("open archive", error))?;
    let mut hash = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| RuntimeArchiveError::io("hash archive", error))?;
        if read == 0 {
            break;
        }
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| RuntimeArchiveError::new("archive byte budget", "size overflow"))?;
        hash.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hash.finalize()), bytes))
}

fn cache_is_complete(cache: &Path, hash: &str, required_entries: &[String]) -> bool {
    let marker: CompleteMarker = match fs::read(cache.join(COMPLETE_MARKER))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(marker) => marker,
        None => return false,
    };
    if marker.schema_version != MANIFEST_SCHEMA_VERSION || marker.sha256 != hash {
        return false;
    }
    required_entries.iter().all(|entry| {
        entry
            .strip_prefix("server/")
            .map(|relative| cache.join("server").join(relative).is_file())
            .unwrap_or(false)
    })
}

fn remove_stale_staging(cache_root: &Path) {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_prefix(".staging-") else {
            continue;
        };
        let mut parts = rest.rsplitn(3, '-');
        let well_formed = parts
            .next()
            .is_some_and(|nonce| nonce.parse::<u64>().is_ok())
            && parts.next().is_some_and(|pid| pid.parse::<u32>().is_ok())
            && parts.next().is_some_and(is_lower_hex_hash);
        let is_stale = fs::metadata(entry.path())
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > STAGING_MAX_AGE);
        if !well_formed || is_stale {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn verify_archive(
    archive_path: &Path,
    manifest: &ServerManifest,
    limits: RuntimeArchiveLimits,
) -> Result<(), RuntimeArchiveError> {
    let metadata = fs::metadata(archive_path)
        .map_err(|error| RuntimeArchiveError::io("stat archive", error))?;
    if metadata.len() > limits.max_archive_bytes || metadata.len() != manifest.archive_bytes {
        return Err(RuntimeArchiveError::new(
            "archive byte budget",
            format!(
                "actual {} differs from manifest {} or exceeds {}",
                metadata.len(),
                manifest.archive_bytes,
                limits.max_archive_bytes
            ),
        ));
    }
    let (hash, bytes) = hash_file(archive_path)?;
    if bytes != manifest.archive_bytes || hash != manifest.sha256 {
        return Err(RuntimeArchiveError::new(
            "checksum",
            format!("expected {}, got {hash}", manifest.sha256),
        ));
    }
    Ok(())
}

fn extract_archive(
    archive_path: &Path,
    staging: &Path,
    manifest: &ServerManifest,
    limits: RuntimeArchiveLimits,
) -> Result<(), RuntimeArchiveError> {
    let file = File::open(archive_path)
        .map_err(|error| RuntimeArchiveError::io("open archive for extraction", error))?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let entries = archive
        .entries()
        .map_err(|error| RuntimeArchiveError::new("unsafe archive entry", error.to_string()))?;
    let mut seen = HashSet::new();
    let mut required_seen = HashSet::new();
    let mut entry_count = 0_u64;
    let mut file_count = 0_u64;
    let mut unpacked_bytes = 0_u64;

    for entry in entries {
        let mut entry = entry
            .map_err(|error| RuntimeArchiveError::new("unsafe archive entry", error.to_string()))?;
        let path = entry
            .path()
            .map_err(|error| RuntimeArchiveError::new("unsafe archive entry", error.to_string()))?
            .into_owned();
        if !is_safe_archive_path(&path) {
            return Err(RuntimeArchiveError::new(
                "unsafe archive entry",
                path.display().to_string(),
            ));
        }
        if !seen.insert(path.clone()) {
            return Err(RuntimeArchiveError::new(
                "duplicate archive entry",
                path.display().to_string(),
            ));
        }

        entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| RuntimeArchiveError::new("entry budget", "count overflow"))?;
        if entry_count > limits.max_entries {
            return Err(RuntimeArchiveError::new(
                "entry budget",
                format!("{entry_count} > {}", limits.max_entries),
            ));
        }

        let kind = entry.header().entry_type();
        if kind.is_file() {
            file_count += 1;
            unpacked_bytes = unpacked_bytes
                .checked_add(entry.header().size().map_err(|error| {
                    RuntimeArchiveError::new("unpacked byte budget", error.to_string())
                })?)
                .ok_or_else(|| RuntimeArchiveError::new("unpacked byte budget", "size overflow"))?;
            if unpacked_bytes > limits.max_unpacked_bytes {
                return Err(RuntimeArchiveError::new(
                    "unpacked byte budget",
                    format!("{unpacked_bytes} > {}", limits.max_unpacked_bytes),
                ));
            }
            if manifest
                .required_entries
                .iter()
                .any(|required| path == Path::new(required))
            {
                required_seen.insert(path.clone());
            }
        } else if !kind.is_dir() {
            return Err(RuntimeArchiveError::new(
                "archive entry type",
                format!("{} has type {:?}", path.display(), kind),
            ));
        }

        let unpacked = entry
            .unpack_in(staging)
            .map_err(|error| RuntimeArchiveError::io("unpack archive entry", error))?;
        if !unpacked {
            return Err(RuntimeArchiveError::new(
                "unsafe archive entry",
                path.display().to_string(),
            ));
        }
    }

    if file_count != manifest.file_count || unpacked_bytes != manifest.unpacked_bytes {
        return Err(RuntimeArchiveError::new(
            "manifest",
            format!(
                "archive content differs: files {file_count}/{}, bytes {unpacked_bytes}/{}",
                manifest.file_count, manifest.unpacked_bytes
            ),
        ));
    }
    for required in &manifest.required_entries {
        if !required_seen.contains(Path::new(required)) || !staging.join(required).is_file() {
            return Err(RuntimeArchiveError::new(
                "required runtime entry",
                format!("missing {required}"),
            ));
        }
    }
    Ok(())
}

fn write_complete_marker(cache: &Path, hash: &str) -> Result<(), RuntimeArchiveError> {
    let marker = CompleteMarker {
        schema_version: MANIFEST_SCHEMA_VERSION,
        sha256: hash.to_owned(),
    };
    let bytes = serde_json::to_vec(&marker)
        .map_err(|error| RuntimeArchiveError::new("cache", error.to_string()))?;
    fs::write(cache.join(COMPLETE_MARKER), bytes)
        .map_err(|error| RuntimeArchiveError::io("write cache marker", error))
}

fn prune_old_complete_caches(cache_root: &Path, current_hash: &str) {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    let mut previous = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == current_hash || !is_lower_hex_hash(&name) {
            continue;
        }
        let marker_path = entry.path().join(COMPLETE_MARKER);
        let marker: CompleteMarker = match fs::read(&marker_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CompleteMarker>(&bytes).ok())
        {
            Some(marker) if marker.sha256 == name => marker,
            _ => continue,
        };
        if marker.schema_version != MANIFEST_SCHEMA_VERSION {
            continue;
        }
        let modified = fs::metadata(&marker_path)
            .and_then(|metadata| metadata.modified())
            .ok();
        previous.push((modified, entry.path()));
    }
    previous.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in previous.into_iter().skip(1) {
        let _ = fs::remove_dir_all(path);
    }
}

pub(crate) fn resolve_server_dir(
    resource_dir: &Path,
    app_local_data_dir: &Path,
) -> Result<PathBuf, RuntimeArchiveError> {
    resolve_server_dir_with_limits(
        resource_dir,
        app_local_data_dir,
        RuntimeArchiveLimits::default(),
    )
}

pub(crate) fn resolve_server_dir_with_limits(
    resource_dir: &Path,
    app_local_data_dir: &Path,
    limits: RuntimeArchiveLimits,
) -> Result<PathBuf, RuntimeArchiveError> {
    let resources = resource_dir.join("resources");
    let expanded = resources.join("server");
    if expanded.join("server.mjs").is_file() || expanded.join("server.js").is_file() {
        return Ok(expanded);
    }

    let archive_path = resources.join(ARCHIVE_NAME);
    let manifest = read_manifest(&resources.join(MANIFEST_NAME), limits)?;
    verify_archive(&archive_path, &manifest, limits)?;

    let cache_root = app_local_data_dir.join("sidecar");
    fs::create_dir_all(&cache_root)
        .map_err(|error| RuntimeArchiveError::io("create sidecar cache root", error))?;

    let target = cache_root.join(&manifest.sha256);
    if cache_is_complete(&target, &manifest.sha256, &manifest.required_entries) {
        prune_old_complete_caches(&cache_root, &manifest.sha256);
        return Ok(target.join("server"));
    }

    let _cache_lock = CacheLock::acquire(&cache_root, &manifest.sha256)?;
    remove_stale_staging(&cache_root);
    if cache_is_complete(&target, &manifest.sha256, &manifest.required_entries) {
        prune_old_complete_caches(&cache_root, &manifest.sha256);
        return Ok(target.join("server"));
    }
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| RuntimeArchiveError::io("remove incomplete cache", error))?;
    }

    let mut nonce = [0_u8; 8];
    OsRng.fill_bytes(&mut nonce);
    let staging = cache_root.join(format!(
        ".staging-{}-{}-{}",
        manifest.sha256,
        std::process::id(),
        u64::from_ne_bytes(nonce)
    ));
    fs::create_dir_all(&staging)
        .map_err(|error| RuntimeArchiveError::io("create extraction staging", error))?;

    let extraction = (|| {
        extract_archive(&archive_path, &staging, &manifest, limits)?;
        write_complete_marker(&staging, &manifest.sha256)?;
        Ok::<(), RuntimeArchiveError>(())
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    match fs::rename(&staging, &target) {
        Ok(()) => {}
        Err(error)
            if target.exists()
                && cache_is_complete(&target, &manifest.sha256, &manifest.required_entries) =>
        {
            let _ = fs::remove_dir_all(&staging);
            log::debug!(
                "[cave] sidecar cache publication race resolved by reusing {}: {}",
                target.display(),
                error
            );
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(RuntimeArchiveError::io("publish sidecar cache", error));
        }
    }

    if !cache_is_complete(&target, &manifest.sha256, &manifest.required_entries) {
        return Err(RuntimeArchiveError::new(
            "cache",
            "published sidecar cache failed verification",
        ));
    }
    prune_old_complete_caches(&cache_root, &manifest.sha256);
    Ok(target.join("server"))
}

#[cfg(test)]
mod tests {
    use super::{
        remove_stale_staging, resolve_server_dir, resolve_server_dir_with_limits, CacheLock,
        RuntimeArchiveLimits,
    };
    use flate2::{write::GzEncoder, Compression};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::fs::{self, File};
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;
    use tar::{Builder, EntryType, Header};
    use tempfile::TempDir;

    const REQUIRED: [(&str, &[u8]); 8] = [
        ("server/server.mjs", b"export {};\n"),
        ("server/.next/required-server-files.json", b"{}\n"),
        (
            "server/node_modules/node-pty/package.json",
            br#"{"name":"node-pty"}"#,
        ),
        (
            "server/node_modules/sharp/package.json",
            br#"{"name":"sharp"}"#,
        ),
        ("server/marketplace/marketplace.json", br#"{"plugins":[]}"#),
        (
            "server/workflows/bug-diagnosis.yaml",
            b"id: bug-diagnosis\n",
        ),
        ("server/public/manifest.webmanifest", b"{}\n"),
        ("server/vault.yaml", b"{}\n"),
    ];

    #[derive(Clone)]
    enum TestEntry {
        File(String, Vec<u8>),
        RawFile(String, Vec<u8>),
        Link(EntryType, String, String),
        Special(EntryType, String),
    }

    struct Fixture {
        _temp: TempDir,
        resource_dir: PathBuf,
        data_dir: PathBuf,
        archive_path: PathBuf,
        manifest_path: PathBuf,
    }

    fn sha256(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn set_raw_path(header: &mut Header, raw: &str) {
        assert!(raw.len() < 100);
        let bytes = header.as_mut_bytes();
        bytes[..100].fill(0);
        bytes[..raw.len()].copy_from_slice(raw.as_bytes());
    }

    fn write_archive(path: &Path, entries: &[TestEntry]) -> (u64, u64) {
        let file = File::create(path).unwrap();
        let encoder = GzEncoder::new(file, Compression::default());
        let mut builder = Builder::new(encoder);
        let mut file_count = 0;
        let mut unpacked_bytes = 0;

        for entry in entries {
            match entry {
                TestEntry::File(name, bytes) => {
                    let mut header = Header::new_gnu();
                    header.set_size(bytes.len() as u64);
                    header.set_mode(0o644);
                    header.set_cksum();
                    builder
                        .append_data(&mut header, name, Cursor::new(bytes))
                        .unwrap();
                    file_count += 1;
                    unpacked_bytes += bytes.len() as u64;
                }
                TestEntry::RawFile(name, bytes) => {
                    let mut header = Header::new_gnu();
                    set_raw_path(&mut header, name);
                    header.set_size(bytes.len() as u64);
                    header.set_mode(0o644);
                    header.set_entry_type(EntryType::Regular);
                    header.set_cksum();
                    builder.append(&header, Cursor::new(bytes)).unwrap();
                    file_count += 1;
                    unpacked_bytes += bytes.len() as u64;
                }
                TestEntry::Link(kind, name, target) => {
                    let mut header = Header::new_gnu();
                    header.set_path(name).unwrap();
                    header.set_entry_type(*kind);
                    header.set_size(0);
                    header.set_mode(0o777);
                    header.set_link_name(target).unwrap();
                    header.set_cksum();
                    builder.append(&header, Cursor::new([])).unwrap();
                }
                TestEntry::Special(kind, name) => {
                    let mut header = Header::new_gnu();
                    header.set_path(name).unwrap();
                    header.set_entry_type(*kind);
                    header.set_size(0);
                    header.set_mode(0o644);
                    header.set_cksum();
                    builder.append(&header, Cursor::new([])).unwrap();
                }
            }
        }
        let encoder = builder.into_inner().unwrap();
        encoder.finish().unwrap();
        (file_count, unpacked_bytes)
    }

    fn base_entries() -> Vec<TestEntry> {
        REQUIRED
            .iter()
            .map(|(name, bytes)| TestEntry::File((*name).into(), bytes.to_vec()))
            .collect()
    }

    impl Fixture {
        fn new(entries: Vec<TestEntry>) -> Self {
            let temp = tempfile::tempdir().unwrap();
            let resource_dir = temp.path().join("bundle");
            let resources = resource_dir.join("resources");
            let data_dir = temp.path().join("data");
            fs::create_dir_all(&resources).unwrap();
            fs::create_dir_all(&data_dir).unwrap();
            let archive_path = resources.join("server.tar.gz");
            let manifest_path = resources.join("server-manifest.json");
            let (file_count, unpacked_bytes) = write_archive(&archive_path, &entries);
            let archive = fs::read(&archive_path).unwrap();
            let manifest = json!({
                "schemaVersion": 1,
                "sha256": sha256(&archive),
                "archiveBytes": archive.len(),
                "unpackedBytes": unpacked_bytes,
                "fileCount": file_count,
                "requiredEntries": REQUIRED.iter().map(|(path, _)| *path).collect::<Vec<_>>(),
            });
            fs::write(
                &manifest_path,
                serde_json::to_vec_pretty(&manifest).unwrap(),
            )
            .unwrap();
            Self {
                _temp: temp,
                resource_dir,
                data_dir,
                archive_path,
                manifest_path,
            }
        }

        fn manifest(&self) -> Value {
            serde_json::from_slice(&fs::read(&self.manifest_path).unwrap()).unwrap()
        }

        fn write_manifest(&self, manifest: Value) {
            fs::write(
                &self.manifest_path,
                serde_json::to_vec_pretty(&manifest).unwrap(),
            )
            .unwrap();
        }
    }

    fn write_complete_cache(data_dir: &Path, hash: &str, marker_hash: &str) -> PathBuf {
        let cache = data_dir.join("sidecar").join(hash);
        for (relative, bytes) in REQUIRED {
            let relative = relative.strip_prefix("server/").unwrap();
            let target = cache.join("server").join(relative);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, bytes).unwrap();
        }
        fs::write(
            cache.join(".complete.json"),
            serde_json::to_vec(&json!({ "schemaVersion": 1, "sha256": marker_hash })).unwrap(),
        )
        .unwrap();
        cache
    }

    #[test]
    fn expanded_runtime_wins_without_reading_an_archive() {
        let fixture = Fixture::new(base_entries());
        let expanded = fixture.resource_dir.join("resources/server");
        fs::create_dir_all(&expanded).unwrap();
        fs::write(expanded.join("server.mjs"), "expanded").unwrap();
        fs::write(&fixture.manifest_path, b"not json").unwrap();

        let resolved = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap();
        assert_eq!(resolved, expanded);
    }

    #[test]
    fn extracts_once_and_reuses_a_complete_content_hash() {
        let fixture = Fixture::new(base_entries());
        let first = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap();
        assert!(first.join("server.mjs").is_file());
        let sentinel = first.join("cache-reused.txt");
        fs::write(&sentinel, "keep").unwrap();

        let second = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap();
        assert_eq!(second, first);
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "keep");
        assert!(first.parent().unwrap().join(".complete.json").is_file());
    }

    #[test]
    fn rejects_checksum_mismatch_before_extraction() {
        let fixture = Fixture::new(base_entries());
        let mut manifest = fixture.manifest();
        manifest["sha256"] = Value::String("0".repeat(64));
        fixture.write_manifest(manifest);

        let error = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap_err();
        assert!(error.to_string().contains("checksum"));
        assert!(!fixture
            .data_dir
            .join("sidecar")
            .join("0".repeat(64))
            .exists());
    }

    #[test]
    fn rejects_malformed_and_unsupported_manifests() {
        let fixture = Fixture::new(base_entries());
        fs::write(&fixture.manifest_path, b"{").unwrap();
        assert!(resolve_server_dir(&fixture.resource_dir, &fixture.data_dir)
            .unwrap_err()
            .to_string()
            .contains("manifest"));

        let fixture = Fixture::new(base_entries());
        let mut manifest = fixture.manifest();
        manifest["schemaVersion"] = json!(2);
        fixture.write_manifest(manifest);
        assert!(resolve_server_dir(&fixture.resource_dir, &fixture.data_dir)
            .unwrap_err()
            .to_string()
            .contains("schema"));
    }

    #[test]
    fn rejects_absolute_and_parent_traversal_paths() {
        for unsafe_path in ["../escape.txt", "/absolute.txt", "server/../../escape.txt"] {
            let mut entries = base_entries();
            entries.push(TestEntry::RawFile(unsafe_path.into(), b"escape".to_vec()));
            let fixture = Fixture::new(entries);
            let error = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap_err();
            assert!(
                error.to_string().contains("unsafe"),
                "{unsafe_path}: {error}"
            );
            assert!(!fixture._temp.path().join("escape.txt").exists());
        }
    }

    #[test]
    fn rejects_links_and_special_entries() {
        for entry in [
            TestEntry::Link(
                EntryType::Symlink,
                "server/link".into(),
                "server.mjs".into(),
            ),
            TestEntry::Link(
                EntryType::Link,
                "server/hard-link".into(),
                "server/server.mjs".into(),
            ),
            TestEntry::Special(EntryType::Fifo, "server/fifo".into()),
        ] {
            let mut entries = base_entries();
            entries.push(entry);
            let fixture = Fixture::new(entries);
            let error = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap_err();
            assert!(error.to_string().contains("entry type"), "{error}");
        }
    }

    #[test]
    fn rejects_duplicate_paths_and_missing_required_entries() {
        let mut duplicate = base_entries();
        duplicate.push(TestEntry::File(
            "server/server.mjs".into(),
            b"duplicate".to_vec(),
        ));
        let fixture = Fixture::new(duplicate);
        assert!(resolve_server_dir(&fixture.resource_dir, &fixture.data_dir)
            .unwrap_err()
            .to_string()
            .contains("duplicate"));

        let missing = base_entries()
            .into_iter()
            .filter(
                |entry| !matches!(entry, TestEntry::File(path, _) if path == "server/vault.yaml"),
            )
            .collect();
        let fixture = Fixture::new(missing);
        assert!(resolve_server_dir(&fixture.resource_dir, &fixture.data_dir)
            .unwrap_err()
            .to_string()
            .contains("required"));
    }

    #[test]
    fn enforces_manifest_and_streaming_budgets() {
        let fixture = Fixture::new(base_entries());
        let limits = RuntimeArchiveLimits {
            max_entries: 7,
            max_unpacked_bytes: 1024,
            max_archive_bytes: 1024 * 1024,
        };
        assert!(
            resolve_server_dir_with_limits(&fixture.resource_dir, &fixture.data_dir, limits,)
                .unwrap_err()
                .to_string()
                .contains("entry budget")
        );

        let fixture = Fixture::new(base_entries());
        let limits = RuntimeArchiveLimits {
            max_entries: 100,
            max_unpacked_bytes: 1,
            max_archive_bytes: 1024 * 1024,
        };
        assert!(
            resolve_server_dir_with_limits(&fixture.resource_dir, &fixture.data_dir, limits,)
                .unwrap_err()
                .to_string()
                .contains("byte budget")
        );
    }

    #[test]
    fn repairs_incomplete_cache_and_removes_stale_staging() {
        let fixture = Fixture::new(base_entries());
        let hash = fixture.manifest()["sha256"].as_str().unwrap().to_owned();
        let cache = fixture.data_dir.join("sidecar").join(&hash);
        fs::create_dir_all(cache.join("server")).unwrap();
        fs::write(cache.join("server/partial.txt"), "partial").unwrap();
        fs::write(cache.join(".complete.json"), "{}").unwrap();
        let stale = fixture.data_dir.join("sidecar/.staging-abandoned");
        fs::create_dir_all(&stale).unwrap();

        let resolved = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap();
        assert_eq!(resolved, cache.join("server"));
        assert!(resolved.join("server.mjs").is_file());
        assert!(!resolved.join("partial.txt").exists());
        assert!(!stale.exists());
    }

    #[test]
    fn preserves_recent_well_formed_staging_from_a_concurrent_resolver() {
        let temp = tempfile::tempdir().unwrap();
        let hash = "a".repeat(64);
        let staging = temp.path().join(format!(".staging-{hash}-4242-7"));
        fs::create_dir_all(&staging).unwrap();

        remove_stale_staging(temp.path());

        assert!(staging.is_dir());
    }

    #[test]
    fn cache_lock_serializes_publishers_and_releases_cleanly() {
        let temp = tempfile::tempdir().unwrap();
        let first = CacheLock::acquire(temp.path(), &"a".repeat(64)).unwrap();
        let root = temp.path().to_owned();
        let (sent, received) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let _second = CacheLock::acquire(&root, &"a".repeat(64)).unwrap();
            sent.send(()).unwrap();
        });

        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
        drop(first);
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        waiter.join().unwrap();
    }

    #[test]
    fn failed_extraction_preserves_an_existing_complete_cache() {
        let fixture = Fixture::new(base_entries());
        let old_hash = "a".repeat(64);
        let old = write_complete_cache(&fixture.data_dir, &old_hash, &old_hash);
        let mut manifest = fixture.manifest();
        manifest["sha256"] = Value::String("0".repeat(64));
        fixture.write_manifest(manifest);

        assert!(resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).is_err());
        assert!(old.join("server/server.mjs").is_file());
        assert!(old.join(".complete.json").is_file());
    }

    #[test]
    fn concurrent_resolvers_converge_on_one_verified_cache() {
        let fixture = Fixture::new(base_entries());
        let resource_a = fixture.resource_dir.clone();
        let data_a = fixture.data_dir.clone();
        let resource_b = fixture.resource_dir.clone();
        let data_b = fixture.data_dir.clone();

        let a = thread::spawn(move || resolve_server_dir(&resource_a, &data_a).unwrap());
        let b = thread::spawn(move || resolve_server_dir(&resource_b, &data_b).unwrap());
        let a = a.join().unwrap();
        let b = b.join().unwrap();
        assert_eq!(a, b);
        assert!(a.join("server.mjs").is_file());
        let cache_root = fixture.data_dir.join("sidecar");
        assert_eq!(
            fs::read_dir(cache_root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                .count(),
            1,
        );
    }

    #[test]
    fn retains_current_and_only_one_previous_complete_cache() {
        let fixture = Fixture::new(base_entries());
        let first_hash = "a".repeat(64);
        let second_hash = "b".repeat(64);
        write_complete_cache(&fixture.data_dir, &first_hash, &first_hash);
        thread::sleep(Duration::from_millis(10));
        write_complete_cache(&fixture.data_dir, &second_hash, &second_hash);

        let current = resolve_server_dir(&fixture.resource_dir, &fixture.data_dir).unwrap();
        let current_hash = fixture.manifest()["sha256"].as_str().unwrap().to_owned();
        assert!(current.starts_with(fixture.data_dir.join("sidecar").join(&current_hash)));
        let complete: Vec<_> = fs::read_dir(fixture.data_dir.join("sidecar"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().join(".complete.json").is_file())
            .collect();
        assert_eq!(complete.len(), 2);
        assert!(complete
            .iter()
            .any(|entry| entry.file_name() == current_hash.as_str()));
    }

    #[test]
    fn archive_fixture_hash_matches_the_manifest() {
        let fixture = Fixture::new(base_entries());
        let archive = fs::read(&fixture.archive_path).unwrap();
        assert_eq!(fixture.manifest()["sha256"], sha256(&archive));
    }
}
