use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

pub(super) const PRIMARY_MAIN_WINDOW_LABEL: &str = "main";
const SECONDARY_MAIN_WINDOW_PREFIX: &str = "main-";
// Reuse the primary contracts so permission, origin and platform restrictions stay aligned.
const MAIN_CAPABILITY_TEMPLATES: [&str; 9] = [
    include_str!("../capabilities/default.json"),
    include_str!("../capabilities/loopback-browser.json"),
    include_str!("../capabilities/loopback-main-events.json"),
    include_str!("../capabilities/loopback-window-controls.json"),
    include_str!("../capabilities/loopback-window-drag.json"),
    include_str!("../capabilities/loopback-updater.json"),
    include_str!("../capabilities/loopback-microphone.json"),
    include_str!("../capabilities/loopback-speech.json"),
    include_str!("../capabilities/loopback-x-oauth.json"),
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

/// Process-wide count of live main windows (registered and not yet destroyed).
///
/// Mirrors `MainWindowRegistryInner::labels` but is a lock-free atomic so the
/// Windows native-close subclass — which must not lock, log, allocate, spawn,
/// or enter Tauri — can decide whether closing the primary main window should
/// tear down the whole Cave runtime or just that one window. The registry
/// keeps the count in step with `labels` on every desktop platform.
static LIVE_MAIN_WINDOW_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Lock-free count of live main windows, safe to read from the Win32
/// window-proc subclass that cannot touch the registry's `Mutex`.
#[cfg(target_os = "windows")]
pub(super) fn live_main_window_count() -> usize {
    LIVE_MAIN_WINDOW_COUNT.load(Ordering::SeqCst)
}

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
            LIVE_MAIN_WINDOW_COUNT.fetch_add(1, Ordering::SeqCst);
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
            if inner.labels.remove(label) {
                LIVE_MAIN_WINDOW_COUNT.fetch_sub(1, Ordering::SeqCst);
            }
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
    MAIN_CAPABILITY_TEMPLATES
        .iter()
        .map(|template| {
            let mut capability: serde_json::Value = serde_json::from_str(template)
                .map_err(|error| format!("invalid main-window capability: {error}"))?;
            if capability.get("windows").is_some()
                || !capability["webviews"].as_array().is_some_and(|labels| {
                    labels
                        .iter()
                        .any(|value| value == PRIMARY_MAIN_WINDOW_LABEL)
                })
            {
                return Err("main-window template must scope authority by main webview".to_string());
            }
            let identifier = capability["identifier"]
                .as_str()
                .ok_or("main-window capability has no identifier")?;
            capability["identifier"] =
                serde_json::json!(format!("secondary-main-{identifier}-{label}"));
            capability["webviews"] = serde_json::json!([label]);
            Ok(capability)
        })
        .collect()
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
    fn secondary_main_can_receive_loopback_events() {
        let capabilities = secondary_main_window_capabilities("main-2").unwrap();
        assert!(
            capabilities.iter().any(|capability| {
                capability["permissions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|permission| permission == "core:event:allow-listen")
                    && capability["remote"]["urls"]
                        .as_array()
                        .is_some_and(|urls| urls.iter().any(|url| url == "http://127.0.0.1:*/*"))
            }),
            "secondary main event permission lacks the trusted loopback origin"
        );
    }

    #[test]
    fn secondary_main_has_scoped_native_capabilities() {
        let capabilities = secondary_main_window_capabilities("main-2").unwrap();
        for expected in [
            "updater:default",
            "allow-microphone-permission-request",
            "core:window:allow-start-dragging",
        ] {
            assert!(
                capabilities.iter().any(|capability| {
                    capability["permissions"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|permission| permission == expected)
                }),
                "missing {expected}"
            );
        }
    }

    #[test]
    fn secondary_capabilities_target_only_the_exact_registered_label() {
        let capabilities = secondary_main_window_capabilities("main-2").unwrap();
        let mut identifiers = BTreeSet::new();
        for capability in capabilities {
            assert_eq!(capability["webviews"], serde_json::json!(["main-2"]));
            assert!(capability.get("windows").is_none());
            let identifier = capability["identifier"].as_str().unwrap();
            assert!(identifier.starts_with("secondary-main-"));
            assert!(identifier.ends_with("-main-2"));
            assert!(identifiers.insert(identifier.to_string()));
        }
        for label in [
            "main",
            "quick-chat",
            "notch",
            "browser-main-2",
            "main-2--browser",
            "main-*",
            "main--unmanaged",
        ] {
            assert!(
                secondary_main_window_capabilities(label).is_err(),
                "must reject {label}"
            );
        }
    }

    #[test]
    fn grants_preserve_primary_scopes_and_target_only_secondary_webview() {
        for label in ["main-2", "main-project_alpha"] {
            let caps = secondary_main_window_capabilities(label).unwrap();
            for (mut cap, source) in caps.into_iter().zip(MAIN_CAPABILITY_TEMPLATES) {
                let mut primary: serde_json::Value = serde_json::from_str(source).unwrap();
                assert_eq!(cap["webviews"], serde_json::json!([label]));
                assert!(cap.get("windows").is_none());
                cap.as_object_mut().unwrap().remove("identifier");
                cap.as_object_mut().unwrap().remove("webviews");
                primary.as_object_mut().unwrap().remove("identifier");
                primary.as_object_mut().unwrap().remove("webviews");
                assert_eq!(
                    cap, primary,
                    "origins, permissions, scopes and platforms must stay unchanged"
                );
            }
        }
        for label in [
            "main",
            "quick-chat",
            "notch",
            "browser-main-2",
            "main-2--browser",
            "main-*",
            "main--unmanaged",
        ] {
            assert!(
                secondary_main_window_capabilities(label).is_err(),
                "must reject {label}"
            );
        }
    }

    #[test]
    fn actual_tauri_acl_matches_primary_across_platforms_origins_and_labels() {
        use std::collections::BTreeMap;
        use tauri::utils::{
            acl::{
                capability::Capability,
                manifest::Manifest,
                resolved::{Resolved, ResolvedCommand},
                ExecutionContext,
            },
            platform::Target,
        };
        fn allowed(
            commands: &BTreeMap<String, Vec<ResolvedCommand>>,
            command: &str,
            label: &str,
            origin: Option<&str>,
        ) -> bool {
            commands.get(command).is_some_and(|entries| {
                entries.iter().any(|entry| {
                    let scope = entry.webviews.iter().any(|pattern| pattern.matches(label));
                    let context = match (&entry.context, origin) {
                        (ExecutionContext::Local, None) => true,
                        (ExecutionContext::Remote { url }, Some(origin)) => {
                            url.test(&tauri::Url::parse(origin).unwrap())
                        }
                        _ => false,
                    };
                    scope && context
                })
            })
        }
        let manifests: BTreeMap<String, Manifest> = serde_json::from_str(include_str!(concat!(
            env!("OUT_DIR"),
            "/acl-manifests.json"
        )))
        .unwrap();
        for target in [Target::MacOS, Target::Windows, Target::Linux] {
            let primary_caps: BTreeMap<String, Capability> = std::fs::read_dir(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities"),
            )
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .map(|path| {
                serde_json::from_str::<Capability>(&std::fs::read_to_string(path).unwrap()).unwrap()
            })
            .filter(|capability| {
                capability.windows.is_empty()
                    && capability
                        .webviews
                        .iter()
                        .any(|label| label == PRIMARY_MAIN_WINDOW_LABEL)
            })
            .map(|capability| (capability.identifier.clone(), capability))
            .collect();
            let secondary_caps: BTreeMap<String, Capability> =
                secondary_main_window_capabilities("main-2")
                    .unwrap()
                    .into_iter()
                    .map(|raw| {
                        let c: Capability = serde_json::from_value(raw).unwrap();
                        (c.identifier.clone(), c)
                    })
                    .collect();
            let primary = Resolved::resolve(&manifests, primary_caps, target).unwrap();
            let secondary = Resolved::resolve(&manifests, secondary_caps, target).unwrap();
            for (p, s) in [
                (&primary.allowed_commands, &secondary.allowed_commands),
                (&primary.denied_commands, &secondary.denied_commands),
            ] {
                for command in p.keys().chain(s.keys()) {
                    for origin in [
                        None,
                        Some("http://127.0.0.1:3000/chat"),
                        Some("http://localhost:3000/"),
                        Some("http://[::1]:3000/"),
                        Some("https://evil.example/"),
                        Some("https://github.com/"),
                    ] {
                        assert_eq!(
                            allowed(p, command, "main", origin),
                            allowed(s, command, "main-2", origin),
                            "{target} {command} {origin:?}"
                        );
                        for child in [
                            "main",
                            "quick-chat",
                            "notch",
                            "browser-main-2",
                            "main-2--browser",
                            "main-20",
                        ] {
                            assert!(
                                !allowed(s, command, child, origin),
                                "unexpected authority for {child}"
                            );
                        }
                    }
                }
            }
            assert!(allowed(
                &secondary.allowed_commands,
                "plugin:updater|check",
                "main-2",
                Some("http://127.0.0.1:3000/")
            ));
            assert_eq!(
                allowed(
                    &secondary.allowed_commands,
                    "microphone_permission_request",
                    "main-2",
                    Some("http://127.0.0.1:3000/")
                ),
                target == Target::MacOS
            );
        }
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

    #[test]
    fn closing_a_non_last_main_window_keeps_the_rest_registered() {
        let registry = MainWindowRegistry::default();
        registry.register("main").expect("register primary");
        registry.register("main-2").expect("register secondary");

        // Closing the primary window while a secondary remains open must not
        // retire the secondary: the Cave runtime still has a window to serve.
        registry.remove("main");
        assert!(
            registry.is_registered("main-2"),
            "the still-open secondary window must survive the primary closing"
        );
        assert!(!registry.is_registered("main"));

        // Closing the final window empties the registry — the signal the
        // destruction teardown uses to stop the sidecar and supervisor.
        registry.remove("main-2");
        assert!(!registry.is_registered("main"));
        assert!(!registry.is_registered("main-2"));
    }
}
