use super::{OFFSCREEN_X, OFFSCREEN_Y};

const OFFSCREEN_MARGIN: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum BrowserBounds {
    Hidden { w: f64, h: f64 },
    Visible { x: f64, y: f64, w: f64, h: f64 },
}

pub(super) fn browser_bounds_within_client(
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

/// Realize a new native browser child at its full intended size but outside
/// the main window. WRY creates its `WRY_WEBVIEW` container HWND before
/// WebView2 environment/controller initialization finishes. If that async COM
/// callback stalls, Tauri has no registered Webview handle to hide yet; an
/// in-viewport container would therefore remain above the app and intercept
/// input. Creation is fail-closed offscreen and reconciliation seats the child
/// only after `add_child` has returned and the newest intent is still visible.
pub(super) fn offscreen_browser_creation_bounds(
    client_w: f64,
    client_h: f64,
    w: f64,
    h: f64,
) -> Result<(f64, f64), String> {
    match browser_bounds_within_client(client_w, client_h, OFFSCREEN_X, OFFSCREEN_Y, w, h)? {
        BrowserBounds::Hidden { w, h } => Ok((w, h)),
        BrowserBounds::Visible { .. } => {
            Err("offscreen browser creation unexpectedly produced visible bounds".to_string())
        }
    }
}

/// Returns a physical position that puts a retained child fully beyond the
/// main client area's top-left corner. The offset must account for both the
/// client and child dimensions: a fixed distance can leave part of an
/// oversized child visible and able to receive input.
pub(super) fn offscreen_browser_position(
    client_w: f64,
    client_h: f64,
    child_w: f64,
    child_h: f64,
) -> Result<(f64, f64), String> {
    if !client_w.is_finite()
        || !client_h.is_finite()
        || !child_w.is_finite()
        || !child_h.is_finite()
    {
        return Err("browser bounds must be finite".to_string());
    }

    Ok((
        -(client_w.max(0.0).max(child_w.max(0.0)) + OFFSCREEN_MARGIN),
        -(client_h.max(0.0).max(child_h.max(0.0)) + OFFSCREEN_MARGIN),
    ))
}
