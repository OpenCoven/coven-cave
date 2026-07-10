use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MANIFEST_SCHEMA_VERSION: u32 = 1;
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
            marker.schema_version == MANIFEST_SCHEMA_VERSION
                && marker.package_version == package_version
                && marker.archive_sha256 == archive_sha256
        }
        Err(_) => false,
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
) -> Result<(), String> {
    let archive_file = File::open(archive_path).map_err(|error| {
        format!(
            "could not open sidecar archive {}: {error}",
            archive_path.display()
        )
    })?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);
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

    Ok(())
}

fn prepare_runtime_from_files(
    archive_path: &Path,
    manifest_path: &Path,
    cache_root: &Path,
    package_version: &str,
) -> Result<PathBuf, String> {
    let manifest = read_manifest(manifest_path)?;
    let destination = cache_root.join(cache_key(package_version, &manifest.archive_sha256));
    if cache_is_ready(&destination, package_version, &manifest.archive_sha256) {
        return Ok(destination);
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

    fs::create_dir_all(cache_root).map_err(|error| {
        format!(
            "could not create sidecar cache {}: {error}",
            cache_root.display()
        )
    })?;
    if cache_is_ready(&destination, package_version, &manifest.archive_sha256) {
        return Ok(destination);
    }
    if destination.exists() {
        fs::remove_dir_all(&destination).map_err(|error| {
            format!(
                "could not replace incomplete sidecar cache {}: {error}",
                destination.display()
            )
        })?;
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
    fs::create_dir(&staging).map_err(|error| {
        format!(
            "could not create sidecar staging directory {}: {error}",
            staging.display()
        )
    })?;

    let extraction = (|| -> Result<(), String> {
        extract_archive(archive_path, &staging, &manifest)?;
        let marker = CompletionMarker {
            schema_version: MANIFEST_SCHEMA_VERSION,
            package_version: package_version.to_string(),
            archive_sha256: manifest.archive_sha256.clone(),
        };
        let marker_json = serde_json::to_string_pretty(&marker)
            .map_err(|error| format!("could not serialize sidecar completion marker: {error}"))?;
        fs::write(staging.join(".complete.json"), format!("{marker_json}\n"))
            .map_err(|error| format!("could not write sidecar completion marker: {error}"))?;
        Ok(())
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    match fs::rename(&staging, &destination) {
        Ok(()) => Ok(destination),
        Err(_error) if cache_is_ready(&destination, package_version, &manifest.archive_sha256) => {
            let _ = fs::remove_dir_all(&staging);
            Ok(destination)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
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
    match serde_json::from_str::<CompletionMarker>(&contents) {
        Ok(marker) => {
            marker.schema_version == MANIFEST_SCHEMA_VERSION
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
    let archive_path = archive_dir.join("server.tar.gz");
    let manifest_path = archive_dir.join("manifest.json");
    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not resolve sidecar cache directory: {error}"))?
        .join("sidecar-runtime");
    let started = Instant::now();
    let runtime = prepare_runtime_from_files(
        &archive_path,
        &manifest_path,
        &cache_root,
        &app.package_info().version.to_string(),
    )?;
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
    use flate2::{write::GzEncoder, Compression};

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

        let archive_path = root.join("server.tar.gz");
        let archive_file = File::create(&archive_path).expect("create archive");
        let encoder = GzEncoder::new(archive_file, Compression::default());
        let mut archive = tar::Builder::new(encoder);
        archive
            .append_dir_all(".", &source)
            .expect("append fixture tree");
        let encoder = archive.into_inner().expect("finish tar");
        encoder.finish().expect("finish gzip");
        let (file_count, directory_count, unpacked_bytes) =
            tree_metrics(&source).expect("fixture metrics");
        let manifest = SidecarArchiveManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
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
        let runtime = prepare_runtime_from_files(&archive, &manifest, &cache, "1.2.3")
            .expect("extract runtime");
        assert!(runtime.join("server.mjs").is_file());
        assert!(runtime.join(".complete.json").is_file());

        fs::remove_file(&archive).expect("remove archive after first extraction");
        assert_eq!(
            prepare_runtime_from_files(&archive, &manifest, &cache, "1.2.3").expect("reuse cache"),
            runtime
        );
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
        assert!(!runtime.join("partial").exists());
        assert!(runtime.join("server.mjs").is_file());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_a_corrupt_archive_without_activating_it() {
        let root = test_root("corrupt");
        let (archive, manifest, _) = write_fixture(&root);
        fs::write(&archive, b"not a gzip archive").expect("corrupt archive");
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
    fn extracts_the_built_windows_archive_when_available() {
        let archive_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("server-archive");
        let archive = archive_dir.join("server.tar.gz");
        let manifest = archive_dir.join("manifest.json");
        if !archive.is_file() || !manifest.is_file() {
            // Plain cargo test/check runs do not build release resources. The
            // Windows sidecar-runtime CI leg builds them before this test.
            return;
        }
        let root = test_root("built-archive");
        let runtime = prepare_runtime_from_files(&archive, &manifest, &root, "ci-fixture")
            .expect("extract built Windows archive with production code");
        assert!(runtime_has_required_files(&runtime));
        fs::remove_dir_all(root).expect("remove built archive fixture");
    }
}
