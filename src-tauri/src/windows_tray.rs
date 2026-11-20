//! Windows taskbar appearance is independent of the app's chosen theme.

fn foreground(system_uses_light_theme: Option<u32>) -> u8 {
    if system_uses_light_theme == Some(1) {
        0
    } else {
        255
    }
}

fn icon_rgba(system_uses_light_theme: Option<u32>) -> Vec<u8> {
    let mut pixels = include_bytes!("../icons/tray-icon-36.rgba").to_vec();
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[..3].fill(foreground(system_uses_light_theme));
    }
    pixels
}

#[cfg(target_os = "windows")]
mod native {
    use tauri::Manager;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
        UI::{
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{WM_NCDESTROY, WM_SETTINGCHANGE, WM_THEMECHANGED},
        },
    };

    // Separate from the authoritative-close subclass: no polling or worker
    // lifetime, and nothing added to that deliberately minimal callback.
    const SUBCLASS_ID: usize = 0x4341_5654;

    fn system_theme() -> Option<u32> {
        let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let name: Vec<u16> = "SystemUsesLightTheme"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut value: u32 = 0;
        let mut bytes: u32 = 4;
        let result = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut value as *mut u32).cast(),
                &mut bytes,
            )
        };
        (result == 0 && bytes == 4).then_some(value)
    }

    pub(super) fn icon() -> tauri::image::Image<'static> {
        tauri::image::Image::new_owned(super::icon_rgba(system_theme()), 36, 36)
    }

    fn refresh(app: &tauri::AppHandle) {
        if let Some(tray) = app.tray_by_id("cave-tray") {
            if let Err(error) = tray.set_icon(Some(icon())) {
                log::warn!("[cave] could not refresh taskbar icon: {error}");
            }
        }
    }

    unsafe extern "system" fn appearance_changed(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        subclass_id: usize,
        reference_data: usize,
    ) -> LRESULT {
        // Never unwind across the Win32 ABI. Tauri may execute this closure
        // immediately on the main thread; it only updates the tray icon and
        // does not change window state or the appearance subclass.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if message == WM_SETTINGCHANGE || message == WM_THEMECHANGED {
                let app = unsafe { &*(reference_data as *const tauri::AppHandle) };
                let queued = app.clone();
                let _ = app.run_on_main_thread(move || refresh(&queued));
            }
            if message == WM_NCDESTROY {
                if unsafe { RemoveWindowSubclass(hwnd, Some(appearance_changed), subclass_id) } != 0
                {
                    // Exactly one box per installed HWND, released after the
                    // callback is removed so no later dispatch can borrow it.
                    drop(unsafe { Box::from_raw(reference_data as *mut tauri::AppHandle) });
                }
            }
        }));
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub(super) fn observe(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let owned_window = window.clone();
        window.run_on_main_thread(move || {
            let Ok(handle) = owned_window.hwnd() else {
                return;
            };
            let hwnd = handle.0 as HWND;
            let mut previous = 0;
            if unsafe {
                GetWindowSubclass(hwnd, Some(appearance_changed), SUBCLASS_ID, &mut previous)
            } != 0
            {
                return;
            }
            let data = Box::into_raw(Box::new(owned_window.app_handle().clone()));
            if unsafe {
                SetWindowSubclass(hwnd, Some(appearance_changed), SUBCLASS_ID, data as usize)
            } == 0
            {
                drop(unsafe { Box::from_raw(data) });
                log::warn!("[cave] could not observe Windows taskbar appearance");
            }
        })
    }
}

#[cfg(target_os = "windows")]
pub(super) fn icon() -> tauri::image::Image<'static> {
    native::icon()
}

#[cfg(target_os = "windows")]
pub(super) fn observe(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    native::observe(window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_taskbar_uses_dark_foreground_and_dark_taskbar_uses_white() {
        assert_eq!(foreground(Some(1)), 0);
        assert_eq!(foreground(Some(0)), 255);
        assert_eq!(foreground(None), 255);
        assert_eq!(foreground(Some(2)), 255);
    }

    #[test]
    fn both_variants_keep_the_exact_icon_dimensions_and_alpha() {
        let original = include_bytes!("../icons/tray-icon-36.rgba");
        assert_eq!(original.len(), 36 * 36 * 4);
        for light in [Some(0), Some(1)] {
            let pixels = icon_rgba(light);
            assert_eq!(pixels.len(), original.len());
            for (actual, source) in pixels.chunks_exact(4).zip(original.chunks_exact(4)) {
                assert_eq!(actual[3], source[3]);
                assert_eq!(&actual[..3], &[foreground(light); 3]);
            }
        }
    }
}
