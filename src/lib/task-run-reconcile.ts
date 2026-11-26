/**
 * Settling tasks whose run has ended (#6562 slice 2).
 *
 * A task is `dispatched` or `running` only while its work runs. Nothing used
 * to notice when the task's session finished, so a card could sit in Running
 * for weeks after its last reply. This module is the pure half: given what
 * the server can observe about the task's session, decide whether the run
 * provably ended and how. The board mutator applies the verdict under the
 * board lock (`settleEndedTaskRuns` in cave-board.ts).
 *
 * Rules:
 * - Only evidence settles a card. A failed or unavailable probe (daemon
 *   offline, unreadable transcript) keeps it as it is.
 * - Nothing is ever marked completed. A run that ended cleanly goes to
 *   Review, where a person decides; one that errored, stopped before its
 *   reply or lost its session is failed; one the person stopped is cancelled.
 * - A run inside the grace window, measured from the later of its dispatch
 *   and its last activity, is never settled, so a slow turn or a pause
 *   between turns is not mistaken for an ended run.
 */

import type { Card } from "./cave-board-types.ts";
import { sessionStatusTone } from "./session-status.ts";

/** Long enough for any single chat turn; matches the daemon ghost sweep. */
export const TASK_RUN_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * A message with no reply settles only after this long. The in-flight check
 * sees runs in this server process alone, and another Cave server sharing the
 * board (the installed app beside a dev server) may still be streaming the
 * reply, so silence must outlast any real turn before it counts as failure.
 */
export const UNANSWERED_TURN_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type TaskTranscriptTurn = {
  role: string;
  createdAt: string;
  durationMs?: number;
  isError?: boolean;
  cancelled?: boolean;
};

/** What the server observed about a task's session. */
export type TaskSessionEvidence =
  /** A chat run is in flight in this server process. */
  | { kind: "live" }
  /** The probe could not tell (daemon offline, unreadable transcript). */
  | { kind: "unknown" }
  /** A Cave-native transcript; `lastTurn` is null when it has no turns. */
  | { kind: "native"; lastTurn: TaskTranscriptTurn | null }
  /** A daemon session row. `ghost` is the stale-running sweep's verdict. */
  | { kind: "daemon"; status: string; updatedAt: string | null; ghost: boolean }
  /** The daemon answered, has no such session, and there is no transcript. */
  | { kind: "missing" };

export type EndedRunOutcome = "review" | "failed" | "cancelled";

export type TaskRunVerdict =
  | { kind: "keep" }
  | { kind: "ended"; outcome: EndedRunOutcome; evidence: string };

export function isRunningTaskLifecycle(card: Pick<Card, "lifecycle">): boolean {
  return card.lifecycle === "dispatched" || card.lifecycle === "running";
}

function parseMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/** The later of the card's dispatch and its running mark. NaN when neither parses. */
function runStartMs(card: Pick<Card, "lifecycleAt" | "runningSince">): number {
  const values = [parseMs(card.lifecycleAt), parseMs(card.runningSince)].filter(Number.isFinite);
  return values.length ? Math.max(...values) : Number.NaN;
}

/** Whether the card is old enough to be worth probing at all. */
export function isTaskRunProbeCandidate(
  card: Pick<Card, "lifecycle" | "lifecycleAt" | "runningSince" | "sessionId">,
  nowMs: number,
  thresholdMs = TASK_RUN_STALE_AFTER_MS,
): boolean {
  if (!isRunningTaskLifecycle(card) || !card.sessionId) return false;
  const started = runStartMs(card);
  // An unparsable dispatch time never qualifies: NaN fails the comparison.
  return nowMs - started >= thresholdMs;
}

function shortId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

/**
 * Decide whether a running task's run has provably ended. Pure: the caller
 * supplies the evidence and the clock.
 */
export function classifyTaskRun(
  card: Pick<Card, "lifecycle" | "lifecycleAt" | "runningSince" | "sessionId">,
  evidence: TaskSessionEvidence,
  options: { nowMs: number; thresholdMs?: number },
): TaskRunVerdict {
  const thresholdMs = options.thresholdMs ?? TASK_RUN_STALE_AFTER_MS;
  if (!isTaskRunProbeCandidate(card, options.nowMs, thresholdMs)) return { kind: "keep" };
  const session = `Session ${shortId(card.sessionId!)}`;
  const checked = new Date(options.nowMs).toISOString();

  switch (evidence.kind) {
    case "live":
    case "unknown":
      return { kind: "keep" };
    case "missing":
      return {
        kind: "ended",
        outcome: "failed",
        evidence: `${session} no longer exists (checked ${checked})`,
      };
    case "native": {
      const turn = evidence.lastTurn;
      // An empty transcript proves nothing about the run.
      if (!turn) return { kind: "keep" };
      const turnMs = parseMs(turn.createdAt);
      if (!Number.isFinite(turnMs)) return { kind: "keep" };
      const endedMs = turnMs + (typeof turn.durationMs === "number" && turn.durationMs > 0 ? turn.durationMs : 0);
      if (options.nowMs - endedMs < thresholdMs) return { kind: "keep" };
      const at = new Date(endedMs).toISOString();
      if (turn.role === "user") {
        if (options.nowMs - endedMs < Math.max(thresholdMs, UNANSWERED_TURN_STALE_AFTER_MS)) return { kind: "keep" };
        return {
          kind: "ended",
          outcome: "failed",
          evidence: `${session} got no reply to the message sent at ${at} and has no run in progress here (checked ${checked})`,
        };
      }
      if (turn.role !== "assistant") return { kind: "keep" };
      if (turn.cancelled) {
        return {
          kind: "ended",
          outcome: "cancelled",
          evidence: `${session}'s last reply was stopped at ${at} (checked ${checked})`,
        };
      }
      if (turn.isError) {
        return {
          kind: "ended",
          outcome: "failed",
          evidence: `${session}'s last reply failed at ${at} (checked ${checked})`,
        };
      }
      return {
        kind: "ended",
        outcome: "review",
        evidence: `${session} finished its last reply at ${at}; no run is in progress (checked ${checked})`,
      };
    }
    case "daemon": {
      const tone = sessionStatusTone(evidence.status);
      const status = evidence.status.trim().toLowerCase() || "unknown";
      if (tone === "running") {
        if (!evidence.ghost) return { kind: "keep" };
        return {
          kind: "ended",
          outcome: "failed",
          evidence: `${session} still reads ${status}, but no process is attached (checked ${checked})`,
        };
      }
      if (tone === "done") {
        return {
          kind: "ended",
          outcome: "review",
          evidence: `${session} ended with status ${status} (checked ${checked})`,
        };
      }
      if (tone === "failed") {
        return {
          kind: "ended",
          outcome: "failed",
          evidence: `${session} ended with status ${status} (checked ${checked})`,
        };
      }
      // Idle-tone rows (created, paused, an unknown word) prove nothing.
      return { kind: "keep" };
    }
  }
}

/** The last turn by time, ignoring structural system rows. */
export function lastTranscriptTurn(turns: readonly TaskTranscriptTurn[]): TaskTranscriptTurn | null {
  let last: TaskTranscriptTurn | null = null;
  let lastMs = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const ms = parseMs(turn.createdAt);
    if (!Number.isFinite(ms)) continue;
    // Equal timestamps keep the later array entry: a reply is written after
    // the message it answers, often with the same createdAt.
    if (ms >= lastMs) {
      last = turn;
      lastMs = ms;
    }
  }
  return last;
}

/** System next step a run that ended cleanly carries into Review. */
export const ENDED_RUN_REVIEW_STEP_SUMMARY = "Review what the task chat produced";
