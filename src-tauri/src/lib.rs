#[cfg(desktop)]
use rand::{rngs::OsRng, RngCore};
#[cfg(all(desktop, target_os = "windows"))]
use serde::Serialize;
#[cfg(desktop)]
use std::net::TcpListener;
#[cfg(all(desktop, target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "windows"))]
use std::process::Command;
#[cfg(desktop)]
use std::process::{Child, Stdio};
#[cfg(all(desktop, target_os = "windows"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::{Arc, Mutex};
#[cfg(desktop)]
use std::thread;
#[cfg(desktop)]
use std::time::{Duration, Instant};
#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
pub use tauri_setup::run;
#[cfg(all(desktop, target_os = "windows"))]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, WAIT_OBJECT_0, WPARAM},
    System::Threading::{
        CreateEventW, GetCurrentProcess, SetEvent, TerminateProcess, WaitForSingleObject, INFINITE,
    },
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{SC_CLOSE, WM_CLOSE, WM_NCDESTROY, WM_SYSCOMMAND},
    },
};

#[cfg(desktop)]
pub(crate) fn bundled_tools_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources").join("tools")
}

#[cfg(desktop)]
pub(crate) fn bundled_tool_path(resource_dir: &Path, stem: &str) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    };
    bundled_tools_dir(resource_dir).join("bin").join(name)
}

#[cfg(desktop)]
pub(crate) struct BundledCoreTools {
    pub(crate) bin_dir: PathBuf,
    pub(crate) coven_bin: PathBuf,
    pub(crate) coven_code_bin: PathBuf,
    pub(crate) manifest: PathBuf,
}

#[cfg(desktop)]
pub(crate) fn bundled_core_tools(resource_dir: &Path) -> Result<BundledCoreTools, String> {
    let bin_dir = bundled_tools_dir(resource_dir).join("bin");
    let coven_bin = bundled_tool_path(resource_dir, "coven");
    let coven_code_bin = bundled_tool_path(resource_dir, "coven-code");
    let manifest = bundled_tools_dir(resource_dir).join("tools-manifest.json");

    for (name, path) in [
        ("coven", &coven_bin),
        ("coven-code", &coven_code_bin),
        ("tools manifest", &manifest),
    ] {
        if !path.is_absolute() || !path.is_file() {
            return Err(format!(
                "bundled Cave runtime is incomplete: {name} is missing at {}",
                path.display()
            ));
        }
    }
    if !bin_dir.is_dir() {
        return Err(format!(
            "bundled Cave runtime is incomplete: tools bin directory is missing at {}",
            bin_dir.display()
        ));
    }

    Ok(BundledCoreTools {
        bin_dir,
        coven_bin,
        coven_code_bin,
        manifest,
    })
}

#[cfg(all(test, desktop))]
#[path = "app_lifecycle_tests.rs"]
mod app_lifecycle_tests;

#[cfg(all(test, desktop))]
mod bundled_tools_tests {
    use super::*;

    #[test]
    fn bundled_tools_dir_is_relative_to_the_tauri_resource_root() {
        let resource_dir = Path::new("/opt/CovenCave/resources");
        assert_eq!(
            bundled_tools_dir(resource_dir),
            resource_dir.join("resources").join("tools")
        );
    }

    #[test]
    fn bundled_tool_path_uses_the_platform_executable_name() {
        let resource_dir = Path::new("/opt/CovenCave/resources");
        let executable = if cfg!(target_os = "windows") {
            "coven.exe"
        } else {
            "coven"
        };
        assert_eq!(
            bundled_tool_path(resource_dir, "coven"),
            resource_dir
                .join("resources")
                .join("tools")
                .join("bin")
                .join(executable)
        );
    }
}
#[cfg(desktop)]
pub mod browser;
#[cfg(desktop)]
mod discord_presence;
#[cfg(desktop)]
mod desktop_reachability;
#[cfg(desktop)]
mod platform_lifecycle;
#[cfg(all(desktop, target_os = "macos"))]
mod microphone;
#[cfg(desktop)]
mod pty;
#[cfg(desktop)]
mod shell_open_commands;
#[cfg(desktop)]
mod shell_open_helpers;
#[cfg(all(desktop, target_os = "windows"))]
mod sidecar_archive;
#[cfg(desktop)]
mod sidecar_auth;
#[cfg(desktop)]
mod sidecar_discovery;
#[cfg(desktop)]
mod sidecar_lifecycle;
#[cfg(desktop)]
mod sidecar_startup;
#[cfg(desktop)]
mod speech;
mod tauri_setup;
#[cfg(desktop)]
mod window_geometry;
#[cfg(all(desktop, target_os = "windows"))]
mod windows_process_job;

#[cfg(desktop)]
use desktop_reachability::*;
#[cfg(desktop)]
use platform_lifecycle::*;
#[cfg(all(test, desktop))]
use shell_open_commands::launch_x_oauth_url_with_window;
#[cfg(desktop)]
use shell_open_commands::{open_x_oauth_url, shell_open, shell_open_path, shell_pick_directory};
#[cfg(desktop)]
use shell_open_helpers::{
    normalize_picked_directory, validate_shell_open_path, validate_shell_open_url,
    validate_x_oauth_url,
    windows_system32_binary,
};
#[cfg(desktop)]
use sidecar_auth::*;
#[cfg(desktop)]
use sidecar_discovery::*;
#[cfg(desktop)]
use sidecar_lifecycle::*;
#[cfg(desktop)]
use sidecar_startup::*;
#[cfg(desktop)]
use window_geometry::*;
