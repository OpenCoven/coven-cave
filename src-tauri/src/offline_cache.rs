//! Encrypted, replaceable offline read cache (cave-f1k8n).
//!
//! Chat already keeps the last few conversation payloads in memory
//! (`src/lib/conversation-cache.ts`) so switching threads doesn't flash a
//! skeleton. That tier dies with the window, so a Cave whose daemon is down
//! has nothing to show at all. This module is the durable tier underneath it:
//! the last successfully loaded payload per entry, on disk, so an offline
//! launch can render history instead of an empty room.
//!
//! History on disk is the whole risk, so the file format is built around four
//! properties rather than speed:
//!
//!  - **Encrypted.** AES-256-GCM. The key is derived (HKDF-SHA256) from a
//!    32-byte root secret that lives in the OS keychain and never on disk, so
//!    the cache is unreadable to anything that only has the filesystem. Scope
//!    and entry names never reach the filesystem: the path components are
//!    *keyed* derivations of them under that same root secret, so a file
//!    reveals neither what it holds nor what it is for. A plain digest would
//!    not have done — the scope vocabulary is a short closed list and entry
//!    keys are frequently ids an observer already holds, so an unkeyed
//!    `sha256(scope || key)` is a value anyone can recompute and match
//!    against the directory listing.
//!  - **Instance-scoped.** Entries live under the instance id and carry it in
//!    the authenticated header, and the id is the HKDF salt. Another Cave
//!    instance's cache therefore fails the header check *and* cannot be
//!    decrypted — it is never served as current data.
//!  - **Replaceable.** Every entry is staged to a unique sibling and renamed
//!    over its target, so a torn write leaves the previous entry intact. This
//!    deliberately does not reuse `reliability_metrics::write_private_atomic`:
//!    that helper preserves the existing file through a backup because losing
//!    a measurement loses evidence, whereas a cache entry is by definition
//!    reconstructible from the daemon and a failed swap should simply keep
//!    whatever was already there.
//!  - **Bounded and self-purging.** Caps on entry size, entry count and total
//!    bytes; anything that fails to parse, decrypt, or match the current
//!    schema/instance is deleted on sight and recorded as a classified fault
//!    rather than surfaced as data.
//!
//! Reads are read-only by construction: `OfflineCacheEntry::read_only` is
//! always true, and nothing in this module can turn a cached read into a write
//! against the daemon.
//!
//! **Envelope layout** (all integers little-endian):
//!
//! ```text
//! magic          8 bytes   b"CVOFFL01"
//! header_len     4 bytes   u32, length of the JSON header
//! header         N bytes   JSON, authenticated but NOT encrypted
//! ciphertext     rest      AES-256-GCM(payload), AAD = magic||header_len||header
//! ```
//!
//! The header is plaintext because staleness and ownership have to be decided
//! before a key is derived; it carries no payload text and no entry names,
//! only the keyed entry id, the caller's opaque revision string, a timestamp,
//! the plaintext length, and the nonce.
//!
//! **Platform note.** On Linux the keychain backend is the kernel session
//! keyring (`keyring`'s `linux-native`), which does not survive a logout. The
//! cache then reads as undecryptable, purges itself, and refills — degraded,
//! but never wrong. macOS and Windows use their persistent native stores.

use super::*;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::VecDeque;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

/// Bumped whenever the envelope or the derivation changes. Entries written by
/// another generation are purged rather than migrated in place: the payload is
/// a cache of daemon state, so refetching is cheaper and safer than teaching
/// every future reader every past layout.
pub(super) const OFFLINE_CACHE_SCHEMA_VERSION: u16 = 2;

const OFFLINE_CACHE_DIR: &str = "offline-cache";
const INSTANCE_FILE: &str = "instance-id";
const ENTRY_EXTENSION: &str = "bin";
const ENVELOPE_MAGIC: &[u8; 8] = b"CVOFFL01";
const HEADER_LEN_BYTES: usize = 4;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const INSTANCE_ID_BYTES: usize = 16;

/// Per-entry plaintext ceiling. A conversation payload is tens of kilobytes;
/// anything at this size is carrying something it should have stripped.
pub(super) const MAX_ENTRY_BYTES: usize = 1024 * 1024;
/// The largest a well-formed envelope can be: the payload ceiling, plus room
/// for the plaintext header and the GCM tag. Read-side only — it is what lets
/// an entry be refused from its metadata rather than after it is in memory.
const MAX_ENVELOPE_BYTES: u64 = MAX_ENTRY_BYTES as u64 + 4096;
pub(super) const MAX_ENTRIES: usize = 256;
pub(super) const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
/// Scope and key are replaced by keyed derivations before they touch the
/// filesystem, so this bound is about keeping derivation inputs sane rather
/// than about path safety.
const MAX_NAME_LEN: usize = 128;
const MAX_REVISION_LEN: usize = 256;
/// Foreign instance directories are another install's business, so they are
/// left alone until they are plainly abandoned.
const FOREIGN_INSTANCE_MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const FAULT_LOG_LIMIT: usize = 16;

const KEYCHAIN_SERVICE: &str = "coven-cave";
const KEYCHAIN_ACCOUNT: &str = "offline-cache-root-key-v1";

static NEXT_STAGING_FILE: AtomicU64 = AtomicU64::new(1);

/// Why an entry was refused. Every variant is a static classification with no
/// path, payload, or entry name in it — a cache diagnostic must never become
/// the leak the encryption exists to prevent.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum OfflineCacheFaultKind {
    /// Shorter than the envelope's fixed preamble requires.
    Truncated,
    /// Not an offline-cache envelope at all.
    MagicMismatch,
    /// Header bytes are not the JSON this generation writes.
    HeaderMalformed,
    /// Written by a different schema generation.
    SchemaMismatch,
    /// Written by a different Cave instance.
    InstanceMismatch,
    /// Header describes a different entry than the file it was found in.
    EntryMismatch,
    /// Header's declared plaintext length disagrees with what decrypted.
    LengthMismatch,
    /// Authentication or decryption failed: tampering, or a rotated key.
    Undecryptable,
    /// Beyond the configured caps.
    Oversized,
    /// The plaintext is not valid UTF-8, so no writer of ours produced it.
    PayloadMalformed,
    /// The entry could not be read from or removed from disk.
    Io,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OfflineCacheFault {
    pub(super) kind: OfflineCacheFaultKind,
    pub(super) detail: &'static str,
}

impl OfflineCacheFault {
    fn new(kind: OfflineCacheFaultKind, detail: &'static str) -> Self {
        Self { kind, detail }
    }
}

