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

#[derive(Debug, Clone, Copy, PartialEq)]
enum BrowserBounds {
    Hidden { w: f64, h: f64 },
    Visible { x: f64, y: f64, w: f64, h: f64 },
}

fn browser_bounds_within_client(
    client_w: f64,
    client_h: f64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<BrowserBounds, String> {
    if !client_w.is_finite()
        || !client_h.is_finite()
        || !x.is_finite()
        || !y.is_finite()
        || !w.is_finite()
        || !h.is_finite()
    {
        return Err("browser bounds must be finite".to_string());
    }

    let client_w = client_w.max(0.0);
    let client_h = client_h.max(0.0);
    let realized_w = w.max(2.0).min(client_w.max(1.0));
    let realized_h = h.max(2.0).min(client_h.max(1.0));
    if client_w <= 1.0 || client_h <= 1.0 || x < 0.0 || y < 0.0 || w <= 1.0 || h <= 1.0 {
        return Ok(BrowserBounds::Hidden {
            w: realized_w,
            h: realized_h,
        });
    }

    if x >= client_w - 1.0 || y >= client_h - 1.0 {
        return Ok(BrowserBounds::Hidden {
            w: realized_w,
            h: realized_h,
        });
    }

    let x = x.max(0.0);
    let y = y.max(0.0);
    let w = w.min(client_w - x);
    let h = h.min(client_h - y);
    if w <= 1.0 || h <= 1.0 {
        return Ok(BrowserBounds::Hidden {
            w: realized_w,
            h: realized_h,
        });
    }
    Ok(BrowserBounds::Visible { x, y, w, h })
}

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

struct PendingUserNavigation {
    sequence: u64,
    target: String,
    allow_query_change: bool,
    started: Instant,
}

#[derive(Default)]
struct BrowserEventTracker {
    pending: Option<(u64, String)>,
    pending_user_navigation: Option<PendingUserNavigation>,
    active_sequence: u64,
    active_url: Option<String>,
    active_completed: bool,
    sequence_by_url: HashMap<String, u64>,
}

impl BrowserEventTracker {
    fn normalized_url(raw: &str) -> String {
        Url::parse(raw)
            .map(|mut url| {
                url.set_fragment(None);
                url.to_string()
            })
            .unwrap_or_else(|_| raw.to_string())
    }

    fn normalized_route(url: &Url) -> String {
        let mut url = url.clone();
        url.set_fragment(None);
        url.set_query(None);
        url.to_string()
    }

    fn expect_navigation(&mut self, sequence: u64, url: &str) {
        let url = Self::normalized_url(url);
        self.pending = Some((sequence, url));
        self.pending_user_navigation = None;
    }

    fn begin_user_navigation(&mut self, target: &Url, allow_query_change: bool) -> u64 {
        // A main-renderer navigation always wins a race with the old child
        // page. Otherwise a click on the page being replaced could consume
        // the newer generated navigation and mislabel its events.
        if self.pending.is_some() {
            return 0;
        }
        let target = Self::normalized_url(target.as_str());
        if let Some(pending) = self.pending_user_navigation.as_ref() {
            if pending.started.elapsed() <= USER_NAVIGATION_MARKER_TTL
                && pending.target == target
                && pending.allow_query_change == allow_query_change
            {
                return pending.sequence;
            }
        }
        let sequence = self.active_sequence.saturating_add(1).max(1);
        self.pending_user_navigation = Some(PendingUserNavigation {
            sequence,
            target,
            allow_query_change,
            started: Instant::now(),
        });
        sequence
    }

    fn remember_sequence(&mut self, normalized: String, sequence: u64) {
        if !self.sequence_by_url.contains_key(&normalized)
            && self.sequence_by_url.len() >= MAX_TRACKED_BROWSER_URLS
        {
            let active = self
                .active_url
                .as_ref()
                .map(|url| (url.clone(), self.active_sequence));
            self.sequence_by_url.clear();
            if let Some((url, sequence)) = active {
                self.sequence_by_url.insert(url, sequence);
            }
        }
        self.sequence_by_url.insert(normalized, sequence);
    }

    fn activate(&mut self, sequence: u64, normalized: String) -> u64 {
        self.active_sequence = sequence;
        self.active_url = Some(normalized.clone());
        self.active_completed = false;
        self.pending = None;
        self.pending_user_navigation = None;
        self.remember_sequence(normalized, sequence);
        sequence
    }

    fn observe_navigation(&mut self, url: &Url) -> u64 {
        let normalized = Self::normalized_url(url.as_str());
        if let Some((sequence, expected)) = self.pending.as_ref() {
            if *expected == normalized {
                let sequence = *sequence;
                return self.activate(sequence, normalized);
            }
        }
        if let Some(pending) = self.pending_user_navigation.take() {
            if pending.started.elapsed() <= USER_NAVIGATION_MARKER_TTL {
                let target_matches = pending.target == normalized
                    || (pending.allow_query_change
                        && Url::parse(&pending.target).is_ok_and(|target| {
                            Self::normalized_route(&target) == Self::normalized_route(url)
                        }));
                if target_matches {
                    return self.activate(pending.sequence, normalized);
                }
                self.pending_user_navigation = Some(pending);
            }
        }
        if let Some(sequence) = self.sequence_by_url.get(&normalized).copied() {
            return sequence;
        }
        if self.pending.is_none() && self.active_sequence != 0 && !self.active_completed {
            self.remember_sequence(normalized, self.active_sequence);
            return self.active_sequence;
        }
        0
    }

    fn sequence_for_event(&mut self, url: &Url, started: bool, finished: bool) -> u64 {
        let normalized = Self::normalized_url(url.as_str());
        // Only a NavigationStarting signal may claim a pending generation or
        // extend its redirect chain. A delayed Finished/title callback from a
        // previous visit to the same URL must remain on its old generation.
        let sequence = if started {
            self.observe_navigation(url)
        } else {
            self.sequence_by_url.get(&normalized).copied().unwrap_or(0)
        };
        if finished && sequence != 0 && sequence == self.active_sequence {
            self.active_completed = true;
        }
        sequence
    }
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

#[derive(Debug, Serialize, Clone)]
struct BrowserTitleEvent {
    label: String,
    title: String,
    url: String,
    sequence: u64,
}

#[derive(Debug, Serialize, Clone)]
struct BrowserPageLoadEvent {
    label: String,
    url: String,
    phase: String,
    sequence: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserScrollEvent {
    label: String,
    scroll_y: f64,
}

fn ensure_browser(
    app: &AppHandle,
    event_tracker: Arc<Mutex<BrowserEventTracker>>,
    label: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    url: &str,
    read_only_url: Option<&str>,
) -> Result<bool, String> {
    if app.webviews().keys().any(|existing| existing == label) {
        return Ok(false);
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let client = main
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let bounds = browser_bounds_within_client(client.width, client.height, x, y, w, h)?;
    let (x, y, w, h, hidden) = match bounds {
        BrowserBounds::Hidden { w, h } => (OFFSCREEN_X, OFFSCREEN_Y, w, h, true),
        BrowserBounds::Visible { x, y, w, h } => (x, y, w, h, false),
    };

    let parsed_url = Url::parse(url).map_err(|e| e.to_string())?;
    let read_only_target = read_only_url.and_then(|raw| Url::parse(raw).ok());
    let initial_load_finished = Arc::new(AtomicBool::new(false));
    let browser_label = label.to_string();
    let app_for_load = app.clone();
    let load_finished_for_event = Arc::clone(&initial_load_finished);
    let tracker_for_load = Arc::clone(&event_tracker);
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .background_color(tauri::webview::Color(12, 12, 14, 255)) // dark bg — no white flash
        .on_page_load(
        move |webview, payload| {
            let sequence = tracker_for_load
                .lock()
                .ok()
                .map(|mut tracker| {
                    tracker.sequence_for_event(
                        payload.url(),
                        matches!(payload.event(), PageLoadEvent::Started),
                        matches!(payload.event(), PageLoadEvent::Finished),
                    )
                })
                .unwrap_or(0);
            let phase = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            let _ = app_for_load.emit(
                "browser:page-load",
                BrowserPageLoadEvent {
                    label: browser_label.clone(),
                    url: payload.url().to_string(),
                    phase: phase.to_string(),
                    sequence,
                },
            );
            if matches!(payload.event(), PageLoadEvent::Finished) {
                load_finished_for_event.store(true, Ordering::SeqCst);
                // Emit title event from Rust so it reaches the main window's
                // event bus. Child webview JS → main window event propagation
                // is unreliable in Tauri v2; Rust-side emit is the safe path.
                let label_json = serde_json::to_string(&browser_label)
                    .unwrap_or_else(|_| "null".to_string());
                let url_str = payload.url().to_string();

                // Read document.title via eval and re-emit from Rust.
                // eval() return value isn't easily captured in the page_load
                // callback, so we inject a tiny script that calls a dedicated
                // Tauri command instead.
                let script = format!(
                    r#"(function(browserLabel) {{
                      try {{
	                        if (!window.__CAVE_BROWSER_INSTALLED__) {{
	                          window.__CAVE_BROWSER_INSTALLED__ = true;
	                          var lastScrollY = -1;
	                          var scrollRaf = 0;
	                          var reportScroll = function() {{
	                            try {{
	                              scrollRaf = 0;
	                              var scrollY = Math.max(
	                                window.scrollY || 0,
	                                document.documentElement ? document.documentElement.scrollTop || 0 : 0,
	                                document.body ? document.body.scrollTop || 0 : 0
	                              );
	                              if (Math.abs(scrollY - lastScrollY) < 8) return;
	                              lastScrollY = scrollY;
	                              if (window.__TAURI_INTERNALS__) {{
	                                window.__TAURI_INTERNALS__.invoke("browser_report_scroll", {{
	                                  scrollY: scrollY
	                                }}).catch(function(){{}});
	                              }}
	                            }} catch (_) {{}}
	                          }};
	                          window.addEventListener("scroll", function() {{
	                            if (!scrollRaf) scrollRaf = window.requestAnimationFrame(reportScroll);
	                          }}, {{ passive: true }});
	                          var reportUserNavigation = function(targetUrl, allowQueryChange) {{
	                            try {{
	                              if (window.__TAURI_INTERNALS__) {{
	                                window.__TAURI_INTERNALS__
	                                  .invoke("browser_report_user_navigation", {{
	                                    targetUrl: targetUrl,
	                                    allowQueryChange: !!allowQueryChange
	                                  }})
	                                  .catch(function(){{}});
	                              }}
	                            }} catch (_) {{}}
	                          }};
	                          // Run at the end of bubbling, after page handlers
	                          // have had a chance to cancel SPA-style clicks.
	                          window.addEventListener("click", function(event) {{
	                            try {{
	                              if (
	                                event.defaultPrevented ||
	                                event.button !== 0 ||
	                                event.metaKey ||
	                                event.ctrlKey ||
	                                event.shiftKey ||
	                                event.altKey
	                              ) return;
	                              var target = event.target;
	                              if (!target || typeof target.closest !== "function") return;
	                              var anchor = target.closest("a[href]");
	                              if (!anchor || anchor.hasAttribute("download")) return;
	                              var targetName = (anchor.getAttribute("target") || "").toLowerCase();
	                              if (
	                                targetName &&
	                                targetName !== "_self" &&
	                                targetName !== "_top" &&
	                                targetName !== "_parent"
	                              ) return;
	                              var destination = new URL(anchor.href, location.href);
	                              if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
	                              var current = new URL(location.href);
	                              if (
	                                destination.href !== current.href &&
	                                destination.origin === current.origin &&
	                                destination.pathname === current.pathname &&
	                                destination.search === current.search
	                              ) return;
	                              reportUserNavigation(destination.href, false);
	                            }} catch (_) {{}}
	                          }}, false);
	                          window.addEventListener("submit", function(event) {{
	                            try {{
	                              if (event.defaultPrevented) return;
	                              var form = event.target;
	                              if (!form || form.tagName !== "FORM") return;
	                              var submitter = event.submitter;
	                              var targetName = (
	                                (submitter && submitter.formTarget) || form.target || ""
	                              ).toLowerCase();
	                              if (
	                                targetName &&
	                                targetName !== "_self" &&
	                                targetName !== "_top" &&
	                                targetName !== "_parent"
	                              ) return;
	                              var method = (
	                                (submitter && submitter.formMethod) || form.method || "get"
	                              ).toLowerCase();
	                              if (method === "dialog") return;
	                              var destination = new URL(
	                                (submitter && submitter.formAction) || form.action || location.href,
	                                location.href
	                              );
	                              if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
	                              reportUserNavigation(destination.href, method === "get");
	                            }} catch (_) {{}}
	                          }}, false);
	                          window.addEventListener("keydown", function(event) {{
	                            try {{
	                              if ((event.metaKey || event.ctrlKey) && event.key && event.key.toLowerCase() === "t") {{
                                event.preventDefault();
                                event.stopPropagation();
                                if (window.__TAURI_INTERNALS__) {{
                                  window.__TAURI_INTERNALS__.invoke("browser_report_title", {{
                                    title: document.title || location.hostname || location.href
                                  }}).catch(function(){{}});
                                }}
                              }}
	                            }} catch (_) {{}}
	                          }}, true);
	                        }}
	                        try {{ reportScroll(); }} catch (_) {{}}
	                        // Report title immediately on load
                        if (window.__TAURI_INTERNALS__) {{
                          var pageTitle = document.title || location.hostname || location.href;
                          window.__TAURI_INTERNALS__.invoke("browser_report_title", {{
                            title: pageTitle
                          }}).catch(function(){{}});
                        }}
                      }} catch (_) {{}}
                    }})({})"#,
                    label_json
                );
                let _ = webview.eval(&script);
                // Also emit page URL as a title fallback immediately from Rust
                // so the tab rail updates even if the invoke path is delayed.
                let title_fallback = {
                    match Url::parse(&url_str) {
                        Ok(u) => u.host_str().unwrap_or(&url_str).to_string(),
                        Err(_) => url_str.clone(),
                    }
                };
                let _ = app_for_load.emit(
                    "browser:title",
                    BrowserTitleEvent {
                        label: browser_label.clone(),
                        title: title_fallback,
                        url: url_str,
                        sequence,
                    },
                );
            }
        },
    );

    let target_without_fragment = read_only_target.as_ref().map(url_without_fragment);
    let load_finished_for_navigation = Arc::clone(&initial_load_finished);
    let tracker_for_navigation = Arc::clone(&event_tracker);
    let builder = builder.on_navigation(move |next_url| {
        if let Ok(mut tracker) = tracker_for_navigation.lock() {
            tracker.observe_navigation(next_url);
        }
        let Some(target_without_fragment) = target_without_fragment.as_ref() else {
            return true;
        };
        if !load_finished_for_navigation.load(Ordering::SeqCst) {
            return true;
        }
        url_without_fragment(next_url) == target_without_fragment.as_str()
    });

    main.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;

    if hidden {
        if let Some(webview) = app.get_webview(label) {
            hide_webview(&webview)?;
        }
    }

    Ok(true)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserLifecycleErrorEvent {
    label: String,
    error: String,
}

// Park the webview offscreen at its CURRENT size. Do not shrink it to 1×1:
// collapsing the layer lets WKWebView drop its backing surface, and a later
// browser_set_bounds re-seat can land as an unpainted (black) layer. Keeping
// the real size while offscreen keeps the layer realized so it repaints
// immediately when shown again.
fn hide_webview(webview: &tauri::Webview) -> Result<(), String> {
    // Offscreen parking is not a visibility guarantee on Windows: WebView2
    // can retain a stale native input surface and invisibly capture Cave
    // clicks. Hide the child layer through the platform API instead.
    #[cfg(target_os = "windows")]
    webview.hide().map_err(|e| e.to_string())?;

    // WKWebView may drop its backing surface when hidden, so other platforms
    // retain the realized layer at its current size and move it offscreen.
    #[cfg(not(target_os = "windows"))]
    webview
        .set_position(LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn show_webview_at(webview: &tauri::Webview, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    // Clamp to the main client area and apply position+size atomically. Two
    // dispatcher calls briefly expose an old-size/new-position WebView2 layer
    // during resize, which can cover unrelated UI and capture its clicks.
    let window = webview.window();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let client = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let bounds = match browser_bounds_within_client(client.width, client.height, x, y, w, h) {
        Ok(bounds) => bounds,
        Err(error) => {
            hide_webview(webview)?;
            return Err(error);
        }
    };
    let BrowserBounds::Visible { x, y, w, h } = bounds else {
        return hide_webview(webview);
    };
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(w, h).into(),
        })
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    webview.show().map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_browser_controller(caller: &tauri::Webview) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("native browser controls are restricted to the main webview".to_string());
    }
    Ok(())
}

fn worker_lock_for_label(
    state: &BrowserLifecycleState,
    label: &str,
) -> Result<Arc<Mutex<()>>, String> {
    let mut inner = state.lock()?;
    Ok(Arc::clone(
        inner
            .worker_locks
            .entry(label.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(()))),
    ))
}

