use super::*;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct BrowserNavigationIntent {
    pub(super) sequence: u64,
    pub(super) url: String,
    pub(super) read_only_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct BrowserBoundsIntent {
    pub(super) sequence: u64,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) w: f64,
    pub(super) h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BrowserVisibility {
    Visible,
    Hidden,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BrowserVisibilityIntent {
    pub(super) sequence: u64,
    pub(super) value: BrowserVisibility,
}

#[derive(Clone, Debug, Default)]
pub(super) struct BrowserLabelIntent {
    pub(super) latest_sequence: u64,
    pub(super) navigation: Option<BrowserNavigationIntent>,
    pub(super) bounds: Option<BrowserBoundsIntent>,
    pub(super) visibility: Option<BrowserVisibilityIntent>,
    pub(super) reload_sequence: Option<u64>,
    pub(super) applied_navigation_sequence: Option<u64>,
    pub(super) applied_reload_sequence: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BrowserScopeAction {
    Hide,
    Close,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct BrowserScopeBarrier {
    pub(super) sequence: u64,
    pub(super) action: BrowserScopeAction,
    pub(super) except_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct EffectiveBrowserIntent {
    pub(super) revision: u64,
    pub(super) navigation: Option<BrowserNavigationIntent>,
    pub(super) bounds: Option<BrowserBoundsIntent>,
    pub(super) visibility: BrowserVisibility,
    pub(super) reload_sequence: Option<u64>,
    pub(super) applied_navigation_sequence: Option<u64>,
    pub(super) applied_reload_sequence: Option<u64>,
}

#[derive(Default)]
pub(super) struct BrowserLifecycleInner {
    pub(super) labels: HashMap<String, BrowserLabelIntent>,
    pub(super) scope_barriers: HashMap<String, BrowserScopeBarrier>,
    pub(super) worker_locks: HashMap<String, Arc<Mutex<()>>>,
    pub(super) worker_signals: HashMap<String, Arc<BrowserWorkerSignal>>,
    pub(super) event_trackers: HashMap<String, Arc<Mutex<BrowserEventTracker>>>,
}

#[derive(Default)]
pub(super) struct BrowserWorkerSignal {
    pub(super) running: AtomicBool,
    pub(super) dirty: AtomicBool,
}

/// Orders native WebView lifecycle intents and rejects commands from an older
/// renderer intent. The lock is never held across a WebView2 call: child
/// creation can synchronously trigger a bounds command, and holding it there
/// deadlocks both commands. Without the sequence guard, passive cleanup from an
/// unmounted BrowserPane can win over a newer navigate/set-bounds and leave an
/// invisible WebView2 input surface above the app.
#[derive(Clone, Default)]
pub struct BrowserLifecycleState(Arc<Mutex<BrowserLifecycleInner>>);

impl BrowserLifecycleState {
    pub(super) fn lock(&self) -> Result<MutexGuard<'_, BrowserLifecycleInner>, String> {
        self.0
            .lock()
            .map_err(|_| "browser lifecycle lock is poisoned".to_string())
    }
}

fn latest_scope_barrier<'a>(
    inner: &'a BrowserLifecycleInner,
    label: &str,
) -> Option<&'a BrowserScopeBarrier> {
    inner
        .scope_barriers
        .iter()
        .filter(|(prefix, barrier)| {
            label.starts_with(prefix.as_str()) && barrier.except_label.as_deref() != Some(label)
        })
        .map(|(_, barrier)| barrier)
        .max_by_key(|barrier| barrier.sequence)
}

fn command_sequence_is_current(inner: &BrowserLifecycleInner, label: &str, sequence: u64) -> bool {
    if latest_scope_barrier(inner, label).is_some_and(|barrier| sequence < barrier.sequence) {
        return false;
    }
    inner
        .labels
        .get(label)
        .is_none_or(|intent| sequence >= intent.latest_sequence)
}

pub(super) fn record_navigation_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    sequence: u64,
    url: String,
    read_only_url: Option<String>,
    bounds: BrowserBoundsIntent,
) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    intent.navigation = Some(BrowserNavigationIntent {
        sequence,
        url,
        read_only_url,
    });
    intent.bounds = Some(bounds);
    intent.visibility = Some(BrowserVisibilityIntent {
        sequence,
        value: BrowserVisibility::Visible,
    });
    true
}

