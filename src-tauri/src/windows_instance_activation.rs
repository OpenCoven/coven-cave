//! Relaunch activation supplements, never replaces, the per-port OS claim.
//! Only main windows explicitly marked by this app are eligible. Owner-file
//! PIDs and window titles alone are not sufficient to select a window.

#[cfg(any(target_os = "windows", test))]
fn matches_owner_port(owner_pid: u32, actual_pid: u32, port: u16, marker: usize) -> bool {
    owner_pid != 0 && actual_pid == owner_pid && marker == usize::from(port) && port != 0
}

#[cfg(target_os = "windows")]
mod native {
    use super::matches_owner_port;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetPropW, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, SetPropW, ShowWindowAsync, SW_RESTORE, SW_SHOW,
    };

    fn property_name() -> Vec<u16> {
        "OpenCoven.CovenCave.MainWindow.Port.v1"
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }

    pub(super) fn mark(hwnd: HWND, port: u16) -> Result<(), String> {
        if port == 0 {
            return Err("cannot mark a main window with port zero".into());
        }
        // The property is an integer tag, not an allocated object. Windows
        // removes window properties when the window is destroyed.
        if unsafe { SetPropW(hwnd, property_name().as_ptr(), usize::from(port) as _) } == 0 {
            return Err("could not register the main window for relaunch".into());
        }
        Ok(())
    }

    struct Search {
        pid: u32,
        port: u16,
        window: HWND,
    }

    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let search = &mut *(data as *mut Search);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let marker = GetPropW(hwnd, property_name().as_ptr()) as usize;
        if matches_owner_port(search.pid, pid, search.port, marker) {
            search.window = hwnd;
            return 0;
        }
        1
    }

    fn find(pid: u32, port: u16) -> Option<HWND> {
        let mut search = Search {
            pid,
            port,
            window: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(Some(visit), &mut search as *mut Search as LPARAM);
        }
        (!search.window.is_null()).then_some(search.window)
    }

    fn same_executable(pid: u32) -> bool {
        let Ok(current) = std::env::current_exe() else {
            return false;
        };
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return false;
        }
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;
        let read =
            unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
        unsafe {
            CloseHandle(process);
        }
        read != 0
            && String::from_utf16_lossy(&buffer[..length as usize])
                .eq_ignore_ascii_case(&current.to_string_lossy())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WS_OVERLAPPED,
        };

        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }

        #[test]
        fn native_window_discovery_requires_port_marker_and_owner() {
            let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
            let window = TestWindow(unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_OVERLAPPED,
                    0,
                    0,
                    16,
                    16,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            });
            assert!(
                !window.0.is_null(),
                "create isolated hidden native test window"
            );
            let pid = std::process::id();
            assert_eq!(find(pid, 43179), None);
            mark(window.0, 43179).unwrap();
            assert_eq!(find(pid, 43179), Some(window.0));
            assert_eq!(find(pid, 43180), None);
            assert_eq!(find(0, 43179), None);
            assert!(same_executable(pid));
            // Never request foreground activation during a CI test.
        }
    }

    pub(super) fn focus(port: u16, pid: Option<u32>) -> bool {
        let Some(pid) = pid.filter(|pid| *pid != std::process::id()) else {
            return false;
        };
        if !same_executable(pid) {
            return false;
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(hwnd) = find(pid, port) {
                // Re-check the process identity before acting; a stale owner
                // record or another port's window must not be activated.
                if !same_executable(pid) {
                    return false;
                }
                unsafe {
                    ShowWindowAsync(
                        hwnd,
                        if IsIconic(hwnd) != 0 {
                            SW_RESTORE
                        } else {
                            SW_SHOW
                        },
                    );
                    SetForegroundWindow(hwnd);
                    if GetForegroundWindow() == hwnd {
                        return true;
                    }
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(target_os = "windows")]
pub(super) fn mark_main_window_port(
    hwnd: windows_sys::Win32::Foundation::HWND,
    port: u16,
) -> Result<(), String> {
    native::mark(hwnd, port)
}

#[cfg(target_os = "windows")]
pub(super) fn focus_existing_port_owner(port: u16, pid: Option<u32>) -> bool {
    native::focus(port, pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_requires_both_the_owner_and_exact_port_marker() {
        assert!(matches_owner_port(42, 42, 3020, 3020));
        assert!(!matches_owner_port(42, 43, 3020, 3020));
        assert!(!matches_owner_port(42, 42, 3020, 3021));
        assert!(!matches_owner_port(42, 42, 3020, 0));
        assert!(!matches_owner_port(0, 0, 3020, 3020));
        assert!(!matches_owner_port(42, 42, 0, 0));
    }
}
