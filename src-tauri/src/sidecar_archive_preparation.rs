use super::*;

pub(super) const ACTIVATION_RETRY_DELAYS: [Duration; 5] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
    Duration::from_millis(800),
];

fn is_retryable_activation_error(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code)
            if code == ERROR_ACCESS_DENIED as i32 || code == ERROR_SHARING_VIOLATION as i32
    )
}

fn cache_path_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "<cache-root>".to_string())
}

pub(super) fn activate_extracted_cache_with(
    staging: &Path,
    destination: &Path,
    manifest: &SidecarArchiveManifest,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    mut wait: impl FnMut(Duration),
) -> Result<(), String> {
    let started = Instant::now();
    let maximum_attempts = ACTIVATION_RETRY_DELAYS.len() + 1;

    for attempt in 1..=maximum_attempts {
        let error = match rename(staging, destination) {
            Ok(()) => {
                if attempt > 1 {
                    log::info!(
                        "[cave] sidecar cache activation recovered attempt={attempt}/{maximum_attempts} elapsed_ms={}",
                        started.elapsed().as_millis()
                    );
                }
                return Ok(());
            }
            Err(error) => error,
        };

        let source_exists = staging.exists();
        let destination_exists = destination.exists();
        let destination_ready = cache_is_ready(destination, manifest);
        if destination_ready {
            match remove_cache_path(staging) {
                Ok(()) => log::info!(
                    "[cave] sidecar cache activation reused concurrent destination attempt={attempt}/{maximum_attempts} elapsed_ms={} staging={}",
                    started.elapsed().as_millis(),
                    cache_path_label(staging)
                ),
                Err(cleanup_error) => log::warn!(
                    "[cave] sidecar cache activation reused concurrent destination but staging cleanup failed attempt={attempt}/{maximum_attempts} elapsed_ms={} staging={} error={cleanup_error}",
                    started.elapsed().as_millis(),
                    cache_path_label(staging)
                ),
            }
            return Ok(());
        }

        if is_retryable_activation_error(&error) {
            if let Some(delay) = ACTIVATION_RETRY_DELAYS.get(attempt - 1).copied() {
                log::warn!(
                    "[cave] sidecar cache activation retry attempt={attempt}/{maximum_attempts} delay_ms={} elapsed_ms={} kind={:?} raw_os_error={:?} staging={} destination={} source_exists={source_exists} destination_exists={destination_exists} destination_ready={destination_ready}",
                    delay.as_millis(),
                    started.elapsed().as_millis(),
                    error.kind(),
                    error.raw_os_error(),
                    cache_path_label(staging),
                    cache_path_label(destination)
                );
                wait(delay);
                continue;
            }
        }

        let cleanup_error = remove_cache_path(staging).err();
        log::warn!(
            "[cave] sidecar cache activation failed attempt={attempt}/{maximum_attempts} elapsed_ms={} kind={:?} raw_os_error={:?} staging={} destination={} source_exists={source_exists} destination_exists={destination_exists} destination_ready={destination_ready} cleanup={}",
            started.elapsed().as_millis(),
            error.kind(),
            error.raw_os_error(),
            cache_path_label(staging),
            cache_path_label(destination),
            if cleanup_error.is_some() { "failed" } else { "succeeded" }
        );
        let cleanup_detail = cleanup_error
            .map(|cleanup_error| format!("; staging cleanup also failed: {cleanup_error}"))
            .unwrap_or_default();
        return Err(format!(
            "could not activate extracted sidecar cache {} after {attempt} attempt(s): {error} (kind: {:?}, raw OS error: {:?}){cleanup_detail}",
            destination.display(),
            error.kind(),
            error.raw_os_error()
        ));
    }

    unreachable!("activation attempts are bounded by a non-empty delay schedule")
}

pub(super) fn prepare_runtime_from_files(
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

pub(super) fn prepare_runtime_from_files_with_space(
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

    activate_extracted_cache_with(
        &staging,
        &destination,
        &manifest,
        |source, destination| fs::rename(source, destination),
        thread::sleep,
    )?;
    Ok(destination)
}
