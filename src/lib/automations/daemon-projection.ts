// The Automations surface's client-side projection of the Coven daemon's
// authoritative state (coven-cave#5217, slice 1: run-state projection with
// honest stale/degraded/offline semantics).
//
// Coven owns definitions, occurrences, runs, attempts, and receipts. Cave is a
// human-oversight PROJECTION of that state: it renders what the daemon last
// reported, and never authors, completes, or "fixes" lifecycle facts of its
// own. Everything in `AutomationProjectionState` is derived, bounded,
// client-side data — a view, not a second ledger.
//
// The module is pure and clock-free: every caller injects `nowMs`, so tests
// pin time instead of sleeping and no projection ever reads the wall clock
// behind its caller's back.
//
// Two honesty rules the issue makes binding, both enforced here:
//
// 1. **Stale in-flight runs are never presented as live.** A run the daemon
//    last reported `running` may have finished, crashed, or never started —
//    Cave cannot know. `isStaleRunObservation` flags the observation for
//    as-of presentation instead of letting a surface claim "running" forever,
//    and no code path here ever invents a terminal outcome.
// 2. **Degradation is a state, not a silent fallback.** A projection whose
//    authoritative contact failed is `degraded` while recency is still
//    plausible, `stale` once nothing authoritative arrived within the
//    threshold, and `offline` when there is no projection at all. The view
//    (and the changefeed consumer this module prepares for) renders those
//    differently — the issue forbids compressing them into one spinner.
//
// Event discipline (the changefeed half of slice (a), ready for the canonical
// `coven.automations.v1` stream): events arrive in a versioned envelope with a
// canonical event id and a monotonic sequence. The reducer
//
//   • deduplicates canonical event ids (bounded FIFO of seen ids), and
//   • refuses sequence regressions outright — impossible state regresses
//     nothing here, and
//   • fails closed on payloads it does not know: an event whose envelope is
//     malformed is *refused* (cursor untouched); an event whose envelope is
//     valid but whose type or payload Cave cannot read is *counted as
//     unhandled* and advances only the cursor — it is never guessed into
//     state.
//
// The only payload shape applied today is the run observation Cave already
// receives from `coven.automations.runs` (mirrored by
// `ProjectedRunObservation`) — no wire format is invented ahead of coven#855.

import type { AutomationRunStatus } from "../automation-runs.ts";

/** The daemon statuses Cave's run projection can carry. Mirrors the daemon's
 * RoutineRun vocabulary as routed through /api/codex-automations/[id]/runs
 * (see AutomationRunStatus — `cancelled` is a real terminal outcome there,
 * not "unknown"). */
const RUN_STATUSES: readonly AutomationRunStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

/** One run the daemon authoritatively reported. Structurally the run record
 * the Automations surface already maps; extra fields callers carry are
 * ignored here. */
export type ProjectedRunObservation = {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  startedAt: string;
  finishedAt?: string;
};

/** Envelope Cave expects for a canonical automations changefeed event. The
 * fields are the projection contract (identity, order, time, version) — the
 * protocol that fills `type`/`payload` is Coven's (coven#855) and is consumed
 * defensively, never invented. */
export type AutomationProjectionEvent = {
  schemaVersion: 1;
  /** Canonical, globally unique event id (dedupe key). */
  id: string;
  /** Monotonic sequence within the stream (regression guard). */
  seq: number;
  /** When Coven emitted the event (ISO 8601). */
  occurredAt: string;
  type: string;
  payload?: unknown;
};

/** One authoritative contact with the daemon. Snapshots and run lists are the
 * transport that exists today; `event` is the changefeed shape above;
 * `unavailable` records a failed contact so degradation can be *shown*. */
export type AutomationProjectionInput =
  | {
      kind: "snapshot";
      /** When the snapshot was taken (ISO 8601). */
      at: string;
      routines: readonly { id: string; status: "ACTIVE" | "PAUSED" }[];
    }
  | {
      kind: "runs";
      at: string;
      /** Which routine these runs belong to. */
      routineId: string;
      /** The daemon's bounded runs response, any order. */
      runs: readonly ProjectedRunObservation[];
    }
  | { kind: "event"; event: AutomationProjectionEvent }
  | { kind: "unavailable"; at: string; reason: string };