fn worker_signal_for_label(
    state: &BrowserLifecycleState,
    label: &str,
) -> Result<Arc<BrowserWorkerSignal>, String> {
    let mut inner = state.lock()?;
    Ok(Arc::clone(
        inner
            .worker_signals
            .entry(label.to_string())
            .or_insert_with(|| Arc::new(BrowserWorkerSignal::default())),
    ))
}

fn event_tracker_for_label(
    state: &BrowserLifecycleState,
    label: &str,
) -> Result<Arc<Mutex<BrowserEventTracker>>, String> {
    let mut inner = state.lock()?;
    Ok(Arc::clone(
        inner
            .event_trackers
            .entry(label.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(BrowserEventTracker::default()))),
    ))
}

fn event_sequence_for_label_url(state: &BrowserLifecycleState, label: &str, url: &Url) -> u64 {
    event_tracker_for_label(state, label)
        .ok()
        .and_then(|tracker| {
            tracker
                .lock()
                .ok()
                .map(|mut tracker| tracker.sequence_for_event(url, false, false))
        })
        .unwrap_or(0)
}

fn navigation_is_current(state: &BrowserLifecycleState, label: &str, sequence: u64) -> bool {
    let Ok(inner) = state.lock() else {
        return false;
    };
    effective_browser_intent(&inner, label).is_some_and(|intent| {
        intent.visibility != BrowserVisibility::Closed
            && intent
                .navigation
                .as_ref()
                .map(|navigation| navigation.sequence)
                == Some(sequence)
    })
}

