use super::*;

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

pub(super) fn cleanup_stale_sidecar_runtimes(current: &Path) {
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
