// Embedded browser pane for CovenCave.
//
// Ports the design from BunsDev/comux/native/macos/comux-tauri: a real
// Chromium child webview is added to the main window via
// `tauri::webview::WebviewBuilder`, positioned with viewport-relative
// LogicalPosition/LogicalSize. The frontend keeps the webview's bounds
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
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, State, Url, WebviewUrl,
};

const BROWSER_LABEL_PREFIX: &str = "cave-browser-";
const OFFSCREEN_X: f64 = -10000.0;
const OFFSCREEN_Y: f64 = -10000.0;
const USER_NAVIGATION_MARKER_TTL: Duration = Duration::from_secs(2);
const MAX_TRACKED_BROWSER_URLS: usize = 64;

mod browser_bounds;
mod browser_commands;
mod browser_events;
mod browser_native;
mod browser_reconciliation;

use browser_bounds::{
    browser_bounds_within_client, offscreen_browser_creation_bounds, BrowserBounds,
};
pub use browser_commands::*;
use browser_events::BrowserEventTracker;
use browser_native::{hide_webview, show_webview_at};
use browser_reconciliation::{
    ensure_browser_controller, event_sequence_for_label_url, event_tracker_for_label,
    schedule_browser_reconcile, schedule_scope_reconcile, BrowserScrollEvent, BrowserTitleEvent,
    EnvironmentCallbackTimeoutAction, EnvironmentCallbackTimeoutRetryState,
};

#[derive(Clone, Debug, PartialEq)]
struct BrowserNavigationIntent {
    sequence: u64,
    url: String,
    read_only_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct BrowserBoundsIntent {
    sequence: u64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BrowserVisibility {
    Visible,
    Hidden,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BrowserVisibilityIntent {
    sequence: u64,
    value: BrowserVisibility,
}

#[derive(Clone, Debug, Default)]
struct BrowserLabelIntent {
    latest_sequence: u64,
    navigation: Option<BrowserNavigationIntent>,
    bounds: Option<BrowserBoundsIntent>,
    visibility: Option<BrowserVisibilityIntent>,
    reload_sequence: Option<u64>,
    applied_navigation_sequence: Option<u64>,
    applied_reload_sequence: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BrowserScopeAction {
    Hide,
    Close,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BrowserScopeBarrier {
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct EffectiveBrowserIntent {
    revision: u64,
    navigation: Option<BrowserNavigationIntent>,
    bounds: Option<BrowserBoundsIntent>,
    visibility: BrowserVisibility,
    reload_sequence: Option<u64>,
    applied_navigation_sequence: Option<u64>,
    applied_reload_sequence: Option<u64>,
}

#[derive(Default)]
struct BrowserLifecycleInner {
    labels: HashMap<String, BrowserLabelIntent>,
    scope_barriers: HashMap<String, BrowserScopeBarrier>,
    worker_locks: HashMap<String, Arc<Mutex<()>>>,
    worker_signals: HashMap<String, Arc<BrowserWorkerSignal>>,
    event_trackers: HashMap<String, Arc<Mutex<BrowserEventTracker>>>,
}

#[derive(Default)]
struct BrowserWorkerSignal {
    running: AtomicBool,
    dirty: AtomicBool,
}

/// Orders native WebView lifecycle intents and rejects commands from an older
/// renderer intent. The lock is never held across a WebView2 call: child
/// creation can synchronously trigger a bounds command, and holding it there
/// deadlocks both commands. Without the sequence guard, passive cleanup from an
/// unmounted BrowserPane can win over a newer navigate/set-bounds and leave an
/// invisible WebView2 input surface above the app.
#[derive(Clone, Default)]
pub struct BrowserLifecycleState(Arc<Mutex<BrowserLifecycleInner>>);

impl BrowserLifecycleState {
    fn lock(&self) -> Result<MutexGuard<'_, BrowserLifecycleInner>, String> {
        self.0
            .lock()
            .map_err(|_| "browser lifecycle lock is poisoned".to_string())
    }
}

fn latest_scope_barrier<'a>(
    inner: &'a BrowserLifecycleInner,
    label: &str,
) -> Option<&'a BrowserScopeBarrier> {
    inner
        .scope_barriers
        .iter()
        .filter(|(prefix, barrier)| {
            label.starts_with(prefix.as_str()) && barrier.except_label.as_deref() != Some(label)
        })
        .map(|(_, barrier)| barrier)
        .max_by_key(|barrier| barrier.sequence)
}

fn command_sequence_is_current(inner: &BrowserLifecycleInner, label: &str, sequence: u64) -> bool {
    if latest_scope_barrier(inner, label).is_some_and(|barrier| sequence < barrier.sequence) {
        return false;
    }
    inner
        .labels
        .get(label)
        .is_none_or(|intent| sequence >= intent.latest_sequence)
}

fn record_navigation_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    sequence: u64,
    url: String,
    read_only_url: Option<String>,
    bounds: BrowserBoundsIntent,
) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    intent.navigation = Some(BrowserNavigationIntent {
        sequence,
        url,
        read_only_url,
    });
    intent.bounds = Some(bounds);
    intent.visibility = Some(BrowserVisibilityIntent {
        sequence,
        value: BrowserVisibility::Visible,
    });
    true
}

fn record_bounds_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    bounds: BrowserBoundsIntent,
) -> bool {
    if !command_sequence_is_current(inner, label, bounds.sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = bounds.sequence;
    intent.bounds = Some(bounds);
    if intent.visibility.map(|value| value.value) == Some(BrowserVisibility::Closed) {
        return false;
    }
    intent.visibility = Some(BrowserVisibilityIntent {
        sequence: bounds.sequence,
        value: BrowserVisibility::Visible,
    });
    true
}

fn record_visibility_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    sequence: u64,
    visibility: BrowserVisibility,
) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    if intent.visibility.map(|value| value.value) != Some(BrowserVisibility::Closed)
        || visibility == BrowserVisibility::Closed
    {
        intent.visibility = Some(BrowserVisibilityIntent {
            sequence,
            value: visibility,
        });
    }
    if visibility == BrowserVisibility::Closed {
        intent.navigation = None;
        intent.reload_sequence = None;
        intent.applied_navigation_sequence = None;
        intent.applied_reload_sequence = None;
    }
    true
}