fn mark_navigation_applied(
    state: &BrowserLifecycleState,
    label: &str,
    sequence: u64,
) -> Result<(), String> {
    let mut inner = state.lock()?;
    if inner
        .labels
        .get(label)
        .and_then(|intent| intent.navigation.as_ref())
        .map(|navigation| navigation.sequence)
        == Some(sequence)
    {
        if let Some(intent) = inner.labels.get_mut(label) {
            intent.applied_navigation_sequence = Some(sequence);
        }
    }
    Ok(())
}

fn mark_reload_applied(
    state: &BrowserLifecycleState,
    label: &str,
    sequence: u64,
) -> Result<(), String> {
    let mut inner = state.lock()?;
    if inner
        .labels
        .get(label)
        .and_then(|intent| intent.reload_sequence)
        == Some(sequence)
    {
        if let Some(intent) = inner.labels.get_mut(label) {
            intent.applied_reload_sequence = Some(sequence);
        }
    }
    Ok(())
}

fn clear_applied_browser_state(state: &BrowserLifecycleState, label: &str) -> Result<(), String> {
    let mut inner = state.lock()?;
    if let Some(intent) = inner.labels.get_mut(label) {
        intent.applied_navigation_sequence = None;
        intent.applied_reload_sequence = None;
    }
    Ok(())
}

