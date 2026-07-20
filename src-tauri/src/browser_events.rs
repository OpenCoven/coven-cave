use super::*;

struct PendingUserNavigation {
    sequence: u64,
    target: String,
    allow_query_change: bool,
    started: Instant,
}

#[derive(Default)]
pub(super) struct BrowserEventTracker {
    pub(super) pending: Option<(u64, String)>,
    pending_user_navigation: Option<PendingUserNavigation>,
    active_sequence: u64,
    active_url: Option<String>,
    active_completed: bool,
    pub(super) sequence_by_url: HashMap<String, u64>,
}

impl BrowserEventTracker {
    pub(super) fn normalized_url(raw: &str) -> String {
        Url::parse(raw)
            .map(|mut url| {
                url.set_fragment(None);
                url.to_string()
            })
            .unwrap_or_else(|_| raw.to_string())
    }

    pub(super) fn normalized_route(url: &Url) -> String {
        let mut url = url.clone();
        url.set_fragment(None);
        url.set_query(None);
        url.to_string()
    }

    pub(super) fn expect_navigation(&mut self, sequence: u64, url: &str) {
        let url = Self::normalized_url(url);
        self.pending = Some((sequence, url));
        self.pending_user_navigation = None;
    }

    pub(super) fn begin_user_navigation(&mut self, target: &Url, allow_query_change: bool) -> u64 {
        // A main-renderer navigation always wins a race with the old child
        // page. Otherwise a click on the page being replaced could consume
        // the newer generated navigation and mislabel its events.
        if self.pending.is_some() {
            return 0;
        }
        let target = Self::normalized_url(target.as_str());
        if let Some(pending) = self.pending_user_navigation.as_ref() {
            if pending.started.elapsed() <= USER_NAVIGATION_MARKER_TTL
                && pending.target == target
                && pending.allow_query_change == allow_query_change
            {
                return pending.sequence;
            }
        }
        let sequence = self.active_sequence.saturating_add(1).max(1);
        self.pending_user_navigation = Some(PendingUserNavigation {
            sequence,
            target,
            allow_query_change,
            started: Instant::now(),
        });
        sequence
    }

    pub(super) fn remember_sequence(&mut self, normalized: String, sequence: u64) {
        if !self.sequence_by_url.contains_key(&normalized)
            && self.sequence_by_url.len() >= MAX_TRACKED_BROWSER_URLS
        {
            let active = self
                .active_url
                .as_ref()
                .map(|url| (url.clone(), self.active_sequence));
            self.sequence_by_url.clear();
            if let Some((url, sequence)) = active {
                self.sequence_by_url.insert(url, sequence);
            }
        }
        self.sequence_by_url.insert(normalized, sequence);
    }

    pub(super) fn activate(&mut self, sequence: u64, normalized: String) -> u64 {
        self.active_sequence = sequence;
        self.active_url = Some(normalized.clone());
        self.active_completed = false;
        self.pending = None;
        self.pending_user_navigation = None;
        self.remember_sequence(normalized, sequence);
        sequence
    }

    pub(super) fn observe_navigation(&mut self, url: &Url) -> u64 {
        let normalized = Self::normalized_url(url.as_str());
        if let Some((sequence, expected)) = self.pending.as_ref() {
            if *expected == normalized {
                let sequence = *sequence;
                return self.activate(sequence, normalized);
            }
        }
        if let Some(pending) = self.pending_user_navigation.take() {
            if pending.started.elapsed() <= USER_NAVIGATION_MARKER_TTL {
                let target_matches = pending.target == normalized
                    || (pending.allow_query_change
                        && Url::parse(&pending.target).is_ok_and(|target| {
                            Self::normalized_route(&target) == Self::normalized_route(url)
                        }));
                if target_matches {
                    return self.activate(pending.sequence, normalized);
                }
                self.pending_user_navigation = Some(pending);
            }
        }
        if let Some(sequence) = self.sequence_by_url.get(&normalized).copied() {
            return sequence;
        }
        if self.pending.is_none() && self.active_sequence != 0 && !self.active_completed {
            self.remember_sequence(normalized, self.active_sequence);
            return self.active_sequence;
        }
        0
    }

    pub(super) fn sequence_for_event(&mut self, url: &Url, started: bool, finished: bool) -> u64 {
        let normalized = Self::normalized_url(url.as_str());
        // Only a NavigationStarting signal may claim a pending generation or
        // extend its redirect chain. A delayed Finished/title callback from a
        // previous visit to the same URL must remain on its old generation.
        let sequence = if started {
            self.observe_navigation(url)
        } else {
            self.sequence_by_url.get(&normalized).copied().unwrap_or(0)
        };
        if finished && sequence != 0 && sequence == self.active_sequence {
            self.active_completed = true;
        }
        sequence
    }
}
