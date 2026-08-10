//! Keeps the packaged sidecar alive after it has started.
//!
//! `start_sidecar_runtime` consults `has_exited()` only while WAITING for
//! readiness. Once `wait_for_sidecar_ready` returns `Ready` it hands back the
//! webview URL and nothing looks at the child again — so if node dies an hour
//! later, the window keeps pointing at a dead port. There is no log line, no
//! event, and no recovery: the app simply stops working and the only fix is for
//! the user to quit and relaunch.
//!
//! The one existing recovery entry point, `retry_sidecar_startup`, is
//! `#[cfg(target_os = "windows")]` and manual — a button. macOS and Linux had
//! nothing at all, which is what this module fixes (cave-qg38n).
//!
//! ## Why this can be simple now
//!
//! A respawn has to put the webview back on a working URL, and until recently
//! that URL was unpredictable: `find_free_port()` bound `127.0.0.1:0`, so every
//! start landed on a different port. With the dedicated port (cave-l3vsw) the
//! address is fixed, and the only part of the URL that changes is the auth
//! token — `sidecar_auth_token()` mints a fresh 32 random bytes per start, so a
//! plain `location.reload()` would 401. The webview is therefore re-navigated,
//! reusing the same `location.replace()`-with-`navigate()`-fallback dance the
//! Windows startup path already uses so the dead page does not linger in
//! session history.
//!
//! On Windows every revival is scheduled through `SidecarStartupControl`, the
//! same owner used by initial and manual startup. The supervisor observes that
//! control and never calls `start_sidecar_runtime` beside it, so automatic,
//! manual, and shutdown paths cannot start duplicate process jobs.
//!
//! Startup diagnostics, readiness handshakes and version coherence are NOT
//! this module's business — that is cave-3qas7.6 (#4318), whose design note
//! reads "Cave may supervise process lifecycle, but it must not [...] report
//! readiness before the runtime completes its handshake". This supervises the
//! process; it does not redefine what ready means.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long between liveness checks. A dead sidecar is not an emergency — the
/// user is already looking at a broken window — but every second of this is a
/// second of blank app, so the poll is cheap and frequent rather than lazy.
pub(super) const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_secs(2);
const RECOVERY_MEASUREMENT_TIMEOUT: Duration = Duration::from_secs(90);

/// Revive budget: a burst of attempts, then a cooldown that REFILLS it.
///
/// Mirrors the shape of `createFamiliarLivenessPolicy` in
/// src/lib/familiar-liveness.ts, and for the same reason: a fixed list of
/// attempts that runs out is indistinguishable from giving up permanently,
/// which is the failure that policy was written to end.
///
/// One deliberate difference — no jitter. Jitter exists to decorrelate many
/// independent clients retrying against one server; there is exactly one
/// supervisor per app process, so it would buy nothing here and only make the
/// schedule untestable without injecting an RNG.
#[cfg_attr(not(desktop), allow(dead_code))]
pub(super) struct ReviveBudget {
    burst_attempts: u32,
    base_delay: Duration,
    max_delay: Duration,
    cooldown: Duration,
    attempt: u32,
    bursts: u32,
}

#[cfg_attr(not(desktop), allow(dead_code))]
impl ReviveBudget {
    pub(super) fn new(
        burst_attempts: u32,
        base_delay: Duration,
        max_delay: Duration,
        cooldown: Duration,
    ) -> Self {
        Self {
            burst_attempts,
            base_delay,
            max_delay,
            cooldown,
            attempt: 0,
            bursts: 0,
        }
    }

    /// A first attempt that is nearly immediate (the common case is a one-off
    /// crash), then 2s, 4s, and 8s before fifteen minutes of quiet and a refill.
    pub(super) fn defaults() -> Self {
        Self::new(
            4,
            Duration::from_secs(2),
            Duration::from_secs(60),
            Duration::from_secs(900),
        )
    }

    /// The wait before the next revive, or `None` when the burst is spent —
    /// in which case the caller waits `cooldown()` and calls `refill()`.
    pub(super) fn next_delay(&mut self) -> Option<Duration> {
        if self.attempt >= self.burst_attempts {
            return None;
        }
        let delay = if self.attempt == 0 {
            Duration::from_millis(250)
        } else {
            let scaled = self
                .base_delay
                .saturating_mul(1u32 << (self.attempt - 1).min(16));
            scaled.min(self.max_delay)
        };
        self.attempt += 1;
        Some(delay)
    }

    pub(super) fn cooldown(&self) -> Duration {
        self.cooldown
    }

    /// Refill after a cooldown. The familiar is never permanently written off.
    pub(super) fn refill(&mut self) {
        self.attempt = 0;
        self.bursts += 1;
    }

    /// Proof it is back: a later, unrelated crash gets a full budget rather
    /// than the exhausted tail of this one.
    pub(super) fn recovered(&mut self) {
        self.attempt = 0;
        self.bursts = 0;
    }

    pub(super) fn attempt(&self) -> u32 {
        self.attempt
    }

