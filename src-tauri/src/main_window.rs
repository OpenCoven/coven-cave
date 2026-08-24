use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

pub(super) const PRIMARY_MAIN_WINDOW_LABEL: &str = "main";
const SECONDARY_MAIN_WINDOW_PREFIX: &str = "main-";
const SECONDARY_MAIN_WINDOW_PERMISSIONS: [&str; 16] = [
    "allow-pty-start",
    "allow-pty-write",
    "allow-pty-resize",
    "allow-pty-stop",
    "allow-pty-list",
    "allow-pty-diagnose",
    "allow-browser-navigate",
    "allow-browser-set-bounds",
    "allow-browser-hide",
    "allow-browser-hide-all-except",
    "allow-browser-close",
    "allow-browser-deactivate-all",
    "allow-browser-close-all",
    "allow-browser-reload",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
];

#[derive(Default)]
struct MainWindowRegistryInner {
    labels: BTreeSet<String>,
    retired_labels: BTreeSet<String>,
    generations: BTreeMap<String, u64>,
    next_generation: u64,
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
        if inner.retired_labels.contains(label) {
            return Err(format!(
                "main-window label '{label}' was retired and cannot be reused"
            ));
        }
        if inner.labels.insert(label.to_string()) {
            inner.next_generation = inner
                .next_generation
                .checked_add(1)
                .ok_or_else(|| "main-window generation overflow".to_string())?;
            let generation = inner.next_generation;
            inner.generations.insert(label.to_string(), generation);
        }
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

    pub(super) fn generation(&self, label: &str) -> Option<u64> {
        self.0
            .lock()
            .ok()
            .and_then(|inner| inner.generations.get(label).copied())
    }

    pub(super) fn remove(&self, label: &str) -> Option<u64> {
        if let Ok(mut inner) = self.0.lock() {
            inner.labels.remove(label);
            let generation = inner.generations.remove(label);
            if generation.is_some() {
                inner.retired_labels.insert(label.to_string());
            }
            if inner.focused.as_deref() == Some(label) {
                inner.focused = None;
            }
            return generation;
        }
        None
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
    let registry = app.state::<MainWindowRegistry>();
    let was_registered = registry.is_registered(label);
    registry.register(label)?;
    if label != PRIMARY_MAIN_WINDOW_LABEL && !was_registered {
        if let Err(error) = grant_secondary_main_window_capabilities(app, label) {
            registry.remove(label);
            return Err(error);
        }
    }
    Ok(())
}

fn grant_secondary_main_window_capabilities(app: &AppHandle, label: &str) -> Result<(), String> {
    let capabilities = secondary_main_window_capabilities(label)?;
    let serialized = serde_json::to_string(&capabilities)
        .map_err(|error| format!("could not serialize main-window capabilities: {error}"))?;
    app.add_capability(serialized)
        .map_err(|error| format!("could not grant '{label}' main-window authority: {error}"))
}

fn secondary_main_window_capabilities(label: &str) -> Result<Vec<serde_json::Value>, String> {
    if !is_main_window_label(label) || label == PRIMARY_MAIN_WINDOW_LABEL {
        return Err(format!(
            "'{label}' is not a valid secondary main-window label"
        ));
    }
    Ok(vec![serde_json::json!({
        "identifier": format!("secondary-main-runtime-{label}"),
        "webviews": [label],
        "permissions": SECONDARY_MAIN_WINDOW_PERMISSIONS,
    })])
}

pub(super) fn is_registered_main_window(app: &AppHandle, label: &str) -> bool {
    app.state::<MainWindowRegistry>().is_registered(label)
}

pub(super) fn registered_main_window_generation(app: &AppHandle, label: &str) -> Option<u64> {
    app.state::<MainWindowRegistry>().generation(label)
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
    fn secondary_capabilities_target_only_the_exact_registered_label() {
        let capabilities =
            secondary_main_window_capabilities("main-2").expect("secondary capabilities");
        assert_eq!(capabilities.len(), 1);
        for capability in capabilities {
            assert_eq!(capability["webviews"], serde_json::json!(["main-2"]));
            assert!(capability["identifier"]
                .as_str()
                .is_some_and(|identifier| identifier == "secondary-main-runtime-main-2"));
            let permissions = capability["permissions"]
                .as_array()
                .expect("secondary permissions");
            assert!(permissions
                .iter()
                .any(|permission| permission == "allow-pty-start"));
            assert!(permissions
                .iter()
                .any(|permission| permission == "allow-browser-navigate"));
            for forbidden in [
                "updater:default",
                "process:default",
                "allow-open-x-oauth-url",
            ] {
                assert!(!permissions.iter().any(|permission| permission == forbidden));
            }
        }
        assert!(secondary_main_window_capabilities("main--unmanaged").is_err());
        assert!(secondary_main_window_capabilities(PRIMARY_MAIN_WINDOW_LABEL).is_err());
    }

    #[test]
    fn registry_prefers_last_focused_live_window_then_primary() {
        let registry = MainWindowRegistry::default();
        registry.note_focused("main-2");
        assert!(!registry.is_registered("main-2"));
        registry.register("main").expect("register primary");
        registry.register("main-2").expect("register secondary");
        assert!(registry.is_registered("main-2"));
        let first_generation = registry
            .generation("main-2")
            .expect("registered secondary generation");

        let both = BTreeSet::from(["main".to_string(), "main-2".to_string()]);
        assert_eq!(registry.preferred_label(&both).as_deref(), Some("main-2"));

        let primary_only = BTreeSet::from(["main".to_string()]);
        assert_eq!(
            registry.preferred_label(&primary_only).as_deref(),
            Some("main")
        );

        registry.remove("main-2");
        assert!(!registry.is_registered("main-2"));
        let error = registry
            .register("main-2")
            .expect_err("retired native labels must never inherit permanent capabilities");
        assert!(error.contains("cannot be reused"));
        assert_eq!(registry.generation("main-2"), None);
        assert!(first_generation > 0);
    }
}
