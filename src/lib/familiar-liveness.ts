/**
 * How many times does the familiar get to come back, and how fast?
 *
 * The existing coordinator (daemon-desktop-auto-start.ts) restarts a local
 * daemon on the fixed schedule [0, 15s, 60s, 300s] and then stops trying:
 *
 *     if (restartAttempts >= DAEMON_RESTART_BACKOFF_MS.length) return;
 *
 * The only thing that clears that counter is a `running` poll — so in the one
 * case that matters, a daemon that is genuinely gone and cannot come back on its
 * own, nothing will ever produce the observation that would let it try again.
 * Four failures in the first six minutes and the familiar is down for the rest
 * of the session, with no further attempt and nothing on screen that says so.
 *
 * This module replaces "N attempts, then never" with "N attempts, cool off,
 * then N more" — a burst budget that REFILLS. A crash-looping daemon still
 * cannot spin: the burst is small, the delays grow exponentially with jitter,
 * and the cooldown between bursts is long. But a machine that was asleep, or a
 * daemon whose dependency came back an hour later, gets another chance.
 *
 * It also adds the half that was missing entirely. `classifyDaemonStatusPoll`
 * distinguishes only "answered" from "did not answer", so a daemon that holds
 * its port open and stops responding reads as *running* forever — the familiar
 * looks alive and answers nothing. A `hung` verdict is a first-class input here
 * and is recovered by stop-then-revive rather than by another bare start, which
 * would be refused by the still-held lock.
 *
 * Pure and synchronous on purpose: no timers, no fetch, no clock of its own.
 * The caller supplies `now()` and `random()`, so every schedule below is exactly
 * reproducible in a test.
 *
 * OWNERSHIP (cave-9pqt9): deciding to revive is NOT permission to spawn. An
 * external supervisor (launchd KeepAlive) may own recovery of the same daemon,
 * and two owners racing produce lock contention and error banners rather than a
 * faster recovery. The caller must still preflight `coven daemon status --json`
 * and act only on a confirmed-stopped daemon. This module answers "should we,
 * and how long have we waited", never "is it ours to start".
 */

export type FamiliarHealthVerdict =
  /** Answered, and answered correctly. */
  | "healthy"
  /** Reachable but erroring — the familiar is up and not working. */
  | "degraded"
  /** Nothing is there. */
  | "absent"
  /** Listening, but not answering within the deadline. */
  | "hung";

/**
 * Turn a status poll into a liveness verdict.
 *
 * The distinction that makes hang detection possible is already in the data,
 * it just was not being read: `offline` means the status service ANSWERED and
 * reported the daemon absent, whereas `unavailable` means we could not get an
 * answer at all. A daemon holding its port open while refusing to respond
 * produces the latter — which is why "listening" was never proof of "alive".
 *
 * Deliberately a separate mapping rather than a fifth member of
 * `DaemonStatusPollResult`: that union is consumed exhaustively across the app,
 * and widening it to express something only the supervisor cares about would
 * churn every one of those call sites for no gain at the reading end.
 */
export function familiarHealthVerdictFromPoll(
  poll: { kind: string; reason?: string },
): FamiliarHealthVerdict {
  switch (poll.kind) {
    case "running":
      return "healthy";
    case "offline":
      // The status service answered and said nothing is running. Unambiguous.
      return "absent";
    case "auth-expired":
      // Reachable, and refusing us. Restarting cannot fix a credential.
      return "degraded";
    default: {
      // We could not get an answer. A timeout means something is there and not
      // responding; anything else (connection refused, DNS, a broken status
      // service) is better treated as absent, where a plain start is the right
      // move and cannot make things worse.
      const reason = (poll.reason ?? "").toLowerCase();
      return reason.includes("timeout") || reason.includes("timed out") || reason.includes("abort")
        ? "hung"
        : "absent";
    }
  }
}

export type FamiliarLivenessState =
  | "healthy"
  | "degraded"
  /** A revive has been issued and we are waiting to see whether it took. */
  | "reviving"
  /** The burst is spent; waiting out the cooldown before the budget refills. */
  | "cooling";

export type FamiliarReviveAction =
  /** Nothing to do — healthy, or already inside a backoff window. */
  | { action: "none"; state: FamiliarLivenessState }
  /** Start it. `attempt` is 1-based within the current burst. */
  | { action: "revive"; state: "reviving"; attempt: number; burst: number }
  /** Stop it first: a hung daemon still holds its lock, so a bare start fails. */
  | { action: "recover-hang"; state: "reviving"; attempt: number; burst: number };

export type FamiliarLivenessPolicyOptions = {
  /** Attempts per burst before cooling off. */
  burstAttempts?: number;
  /** Delay before the second attempt in a burst; the first is immediate. */
  baseDelayMs?: number;
  /** Ceiling for the exponential growth within a burst. */
  maxDelayMs?: number;
  /** Wait after a spent burst before the budget refills. */
  cooldownMs?: number;
  now: () => number;
  /** Injected for reproducibility; defaults to Math.random. */
  random?: () => number;
};

