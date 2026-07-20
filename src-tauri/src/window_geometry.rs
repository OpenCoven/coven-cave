use super::*;

#[cfg(desktop)]
pub(super) const QUICK_CHAT_WINDOW_LABEL: &str = "quick-chat";
#[cfg(desktop)]
pub(super) const QUICK_CHAT_WIDTH: f64 = 390.0;
#[cfg(desktop)]
pub(super) const QUICK_CHAT_HEIGHT: f64 = 520.0;
// The optional "centered notch" presentation of quick chat: a small
// always-on-top pill hugging the top of the screen that expands in place
// into the quick chat surface. Geometry lives here (not in the page) so the
// webview only ever asks for a state via events and the shell owns monitor
// math. The collapsed pill stays parked dead-center on the top bar — where
// a notch belongs — and sizes itself into the menu bar by default; that
// behavior (and the fixed sizes below) is customizable via NotchConfig.
#[cfg(desktop)]
pub(super) const NOTCH_WINDOW_LABEL: &str = "notch";
#[cfg(desktop)]
pub(super) const NOTCH_COLLAPSED_WIDTH: f64 = 190.0;
#[cfg(desktop)]
pub(super) const NOTCH_COLLAPSED_HEIGHT: f64 = 38.0;
#[cfg(desktop)]
pub(super) const NOTCH_EXPANDED_WIDTH: f64 = 420.0;
#[cfg(desktop)]
pub(super) const NOTCH_EXPANDED_HEIGHT: f64 = 560.0;

/// User-tunable notch behavior, persisted as `notch-config.json` in the app
/// config dir next to the `notch-mode` marker. Serde defaults keep partial
/// or hand-edited files forgiving (legacy keys from the retired follow-mouse
/// era are ignored); `sanitized()` clamps sizes to usable ranges. The
/// panel's toolbar toggle patches `fit_menu_bar` through the `notch:config`
/// event; sizes are hand-editable customizations.
#[cfg(desktop)]
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct NotchConfig {
    /// Squeeze the collapsed pill into the menu-bar strip height so it sits
    /// inside the top bar instead of hanging below it (default).
    pub(super) fit_menu_bar: bool,
    pub(super) collapsed_width: f64,
    pub(super) collapsed_height: f64,
    pub(super) expanded_width: f64,
    pub(super) expanded_height: f64,
}

#[cfg(desktop)]
impl Default for NotchConfig {
    fn default() -> Self {
        Self {
            fit_menu_bar: true,
            collapsed_width: NOTCH_COLLAPSED_WIDTH,
            collapsed_height: NOTCH_COLLAPSED_HEIGHT,
            expanded_width: NOTCH_EXPANDED_WIDTH,
            expanded_height: NOTCH_EXPANDED_HEIGHT,
        }
    }
}

#[cfg(desktop)]
impl NotchConfig {
    /// Clamp custom sizes to ranges that keep the pill clickable and the
    /// panel on screen — hand-edited configs can't wedge the window.
    pub(super) fn sanitized(mut self) -> Self {
        self.collapsed_width = self.collapsed_width.clamp(120.0, 480.0);
        self.collapsed_height = self.collapsed_height.clamp(20.0, 120.0);
        self.expanded_width = self.expanded_width.clamp(320.0, 900.0);
        self.expanded_height = self.expanded_height.clamp(360.0, 1200.0);
        self
    }
}

/// Live notch runtime state shared between the event listeners. `expanded`
/// remembers which geometry a `notch:config` patch should re-apply;
/// `config` mirrors notch-config.json.
#[cfg(desktop)]
pub(super) struct NotchState {
    pub(super) expanded: std::sync::atomic::AtomicBool,
    pub(super) config: Mutex<NotchConfig>,
}

/// Partial notch-config update from the page's toolbar toggles — optional
/// fields so each toggle patches only itself (unknown legacy keys such as
/// `followMouse` are ignored).
#[cfg(desktop)]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotchConfigPatch {
    pub(super) fit_menu_bar: Option<bool>,
}

