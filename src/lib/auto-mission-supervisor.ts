import {
  autoMissionSessionIds,
  isAutoMissionTimedOut,
  pendingAutoMissionPings,
  readAutoMission,
  touchAutoMission,
  writeAutoMission,
  isAutoMissionArmed,
  type AutoMissionStorage,
  type AutoMissionPing,
  type AutoMissionRecord,
  type AutoTurnLike,
} from "./auto-mission-state.ts";

/** Keep the workspace watcher alive even when no ChatView is mounted. */
export const AUTO_MISSION_WATCH_INTERVAL_MS = 60_000;

export type AutoMissionObservation = {
  record: AutoMissionRecord;
  turns: readonly AutoTurnLike[];
  previousFingerprint: string | null;
  /** Durable history loaded for the first time should not reset its deadline. */
  initialObservation?: boolean;
  nowMs: number;
};

export type AutoMissionObservationResult = {
  record: AutoMissionRecord;
  fingerprint: string;
  pings: AutoMissionPing[];
  timedOut: boolean;
  activityTouched: boolean;
};

export type AutoMissionTranscript = {
  turns: readonly AutoTurnLike[];
  familiarId?: string | null;
};

export type AutoMissionNotification = {
  kind: "response-needed" | "agent";
  title: string;
  body: string;
  source: "agent";
  familiarId: string | null;
  sessionId: string;
  auto: "auto-mission";
  link: { kind: "session"; ref: string };
};

export type AutoMissionSupervisionResult = {
  observedSessionIds: string[];
  notificationCount: number;
  timedOutSessionIds: string[];
};

/** A stable, content-sensitive identity for a transcript observation. */
export function autoMissionTurnFingerprint(turns: readonly AutoTurnLike[]): string {
  return JSON.stringify(
    turns.map((turn) => [turn.id, turn.role, turn.text, turn.createdAt, turn.pending === true]),
  );
}

/**
 * Apply one workspace-level transcript observation to an armed mission.
 *
 * The first durable read establishes a baseline; it must not make an old
 * record look newly active merely because the app was reopened. Subsequent
 * transcript changes are real activity and extend the quiet deadline.
 */
export function observeAutoMission(
  args: AutoMissionObservation,
): AutoMissionObservationResult {
  const fingerprint = autoMissionTurnFingerprint(args.turns);
  const changed = args.previousFingerprint !== fingerprint;
  const activityTouched = changed && !args.initialObservation;
  const record = activityTouched
    ? touchAutoMission(args.record, args.nowMs)
    : args.record;
  const pings = pendingAutoMissionPings(record, args.turns);
  return {
    record,
    fingerprint,
    pings,
    timedOut: pings.length === 0 && isAutoMissionTimedOut(record, args.turns, args.nowMs),
    activityTouched,
  };
}

/** Build the persisted terminal state used by marker, timeout, and cancel paths. */
export function endAutoMission(
  record: AutoMissionRecord,
  outcome: NonNullable<AutoMissionRecord["outcome"]>,
  completedAt: string,
): AutoMissionRecord {
  return {
    ...record,
    completedAt,
    outcome,
    feedbackPending: true,
  };
}

function sameMissionIdentity(a: AutoMissionRecord, b: AutoMissionRecord): boolean {
  return a.mission === b.mission && a.startedAt === b.startedAt;
}

function notificationFor(
  sessionId: string,
  record: AutoMissionRecord,
  event: AutoMissionPing | { state: "timed-out" },
  familiarId: string | null,
): AutoMissionNotification {
  const attention = event.state === "needs-approval" || event.state === "blocked" || event.state === "timed-out";
  const title = event.state === "needs-approval"
    ? "Auto mission needs your go-ahead"
    : event.state === "blocked"
      ? "Auto mission needs you"
      : event.state === "failed"
        ? "Auto mission couldn't finish"
        : event.state === "timed-out"
          ? "Auto mission went quiet"
          : "Auto mission complete";
  const body = event.state === "timed-out"
    ? `No word back on "${record.mission}". Check the thread — it may have stalled.`
    : event.note || record.mission;
  return {
    kind: attention ? "response-needed" : "agent",
    title,
    body,
    source: "agent",
    familiarId,
    sessionId,
    auto: "auto-mission",
    link: { kind: "session", ref: sessionId },
  };
}

type TerminalAutoMissionPing = AutoMissionPing & { state: "failed" | "done" };

