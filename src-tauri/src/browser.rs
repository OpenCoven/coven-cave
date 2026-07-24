// Embedded browser pane for CovenCave.
//
// Ports the design from BunsDev/comux/native/macos/comux-tauri: a real
// Chromium child webview is added to the main window via
// `tauri::webview::WebviewBuilder`, positioned with viewport-relative
// PhysicalPosition/PhysicalSize. The frontend converts its CSS-pixel bounds
// into native physical pixels before it calls these commands, so a child
// WebView remains aligned when the renderer and OS use HiDPI scaling.
// The frontend keeps the webview's bounds
// in sync with a placeholder <div> via ResizeObserver +
// getBoundingClientRect, calling browser_set_bounds whenever its layout
// changes.
//
// Commands:
//   browser_navigate(label, url, x, y, w, h)
//   browser_set_bounds(label, x, y, w, h)
//   browser_hide(label)
//   browser_hide_all_except(label)
//   browser_close(label)
//   browser_deactivate_all(pane_label)
//   browser_close_all(pane_label)
//
// Events:
//   browser:page-load { label, url, phase: "started" | "finished" }

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Url, WebviewUrl};

const BROWSER_LABEL_PREFIX: &str = "cave-browser-";
const OFFSCREEN_X: f64 = -10000.0;
const OFFSCREEN_Y: f64 = -10000.0;
const USER_NAVIGATION_MARKER_TTL: Duration = Duration::from_secs(2);
const MAX_TRACKED_BROWSER_URLS: usize = 64;

#[path = "browser_bounds.rs"]
mod browser_bounds;
#[path = "browser_commands.rs"]
pub(crate) mod browser_commands;
#[path = "browser_events.rs"]
mod browser_events;
#[path = "browser_native.rs"]
mod browser_native;
#[path = "browser_reconciliation.rs"]
mod browser_reconciliation;
#[path = "browser_state.rs"]
mod browser_state;

use browser_bounds::{
    browser_bounds_within_client, offscreen_browser_creation_bounds, BrowserBounds,
};
pub use browser_commands::*;
use browser_events::BrowserEventTracker;
use browser_native::{hide_webview, show_webview_at};
pub use browser_state::BrowserLifecycleState;
use browser_state::{
    advance_scope_barrier, effective_browser_intent, record_bounds_intent,
    record_navigation_intent, record_reload_intent, record_scope_intent, record_visibility_intent,
    BrowserBoundsIntent, BrowserLifecycleInner, BrowserScopeAction, BrowserVisibility,
    BrowserWorkerSignal,
};

use browser_reconciliation::{
    ensure_browser_controller, event_sequence_for_label_url, event_tracker_for_label,
    schedule_browser_reconcile, schedule_scope_reconcile, BrowserScrollEvent, BrowserTitleEvent,
    EnvironmentCallbackTimeoutAction, EnvironmentCallbackTimeoutRetryState,
};

fn safe_browser_label(label: Option<String>) -> String {
    let raw = label.unwrap_or_else(|| "default".to_string());
    let safe: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    format!(
        "{}{}",
        BROWSER_LABEL_PREFIX,
        if safe.is_empty() { "default" } else { &safe }
    )
}

fn url_without_fragment(url: &Url) -> String {
    let mut normalized = url.clone();
    normalized.set_fragment(None);
    normalized.to_string()
}

#[cfg(test)]
#[path = "browser_lifecycle_tests.rs"]
mod lifecycle_tests;
