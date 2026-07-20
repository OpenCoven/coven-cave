use super::{browser_bounds_within_client, BrowserBounds, OFFSCREEN_X, OFFSCREEN_Y};
use tauri::{LogicalPosition, LogicalSize, Rect};

// Park the webview offscreen at its CURRENT size. Do not shrink it to 1×1:
// collapsing the layer lets WKWebView drop its backing surface, and a later
// browser_set_bounds re-seat can land as an unpainted (black) layer. Keeping
// the real size while offscreen keeps the layer realized so it repaints
// immediately when shown again.
pub(super) fn hide_webview(webview: &tauri::Webview) -> Result<(), String> {
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

pub(super) fn show_webview_at(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
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