pub(super) fn record_bounds_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    bounds: BrowserBoundsIntent,
) -> bool {
    if !command_sequence_is_current(inner, label, bounds.sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = bounds.sequence;
    intent.bounds = Some(bounds);
    if intent.visibility.map(|value| value.value) == Some(BrowserVisibility::Closed) {
        return false;
    }
    intent.visibility = Some(BrowserVisibilityIntent {
        sequence: bounds.sequence,
        value: BrowserVisibility::Visible,
    });
    true
}

pub(super) fn record_visibility_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    sequence: u64,
    visibility: BrowserVisibility,
) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    if intent.visibility.map(|value| value.value) != Some(BrowserVisibility::Closed)
        || visibility == BrowserVisibility::Closed
    {
        intent.visibility = Some(BrowserVisibilityIntent {
            sequence,
            value: visibility,
        });
    }
    if visibility == BrowserVisibility::Closed {
        intent.navigation = None;
        intent.reload_sequence = None;
        intent.applied_navigation_sequence = None;
        intent.applied_reload_sequence = None;
    }
    true
}

pub(super) fn record_reload_intent(
    inner: &mut BrowserLifecycleInner,
    label: &str,
    sequence: u64,
) -> bool {
    if !command_sequence_is_current(inner, label, sequence) {
        return false;
    }
    let intent = inner.labels.entry(label.to_string()).or_default();
    intent.latest_sequence = sequence;
    if intent.visibility.map(|value| value.value) == Some(BrowserVisibility::Closed) {
        return false;
    }
    intent.reload_sequence = Some(sequence);
    true
}

pub(super) fn effective_browser_intent(
    inner: &BrowserLifecycleInner,
    label: &str,
) -> Option<EffectiveBrowserIntent> {
    let label_intent = inner.labels.get(label)?;
    let mut revision = label_intent.latest_sequence;
    let mut visibility = label_intent.visibility.unwrap_or(BrowserVisibilityIntent {
        sequence: 0,
        value: BrowserVisibility::Hidden,
    });
    if let Some(barrier) = latest_scope_barrier(inner, label) {
        revision = revision.max(barrier.sequence);
        if barrier.sequence > visibility.sequence {
            visibility = BrowserVisibilityIntent {
                sequence: barrier.sequence,
                value: match barrier.action {
                    BrowserScopeAction::Hide => BrowserVisibility::Hidden,
                    BrowserScopeAction::Close => BrowserVisibility::Closed,
                },
            };
        }
    }
    Some(EffectiveBrowserIntent {
        revision,
        navigation: label_intent.navigation.clone(),
        bounds: label_intent.bounds,
        visibility: visibility.value,
        reload_sequence: label_intent.reload_sequence,
        applied_navigation_sequence: label_intent.applied_navigation_sequence,
        applied_reload_sequence: label_intent.applied_reload_sequence,
    })
}

pub(super) fn advance_scope_barrier(
    inner: &mut BrowserLifecycleInner,
    prefix: &str,
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
) -> bool {
    if inner
        .scope_barriers
        .get(prefix)
        .is_some_and(|barrier| sequence < barrier.sequence)
    {
        return false;
    }
    inner.scope_barriers.insert(
        prefix.to_string(),
        BrowserScopeBarrier {
            sequence,
            action,
            except_label,
        },
    );
    true
}

pub(super) fn record_scope_intent(
    inner: &mut BrowserLifecycleInner,
    prefix: &str,
    sequence: u64,
    action: BrowserScopeAction,
    except_label: Option<String>,
    existing_labels: impl IntoIterator<Item = String>,
) -> bool {
    if !advance_scope_barrier(inner, prefix, sequence, action, except_label.clone()) {
        return false;
    }

    for label in existing_labels {
        if !label.starts_with(prefix) || except_label.as_deref() == Some(label.as_str()) {
            continue;
        }
        let intent = inner.labels.entry(label).or_default();
        if sequence < intent.latest_sequence {
            continue;
        }
        intent.latest_sequence = sequence;
        intent.visibility = Some(BrowserVisibilityIntent {
            sequence,
            value: match action {
                BrowserScopeAction::Hide => BrowserVisibility::Hidden,
                BrowserScopeAction::Close => BrowserVisibility::Closed,
            },
        });
        if action == BrowserScopeAction::Close {
            intent.navigation = None;
            intent.reload_sequence = None;
            intent.applied_navigation_sequence = None;
            intent.applied_reload_sequence = None;
        }
    }
    true
}
