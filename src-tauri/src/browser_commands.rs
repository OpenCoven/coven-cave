use super::*;

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