    pub(super) fn bursts(&self) -> u32 {
        self.bursts
    }
}

/// Shared stop flag. The teardown path kills the sidecar deliberately, and the
/// watcher must be able to tell that apart from a crash — otherwise quitting
/// the app would race a respawn and leave an orphaned server behind. Which is
/// not hypothetical: eleven orphaned sidecars from past launches were found
/// alive on this machine, one per random port, precisely because nothing
/// reconciled a dead GUI with its child.
#[cfg(desktop)]
#[derive(Default)]
pub(super) struct SidecarSupervisor {
    stopping: AtomicBool,
}

#[cfg(desktop)]
impl SidecarSupervisor {
    /// Called BEFORE the deliberate stop, never after: a flag set afterwards
    /// races the watcher's next poll.
    pub(super) fn request_stop(&self) {
        self.stopping.store(true, Ordering::Release);
    }

    pub(super) fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }
}

/// Watch the running sidecar and bring it back when it dies unexpectedly.
///
/// Windows recovery is delegated to `SidecarStartupControl`; other platforms
/// retain the synchronous startup path.
#[cfg(desktop)]
pub(super) fn spawn_sidecar_supervisor(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut budget = ReviveBudget::defaults();
        let mut recovery_pending = false;
        let mut recovery_episode: Option<RecoveryMeasurementEpisode> = None;
        let mut suppress_timed_out_startup_terminal = false;
        #[cfg(target_os = "windows")]
        let mut recovery_suspended_after_cancel = false;
        loop {
            if !sleep_with_recovery_measurement(
                &app,
                SUPERVISOR_POLL_INTERVAL,
                &mut recovery_episode,
                &mut suppress_timed_out_startup_terminal,
            ) {
                record_cancelled_recovery_episode(&app, recovery_episode.take());
                return;
            }
            #[cfg(target_os = "windows")]
            if recovery_suspended_after_cancel {
                if sidecar_liveness(&app) == SidecarLiveness::Alive {
                    recovery_suspended_after_cancel = false;
                    recovery_pending = false;
                    recovery_episode = None;
                    budget.recovered();
                }
                continue;
            }
            #[cfg(target_os = "windows")]
            if recovery_pending {
                match consume_supervised_startup_terminal(&app) {
                    Ok(Some(evidence)) => {
                        if suppress_timed_out_startup_terminal {
                            suppress_timed_out_startup_terminal = false;
                            recovery_episode = None;
                            if matches!(evidence, NativeStartupTerminalEvidence::Cancelled) {
                                recovery_pending = false;
                                recovery_suspended_after_cancel = true;
                                continue;
                            }
                            if !matches!(
                                evidence,
                                NativeStartupTerminalEvidence::AuthenticatedReady
                                    | NativeStartupTerminalEvidence::TransportReady
                            ) {
                                recovery_pending = true;
                                continue;
                            }
                            // A late ready result restores operation, but the
                            // timed-out attempt must not become a fast success
                            // in the replacement measurement window.
                        }
                        if !matches!(
                            evidence,
                            NativeStartupTerminalEvidence::AuthenticatedReady
                                | NativeStartupTerminalEvidence::TransportReady
                        ) {
                            let cancelled = record_supervised_startup_terminal(
                                &app,
                                &mut recovery_episode,
                                evidence,
                            );
                            if cancelled {
                                recovery_episode = None;
                                recovery_pending = false;
                                recovery_suspended_after_cancel = true;
                                continue;
                            }
                            recovery_pending = true;
                            continue;
                        }
                        if let Some(episode) = recovery_episode.as_mut() {
                            episode.observe_readiness(evidence);
                        }
                        // The worker reached authenticated or transport
                        // readiness, but the supervisor still requires this
                        // iteration's liveness probe before confirming restart.
                    }
                    Ok(None) => {}
                    Err(error) => {
                        log::warn!(
                            "[cave] could not consume supervised startup terminal result: {error}"
                        );
                    }
                }
            }
            match recovery_observation(
                recovery_pending,
                sidecar_liveness(&app),
                startup_in_progress(&app),
            ) {
                RecoveryObservation::Recovered => {
                    if let Some(mut episode) = recovery_episode.take() {
                        episode.confirm_pending_restart();
                        let measurement = episode.measurement(episode.recovered_outcome(), None);
                        if episode.close_measurement() {
                            record_native_reliability(&app, measurement);
                        }
                    }
                    // Forget any earlier crash history so an unrelated failure
                    // weeks into a session gets a full budget.
                    budget.recovered();
                    continue;
                }
                RecoveryObservation::Wait => continue,
                RecoveryObservation::Revive => {
                    recovery_pending = true;
                    recovery_episode.get_or_insert_with(RecoveryMeasurementEpisode::start);
                }
            }

            let Some(delay) = budget.next_delay() else {
                log::warn!(
                    "[cave] sidecar revive budget spent after {} attempts; cooling off for {}s before trying again",
                    budget.attempt(),
                    budget.cooldown().as_secs()
                );
                recovery_episode
                    .get_or_insert_with(RecoveryMeasurementEpisode::start)
                    .schedule_backoff(budget.cooldown());
                if !sleep_with_recovery_measurement(
                    &app,
                    budget.cooldown(),
                    &mut recovery_episode,
                    &mut suppress_timed_out_startup_terminal,
                ) {
                    record_cancelled_recovery_episode(&app, recovery_episode.take());
                    return;
                }
                budget.refill();
                continue;
            };

            log::warn!(
                "[cave] sidecar exited unexpectedly; reviving in {}ms (attempt {}, burst {})",
                delay.as_millis(),
                budget.attempt(),
                budget.bursts()
            );
            recovery_episode
                .get_or_insert_with(RecoveryMeasurementEpisode::start)
                .schedule_attempt(delay);
            if !sleep_with_recovery_measurement(
                &app,
                delay,
                &mut recovery_episode,
                &mut suppress_timed_out_startup_terminal,
            ) {
                record_cancelled_recovery_episode(&app, recovery_episode.take());
                return;
            }
            if startup_in_progress(&app) {
                recovery_pending = true;
                continue;
            }
            #[cfg(target_os = "windows")]
            if supervised_startup_terminal_pending(&app) {
                recovery_pending = true;
                continue;
            }
            let revive_outcome = revive(&app);
            #[cfg(not(target_os = "windows"))]
            let revive_crossed_measurement_deadline =
                rotate_timed_out_recovery_episode(&app, &mut recovery_episode);
            #[cfg(target_os = "windows")]
            let revive_crossed_measurement_deadline = false;
            if revive_crossed_measurement_deadline {
                match &revive_outcome {
                    ReviveOutcome::Revived => {
                        recovery_episode = None;
                        recovery_pending = false;
                        budget.recovered();
                    }
                    ReviveOutcome::Cancelled => return,
                    _ => {
                        recovery_pending = true;
                    }
                }
                continue;
            }
            match revive_outcome {
                ReviveOutcome::Revived => {
                    recovery_episode
                        .get_or_insert_with(RecoveryMeasurementEpisode::start)
                        .confirm_restart();
                    recovery_pending = false;
                    if let Some(mut episode) = recovery_episode.take() {
                        let measurement = episode.measurement(ReliabilityOutcome::Success, None);
                        if episode.close_measurement() {
                            record_native_reliability(&app, measurement);
                        }
                    }
                    budget.recovered();
                }
                ReviveOutcome::Scheduled => {
                    recovery_episode
                        .get_or_insert_with(RecoveryMeasurementEpisode::start)
                        .await_restart_confirmation();
                    recovery_pending = true;
                }
                #[cfg(target_os = "windows")]
                ReviveOutcome::Terminal(evidence) => {
                    if matches!(
                        evidence,
                        NativeStartupTerminalEvidence::AuthenticatedReady
                            | NativeStartupTerminalEvidence::TransportReady
                    ) {
                        if let Some(episode) = recovery_episode.as_mut() {
                            episode.observe_readiness(evidence);
                        }
                        recovery_pending = true;
                    } else {
                        let cancelled = record_supervised_startup_terminal(
                            &app,
                            &mut recovery_episode,
                            evidence,
                        );
                        if cancelled {
                            recovery_episode = None;
                            recovery_pending = false;
                            recovery_suspended_after_cancel = true;
                            continue;
                        }
                        recovery_pending = true;
                    }
                }
                ReviveOutcome::Failed { failure_class } => {
                    if failure_class == ReliabilityFailureClass::Contention {
                        let recorded = if let Some(episode) = recovery_episode.as_mut() {
                            let measurement = episode
                                .measurement(ReliabilityOutcome::Blocked, Some(failure_class));
                            if episode.close_measurement() {
                                record_native_reliability(&app, measurement);
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        };
                        if recorded {
                            recovery_episode = Some(RecoveryMeasurementEpisode::start());
                        }
                    }
                }
                ReviveOutcome::Cancelled => {
                    record_cancelled_recovery_episode(&app, recovery_episode.take());
                    return;
                }
            }
        }
    });
}

