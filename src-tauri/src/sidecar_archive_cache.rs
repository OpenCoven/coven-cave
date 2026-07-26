use super::*;

pub(super) struct CacheLock {
    _file: File,
}

fn lock_is_contended(error: &io::Error) -> bool {
    let expected = fs2::lock_contended_error();
    match (error.raw_os_error(), expected.raw_os_error()) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => error.kind() == expected.kind(),
    }
}

pub(super) fn acquire_cache_lock(cache_root: &Path) -> Result<CacheLock, String> {
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

pub(super) fn try_acquire_cache_lock(cache_root: &Path) -> Result<Option<CacheLock>, String> {
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

pub(super) fn required_free_space(manifest: &SidecarArchiveManifest) -> Result<u64, String> {
    let reserve = MIN_FREE_SPACE_RESERVE_BYTES.max(manifest.unpacked_bytes / 10);
    manifest
        .unpacked_bytes
        .checked_add(reserve)
        .ok_or_else(|| "sidecar free-space requirement overflow".to_string())
}

pub(super) fn remove_cache_path(path: &Path) -> Result<(), String> {
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

pub(super) fn cleanup_staging_before_extraction(
    cache_root: &Path,
    key: &str,
) -> Result<(), String> {
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

pub(super) fn create_staging_directory(cache_root: &Path, key: &str) -> Result<PathBuf, String> {
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
