//! Primary Windows normal placement. Failed or future config is preserved;
//! native presentation can still use a safe default without overwriting it.
use crate::window_placement::Rect;
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "windows")]
fn native_presentation(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<(bool, bool)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SW_MINIMIZE, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWMINNOACTIVE,
        WINDOWPLACEMENT,
    };
    let mut placement: WINDOWPLACEMENT = unsafe { std::mem::zeroed() };
    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
    if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
        return None;
    }
    let command = placement.showCmd as i32;
    Some((
        matches!(command, SW_SHOWMINIMIZED | SW_MINIMIZE | SW_SHOWMINNOACTIVE),
        command == SW_SHOWMAXIMIZED,
    ))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Stored {
    version: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct State {
    normal: Option<Rect>,
    writable: bool,
}

impl State {
    fn observe(
        &mut self,
        rect: Rect,
        primary: bool,
        minimized: bool,
        maximized: bool,
        fullscreen: bool,
    ) {
        if primary && !minimized && !maximized && !fullscreen && rect.width > 0 && rect.height > 0 {
            self.normal = Some(rect);
        }
    }
}

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "invalid or unsupported window placement",
    )
}

fn load(path: &Path) -> io::Result<Option<Rect>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(invalid());
    }
    let stored: Stored = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if stored.version != 1 || stored.width == 0 || stored.height == 0 {
        return Err(invalid());
    }
    Ok(Some(Rect {
        x: stored.x,
        y: stored.y,
        width: stored.width,
        height: stored.height,
    }))
}

fn save(path: &Path, rect: Rect) -> io::Result<()> {
    if rect.width == 0 || rect.height == 0 {
        return Err(invalid());
    }
    let stored = Stored {
        version: 1,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    };
    let bytes = serde_json::to_vec(&stored).map_err(|_| invalid())?;
    write_state(path, &bytes, replace_file)
}

