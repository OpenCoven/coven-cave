/**
 * Observe running tasks' sessions and settle the ones that ended (#6562
 * slice 2). The pure verdicts live in task-run-reconcile.ts; the board
 * mutation is `settleEndedTaskRuns` in cave-board.ts. This module gathers the
 * evidence:
 *
 * - a chat run in flight in this server process → live;
 * - a Cave-native transcript → its last turn;
 * - otherwise the daemon's own record of the session: its status (with the
 *   stale-running ghost probe for running-tone rows), or `missing` only when
 *   Coven answers `session_not_found`. The unpaged session list leaves out
 *   archived sessions, so absence from it is not proof.
 *
 * Read-only until the verdict, and fail-open: a daemon that is offline,
 * slow or erroring yields `unknown`, which never settles a card. It never
 * kills, resends or restarts anything.
 */

import { loadBoard, settleEndedTaskRuns, type Card, type EndedTaskRunSettlement } from "@/lib/cave-board";
import { conversationFileExists, loadConversation } from "@/lib/cave-conversations";
import { callDaemon } from "@/lib/coven-daemon";
import { daemonErrorCode } from "@/lib/server/daemon-session-error";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";
import { sweepStaleRunningGhosts, type StaleRunningRow } from "@/lib/server/stale-running-sweep";
import {
  classifyTaskRun,
  isTaskRunProbeCandidate,
  lastTranscriptTurn,
  TASK_RUN_STALE_AFTER_MS,
  type TaskSessionEvidence,
  type TaskTranscriptTurn,
} from "@/lib/task-run-reconcile";

/** A daemon read must not hold up a board load for long. */
const DAEMON_READ_TIMEOUT_MS = 2_000;

/** Repeated board loads inside this window reuse the last sweep. */
export const TASK_RUN_SWEEP_INTERVAL_MS = 60_000;

/** Bound the work per sweep; anything beyond waits for the next one. */
const MAX_CARDS_PER_SWEEP = 32;

type DaemonRow = StaleRunningRow;

export type TaskRunProbeDeps = {
  nowMs: () => number;
  hasActiveChatRun: (sessionId: string) => boolean;
  /** `undefined` = no transcript; `null` = unreadable. */
  loadTranscript: (sessionId: string) => Promise<{ turns: TaskTranscriptTurn[] } | null | undefined>;
  /** The daemon's row, `"missing"` for Coven's typed not-found, `null` when it can't tell. */
  getDaemonSession: (sessionId: string) => Promise<DaemonRow | "missing" | null>;
  /** Session ids whose running-tone row is a confirmed ghost. */
  ghostSessions: (rows: DaemonRow[]) => Promise<Set<string>>;
  settle: (settlements: readonly EndedTaskRunSettlement[]) => Promise<Card[]>;
  thresholdMs?: number;
};

function isDaemonRow(value: unknown): value is DaemonRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.status === "string";
}

/**
 * Coven's record of one session. Only its typed `session_not_found` proves
 * absence: a proxy can synthesize a bare 404 while the daemon still owns it.
 */
export async function readDaemonSession(sessionId: string): Promise<DaemonRow | "missing" | null> {
  const res = await callDaemon<unknown>({
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    timeoutMs: DAEMON_READ_TIMEOUT_MS,
  });
  return daemonSessionFromResponse(res);
}