#[cfg(desktop)]
struct RecoveryMeasurementEpisode {
    started: std::time::Instant,
    attempts: u32,
    restart_count: u32,
    restart_confirmation_pending: bool,
    authenticated_readiness_observed: bool,
    backoff: Duration,
    measurement_closed: bool,
}

#[cfg(desktop)]
impl RecoveryMeasurementEpisode {
    fn start() -> Self {
        Self {
            started: std::time::Instant::now(),
            attempts: 0,
            restart_count: 0,
            restart_confirmation_pending: false,
            authenticated_readiness_observed: false,
            backoff: Duration::ZERO,
            measurement_closed: false,
        }
    }

    fn schedule_attempt(&mut self, delay: Duration) {
        self.attempts = self.attempts.saturating_add(1);
        self.schedule_backoff(delay);
    }

    fn schedule_backoff(&mut self, delay: Duration) {
        self.backoff = self.backoff.saturating_add(delay);
    }

    fn confirm_restart(&mut self) {
        self.restart_count = self.restart_count.saturating_add(1);
    }

    fn await_restart_confirmation(&mut self) {
        self.restart_confirmation_pending = true;
    }

    fn confirm_pending_restart(&mut self) {
        if self.restart_confirmation_pending {
            self.restart_confirmation_pending = false;
            self.confirm_restart();
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn observe_readiness(&mut self, evidence: NativeStartupTerminalEvidence) {
        self.authenticated_readiness_observed =
            matches!(evidence, NativeStartupTerminalEvidence::AuthenticatedReady);
    }

    fn recovered_outcome(&self) -> ReliabilityOutcome {
        if self.authenticated_readiness_observed {
            ReliabilityOutcome::Success
        } else {
            ReliabilityOutcome::Unverified
        }
    }

    fn close_measurement(&mut self) -> bool {
        if self.measurement_closed {
            return false;
        }
        self.measurement_closed = true;
        true
    }

    fn measurement(
        &self,
        outcome: ReliabilityOutcome,
        failure_class: Option<ReliabilityFailureClass>,
    ) -> ReliabilityMeasurementInput {
        recovery_measurement(
            self.started.elapsed(),
            outcome,
            failure_class,
            self.attempts,
            self.backoff,
            self.restart_count,
        )
    }
}

#[cfg(desktop)]
fn recovery_measurement(
    duration: Duration,
    outcome: ReliabilityOutcome,
    failure_class: Option<ReliabilityFailureClass>,
    attempts: u32,
    backoff: Duration,
    restart_count: u32,
) -> ReliabilityMeasurementInput {
    ReliabilityMeasurementInput {
        operation: ReliabilityOperation::SupervisedRecovery,
        outcome,
        failure_class,
        readiness: match outcome {
            ReliabilityOutcome::Success => ReliabilityReadiness::Authenticated,
            ReliabilityOutcome::Unverified => ReliabilityReadiness::Transport,
            _ => ReliabilityReadiness::None,
        },
        duration_ms: duration.as_millis().min(u128::from(u64::MAX)) as u64,
        attempts,
        backoff_ms: backoff.as_millis().min(u128::from(u64::MAX)) as u64,
        timeout_ms: RECOVERY_MEASUREMENT_TIMEOUT
            .as_millis()
            .min(u128::from(u64::MAX)) as u64,
        crash_count: 1,
        restart_count,
    }
}

#[cfg(desktop)]
fn recovery_timeout_measurement(
    episode: &RecoveryMeasurementEpisode,
    elapsed: Duration,
) -> Option<ReliabilityMeasurementInput> {
    if elapsed < RECOVERY_MEASUREMENT_TIMEOUT {
        return None;
    }
    Some(recovery_measurement(
        RECOVERY_MEASUREMENT_TIMEOUT,
        ReliabilityOutcome::Failure,
        Some(ReliabilityFailureClass::Timeout),
        episode.attempts,
        episode.backoff,
        episode.restart_count,
    ))
}

#[cfg(desktop)]
fn rotate_timed_out_recovery_episode(
    app: &tauri::AppHandle,
    episode: &mut Option<RecoveryMeasurementEpisode>,
) -> bool {
    let measurement = episode.as_ref().and_then(|current| {
        (!current.measurement_closed)
            .then(|| recovery_timeout_measurement(current, current.started.elapsed()))
            .flatten()
    });
    let Some(measurement) = measurement else {
        return false;
    };
    if episode
        .as_mut()
        .is_some_and(RecoveryMeasurementEpisode::close_measurement)
    {
        record_native_reliability(app, measurement);
    }
    *episode = Some(RecoveryMeasurementEpisode::start());
    true
}

#[cfg(desktop)]
fn record_cancelled_recovery_episode(
    app: &tauri::AppHandle,
    episode: Option<RecoveryMeasurementEpisode>,
) {
    if let Some(mut episode) = episode {
        let measurement = episode.measurement(
            ReliabilityOutcome::Cancelled,
            Some(ReliabilityFailureClass::Cancellation),
        );
        if episode.close_measurement() {
            record_native_reliability(app, measurement);
        }
    }
}

#[cfg(desktop)]
fn sleep_with_recovery_measurement(
    app: &tauri::AppHandle,
    total: Duration,
    episode: &mut Option<RecoveryMeasurementEpisode>,
    suppress_timed_out_startup_terminal: &mut bool,
) -> bool {
    const SLICE: Duration = Duration::from_millis(250);
    let mut waited = Duration::ZERO;
    while waited < total {
        if is_stopping(app) {
            return false;
        }
        let step = SLICE.min(total - waited);
        std::thread::sleep(step);
        waited += step;
        #[cfg(target_os = "windows")]
        let terminal_precedes_deadline = episode.as_ref().is_some_and(|current| {
            supervised_startup_terminal_completed_at(app).is_some_and(|completed_at| {
                terminal_completed_before_recovery_deadline(current.started, completed_at)
            })
        });
        #[cfg(not(target_os = "windows"))]
        let terminal_precedes_deadline = false;
        if terminal_precedes_deadline {
            return true;
        }
        if rotate_timed_out_recovery_episode(app, episode) {
            #[cfg(target_os = "windows")]
            if startup_in_progress(app) || supervised_startup_terminal_pending(app) {
                *suppress_timed_out_startup_terminal = true;
            }
            #[cfg(not(target_os = "windows"))]
            let _ = suppress_timed_out_startup_terminal;
        }
    }
    !is_stopping(app)
}

#[cfg(desktop)]
fn is_stopping(app: &tauri::AppHandle) -> bool {
    app.try_state::<Arc<SidecarSupervisor>>()
        .is_some_and(|supervisor| supervisor.is_stopping())
}

/// What the supervised child is doing.
///
/// `Unknown` is deliberately its own case rather than being folded into
/// "alive". There is no recorded child after a deliberate stop, before the
/// first start, or if the state lock is poisoned — and treating that as health
/// would silently RESET the revive budget, so a respawn that failed and left no
/// child behind would look like a recovery and never be retried. Unknown means
/// "do nothing": neither revive, nor forgive the crash history.
#[cfg(desktop)]
fn startup_in_progress(app: &tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        return app
            .try_state::<Arc<SidecarStartupControl>>()
            .is_some_and(|control| control.is_running());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq)]
enum SidecarLiveness {
    Alive,
    Dead,
    Unknown,
}

#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq)]
enum RecoveryObservation {
    Recovered,
    Revive,
    Wait,
}

/// A failed revive stays actionable even after cleanup removes the partial
/// child from `SidecarState`. Without this episode bit, `Unknown` would make
/// the supervisor wait forever. Conversely, only a later live probe proves a
/// successful revive remained healthy long enough to restore the budget.
#[cfg(desktop)]
fn recovery_observation(
    recovery_pending: bool,
    liveness: SidecarLiveness,
    startup_running: bool,
) -> RecoveryObservation {
    if startup_running {
        return RecoveryObservation::Wait;
    }
    if recovery_pending {
        return if liveness == SidecarLiveness::Alive {
            RecoveryObservation::Recovered
        } else {
            RecoveryObservation::Revive
        };
    }
    match liveness {
        SidecarLiveness::Alive => RecoveryObservation::Recovered,
        SidecarLiveness::Dead => RecoveryObservation::Revive,
        SidecarLiveness::Unknown => RecoveryObservation::Wait,
    }
}

#[cfg(desktop)]
fn sidecar_liveness(app: &tauri::AppHandle) -> SidecarLiveness {
    let Some(state) = app.try_state::<SidecarState>() else {
        return SidecarLiveness::Unknown;
    };
    let Ok(mut sidecar) = state.0.lock() else {
        // Some other path panicked mid-mutation. Do not respawn on top of state
        // nobody can describe.
        return SidecarLiveness::Unknown;
    };
    match sidecar.as_mut() {
        // An error asking the OS is not proof of death — err toward leaving a
        // possibly-live sidecar alone rather than starting a second one.
        Some(process) => match process.has_exited() {
            Ok(true) => SidecarLiveness::Dead,
            Ok(false) => SidecarLiveness::Alive,
            Err(_) => SidecarLiveness::Unknown,
        },
        None => SidecarLiveness::Unknown,
    }
}

#[cfg(desktop)]
enum ReviveOutcome {
    Revived,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Scheduled,
    #[cfg(target_os = "windows")]
    Terminal(NativeStartupTerminalEvidence),
    Failed {
        failure_class: ReliabilityFailureClass,
    },
    Cancelled,
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn cleanup_failed_revival(app: &tauri::AppHandle) {
    if let Some(sidecar) = app.try_state::<SidecarState>() {
        if let Err(error) = sidecar.stop() {
            log::warn!("[cave] could not clean up failed sidecar revival: {error}");
        }
    }
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn revive(app: &tauri::AppHandle) -> ReviveOutcome {
    let should_cancel = {
        let app = app.clone();
        move || is_stopping(&app)
    };
    match sidecar_startup::start_sidecar_runtime(app, |_| {}, should_cancel) {
        Ok(url) => {
            pty::trust_main_origin(&url);
            remember_main_startup_url(&url);
            // The auth token is regenerated on every start, so the old page
            // cannot simply reload — it would 401. Same navigation dance as the
            // Windows startup path: location.replace() keeps the dead page out
            // of session history, with navigate() as the fallback for a webview
            // whose JS context is no longer reachable.
            let navigated = replace_main_window_url(app, url);
            match navigated {
                Ok(()) => {
                    log::info!("[cave] sidecar revived and the window was reopened");
                    ReviveOutcome::Revived
                }

                Err(error) => {
                    log::warn!("[cave] sidecar revived but the window did not follow: {error}");
                    cleanup_failed_revival(app);
                    ReviveOutcome::Failed {
                        failure_class: ReliabilityFailureClass::Transport,
                    }
                }
            }
        }
        // Matched rather than `{:?}`-formatted: SidecarStartError carries no
        // Debug impl, and a cancel is not a failure — it is the app shutting
        // down between the poll and the respawn.
        Err(SidecarStartError::Cancelled) => {
            log::info!("[cave] sidecar revive abandoned: shutdown began mid-attempt");
            ReviveOutcome::Cancelled
        }
        Err(SidecarStartError::Failed {
            message,
            failure_class,
        }) => {
            log::warn!("[cave] sidecar revive failed: {message}");
            cleanup_failed_revival(app);
            ReviveOutcome::Failed { failure_class }
        }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn revive(app: &tauri::AppHandle) -> ReviveOutcome {
    let Some(control) = app.try_state::<Arc<SidecarStartupControl>>() else {
        log::warn!("[cave] sidecar revive failed: startup control is unavailable");
        return ReviveOutcome::Failed {
            failure_class: ReliabilityFailureClass::Unknown,
        };
    };
    if control.is_shutdown_requested() || is_stopping(app) {
        return ReviveOutcome::Cancelled;
    }
    match sidecar_startup::spawn_sidecar_startup(
        app.clone(),
        Arc::clone(control.inner()),
        sidecar_startup::NativeStartupTerminalPolicy::DeferredToSupervisor,
    ) {
        Ok(()) => ReviveOutcome::Scheduled,
        Err(_error) if control.is_running() => {
            log::info!("[cave] sidecar recovery joined an existing startup");
            ReviveOutcome::Scheduled
        }
        Err(error) if control.is_shutdown_requested() => {
            log::info!("[cave] sidecar recovery cancelled during shutdown: {error}");
            ReviveOutcome::Cancelled
        }
        Err(error) => {
            match control.consume_terminal() {
                Ok(Some(evidence)) => return ReviveOutcome::Terminal(evidence),
                Ok(None) => {}
                Err(consume_error) => log::warn!(
                    "[cave] sidecar revive could not consume terminal result: {consume_error}"
                ),
            }
            log::warn!("[cave] sidecar revive could not start: {error}");
            ReviveOutcome::Failed {
                failure_class: ReliabilityFailureClass::Permissions,
            }
        }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn consume_supervised_startup_terminal(
    app: &tauri::AppHandle,
) -> Result<Option<NativeStartupTerminalEvidence>, String> {
    let Some(control) = app.try_state::<Arc<SidecarStartupControl>>() else {
        return Ok(None);
    };
    control.consume_terminal()
}

#[cfg(all(desktop, target_os = "windows"))]
fn supervised_startup_terminal_pending(app: &tauri::AppHandle) -> bool {
    app.try_state::<Arc<SidecarStartupControl>>()
        .is_some_and(|control| control.has_terminal().unwrap_or(false))
}

#[cfg(all(desktop, target_os = "windows"))]
fn supervised_startup_terminal_completed_at(app: &tauri::AppHandle) -> Option<std::time::Instant> {
    app.try_state::<Arc<SidecarStartupControl>>()
        .and_then(|control| control.terminal_completed_at().ok().flatten())
}

#[cfg(all(desktop, any(target_os = "windows", test)))]
fn terminal_completed_before_recovery_deadline(
    episode_started: std::time::Instant,
    terminal_completed_at: std::time::Instant,
) -> bool {
    terminal_completed_at <= episode_started + RECOVERY_MEASUREMENT_TIMEOUT
}

#[cfg(all(desktop, any(target_os = "windows", test)))]
fn supervised_terminal_classification(
    evidence: NativeStartupTerminalEvidence,
) -> (ReliabilityOutcome, Option<ReliabilityFailureClass>, bool) {
    match evidence {
        NativeStartupTerminalEvidence::AuthenticatedReady => {
            (ReliabilityOutcome::Success, None, true)
        }
        NativeStartupTerminalEvidence::TransportReady => {
            (ReliabilityOutcome::Unverified, None, true)
        }
        NativeStartupTerminalEvidence::Cancelled => (
            ReliabilityOutcome::Cancelled,
            Some(ReliabilityFailureClass::Cancellation),
            false,
        ),
        NativeStartupTerminalEvidence::Failed(failure_class) => (
            if failure_class == ReliabilityFailureClass::Contention {
                ReliabilityOutcome::Blocked
            } else {
                ReliabilityOutcome::Failure
            },
            Some(failure_class),
            false,
        ),
    }
}

#[cfg(all(desktop, target_os = "windows"))]
fn record_supervised_startup_terminal(
    app: &tauri::AppHandle,
    episode: &mut Option<RecoveryMeasurementEpisode>,
    evidence: NativeStartupTerminalEvidence,
) -> bool {
    let (outcome, failure_class, restarted) = supervised_terminal_classification(evidence);
    if let Some(episode) = episode.as_mut() {
        if restarted {
            episode.confirm_pending_restart();
        }
        if matches!(
            outcome,
            ReliabilityOutcome::Blocked | ReliabilityOutcome::Cancelled
        ) {
            let measurement = episode.measurement(outcome, failure_class);
            if episode.close_measurement() {
                record_native_reliability(app, measurement);
            }
        }
    }
    if outcome == ReliabilityOutcome::Blocked {
        *episode = Some(RecoveryMeasurementEpisode::start());
    }
    outcome == ReliabilityOutcome::Cancelled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_attempt_is_prompt_then_backs_off() {
        let mut budget = ReviveBudget::new(
            4,
            Duration::from_secs(2),
            Duration::from_secs(60),
            Duration::from_secs(900),
        );
        // A one-off crash is the common case, so the first retry is nearly
        // immediate rather than making the user stare at a dead window.
        assert_eq!(budget.next_delay(), Some(Duration::from_millis(250)));
        assert_eq!(budget.next_delay(), Some(Duration::from_secs(2)));
        assert_eq!(budget.next_delay(), Some(Duration::from_secs(4)));
        assert_eq!(budget.next_delay(), Some(Duration::from_secs(8)));
        // Burst spent — but this is a cooldown, NOT a permanent stop.
        assert_eq!(budget.next_delay(), None);
    }

    #[test]
    fn supervised_terminal_contention_is_blocked_and_other_failures_keep_their_class() {
        assert_eq!(
            supervised_terminal_classification(NativeStartupTerminalEvidence::Failed(
                ReliabilityFailureClass::Contention,
            )),
            (
                ReliabilityOutcome::Blocked,
                Some(ReliabilityFailureClass::Contention),
                false,
            )
        );
        assert_eq!(
            supervised_terminal_classification(NativeStartupTerminalEvidence::Failed(
                ReliabilityFailureClass::Compatibility,
            )),
            (
                ReliabilityOutcome::Failure,
                Some(ReliabilityFailureClass::Compatibility),
                false,
            )
        );
    }

    #[test]
    fn growth_is_capped() {
        let mut budget = ReviveBudget::new(
            10,
            Duration::from_secs(2),
            Duration::from_secs(8),
            Duration::from_secs(900),
        );
        let delays: Vec<_> = std::iter::from_fn(|| budget.next_delay()).collect();
        assert_eq!(delays.len(), 10);
        assert!(
            delays.iter().all(|d| *d <= Duration::from_secs(8)),
            "no attempt may be scheduled past the ceiling: {delays:?}"
        );
    }

    #[test]
    fn the_budget_refills_rather_than_running_out() {
        let mut budget = ReviveBudget::defaults();
        while budget.next_delay().is_some() {}
        assert_eq!(budget.next_delay(), None, "burst is spent");
        budget.refill();
        assert!(
            budget.next_delay().is_some(),
            "after cooling off the sidecar gets another burst — never written off"
        );
        assert_eq!(budget.bursts(), 1, "and the crash count stays visible");
    }

    #[test]
    fn recovery_restores_a_full_budget() {
        let mut budget = ReviveBudget::defaults();
        budget.next_delay();
        budget.next_delay();
        assert_eq!(budget.attempt(), 2);
        budget.recovered();
        assert_eq!(budget.attempt(), 0);
        assert_eq!(budget.bursts(), 0);
        assert_eq!(
            budget.next_delay(),
            Some(Duration::from_millis(250)),
            "a later unrelated crash starts from a prompt retry again"
        );
    }

    #[test]
    fn failed_revival_stays_pending_when_child_state_is_unknown() {
        assert_eq!(
            recovery_observation(true, SidecarLiveness::Unknown, false),
            RecoveryObservation::Revive,
            "cleanup leaves no recorded child, but a failed revival still needs its next attempt"
        );
    }

    #[test]
    fn only_an_observed_live_revival_restores_the_budget() {
        assert_eq!(
            recovery_observation(false, SidecarLiveness::Alive, false),
            RecoveryObservation::Recovered,
        );
        assert_eq!(
            recovery_observation(false, SidecarLiveness::Unknown, false),
            RecoveryObservation::Wait,
            "unknown is not proof that a successful revival stayed alive"
        );
    }

    #[test]
    fn an_owned_startup_suppresses_duplicate_revival() {
        assert_eq!(
            recovery_observation(false, SidecarLiveness::Unknown, true),
            RecoveryObservation::Wait,
            "initial and manual startup own recovery until they finish"
        );
        assert_eq!(
            recovery_observation(true, SidecarLiveness::Dead, true),
            RecoveryObservation::Wait,
            "a retained dead child must not start a second worker concurrently"
        );
        assert_eq!(
            recovery_observation(true, SidecarLiveness::Alive, true),
            RecoveryObservation::Wait,
            "process liveness alone is not readiness while startup still owns the child"
        );
    }

    #[test]
    fn a_scheduled_revival_recovers_only_after_the_child_is_live() {
        assert_eq!(
            recovery_observation(true, SidecarLiveness::Alive, false),
            RecoveryObservation::Recovered,
        );
    }

    #[test]
    fn recovery_rotates_auxiliary_window_auth_without_losing_presentation_state() {
        let startup = Url::parse(
            "http://127.0.0.1:43123/?covenCaveToken=new-sidecar&coven_access_token=new-mobile",
        )
        .unwrap();
        let current = Url::parse(
            "http://127.0.0.1:43123/quick-chat?notch=1&fit=1&covenCaveToken=old-sidecar",
        )
        .unwrap();

        let refreshed = sidecar_startup::refreshed_sidecar_window_url(&startup, &current);

        assert_eq!(refreshed.path(), "/quick-chat");
        assert_eq!(
            refreshed.query(),
            Some("covenCaveToken=new-sidecar&coven_access_token=new-mobile&notch=1&fit=1")
        );
    }

    #[test]
    fn recovery_measurements_never_promote_transport_liveness_to_authenticated_success() {
        let measurement = recovery_measurement(
            Duration::from_millis(1_250),
            ReliabilityOutcome::Unverified,
            None,
            2,
            Duration::from_millis(2_250),
            1,
        );
        assert_eq!(
            measurement.operation,
            ReliabilityOperation::SupervisedRecovery
        );
        assert_eq!(measurement.outcome, ReliabilityOutcome::Unverified);
        assert_eq!(measurement.readiness, ReliabilityReadiness::Transport);
        assert_eq!(measurement.duration_ms, 1_250);
        assert_eq!(measurement.attempts, 2);
        assert_eq!(measurement.backoff_ms, 2_250);
        assert_eq!(measurement.timeout_ms, 90_000);
        assert_eq!(measurement.crash_count, 1);
        assert_eq!(measurement.restart_count, 1);
    }

    #[test]
    fn recovery_episode_counts_only_confirmed_completed_restarts() {
        let mut episode = RecoveryMeasurementEpisode::start();
        episode.schedule_attempt(Duration::from_millis(250));
        episode.schedule_attempt(Duration::from_secs(2));

        let scheduled = episode.measurement(ReliabilityOutcome::Unverified, None);
        assert_eq!(scheduled.attempts, 2);
        assert_eq!(scheduled.backoff_ms, 2_250);
        assert_eq!(scheduled.restart_count, 0);

        episode.confirm_restart();
        let measurement = episode.measurement(ReliabilityOutcome::Unverified, None);
        assert_eq!(measurement.attempts, 2);
        assert_eq!(measurement.backoff_ms, 2_250);
        assert_eq!(measurement.restart_count, 1);
    }

    #[test]
    fn scheduled_windows_restart_counts_only_after_liveness_confirmation() {
        let mut episode = RecoveryMeasurementEpisode::start();
        episode.schedule_attempt(Duration::from_millis(250));
        episode.await_restart_confirmation();
        episode.observe_readiness(NativeStartupTerminalEvidence::AuthenticatedReady);

        assert_eq!(
            episode
                .measurement(ReliabilityOutcome::Unverified, None)
                .restart_count,
            0
        );
        episode.confirm_pending_restart();
        let measurement = episode.measurement(episode.recovered_outcome(), None);
        assert_eq!(measurement.restart_count, 1);
        assert_eq!(measurement.outcome, ReliabilityOutcome::Success);
        assert_eq!(measurement.readiness, ReliabilityReadiness::Authenticated);
    }

    #[test]
    fn recovery_episode_becomes_one_timeout_terminal_at_90_seconds() {
        let mut episode = RecoveryMeasurementEpisode::start();
        episode.schedule_attempt(Duration::from_millis(250));

        assert!(recovery_timeout_measurement(&episode, Duration::from_millis(89_999),).is_none());
        let measurement = recovery_timeout_measurement(&episode, RECOVERY_MEASUREMENT_TIMEOUT)
            .expect("90 seconds closes the measurement episode");
        assert_eq!(measurement.outcome, ReliabilityOutcome::Failure);
        assert_eq!(
            measurement.failure_class,
            Some(ReliabilityFailureClass::Timeout)
        );
        assert_eq!(measurement.duration_ms, 90_000);
        assert_eq!(measurement.attempts, 1);
        assert_eq!(measurement.backoff_ms, 250);
    }

    #[test]
    fn terminal_completion_is_arbitrated_against_the_episode_deadline() {
        let started = std::time::Instant::now();
        assert!(terminal_completed_before_recovery_deadline(
            started,
            started + RECOVERY_MEASUREMENT_TIMEOUT,
        ));
        assert!(!terminal_completed_before_recovery_deadline(
            started,
            started + RECOVERY_MEASUREMENT_TIMEOUT + Duration::from_nanos(1),
        ));
    }

    #[test]
    fn a_closed_recovery_episode_cannot_emit_a_late_second_terminal() {
        let mut episode = RecoveryMeasurementEpisode::start();
        assert!(episode.close_measurement());
        assert!(!episode.close_measurement());
    }
}
