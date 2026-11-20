//! A fatal Windows dialog must outlive the failed host without keeping its
//! worker, Job Objects, or dedicated-port claims alive. Transfer only bounded
//! display text over stdin to an otherwise inert copy of the executable.
use std::io::Read;
const MAX_DIALOG_BYTES: usize = 64 * 1024;

fn read_dialog(mut input: impl Read) -> Result<String, String> {
    let mut bytes = Vec::new();
    input
        .by_ref()
        .take((MAX_DIALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not read startup failure")?;
    if bytes.len() > MAX_DIALOG_BYTES {
        return Err("startup failure exceeds display limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "startup failure is not UTF-8".into())
}

#[cfg(target_os = "windows")]
const HELPER_FLAG: &str = "--coven-startup-failure-dialog";

#[cfg(target_os = "windows")]
pub(super) fn spawn_fatal_dialog_helper(message: &str) -> Result<(), String> {
    let executable =
        std::env::current_exe().map_err(|_| "could not locate native dialog helper")?;
    spawn_dialog_at(&executable, message).map(drop)
}

#[cfg(target_os = "windows")]
fn spawn_dialog_at(
    executable: &std::path::Path,
    message: &str,
) -> Result<std::process::Child, String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut command = crate::windows_command::hidden_command(executable);
    command
        .args([HELPER_FLAG, &std::process::id().to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|_| "could not start native dialog helper")?;
    let mut end = message.len().min(MAX_DIALOG_BYTES);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    let bytes = message[..end].as_bytes().to_vec();
    let Some(mut pipe) = child.stdin.take() else {
        let _ = child.kill();
        return Err("native dialog pipe is missing".into());
    };
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = pipe.write_all(&bytes);
        drop(pipe);
        let _ = sent.send(result);
    });
    // A loader-stalled helper must not trap the failing host in a pipe write.
    if !matches!(
        received.recv_timeout(std::time::Duration::from_secs(2)),
        Ok(Ok(()))
    ) {
        let _ = child.kill();
        return Err("could not transfer startup failure before the deadline".into());
    }
    // Do not wait for a user's response. The caller exits immediately, letting
    // the kernel close every host-owned claim and kill-on-close Job Object.
    Ok(child)
}

#[cfg(target_os = "windows")]
pub(super) fn run_fatal_dialog_helper_if_requested() -> Option<i32> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(HELPER_FLAG)) {
        return None;
    }
    let Some(parent) = args
        .next()
        .and_then(|arg| arg.to_str()?.parse::<u32>().ok())
        .filter(|pid| *pid != 0)
    else {
        return Some(2);
    };
    if args.next().is_some() {
        return Some(2);
    }
    // Open while the parent is still writing the pipe when possible. This
    // handle identifies that process even if its numeric PID is later reused.
    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, parent) };
    let message = read_dialog(std::io::stdin().lock());
    if !process.is_null() {
        let exited = unsafe { WaitForSingleObject(process, 5000) } == WAIT_OBJECT_0;
        unsafe {
            CloseHandle(process);
        }
        if !exited {
            return Some(2);
        }
    }
    let Ok(message) = message else {
        return Some(2);
    };
    crate::platform_lifecycle::show_fatal_dialog(&message);
    Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_pipe_is_bounded_and_rejects_invalid_text() {
        assert_eq!(
            read_dialog("WebView2 failed\n再試行".as_bytes()).unwrap(),
            "WebView2 failed\n再試行"
        );
        assert!(read_dialog(&vec![b'x'; MAX_DIALOG_BYTES + 1][..]).is_err());
        assert!(read_dialog(&[0xff][..]).is_err());
        assert_eq!(
            read_dialog(&vec![b'x'; MAX_DIALOG_BYTES][..])
                .unwrap()
                .len(),
            MAX_DIALOG_BYTES
        );
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_tests {
    use super::*;
    use fs2::FileExt;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Child, Stdio};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    };

    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    struct OwnedHelper(HANDLE);
    impl Drop for OwnedHelper {
        fn drop(&mut self) {
            unsafe {
                TerminateProcess(self.0, 0);
                WaitForSingleObject(self.0, 3000);
                CloseHandle(self.0);
            }
        }
    }
    struct Search {
        pid: u32,
        visible: bool,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let search = &mut *(data as *mut Search);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == search.pid && IsWindowVisible(hwnd) != 0 {
            search.visible = true;
            return 0;
        }
        1
    }
    fn has_window(pid: u32) -> bool {
        let mut search = Search {
            pid,
            visible: false,
        };
        unsafe {
            EnumWindows(Some(visit), &mut search as *mut Search as LPARAM);
        }
        search.visible
    }
    fn until(mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(8);
        while !predicate() {
            assert!(
                Instant::now() < deadline,
                "native failure fixture exceeded its deadline"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn owned_worker_fixture() {
        if std::env::var_os("COVEN_TEST_FAILED_HOST_ROOT").is_none() {
            return;
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    // Run only when invoked as this test's explicitly owned synthetic host.
    #[test]
    fn failed_host_fixture() {
        let Some(root) = std::env::var_os("COVEN_TEST_FAILED_HOST_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        // Parent assigns the entire fixture tree to its cleanup job before
        // allowing us to spawn any child, including the diagnostic helper.
        until(|| root.join("start-host").exists());
        let executable = PathBuf::from(std::env::var_os("COVEN_STARTUP_DIALOG_TEST_EXE").unwrap());
        let worker = OwnedChild(
            crate::windows_command::hidden_command(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "startup_failure_dialog::native_tests::owned_worker_fixture",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let worker_job = crate::windows_process_job::ProcessJob::new().unwrap();
        worker_job.assign_child(&worker.0).unwrap();
        fs::write(root.join("worker.pid"), worker.0.id().to_string()).unwrap();
        assert_eq!(
            crate::sidecar_port_lock::claim_dedicated_port(&root, 43181).unwrap(),
            crate::sidecar_port_lock::PortClaim::Acquired
        );
        let helper = OwnedChild(
            spawn_dialog_at(
                &executable,
                "Synthetic startup failure: native helper lifecycle test",
            )
            .unwrap(),
        );
        fs::write(root.join("helper.pid"), helper.0.id().to_string()).unwrap();
        until(|| root.join("release-host").exists());
        // Deliberately bypass destructors, just like fatal_exit. Kernel handle
        // cleanup, not an explicit unlock, must release the failed host claim.
        std::process::exit(1);
    }

    #[test]
    fn helper_survives_failed_host_and_does_not_retain_port_claim() {
        let executable = PathBuf::from(
            std::env::var_os("COVEN_STARTUP_DIALOG_TEST_EXE")
                .expect("build the native app and set COVEN_STARTUP_DIALOG_TEST_EXE"),
        );
        assert!(executable.is_file());
        let root = std::env::temp_dir().join(format!(
            "c5979-helper-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&root).unwrap();
        let fixture_job = crate::windows_process_job::ProcessJob::new().unwrap();
        let mut host = OwnedChild(
            crate::windows_command::hidden_command(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "startup_failure_dialog::native_tests::failed_host_fixture",
                    "--nocapture",
                ])
                .env("COVEN_TEST_FAILED_HOST_ROOT", &root)
                .env("COVEN_STARTUP_DIALOG_TEST_EXE", &executable)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        fixture_job.assign_child(&host.0).unwrap();
        fs::write(root.join("start-host"), b"start").unwrap();
        let mut helper_pid = None;
        until(|| {
            helper_pid = fs::read_to_string(root.join("helper.pid"))
                .ok()
                .and_then(|value| value.parse::<u32>().ok());
            helper_pid.is_some()
        });
        let helper_pid = helper_pid.unwrap();
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, helper_pid) };
        assert!(!handle.is_null(), "open the exact owned helper process");
        let helper = OwnedHelper(handle);
        let worker_pid: u32 = fs::read_to_string(root.join("worker.pid"))
            .unwrap()
            .parse()
            .unwrap();
        let worker_handle =
            unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, worker_pid) };
        assert!(!worker_handle.is_null(), "open exact owned worker");
        let worker = OwnedHelper(worker_handle);
        assert_eq!(
            unsafe { WaitForSingleObject(worker.0, 0) },
            windows_sys::Win32::Foundation::WAIT_TIMEOUT
        );
        let claim = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(crate::sidecar_port_lock::port_lock_file_name(43181)))
            .unwrap();
        assert!(
            claim.try_lock_exclusive().is_err(),
            "host must still hold its claim"
        );
        // Allow the helper to reach its wait. A modal before host exit regresses
        // the guarantee that a waiting user cannot retain the failed host.
        let deadline = Instant::now() + Duration::from_millis(250);
        while Instant::now() < deadline {
            assert!(!has_window(helper_pid), "helper displayed before host exit");
            assert!(host.0.try_wait().unwrap().is_none());
            std::thread::sleep(Duration::from_millis(20));
        }
        fs::write(root.join("release-host"), b"exit").unwrap();
        until(|| host.0.try_wait().unwrap().is_some());
        claim
            .try_lock_exclusive()
            .expect("host exit releases claim while helper is alive");
        until(|| unsafe { WaitForSingleObject(worker.0, 0) } == windows_sys::Win32::Foundation::WAIT_OBJECT_0);
        until(|| has_window(helper_pid));
        assert_eq!(
            unsafe { WaitForSingleObject(helper.0, 0) },
            windows_sys::Win32::Foundation::WAIT_TIMEOUT
        );
        drop(helper); // close only this test's exact process handle
        drop(worker);
        drop(claim);
        drop(host);
        drop(fixture_job);
        fs::remove_dir_all(root).unwrap();
    }
}
