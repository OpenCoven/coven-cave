use super::*;

#[cfg(desktop)]
pub(super) const QUICK_CHAT_WINDOW_LABEL: &str = "quick-chat";
#[cfg(desktop)]
pub(super) const QUICK_CHAT_WIDTH: f64 = 390.0;
#[cfg(desktop)]
pub(super) const QUICK_CHAT_HEIGHT: f64 = 520.0;
#[cfg(desktop)]
pub(super) fn coven_tray_icon() -> Image<'static> {
    #[cfg(target_os = "windows")]
    { return super::windows_tray::icon(); }
    #[cfg(not(target_os = "windows"))]
    {
    // The Coven fox-and-trident mark, pre-rendered from
    // icons/icon-source-1024.png as 36×36 (18pt @2x) white+alpha raw RGBA —
    // regenerate with scripts/generate-tray-icon.py. macOS renders it as a
    // template image (alpha only, adapts to menu-bar appearance); the white
    // fill keeps dark Windows/Linux trays legible. Raw RGBA avoids pulling
    // tauri's `image-png` decoder feature for a single build-time asset.
    const SIZE: u32 = 36;
    const RGBA: &[u8] = include_bytes!("../icons/tray-icon-36.rgba");
    Image::new(RGBA, SIZE, SIZE)
    }
}

#[cfg(desktop)]
pub(super) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = preferred_main_window(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
pub(super) fn quick_chat_position(app: &tauri::AppHandle) -> (f64, f64) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();
        let screen_x = position.x as f64 / scale;
        let screen_y = position.y as f64 / scale;
        let screen_w = size.width as f64 / scale;
        return (
            screen_x + screen_w - QUICK_CHAT_WIDTH - 14.0,
            screen_y + 34.0,
        );
    }
    (24.0, 40.0)
}

// Compile the Windows adapter during native tests on other desktop hosts too.
#[cfg(all(desktop, any(target_os = "windows", test)))]
fn place_windows_quick_chat(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    reopening: bool,
) -> tauri::Result<()> {
    use super::window_placement::{fit_quick_chat_client, Rect};
    // tray-icon returns physical pixels; converting at 1.0 preserves them.
    let tray = app.tray_by_id("cave-tray")
        .and_then(|tray| tray.rect().ok().flatten())
        .map(|rect| {
            let position = rect.position.to_physical::<i32>(1.0);
            let size = rect.size.to_physical::<u32>(1.0);
            Rect { x: position.x, y: position.y, width: size.width, height: size.height }
        }).filter(|r| r.width > 0 && r.height > 0);
    let monitor = tray.and_then(|r| app.monitor_from_point(
        f64::from(r.x) + f64::from(r.width) / 2.0,
        f64::from(r.y) + f64::from(r.height) / 2.0,
    ).ok().flatten())
        .or_else(|| app.cursor_position().ok().and_then(|p|
            app.monitor_from_point(p.x, p.y).ok().flatten()))
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return Ok(()) };
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 { return Ok(()) }
    let area = monitor.work_area();
    let work = Rect { x: area.position.x, y: area.position.y,
        width: area.size.width, height: area.size.height };
    let pixels = |logical: f64| (logical * scale).round().max(1.0) as u32;
    // Retain a user's resize in logical units when moving between DPIs.
    let desired = if reopening {
        let logical = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
        (pixels(logical.width), pixels(logical.height))
    } else { (pixels(QUICK_CHAT_WIDTH), pixels(QUICK_CHAT_HEIGHT)) };
    // A borderless Windows window can still have shadow frame extents. Move
    // to target DPI before measuring them, then fit the entire outer rectangle.
    window.set_position(tauri::PhysicalPosition::new(work.x, work.y))?;
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let frame = (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height));
    let Some(placement) = fit_quick_chat_client(work, scale, desired, frame, tray) else {
        return Ok(());
    };
    window.set_min_size(Some(tauri::PhysicalSize::new(
        placement.min_inner_size.0, placement.min_inner_size.1,
    )))?;
    window.set_size(tauri::PhysicalSize::new(placement.inner_size.0, placement.inner_size.1))?;
    window.set_position(tauri::PhysicalPosition::new(placement.outer.x, placement.outer.y))?;
    Ok(())
}

/// The token-bearing URL the main window was launched with. The page's
/// sidecar auth bridge moves `covenCaveToken` into per-window sessionStorage
/// and strips it from the visible URL right after load, so scraping the main
/// window's URL later returns a token-less one. A child window built from
/// that scrape (quick chat, the detached Chat window) starts with a fresh
/// sessionStorage and no token, and every one of its `/api/` requests is
/// rejected 401 "unauthorized". Child windows derive from this remembered
/// URL instead; the live scrape remains only as a fallback for tokenless dev
/// servers.
#[cfg(desktop)]
pub(super) static MAIN_STARTUP_URL: Mutex<Option<Url>> = Mutex::new(None);