/** Pure half of `readDaemonSession`, for tests. */
export function daemonSessionFromResponse(
  res: { ok: boolean; status: number; data: unknown },
): DaemonRow | "missing" | null {
  if (!res.ok) {
    return res.status === 404 && daemonErrorCode(res) === "session_not_found" ? "missing" : null;
  }
  if (!isDaemonRow(res.data)) return null;
  const row = res.data as DaemonRow & Record<string, unknown>;
  return {
    id: row.id,
    status: row.status,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

const defaultDeps: TaskRunProbeDeps = {
  nowMs: () => Date.now(),
  hasActiveChatRun,
  loadTranscript: async (sessionId) => {
    try {
      const conversation = await loadConversation(sessionId);
      if (conversation) return { turns: conversation.turns };
      // loadConversation folds "absent" and "unreadable" into null. Only a
      // transcript that was never written sends the probe to the daemon.
      return (await conversationFileExists(sessionId)) ? null : undefined;
    } catch {
      return null;
    }
  },
  getDaemonSession: (sessionId) => readDaemonSession(sessionId),
  ghostSessions: (rows) => sweepStaleRunningGhosts(rows),
  settle: settleEndedTaskRuns,
};

/** Gather evidence for each candidate card. Exported for tests. */
export async function probeTaskRuns(
  cards: readonly Card[],
  deps: TaskRunProbeDeps,
): Promise<Map<string, TaskSessionEvidence>> {
  const evidence = new Map<string, TaskSessionEvidence>();
  const needDaemon: Card[] = [];
  // Every read runs in parallel, so a slow daemon costs one timeout per
  // sweep, not one per card.
  const transcripts = await Promise.all(cards.map(async (card) => {
    const sessionId = card.sessionId!;
    if (deps.hasActiveChatRun(sessionId)) return "live" as const;
    try {
      return await deps.loadTranscript(sessionId);
    } catch {
      return null;
    }
  }));
  cards.forEach((card, index) => {
    const transcript = transcripts[index];
    if (transcript === "live") evidence.set(card.id, { kind: "live" });
    else if (transcript === null) evidence.set(card.id, { kind: "unknown" });
    else if (transcript) evidence.set(card.id, { kind: "native", lastTurn: lastTranscriptTurn(transcript.turns) });
    else needDaemon.push(card);
  });
  if (needDaemon.length === 0) return evidence;

  const rows = new Map<string, DaemonRow>();
  const daemonRows = await Promise.all(needDaemon.map(async (card) => {
    try {
      return await deps.getDaemonSession(card.sessionId!);
    } catch {
      return null;
    }
  }));
  needDaemon.forEach((card, index) => {
    const row = daemonRows[index];
    if (row === null) evidence.set(card.id, { kind: "unknown" });
    else if (row === "missing") evidence.set(card.id, { kind: "missing" });
    else rows.set(card.id, row);
  });
  if (rows.size === 0) return evidence;
  let ghosts = new Set<string>();
  try {
    ghosts = await deps.ghostSessions([...rows.values()]);
  } catch {
    ghosts = new Set();
  }
  for (const [cardId, row] of rows) {
    evidence.set(cardId, { kind: "daemon", status: row.status, updatedAt: row.updated_at || null, ghost: ghosts.has(row.id) });
  }
  return evidence;
}

/**
 * One sweep: probe every running task old enough to have ended and settle
 * the ones whose run provably did. Returns the cards it changed.
 */
export async function reconcileStaleTaskRuns(deps: TaskRunProbeDeps = defaultDeps): Promise<Card[]> {
  const nowMs = deps.nowMs();
  const thresholdMs = deps.thresholdMs ?? TASK_RUN_STALE_AFTER_MS;
  const board = await loadBoard();
  const candidates = board.cards
    .filter((card) => isTaskRunProbeCandidate(card, nowMs, thresholdMs))
    .slice(0, MAX_CARDS_PER_SWEEP);
  if (candidates.length === 0) return [];

  const evidence = await probeTaskRuns(candidates, deps);
  const settlements: EndedTaskRunSettlement[] = [];
  for (const card of candidates) {
    const observed = evidence.get(card.id) ?? { kind: "unknown" as const };
    const verdict = classifyTaskRun(card, observed, { nowMs, thresholdMs });
    if (verdict.kind !== "ended") continue;
    settlements.push({
      id: card.id,
      sessionId: card.sessionId!,
      lifecycleAt: card.lifecycleAt,
      outcome: verdict.outcome,
      evidence: verdict.evidence,
    });
  }
  return deps.settle(settlements);
}

let lastSweepMs = Number.NEGATIVE_INFINITY;
let inFlight: Promise<Card[]> | null = null;

/**
 * The throttled entry point the board list calls: at most one sweep a
 * minute, concurrent callers share the one in flight, and a failure is
 * logged, never thrown, so a board load can't fail because of it.
 */
export async function maybeReconcileStaleTaskRuns(deps?: TaskRunProbeDeps): Promise<Card[]> {
  if (inFlight) return inFlight;
  const nowMs = (deps ?? defaultDeps).nowMs();
  if (nowMs - lastSweepMs < TASK_RUN_SWEEP_INTERVAL_MS) return [];
  lastSweepMs = nowMs;
  inFlight = reconcileStaleTaskRuns(deps).catch((error) => {
    console.warn("[task-runs] could not reconcile running tasks:", error instanceof Error ? error.message : error);
    return [];
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The longest a board load waits for a sweep before answering without it. */
export const BOARD_SWEEP_WAIT_MS = 2_500;

/**
 * What the board list awaits: the throttled sweep, but never longer than
 * `waitMs`. A sweep that runs past it keeps going and lands its settlements
 * through the normal board-change notification.
 */
export async function reconcileStaleTaskRunsBriefly(
  waitMs = BOARD_SWEEP_WAIT_MS,
  deps?: TaskRunProbeDeps,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    await Promise.race([maybeReconcileStaleTaskRuns(deps).then(() => undefined), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: forget the throttle. */
export function resetTaskRunSweepForTest(): void {
  lastSweepMs = Number.NEGATIVE_INFINITY;
  inFlight = null;
}
