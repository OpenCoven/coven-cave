use super::*;

#[cfg(all(desktop, target_os = "linux"))]
pub(super) fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    if let Some(message) = payload.downcast_ref::<&str>() {
        return message.to_string();
    }
    "unknown panic".to_string()
}

#[cfg(all(desktop, target_os = "linux"))]
pub(super) fn log_linux_tray_unavailable(reason: &str) {
    let guidance = "CovenCave will continue without tray shortcuts. For tray support, install a compatible AppIndicator runtime, for example `libayatana-appindicator3-1` on Ubuntu/Debian or `libappindicator-gtk3` on Arch.";
    log::warn!("[cave] Linux tray disabled: {}. {}", reason, guidance);
    eprintln!(
        "[cave] Linux tray disabled: {}\n[cave] {}",
        reason, guidance
    );
}

/// Surface a fatal startup error to the user. Platform-specific: macOS uses
/// osascript (Cocoa alert), Windows writes to a temp file and opens Notepad,
/// Linux tries zenity/kdialog. Best-effort; ignored on failure.
#[cfg(desktop)]
pub(super) fn show_fatal_dialog(msg: &str) {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display alert \"CovenCave failed to start\" message \"{}\" as critical",
            msg.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let _ = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        // Write error to a temp file and open it in Notepad — reliable and
        // doesn't require any additional dependencies (e.g. winapi crate).
        let temp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".into());
        let path = format!("{}\\CovenCave-error.txt", temp);
        let _ = std::fs::write(&path, msg);
        let _ = std::process::Command::new("notepad.exe").arg(&path).spawn();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Try zenity (GNOME) then kdialog (KDE); fall back to stderr only.
        let shown = std::process::Command::new("zenity")
            .args(["--error", "--text", msg])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !shown {
            let _ = std::process::Command::new("kdialog")
                .args(["--error", msg])
                .output();
        }
    }
}

/// Show the dialog and exit the process cleanly. Returning Err from setup()
/// instead causes Tauri to panic inside the macOS NSApplicationDelegate's
/// didFinishLaunching callback, which can't unwind across the Objective-C FFI
/// boundary and aborts with SIGABRT. process::exit() avoids that path.
#[cfg(desktop)]
pub(super) fn fatal_exit(msg: &str) -> ! {
    eprintln!("[cave] FATAL: {}", msg);
    show_fatal_dialog(msg);
    std::process::exit(1);
}

/// macOS AppTranslocation: if the user launches the app from the DMG or
/// downloads folder without first dragging it to /Applications, Gatekeeper
/// runs it from a randomized read-only path under
/// `/private/var/folders/.../AppTranslocation/`. Bundled resources still work
/// but anything that needs writable state (or that the user expects to be
/// "installed") breaks. Surface a clear "Move to Applications" prompt instead
/// of silently running translocated.
///
/// On non-macOS platforms this is a no-op.
#[cfg(desktop)]
pub(super) fn check_app_translocation() {
    #[cfg(target_os = "macos")]
    {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let path = exe.to_string_lossy().to_string();
        if !path.contains("/AppTranslocation/") && !path.contains("/Volumes/") {
            return;
        }
        let msg = format!(
            "CovenCave is running from a read-only quarantine path:\n\n{}\n\nTo install properly, quit, then drag CovenCave.app into your /Applications folder and launch it from there.",
            path
        );
        show_fatal_dialog(&msg);
        std::process::exit(1);
    }
}