#[cfg(desktop)]
pub(super) fn coven_tray_icon() -> Image<'static> {
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

#[cfg(desktop)]
pub(super) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
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

/// The token-bearing URL the main window was launched with. The page's
/// sidecar auth bridge moves `covenCaveToken` into per-window sessionStorage
/// and strips it from the visible URL right after load, so scraping the main
/// window's URL later returns a token-less one. A child window built from
/// that scrape (detached quick chat, notch) starts with a fresh
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
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|window| window.url().ok())
        })
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

    match builder.build() {
        Ok(window) => {
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
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(e) => log::warn!("[cave] failed to open quick chat window: {}", e),
    }
}

#[cfg(desktop)]
pub(super) fn notch_url_from_main(mut url: Url) -> Option<Url> {
    let trusted_loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
        && url.port().is_some();
    if !trusted_loopback {
        return None;
    }
    // The notch shares the /quick-chat route with the tray window; ?notch=1
    // selects the notch presentation server-side. Appended (not replacing)
    // because the loopback URL carries the sidecar auth token in its query.
    url.set_path("/quick-chat");
    url.query_pairs_mut().append_pair("notch", "1");
    Some(url)
}

/// Top-center of the monitor the notch opens on, for a window `width` wide —
/// flush with the top edge so the pill reads as part of the menu-bar strip.
/// Placed once at open on the display whose menu bar was clicked (cursor
/// monitor), falling back to the primary; the pill then stays parked there.
#[cfg(desktop)]
pub(super) fn notch_position(app: &tauri::AppHandle, width: f64) -> (f64, f64) {
    // Open on the monitor the mouse is on, centered on its top bar; fall back
    // to the primary monitor when the cursor monitor can't be resolved.
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();
        let screen_x = position.x as f64 / scale;
        let screen_y = position.y as f64 / scale;
        let screen_w = size.width as f64 / scale;
        return (screen_x + (screen_w - width) / 2.0, screen_y);
    }
    (24.0, 0.0)
}

/// Height (logical px) of the monitor's reserved top strip — the macOS menu
/// bar or a top-docked taskbar — measured as the gap between the monitor's
/// top edge and its work area. None when the OS reserves nothing up top
/// (auto-hidden bars, most Linux WMs, fullscreen).
#[cfg(desktop)]
pub(super) fn menu_bar_strip_height(monitor: &tauri::Monitor) -> Option<f64> {
    let delta =
        (monitor.work_area().position.y - monitor.position().y) as f64 / monitor.scale_factor();
    (delta >= 1.0).then_some(delta)
}

/// Collapsed pill size: `fit_menu_bar` squeezes the height into the menu-bar
/// strip when the OS reports one, falling back to the configured height.
#[cfg(desktop)]
pub(super) fn notch_collapsed_size(config: &NotchConfig, strip_height: Option<f64>) -> (f64, f64) {
    let height = if config.fit_menu_bar {
        strip_height
            .map(|h| h.clamp(20.0, 120.0))
            .unwrap_or(config.collapsed_height)
    } else {
        config.collapsed_height
    };
    (config.collapsed_width, height)
}

/// Horizontal position (same units as the inputs) for a notch `width` wide
/// centered on `center_x`, kept fully inside the monitor's span.
#[cfg(desktop)]
pub(super) fn notch_centered_x(center_x: f64, monitor_x: f64, monitor_w: f64, width: f64) -> f64 {
    let max_x = monitor_x + (monitor_w - width).max(0.0);
    (center_x - width / 2.0).clamp(monitor_x, max_x)
}

