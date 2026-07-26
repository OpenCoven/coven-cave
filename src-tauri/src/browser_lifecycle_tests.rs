use super::{
    advance_scope_barrier, browser_bounds_within_client, effective_browser_intent,
    offscreen_browser_creation_bounds, offscreen_browser_position, record_bounds_intent,
    record_navigation_intent, record_scope_intent, record_visibility_intent, BrowserBounds,
    BrowserBoundsIntent, BrowserEventTracker, BrowserLifecycleInner, BrowserScopeAction,
    BrowserVisibility, EnvironmentCallbackTimeoutAction, EnvironmentCallbackTimeoutRetryState, Url,
    MAX_TRACKED_BROWSER_URLS, USER_NAVIGATION_MARKER_TTL,
};
use std::time::{Duration, Instant};

const LABEL: &str = "cave-browser-main-tab-home";

fn bounds(sequence: u64) -> BrowserBoundsIntent {
    BrowserBoundsIntent {
        sequence,
        x: 100.0,
        y: 50.0,
        w: 800.0,
        h: 600.0,
    }
}

fn navigate(lifecycle: &mut BrowserLifecycleInner, sequence: u64, url: &str) -> bool {
    record_navigation_intent(
        lifecycle,
        LABEL,
        sequence,
        url.to_string(),
        None,
        bounds(sequence),
    )
}

#[test]
fn newest_navigation_wins_even_when_workers_would_finish_out_of_order() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
    assert!(navigate(
        &mut lifecycle,
        22,
        "https://github.com/OpenCoven/coven-cave",
    ));
    assert!(!navigate(&mut lifecycle, 21, "https://pod.opencoven.ai"));

    let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
    assert_eq!(
        effective.navigation.expect("navigation").url,
        "https://github.com/OpenCoven/coven-cave",
    );
    assert_eq!(effective.visibility, BrowserVisibility::Visible);
}

#[test]
fn navigate_then_hide_keeps_loading_intent_but_never_exposes_input_layer() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
    assert!(record_visibility_intent(
        &mut lifecycle,
        LABEL,
        21,
        BrowserVisibility::Hidden,
    ));

    let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
    assert_eq!(effective.visibility, BrowserVisibility::Hidden);
    assert_eq!(
        effective
            .navigation
            .expect("hidden navigation retained")
            .url,
        "https://docs.opencoven.ai",
    );
}

#[test]
fn close_during_creation_cannot_be_resurrected_by_late_bounds() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
    assert!(record_visibility_intent(
        &mut lifecycle,
        LABEL,
        21,
        BrowserVisibility::Closed,
    ));
    assert!(!record_bounds_intent(&mut lifecycle, LABEL, bounds(22)));

    let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
    assert_eq!(effective.visibility, BrowserVisibility::Closed);
    assert!(effective.navigation.is_none());
}

#[test]
fn pane_barrier_rejects_late_worker_and_allows_new_navigation() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
    assert!(advance_scope_barrier(
        &mut lifecycle,
        "cave-browser-main-tab-",
        40,
        BrowserScopeAction::Hide,
        None,
    ));
    assert!(!navigate(&mut lifecycle, 39, "https://pod.opencoven.ai",));
    assert_eq!(
        effective_browser_intent(&lifecycle, LABEL)
            .expect("hidden effective intent")
            .visibility,
        BrowserVisibility::Hidden,
    );
    assert!(navigate(
        &mut lifecycle,
        41,
        "https://github.com/OpenCoven/coven-cave",
    ));
    assert_eq!(
        effective_browser_intent(&lifecycle, LABEL)
            .expect("reactivated effective intent")
            .visibility,
        BrowserVisibility::Visible,
    );
}

#[test]
fn delayed_scope_hide_cannot_override_newer_visible_label_intent() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(
        &mut lifecycle,
        101,
        "https://github.com/OpenCoven/coven-cave",
    ));
    assert!(record_scope_intent(
        &mut lifecycle,
        "cave-browser-main-tab-",
        100,
        BrowserScopeAction::Hide,
        None,
        [LABEL.to_string()],
    ));
    assert_eq!(
        effective_browser_intent(&lifecycle, LABEL)
            .expect("effective intent")
            .visibility,
        BrowserVisibility::Visible,
    );
}