// This hook sits below Tao/Tauri's event dispatch. WRY waits for WebView2
// environment/controller creation inside a nested Windows message pump. A
// WM_CLOSE received there is otherwise buffered by Tao until the active event
// callback returns; if WebView2 never completes, Tauri's CloseRequested handler
// can never run. The hook only signals a process-lifetime kernel event. Two
// waiters are pre-spawned during setup: one performs bounded owned-process
// cleanup and requests a normal Tauri exit; the other terminates this process
// after the deadline if the event loop remains wedged. Kill-on-close Job
// Objects then reap every owned process tree. Quick Chat and every non-Windows
// window keep their existing lifecycle.
#[cfg(all(desktop, target_os = "windows"))]
pub(super) const WINDOWS_MAIN_CLOSE_SUBCLASS_ID: usize = 0x4341_5645;
#[cfg(all(desktop, target_os = "windows"))]
pub(super) const WINDOWS_MAIN_CLOSE_EXIT_DEADLINE: Duration = Duration::from_millis(1200);

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn signal_windows_main_close(event: HANDLE) -> bool {
    unsafe { SetEvent(event) != 0 }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn is_windows_main_close_message(message: u32, wparam: WPARAM) -> bool {
    message == WM_CLOSE || (message == WM_SYSCOMMAND && (wparam & 0xfff0) == SC_CLOSE as usize)
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn terminate_current_process_now() -> ! {
    unsafe {
        TerminateProcess(GetCurrentProcess(), 0);
    }
    std::process::abort();
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn run_windows_main_close_hard_deadline(event: HANDLE) -> ! {
    let wait = unsafe { WaitForSingleObject(event, INFINITE) };
    if wait != WAIT_OBJECT_0 {
        std::process::abort();
    }
    thread::sleep(WINDOWS_MAIN_CLOSE_EXIT_DEADLINE);
    terminate_current_process_now();
}

#[cfg(all(desktop, target_os = "windows"))]
unsafe extern "system" fn windows_main_close_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    if is_windows_main_close_message(message, wparam) {
        if !signal_windows_main_close(reference_data as HANDLE) {
            terminate_current_process_now();
        }
        // Consume the native close here so neither a JavaScript listener nor a
        // nested WRY message pump can defer it. The pre-spawned cleanup waiter
        // owns graceful app.exit; the hard waiter owns the deadline.
        return 0;
    }

    if message == WM_NCDESTROY {
        // The event is deliberately process-lifetime: the watchdog may still
        // be waiting on it while the HWND is torn down through another path.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(windows_main_close_subclass), subclass_id);
        }
    }

    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn install_windows_main_close_fallback(app: &tauri::App) -> Result<(), String> {
    let main = app
        .get_window("main")
        .ok_or_else(|| "main window missing while installing close fallback".to_string())?;
    let hwnd = main.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let close_event = unsafe {
        CreateEventW(
            std::ptr::null(),
            1, // manual-reset: repeated SC_CLOSE/WM_CLOSE messages stay once-only
            0,
            std::ptr::null(),
        )
    };
    if close_event.is_null() {
        return Err("could not create authoritative Windows close event".to_string());
    }

    let cleanup_event_bits = close_event as usize;
    let cleanup_app = app.handle().clone();
    let cleanup_waiter = thread::Builder::new()
        .name("cave-close-cleanup".to_string())
        .spawn(move || {
            let event = cleanup_event_bits as HANDLE;
            if unsafe { WaitForSingleObject(event, INFINITE) } == WAIT_OBJECT_0 {
                shutdown_owned_processes(&cleanup_app);
                cleanup_app.exit(0);
            }
        });
    if cleanup_waiter.is_err() {
        unsafe { CloseHandle(close_event) };
        return Err("could not start authoritative Windows close cleanup".to_string());
    }

    let hard_event_bits = close_event as usize;
    let hard_waiter = thread::Builder::new()
        .name("cave-close-hard-deadline".to_string())
        .spawn(move || {
            let event = hard_event_bits as HANDLE;
            run_windows_main_close_hard_deadline(event);
        });
    if hard_waiter.is_err() {
        // A cleanup waiter is already blocked on this process-lifetime event.
        // Wake it before failing setup; it will reap owned jobs and request exit.
        let _ = signal_windows_main_close(close_event);
        return Err("could not start authoritative Windows close hard deadline".to_string());
    }

    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(windows_main_close_subclass),
            WINDOWS_MAIN_CLOSE_SUBCLASS_ID,
            close_event as usize,
        )
    };
    if installed == 0 {
        let _ = signal_windows_main_close(close_event);
        return Err("could not install authoritative Windows close fallback".to_string());
    }
    Ok(())
}