/// The notch config visible to geometry code — managed state when available
/// (post-setup), defaults otherwise.
#[cfg(desktop)]
pub(super) fn notch_config(app: &tauri::AppHandle) -> NotchConfig {
    app.try_state::<NotchState>()
        .map(|state| {
            state
                .config
                .lock()
                .map(|config| *config)
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

/// Resize + reposition the notch window for its collapsed or expanded state.
/// Driven by the `notch:expand` / `notch:collapse` events the page emits —
/// the webview never gets window-geometry permissions of its own. Both
/// states park dead-center on the top bar of the window's current monitor
/// (falling back to the primary), where a notch belongs.
#[cfg(desktop)]
pub(super) fn set_notch_geometry(app: &tauri::AppHandle, expanded: bool) {
    let Some(window) = app.get_webview_window(NOTCH_WINDOW_LABEL) else {
        return;
    };
    let config = notch_config(app);
    if let Some(state) = app.try_state::<NotchState>() {
        state
            .expanded
            .store(expanded, std::sync::atomic::Ordering::Relaxed);
    }
    // The notch stays on its current monitor; fall back to the primary if
    // that can't be resolved.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let (width, height) = if expanded {
        (config.expanded_width, config.expanded_height)
    } else {
        notch_collapsed_size(&config, menu_bar_strip_height(&monitor))
    };
    let monitor_x = monitor.position().x as f64;
    let monitor_w = monitor.size().width as f64;
    let width_px = width * monitor.scale_factor();
    // Always center on the exact horizontal middle of the target monitor's
    // top bar — the pill and the expanded panel both belong dead-center.
    let center_x = monitor_x + monitor_w / 2.0;
    let x = notch_centered_x(center_x, monitor_x, monitor_w, width_px);
    let y = monitor.position().y as f64;
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.set_position(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ));
    if expanded {
        let _ = window.set_focus();
    }
}

/// Apply a `notch:config` patch from the page: persist the customization and
/// re-apply geometry immediately so a fit change is visible without a
/// collapse cycle.
#[cfg(desktop)]
pub(super) fn apply_notch_config_patch(app: &tauri::AppHandle, payload: &str) {
    let Ok(patch) = serde_json::from_str::<NotchConfigPatch>(payload) else {
        return;
    };
    let Some(state) = app.try_state::<NotchState>() else {
        return;
    };
    let updated = {
        let Ok(mut config) = state.config.lock() else {
            return;
        };
        if let Some(fit) = patch.fit_menu_bar {
            config.fit_menu_bar = fit;
        }
        *config
    };
    save_notch_config(app, &updated);
    let expanded = state.expanded.load(std::sync::atomic::Ordering::Relaxed);
    set_notch_geometry(app, expanded);
}

/// Whether the user opted into the notch presentation. A tiny marker file in
/// the app config dir — survives restarts so the tray icon stays moved.
#[cfg(desktop)]
pub(super) fn notch_mode_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("notch-mode"))
}

#[cfg(desktop)]
pub(super) fn load_notch_mode(app: &tauri::AppHandle) -> bool {
    notch_mode_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .is_some_and(|contents| contents.trim() == "1")
}

#[cfg(desktop)]
pub(super) fn save_notch_mode(app: &tauri::AppHandle, enabled: bool) {
    let Some(path) = notch_mode_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, if enabled { "1" } else { "0" }) {
        log::warn!("[cave] could not persist notch mode: {}", e);
    }
}

/// The notch customizations persist as `notch-config.json` beside the
/// `notch-mode` marker — hand-editable; unknown fields are ignored and
/// out-of-range sizes are clamped on load.
#[cfg(desktop)]
pub(super) fn notch_config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("notch-config.json"))
}

#[cfg(desktop)]
pub(super) fn load_notch_config(app: &tauri::AppHandle) -> NotchConfig {
    notch_config_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str::<NotchConfig>(&contents).ok())
        .unwrap_or_default()
        .sanitized()
}

#[cfg(desktop)]
pub(super) fn save_notch_config(app: &tauri::AppHandle, config: &NotchConfig) {
    let Some(path) = notch_config_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(config) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log::warn!("[cave] could not persist notch config: {}", e);
            }
        }
        Err(e) => log::warn!("[cave] could not serialize notch config: {}", e),
    }
}

#[cfg(desktop)]
pub(super) fn set_tray_visible(app: &tauri::AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id("cave-tray") {
        if let Err(e) = tray.set_visible(visible) {
            log::warn!("[cave] could not toggle tray visibility: {}", e);
        }
    }
}