/// A cached payload. `read_only` is a constant rather than a field the caller
/// can influence: everything this cache hands back is a historical read, and
/// the surface that renders it has to be able to say so without inferring it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OfflineCacheEntry {
    pub(super) payload: String,
    pub(super) revision: String,
    pub(super) updated_at_unix_ms: u64,
    pub(super) read_only: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OfflineCacheReadResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) entry: Option<OfflineCacheEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) fault: Option<OfflineCacheFault>,
    /// True when the read deleted an unusable entry, so the caller knows the
    /// miss is permanent rather than worth retrying.
    pub(super) purged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OfflineCacheStatus {
    pub(super) schema_version: u16,
    pub(super) instance_id: String,
    pub(super) entries: usize,
    pub(super) bytes: u64,
    pub(super) max_entries: usize,
    pub(super) max_entry_bytes: usize,
    pub(super) max_total_bytes: u64,
    pub(super) faults: Vec<OfflineCacheFault>,
}

/// The plaintext, authenticated preamble. `deny_unknown_fields` makes a header
/// from a future generation a classified fault instead of a silent
/// partial-parse.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OfflineCacheHeader {
    schema_version: u16,
    instance_id: String,
    entry_id: String,
    revision: String,
    updated_at_unix_ms: u64,
    payload_bytes: u32,
    nonce: String,
}

/// Everything a read or write needs, with no Tauri and no keychain in it, so
/// the whole format is exercisable from unit tests.
pub(super) struct OfflineCacheContext {
    root: PathBuf,
    instance_id: String,
    secret: Zeroizing<[u8; KEY_BYTES]>,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
        out.push(char::from_digit(u32::from(byte & 0x0f), 16).unwrap_or('0'));
    }
    out
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks(2) {
        let high = (pair[0] as char).to_digit(16)?;
        let low = (pair[1] as char).to_digit(16)?;
        out.push(((high << 4) | low) as u8);
    }
    Some(out)
}

/// Scope and key are opaque caller strings, so they are bounded and screened
/// for control characters before they reach derivation. They never reach the
/// filesystem in any form: both are hashed.
fn validate_name(value: &str, subject: &'static str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("offline cache {subject} must not be empty"));
    }
    if value.len() > MAX_NAME_LEN {
        return Err(format!("offline cache {subject} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("offline cache {subject} contains control characters"));
    }
    Ok(())
}

impl OfflineCacheContext {
    /// Entries are filed under the schema generation first so that a bump can
    /// discard an entire past layout with one directory removal.
    fn generation_dir(&self) -> PathBuf {
        self.root
            .join(format!("v{OFFLINE_CACHE_SCHEMA_VERSION}"))
    }

    fn instance_dir(&self) -> PathBuf {
        self.generation_dir().join(&self.instance_id)
    }

    fn scope_dir(&self, scope: &str) -> PathBuf {
        self.instance_dir().join(self.scope_id(scope))
    }

    fn entry_path(&self, scope: &str, key: &str) -> PathBuf {
        self.scope_dir(scope)
            .join(format!("{}.{ENTRY_EXTENSION}", self.entry_id(scope, key)))
    }

    /// Domain-separated, unambiguous HKDF info. The generation and the domain
    /// lead, and `0x1f` separates every caller-supplied part, so no pair of
    /// distinct inputs can produce the same info string.
    fn derivation_info(&self, domain: &str, parts: &[&[u8]]) -> Vec<u8> {
        let mut info = format!("coven-cave/offline-cache/v{OFFLINE_CACHE_SCHEMA_VERSION}/{domain}")
            .into_bytes();
        for part in parts {
            info.push(0x1f);
            info.extend_from_slice(part);
        }
        info
    }

    /// HKDF-Expand is HMAC-SHA256, so this is a keyed PRF over the caller's
    /// names rather than a digest of them. That is the whole point: the scope
    /// vocabulary is short and entry keys are ids an observer may already
    /// hold, so an unkeyed digest would let anyone with the directory listing
    /// confirm exactly which conversations this install has cached.
    fn derive_id(&self, domain: &str, parts: &[&[u8]]) -> String {
        let hkdf = Hkdf::<Sha256>::new(Some(self.instance_id.as_bytes()), self.secret.as_slice());
        let mut derived = Zeroizing::new([0u8; KEY_BYTES]);
        hkdf.expand(
            &self.derivation_info(domain, parts),
            derived.as_mut_slice(),
        )
        .expect("32 bytes is a valid HKDF-SHA256 output length");
        hex_encode(derived.as_slice())
    }

    /// The directory an entry is filed under. Truncated because it only has to
    /// separate scopes within one instance, not resist collision search.
    fn scope_id(&self, scope: &str) -> String {
        self.derive_id("scope", &[scope.as_bytes()])[..32].to_string()
    }

    /// The entry's file stem and the id recorded in its plaintext header.
    fn entry_id(&self, scope: &str, key: &str) -> String {
        self.derive_id("entry", &[scope.as_bytes(), key.as_bytes()])
    }

    /// One key per entry, salted by the instance and bound to the exact scope
    /// and key. Moving a file to another name, another scope, or another
    /// instance's directory therefore makes it undecryptable rather than
    /// merely mislabelled.
    fn entry_key(&self, scope: &str, key: &str) -> Zeroizing<[u8; KEY_BYTES]> {
        let hkdf = Hkdf::<Sha256>::new(Some(self.instance_id.as_bytes()), self.secret.as_slice());
        let mut derived = Zeroizing::new([0u8; KEY_BYTES]);
        hkdf.expand(
            &self.derivation_info("entry-key", &[scope.as_bytes(), key.as_bytes()]),
            derived.as_mut_slice(),
        )
        .expect("32 bytes is a valid HKDF-SHA256 output length");
        derived
    }
}

fn envelope_aad(header_len: u32, header: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES + header.len());
    aad.extend_from_slice(ENVELOPE_MAGIC);
    aad.extend_from_slice(&header_len.to_le_bytes());
    aad.extend_from_slice(header);
    aad
}

fn encode_envelope(
    context: &OfflineCacheContext,
    scope: &str,
    key: &str,
    payload: &str,
    revision: &str,
    updated_at_unix_ms: u64,
) -> Result<Vec<u8>, String> {
    if payload.len() > MAX_ENTRY_BYTES {
        return Err("offline cache entry exceeds the per-entry budget".to_string());
    }
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce_bytes);
    let header = OfflineCacheHeader {
        schema_version: OFFLINE_CACHE_SCHEMA_VERSION,
        instance_id: context.instance_id.clone(),
        entry_id: context.entry_id(scope, key),
        revision: revision.to_string(),
        updated_at_unix_ms,
        payload_bytes: u32::try_from(payload.len())
            .map_err(|_| "offline cache entry exceeds the per-entry budget".to_string())?,
        nonce: hex_encode(&nonce_bytes),
    };
    let header_json = serde_json::to_vec(&header)
        .map_err(|_| "offline cache header could not be serialized".to_string())?;
    let header_len = u32::try_from(header_json.len())
        .map_err(|_| "offline cache header is too large".to_string())?;
    let aad = envelope_aad(header_len, &header_json);

    let derived = context.entry_key(scope, key);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(derived.as_slice()));
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: payload.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| "offline cache entry could not be encrypted".to_string())?;

    let mut envelope = aad;
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