function terminalPing(pings: readonly AutoMissionPing[]): TerminalAutoMissionPing | null {
  for (const ping of [...pings].reverse()) {
    if (ping.state === "failed" || ping.state === "done") return ping;
  }
  return null;
}

/**
 * Observe all persisted missions once and claim any notifications that the
 * transcript or watchdog owes. The caller owns the recurring schedule; this
 * function owns the read/observe/claim ordering so a mounted ChatView cannot
 * race it back into an armed state after cancellation.
 */
export async function superviseAutoMissions(args: {
  storage: AutoMissionStorage | null | undefined;
  loadTranscript: (sessionId: string) => Promise<AutoMissionTranscript | null>;
  sendNotification: (notification: AutoMissionNotification) => Promise<boolean> | boolean;
  fingerprints: Map<string, string>;
  nowMs: number;
  nowIso: string;
  sessionIds?: readonly string[];
}): Promise<AutoMissionSupervisionResult> {
  const sessionIds = args.sessionIds ?? autoMissionSessionIds(args.storage);
  const observedSessionIds: string[] = [];
  const timedOutSessionIds: string[] = [];
  let notificationCount = 0;

  for (const sessionId of sessionIds) {
    const initial = readAutoMission(sessionId, args.storage);
    if (!isAutoMissionArmed(initial) || !initial) {
      args.fingerprints.delete(sessionId);
      continue;
    }

    const transcript = await args.loadTranscript(sessionId);
    // A failed read is not an empty transcript. Retrying the next workspace
    // tick is safer than timing out a healthy mission on a transient outage.
    if (!transcript) continue;

    // Cancellation or a newer mission may have won while the transcript was
    // loading. Never apply an observation against that stale snapshot.
    const current = readAutoMission(sessionId, args.storage);
    if (!current || !isAutoMissionArmed(current) || !sameMissionIdentity(initial, current)) {
      args.fingerprints.delete(sessionId);
      continue;
    }

    const withFamiliar = !current.familiarId && transcript.familiarId
      ? { ...current, familiarId: transcript.familiarId }
      : current;
    const observation = observeAutoMission({
      record: withFamiliar,
      turns: transcript.turns,
      previousFingerprint: args.fingerprints.get(sessionId) ?? null,
      initialObservation: !args.fingerprints.has(sessionId),
      nowMs: args.nowMs,
    });
    args.fingerprints.set(sessionId, observation.fingerprint);
    observedSessionIds.push(sessionId);

    if (observation.activityTouched || withFamiliar !== current) {
      if (!writeAutoMission(sessionId, observation.record, args.storage)) continue;
    }

    // Re-read after the synchronous activity write. This makes a persisted
    // cancellation authoritative even if a stale mounted view or another
    // observer changed the record during the async transcript load.
    const ready = readAutoMission(sessionId, args.storage);
    if (!ready || !isAutoMissionArmed(ready) || !sameMissionIdentity(initial, ready)) {
      args.fingerprints.delete(sessionId);
      continue;
    }

    if (observation.pings.length > 0) {
      const notified = new Set(ready.notified);
      for (const ping of observation.pings) notified.add(ping.turnId);
      const terminal = terminalPing(observation.pings);
      const next = terminal
        ? endAutoMission({ ...ready, notified: [...notified] }, terminal.state, args.nowIso)
        : { ...ready, notified: [...notified] };
      // Claim the turn ids and terminal state before emitting. A rerender,
      // event, or second observer therefore sees the durable claim and cannot
      // emit the same inbox item twice.
      if (!writeAutoMission(sessionId, next, args.storage)) continue;
      for (const ping of observation.pings) {
        if (await args.sendNotification(notificationFor(sessionId, next, ping, next.familiarId ?? transcript.familiarId ?? null))) {
          notificationCount += 1;
        }
      }
      continue;
    }

    if (!observation.timedOut) continue;
    const stillArmed = readAutoMission(sessionId, args.storage);
    if (!stillArmed || !isAutoMissionArmed(stillArmed) || !sameMissionIdentity(initial, stillArmed)) {
      args.fingerprints.delete(sessionId);
      continue;
    }
    const ended = endAutoMission(stillArmed, "timed-out", args.nowIso);
    if (!writeAutoMission(sessionId, ended, args.storage)) continue;
    timedOutSessionIds.push(sessionId);
    if (await args.sendNotification(notificationFor(sessionId, ended, { state: "timed-out" }, ended.familiarId ?? transcript.familiarId ?? null))) {
      notificationCount += 1;
    }
  }

  return { observedSessionIds, notificationCount, timedOutSessionIds };
}