#[cfg(desktop)]
pub(super) fn show_notch_from_main(app: &tauri::AppHandle) {
    let Some(url) = main_url_for_child_windows(app).and_then(notch_url_from_main) else {
        return;
    };
    show_notch_window(app, &url);
}

/// Seed the /notch page with its presentation state — the page has no invoke
/// permissions, so the URL is the only channel in; toggle changes flow back
/// as `notch:config` events. `barh` is the menu-bar-fitted pill height the
/// shell would use, so the page can size the pill to match either mode.
#[cfg(desktop)]
pub(super) fn notch_url_with_config(
    mut url: Url,
    config: &NotchConfig,
    strip_height: Option<f64>,
) -> Url {
    let fitted = NotchConfig {
        fit_menu_bar: true,
        ..*config
    };
    let (_, fitted_height) = notch_collapsed_size(&fitted, strip_height);
    url.query_pairs_mut()
        .append_pair("fit", if config.fit_menu_bar { "1" } else { "0" })
        .append_pair("pillw", &format!("{:.0}", config.collapsed_width))
        .append_pair("pillh", &format!("{:.0}", config.collapsed_height))
        .append_pair("barh", &format!("{:.0}", fitted_height));
    url
}

#[cfg(desktop)]
pub(super) fn show_notch_window(app: &tauri::AppHandle, notch_url: &Url) {
    if let Some(window) = app.get_webview_window(NOTCH_WINDOW_LABEL) {
        let _ = window.show();
        return;
    }

    let config = notch_config(app);
    let strip_height = app
        .primary_monitor()
        .ok()
        .flatten()
        .as_ref()
        .and_then(menu_bar_strip_height);
    let notch_url = notch_url_with_config(notch_url.clone(), &config, strip_height);

    // Same glass handshake as the quick-chat tray window: only macOS gets a
    // transparent window over vibrancy, and only then does the page drop its
    // opaque background.
    #[cfg(target_os = "macos")]
    let notch_url = {
        let mut glass_url = notch_url;
        glass_url.query_pairs_mut().append_pair("glass", "1");
        glass_url
    };

    // A fresh window always starts collapsed — clear any stale expanded flag
    // left behind by a docked-then-reopened notch so it reopens as the pill.
    if let Some(state) = app.try_state::<NotchState>() {
        state
            .expanded
            .store(false, std::sync::atomic::Ordering::Relaxed);
    }

    let (width, height) = notch_collapsed_size(&config, strip_height);
    let (x, y) = notch_position(app, width);
    let builder = WebviewWindowBuilder::new(
        app,
        NOTCH_WINDOW_LABEL,
        WebviewUrl::External(notch_url.clone()),
    )
    .title("CovenCave Notch")
    .inner_size(width, height)
    // The shell resizes it between the two fixed states; user resize would
    // fight the collapse animation.
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(x, y)
    // No native shadow — the window morphs between pill and panel shapes and
    // a stale shadow outline betrays the resize.
    .shadow(false)
    .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    let builder = builder.transparent(true);

    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                // 14.0 matches the notch pill/panel border radius in
                // notch-quick-chat.css.
                if let Err(e) =
                    apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(14.0))
                {
                    log::warn!("[cave] notch vibrancy unavailable: {}", e);
                }
                // A floating webview sits *below* the macOS menu bar's window
                // level, so a pill parked flush with the top edge would be
                // painted over by the bar. NSStatusWindowLevel (25) lifts the
                // notch into the strip like a status item; status-level
                // windows still take key focus for the expanded panel.
                let win = window.clone();
                let _ = window.run_on_main_thread(move || {
                    let Ok(ns_ptr) = win.ns_window() else { return };
                    unsafe {
                        use objc2::msg_send;
                        use objc2::runtime::AnyObject;
                        let ns_window = ns_ptr as *mut AnyObject;
                        let _: () = msg_send![&*ns_window, setLevel: 25isize];
                    }
                });
            }
            let _ = window.show();
        }
        Err(e) => log::warn!("[cave] failed to open notch window: {}", e),
    }
}
