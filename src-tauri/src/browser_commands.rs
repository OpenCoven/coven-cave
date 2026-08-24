use super::*;

struct BrowserIdentity {
    native_label: String,
    owner_label: String,
    client_label: String,
}

impl BrowserIdentity {
    fn revalidate(&self, inner: &mut BrowserLifecycleInner) -> Result<(), String> {
        register_browser_owner(
            inner,
            &self.native_label,
            &self.owner_label,
            &self.client_label,
        )
    }
}

fn browser_identity(
    lifecycle: &BrowserLifecycleState,
    caller: &tauri::Webview,
    label: Option<String>,
) -> Result<BrowserIdentity, String> {
    let owner_label = ensure_browser_controller(caller)?;
    let client_label = safe_browser_label(label);
    let native_label = native_browser_label(&owner_label, &client_label);
    {
        let mut inner = lifecycle.lock()?;
        register_browser_owner(&mut inner, &native_label, &owner_label, &client_label)?;
    }
    Ok(BrowserIdentity {
        native_label,
        owner_label,
        client_label,
    })
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
    let lifecycle = lifecycle.inner().clone();
    let identity = browser_identity(&lifecycle, &caller, label)?;
    Url::parse(&url).map_err(|e| e.to_string())?;
    if let Some(read_only_url) = read_only_url.as_deref() {
        Url::parse(read_only_url).map_err(|e| e.to_string())?;
    }
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() {
        return Err("browser bounds must be finite".to_string());
    }
    let bounds = BrowserBoundsIntent {
        sequence,
        x,
        y,
        w,
        h,
    };
    {
        let mut inner = lifecycle.lock()?;
        identity.revalidate(&mut inner)?;
        if !record_navigation_intent(
            &mut inner,
            &identity.native_label,
            sequence,
            url,
            read_only_url,
            bounds,
        ) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, identity.native_label);
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
    let lifecycle = lifecycle.inner().clone();
    let identity = browser_identity(&lifecycle, &caller, label)?;
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() {
        return Err("browser bounds must be finite".to_string());
    }
    let bounds = BrowserBoundsIntent {
        sequence,
        x,
        y,
        w,
        h,
    };
    {
        let mut inner = lifecycle.lock()?;
        identity.revalidate(&mut inner)?;
        if !record_bounds_intent(&mut inner, &identity.native_label, bounds) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, identity.native_label);
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
    let lifecycle = lifecycle.inner().clone();
    let identity = browser_identity(&lifecycle, &caller, label)?;
    {
        let mut inner = lifecycle.lock()?;
        identity.revalidate(&mut inner)?;
        if !record_visibility_intent(
            &mut inner,
            &identity.native_label,
            sequence,
            BrowserVisibility::Hidden,
        ) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, identity.native_label);
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
    let owner_label = ensure_browser_controller(&caller)?;
    let lifecycle = lifecycle.inner().clone();
    let keep = match label {
        Some(raw) => Some(browser_identity(&lifecycle, &caller, Some(raw))?.native_label),
        None => None,
    };
    schedule_scope_reconcile(
        app,
        lifecycle,
        &owner_label,
        native_browser_owner_prefix(&owner_label),
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
    let lifecycle = lifecycle.inner().clone();
    let identity = browser_identity(&lifecycle, &caller, label)?;
    {
        let mut inner = lifecycle.lock()?;
        identity.revalidate(&mut inner)?;
        if !record_visibility_intent(
            &mut inner,
            &identity.native_label,
            sequence,
            BrowserVisibility::Closed,
        ) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, identity.native_label);
    Ok(())
}

fn pane_prefix(window_label: &str, label: Option<String>) -> String {
    let client_prefix = match label {
        Some(raw) => format!("{}-tab-", safe_browser_label(Some(raw))),
        None => BROWSER_LABEL_PREFIX.to_string(),
    };
    native_browser_scope_prefix(window_label, &client_prefix)
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
    let owner_label = ensure_browser_controller(&caller)?;
    let prefix = pane_prefix(&owner_label, label);
    schedule_scope_reconcile(
        app,
        lifecycle.inner().clone(),
        &owner_label,
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
    let owner_label = ensure_browser_controller(&caller)?;
    let prefix = pane_prefix(&owner_label, label);
    schedule_scope_reconcile(
        app,
        lifecycle.inner().clone(),
        &owner_label,
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
    let lifecycle = lifecycle.inner().clone();
    let identity = browser_identity(&lifecycle, &caller, label)?;
    {
        let mut inner = lifecycle.lock()?;
        identity.revalidate(&mut inner)?;
        if !record_reload_intent(&mut inner, &identity.native_label, sequence) {
            return Ok(());
        }
    }
    schedule_browser_reconcile(app, lifecycle, identity.native_label);
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
    let native_label = caller.label().to_string();
    if !native_label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser navigation reports require a browser child webview".to_string());
    }
    if target_url.len() > 4096 {
        return Err("browser navigation target is too long".to_string());
    }
    let target = Url::parse(&target_url).map_err(|_| "invalid browser navigation target")?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("browser navigation target must use http or https".to_string());
    }
    browser_owner(lifecycle.inner(), &native_label)?;
    let tracker = event_tracker_for_label(lifecycle.inner(), &native_label)?;
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
    let native_label = caller.label().to_string();
    if !native_label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser title reports require a browser child webview".to_string());
    }
    let url = caller.url().map_err(|error| error.to_string())?;
    let owner = browser_owner(lifecycle.inner(), &native_label)?;
    let sequence = event_sequence_for_label_url(lifecycle.inner(), &native_label, &url);
    let url = url.to_string();
    let title = title.chars().take(512).collect::<String>();
    let owner_window = app
        .get_webview_window(&owner.window_label)
        .ok_or_else(|| format!("owner window '{}' is unavailable", owner.window_label))?;
    let _ = owner_window.emit(
        "browser:title",
        BrowserTitleEvent {
            label: owner.client_label,
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
    lifecycle: State<'_, BrowserLifecycleState>,
    caller: tauri::Webview,
    scroll_y: f64,
) -> Result<(), String> {
    let native_label = caller.label().to_string();
    if !native_label.starts_with(BROWSER_LABEL_PREFIX) {
        return Err("browser scroll reports require a browser child webview".to_string());
    }
    if !scroll_y.is_finite() {
        return Err("browser scroll position must be finite".to_string());
    }
    let owner = browser_owner(lifecycle.inner(), &native_label)?;
    let owner_window = app
        .get_webview_window(&owner.window_label)
        .ok_or_else(|| format!("owner window '{}' is unavailable", owner.window_label))?;
    let _ = owner_window.emit(
        "browser:scroll",
        BrowserScrollEvent {
            label: owner.client_label,
            scroll_y: scroll_y.clamp(0.0, 1_000_000_000.0),
        },
    );
    Ok(())
}
