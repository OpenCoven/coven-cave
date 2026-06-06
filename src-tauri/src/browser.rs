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
//
// Events:
//   browser:page-load { label, url, phase: "started" | "finished" }

use serde::Serialize;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const BROWSER_LABEL_PREFIX: &str = "cave-browser-";
const OFFSCREEN_X: f64 = -10000.0;
const OFFSCREEN_Y: f64 = -10000.0;

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

#[derive(Debug, Serialize, Clone)]
struct BrowserTitleEvent {
    label: String,
    title: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
struct BrowserPageLoadEvent {
    label: String,
    url: String,
    phase: String,
}

fn ensure_browser(
    app: &AppHandle,
    label: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    url: &str,
) -> Result<bool, String> {
    if app.webviews().keys().any(|existing| existing == label) {
        return Ok(false);
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let parsed_url = Url::parse(url).map_err(|e| e.to_string())?;
    let browser_label = label.to_string();
    let app_for_load = app.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .background_color(tauri::webview::Color(12, 12, 14, 255)) // dark bg — no white flash
        .on_page_load(
        move |webview, payload| {
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
                },
            );
            if matches!(payload.event(), PageLoadEvent::Finished) {
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
                          window.addEventListener("keydown", function(event) {{
                            try {{
                              if ((event.metaKey || event.ctrlKey) && event.key && event.key.toLowerCase() === "t") {{
                                event.preventDefault();
                                event.stopPropagation();
                                if (window.__TAURI_INTERNALS__) {{
                                  window.__TAURI_INTERNALS__.invoke("browser_report_title", {{
                                    label: browserLabel, url: location.href
                                  }}).catch(function(){{}});
                                }}
                              }}
                            }} catch (_) {{}}
                          }}, true);
                        }}
                        // Report title immediately on load
                        if (window.__TAURI_INTERNALS__) {{
                          var pageTitle = document.title || location.hostname || location.href;
                          window.__TAURI_INTERNALS__.invoke("browser_report_title", {{
                            label: browserLabel, title: pageTitle, url: location.href
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
                    },
                );
            }
        },
    );

    main.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(w.max(1.0), h.max(1.0)),
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

fn hide_webview(webview: &tauri::Webview) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(1.0, 1.0))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    label: Option<String>,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let label = safe_browser_label(label);
    let created = ensure_browser(&app, &label, x, y, w, h, &url)?;
    if !created {
        let webview = app
            .get_webview(&label)
            .ok_or_else(|| "browser webview missing".to_string())?;
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(w.max(1.0), h.max(1.0)))
            .map_err(|e| e.to_string())?;
        let parsed_url = Url::parse(&url).map_err(|e| e.to_string())?;
        // Belt-and-suspenders: webview.navigate() can no-op on already-loaded
        // child webviews in some Tauri 2 builds. Fall back to eval-based nav
        // if navigate returns an error, which also fires the page-load event.
        if let Err(_e) = webview.navigate(parsed_url.clone()) {
            let escaped = parsed_url.to_string().replace('"', "%22");
            webview
                .eval(format!("window.location.href = \"{}\";", escaped))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    label: Option<String>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let label = safe_browser_label(label);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(w.max(1.0), h.max(1.0)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_hide(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let label = safe_browser_label(label);
    if let Some(webview) = app.get_webview(&label) {
        hide_webview(&webview)?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_hide_all_except(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let keep = label.map(|raw| safe_browser_label(Some(raw)));
    for (existing_label, webview) in app.webviews() {
        if existing_label.starts_with(BROWSER_LABEL_PREFIX)
            && Some(existing_label.clone()) != keep
        {
            hide_webview(&webview)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let label = safe_browser_label(label);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let label = safe_browser_label(label);
    if let Some(webview) = app.get_webview(&label) {
        webview.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Called by the injected script inside a child browser webview so the real
/// document.title can be emitted as a `browser:title` event on the main
/// app event bus (where the BrowserPane JS component can receive it).
/// This avoids the cross-webview event delivery problem in Tauri v2.
#[tauri::command]
pub fn browser_report_title(
    app: AppHandle,
    label: String,
    title: String,
    url: String,
) -> Result<(), String> {
    // The injected script calls this from the child webview, but `app.emit`
    // sends to ALL windows/webviews so the main window's JS event bus sees it.
    let _ = app.emit(
        "browser:title",
        BrowserTitleEvent {
            label,
            title,
            url,
        },
    );
    Ok(())
}
