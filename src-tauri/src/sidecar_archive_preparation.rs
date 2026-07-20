use super::*;

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