/** How current the projection is, as an overview row must say out loud.
 * `degraded` = the daemon was just unreachable (cached data still within the
 * staleness threshold); `stale` = nothing authoritative within the threshold;
 * `offline` = no projection has ever been built. */
export type AutomationFreshness = "live" | "stale" | "degraded" | "offline";

/** Bounded, derived client state — everything here is reconstructible from
 * authoritative contacts, so losing it loses nothing. */
export type AutomationProjectionState = {
  /** Definition status per routine, as the latest snapshot listed them. */
  readonly routineStatusById: ReadonlyMap<string, "ACTIVE" | "PAUSED">;
  /** Newest authoritative run observation per routine (history stays
   * readable from the daemon on demand — one entry per routine keeps this
   * bounded). Entries for since-deleted routines are kept: they are facts
   * about the past, not claims about the present. */
  readonly newestRunByRoutine: ReadonlyMap<string, ProjectedRunObservation>;
  /** Consecutive terminal failures, derived only from a `runs` contact (the
   * only input that carries enough ordered history to count honestly). */
  readonly consecutiveFailuresByRoutine: ReadonlyMap<string, number>;
  /** Last authoritative contact of any accepted kind (ISO 8601). */
  readonly lastObservedAt: string | null;
  /** Last snapshot that replaced the definition state (ISO 8601). */
  readonly lastSnapshotAt: string | null;
  /** Highest event sequence accepted so far. */
  readonly lastSeq: number;
  /** Canonical id of the last accepted event (replay cursor). */
  readonly lastEventId: string | null;
  /** Bounded FIFO of canonical ids already applied (dedupe window). */
  readonly seenEventIds: ReadonlySet<string>;
  /** The last failed authoritative contact, when one happened. */
  readonly lastFailure: { at: string; reason: string } | null;
  readonly counts: {
    snapshots: number;
    runObservations: number;
    eventsAccepted: number;
    eventsDuplicate: number;
    eventsRefused: number;
    eventsUnhandled: number;
    unavailable: number;
  };
};

/** How long a projection may sit without authoritative contact before it must
 * stop calling itself live. The Automations view polls at 15s, so two minutes
 * of silence means something is wrong; the caller may tighten or loosen it. */
export const DEFAULT_STALE_AFTER_MS = 120_000;

/** Cap on the dedupe window. Bounded buffering is a requirement, not an
 * optimization: a changefeed must not be able to grow this state without
 * bound. A replayed event whose id was evicted is still stopped by the
 * sequence guard, so eviction widens no hole. */
export const MAX_SEEN_EVENT_IDS = 1024;

export function emptyAutomationProjection(): AutomationProjectionState {
  return {
    routineStatusById: new Map(),
    newestRunByRoutine: new Map(),
    consecutiveFailuresByRoutine: new Map(),
    lastObservedAt: null,
    lastSnapshotAt: null,
    lastSeq: 0,
    lastEventId: null,
    seenEventIds: new Set(),
    lastFailure: null,
    counts: {
      snapshots: 0,
      runObservations: 0,
      eventsAccepted: 0,
      eventsDuplicate: 0,
      eventsRefused: 0,
      eventsUnhandled: 0,
      unavailable: 0,
    },
  };
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isRunObservationLike(value: unknown): value is ProjectedRunObservation {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.id === "string" &&
    run.id.length > 0 &&
    typeof run.automationId === "string" &&
    run.automationId.length > 0 &&
    typeof run.status === "string" &&
    (RUN_STATUSES as readonly string[]).includes(run.status) &&
    typeof run.startedAt === "string" &&
    parseMs(run.startedAt) !== null
  );
}

/** Order runs newest-first by their own start timestamps. Re-established
 * rather than assumed: callers may hand the daemon response through in any
 * order, and "newest" decided by array position would make a projection
 * follow a run that is not the latest. */
function orderedNewestFirst(
  runs: readonly ProjectedRunObservation[],
): ProjectedRunObservation[] {
  return [...runs]
    .filter(isRunObservationLike)
    .sort((a, b) => (parseMs(b.startedAt) ?? 0) - (parseMs(a.startedAt) ?? 0));
}