#[cfg(desktop)]
pub(super) fn remember_main_startup_url(url: &Url) {
    if let Ok(mut remembered) = MAIN_STARTUP_URL.lock() {
        *remembered = Some(url.clone());
    }
}

#[cfg(desktop)]
pub(super) fn main_url_for_child_windows(app: &tauri::AppHandle) -> Option<Url> {
    MAIN_STARTUP_URL
        .lock()
        .ok()
        .and_then(|remembered| remembered.clone())
        .or_else(|| preferred_main_window(app).and_then(|window| window.url().ok()))
}

#[cfg(desktop)]
pub(super) fn quick_chat_url_from_main(mut url: Url) -> Option<Url> {
    let trusted_loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
        && url.port().is_some();
    if !trusted_loopback {
        return None;
    }
    url.set_path("/quick-chat");
    Some(url)
}

#[cfg(desktop)]
pub(super) fn show_quick_chat_from_main(app: &tauri::AppHandle) {
    let Some(url) = main_url_for_child_windows(app).and_then(quick_chat_url_from_main) else {
        focus_main_window(app);
        return;
    };
    show_quick_chat_window(app, &url);
}

#[cfg(desktop)]
pub(super) fn show_quick_chat_window(app: &tauri::AppHandle, quick_chat_url: &Url) {
    if let Some(window) = app.get_webview_window(QUICK_CHAT_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        if let Err(error) = place_windows_quick_chat(app, &window, true) {
            log::warn!("[cave] quick chat placement unavailable: {}", error);
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // On macOS the window opens transparent with an NSVisualEffectView behind
    // it (applied after build), and `?glass=1` tells the page to drop its
    // opaque background — the glassmorphic quick chat. Other platforms keep
    // the opaque window and never receive the flag, so the page stays solid.
    #[cfg(target_os = "macos")]
    let quick_chat_url = {
        let mut glass_url = quick_chat_url.clone();
        glass_url.query_pairs_mut().append_pair("glass", "1");
        glass_url
    };

    let (x, y) = quick_chat_position(app);
    let builder = WebviewWindowBuilder::new(
        app,
        QUICK_CHAT_WINDOW_LABEL,
        WebviewUrl::External(quick_chat_url.clone()),
    )
    .title("CovenCave Quick Chat")
    .inner_size(QUICK_CHAT_WIDTH, QUICK_CHAT_HEIGHT)
    .min_inner_size(340.0, 420.0)
    // Resizable since the window holds multiple chats now — the min size
    // keeps a single tab's composer + thread usable.
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(x, y)
    .shadow(true)
    .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    let builder = builder.transparent(true);

    #[cfg(target_os = "windows")]
    let builder = builder.visible(false);

    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "windows")]
            if let Err(error) = place_windows_quick_chat(app, &window, false) {
                log::warn!("[cave] quick chat placement unavailable: {}", error);
            }
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                // 14.0 matches .tray-quick-chat__frame's border-radius so the
                // vibrancy layer and the DOM frame round together.
                if let Err(e) =
                    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(14.0))
                {
                    log::warn!("[cave] quick chat vibrancy unavailable: {}", e);
                }
                // always_on_top only orders this panel against windows on the
                // space it already lives on. With a default collection
                // behavior it stays pinned to the space it opened on and is
                // hidden outright while another app is fullscreen.
                //
                // Deliberately no setLevel here: quick chat is a floating
                // panel rather than a menu-bar resident, so the
                // NSFloatingWindowLevel that always_on_top(true) already gives
                // it is the right level. Only the collection behavior needs
                // widening. Flags are OR'd into whatever tao set so we add
                // these two traits without clobbering ones we do not own.
                let win = window.clone();
                let _ = window.run_on_main_thread(move || {
                    let Ok(ns_ptr) = win.ns_window() else { return };
                    unsafe {
                        use objc2::msg_send;
                        use objc2::runtime::AnyObject;
                        let ns_window = ns_ptr as *mut AnyObject;
                        const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
                        const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
                        let current: usize = msg_send![&*ns_window, collectionBehavior];
                        let behavior = current | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY;
                        let _: () = msg_send![&*ns_window, setCollectionBehavior: behavior];
                    }
                });
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(e) => log::warn!("[cave] failed to open quick chat window: {}", e),
    }
}

