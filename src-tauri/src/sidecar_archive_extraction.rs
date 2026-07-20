use super::*;
use std::path::Component;
use zstd::stream::read::Decoder as ZstdDecoder;

pub(super) fn tree_metrics(root: &Path) -> Result<(u64, u64, u64, String), String> {
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

pub(super) fn extract_archive(
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
