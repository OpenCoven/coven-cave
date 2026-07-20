use super::*;

#[derive(Debug, Serialize, Clone)]
pub(super) struct BrowserTitleEvent {
    pub(super) label: String,
    pub(super) title: String,
    pub(super) url: String,
    pub(super) sequence: u64,
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
pub(super) struct BrowserScrollEvent {
    pub(super) label: String,
    pub(super) scroll_y: f64,
}

#[derive(Debug)]
enum EnsureBrowserError {
    WebView2EnvironmentCallbackTimedOut,
    Other(String),
}

impl From<String> for EnsureBrowserError {
    fn from(error: String) -> Self {
        Self::Other(error)
    }
}

impl std::fmt::Display for EnsureBrowserError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WebView2EnvironmentCallbackTimedOut => {
                formatter.write_str("main WebView2 environment callback timed out")
            }
            Self::Other(error) => formatter.write_str(error),
        }
    }
}

fn ensure_browser(
    app: &AppHandle,
    event_tracker: Arc<Mutex<BrowserEventTracker>>,
    label: &str,
    w: f64,
    h: f64,
    url: &str,
    read_only_url: Option<&str>,
) -> Result<bool, EnsureBrowserError> {
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
    let (w, h) = offscreen_browser_creation_bounds(client.width, client.height, w, h)?;

    let parsed_url = Url::parse(url).map_err(|e| e.to_string())?;
    let read_only_target = read_only_url.and_then(|raw| Url::parse(raw).ok());
    let initial_load_finished = Arc::new(AtomicBool::new(false));
    let browser_label = label.to_string();
    let app_for_load = app.clone();
    let load_finished_for_event = Arc::clone(&initial_load_finished);
    let tracker_for_load = Arc::clone(&event_tracker);
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        // Tauri defaults child WebViews to focused. A cold tab would therefore
        // call WebView2 MoveFocus while it was still offscreen, stealing the
        // main renderer's input focus immediately after a Cave control click.
        // Let an actual click inside the visible child focus it instead.
        .focused(false)
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

    // A fresh Windows environment performs another blocking
    // CreateCoreWebView2EnvironmentWithOptions wait inside WRY's nested message
    // pump. Reuse the already-running main environment so child creation only
    // needs a controller and cannot conflict with the main profile/options.
    #[cfg(target_os = "windows")]
    let builder = with_main_webview2_environment(app, builder)?;

    main.add_child(
        builder,
        LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y),
        LogicalSize::new(w, h),
    )
    .map_err(|e| e.to_string())?;

    if let Some(webview) = app.get_webview(label) {
        hide_webview(&webview)?;
    }

    Ok(true)
}

#[cfg(target_os = "windows")]
fn with_main_webview2_environment<R: tauri::Runtime>(
    app: &AppHandle<R>,
    builder: WebviewBuilder<R>,
) -> Result<WebviewBuilder<R>, EnsureBrowserError> {
    let main = app
        .get_webview("main")
        .ok_or_else(|| "main webview missing".to_string())?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    main.with_webview(move |platform| {
        let _ = sender.send(builder.with_environment(platform.environment()));
    })
    .map_err(|error| error.to_string())?;
    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(builder) => Ok(builder),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            Err(EnsureBrowserError::WebView2EnvironmentCallbackTimedOut)
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(EnsureBrowserError::Other(
            "main WebView2 environment callback disconnected".to_string(),
        )),
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserLifecycleErrorEvent {
    label: String,
    error: String,
}

#[derive(Debug)]
enum BrowserReconcileError {
    WebView2EnvironmentCallbackTimedOut { revision: u64 },
    Other(String),
}

impl BrowserReconcileError {
    fn environment_callback_timeout_revision(&self) -> Option<u64> {
        match self {
            Self::WebView2EnvironmentCallbackTimedOut { revision } => Some(*revision),
            Self::Other(_) => None,
        }
    }
}

impl From<String> for BrowserReconcileError {
    fn from(error: String) -> Self {
        Self::Other(error)
    }
}

impl std::fmt::Display for BrowserReconcileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WebView2EnvironmentCallbackTimedOut { .. } => {
                formatter.write_str("main WebView2 environment callback timed out")
            }
            Self::Other(error) => formatter.write_str(error),
        }
    }
}