// The detached Chat window: the main window's right Chat panel popped out
// into a regular window of its own (`/quick-chat?view=window`). Unlike the
// tray quick chat it is an ordinary application window: resizable, in the
// Dock/taskbar and window switcher, not always on top. It keeps its own
// familiar and conversation selection, so nothing the main window does moves
// it. The route is shared with the tray window to keep the packaged sidecar
// runtime closure flat; `view=window` selects the presentation server-side.
#[cfg(desktop)]
pub(super) const CHAT_WINDOW_LABEL: &str = "chat-window";
/// The page's sidecar auth bridge reads the token under this name from the
/// query or the fragment (src/components/security/sidecar-auth-bridge.tsx).
#[cfg(desktop)]
const SIDECAR_TOKEN_PARAM: &str = "covenCaveToken";
#[cfg(desktop)]
const CHAT_WINDOW_WIDTH: f64 = 1080.0;
#[cfg(desktop)]
const CHAT_WINDOW_HEIGHT: f64 = 760.0;
/// Longest familiar or session id the shell forwards. Both are short opaque
/// ids; the bound keeps a hostile caller from growing the window URL.
#[cfg(desktop)]
const CHAT_WINDOW_ID_MAX_LEN: usize = 200;

/// Where a pop-out should land: the familiar and conversation the Chat panel
/// was showing. Either may be absent; the page then keeps or restores its own
/// selection.
#[cfg(desktop)]
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChatWindowTarget {
    familiar_id: Option<String>,
    session_id: Option<String>,
}

#[cfg(desktop)]
impl ChatWindowTarget {
    pub(super) fn new(familiar_id: Option<String>, session_id: Option<String>) -> Self {
        Self {
            familiar_id: familiar_id.and_then(chat_window_id),
            session_id: session_id.and_then(chat_window_id),
        }
    }
}

/// Ids travel in a URL and in a script literal, so anything that is not a
/// plain bounded token is dropped instead of forwarded.
#[cfg(desktop)]
fn chat_window_id(raw: String) -> Option<String> {
    let id = raw.trim();
    let plain = !id.is_empty()
        && id.len() <= CHAT_WINDOW_ID_MAX_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    plain.then(|| id.to_string())
}

#[cfg(desktop)]
pub(super) fn chat_window_url_from_main(mut url: Url, target: &ChatWindowTarget) -> Option<Url> {
    let trusted_loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
        && url.port().is_some();
    if !trusted_loopback {
        return None;
    }
    url.set_path("/quick-chat");
    // The main window's own hash (a surface or chat deep link) must not follow
    // it here, but the sidecar token can live in the hash: the packaged app
    // passes it in the query, `scripts/dev-app.sh` in the fragment, and the
    // page's auth bridge reads both. Keep only that pair, byte for byte;
    // dropping it leaves this window without a token and its `/api/` calls
    // rejected.
    let token_fragment = url.fragment().and_then(|fragment| {
        fragment
            .split('&')
            .find(|pair| pair.split('=').next() == Some(SIDECAR_TOKEN_PARAM))
            .map(str::to_owned)
    });
    url.set_fragment(token_fragment.as_deref());
    // Appended (not replacing) because the loopback URL can carry the sidecar
    // auth token in its query.
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("view", "window");
        if let Some(familiar_id) = &target.familiar_id {
            query.append_pair("familiar", familiar_id);
        }
        if let Some(session_id) = &target.session_id {
            query.append_pair("session", session_id);
        }
    }
    Some(url)
}

/// Open the detached Chat window on `target`, or bring the existing one
/// forward and hand it the new target.
#[cfg(desktop)]
pub(super) fn show_chat_window_from_main(app: &tauri::AppHandle, target: &ChatWindowTarget) {
    if let Some(window) = app.get_webview_window(CHAT_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // The window is already running a chat, so it must not be reloaded
        // onto a new URL. Hand the target to the page as a DOM event instead:
        // that needs no event-listen permission on this webview. The payload
        // is JSON built from ids already reduced to plain tokens.
        if target.familiar_id.is_some() || target.session_id.is_some() {
            if let Ok(detail) = serde_json::to_string(target) {
                let _ = window.eval(format!(
                    "window.dispatchEvent(new CustomEvent('cave:chat-window-target',{{detail:{detail}}}));"
                ));
            }
        }
        return;
    }

    let Some(url) = main_url_for_child_windows(app)
        .and_then(|main_url| chat_window_url_from_main(main_url, target))
    else {
        focus_main_window(app);
        return;
    };

    let builder =
        WebviewWindowBuilder::new(app, CHAT_WINDOW_LABEL, WebviewUrl::External(url))
            .title("CovenCave Chat")
            .inner_size(CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT)
            .min_inner_size(520.0, 480.0)
            .resizable(true)
            .center()
            // Same reason as the main window: the OS file-drop handler would
            // otherwise swallow the composer's HTML5 drag-and-drop.
            .disable_drag_drop_handler();

    // Match the main window's seamless title bar: content fills to the top
    // edge, the traffic lights float over it, and the page's own header is
    // the drag region (capabilities/loopback-window-drag.json).
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    match builder.build() {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(e) => log::warn!("[cave] failed to open the Chat window: {}", e),
    }
}
