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
pub use tauri_setup::run;
