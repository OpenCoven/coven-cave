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

#[cfg(all(test, desktop))]
#[path = "app_lifecycle_tests.rs"]
mod app_lifecycle_tests;
#[cfg(desktop)]
pub mod browser;
#[cfg(desktop)]
mod platform_lifecycle;
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
#[cfg(desktop)]
mod tauri_setup;
#[cfg(desktop)]
mod window_geometry;
#[cfg(all(desktop, target_os = "windows"))]
mod windows_process_job;

#[cfg(desktop)]
use shell_open_commands::{shell_open, shell_open_path, shell_pick_directory};
#[cfg(desktop)]
use shell_open_helpers::{
    normalize_picked_directory, validate_shell_open_path, validate_shell_open_url,
    windows_system32_binary,
};
#[cfg(desktop)]
use sidecar_auth::*;
#[cfg(desktop)]
use sidecar_discovery::*;
#[cfg(desktop)]
use sidecar_lifecycle::*;
#[cfg(desktop)]
use window_geometry::*;
