use std::collections::BTreeSet;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

pub(super) const PRIMARY_MAIN_WINDOW_LABEL: &str = "main";
const SECONDARY_MAIN_WINDOW_PREFIX: &str = "main-";

#[derive(Default)]
struct MainWindowRegistryInner {
    labels: BTreeSet<String>,
    focused: Option<String>,
}

#[derive(Default)]
pub(super) struct MainWindowRegistry(Mutex<MainWindowRegistryInner>);

pub(super) fn is_main_window_label(label: &str) -> bool {
    if label == PRIMARY_MAIN_WINDOW_LABEL {
        return true;
    }
    let Some(identity) = label.strip_prefix(SECONDARY_MAIN_WINDOW_PREFIX) else {
        return false;
    };
    let boundary_is_alphanumeric = identity
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
        && identity
            .chars()
            .next_back()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    !identity.is_empty()
        && identity.len() <= 64
        && boundary_is_alphanumeric
        && !identity.contains("--")
        && identity
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

impl MainWindowRegistry {
    pub(super) fn register(&self, label: &str) -> Result<(), String> {
        if !is_main_window_label(label) {
            return Err(format!("'{label}' is not a valid main-window label"));
        }
        let mut inner = self
            .0
            .lock()
            .map_err(|_| "main-window registry lock is poisoned".to_string())?;
        inner.labels.insert(label.to_string());
        inner.focused = Some(label.to_string());
        Ok(())
    }

    pub(super) fn note_focused(&self, label: &str) {
        if let Ok(mut inner) = self.0.lock() {
            if inner.labels.contains(label) {
                inner.focused = Some(label.to_string());
            }
        }
    }

    pub(super) fn is_registered(&self, label: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|inner| inner.labels.contains(label))
    }

    pub(super) fn remove(&self, label: &str) {
        if let Ok(mut inner) = self.0.lock() {
            inner.labels.remove(label);
            if inner.focused.as_deref() == Some(label) {
                inner.focused = None;
            }
        }
    }

    fn preferred_label(&self, live_labels: &BTreeSet<String>) -> Option<String> {
        let inner = self.0.lock().ok()?;
        inner
            .focused
            .as_ref()
            .filter(|label| live_labels.contains(*label))
            .cloned()
            .or_else(|| {
                live_labels
                    .contains(PRIMARY_MAIN_WINDOW_LABEL)
                    .then(|| PRIMARY_MAIN_WINDOW_LABEL.to_string())
            })
            .or_else(|| live_labels.first().cloned())
    }
}

pub(super) fn register_main_window(app: &AppHandle, label: &str) -> Result<(), String> {
    app.state::<MainWindowRegistry>().register(label)
}

pub(super) fn is_registered_main_window(app: &AppHandle, label: &str) -> bool {
    app.state::<MainWindowRegistry>().is_registered(label)
}

pub(super) fn main_webview_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    let registry = app.state::<MainWindowRegistry>();
    let mut windows = app
        .webview_windows()
        .into_values()
        .filter(|window| registry.is_registered(window.label()))
        .collect::<Vec<_>>();
    windows.sort_by(|left, right| left.label().cmp(right.label()));
    windows
}

pub(super) fn preferred_main_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = main_webview_windows(app);
    if let Some(window) = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
    {
        app.state::<MainWindowRegistry>()
            .note_focused(window.label());
        return Some(window.clone());
    }

    let live_labels = windows
        .iter()
        .map(|window| window.label().to_string())
        .collect::<BTreeSet<_>>();
    let preferred = app
        .state::<MainWindowRegistry>()
        .preferred_label(&live_labels)?;
    windows
        .into_iter()
        .find(|window| window.label() == preferred)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_labels_are_narrow_and_explicit() {
        assert!(is_main_window_label("main"));
        assert!(is_main_window_label("main-2"));
        assert!(is_main_window_label("main-project_alpha"));
        assert!(!is_main_window_label("quick-chat"));
        assert!(!is_main_window_label("main-"));
        assert!(!is_main_window_label("main--alpha"));
        assert!(!is_main_window_label("main-alpha--beta"));
        assert!(!is_main_window_label("main-alpha-"));
        assert!(!is_main_window_label("main-project.alpha"));
        assert!(!is_main_window_label("main-project/alpha"));
    }

    #[test]
    fn registry_prefers_last_focused_live_window_then_primary() {
        let registry = MainWindowRegistry::default();
        registry.note_focused("main-2");
        assert!(!registry.is_registered("main-2"));
        registry.register("main").expect("register primary");
        registry.register("main-2").expect("register secondary");
        assert!(registry.is_registered("main-2"));

        let both = BTreeSet::from(["main".to_string(), "main-2".to_string()]);
        assert_eq!(registry.preferred_label(&both).as_deref(), Some("main-2"));

        let primary_only = BTreeSet::from(["main".to_string()]);
        assert_eq!(
            registry.preferred_label(&primary_only).as_deref(),
            Some("main")
        );

        registry.remove("main-2");
        assert!(!registry.is_registered("main-2"));
    }
}