/** Consecutive terminal failures at the head of a run history (newest first).
 * Stops at the first non-failure: an older failure behind a success is
 * history, not a streak. */
export function consecutiveFailures(runs: readonly ProjectedRunObservation[]): number {
  let failures = 0;
  for (const run of orderedNewestFirst(runs)) {
    if (run.status !== "failed") break;
    failures += 1;
  }
  return failures;
}

function withCounts(
  state: AutomationProjectionState,
  patch: Partial<AutomationProjectionState["counts"]>,
): AutomationProjectionState["counts"] {
  return { ...state.counts, ...patch };
}

function rememberEventId(seen: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(seen);
  next.add(id);
  if (next.size > MAX_SEEN_EVENT_IDS) {
    for (const oldest of next) {
      next.delete(oldest);
      break; // evict exactly one — the FIFO head
    }
  }
  return next;
}

/**
 * Fold one authoritative contact into the projection.
 *
 * Pure, with two return regimes:
 *
 *   • **Structurally unusable input** — an unparseable timestamp, an empty
 *     routine id, a non-array runs list — changed nothing and counts nothing:
 *     the SAME state reference comes back (caller garbage is a logging
 *     concern, not feed state).
 *   • **Feed-discipline outcomes** — a duplicate delivery, a refused
 *     envelope, a sequence regression, an unhandled payload — are real
 *     occurrences on the authoritative channel, so each bumps a counter and
 *     returns a NEW state (the count itself is renderable: "the feed sent
 *     something Cave could not apply" is exactly what the issue requires be
 *     visible, never silent).
 */
export function reduceAutomationProjection(
  state: AutomationProjectionState,
  input: AutomationProjectionInput,
): AutomationProjectionState {
  if (input.kind === "unavailable") {
    const at = parseMs(input.at);
    if (at === null) return state;
    return {
      ...state,
      lastFailure: { at: input.at, reason: input.reason },
      counts: withCounts(state, { unavailable: state.counts.unavailable + 1 }),
    };
  }

  if (input.kind === "snapshot") {
    if (parseMs(input.at) === null || !Array.isArray(input.routines)) return state;
    const routines = new Map<string, "ACTIVE" | "PAUSED">();
    for (const entry of input.routines) {
      if (typeof entry?.id !== "string" || entry.id.length === 0) continue;
      if (entry.status !== "ACTIVE" && entry.status !== "PAUSED") continue;
      routines.set(entry.id, entry.status);
    }
    return {
      ...state,
      routineStatusById: routines,
      // A snapshot is authoritative: routines Coven no longer lists leave the
      // definition projection. Run observations are kept — they are history,
      // not a claim that anything is still scheduled.
      lastSnapshotAt: input.at,
      lastObservedAt: input.at,
      counts: withCounts(state, { snapshots: state.counts.snapshots + 1 }),
    };
  }

  if (input.kind === "runs") {
    if (parseMs(input.at) === null) return state;
    if (typeof input.routineId !== "string" || input.routineId.length === 0) return state;
    const ordered = orderedNewestFirst(Array.isArray(input.runs) ? input.runs : []);
    const newestRunByRoutine = new Map(state.newestRunByRoutine);
    const consecutiveFailuresByRoutine = new Map(state.consecutiveFailuresByRoutine);
    if (ordered.length === 0) {
      // An authoritative empty history means "no runs" — not "keep whatever
      // the projection remembered". Clearing is the honest read.
      newestRunByRoutine.delete(input.routineId);
      consecutiveFailuresByRoutine.delete(input.routineId);
    } else {
      newestRunByRoutine.set(input.routineId, ordered[0]);
      consecutiveFailuresByRoutine.set(input.routineId, consecutiveFailures(ordered));
    }
    return {
      ...state,
      newestRunByRoutine,
      consecutiveFailuresByRoutine,
      lastObservedAt: input.at,
      counts: withCounts(state, { runObservations: state.counts.runObservations + 1 }),
    };
  }

  // ── changefeed event ──────────────────────────────────────────────────────
  const event = input.event;
  const occurredMs = parseMs(event?.occurredAt);
  if (
    typeof event !== "object" ||
    event === null ||
    occurredMs === null ||
    event.schemaVersion !== 1 ||
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    typeof event.type !== "string" ||
    !Number.isInteger(event.seq) ||
    event.seq <= 0
  ) {
    // A malformed envelope is refused whole: it advances no cursor, updates no
    // observation, and is counted so the surface can say the feed sent
    // something Cave could not trust.
    return {
      ...state,
      counts: withCounts(state, { eventsRefused: state.counts.eventsRefused + 1 }),
    };
  }

  if (state.seenEventIds.has(event.id)) {
    // Canonical dedupe: the same delivery replayed changes nothing and keeps
    // the state reference identical so dependents can skip work.
    return {
      ...state,
      counts: withCounts(state, { eventsDuplicate: state.counts.eventsDuplicate + 1 }),
    };
  }

  if (event.seq <= state.lastSeq) {
    // Impossible regression — a replayed or reordered past. Refuse: state
    // never moves backwards, and nothing is re-applied on the way there.
    return {
      ...state,
      counts: withCounts(state, { eventsRefused: state.counts.eventsRefused + 1 }),
    };
  }

  const knownType = event.type === "run.observed";
  const payloadOk = knownType && isRunObservationLike(event.payload);

  let newestRunByRoutine = state.newestRunByRoutine;
  if (payloadOk) {
    const run = event.payload as ProjectedRunObservation;
    const runs = new Map(state.newestRunByRoutine);
    runs.set(run.automationId, run);
    newestRunByRoutine = runs;
  }

  return {
    ...state,
    newestRunByRoutine,
    lastObservedAt: event.occurredAt,
    lastSeq: event.seq,
    lastEventId: event.id,
    seenEventIds: rememberEventId(state.seenEventIds, event.id),
    counts: withCounts(state, {
      eventsAccepted: state.counts.eventsAccepted + 1,
      // Every accepted envelope whose payload was NOT applied — an unknown
      // type, or a known type carrying an unreadable payload — is counted, so
      // the surface can report feed trouble instead of silently dropping it.
      eventsUnhandled: payloadOk ? state.counts.eventsUnhandled : state.counts.eventsUnhandled + 1,
    }),
  };
}

