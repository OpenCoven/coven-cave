//! Process leases and retention for content-addressed sidecar runtime
//! generations (Windows `%LOCALAPPDATA%\…\sidecar-runtime`).
//!
//! Every app that serves a generation holds an exclusive advisory lock on its
//! own lease file under `.leases/<generation>/` for the rest of its process
//! lifetime. The OS releases that lock when the process exits or crashes, so
//! a lease cannot outlive its owner. The sidecar's `node.exe` lives in the
//! app's kill-on-close job object, so the app's lease also covers it.
//!
//! Both lease creation and retirement run under the shared cache lock, which
//! makes "this generation has no live lease" a stable fact for the whole
//! retirement decision. Retirement keeps the current generation and the most
//! recently active other generation as the rollback copy. Any other complete
//! generation is removed only when every lease file in it can be locked, which
//! proves that no live process holds it. An unreadable lease directory or an
//! unexpected lock error retains the generation.

use fs2::FileExt as Fs2FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const LEASE_DIR_NAME: &str = ".leases";
const LAST_ACTIVE_FILE_NAME: &str = "last-active";
const LEASE_EXTENSION: &str = "lease";
const COMPLETION_MARKER_NAME: &str = ".complete.json";

/// A held lease. Dropping it releases the lock; the stale file is pruned by a
/// later retirement pass.
pub(crate) struct RuntimeLease {
    _file: File,
}

fn lock_is_contended(error: &io::Error) -> bool {
    let expected = fs2::lock_contended_error();
    match (error.raw_os_error(), expected.raw_os_error()) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => error.kind() == expected.kind(),
    }
}

fn unix_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

fn lease_dir(cache_root: &Path, generation: &str) -> PathBuf {
    cache_root.join(LEASE_DIR_NAME).join(generation)
}

/// Leases `generation` for this process. The caller must hold the cache lock
/// and must already have verified that the generation is ready.
pub(crate) fn acquire_runtime_lease(
    cache_root: &Path,
    generation: &str,
) -> Result<RuntimeLease, String> {
    acquire_runtime_lease_at(cache_root, generation, unix_millis(SystemTime::now()))
}

pub(crate) fn acquire_runtime_lease_at(
    cache_root: &Path,
    generation: &str,
    active_at_millis: u128,
) -> Result<RuntimeLease, String> {
    let directory = lease_dir(cache_root, generation);
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "could not create sidecar runtime lease directory {}: {error}",
            directory.display()
        )
    })?;
    let lease_path = directory.join(format!(
        "{}-{}.{LEASE_EXTENSION}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0)
    ));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&lease_path)
        .map_err(|error| {
            format!(
                "could not create sidecar runtime lease {}: {error}",
                lease_path.display()
            )
        })?;
    Fs2FileExt::try_lock_exclusive(&file).map_err(|error| {
        format!(
            "could not lock sidecar runtime lease {}: {error}",
            lease_path.display()
        )
    })?;
    let last_active = directory.join(LAST_ACTIVE_FILE_NAME);
    let mut record = File::create(&last_active).map_err(|error| {
        format!(
            "could not record sidecar runtime activity {}: {error}",
            last_active.display()
        )
    })?;
    record
        .write_all(format!("{active_at_millis}\n").as_bytes())
        .map_err(|error| {
            format!(
                "could not record sidecar runtime activity {}: {error}",
                last_active.display()
            )
        })?;
    Ok(RuntimeLease { _file: file })
}

/// When the generation last started serving an app. Generations written before
/// leases existed fall back to their completion marker's modification time.
fn last_active_millis(cache_root: &Path, generation: &Path) -> u128 {
    let Some(name) = generation.file_name().and_then(|name| name.to_str()) else {
        return 0;
    };
    if let Some(recorded) =
        fs::read_to_string(lease_dir(cache_root, name).join(LAST_ACTIVE_FILE_NAME))
            .ok()
            .and_then(|contents| contents.trim().parse::<u128>().ok())
    {
        return recorded;
    }
    fs::metadata(generation.join(COMPLETION_MARKER_NAME))
        .and_then(|metadata| metadata.modified())
        .map(unix_millis)
        .unwrap_or(0)
}