#[test]
fn close_all_requires_a_new_navigation_before_bounds_can_reopen() {
    let mut lifecycle = BrowserLifecycleInner::default();
    assert!(navigate(&mut lifecycle, 20, "https://docs.opencoven.ai"));
    assert!(record_scope_intent(
        &mut lifecycle,
        "cave-browser-main-tab-",
        21,
        BrowserScopeAction::Close,
        None,
        [LABEL.to_string()],
    ));
    assert!(!record_bounds_intent(&mut lifecycle, LABEL, bounds(22)));
    let effective = effective_browser_intent(&lifecycle, LABEL).expect("effective intent");
    assert_eq!(effective.visibility, BrowserVisibility::Closed);
    assert!(effective.navigation.is_none());
    assert!(navigate(
        &mut lifecycle,
        23,
        "https://github.com/OpenCoven/coven-cave",
    ));
    assert_eq!(
        effective_browser_intent(&lifecycle, LABEL)
            .expect("reopened intent")
            .visibility,
        BrowserVisibility::Visible,
    );
}

#[test]
fn native_event_generations_distinguish_old_completion_from_new_redirect() {
    let mut tracker = BrowserEventTracker::default();
    let docs = Url::parse("https://docs.opencoven.ai").expect("docs URL");
    let github = Url::parse("https://github.com/OpenCoven/coven-cave").expect("github URL");
    tracker.expect_navigation(20, docs.as_str());
    assert_eq!(tracker.observe_navigation(&docs), 20);
    tracker.expect_navigation(21, github.as_str());
    assert_eq!(
        tracker.sequence_for_event(&docs, false, true),
        20,
        "old finish keeps its old generation"
    );
    assert_eq!(tracker.observe_navigation(&github), 21);

    let invite = Url::parse("https://discord.gg/opencoven").expect("invite URL");
    let redirect = Url::parse("https://discord.com/invite/opencoven").expect("redirect URL");
    tracker.expect_navigation(22, invite.as_str());
    assert_eq!(tracker.observe_navigation(&invite), 22);
    assert_eq!(tracker.observe_navigation(&redirect), 22);
    assert_eq!(tracker.sequence_for_event(&redirect, false, true), 22);

    let late_redirect =
        Url::parse("https://docs.opencoven.ai/late-redirect").expect("late redirect URL");
    assert_eq!(
        tracker.observe_navigation(&late_redirect),
        0,
        "an unknown redirect after the newest finish is not stamped as newest"
    );
    assert_eq!(tracker.sequence_for_event(&late_redirect, true, false), 0);
    assert_eq!(tracker.sequence_for_event(&late_redirect, false, true), 0);

    let user_target = Url::parse("https://discord.com/channels/@me").expect("user target URL");
    assert_eq!(tracker.begin_user_navigation(&user_target, false), 23);
    assert_eq!(tracker.observe_navigation(&user_target), 23);
    assert_eq!(tracker.sequence_for_event(&user_target, false, true), 23);

    tracker.expect_navigation(30, docs.as_str());
    assert_eq!(
        tracker.begin_user_navigation(&user_target, false),
        0,
        "a child report cannot supersede a pending main-renderer navigation"
    );
    assert_eq!(tracker.observe_navigation(&docs), 30);
}

#[test]
fn revisited_url_does_not_claim_pending_generation_until_navigation_starts() {
    let mut tracker = BrowserEventTracker::default();
    let first = Url::parse("https://docs.opencoven.ai").expect("first URL");
    let second = Url::parse("https://github.com/OpenCoven/coven-cave").expect("second URL");

    tracker.expect_navigation(20, first.as_str());
    assert_eq!(tracker.observe_navigation(&first), 20);
    assert_eq!(tracker.sequence_for_event(&first, false, true), 20);
    tracker.expect_navigation(21, second.as_str());
    assert_eq!(tracker.observe_navigation(&second), 21);
    assert_eq!(tracker.sequence_for_event(&second, false, true), 21);

    tracker.expect_navigation(22, first.as_str());
    assert_eq!(
        tracker.sequence_for_event(&first, false, false),
        20,
        "a delayed old title keeps the first visit's generation"
    );
    assert_eq!(
        tracker.sequence_for_event(&first, false, true),
        20,
        "a delayed old finish cannot activate the pending revisit"
    );
    assert_eq!(tracker.pending.as_ref().map(|pending| pending.0), Some(22));
    assert_eq!(tracker.sequence_for_event(&first, true, false), 22);
    assert_eq!(tracker.sequence_for_event(&first, false, true), 22);
}

