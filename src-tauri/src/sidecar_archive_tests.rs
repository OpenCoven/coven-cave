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
    let runtime = prepare_runtime_from_files(&archive, &manifest, &cache).expect("extract runtime");
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
    let error = prepare_runtime_from_files_with_space(&archive, &manifest_path, &cache, &|_| {
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
        fs::read(reused.join("node_modules/@swc/helpers/_/index")).expect("read untouched helper"),
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