fn record_reload_intent(inner: &mut BrowserLifecycleInner, label: &str, sequence: u64) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    if intent.visibility.map(|value| value.value) == Some(BrowserVisibility::Closed) {
        return false;
    }
    intent.reload_sequence = Some(sequence);
    true
}

fn effective_browser_intent(
    inner: &BrowserLifecycleInner,
    label: &str,
) -> Option<EffectiveBrowserIntent> {
    let label_intent = inner.labels.get(label)?;
    let mut revision = label_intent.latest_sequence;
    let mut visibility = label_intent.visibility.unwrap_or(BrowserVisibilityIntent {
        sequence: 0,
        value: BrowserVisibility::Hidden,
    });
    if let Some(barrier) = latest_scope_barrier(inner, label) {
        revision = revision.max(barrier.sequence);
        if barrier.sequence > visibility.sequence {
            visibility = BrowserVisibilityIntent {
                sequence: barrier.sequence,
                value: match barrier.action {
                    BrowserScopeAction::Hide => BrowserVisibility::Hidden,
                    BrowserScopeAction::Close => BrowserVisibility::Closed,
                },
            };
        }
    }
    Some(EffectiveBrowserIntent {
        revision,
        navigation: label_intent.navigation.clone(),
        bounds: label_intent.bounds,
        visibility: visibility.value,
        reload_sequence: label_intent.reload_sequence,
        applied_navigation_sequence: label_intent.applied_navigation_sequence,
        applied_reload_sequence: label_intent.applied_reload_sequence,
    })
}

fn advance_scope_barrier(
    inner: &mut BrowserLifecycleInner,
    prefix: &str,
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
) -> bool {
    if inner
        .scope_barriers
        .get(prefix)
        .is_some_and(|barrier| sequence < barrier.sequence)
    {
        return false;
    }
    inner.scope_barriers.insert(
        prefix.to_string(),
        BrowserScopeBarrier {
            sequence,
            action,
            except_label,
        },
    );
    true
}

fn record_scope_intent(
    inner: &mut BrowserLifecycleInner,
    prefix: &str,
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
    existing_labels: impl IntoIterator<Item = String>,
) -> bool {
    if !advance_scope_barrier(inner, prefix, sequence, action, except_label.clone()) {
        return false;
    }

    for label in existing_labels {
        if !label.starts_with(prefix) || except_label.as_deref() == Some(label.as_str()) {
            continue;
        }
        let intent = inner.labels.entry(label).or_default();
        if sequence < intent.latest_sequence {
            continue;
        }
        intent.latest_sequence = sequence;
        intent.visibility = Some(BrowserVisibilityIntent {
            sequence,
            value: match action {
                BrowserScopeAction::Hide => BrowserVisibility::Hidden,
                BrowserScopeAction::Close => BrowserVisibility::Closed,
            },
        });
        if action == BrowserScopeAction::Close {
            intent.navigation = None;
            intent.reload_sequence = None;
            intent.applied_navigation_sequence = None;
            intent.applied_reload_sequence = None;
        }
    }
    true
}

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