// Same atomic replacement contract as offline_cache, without coupling window
// configuration to the encrypted-cache subsystem or its credentials.
#[cfg(not(target_os = "windows"))]
fn replace_file(staging: &Path, destination: &Path) -> io::Result<()> {
    std::fs::rename(staging, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(staging: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let staging: Vec<u16> = staging.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe {
        MoveFileExW(
            staging.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_state(
    path: &Path,
    bytes: &[u8],
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or_else(invalid)?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!(
        ".window-placement-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Failure to create does not confer ownership of an existing staging path.
    let mut file = options.open(&staging)?;
    let result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = result.and_then(|_| replace(&staging, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result
}

#[cfg(any(target_os = "windows", test))]
mod native {
    use super::*;
    use crate::window_placement::{fit_main_window, select_work_area};
    use std::sync::Mutex;
    use tauri::Manager;

    fn path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
        app.path()
            .app_config_dir()
            .ok()
            .map(|p| p.join("main-window-placement.json"))
    }

    pub(crate) fn initialize(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let app = window.app_handle();
        let mut state = match path(app).map(|p| load(&p)) {
            Some(Ok(normal)) => State {
                normal,
                writable: true,
            },
            Some(Err(error)) => {
                log::warn!("[cave] preserving unreadable window placement: {error}");
                State::default()
            }
            None => State::default(),
        };
        let result = (|| -> tauri::Result<()> {
            let monitors = app.available_monitors()?;
            let areas: Vec<Rect> = monitors
                .iter()
                .map(|m| {
                    let a = m.work_area();
                    Rect {
                        x: a.position.x,
                        y: a.position.y,
                        width: a.size.width,
                        height: a.size.height,
                    }
                })
                .collect();
            let primary = app.primary_monitor()?;
            let preferred = primary
                .and_then(|p| monitors.iter().position(|m| m.position() == p.position()))
                .unwrap_or(0);
            let Some(area) = select_work_area(&areas, preferred, state.normal) else {
                return Ok(());
            };
            let index = areas.iter().position(|a| *a == area).unwrap_or(preferred);
            // Move the still-hidden window onto its target DPI before measuring
            // the actual native border/title-bar extents.
            window.set_position(tauri::PhysicalPosition::new(area.x, area.y))?;
            let outer = window.outer_size()?;
            let inner = window.inner_size()?;
            let frame = (
                outer.width.saturating_sub(inner.width),
                outer.height.saturating_sub(inner.height),
            );
            let Some(placement) =
                fit_main_window(area, monitors[index].scale_factor(), frame, state.normal)
            else {
                return Ok(());
            };
            window.set_min_size(Some(tauri::PhysicalSize::new(
                placement.min_inner_size.0,
                placement.min_inner_size.1,
            )))?;
            window.set_size(tauri::PhysicalSize::new(
                placement.inner_size.0,
                placement.inner_size.1,
            ))?;
            window.set_position(tauri::PhysicalPosition::new(
                placement.outer.x,
                placement.outer.y,
            ))?;
            state.normal = Some(placement.outer);
            Ok(())
        })();
        if let Err(error) = result {
            log::warn!("[cave] could not restore main window placement: {error}");
        }
        app.manage(Mutex::new(state));
        // Showing the primary window is part of startup success, unlike a
        // recoverable placement/config failure. Preserve the existing fatal
        // startup diagnostic path if the native window cannot be shown.
        window.show()
    }

    pub(crate) fn on_event(window: &tauri::Window, event: &tauri::WindowEvent) {
        if window.label() != crate::PRIMARY_MAIN_WINDOW_LABEL {
            return;
        }
        if !matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Focused(false)
                | tauri::WindowEvent::CloseRequested { .. }
        ) {
            return;
        }
        let Some(state) = window.app_handle().try_state::<Mutex<State>>() else {
            return;
        };
        let Ok(mut state) = state.lock() else {
            return;
        };
        // Tao updates its cached maximized flag in WM_SIZE, after it can emit
        // Moved. Query Win32 itself so an early Moved cannot overwrite normal
        // geometry with the maximized/minimized rectangle.
        #[cfg(target_os = "windows")]
        let presentation = window
            .hwnd()
            .ok()
            .and_then(|handle| native_presentation(handle.0 as _));
        #[cfg(not(target_os = "windows"))]
        let presentation = window.is_minimized().ok().zip(window.is_maximized().ok());
        let Some((minimized, maximized)) = presentation else {
            return;
        };
        // An unknown native state is not evidence of a normal restore rectangle.
        if let (Ok(position), Ok(size), Ok(fullscreen)) = (
            window.outer_position(),
            window.outer_size(),
            window.is_fullscreen(),
        ) {
            state.observe(
                Rect {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                },
                true,
                minimized,
                maximized,
                fullscreen,
            );
        }
        if state.writable
            && matches!(
                event,
                tauri::WindowEvent::Focused(false) | tauri::WindowEvent::CloseRequested { .. }
            )
        {
            if let (Some(path), Some(normal)) = (path(window.app_handle()), state.normal) {
                if let Err(error) = save(&path, normal) {
                    log::warn!("[cave] could not save main window placement: {error}");
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use native::{initialize, on_event};

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn native_maximize_evidence_preserves_normal_before_cached_resize_state() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, ShowWindow, SW_MINIMIZE, SW_SHOWMAXIMIZED,
            WS_OVERLAPPEDWINDOW,
        };
        let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                40,
                40,
                500,
                400,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!hwnd.is_null());
        struct Cleanup(windows_sys::Win32::Foundation::HWND);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        let _cleanup = Cleanup(hwnd);
        let normal = Rect {
            x: 40,
            y: 40,
            width: 500,
            height: 400,
        };
        let mut state = State {
            normal: Some(normal),
            writable: true,
        };
        for command in [SW_SHOWMAXIMIZED, SW_MINIMIZE] {
            unsafe {
                ShowWindow(hwnd, command);
            }
            let (minimized, maximized) = native_presentation(hwnd).expect("native placement");
            assert!(minimized || maximized);
            // A Moved callback may precede Tao's cached WM_SIZE update; the
            // adapter uses this native evidence instead of the stale false.
            state.observe(
                Rect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                true,
                minimized,
                maximized,
                false,
            );
            assert_eq!(state.normal, Some(normal));
        }
        assert_eq!(native_presentation(std::ptr::null_mut()), None);
    }
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "cave-window-state-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self) -> std::path::PathBuf {
            self.0.join("window.json")
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn sample() -> Rect {
        Rect {
            x: -1600,
            y: 45,
            width: 1200,
            height: 800,
        }
    }

    #[test]
    fn saved_normal_rectangle_round_trips_and_missing_state_is_not_an_error() {
        let s = Scratch::new();
        assert_eq!(load(&s.file()).unwrap(), None);
        save(&s.file(), sample()).unwrap();
        assert_eq!(load(&s.file()).unwrap(), Some(sample()));
        save(&s.file(), Rect { x: 10, ..sample() }).unwrap();
        assert_eq!(load(&s.file()).unwrap().unwrap().x, 10);
        assert_eq!(std::fs::read_dir(&s.0).unwrap().count(), 1);
    }

    #[test]
    fn invalid_or_future_state_is_reported_without_modifying_its_bytes() {
        let s = Scratch::new();
        for text in [
            "{",
            r#"{"version":2,"x":0,"y":0,"width":1200,"height":800}"#,
            r#"{"version":1,"x":0,"y":0,"width":0,"height":800}"#,
        ] {
            std::fs::write(s.file(), text).unwrap();
            assert_eq!(
                load(&s.file()).unwrap_err().kind(),
                std::io::ErrorKind::InvalidData
            );
            assert_eq!(std::fs::read_to_string(s.file()).unwrap(), text);
        }
        std::fs::write(s.file(), vec![b' '; 4097]).unwrap();
        assert_eq!(
            load(&s.file()).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn failed_replacement_preserves_previous_state_and_removes_owned_staging_file() {
        let s = Scratch::new();
        save(&s.file(), sample()).unwrap();
        let before = std::fs::read(s.file()).unwrap();
        let result = write_state(&s.file(), b"new", |_, _| {
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        });
        assert_eq!(
            result.unwrap_err().kind(),
            std::io::ErrorKind::PermissionDenied
        );
        assert_eq!(std::fs::read(s.file()).unwrap(), before);
        assert_eq!(std::fs::read_dir(&s.0).unwrap().count(), 1);
    }

    #[test]
    fn only_normal_primary_window_observations_replace_saved_geometry() {
        let mut state = State {
            normal: Some(sample()),
            writable: true,
        };
        let next = Rect { x: 10, ..sample() };
        for (primary, minimized, maximized, fullscreen) in [
            (false, false, false, false),
            (true, true, false, false),
            (true, false, true, false),
            (true, false, false, true),
        ] {
            state.observe(next, primary, minimized, maximized, fullscreen);
            assert_eq!(state.normal, Some(sample()));
        }
        state.observe(next, true, false, false, false);
        assert_eq!(state.normal, Some(next));
    }
}