fn decode_envelope(
    context: &OfflineCacheContext,
    scope: &str,
    key: &str,
    envelope: &[u8],
) -> Result<OfflineCacheEntry, OfflineCacheFault> {
    let preamble = ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES;
    if envelope.len() < preamble {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::Truncated,
            "entry is shorter than the envelope preamble",
        ));
    }
    if &envelope[..ENVELOPE_MAGIC.len()] != ENVELOPE_MAGIC {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::MagicMismatch,
            "entry is not an offline cache envelope",
        ));
    }
    let mut length_bytes = [0u8; HEADER_LEN_BYTES];
    length_bytes.copy_from_slice(&envelope[ENVELOPE_MAGIC.len()..preamble]);
    let header_len = u32::from_le_bytes(length_bytes) as usize;
    let header_end = preamble
        .checked_add(header_len)
        .filter(|end| *end <= envelope.len())
        .ok_or_else(|| {
            OfflineCacheFault::new(
                OfflineCacheFaultKind::Truncated,
                "entry header extends past the end of the file",
            )
        })?;
    let header_json = &envelope[preamble..header_end];
    let header: OfflineCacheHeader = serde_json::from_slice(header_json).map_err(|_| {
        OfflineCacheFault::new(
            OfflineCacheFaultKind::HeaderMalformed,
            "entry header is not readable by this generation",
        )
    })?;

    if header.schema_version != OFFLINE_CACHE_SCHEMA_VERSION {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::SchemaMismatch,
            "entry was written by a different cache generation",
        ));
    }
    if header.instance_id != context.instance_id {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::InstanceMismatch,
            "entry belongs to a different Cave instance",
        ));
    }
    if header.entry_id != context.entry_id(scope, key) {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::EntryMismatch,
            "entry header names a different cache entry",
        ));
    }
    if header.payload_bytes as usize > MAX_ENTRY_BYTES {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::Oversized,
            "entry declares more payload than the per-entry budget allows",
        ));
    }
    if header.revision.len() > MAX_REVISION_LEN {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::HeaderMalformed,
            "entry revision exceeds the recorded bound",
        ));
    }
    let nonce_bytes = hex_decode(&header.nonce)
        .filter(|bytes| bytes.len() == NONCE_BYTES)
        .ok_or_else(|| {
            OfflineCacheFault::new(
                OfflineCacheFaultKind::HeaderMalformed,
                "entry nonce is not a 12-byte value",
            )
        })?;

    let aad = envelope_aad(header_len as u32, header_json);
    let derived = context.entry_key(scope, key);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(derived.as_slice()));
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: &envelope[header_end..],
                aad: &aad,
            },
        )
        .map_err(|_| {
            OfflineCacheFault::new(
                OfflineCacheFaultKind::Undecryptable,
                "entry failed authentication with the current cache key",
            )
        })?;
    if plaintext.len() != header.payload_bytes as usize {
        return Err(OfflineCacheFault::new(
            OfflineCacheFaultKind::LengthMismatch,
            "entry payload length disagrees with its header",
        ));
    }
    let payload = String::from_utf8(plaintext).map_err(|_| {
        OfflineCacheFault::new(
            OfflineCacheFaultKind::PayloadMalformed,
            "entry payload is not valid UTF-8",
        )
    })?;

    Ok(OfflineCacheEntry {
        payload,
        revision: header.revision,
        updated_at_unix_ms: header.updated_at_unix_ms,
        read_only: true,
    })
}

/// Stage-and-rename. The staging name is unique per process and call so two
/// writers never share one, and a failure removes the staging file and leaves
/// the previous entry in place.
fn write_entry_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "offline cache entry path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "could not create the offline cache directory".to_string())?;
    let sequence = NEXT_STAGING_FILE.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "offline cache entry path has no file name".to_string())?;
    let staging = parent.join(format!(
        "{file_name}.tmp-{}-{sequence}",
        std::process::id()
    ));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&staging)
            .map_err(|_| "could not open the offline cache staging file".to_string())?;
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|_| "could not write the offline cache staging file".to_string())?;
        drop(file);
        // `rename` replaces an existing destination on every platform we ship,
        // and a cache entry needs no backup copy: if the swap fails the
        // previous entry is still the one on disk.
        std::fs::rename(&staging, path)
            .map_err(|_| "could not replace the offline cache entry".to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result
}

#[derive(Debug, PartialEq, Eq)]
struct EntryFile {
    path: PathBuf,
    bytes: u64,
    modified_unix_ms: u64,
}