/// Whether a live process holds any lease on `generation`. Stale lease files
/// are removed as they are proven unheld. Errors mean "unknown" and the caller
/// must retain the generation.
fn generation_is_leased(cache_root: &Path, generation: &str) -> Result<bool, String> {
    let directory = lease_dir(cache_root, generation);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "could not inspect sidecar runtime leases {}: {error}",
                directory.display()
            ))
        }
    };
    let mut held = false;
    for entry in entries {
        let path = entry
            .map_err(|error| {
                format!(
                    "could not inspect sidecar runtime leases {}: {error}",
                    directory.display()
                )
            })?
            .path();
        if path.extension().and_then(|extension| extension.to_str()) != Some(LEASE_EXTENSION) {
            continue;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                format!(
                    "could not open sidecar runtime lease {}: {error}",
                    path.display()
                )
            })?;
        match Fs2FileExt::try_lock_exclusive(&file) {
            Ok(()) => {
                drop(file);
                let _ = fs::remove_file(&path);
            }
            Err(error) if lock_is_contended(&error) => held = true,
            Err(error) => {
                return Err(format!(
                    "could not probe sidecar runtime lease {}: {error}",
                    path.display()
                ))
            }
        }
    }
    Ok(held)
}

/// Retires complete, non-current generations. The caller holds the cache lock
/// and passes every complete generation other than `current`.
pub(crate) fn retire_complete_generations(
    cache_root: &Path,
    current: &Path,
    complete: Vec<PathBuf>,
    remove: &dyn Fn(&Path) -> Result<(), String>,
) {
    // Probe the current generation only to prune this and earlier processes'
    // stale lease files; it is never a retirement candidate.
    if let Some(name) = current.file_name().and_then(|name| name.to_str()) {
        if let Err(error) = generation_is_leased(cache_root, name) {
            log::warn!("[cave] {error}");
        }
    }
    let mut candidates: Vec<(u128, PathBuf)> = complete
        .into_iter()
        .filter(|path| path != current)
        .map(|path| (last_active_millis(cache_root, &path), path))
        .collect();
    // Newest first; the name breaks ties so the rollback choice is stable.
    candidates.sort_by(|left, right| right.cmp(left));
    for (index, (_, path)) in candidates.into_iter().enumerate() {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        match generation_is_leased(cache_root, name) {
            Ok(true) => {
                log::info!(
                    "[cave] retaining sidecar runtime {name}: a running app holds its lease"
                );
                continue;
            }
            Ok(false) if index == 0 => continue,
            Ok(false) => {}
            Err(error) => {
                log::warn!("[cave] retaining sidecar runtime {name}: {error}");
                continue;
            }
        }
        match remove(&path) {
            Ok(()) => {
                let _ = fs::remove_dir_all(lease_dir(cache_root, name));
                log::info!("[cave] retired sidecar runtime {name}");
            }
            Err(error) => log::warn!("[cave] could not retire sidecar runtime {name}: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "covencave-runtime-retention-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("test clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn generation(root: &Path, name: &str) -> PathBuf {
        let path = root.join(name);
        fs::create_dir_all(&path).expect("create generation");
        fs::write(path.join(COMPLETION_MARKER_NAME), b"{}").expect("write marker");
        path
    }

    fn retire(root: &Path, current: &Path, complete: &[&Path]) -> Vec<String> {
        let removed = RefCell::new(Vec::new());
        retire_complete_generations(
            root,
            current,
            complete.iter().map(|path| path.to_path_buf()).collect(),
            &|path| {
                removed.borrow_mut().push(
                    path.file_name()
                        .expect("generation name")
                        .to_string_lossy()
                        .into_owned(),
                );
                fs::remove_dir_all(path).map_err(|error| error.to_string())
            },
        );
        removed.into_inner()
    }

    #[test]
    fn two_updates_leave_the_current_and_previous_generation() {
        let root = test_root("two-updates");
        let first = generation(&root, "first");
        let second = generation(&root, "second");
        let third = generation(&root, "third");
        // Each app version leases its generation, then exits at update time.
        drop(acquire_runtime_lease_at(&root, "first", 1_000).expect("lease first"));
        drop(acquire_runtime_lease_at(&root, "second", 2_000).expect("lease second"));
        let current_lease = acquire_runtime_lease_at(&root, "third", 3_000).expect("lease third");

        let removed = retire(&root, &third, &[&first, &second]);

        assert_eq!(removed, vec!["first".to_string()]);
        assert!(
            !first.exists(),
            "a generation two updates old must be reclaimed"
        );
        assert!(
            second.exists(),
            "the previous generation is the rollback copy"
        );
        assert!(
            third.exists(),
            "the current generation must never be retired"
        );
        assert!(
            !lease_dir(&root, "first").exists(),
            "a retired generation's stale leases must be removed with it"
        );
        drop(current_lease);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn a_leased_generation_survives_beyond_the_rollback_copy() {
        let root = test_root("leased");
        let oldest = generation(&root, "oldest");
        let previous = generation(&root, "previous");
        let current = generation(&root, "current");
        let running_old_copy =
            acquire_runtime_lease_at(&root, "oldest", 1_000).expect("lease oldest");
        drop(acquire_runtime_lease_at(&root, "previous", 2_000).expect("lease previous"));

        let removed = retire(&root, &current, &[&oldest, &previous]);
        assert!(removed.is_empty(), "removed {removed:?}");
        assert!(
            oldest.exists(),
            "a generation a running copy holds must survive"
        );
        assert!(previous.exists());

        drop(running_old_copy);
        let removed = retire(&root, &current, &[&oldest, &previous]);
        assert_eq!(removed, vec!["oldest".to_string()]);
        assert!(previous.exists());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn generations_without_lease_records_fall_back_to_marker_age() {
        let root = test_root("legacy");
        let legacy = generation(&root, "legacy");
        let older = generation(&root, "older");
        let current = generation(&root, "current");
        let old = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000);
        File::options()
            .write(true)
            .open(older.join(COMPLETION_MARKER_NAME))
            .and_then(|file| file.set_modified(old))
            .expect("age older marker");

        let removed = retire(&root, &current, &[&legacy, &older]);
        assert_eq!(removed, vec!["older".to_string()]);
        assert!(
            legacy.exists(),
            "the newest pre-lease generation is the rollback copy"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn unreadable_lease_state_retains_the_generation() {
        let root = test_root("unknown");
        let stranded = generation(&root, "stranded");
        let previous = generation(&root, "previous");
        let current = generation(&root, "current");
        drop(acquire_runtime_lease_at(&root, "previous", 2_000).expect("lease previous"));
        // A lease path that cannot be opened as a file is unknown evidence.
        fs::create_dir_all(lease_dir(&root, "stranded").join("blocked.lease"))
            .expect("create unreadable lease");
        fs::write(
            lease_dir(&root, "stranded").join(LAST_ACTIVE_FILE_NAME),
            "1000\n",
        )
        .expect("record stranded activity");

        let removed = retire(&root, &current, &[&stranded, &previous]);
        assert!(removed.is_empty(), "removed {removed:?}");
        assert!(stranded.exists());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn stale_leases_on_retained_generations_are_pruned() {
        let root = test_root("prune");
        let previous = generation(&root, "previous");
        let current = generation(&root, "current");
        drop(acquire_runtime_lease_at(&root, "previous", 2_000).expect("lease previous"));
        let held = acquire_runtime_lease_at(&root, "current", 3_000).expect("lease current");

        assert!(!generation_is_leased(&root, "previous").expect("probe previous"));
        assert!(generation_is_leased(&root, "current").expect("probe current"));
        let remaining_leases = |name: &str| {
            fs::read_dir(lease_dir(&root, name))
                .expect("list leases")
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|ext| ext == LEASE_EXTENSION)
                })
                .count()
        };
        assert_eq!(remaining_leases("previous"), 0);
        assert_eq!(remaining_leases("current"), 1);
        let removed = retire(&root, &current, &[&previous]);
        assert!(removed.is_empty(), "removed {removed:?}");
        drop(held);
        fs::remove_dir_all(root).expect("remove test root");
    }
}
