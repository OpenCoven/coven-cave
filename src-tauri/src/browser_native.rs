#[cfg(not(any(target_os = "windows", target_os = "linux")))]
use super::offscreen_browser_position;
use super::{browser_bounds_within_client, BrowserBounds};
#[cfg(not(target_os = "linux"))]
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
    // Linux hides the WebKit widget so a parked tab cannot intercept clicks.
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
    #[cfg(target_os = "linux")]
    place_linux_browser(webview, x, y, w, h)?;
    #[cfg(not(target_os = "linux"))]
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

// Tauri creates Linux children in Tao's expanding vertical box. WRY ignores
// set_bounds for that container. Keep the box (including any native menu) as
// the window's content and allocate browser widgets as overlays above it.
#[cfg(target_os = "linux")]
fn place_linux_browser(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    use gtk::prelude::*;
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            let child = platform.inner();
            let scale = f64::from(child.scale_factor().max(1));
            let logical = |value: f64| (value / scale).round() as i32;
            let left = logical(x);
            let top = logical(y);
            let bounds = gtk::gdk::Rectangle::new(
                left,
                top,
                (logical(x + w) - left).max(1),
                (logical(y + h) - top).max(1),
            );
            let _ = tx.send(position_browser_widget(child.upcast_ref(), bounds));
        })
        .map_err(|error| error.to_string())?;
    rx.recv()
        .map_err(|error| error.to_string())?
        .map_err(str::to_owned)
}

#[cfg(target_os = "linux")]
fn position_browser_widget(
    child: &gtk::Widget,
    bounds: gtk::gdk::Rectangle,
) -> Result<(), &'static str> {
    use gtk::prelude::*;
    const BOUNDS_KEY: &str = "ai.opencoven.cave.browser-allocation";
    // SAFETY: this private key always holds a GdkRectangle. Its reader copies
    // the rectangle on the GTK thread before any subsequent update.
    unsafe {
        child.set_data(BOUNDS_KEY, bounds);
    }
    let parent = child.parent().ok_or("Browser widget has no parent")?;
    if let Ok(overlay) = parent.clone().downcast::<gtk::Overlay>() {
        overlay.queue_resize();
        return Ok(());
    }

    let content = parent
        .downcast::<gtk::Box>()
        .map_err(|_| "Unexpected browser container")?;
    let host = content.children().into_iter().find_map(|widget| {
        widget
            .downcast::<gtk::Overlay>()
            .ok()
            .filter(|overlay| overlay.widget_name() == "cave-browser-host")
    });
    let overlay = if let Some(host) = host {
        host
    } else {
        // Tauri packs the primary WebKit view before the browser children.
        let main = content
            .children()
            .into_iter()
            .find(|widget| widget.type_() == child.type_())
            .filter(|widget| widget != child)
            .ok_or("Browser window has no primary webview")?;
        let overlay = gtk::Overlay::new();
        overlay.set_widget_name("cave-browser-host");
        overlay.connect_get_child_position(|_, widget| {
            // SAFETY: paired with the typed write above.
            unsafe {
                widget
                    .data::<gtk::gdk::Rectangle>(BOUNDS_KEY)
                    .map(|rect| *rect.as_ref())
            }
        });
        content.pack_start(&overlay, true, true, 0);
        overlay.show();
        // GTK3's reparent API preserves the main WebKit drawing surface.
        // SAFETY: both live widgets belong to this GTK thread and the new
        // parent is a realized, empty GtkBin.
        use gtk::glib::translate::ToGlibPtr;
        unsafe {
            gtk::ffi::gtk_widget_reparent(
                main.to_glib_none().0,
                overlay.upcast_ref::<gtk::Widget>().to_glib_none().0,
            );
        }
        overlay
    };
    content.remove(child);
    overlay.add_overlay(child);
    Ok(())
}