fn is_entry_file(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .and_then(|name| name.strip_suffix(&format!(".{ENTRY_EXTENSION}")))
        .is_some_and(|stem| {
            stem.len() == 64 && stem.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

/// Every entry currently filed for this instance, newest first. Staging files
/// and anything that is not a well-formed entry name are ignored here and
/// reclaimed by [`sweep_staging_files`].
fn collect_entries(context: &OfflineCacheContext) -> Result<Vec<EntryFile>, String> {
    let instance_dir = context.instance_dir();
    let scopes = match std::fs::read_dir(&instance_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("could not inspect the offline cache".to_string()),
    };
    let mut files = Vec::new();
    for scope in scopes.flatten() {
        if !scope.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(scope.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            if !is_entry_file(&entry.file_name()) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            files.push(EntryFile {
                path: entry.path(),
                bytes: metadata.len(),
                modified_unix_ms: metadata
                    .modified()
                    .unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64,
            });
        }
    }
    files.sort_by(|left, right| {
        right
            .modified_unix_ms
            .cmp(&left.modified_unix_ms)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(files)
}

/// Which entries have to go for the cache to fit its caps, oldest first.
/// Separated from the removal so the policy is testable without a filesystem.
fn entries_over_budget(files: &[EntryFile]) -> Vec<&Path> {
    let mut running = 0u64;
    let mut evict = Vec::new();
    for (index, file) in files.iter().enumerate() {
        running = running.saturating_add(file.bytes);
        if index >= MAX_ENTRIES || running > MAX_TOTAL_BYTES {
            evict.push(file.path.as_path());
        }
    }
    evict
}

fn enforce_caps(context: &OfflineCacheContext) -> Result<(), String> {
    let files = collect_entries(context)?;
    for path in entries_over_budget(&files) {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("could not evict an offline cache entry".to_string()),
        }
    }
    Ok(())
}

/// A staging file only outlives its writer if the process died mid-write, so
/// any that are still here at startup are debris.
fn sweep_staging_files(context: &OfflineCacheContext) {
    let Ok(scopes) = std::fs::read_dir(context.instance_dir()) else {
        return;
    };
    for scope in scopes.flatten() {
        let Ok(entries) = std::fs::read_dir(scope.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.contains(&format!(".{ENTRY_EXTENSION}.tmp-")) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn modified_unix_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

/// How recently anything under an instance's tree changed.
///
/// A directory's own mtime moves only when a child is created or removed, and
/// an established cache does neither: it renames a replacement over an entry
/// that already exists, which touches the *scope* directory and the entry
/// file. So a live install's instance directory carries the timestamp of the
/// last time it gained a scope, which can be arbitrarily long ago. Reading
/// that stamp alone would eventually reclaim a running install's cache out
/// from under it. The tree is two levels deep by construction
/// (`instance/scope/entry.bin`), so this walk is bounded.
fn newest_activity_unix_ms(instance_dir: &Path) -> u64 {
    let mut newest = modified_unix_ms(instance_dir);
    let Ok(scopes) = std::fs::read_dir(instance_dir) else {
        return newest;
    };
    for scope in scopes.flatten() {
        newest = newest.max(modified_unix_ms(&scope.path()));
        let Ok(entries) = std::fs::read_dir(scope.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            newest = newest.max(modified_unix_ms(&entry.path()));
        }
    }
    newest
}

/// Drop generations this build no longer reads, and instance directories that
/// nothing has touched in a month. Both are pure reclamation: the current
/// instance's current generation is never a candidate.
fn purge_incompatible_generations(context: &OfflineCacheContext, now_unix_ms: u64) {
    let current_generation = format!("v{OFFLINE_CACHE_SCHEMA_VERSION}");
    let Ok(generations) = std::fs::read_dir(&context.root) else {
        return;
    };
    for generation in generations.flatten() {
        if !generation
            .file_type()
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let name = generation.file_name();
        let Some(name) = name.to_str() else { continue };
        if name != current_generation {
            let _ = std::fs::remove_dir_all(generation.path());
            continue;
        }
        let Ok(instances) = std::fs::read_dir(generation.path()) else {
            continue;
        };
        for instance in instances.flatten() {
            if instance.file_name().to_str() == Some(context.instance_id.as_str()) {
                continue;
            }
            let newest = newest_activity_unix_ms(&instance.path());
            if now_unix_ms.saturating_sub(newest) > FOREIGN_INSTANCE_MAX_AGE_MS {
                let _ = std::fs::remove_dir_all(instance.path());
            }
        }
    }
}

/// An entry we cannot serve is never left behind to be re-read on every
/// launch: the purge is the migration path for a schema bump, a rotated key,
/// and a corrupted file alike.
fn purge_unusable(path: &Path, fault: OfflineCacheFault) -> OfflineCacheReadResult {
    let purged = match std::fs::remove_file(path) {
        Ok(()) => true,
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    };
    OfflineCacheReadResult {
        entry: None,
        fault: Some(fault),
        purged,
    }
}

fn read_entry(context: &OfflineCacheContext, scope: &str, key: &str) -> OfflineCacheReadResult {
    let path = context.entry_path(scope, key);
    // Size is checked from the directory entry, before a single byte is read.
    // The per-entry cap otherwise only binds what this build *writes*: a file
    // that grew by any other means — a corrupt filesystem, a build with a
    // larger ceiling, anything with write access to the cache — would be
    // loaded into memory in full and only then measured.
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.len() > MAX_ENVELOPE_BYTES => {
            return purge_unusable(
                &path,
                OfflineCacheFault::new(
                    OfflineCacheFaultKind::Oversized,
                    "entry is larger than any envelope this cache writes",
                ),
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return OfflineCacheReadResult::default();
        }
        Err(_) => {
            return OfflineCacheReadResult {
                entry: None,
                fault: Some(OfflineCacheFault::new(
                    OfflineCacheFaultKind::Io,
                    "entry could not be read from disk",
                )),
                purged: false,
            };
        }
    }
    let envelope = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return OfflineCacheReadResult::default();
        }
        Err(_) => {
            return OfflineCacheReadResult {
                entry: None,
                fault: Some(OfflineCacheFault::new(
                    OfflineCacheFaultKind::Io,
                    "entry could not be read from disk",
                )),
                purged: false,
            };
        }
    };
    match decode_envelope(context, scope, key, &envelope) {
        Ok(entry) => OfflineCacheReadResult {
            entry: Some(entry),
            fault: None,
            purged: false,
        },
        Err(fault) => purge_unusable(&path, fault),
    }
}

fn write_entry(
    context: &OfflineCacheContext,
    scope: &str,
    key: &str,
    payload: &str,
    revision: &str,
    updated_at_unix_ms: u64,
) -> Result<(), String> {
    let envelope = encode_envelope(context, scope, key, payload, revision, updated_at_unix_ms)?;
    write_entry_file(&context.entry_path(scope, key), &envelope)?;
    enforce_caps(context)
}

fn clear_entries(context: &OfflineCacheContext, scope: Option<&str>) -> Result<(), String> {
    let target = match scope {
        Some(scope) => context.scope_dir(scope),
        None => context.instance_dir(),
    };
    match std::fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("could not clear the offline cache".to_string()),
    }
}

fn read_instance_id(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    (trimmed.len() == INSTANCE_ID_BYTES * 2
        && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .then(|| trimmed.to_string())
}

/// The instance id is what keeps one Cave's cache out of another's. A missing
/// or malformed file mints a new one, which orphans the previous instance's
/// entries rather than adopting them.
fn load_or_create_instance_id(root: &Path) -> Result<String, String> {
    let path = root.join(INSTANCE_FILE);
    if let Some(existing) = read_instance_id(&path) {
        return Ok(existing);
    }
    let mut bytes = [0u8; INSTANCE_ID_BYTES];
    OsRng.fill_bytes(&mut bytes);
    let instance_id = hex_encode(&bytes);
    std::fs::create_dir_all(root)
        .map_err(|_| "could not create the offline cache directory".to_string())?;
    write_entry_file(&path, instance_id.as_bytes())?;
    Ok(instance_id)
}

/// The root secret lives only in the OS keychain. A value we cannot read back
/// as 32 bytes is replaced rather than repaired, and the caller purges the
/// cache so nothing is left encrypted under a key that no longer exists.
fn keychain_secret() -> Result<(Zeroizing<[u8; KEY_BYTES]>, bool), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "the offline cache keychain entry is unavailable".to_string())?;
    let stored = match entry.get_password() {
        Ok(stored) => Some(stored),
        Err(keyring::Error::NoEntry) => None,
        // A keychain that is present but unreadable — locked, or denied — is
        // not a rotation. Failing here costs a cache miss; minting a new key
        // would cost the whole cache.
        Err(_) => return Err("the offline cache key could not be read from the keychain".to_string()),
    };
    let (secret, rotated) = secret_from_stored(stored.as_deref());
    if rotated {
        entry
            .set_password(&hex_encode(secret.as_slice()))
            .map_err(|_| "the offline cache key could not be stored".to_string())?;
    }
    Ok((secret, rotated))
}

/// Decide which root secret to use from whatever the keychain held.
///
/// Split out from the keychain call because it is the only branch that can
/// wipe the cache: `true` means the stored value was unusable, every existing
/// entry is now encrypted under a key nothing holds, and the caller clears the
/// tree. A test can therefore pin the one property that matters — that a
/// readable 32-byte value never takes that branch — without a real keychain.
fn secret_from_stored(stored: Option<&str>) -> (Zeroizing<[u8; KEY_BYTES]>, bool) {
    if let Some(bytes) = stored
        .and_then(hex_decode)
        .filter(|bytes| bytes.len() == KEY_BYTES)
    {
        let mut secret = Zeroizing::new([0u8; KEY_BYTES]);
        secret.copy_from_slice(&bytes);
        return (secret, false);
    }
    (new_secret(), true)
}

fn new_secret() -> Zeroizing<[u8; KEY_BYTES]> {
    let mut secret = Zeroizing::new([0u8; KEY_BYTES]);
    OsRng.fill_bytes(secret.as_mut_slice());
    secret
}

#[derive(Default)]
struct OfflineCacheInner {
    directory: Option<PathBuf>,
    context: Option<OfflineCacheContext>,
}

/// Managed Tauri state. The directory arrives at setup; the keychain lookup is
/// deferred to the first command so a locked or unavailable keychain costs a
/// failed cache read rather than a failed launch.
#[derive(Default)]
pub(super) struct OfflineCacheState {
    inner: Mutex<OfflineCacheInner>,
    faults: Mutex<VecDeque<OfflineCacheFault>>,
}

impl OfflineCacheState {
    pub(super) fn configure(&self, app_local_data_dir: PathBuf) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.directory = Some(app_local_data_dir.join(OFFLINE_CACHE_DIR));
        inner.context = None;
    }

    fn record_fault(&self, fault: OfflineCacheFault) {
        let Ok(mut faults) = self.faults.lock() else {
            return;
        };
        faults.push_back(fault);
        while faults.len() > FAULT_LOG_LIMIT {
            faults.pop_front();
        }
    }

    fn faults(&self) -> Vec<OfflineCacheFault> {
        self.faults
            .lock()
            .map(|faults| faults.iter().copied().collect())
            .unwrap_or_default()
    }

    fn with_context<T>(
        &self,
        action: impl FnOnce(&OfflineCacheContext) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "the offline cache is unavailable".to_string())?;
        if inner.context.is_none() {
            let root = inner
                .directory
                .clone()
                .ok_or_else(|| "the offline cache is not configured".to_string())?;
            std::fs::create_dir_all(&root)
                .map_err(|_| "could not create the offline cache directory".to_string())?;
            let instance_id = load_or_create_instance_id(&root)?;
            let (secret, rotated) = keychain_secret()?;
            let context = OfflineCacheContext {
                root,
                instance_id,
                secret,
            };
            // A rotated key makes every existing entry undecryptable, so the
            // reset happens once here instead of as a fault per entry.
            if rotated {
                let _ = clear_entries(&context, None);
            }
            purge_incompatible_generations(&context, now_unix_ms());
            sweep_staging_files(&context);
            inner.context = Some(context);
        }
        let context = inner
            .context
            .as_ref()
            .ok_or_else(|| "the offline cache is unavailable".to_string())?;
        action(context)
    }
}

#[tauri::command]
pub(super) fn offline_cache_read(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    scope: String,
    key: String,
) -> Result<OfflineCacheReadResult, String> {
    validate_name(&scope, "scope")?;
    validate_name(&key, "key")?;
    let result = state.with_context(|context| Ok(read_entry(context, &scope, &key)))?;
    if let Some(fault) = result.fault {
        state.record_fault(fault);
    }
    Ok(result)
}

#[tauri::command]
pub(super) fn offline_cache_write(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    scope: String,
    key: String,
    payload: String,
    revision: String,
) -> Result<(), String> {
    validate_name(&scope, "scope")?;
    validate_name(&key, "key")?;
    if revision.len() > MAX_REVISION_LEN {
        return Err("offline cache revision is too long".to_string());
    }
    let now = now_unix_ms();
    state.with_context(|context| write_entry(context, &scope, &key, &payload, &revision, now))
}

#[tauri::command]
pub(super) fn offline_cache_clear(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    scope: Option<String>,
) -> Result<(), String> {
    if let Some(scope) = scope.as_deref() {
        validate_name(scope, "scope")?;
    }
    state.with_context(|context| clear_entries(context, scope.as_deref()))
}

#[tauri::command]
pub(super) fn offline_cache_status(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
) -> Result<OfflineCacheStatus, String> {
    let (instance_id, entries, bytes) = state.with_context(|context| {
        let files = collect_entries(context)?;
        Ok((
            context.instance_id.clone(),
            files.len(),
            files.iter().map(|file| file.bytes).sum::<u64>(),
        ))
    })?;
    Ok(OfflineCacheStatus {
        schema_version: OFFLINE_CACHE_SCHEMA_VERSION,
        instance_id,
        entries,
        bytes,
        max_entries: MAX_ENTRIES,
        max_entry_bytes: MAX_ENTRY_BYTES,
        max_total_bytes: MAX_TOTAL_BYTES,
        faults: state.faults(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest;

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);

    fn test_root(name: &str) -> PathBuf {
        let id = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
        PathBuf::from("target")
            .join("offline-cache-tests")
            .join(format!("{}-{}-{}", std::process::id(), id, name))
    }

    fn context_at(root: PathBuf, instance_id: &str, seed: u8) -> OfflineCacheContext {
        OfflineCacheContext {
            root,
            instance_id: instance_id.to_string(),
            secret: Zeroizing::new([seed; KEY_BYTES]),
        }
    }

    fn context(name: &str) -> OfflineCacheContext {
        context_at(test_root(name), "0123456789abcdef0123456789abcdef", 7)
    }

    fn cleanup(context: &OfflineCacheContext) {
        let _ = std::fs::remove_dir_all(&context.root);
    }

    /// Regular files only — opening a directory for write is not portable, and
    /// the point of the tests that use this is precisely that entry files move
    /// while their parent directories do not.
    fn set_modified(path: &Path, unix_ms: u64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(
            std::fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_millis(unix_ms)),
        )
        .unwrap();
    }

    #[test]
    fn round_trip_returns_the_payload_and_marks_it_read_only() {
        let context = context("round-trip");
        write_entry(&context, "conversation", "abc", "{\"ok\":true}", "rev-1", 42).unwrap();

        let result = read_entry(&context, "conversation", "abc");
        let entry = result.entry.expect("entry should be readable");
        assert_eq!(entry.payload, "{\"ok\":true}");
        assert_eq!(entry.revision, "rev-1");
        assert_eq!(entry.updated_at_unix_ms, 42);
        assert!(entry.read_only, "cached reads are always read-only");
        assert_eq!(result.fault, None);
        cleanup(&context);
    }

    #[test]
    fn missing_entry_is_a_plain_miss_rather_than_a_fault() {
        let context = context("miss");
        let result = read_entry(&context, "conversation", "absent");
        assert_eq!(result, OfflineCacheReadResult::default());
        cleanup(&context);
    }

    #[test]
    fn stored_bytes_contain_neither_the_payload_nor_the_entry_names() {
        let context = context("opaque");
        let secret = "sk-live-should-never-be-on-disk";
        write_entry(
            &context,
            "conversation",
            "session-4775",
            secret,
            "rev-1",
            42,
        )
        .unwrap();

        let path = context.entry_path("conversation", "session-4775");
        let raw = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains(secret), "payload must not be readable");
        assert!(!text.contains("session-4775"), "entry key must not appear");
        assert!(!text.contains("conversation"), "scope must not appear");
        assert!(
            !path.to_string_lossy().contains("session-4775"),
            "entry key must not appear in the path",
        );
        cleanup(&context);
    }

    #[test]
    fn another_instances_entry_is_refused_and_purged() {
        let root = test_root("instance-scope");
        let mine = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 7);
        let theirs = context_at(root.clone(), "fedcba9876543210fedcba9876543210", 7);
        write_entry(&theirs, "conversation", "abc", "{\"theirs\":true}", "r", 1).unwrap();

        // Same root, same key material, their envelope moved into my slot: the
        // authenticated instance id is what refuses it.
        let stolen = std::fs::read(theirs.entry_path("conversation", "abc")).unwrap();
        write_entry_file(&mine.entry_path("conversation", "abc"), &stolen).unwrap();

        let result = read_entry(&mine, "conversation", "abc");
        assert_eq!(result.entry, None);
        assert_eq!(
            result.fault.map(|fault| fault.kind),
            Some(OfflineCacheFaultKind::InstanceMismatch)
        );
        assert!(result.purged, "an unusable entry is removed on read");
        assert!(!mine.entry_path("conversation", "abc").exists());
        // Their own copy is untouched and still readable to them.
        assert!(read_entry(&theirs, "conversation", "abc").entry.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_entry_moved_between_keys_or_scopes_fails_authentication() {
        let context = context("rebind");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        let envelope = std::fs::read(context.entry_path("conversation", "abc")).unwrap();

        for (scope, key, expected) in [
            (
                "conversation",
                "xyz",
                OfflineCacheFaultKind::EntryMismatch,
            ),
            ("summary", "abc", OfflineCacheFaultKind::EntryMismatch),
        ] {
            write_entry_file(&context.entry_path(scope, key), &envelope).unwrap();
            let result = read_entry(&context, scope, key);
            assert_eq!(result.entry, None);
            assert_eq!(result.fault.map(|fault| fault.kind), Some(expected));
        }
        cleanup(&context);
    }

    #[test]
    fn a_rotated_key_leaves_no_entry_this_build_can_serve() {
        let root = test_root("rotate");
        let before = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 7);
        write_entry(&before, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();

        // The path is keyed too, so a rotated secret does not even name the
        // old file: the read is a plain miss. `with_context` clears the tree
        // when the keychain rotates for precisely this reason — nothing else
        // would ever revisit those bytes.
        let after = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 9);
        assert_eq!(
            read_entry(&after, "conversation", "abc"),
            OfflineCacheReadResult::default(),
        );

        // And putting the old bytes exactly where the rotated secret looks
        // does not resurrect them: the header's entry id was derived under the
        // retired key, so the entry is refused and removed.
        let stale = std::fs::read(before.entry_path("conversation", "abc")).unwrap();
        write_entry_file(&after.entry_path("conversation", "abc"), &stale).unwrap();
        let result = read_entry(&after, "conversation", "abc");
        assert_eq!(result.entry, None);
        assert_eq!(
            result.fault.map(|fault| fault.kind),
            Some(OfflineCacheFaultKind::EntryMismatch)
        );
        assert!(result.purged);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn tampering_with_the_header_or_the_ciphertext_is_detected() {
        let context = context("tamper");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        let path = context.entry_path("conversation", "abc");
        let original = std::fs::read(&path).unwrap();

        let mut flipped = original.clone();
        let last = flipped.len() - 1;
        flipped[last] ^= 0x01;
        assert_eq!(
            decode_envelope(&context, "conversation", "abc", &flipped)
                .unwrap_err()
                .kind,
            OfflineCacheFaultKind::Undecryptable,
        );

        // Rewriting the header's timestamp keeps the JSON valid, so only the
        // AAD binding catches it.
        let header_start = ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES;
        let header_len =
            u32::from_le_bytes(original[ENVELOPE_MAGIC.len()..header_start].try_into().unwrap())
                as usize;
        let mut header: OfflineCacheHeader =
            serde_json::from_slice(&original[header_start..header_start + header_len]).unwrap();
        header.updated_at_unix_ms = 999;
        let rewritten = serde_json::to_vec(&header).unwrap();
        let mut forged = envelope_aad(rewritten.len() as u32, &rewritten);
        forged.extend_from_slice(&original[header_start + header_len..]);
        assert_eq!(
            decode_envelope(&context, "conversation", "abc", &forged)
                .unwrap_err()
                .kind,
            OfflineCacheFaultKind::Undecryptable,
        );
        cleanup(&context);
    }

    #[test]
    fn truncated_and_foreign_files_are_classified_rather_than_parsed() {
        let context = context("garbage");
        for (bytes, expected) in [
            (b"CVOFF".to_vec(), OfflineCacheFaultKind::Truncated),
            (
                b"NOTCACHE\x04\x00\x00\x00{}".to_vec(),
                OfflineCacheFaultKind::MagicMismatch,
            ),
            (
                {
                    let mut bytes = ENVELOPE_MAGIC.to_vec();
                    bytes.extend_from_slice(&99u32.to_le_bytes());
                    bytes.extend_from_slice(b"{}");
                    bytes
                },
                OfflineCacheFaultKind::Truncated,
            ),
            (
                {
                    let header = b"not json";
                    let mut bytes = envelope_aad(header.len() as u32, header);
                    bytes.extend_from_slice(b"ciphertext");
                    bytes
                },
                OfflineCacheFaultKind::HeaderMalformed,
            ),
        ] {
            assert_eq!(
                decode_envelope(&context, "conversation", "abc", &bytes)
                    .unwrap_err()
                    .kind,
                expected,
            );
        }
        cleanup(&context);
    }

    #[test]
    fn a_past_generation_is_refused_and_the_directory_is_reclaimed() {
        let context = context("generation");
        let legacy_generation = context.root.join("v0");
        std::fs::create_dir_all(&legacy_generation).unwrap();
        std::fs::write(legacy_generation.join("stale"), b"old").unwrap();

        let header = OfflineCacheHeader {
            schema_version: OFFLINE_CACHE_SCHEMA_VERSION + 1,
            instance_id: context.instance_id.clone(),
            entry_id: context.entry_id("conversation", "abc"),
            revision: "r".to_string(),
            updated_at_unix_ms: 1,
            payload_bytes: 2,
            nonce: hex_encode(&[0u8; NONCE_BYTES]),
        };
        let json = serde_json::to_vec(&header).unwrap();
        let mut envelope = envelope_aad(json.len() as u32, &json);
        envelope.extend_from_slice(b"ciphertext");
        assert_eq!(
            decode_envelope(&context, "conversation", "abc", &envelope)
                .unwrap_err()
                .kind,
            OfflineCacheFaultKind::SchemaMismatch,
        );

        purge_incompatible_generations(&context, now_unix_ms());
        assert!(!legacy_generation.exists(), "past generations are removed");
        cleanup(&context);
    }

    #[test]
    fn an_oversized_payload_is_refused_before_it_is_written() {
        let context = context("oversized");
        let payload = "x".repeat(MAX_ENTRY_BYTES + 1);
        assert!(write_entry(&context, "conversation", "abc", &payload, "r", 1).is_err());
        assert!(!context.entry_path("conversation", "abc").exists());
        cleanup(&context);
    }

    #[test]
    fn an_oversized_file_is_refused_from_its_metadata_rather_than_read() {
        let context = context("oversized-read");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        let path = context.entry_path("conversation", "abc");
        // A well-formed envelope's own preamble is intact; only its length is
        // impossible, so nothing but the size check can reject it early.
        let mut bloated = std::fs::read(&path).unwrap();
        bloated.resize(MAX_ENVELOPE_BYTES as usize + 1, 0);
        std::fs::write(&path, &bloated).unwrap();

        let result = read_entry(&context, "conversation", "abc");
        assert_eq!(result.entry, None);
        assert_eq!(
            result.fault.map(|fault| fault.kind),
            Some(OfflineCacheFaultKind::Oversized)
        );
        assert!(result.purged);
        assert!(!path.exists());
        cleanup(&context);
    }

    #[test]
    fn cap_eviction_drops_the_oldest_entries_first() {
        let file = |name: &str, bytes: u64, modified_unix_ms: u64| EntryFile {
            path: PathBuf::from(name),
            bytes,
            modified_unix_ms,
        };
        let by_count: Vec<EntryFile> = (0..MAX_ENTRIES + 2)
            .map(|index| file(&format!("entry-{index}"), 1, (MAX_ENTRIES + 2 - index) as u64))
            .collect();
        let evicted = entries_over_budget(&by_count);
        assert_eq!(evicted.len(), 2);
        assert_eq!(evicted[0], Path::new(&format!("entry-{MAX_ENTRIES}")));

        let by_bytes = vec![
            file("newest", MAX_TOTAL_BYTES, 3),
            file("older", 1, 2),
            file("oldest", 1, 1),
        ];
        let evicted = entries_over_budget(&by_bytes);
        assert_eq!(evicted, vec![Path::new("older"), Path::new("oldest")]);
    }

    #[test]
    fn writing_past_the_entry_cap_evicts_on_disk() {
        let context = context("evict");
        // One over the cap, written oldest-first so the first write is the
        // eviction candidate.
        for index in 0..=MAX_ENTRIES {
            write_entry(
                &context,
                "conversation",
                &format!("entry-{index}"),
                "{\"a\":1}",
                "r",
                index as u64,
            )
            .unwrap();
        }
        let files = collect_entries(&context).unwrap();
        assert!(
            files.len() <= MAX_ENTRIES,
            "cache kept {} entries, cap is {MAX_ENTRIES}",
            files.len()
        );
        cleanup(&context);
    }

    #[test]
    fn clear_removes_one_scope_or_every_scope() {
        let context = context("clear");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        write_entry(&context, "summary", "abc", "{\"b\":2}", "r", 1).unwrap();

        clear_entries(&context, Some("conversation")).unwrap();
        assert!(read_entry(&context, "conversation", "abc").entry.is_none());
        assert!(read_entry(&context, "summary", "abc").entry.is_some());

        clear_entries(&context, None).unwrap();
        assert!(read_entry(&context, "summary", "abc").entry.is_none());
        // Clearing an absent cache is not an error; the caller wanted it gone.
        assert!(clear_entries(&context, None).is_ok());
        cleanup(&context);
    }

    #[test]
    fn a_replaced_entry_keeps_no_staging_debris() {
        let context = context("staging");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        write_entry(&context, "conversation", "abc", "{\"a\":2}", "r", 2).unwrap();

        let entry = read_entry(&context, "conversation", "abc").entry.unwrap();
        assert_eq!(entry.payload, "{\"a\":2}");
        let leftovers = std::fs::read_dir(context.scope_dir("conversation"))
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(leftovers, 0);
        cleanup(&context);
    }

    #[test]
    fn stale_staging_files_are_swept_and_ignored_by_the_inventory() {
        let context = context("sweep");
        write_entry(&context, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        let debris = context
            .scope_dir("conversation")
            .join(format!("{}.bin.tmp-1-1", context.entry_id("conversation", "abc")));
        std::fs::write(&debris, b"half written").unwrap();

        assert_eq!(collect_entries(&context).unwrap().len(), 1);
        sweep_staging_files(&context);
        assert!(!debris.exists());
        cleanup(&context);
    }

    #[test]
    fn abandoned_foreign_instances_are_reclaimed_and_live_ones_are_not() {
        let root = test_root("foreign");
        let mine = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 7);
        let theirs = context_at(root.clone(), "fedcba9876543210fedcba9876543210", 7);
        write_entry(&mine, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        write_entry(&theirs, "conversation", "abc", "{\"b\":2}", "r", 1).unwrap();

        purge_incompatible_generations(&mine, now_unix_ms());
        assert!(theirs.instance_dir().exists(), "a live instance is left alone");

        purge_incompatible_generations(&mine, now_unix_ms() + FOREIGN_INSTANCE_MAX_AGE_MS + 1);
        assert!(!theirs.instance_dir().exists(), "an abandoned instance is reclaimed");
        assert!(mine.instance_dir().exists(), "the current instance is never a candidate");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_live_foreign_instance_survives_a_stale_directory_stamp() {
        let root = test_root("foreign-activity");
        let mine = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 7);
        let theirs = context_at(root.clone(), "fedcba9876543210fedcba9876543210", 7);
        write_entry(&theirs, "conversation", "abc", "{\"b\":2}", "r", 1).unwrap();

        // Their directory tree was created now and never gains another scope,
        // so its own mtime stops moving here. Rewriting the same entry a month
        // on is exactly what a live install does — and the only thing it
        // touches is the entry file.
        let later = now_unix_ms() + FOREIGN_INSTANCE_MAX_AGE_MS + 60_000;
        set_modified(&theirs.entry_path("conversation", "abc"), later);

        purge_incompatible_generations(&mine, later);
        assert!(
            theirs.instance_dir().exists(),
            "an install still writing entries must not be reclaimed for a stale directory stamp",
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn instance_ids_persist_and_a_malformed_one_is_reminted() {
        let root = test_root("instance-id");
        std::fs::create_dir_all(&root).unwrap();
        let first = load_or_create_instance_id(&root).unwrap();
        assert_eq!(first.len(), INSTANCE_ID_BYTES * 2);
        assert_eq!(load_or_create_instance_id(&root).unwrap(), first);

        std::fs::write(root.join(INSTANCE_FILE), b"not-an-instance-id").unwrap();
        let second = load_or_create_instance_id(&root).unwrap();
        assert_ne!(second, first);
        assert_eq!(second.len(), INSTANCE_ID_BYTES * 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_path_cannot_be_recomputed_from_the_scope_and_key_alone() {
        let root = test_root("keyed-names");
        let mine = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 7);
        // Same install, different keychain secret; and same secret, different
        // install. Neither may reproduce the other's path for a scope and key
        // an observer already knows.
        let other_secret = context_at(root.clone(), "0123456789abcdef0123456789abcdef", 9);
        let other_instance = context_at(root.clone(), "fedcba9876543210fedcba9876543210", 7);
        for other in [&other_secret, &other_instance] {
            assert_ne!(mine.scope_id("conversation"), other.scope_id("conversation"));
            assert_ne!(
                mine.entry_id("conversation", "abc"),
                other.entry_id("conversation", "abc"),
            );
        }

        // The unkeyed digest an observer *can* compute from the source appears
        // nowhere: not as the directory, not as the file stem, not in the
        // plaintext header.
        write_entry(&mine, "conversation", "abc", "{\"a\":1}", "r", 1).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(b"conversation");
        hasher.update([0x1f]);
        hasher.update(b"abc");
        let unkeyed = hex_encode(&hasher.finalize());
        let path = mine.entry_path("conversation", "abc");
        assert!(!path.to_string_lossy().contains(&unkeyed));
        assert!(!path.to_string_lossy().contains(&unkeyed[..32]));
        let raw = std::fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains(&unkeyed));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scope_and_key_are_bounded_and_never_reach_the_filesystem_raw() {
        assert!(validate_name("", "scope").is_err());
        assert!(validate_name(&"x".repeat(MAX_NAME_LEN + 1), "key").is_err());
        assert!(validate_name("with\nnewline", "key").is_err());
        assert!(validate_name("conversation", "scope").is_ok());

        let context = context("names");
        let traversal = "../../escape";
        let path = context.entry_path("conversation", traversal);
        assert!(path.starts_with(context.instance_dir()));
        assert!(!path.to_string_lossy().contains(".."));
        cleanup(&context);
    }

    #[test]
    fn only_an_unusable_keychain_value_rotates_the_key_and_clears_the_cache() {
        // The branch under test is the one that silently empties the cache on
        // launch, so the case that must never take it is pinned first.
        let stored = hex_encode(&[3u8; KEY_BYTES]);
        let (secret, rotated) = secret_from_stored(Some(&stored));
        assert_eq!(secret.as_slice(), [3u8; KEY_BYTES]);
        assert!(
            !rotated,
            "a readable 32-byte key must be adopted as-is, never rotated",
        );
        // Case, too: the value we wrote is lowercase, but nothing should hinge
        // on a keychain round-tripping it byte for byte.
        assert!(!secret_from_stored(Some(&stored.to_uppercase())).1);

        for unusable in [
            None,
            Some(String::new()),
            Some("not hexadecimal at all".to_string()),
            Some(hex_encode(&[3u8; KEY_BYTES - 1])),
            Some(hex_encode(&[3u8; KEY_BYTES + 1])),
            Some(format!("{stored} ")),
        ] {
            let (fresh, rotated) = secret_from_stored(unusable.as_deref());
            assert!(rotated, "an unusable keychain value must mint a new key");
            assert_ne!(
                fresh.as_slice(),
                [0u8; KEY_BYTES],
                "a minted key must be random, not a zeroed buffer",
            );
        }
    }

    #[test]
    fn hex_round_trips_and_rejects_malformed_input() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xff]), "000fff");
        assert_eq!(hex_decode("000fff"), Some(vec![0x00, 0x0f, 0xff]));
        assert_eq!(hex_decode("abc"), None);
        assert_eq!(hex_decode("zz"), None);
    }

    #[test]
    fn the_fault_log_is_bounded_and_carries_no_free_text() {
        let state = OfflineCacheState::default();
        for _ in 0..FAULT_LOG_LIMIT + 5 {
            state.record_fault(OfflineCacheFault::new(
                OfflineCacheFaultKind::Undecryptable,
                "entry failed authentication with the current cache key",
            ));
        }
        let faults = state.faults();
        assert_eq!(faults.len(), FAULT_LOG_LIMIT);
        let json = serde_json::to_string(&faults[0]).unwrap();
        assert_eq!(
            json,
            "{\"kind\":\"undecryptable\",\"detail\":\"entry failed authentication with the current cache key\"}"
        );
    }
}