const WEBVIEW2_ENVIRONMENT_CALLBACK_RETRY_LIMIT: u8 = 1;

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct EnvironmentCallbackTimeoutRetryState {
    revision: Option<u64>,
    retries_used: u8,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum EnvironmentCallbackTimeoutAction {
    ReconcileNewestIntent,
    RetryTimedOutIntent,
    Stop,
}

impl EnvironmentCallbackTimeoutRetryState {
    pub(super) fn action(
        &mut self,
        timed_out_revision: u64,
        newer_intent_pending: bool,
    ) -> EnvironmentCallbackTimeoutAction {
        if newer_intent_pending {
            return EnvironmentCallbackTimeoutAction::ReconcileNewestIntent;
        }
        if self.revision != Some(timed_out_revision) {
            self.revision = Some(timed_out_revision);
            self.retries_used = 0;
        }
        if self.retries_used < WEBVIEW2_ENVIRONMENT_CALLBACK_RETRY_LIMIT {
            self.retries_used += 1;
            EnvironmentCallbackTimeoutAction::RetryTimedOutIntent
        } else {
            EnvironmentCallbackTimeoutAction::Stop
        }
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }
}

pub(super) fn ensure_browser_controller(caller: &tauri::Webview) -> Result<(), String> {
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

pub(super) fn event_tracker_for_label(
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

pub(super) fn event_sequence_for_label_url(
    state: &BrowserLifecycleState,
    label: &str,
    url: &Url,
) -> u64 {
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
) -> Result<(), BrowserReconcileError> {
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
                bounds.w,
                bounds.h,
                &navigation.url,
                navigation.read_only_url.as_deref(),
            )
            .map_err(|error| match error {
                EnsureBrowserError::WebView2EnvironmentCallbackTimedOut => {
                    BrowserReconcileError::WebView2EnvironmentCallbackTimedOut {
                        revision: snapshot.revision,
                    }
                }
                EnsureBrowserError::Other(error) => BrowserReconcileError::Other(error),
            })?;
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
    Err("browser lifecycle did not settle after 16 intent revisions"
        .to_string()
        .into())
}

pub(super) fn schedule_browser_reconcile(
    app: AppHandle,
    state: BrowserLifecycleState,
    label: String,
) {
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
    tauri::async_runtime::spawn_blocking(move || {
        let mut environment_timeout_retry = EnvironmentCallbackTimeoutRetryState::default();
        loop {
            signal.dirty.store(false, Ordering::SeqCst);
            let timeout_revision = match reconcile_browser(&app, &state, &label) {
                Ok(()) => {
                    environment_timeout_retry.reset();
                    None
                }
                Err(error) => {
                    let timeout_revision = error.environment_callback_timeout_revision();
                    if timeout_revision.is_none() {
                        environment_timeout_retry.reset();
                    }
                    let error = error.to_string();
                    log::warn!("browser lifecycle reconciliation failed for {label}: {error}");
                    let _ = app.emit(
                        "browser:lifecycle-error",
                        BrowserLifecycleErrorEvent {
                            label: label.clone(),
                            error,
                        },
                    );
                    timeout_revision
                }
            };
            let newer_intent_pending = signal.dirty.swap(false, Ordering::SeqCst);
            if let Some(revision) = timeout_revision {
                match environment_timeout_retry.action(revision, newer_intent_pending) {
                    EnvironmentCallbackTimeoutAction::ReconcileNewestIntent
                    | EnvironmentCallbackTimeoutAction::RetryTimedOutIntent => continue,
                    EnvironmentCallbackTimeoutAction::Stop => {}
                }
            } else if newer_intent_pending {
                continue;
            }
            signal.running.store(false, Ordering::SeqCst);
            if signal.dirty.swap(false, Ordering::SeqCst)
                && !signal.running.swap(true, Ordering::SeqCst)
            {
                continue;
            }
            break;
        }
    });
}

pub(super) fn schedule_scope_reconcile(
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