/**
 * Defaults chosen against the schedule they replace: the old list spent its
 * whole budget in six minutes. A burst of four covers the same ground, and the
 * 15-minute cooldown is what turns "never again" into "again, later" without
 * letting a crash loop hammer the machine.
 */
export const FAMILIAR_LIVENESS_DEFAULTS = Object.freeze({
  burstAttempts: 4,
  baseDelayMs: 15_000,
  maxDelayMs: 300_000,
  cooldownMs: 900_000,
});

/**
 * Jitter spreads retries so several surfaces observing the same outage do not
 * schedule their revives on the same instant. Range is [0.5, 1.5) of the
 * nominal delay — enough to decorrelate, never enough to make a 15s wait feel
 * like a minute.
 */
export function jitteredDelay(nominalMs: number, sample: number): number {
  const clamped = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0.5;
  return Math.round(nominalMs * (0.5 + clamped));
}

/** Exponential within a burst: attempt 1 is immediate, then base, 2x, 4x… */
export function burstDelayMs(
  attempt: number,
  { baseDelayMs, maxDelayMs }: { baseDelayMs: number; maxDelayMs: number },
): number {
  if (attempt <= 0) return 0;
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

export type FamiliarLivenessSnapshot = {
  state: FamiliarLivenessState;
  /** Attempts used in the current burst. */
  attempt: number;
  /** How many bursts have been spent — i.e. how many times we have given up and come back. */
  burst: number;
  /** Total revives issued since the last healthy observation. */
  revives: number;
  lastVerdict: FamiliarHealthVerdict | null;
};

export type FamiliarLivenessPolicy = {
  /** Feed an observation; get back what to do about it. */
  observe(verdict: FamiliarHealthVerdict): FamiliarReviveAction;
  snapshot(): FamiliarLivenessSnapshot;
};

export function createFamiliarLivenessPolicy(
  options: FamiliarLivenessPolicyOptions,
): FamiliarLivenessPolicy {
  const burstAttempts = options.burstAttempts ?? FAMILIAR_LIVENESS_DEFAULTS.burstAttempts;
  const baseDelayMs = options.baseDelayMs ?? FAMILIAR_LIVENESS_DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? FAMILIAR_LIVENESS_DEFAULTS.maxDelayMs;
  const cooldownMs = options.cooldownMs ?? FAMILIAR_LIVENESS_DEFAULTS.cooldownMs;
  const random = options.random ?? Math.random;

  let state: FamiliarLivenessState = "healthy";
  let attempt = 0;
  let burst = 0;
  let revives = 0;
  let lastAttemptAt: number | null = null;
  let cooldownStartedAt: number | null = null;
  let lastVerdict: FamiliarHealthVerdict | null = null;

  const snapshot = (): FamiliarLivenessSnapshot => ({
    state,
    attempt,
    burst,
    revives,
    lastVerdict,
  });

  return {
    snapshot,
    observe(verdict) {
      lastVerdict = verdict;

      if (verdict === "healthy") {
        // Proof it is back. Forget the history so a later, unrelated outage gets
        // a full budget rather than the tail of this one — the same reasoning
        // the coordinator this replaces applied to its counter.
        state = "healthy";
        attempt = 0;
        burst = 0;
        revives = 0;
        lastAttemptAt = null;
        cooldownStartedAt = null;
        return { action: "none", state };
      }

      if (verdict === "degraded") {
        // Reachable but erroring. Deliberately NOT a revive trigger: restarting
        // something that is answering trades a degraded familiar for an absent
        // one, and the errors are usually the harness's, not the daemon's.
        // Surfacing the state is the useful part.
        state = "degraded";
        return { action: "none", state };
      }

      const at = options.now();

      if (state === "cooling") {
        if (cooldownStartedAt !== null && at - cooldownStartedAt < cooldownMs) {
          return { action: "none", state };
        }
        // Budget refills. This is the whole point: the familiar is never
        // permanently written off.
        attempt = 0;
        cooldownStartedAt = null;
      }

      if (attempt >= burstAttempts) {
        state = "cooling";
        burst += 1;
        cooldownStartedAt = at;
        return { action: "none", state };
      }

      const wait = jitteredDelay(burstDelayMs(attempt, { baseDelayMs, maxDelayMs }), random());
      if (lastAttemptAt !== null && at - lastAttemptAt < wait) {
        return { action: "none", state: state === "healthy" ? "reviving" : state };
      }

      attempt += 1;
      revives += 1;
      lastAttemptAt = at;
      state = "reviving";
      // A hung daemon still holds its lock and its port, so a bare start is
      // refused by the single-writer guard. It has to be stopped first.
      return {
        action: verdict === "hung" ? "recover-hang" : "revive",
        state,
        attempt,
        burst,
      };
    },
  };
}
