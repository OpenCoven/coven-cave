//! Recovery for a declined or failed Windows update install (#5981).
//!
//! `tauri-plugin-updater` 2.10.1 starts `msiexec` with `ShellExecuteW`,
//! ignores the result and calls `std::process::exit(0)`. The per-machine MSI
//! relaunches Cave only after a successful `InstallFinalize`, so a declined
//! UAC prompt or a failed install used to leave Cave closed.
//!
//! Immediately before "Restart & install", the webview arms a watcher. The
//! updater's pre-exit cleanup clears the resource table, and the dropped guard
//! starts a copy of this executable outside the install directory, so it
//! never holds an installed file open. That copy waits for the app to exit,
//! finds the `msiexec.exe` the app started, and waits for its exit code. On
//! success the MSI relaunches Cave as before. Otherwise the watcher records
//! the outcome in a file and relaunches the still-installed app, whose update
//! banner shows the failure. A file rather than argv carries the outcome, so a
//! later successful update's relaunch arguments cannot repeat a stale failure.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const WATCH_FLAG: &str = "--coven-update-install-watch";
pub(crate) const OUTCOME_FILE_NAME: &str = "update-install-outcome.json";
pub(crate) const WATCH_DIR_NAME: &str = "update-install-watch";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UpdateInstallOutcomeKind {
    /// The user declined elevation or cancelled the installer.
    Cancelled,
    /// The installer ran and reported a failure.
    Failed,
    /// No installer process could be found after the app exited.
    NotStarted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateInstallOutcome {
    pub(crate) kind: UpdateInstallOutcomeKind,
    pub(crate) exit_code: Option<u32>,
    pub(crate) log_path: Option<String>,
}

/// Classifies an `msiexec` exit code. `None` means the install succeeded, and
/// the MSI's own relaunch owns the next start.
pub(crate) fn classify_msiexec_exit(code: u32) -> Option<UpdateInstallOutcomeKind> {
    match code {
        // ERROR_SUCCESS, ERROR_SUCCESS_REBOOT_INITIATED, ERROR_SUCCESS_REBOOT_REQUIRED
        0 | 1641 | 3010 => None,
        // ERROR_INSTALL_USEREXIT, ERROR_CANCELLED (declined elevation)
        1602 | 1223 => Some(UpdateInstallOutcomeKind::Cancelled),
        _ => Some(UpdateInstallOutcomeKind::Failed),
    }
}

pub(crate) fn write_outcome(path: &Path, outcome: &UpdateInstallOutcome) -> Result<(), String> {
    let json = serde_json::to_vec(outcome)
        .map_err(|error| format!("could not serialize update install outcome: {error}"))?;
    fs::write(path, json).map_err(|error| {
        format!(
            "could not record update install outcome {}: {error}",
            path.display()
        )
    })
}

/// Reads a recorded outcome without consuming it; the banner clears it once
/// the user dismisses or retries. A malformed record is removed so it cannot
/// reappear on every launch.
pub(crate) fn read_outcome(path: &Path) -> Option<UpdateInstallOutcome> {
    let contents = fs::read(path).ok()?;
    let outcome = serde_json::from_slice(&contents).ok();
    if outcome.is_none() {
        clear_outcome(path);
    }
    outcome
}

pub(crate) fn clear_outcome(path: &Path) {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "[cave] could not clear update install outcome {}: {error}",
                path.display()
            );
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WatchRequest {
    pub(crate) parent_pid: u32,
    pub(crate) parent_created: u64,
    pub(crate) installed_exe: PathBuf,
    pub(crate) outcome_path: PathBuf,
    pub(crate) msi_log_path: PathBuf,
}

pub(crate) fn watch_args(request: &WatchRequest) -> Vec<OsString> {
    vec![
        OsString::from(WATCH_FLAG),
        OsString::from(request.parent_pid.to_string()),
        OsString::from(request.parent_created.to_string()),
        request.installed_exe.clone().into_os_string(),
        request.outcome_path.clone().into_os_string(),
        request.msi_log_path.clone().into_os_string(),
    ]
}

/// Parses the arguments after argv[0]. `None` means this is not a watcher
/// launch; `Some(Err)` means a malformed watcher launch.
pub(crate) fn parse_watch_args(
    mut args: impl Iterator<Item = OsString>,
) -> Option<Result<WatchRequest, ()>> {
    if args.next().as_deref() != Some(std::ffi::OsStr::new(WATCH_FLAG)) {
        return None;
    }
    let mut parse = || -> Result<WatchRequest, ()> {
        let parent_pid = args
            .next()
            .and_then(|arg| arg.to_str()?.parse::<u32>().ok())
            .filter(|pid| *pid != 0)
            .ok_or(())?;
        let parent_created = args
            .next()
            .and_then(|arg| arg.to_str()?.parse::<u64>().ok())
            .ok_or(())?;
        let installed_exe = PathBuf::from(args.next().ok_or(())?);
        let outcome_path = PathBuf::from(args.next().ok_or(())?);
        let msi_log_path = PathBuf::from(args.next().ok_or(())?);
        if args.next().is_some() || !installed_exe.is_absolute() || !outcome_path.is_absolute() {
            return Err(());
        }
        Ok(WatchRequest {
            parent_pid,
            parent_created,
            installed_exe,
            outcome_path,
            msi_log_path,
        })
    };
    Some(parse())
}

#[cfg(target_os = "windows")]
pub(crate) use native::*;

#[cfg(target_os = "windows")]
mod native {
    use super::*;
    use std::sync::{Arc, Mutex};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetExitCodeProcess, GetProcessTimes, OpenProcess, WaitForSingleObject,
        INFINITE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };

    /// How long the watcher waits for the updating app to exit. The updater
    /// exits right after starting msiexec; a host still alive after this is
    /// not in the install path the watcher understands.
    const PARENT_EXIT_TIMEOUT_MS: u32 = 120_000;

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn filetime_u64(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }

    fn creation_time(process: HANDLE) -> Option<u64> {
        let zero = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
        let ok =
            unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) };
        (ok != 0).then(|| filetime_u64(created))
    }

    fn open_process(pid: u32) -> Option<OwnedHandle> {
        let handle = unsafe {
            OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            )
        };
        (!handle.is_null()).then(|| OwnedHandle(handle))
    }

    /// The `msiexec.exe` started by the parent. The parent's creation time
    /// rejects an unrelated process whose recorded parent PID was reused.
    fn find_installer(parent_pid: u32, parent_created: u64) -> Option<OwnedHandle> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot.is_null() || snapshot as isize == -1 {
            return None;
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
        while more {
            let name_len = entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
            if entry.th32ParentProcessID == parent_pid && name.eq_ignore_ascii_case("msiexec.exe") {
                if let Some(process) = open_process(entry.th32ProcessID) {
                    if creation_time(process.0).is_some_and(|created| created >= parent_created) {
                        return Some(process);
                    }
                }
            }
            more = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
        }
        None
    }

    fn relaunch(installed_exe: &Path) {
        if let Err(error) = std::process::Command::new(installed_exe).spawn() {
            log::warn!("[cave] could not relaunch after a failed update install: {error}");
        }
    }

    /// Runs the watcher when this process was started as one.
    pub(crate) fn run_update_install_watcher_if_requested() -> Option<i32> {
        let request = match parse_watch_args(std::env::args_os().skip(1))? {
            Ok(request) => request,
            Err(()) => return Some(2),
        };
        if let Some(parent) = open_process(request.parent_pid) {
            let same_process = creation_time(parent.0) == Some(request.parent_created);
            if same_process
                && unsafe { WaitForSingleObject(parent.0, PARENT_EXIT_TIMEOUT_MS) } != WAIT_OBJECT_0
            {
                return Some(2);
            }
        }
        let log_path = Some(request.msi_log_path.to_string_lossy().into_owned());
        let outcome = match find_installer(request.parent_pid, request.parent_created) {
            None => UpdateInstallOutcome {
                kind: UpdateInstallOutcomeKind::NotStarted,
                exit_code: None,
                log_path,
            },
            Some(installer) => {
                if unsafe { WaitForSingleObject(installer.0, INFINITE) } != WAIT_OBJECT_0 {
                    return Some(2);
                }
                let mut code = 0_u32;
                if unsafe { GetExitCodeProcess(installer.0, &mut code) } == 0 {
                    return Some(2);
                }
                let Some(kind) = classify_msiexec_exit(code) else {
                    return Some(0);
                };
                UpdateInstallOutcome {
                    kind,
                    exit_code: Some(code),
                    log_path,
                }
            }
        };
        if let Err(error) = write_outcome(&request.outcome_path, &outcome) {
            log::warn!("[cave] {error}");
        }
        relaunch(&request.installed_exe);
        Some(0)
    }

    pub(crate) struct UpdateInstallWatch {
        watch_dir: PathBuf,
        outcome_path: PathBuf,
        msi_log_path: PathBuf,
        armed: Mutex<Option<PathBuf>>,
    }

    impl UpdateInstallWatch {
        pub(crate) fn new(app_local_data_dir: &Path, msi_log_path: PathBuf) -> Self {
            let watch_dir = app_local_data_dir.join(WATCH_DIR_NAME);
            // Copies from earlier installs are unused once their watcher has
            // exited; a copy still running is in use and refuses removal.
            if let Ok(entries) = fs::read_dir(&watch_dir) {
                for entry in entries.filter_map(Result::ok) {
                    let _ = fs::remove_file(entry.path());
                }
            }
            Self {
                watch_dir,
                outcome_path: app_local_data_dir.join(OUTCOME_FILE_NAME),
                msi_log_path,
                armed: Mutex::new(None),
            }
        }

        pub(crate) fn outcome(&self) -> Option<UpdateInstallOutcome> {
            read_outcome(&self.outcome_path)
        }

        pub(crate) fn clear_outcome(&self) {
            clear_outcome(&self.outcome_path);
        }

        /// Copies this executable outside the install directory so the
        /// watcher never holds a file the MSI must replace.
        pub(crate) fn arm(&self) -> Result<(), String> {
            let executable = std::env::current_exe()
                .map_err(|error| format!("could not locate Cave for install recovery: {error}"))?;
            fs::create_dir_all(&self.watch_dir).map_err(|error| {
                format!(
                    "could not prepare install recovery {}: {error}",
                    self.watch_dir.display()
                )
            })?;
            let copy = self
                .watch_dir
                .join(format!("install-watch-{}.exe", std::process::id()));
            fs::copy(&executable, &copy)
                .map_err(|error| format!("could not prepare install recovery: {error}"))?;
            // A new attempt supersedes any earlier failure the user ignored.
            clear_outcome(&self.outcome_path);
            *self
                .armed
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(copy);
            Ok(())
        }

        pub(crate) fn disarm(&self) {
            if let Some(copy) = self
                .armed
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
            {
                let _ = fs::remove_file(copy);
            }
        }

        fn spawn_if_armed(&self) {
            let Some(copy) = self
                .armed
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
            else {
                return;
            };
            let (Ok(installed_exe), Some(parent_created)) = (
                std::env::current_exe(),
                creation_time(unsafe { GetCurrentProcess() }),
            ) else {
                log::warn!("[cave] could not describe this process for install recovery");
                return;
            };
            let request = WatchRequest {
                parent_pid: std::process::id(),
                parent_created,
                installed_exe,
                outcome_path: self.outcome_path.clone(),
                msi_log_path: self.msi_log_path.clone(),
            };
            let spawned = crate::windows_command::hidden_command(&copy)
                .args(watch_args(&request))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            if let Err(error) = spawned {
                log::warn!("[cave] could not start update install recovery: {error}");
            }
        }
    }

    /// Dropped by the updater's pre-exit `cleanup_before_exit`, which runs
    /// after the package is validated and before msiexec starts.
    pub(crate) struct UpdateInstallWatchGuard(pub(crate) Arc<UpdateInstallWatch>);

    impl tauri::Resource for UpdateInstallWatchGuard {}

    impl Drop for UpdateInstallWatchGuard {
        fn drop(&mut self) {
            self.0.spawn_if_armed();
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) fn arm_update_install_recovery(
    state: tauri::State<'_, std::sync::Arc<UpdateInstallWatch>>,
) -> Result<(), String> {
    state.arm()
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) fn disarm_update_install_recovery(
    state: tauri::State<'_, std::sync::Arc<UpdateInstallWatch>>,
) {
    state.disarm();
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) fn update_install_outcome(
    state: tauri::State<'_, std::sync::Arc<UpdateInstallWatch>>,
) -> Option<UpdateInstallOutcome> {
    state.outcome()
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) fn clear_update_install_outcome(
    state: tauri::State<'_, std::sync::Arc<UpdateInstallWatch>>,
) {
    state.clear_outcome();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn msiexec_success_codes_leave_relaunch_to_the_installer() {
        for code in [0, 1641, 3010] {
            assert_eq!(classify_msiexec_exit(code), None, "code {code}");
        }
    }

    #[test]
    fn declined_elevation_and_cancel_are_cancelled_and_other_codes_fail() {
        assert_eq!(
            classify_msiexec_exit(1602),
            Some(UpdateInstallOutcomeKind::Cancelled)
        );
        assert_eq!(
            classify_msiexec_exit(1223),
            Some(UpdateInstallOutcomeKind::Cancelled)
        );
        for code in [1603, 1618, 1625, 1] {
            assert_eq!(
                classify_msiexec_exit(code),
                Some(UpdateInstallOutcomeKind::Failed),
                "code {code}"
            );
        }
    }

    #[test]
    fn watcher_arguments_round_trip_and_reject_malformed_launches() {
        let request = WatchRequest {
            parent_pid: 4242,
            parent_created: 133_000_000_000_000_000,
            installed_exe: absolute("Program Files/CovenCave/app.exe"),
            outcome_path: absolute("cave/update-install-outcome.json"),
            msi_log_path: absolute("cave/logs/msi upgrade.log"),
        };
        let args = watch_args(&request);
        assert_eq!(
            parse_watch_args(args.clone().into_iter()),
            Some(Ok(request))
        );

        assert_eq!(parse_watch_args(std::iter::empty()), None);
        assert_eq!(
            parse_watch_args(vec![OsString::from("--other")].into_iter()),
            None
        );
        let mut extra = args.clone();
        extra.push(OsString::from("unexpected"));
        assert_eq!(parse_watch_args(extra.into_iter()), Some(Err(())));
        let mut zero_pid = args.clone();
        zero_pid[1] = OsString::from("0");
        assert_eq!(parse_watch_args(zero_pid.into_iter()), Some(Err(())));
        let mut relative = args;
        relative[3] = OsString::from("app.exe");
        assert_eq!(parse_watch_args(relative.into_iter()), Some(Err(())));
    }

    #[test]
    fn a_recorded_outcome_persists_until_cleared() {
        let path = std::env::temp_dir().join(format!(
            "covencave-update-outcome-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("test clock")
                .as_nanos()
        ));
        let outcome = UpdateInstallOutcome {
            kind: UpdateInstallOutcomeKind::Cancelled,
            exit_code: Some(1602),
            log_path: Some("C:\\logs\\msi.log".to_string()),
        };
        write_outcome(&path, &outcome).expect("record outcome");
        assert_eq!(read_outcome(&path), Some(outcome.clone()));
        assert_eq!(
            read_outcome(&path),
            Some(outcome),
            "reading must not consume the outcome before the user acts"
        );
        clear_outcome(&path);
        assert!(!path.exists());
        assert_eq!(read_outcome(&path), None);
        clear_outcome(&path);

        fs::write(&path, b"not json").expect("write malformed outcome");
        assert_eq!(read_outcome(&path), None);
        assert!(!path.exists(), "a malformed outcome must not reappear");
    }

    #[test]
    fn outcome_serializes_for_the_webview_contract() {
        let json = serde_json::to_value(UpdateInstallOutcome {
            kind: UpdateInstallOutcomeKind::NotStarted,
            exit_code: None,
            log_path: None,
        })
        .expect("serialize outcome");
        assert_eq!(
            json,
            serde_json::json!({ "kind": "notStarted", "exitCode": null, "logPath": null })
        );
    }
}