fn navigate_webview(webview: &tauri::Webview, url: &str) -> Result<(), String> {
    let parsed_url = Url::parse(url).map_err(|e| e.to_string())?;
    // Belt-and-suspenders: webview.navigate() can no-op on already-loaded
    // child webviews in some Tauri 2 builds. Fall back to eval-based nav if
    // navigate returns an error.
    if webview.navigate(parsed_url.clone()).is_err() {
        let escaped = parsed_url.to_string().replace('"', "%22");
        webview
            .eval(format!("window.location.href = \"{}\";", escaped))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Apply the newest complete per-label intent under a worker-only lock. Tauri
/// commands never wait on this mutex on the WebView dispatcher, so WebView2
/// creation may safely trigger re-entrant bounds IPC. A worker loops when an
/// intent changes during a native side effect, guaranteeing the final URL,
/// bounds, and visibility converge to the newest command.
fn reconcile_browser(
    app: &AppHandle,
    state: &BrowserLifecycleState,
    label: &str,
) -> Result<(), String> {
    let worker_lock = worker_lock_for_label(state, label)?;
    let _worker = worker_lock
        .lock()
        .map_err(|_| "browser worker lock is poisoned".to_string())?;

    for _ in 0..16 {
        let snapshot = {
            let inner = state.lock()?;
            effective_browser_intent(&inner, label)
        };
        let Some(snapshot) = snapshot else {
            return Ok(());
        };

        if snapshot.visibility == BrowserVisibility::Closed {
            if let Some(webview) = app.get_webview(label) {
                let _ = hide_webview(&webview);
                webview.close().map_err(|e| e.to_string())?;
            }
            clear_applied_browser_state(state, label)?;
        } else if let Some(navigation) = snapshot.navigation.as_ref() {
            let bounds = snapshot.bounds.ok_or_else(|| {
                "browser navigation is missing a bounded viewport intent".to_string()
            })?;
            let (initial_x, initial_y) = if snapshot.visibility == BrowserVisibility::Visible {
                (bounds.x, bounds.y)
            } else {
                (OFFSCREEN_X, OFFSCREEN_Y)
            };

            // Coalesce commands that arrived before the expensive create call.
            if !navigation_is_current(state, label, navigation.sequence) {
                continue;
            }
            let event_tracker = event_tracker_for_label(state, label)?;
            if app.get_webview(label).is_none()
                || snapshot.applied_navigation_sequence != Some(navigation.sequence)
            {
                event_tracker
                    .lock()
                    .map_err(|_| "browser event tracker lock is poisoned".to_string())?
                    .expect_navigation(navigation.sequence, &navigation.url);
            }
            let created = ensure_browser(
                app,
                Arc::clone(&event_tracker),
                label,
                initial_x,
                initial_y,
                bounds.w,
                bounds.h,
                &navigation.url,
                navigation.read_only_url.as_deref(),
            )?;
            let webview = app
                .get_webview(label)
                .ok_or_else(|| "browser webview missing after creation".to_string())?;

            if created {
                mark_navigation_applied(state, label, navigation.sequence)?;
            } else if snapshot.applied_navigation_sequence != Some(navigation.sequence) {
                if !navigation_is_current(state, label, navigation.sequence) {
                    continue;
                }
                navigate_webview(&webview, &navigation.url)?;
                mark_navigation_applied(state, label, navigation.sequence)?;
            }

            // A hide/close may have arrived while creation or navigation was
            // inside WebView2. Re-read before exposing the native input layer.
            let latest = {
                let inner = state.lock()?;
                effective_browser_intent(&inner, label)
            };
            if latest.as_ref().map(|intent| intent.revision) != Some(snapshot.revision) {
                continue;
            }
            match snapshot.visibility {
                BrowserVisibility::Visible => {
                    show_webview_at(&webview, bounds.x, bounds.y, bounds.w, bounds.h)?
                }
                BrowserVisibility::Hidden => hide_webview(&webview)?,
                BrowserVisibility::Closed => unreachable!(),
            }

            if let Some(reload_sequence) = snapshot.reload_sequence {
                if snapshot.applied_reload_sequence != Some(reload_sequence) {
                    webview.reload().map_err(|e| e.to_string())?;
                    mark_reload_applied(state, label, reload_sequence)?;
                }
            }
        } else if let Some(webview) = app.get_webview(label) {
            match snapshot.visibility {
                BrowserVisibility::Visible => {
                    if let Some(bounds) = snapshot.bounds {
                        show_webview_at(&webview, bounds.x, bounds.y, bounds.w, bounds.h)?;
                    }
                }
                BrowserVisibility::Hidden => hide_webview(&webview)?,
                BrowserVisibility::Closed => unreachable!(),
            }
        }

        let settled_revision = {
            let inner = state.lock()?;
            effective_browser_intent(&inner, label).map(|intent| intent.revision)
        };
        if settled_revision == Some(snapshot.revision) {
            return Ok(());
        }
    }
    Err("browser lifecycle did not settle after 16 intent revisions".to_string())
}

fn schedule_browser_reconcile(app: AppHandle, state: BrowserLifecycleState, label: String) {
    let signal = match worker_signal_for_label(&state, &label) {
        Ok(signal) => signal,
        Err(error) => {
            log::warn!("browser lifecycle scheduling failed for {label}: {error}");
            return;
        }
    };
    signal.dirty.store(true, Ordering::SeqCst);
    if signal.running.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || loop {
        signal.dirty.store(false, Ordering::SeqCst);
        if let Err(error) = reconcile_browser(&app, &state, &label) {
            log::warn!("browser lifecycle reconciliation failed for {label}: {error}");
            let _ = app.emit(
                "browser:lifecycle-error",
                BrowserLifecycleErrorEvent {
                    label: label.clone(),
                    error,
                },
            );
        }
        if signal.dirty.swap(false, Ordering::SeqCst) {
            continue;
        }
        signal.running.store(false, Ordering::SeqCst);
        if signal.dirty.swap(false, Ordering::SeqCst)
            && !signal.running.swap(true, Ordering::SeqCst)
        {
            continue;
        }
        break;
    });
}

fn schedule_scope_reconcile(
    app: AppHandle,
    state: BrowserLifecycleState,
    prefix: String,
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
) -> Result<(), String> {
    let mut labels = app
        .webviews()
        .into_keys()
        .filter(|label| {
            label.starts_with(&prefix) && except_label.as_deref() != Some(label.as_str())
        })
        .collect::<Vec<_>>();
    {
        let inner = state.lock()?;
        labels.extend(
            inner
                .labels
                .keys()
                .filter(|label| {
                    label.starts_with(&prefix) && except_label.as_deref() != Some(label.as_str())
                })
                .cloned(),
        );
    }
    labels.sort();
    labels.dedup();
    {
        let mut inner = state.lock()?;
        if !record_scope_intent(
            &mut inner,
            &prefix,
            sequence,
            action,
            except_label,
            labels.clone(),
        ) {
            return Ok(());
        }
    }
    for label in labels {
        schedule_browser_reconcile(app.clone(), state.clone(), label);
    }
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    read_only_url: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let label = safe_browser_label(label);
    Url::parse(&url).map_err(|e| e.to_string())?;
    if let Some(read_only_url) = read_only_url.as_deref() {
        Url::parse(read_only_url).map_err(|e| e.to_string())?;
    }
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() {
        return Err("browser bounds must be finite".to_string());
    }
    let lifecycle = lifecycle.inner().clone();
    let bounds = BrowserBoundsIntent {
        sequence,
        x,
        y,
        w,
        h,
    };
    {
        let mut inner = lifecycle.lock()?;
        if !record_navigation_intent(&mut inner, &label, sequence, url, read_only_url, bounds) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, label);
    Ok(())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() {
        return Err("browser bounds must be finite".to_string());
    }
    let label = safe_browser_label(label);
    let lifecycle = lifecycle.inner().clone();
    let bounds = BrowserBoundsIntent {
        sequence,
        x,
        y,
        w,
        h,
    };
    {
        let mut inner = lifecycle.lock()?;
        if !record_bounds_intent(&mut inner, &label, bounds) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, label);
    Ok(())
}

#[tauri::command]
pub fn browser_hide(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let label = safe_browser_label(label);
    let lifecycle = lifecycle.inner().clone();
    {
        let mut inner = lifecycle.lock()?;
        if !record_visibility_intent(&mut inner, &label, sequence, BrowserVisibility::Hidden) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, label);
    Ok(())
}

#[tauri::command]
pub fn browser_hide_all_except(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let keep = label.map(|raw| safe_browser_label(Some(raw)));
    schedule_scope_reconcile(
        app,
        lifecycle.inner().clone(),
        BROWSER_LABEL_PREFIX.to_string(),
        sequence,
        BrowserScopeAction::Hide,
        keep,
    )
}

#[tauri::command]
pub fn browser_close(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let label = safe_browser_label(label);
    let lifecycle = lifecycle.inner().clone();
    {
        let mut inner = lifecycle.lock()?;
        if !record_visibility_intent(&mut inner, &label, sequence, BrowserVisibility::Closed) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, label);
    Ok(())
}

fn pane_prefix(label: Option<String>) -> String {
    match label {
        Some(raw) => format!("{}-tab-", safe_browser_label(Some(raw))),
        None => BROWSER_LABEL_PREFIX.to_string(),
    }
}

/// Hide every native browser WebView belonging to a pane without destroying
/// it. Surface changes use this command so WebView2 cannot capture clicks over
/// another surface, while a rapid return can safely show the same live child
/// instead of racing Tauri's asynchronous close/removal from the registry.
#[tauri::command]
pub fn browser_deactivate_all(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let prefix = pane_prefix(label);
    schedule_scope_reconcile(
        app,
        lifecycle.inner().clone(),
        prefix,
        sequence,
        BrowserScopeAction::Hide,
        None,
    )
}

/// Destroy every native browser WebView belonging to a pane (labels look like
/// `cave-browser-<pane>-tab-<id>`), or every cave-browser WebView when no pane
/// label is given. Ordinary surface changes use browser_deactivate_all; this
/// command is reserved for lifecycle points that truly require destruction.
#[tauri::command]
pub fn browser_close_all(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let prefix = pane_prefix(label);
    schedule_scope_reconcile(
        app,
        lifecycle.inner().clone(),
        prefix,
        sequence,
        BrowserScopeAction::Close,
        None,
    )
}

#[tauri::command]
pub fn browser_reload(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    label: Option<String>,
    sequence: u64,
) -> Result<(), String> {
    ensure_browser_controller(&caller)?;
    let label = safe_browser_label(label);
    let lifecycle = lifecycle.inner().clone();
    {
        let mut inner = lifecycle.lock()?;
        if !record_reload_intent(&mut inner, &label, sequence) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, label);
    Ok(())
}

/// Marks the next child-initiated navigation with a generation newer than the
/// page currently displayed. This is only an attribution hint; the command
/// grants no navigation or lifecycle authority to the untrusted child page.
#[tauri::command]
pub fn browser_report_user_navigation(
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    target_url: String,
    allow_query_change: bool,
) -> Result<u64, String> {
    let label = caller.label().to_string();
    if !label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser navigation reports require a browser child webview".to_string());
    }
    if target_url.len() > 4096 {
        return Err("browser navigation target is too long".to_string());
    }
    let target = Url::parse(&target_url).map_err(|_| "invalid browser navigation target")?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("browser navigation target must use http or https".to_string());
    }
    let tracker = event_tracker_for_label(lifecycle.inner(), &label)?;
    let mut tracker = tracker
        .lock()
        .map_err(|_| "browser event tracker lock poisoned".to_string())?;
    Ok(tracker.begin_user_navigation(&target, allow_query_change))
}

