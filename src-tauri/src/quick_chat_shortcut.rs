//! Opt-in system-wide Quick Chat shortcut (#5980).
//!
//! ⌘⇧Space on macOS and Ctrl+Shift+Space on Windows and Linux open the same
//! tray Quick Chat window as the tray menu's "Quick Chat…" item. A global
//! shortcut takes its key away from every other app while it is registered,
//! so it is off by default: it registers only while the person's
//! `general.quickChatShortcut` preference is on. Startup reads the saved
//! preference; the Settings toggle registers and unregisters it live through
//! `set_quick_chat_shortcut`.

use super::*;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

/// The one accelerator Cave registers. Never caller-supplied: the command
/// can only turn this exact shortcut on or off.
pub(super) fn quick_chat_shortcut() -> Shortcut {
    let primary = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(primary | Modifiers::SHIFT), Code::Space)
}

/// The global-shortcut plugin, whose handler opens Quick Chat on key-down.
/// Register the plugin once at startup; whether the key is held is decided
/// separately by the preference.
pub(super) fn quick_chat_shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(handle_shortcut_event)
        .build()
}

fn handle_shortcut_event(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if should_open_quick_chat(shortcut, event.state()) {
        show_quick_chat_from_main(app);
    }
}

/// Only a key-down of Cave's own accelerator opens Quick Chat. The release
/// event and any other registered shortcut are ignored.
fn should_open_quick_chat(shortcut: &Shortcut, state: ShortcutState) -> bool {
    state == ShortcutState::Pressed && *shortcut == quick_chat_shortcut()
}

/// Matches the preference schema: the shortcut stays off unless the person
/// explicitly saved `general.quickChatShortcut: true`. A missing, unreadable
/// or malformed file keeps it off.
pub(super) fn quick_chat_shortcut_enabled_from_preferences(raw: Option<&str>) -> bool {
    raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| {
            value
                .get("general")
                .and_then(|general| general.get("quickChatShortcut"))
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false)
}

/// Register or unregister the shortcut to match `enabled`. Registering an
/// already-held shortcut, or unregistering one that is not held, is a no-op.
fn apply_quick_chat_shortcut(app: &tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let shortcut = quick_chat_shortcut();
    let manager = app.global_shortcut();
    let registered = manager.is_registered(shortcut);
    if enabled && !registered {
        manager.register(shortcut).map_err(|error| {
            format!("Cave couldn't claim the Quick Chat shortcut; another app may be using it ({error})")
        })?;
    } else if !enabled && registered {
        manager
            .unregister(shortcut)
            .map_err(|error| format!("Cave couldn't release the Quick Chat shortcut ({error})"))?;
    }
    Ok(manager.is_registered(shortcut))
}

/// Apply the saved preference once at startup. A failure (another app
/// already holds the key) is logged; Settings reports it when toggled.
pub(super) fn apply_saved_quick_chat_shortcut(app: &tauri::AppHandle) {
    let raw = std::fs::read_to_string(cave_home_path().join("preferences.json")).ok();
    if !quick_chat_shortcut_enabled_from_preferences(raw.as_deref()) {
        return;
    }
    if let Err(error) = apply_quick_chat_shortcut(app, true) {
        log::warn!(
            "[cave] quick chat shortcut unavailable at startup: {}",
            error
        );
    }
}

/// Settings toggle: turn the fixed Quick Chat shortcut on or off and report
/// whether it is now registered. Only the main app window may change it.
#[tauri::command]
pub(super) fn set_quick_chat_shortcut(
    webview: tauri::Webview,
    enabled: bool,
) -> Result<bool, String> {
    let app = webview.app_handle();
    if !is_registered_main_window(app, webview.label()) {
        log::warn!(
            "[cave] denied set_quick_chat_shortcut from non-main webview: {}",
            webview.label()
        );
        return Err(
            "the Quick Chat shortcut can only be changed from the main app window".to_string(),
        );
    }
    apply_quick_chat_shortcut(app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shortcut_is_primary_shift_space() {
        let expected = if cfg!(target_os = "macos") {
            Modifiers::SUPER | Modifiers::SHIFT
        } else {
            Modifiers::CONTROL | Modifiers::SHIFT
        };
        assert_eq!(
            quick_chat_shortcut(),
            Shortcut::new(Some(expected), Code::Space)
        );
    }

    #[test]
    fn only_a_key_down_of_cave_s_shortcut_opens_quick_chat() {
        let own = quick_chat_shortcut();
        let other = Shortcut::new(Some(Modifiers::SHIFT), Code::KeyJ);
        assert!(should_open_quick_chat(&own, ShortcutState::Pressed));
        assert!(!should_open_quick_chat(&own, ShortcutState::Released));
        assert!(!should_open_quick_chat(&other, ShortcutState::Pressed));
    }

    #[test]
    fn the_shortcut_stays_off_unless_explicitly_enabled() {
        assert!(!quick_chat_shortcut_enabled_from_preferences(None));
        assert!(!quick_chat_shortcut_enabled_from_preferences(Some(
            "not json"
        )));
        assert!(!quick_chat_shortcut_enabled_from_preferences(Some("{}")));
        assert!(!quick_chat_shortcut_enabled_from_preferences(Some(
            r#"{"general":{}}"#
        )));
        assert!(!quick_chat_shortcut_enabled_from_preferences(Some(
            r#"{"general":{"quickChatShortcut":"true"}}"#
        )));
        assert!(!quick_chat_shortcut_enabled_from_preferences(Some(
            r#"{"general":{"quickChatShortcut":false}}"#
        )));
        assert!(quick_chat_shortcut_enabled_from_preferences(Some(
            r#"{"general":{"quickChatShortcut":true}}"#
        )));
    }
}