#[test]
fn user_marker_is_destination_bound_expires_and_url_history_is_bounded() {
    let mut tracker = BrowserEventTracker::default();
    let current = Url::parse("https://docs.opencoven.ai").expect("current URL");
    let target = Url::parse("https://docs.opencoven.ai/search?q=coven").expect("target URL");
    let unrelated = Url::parse("https://pod.opencoven.ai/late").expect("unrelated URL");
    tracker.expect_navigation(40, current.as_str());
    assert_eq!(tracker.observe_navigation(&current), 40);
    assert_eq!(tracker.sequence_for_event(&current, false, true), 40);

    assert_eq!(tracker.begin_user_navigation(&target, false), 41);
    assert_eq!(
        tracker.observe_navigation(&unrelated),
        0,
        "an unrelated late redirect cannot consume a destination-bound marker"
    );
    assert_eq!(tracker.observe_navigation(&target), 41);
    assert_eq!(tracker.sequence_for_event(&target, false, true), 41);

    assert_eq!(tracker.begin_user_navigation(&unrelated, false), 42);
    tracker
        .pending_user_navigation
        .as_mut()
        .expect("pending user marker")
        .started = Instant::now() - USER_NAVIGATION_MARKER_TTL - Duration::from_millis(1);
    let expired_target = unrelated.clone();
    assert_eq!(tracker.observe_navigation(&expired_target), 0);

    for index in 0..(MAX_TRACKED_BROWSER_URLS * 3) {
        tracker.remember_sequence(format!("https://example.com/{index}"), 41);
    }
    assert!(tracker.sequence_by_url.len() <= MAX_TRACKED_BROWSER_URLS);
    assert_eq!(
        tracker
            .sequence_by_url
            .get(&BrowserEventTracker::normalized_url(target.as_str())),
        Some(&41),
        "pruning retains the active URL generation"
    );
}

#[test]
fn browser_bounds_are_finite_and_contained_in_the_client() {
    assert_eq!(
        browser_bounds_within_client(1000.0, 700.0, 100.0, 50.0, 5000.0, 5000.0),
        Ok(BrowserBounds::Visible {
            x: 100.0,
            y: 50.0,
            w: 900.0,
            h: 650.0,
        }),
    );
    assert!(browser_bounds_within_client(1000.0, 700.0, f64::NAN, 0.0, 100.0, 100.0,).is_err());
    assert!(browser_bounds_within_client(f64::INFINITY, 700.0, 0.0, 0.0, 100.0, 100.0,).is_err());
}

#[test]
fn offscreen_collapsed_and_edge_bounds_fail_closed() {
    assert_eq!(
        browser_bounds_within_client(1000.0, 700.0, -10000.0, -10000.0, 500.0, 400.0),
        Ok(BrowserBounds::Hidden { w: 500.0, h: 400.0 }),
    );
    assert!(matches!(
        browser_bounds_within_client(1000.0, 700.0, 0.0, 0.0, 1.0, 400.0),
        Ok(BrowserBounds::Hidden { .. })
    ));
    for x in [999.0, 1000.0, 1200.0] {
        assert!(matches!(
            browser_bounds_within_client(1000.0, 700.0, x, 10.0, 100.0, 100.0),
            Ok(BrowserBounds::Hidden { .. })
        ));
    }
}

#[test]
fn native_child_creation_is_always_realized_offscreen_at_full_size() {
    assert_eq!(
        offscreen_browser_creation_bounds(1000.0, 700.0, 800.0, 600.0),
        Ok((800.0, 600.0)),
    );
    assert_eq!(
        offscreen_browser_creation_bounds(1000.0, 700.0, 5000.0, 5000.0),
        Ok((1000.0, 700.0)),
    );
}

#[test]
fn offscreen_position_excludes_oversized_native_children() {
    assert_eq!(
        offscreen_browser_position(12_000.0, 8_000.0, 20_000.0, 9_000.0),
        Ok((-20_002.0, -9_002.0)),
    );
    assert_eq!(
        offscreen_browser_position(12_000.0, 8_000.0, 600.0, 400.0),
        Ok((-12_002.0, -8_002.0)),
    );
}

#[test]
fn environment_callback_timeout_retries_once_per_unchanged_revision() {
    let mut retry = EnvironmentCallbackTimeoutRetryState::default();

    assert_eq!(
        retry.action(41, false),
        EnvironmentCallbackTimeoutAction::RetryTimedOutIntent
    );
    assert_eq!(
        retry.action(41, false),
        EnvironmentCallbackTimeoutAction::Stop
    );

    assert_eq!(
        retry.action(42, false),
        EnvironmentCallbackTimeoutAction::RetryTimedOutIntent
    );
    assert_eq!(
        retry.action(42, false),
        EnvironmentCallbackTimeoutAction::Stop
    );
}

#[test]
fn environment_callback_timeout_prioritizes_a_newer_dirty_intent() {
    let mut retry = EnvironmentCallbackTimeoutRetryState::default();

    assert_eq!(
        retry.action(41, true),
        EnvironmentCallbackTimeoutAction::ReconcileNewestIntent
    );
    assert_eq!(
        retry.action(42, false),
        EnvironmentCallbackTimeoutAction::RetryTimedOutIntent
    );

    retry.reset();
    assert_eq!(retry, EnvironmentCallbackTimeoutRetryState::default());
}