/// Called by the injected script inside a child browser webview so the real
/// document.title can be emitted as a `browser:title` event on the main
/// app event bus (where the BrowserPane JS component can receive it).
/// This avoids the cross-webview event delivery problem in Tauri v2.
#[tauri::command]
pub fn browser_report_title(
    app: AppHandle,
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    title: String,
) -> Result<(), String> {
    let label = caller.label().to_string();
    if !label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser title reports require a browser child webview".to_string());
    }
    let url = caller.url().map_err(|error| error.to_string())?;
    let sequence = event_sequence_for_label_url(lifecycle.inner(), &label, &url);
    let url = url.to_string();
    let title = title.chars().take(512).collect::<String>();
    let _ = app.emit(
        "browser:title",
        BrowserTitleEvent {
            label,
            title,
            url,
            sequence,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn browser_report_scroll(
    app: AppHandle,
    caller: tauri::Webview,
    scroll_y: f64,
) -> Result<(), String> {
    let label = caller.label().to_string();
    if !label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser scroll reports require a browser child webview".to_string());
    }
    if !scroll_y.is_finite() {
        return Err("browser scroll position must be finite".to_string());
    }
    let _ = app.emit(
        "browser:scroll",
        BrowserScrollEvent {
            label,
            scroll_y: scroll_y.clamp(0.0, 1_000_000_000.0),
        },
    );
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::{
        advance_scope_barrier, browser_bounds_within_client, effective_browser_intent,
        record_bounds_intent, record_navigation_intent, record_scope_intent,
        record_visibility_intent, BrowserBounds, BrowserBoundsIntent, BrowserEventTracker,
        BrowserLifecycleInner, BrowserScopeAction, BrowserVisibility, Url,
        MAX_TRACKED_BROWSER_URLS, USER_NAVIGATION_MARKER_TTL,
    };
    use std::time::{Duration, Instant};

    const LABEL: &str = "cave-browser-main-tab-home";

    fn bounds(sequence: u64) -> BrowserBoundsIntent {
        BrowserBoundsIntent {
            sequence,
            x: 100.0,
            y: 50.0,
            w: 800.0,
            h: 600.0,
        }
    }

    fn navigate(lifecycle: &mut BrowserLifecycleInner, sequence: u64, url: &str) -> bool {
        record_navigation_intent(
            lifecycle,
            LABEL,
            sequence,
            url.to_string(),
            None,
            bounds(sequence),
        )
    }

    #[test]
    fn newest_navigation_wins_even_when_workers_would_finish_out_of_order() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
        assert!(navigate(
            &mut lifecycle,
            22,
            "https://github.com/OpenCoven/coven-cave",
        ));
        assert!(!navigate(&mut lifecycle, 21, "https://pod.opencoven.ai"));

        let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
        assert_eq!(
            effective.navigation.expect("navigation").url,
            "https://github.com/OpenCoven/coven-cave",
        );
        assert_eq!(effective.visibility, BrowserVisibility::Visible);
    }

    #[test]
    fn navigate_then_hide_keeps_loading_intent_but_never_exposes_input_layer() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
        assert!(record_visibility_intent(
            &mut lifecycle,
            LABEL,
            21,
            BrowserVisibility::Hidden,
        ));

        let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
        assert_eq!(effective.visibility, BrowserVisibility::Hidden);
        assert_eq!(
            effective
                .navigation
                .expect("hidden navigation retained")
                .url,
            "https://docs.opencoven.ai",
        );
    }

    #[test]
    fn close_during_creation_cannot_be_resurrected_by_late_bounds() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
        assert!(record_visibility_intent(
            &mut lifecycle,
            LABEL,
            21,
            BrowserVisibility::Closed,
        ));
        assert!(!record_bounds_intent(&mut lifecycle, LABEL, bounds(22)));

        let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
        assert_eq!(effective.visibility, BrowserVisibility::Closed);
        assert!(effective.navigation.is_none());
    }

    #[test]
    fn pane_barrier_rejects_late_worker_and_allows_new_navigation() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
        assert!(advance_scope_barrier(
            &mut lifecycle,
            "cave-browser-main-tab-",
            40,
            BrowserScopeAction::Hide,
            None,
        ));
        assert!(!navigate(&mut lifecycle, 39, "https://pod.opencoven.ai",));
        assert_eq!(
            effective_browser_intent(&lifecycle, LABEL)
                .expect("hidden effective intent")
                .visibility,
            BrowserVisibility::Hidden,
        );
        assert!(navigate(
            &mut lifecycle,
            41,
            "https://github.com/OpenCoven/coven-cave",
        ));
        assert_eq!(
            effective_browser_intent(&lifecycle, LABEL)
                .expect("reactivated effective intent")
                .visibility,
            BrowserVisibility::Visible,
        );
    }

    #[test]
    fn delayed_scope_hide_cannot_override_newer_visible_label_intent() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(
            &mut lifecycle,
            101,
            "https://github.com/OpenCoven/coven-cave",
        ));
        assert!(record_scope_intent(
            &mut lifecycle,
            "cave-browser-main-tab-",
            100,
            BrowserScopeAction::Hide,
            None,
            [LABEL.to_string()],
        ));
        assert_eq!(
            effective_browser_intent(&lifecycle, LABEL)
                .expect("effective intent")
                .visibility,
            BrowserVisibility::Visible,
        );
    }

    #[test]
    fn close_all_requires_a_new_navigation_before_bounds_can_reopen() {
        let mut lifecycle = BrowserLifecycleInner::default();
        assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
        assert!(record_scope_intent(
            &mut lifecycle,
            "cave-browser-main-tab-",
            21,
            BrowserScopeAction::Close,
            None,
            [LABEL.to_string()],
        ));
        assert!(!record_bounds_intent(&mut lifecycle, LABEL, bounds(22)));
        let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
        assert_eq!(effective.visibility, BrowserVisibility::Closed);
        assert!(effective.navigation.is_none());
        assert!(navigate(
            &mut lifecycle,
            23,
            "https://github.com/OpenCoven/coven-cave",
        ));
        assert_eq!(
            effective_browser_intent(&lifecycle, LABEL)
                .expect("reopened intent")
                .visibility,
            BrowserVisibility::Visible,
        );
    }

    #[test]
    fn native_event_generations_distinguish_old_completion_from_new_redirect() {
        let mut tracker = BrowserEventTracker::default();
        let docs = Url::parse("https://docs.opencoven.ai").expect("docs URL");
        let github = Url::parse("https://github.com/OpenCoven/coven-cave").expect("github URL");
        tracker.expect_navigation(20, docs.as_str());
        assert_eq!(tracker.observe_navigation(&docs), 20);
        tracker.expect_navigation(21, github.as_str());
        assert_eq!(
            tracker.sequence_for_event(&docs, false, true),
            20,
            "old finish keeps its old generation"
        );
        assert_eq!(tracker.observe_navigation(&github), 21);

        let invite = Url::parse("https://discord.gg/opencoven").expect("invite URL");
        let redirect = Url::parse("https://discord.com/invite/opencoven").expect("redirect URL");
        tracker.expect_navigation(22, invite.as_str());
        assert_eq!(tracker.observe_navigation(&invite), 22);
        assert_eq!(tracker.observe_navigation(&redirect), 22);
        assert_eq!(tracker.sequence_for_event(&redirect, false, true), 22);

        let late_redirect =
            Url::parse("https://docs.opencoven.ai/late-redirect").expect("late redirect URL");
        assert_eq!(
            tracker.observe_navigation(&late_redirect),
            0,
            "an unknown redirect after the newest finish is not stamped as newest"
        );
        assert_eq!(tracker.sequence_for_event(&late_redirect, true, false), 0);
        assert_eq!(tracker.sequence_for_event(&late_redirect, false, true), 0);

        let user_target = Url::parse("https://discord.com/channels/@me").expect("user target URL");
        assert_eq!(tracker.begin_user_navigation(&user_target, false), 23);
        assert_eq!(tracker.observe_navigation(&user_target), 23);
        assert_eq!(tracker.sequence_for_event(&user_target, false, true), 23);

        tracker.expect_navigation(30, docs.as_str());
        assert_eq!(
            tracker.begin_user_navigation(&user_target, false),
            0,
            "a child report cannot supersede a pending main-renderer navigation"
        );
        assert_eq!(tracker.observe_navigation(&docs), 30);
    }

    #[test]
    fn revisited_url_does_not_claim_pending_generation_until_navigation_starts() {
        let mut tracker = BrowserEventTracker::default();
        let first = Url::parse("https://docs.opencoven.ai").expect("first URL");
        let second = Url::parse("https://github.com/OpenCoven/coven-cave").expect("second URL");

        tracker.expect_navigation(20, first.as_str());
        assert_eq!(tracker.observe_navigation(&first), 20);
        assert_eq!(tracker.sequence_for_event(&first, false, true), 20);
        tracker.expect_navigation(21, second.as_str());
        assert_eq!(tracker.observe_navigation(&second), 21);
        assert_eq!(tracker.sequence_for_event(&second, false, true), 21);

        tracker.expect_navigation(22, first.as_str());
        assert_eq!(
            tracker.sequence_for_event(&first, false, false),
            20,
            "a delayed old title keeps the first visit's generation"
        );
        assert_eq!(
            tracker.sequence_for_event(&first, false, true),
            20,
            "a delayed old finish cannot activate the pending revisit"
        );
        assert_eq!(tracker.pending.as_ref().map(|pending| pending.0), Some(22));
        assert_eq!(tracker.sequence_for_event(&first, true, false), 22);
        assert_eq!(tracker.sequence_for_event(&first, false, true), 22);
    }

    #[test]
    fn user_marker_is_destination_bound_expires_and_url_history_is_bounded() {
        let mut tracker = BrowserEventTracker::default();
        let current = Url::parse("https://docs.opencoven.ai").expect("current URL");
        let target = Url::parse("https://docs.opencoven.ai/search?q=coven").expect("target URL");
        let unrelated = Url::parse("https://pod.opencoven.ai/late").expect("unrelated URL");
        tracker.expect_navigation(40, current.as_str());
        assert_eq!(tracker.observe_navigation(&current), 40);
        assert_eq!(tracker.sequence_for_event(&current, false, true), 40);

        assert_eq!(tracker.begin_user_navigation(&target, false), 41);
        assert_eq!(
            tracker.observe_navigation(&unrelated),
            0,
            "an unrelated late redirect cannot consume a destination-bound marker"
        );
        assert_eq!(tracker.observe_navigation(&target), 41);
        assert_eq!(tracker.sequence_for_event(&target, false, true), 41);

        assert_eq!(tracker.begin_user_navigation(&unrelated, false), 42);
        tracker
            .pending_user_navigation
            .as_mut()
            .expect("pending user marker")
            .started = Instant::now() - USER_NAVIGATION_MARKER_TTL - Duration::from_millis(1);
        let expired_target = unrelated.clone();
        assert_eq!(tracker.observe_navigation(&expired_target), 0);

        for index in 0..(MAX_TRACKED_BROWSER_URLS * 3) {
            tracker.remember_sequence(format!("https://example.com/{index}"), 41);
        }
        assert!(tracker.sequence_by_url.len() <= MAX_TRACKED_BROWSER_URLS);
        assert_eq!(
            tracker
                .sequence_by_url
                .get(&BrowserEventTracker::normalized_url(target.as_str())),
            Some(&41),
            "pruning retains the active URL generation"
        );
    }

    #[test]
    fn browser_bounds_are_finite_and_contained_in_the_client() {
        assert_eq!(
            browser_bounds_within_client(1000.0, 700.0, 100.0, 50.0, 5000.0, 5000.0),
            Ok(BrowserBounds::Visible {
                x: 100.0,
                y: 50.0,
                w: 900.0,
                h: 650.0,
            }),
        );
        assert!(browser_bounds_within_client(1000.0, 700.0, f64::NAN, 0.0, 100.0, 100.0,).is_err());
        assert!(
            browser_bounds_within_client(f64::INFINITY, 700.0, 0.0, 0.0, 100.0, 100.0,).is_err()
        );
    }

    #[test]
    fn offscreen_collapsed_and_edge_bounds_fail_closed() {
        assert_eq!(
            browser_bounds_within_client(1000.0, 700.0, -10000.0, -10000.0, 500.0, 400.0),
            Ok(BrowserBounds::Hidden { w: 500.0, h: 400.0 }),
        );
        assert!(matches!(
            browser_bounds_within_client(1000.0, 700.0, 0.0, 0.0, 1.0, 400.0),
            Ok(BrowserBounds::Hidden { .. })
        ));
        for x in [999.0, 1000.0, 1200.0] {
            assert!(matches!(
                browser_bounds_within_client(1000.0, 700.0, x, 10.0, 100.0, 100.0),
                Ok(BrowserBounds::Hidden { .. })
            ));
        }
    }
}