/**
 * How current the projection is, for an overview row or header to state.
 *
 * The caller injects the clock. The threshold is overridable because it is a
 * product decision (the issue requires the staleness threshold be shown, not
 * buried); the default reads the view's own cadence.
 */
export function automationProjectionFreshness(
  state: AutomationProjectionState,
  nowMs: number,
  opts: { staleAfterMs?: number } = {},
): AutomationFreshness {
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const observedMs = parseMs(state.lastObservedAt);
  if (observedMs === null) return "offline"; // no projection has ever been built
  const failureMs = parseMs(state.lastFailure?.at ?? null);
  const age = nowMs - observedMs;
  if (age > staleAfterMs) return "stale";
  // Still within the threshold — but if the newest contact was a FAILURE, the
  // daemon was unreachable as of that contact: say degraded, not live.
  return failureMs !== null && failureMs >= observedMs ? "degraded" : "live";
}

/** Whether an in-flight run observation has aged past the point where a
 * surface may keep presenting it as live.
 *
 * `staleAfterMs` is deliberately required: the honest threshold depends on
 * what the caller knows (a routine's own timeout budget, the poll cadence,
 * the changefeed lag), and a defaulted guess here would silently relabel
 * long-but-legitimate runs as suspect. Terminal statuses are never stale —
 * they are final facts, however old. The caller injects the clock. */
export function isStaleRunObservation(
  run: Pick<ProjectedRunObservation, "status" | "startedAt">,
  nowMs: number,
  opts: { staleAfterMs: number },
): boolean {
  if (run.status !== "running" && run.status !== "queued") return false;
  const startedMs = parseMs(run.startedAt);
  if (startedMs === null) return true; // an in-flight run with no usable start time cannot be shown as live
  return nowMs - startedMs > opts.staleAfterMs;
}
