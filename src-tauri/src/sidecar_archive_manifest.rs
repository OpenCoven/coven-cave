use serde::Deserialize;
use std::fs;
use std::path::Path;

pub(super) const MANIFEST_SCHEMA_VERSION: u32 = 3;
pub(super) const ARCHIVE_FORMAT: &str = "tar.zst";
pub(super) const MAX_ARCHIVE_BYTES: u64 = 80 * 1024 * 1024;
pub(super) const MAX_UNPACKED_BYTES: u64 = 200 * 1024 * 1024 - 1;
pub(super) const MAX_FILE_COUNT: u64 = 5_554;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SidecarArchiveManifest {
    pub(super) schema_version: u32,
    pub(super) archive_format: String,
    pub(super) payload_sha256: String,
    pub(super) tree_sha256: String,
    pub(super) archive_sha256: String,
    pub(super) archive_bytes: u64,
    pub(super) unpacked_bytes: u64,
    pub(super) file_count: u64,
    pub(super) directory_count: u64,
}

pub(super) fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn read_manifest(path: &Path) -> Result<SidecarArchiveManifest, String> {
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

pub(super) fn cache_key(manifest: &SidecarArchiveManifest) -> String {
    // Cache identity follows canonical payload content, not the app version or
    // zstd envelope, so unchanged runtimes survive consecutive upgrades.
    format!("v{}-{}", manifest.schema_version, manifest.payload_sha256)
}
