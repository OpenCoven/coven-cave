#[cfg(not(any(target_os = "windows", target_os = "linux")))]
use super::offscreen_browser_position;
use super::{browser_bounds_within_client, BrowserBounds};
use tauri::{PhysicalPosition, PhysicalSize, Rect};

// Park the webview offscreen at its CURRENT size. Do not shrink it to 1×1:
// collapsing the layer lets WKWebView drop its backing surface, and a later
// browser_set_bounds re-seat can land as an unpainted (black) layer. Keeping
// the real size while offscreen keeps the layer realized so it repaints
// immediately when shown again.
pub(super) fn hide_webview(webview: &tauri::Webview) -> Result<(), String> {
    // Offscreen parking is not a visibility guarantee on Windows: WebView2
    // can retain a stale native input surface and invisibly capture Cave
    // clicks. Hide the child layer through the platform API instead.
    //
    // Linux joins Windows here for a different reason: parking cannot work at
    // all. tauri-runtime-wry packs child webviews into the window's vertical
    // GtkBox (`build_gtk(window.default_vbox())`, expand=true), so every
    // set_position is a silent no-op and GTK allocates the child half the
    // window regardless — a "hidden" browser still steals that space
    // (cave-vb79). Hiding the widget is the only way to give it zero
    // allocation. The upstream fix chain (tao#1232 -> wry#1745 ->
    // tauri#15463) was still unmerged as of 2026-07-31; when it lands, Linux
    // can move back to parking with the rest.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    webview.hide().map_err(|e| e.to_string())?;

    // WKWebView may drop its backing surface when hidden, so the remaining
    // platforms retain the realized layer at its current size and move it
    // entirely outside the physical client area.
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let offscreen_position = {
        let window = webview.window();
        let client = window.inner_size().map_err(|e| e.to_string())?;
        let child = webview.size().map_err(|e| e.to_string())?;
        let (x, y) = offscreen_browser_position(
            f64::from(client.width),
            f64::from(client.height),
            f64::from(child.width),
            f64::from(child.height),
        )?;
        PhysicalPosition::new(x, y)
    };
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    webview
        .set_position(offscreen_position)
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
    let client = window.inner_size().map_err(|e| e.to_string())?;
    let bounds = match browser_bounds_within_client(
        f64::from(client.width),
        f64::from(client.height),
        x,
        y,
        w,
        h,
    ) {
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
            position: PhysicalPosition::new(x, y).into(),
            size: PhysicalSize::new(w, h).into(),
        })
        .map_err(|e| e.to_string())?;
    // Paired with the hide above: any platform that hides the widget must show
    // it again here, or the browser never comes back from a hidden state.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    webview.show().map_err(|e| e.to_string())?;
    Ok(())
}
