/**
 * `/auto` mission state — the per-session record that makes an autonomous
 * mission survive a reload, stay scoped to the chat it was started in, and
 * disarm once it terminates.
 *
 * Why this exists rather than plain React state: the whole promise of /auto
 * is an UNATTENDED run. The user starts a mission and walks away — closing,
 * reloading, or switching chats is the expected case, not the edge case. A
 * mission held only in component state loses its arming on the first reload,
 * so the completion ping (the one thing the feature exists to deliver) never
 * fires. Persisting also carries the already-notified turn ids, so a reload
 * that re-reads the transcript can't re-ping for a turn already announced.
 *
 * Pure helpers with injected storage (chat-archive-nudge.ts convention) so
 * the whole decision path is testable under `node --test` with no DOM.
 */

import { extractAutoStatusMarkers, type AutoMissionState } from "./auto-status-blocks.ts";

/** Minimal Storage surface — window.localStorage or a test fake. */
export type AutoMissionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
  & Partial<Pick<Storage, "length" | "key">>;

/** Prefix for the per-session records in localStorage. */
export const AUTO_MISSION_STORAGE_PREFIX = "cave:auto-mission:";

/** Same-document signal for the workspace watcher and an open ChatView. */
export const AUTO_MISSION_CHANGED_EVENT = "cave:auto-mission-changed";

export type AutoMissionRecord = {
  /** The mission text as the human typed it. */
  mission: string;
  /** The familiar that started the mission, when known. */
  familiarId?: string | null;
  startedAt: string;
  /**
   * Turn ids already announced to the human. Persisted so a reload — which
   * re-reads the whole transcript, terminal markers included — cannot fire a
   * second notification for a turn that already pinged.
   */
  notified: string[];
  /**
   * Set when a `done` marker fires. Keeps the record around so the feedback
   * questionnaire still knows which mission it is rating, while disarming the
   * watcher so ordinary post-mission chat can't re-trigger a ping.
   */
  completedAt?: string | null;
  /**
   * How the mission ended — so the notification, the status card, and the
   * questionnaire can all say something true about it. A mission the client
   * gave up waiting on must never be presented as a success.
   */
  outcome?: "done" | "failed" | "timed-out" | "cancelled" | null;
  /**
   * Last sign of life (ms epoch), used by the wall-clock watchdog. Stamped as
   * the transcript grows so a long-but-progressing mission is never cut off.
   */
  lastActivityAt?: number | null;
  /** True between "mission ended" and the human answering or skipping. */
  feedbackPending?: boolean;
};

export function autoMissionKey(sessionId: string): string {
  return `${AUTO_MISSION_STORAGE_PREFIX}${sessionId}`;
}

/** Extract a session id from a storage key, excluding the global briefing key. */
export function autoMissionSessionIdFromKey(key: string | null | undefined): string | null {
  if (!key || !key.startsWith(AUTO_MISSION_STORAGE_PREFIX)) return null;
  const sessionId = key.slice(AUTO_MISSION_STORAGE_PREFIX.length);
  return sessionId && sessionId !== "briefed" ? sessionId : null;
}

/** Enumerate every session record so supervision is independent of the open chat. */
export function autoMissionSessionIds(storage: AutoMissionStorage | null | undefined): string[] {
  if (!storage || typeof storage.length !== "number" || typeof storage.key !== "function") {
    return [];
  }
  const ids = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const sessionId = autoMissionSessionIdFromKey(storage.key(index));
      if (sessionId) ids.add(sessionId);
    }
  } catch {
    return [];
  }
  return [...ids];
}

const OUTCOMES: ReadonlySet<string> = new Set(["done", "failed", "timed-out", "cancelled"]);

export function readAutoMission(
  sessionId: string | null | undefined,
  storage: AutoMissionStorage | null | undefined,
): AutoMissionRecord | null {
  if (!sessionId || !storage) return null;
  try {
    const raw = storage.getItem(autoMissionKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutoMissionRecord>;
    if (typeof parsed.mission !== "string" || !parsed.mission) return null;
    return {
      mission: parsed.mission,
      familiarId: typeof parsed.familiarId === "string" ? parsed.familiarId : null,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString(),
      notified: Array.isArray(parsed.notified) ? parsed.notified.filter((t) => typeof t === "string") : [],
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
      outcome: OUTCOMES.has(parsed.outcome as string) ? (parsed.outcome as AutoMissionRecord["outcome"]) : null,
      lastActivityAt: typeof parsed.lastActivityAt === "number" ? parsed.lastActivityAt : null,
      feedbackPending: parsed.feedbackPending === true,
    };
  } catch {
    return null;
  }
}

function notifyAutoMissionChanged(sessionId: string): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(AUTO_MISSION_CHANGED_EVENT, {
      detail: { sessionId },
    }));
  } catch {
    /* CustomEvent is unavailable in a non-browser test/runtime shim. */
  }
}

function sameMissionIdentity(a: AutoMissionRecord, b: AutoMissionRecord): boolean {
  return a.mission === b.mission && a.startedAt === b.startedAt;
}

function missionStartMs(record: AutoMissionRecord): number {
  const parsed = Date.parse(record.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function writeAutoMission(
  sessionId: string | null | undefined,
  record: AutoMissionRecord,
  storage: AutoMissionStorage | null | undefined,
): boolean {
  if (!sessionId || !storage) return false;
  try {
    const current = readAutoMission(sessionId, storage);
    let next = record;
    if (current) {
      if (!sameMissionIdentity(current, record)) {
        // A newer mission may intentionally replace an older settled record.
        // An older snapshot may not replace an active/newer mission, which is
        // the stale-mounted-ChatView cancellation guard.
        if (missionStartMs(record) <= missionStartMs(current)) return false;
      } else if (
        current.completedAt
        && (!record.completedAt || record.completedAt !== current.completedAt)
      ) {
        // Once this exact mission has settled, an armed or differently-settled
        // copy is stale. Feedback updates with the same completion instant are
        // still allowed below.
        return false;
      }

      if (sameMissionIdentity(current, record)) {
        next = {
          ...current,
          ...record,
          // A settled record is immutable except for feedback bookkeeping.
          // Preserve its terminal outcome even if an old mounted ChatView
          // races a cancellation with its pre-cancel armed snapshot.
          ...(current.completedAt && current.completedAt === record.completedAt
            ? { completedAt: current.completedAt, outcome: current.outcome }
            : {}),
          notified: [...new Set([...current.notified, ...record.notified])],
          lastActivityAt: Math.max(current.lastActivityAt ?? 0, record.lastActivityAt ?? 0) || null,
        };
      }
    }
    storage.setItem(autoMissionKey(sessionId), JSON.stringify(next));
    notifyAutoMissionChanged(sessionId);
    return true;
  } catch {
    /* swallow — storage may be unavailable (private mode, quota) */
    return false;
  }
}

export function clearAutoMission(
  sessionId: string | null | undefined,
  storage: AutoMissionStorage | null | undefined,
): boolean {
  if (!sessionId || !storage) return false;
  try {
    storage.removeItem(autoMissionKey(sessionId));
    notifyAutoMissionChanged(sessionId);
    return true;
  } catch {
    /* swallow */
    return false;
  }
}

/** A mission is armed — still watching for a terminal state — until it completes. */
export function isAutoMissionArmed(record: AutoMissionRecord | null): boolean {
  return Boolean(record && !record.completedAt);
}

/** End the currently persisted mission without trusting a stale ChatView copy. */
export function cancelAutoMission(
  sessionId: string | null | undefined,
  storage: AutoMissionStorage | null | undefined,
  completedAt = new Date().toISOString(),
): AutoMissionRecord | null {
  const current = readAutoMission(sessionId, storage);
  if (!current || !isAutoMissionArmed(current)) return null;
  const ended: AutoMissionRecord = {
    ...current,
    completedAt,
    outcome: "cancelled",
    feedbackPending: true,
  };
  return writeAutoMission(sessionId, ended, storage) ? ended : null;
}

/**
 * What a view holding a mission should do when its session id changes.
 *
 * The case this exists for: `/auto <mission>` typed into a BRAND-NEW chat. A
 * new chat has no session id until the first send mints one, and
 * `writeAutoMission` is a no-op without one — so the record is armed in memory
 * and persisted nowhere. Moments later the send announces the real id, the
 * view re-reads storage for it, finds nothing, and the mission is silently
 * disarmed. The familiar keeps working; nothing is left that could notify on
 * the terminal marker, run the watchdog, or tell any other surface a mission
 * is in flight. Verified against the running app: `/auto` in a fresh chat
 * writes no `cave:auto-mission:*` key at all, while the same command in an
 * existing chat writes one immediately.
 *
 * So a sessionless mission is CARRIED onto the id its own send minted, and
 * nothing else is. The deliberate limits:
 *
 * - **The arriving id must be the one this view's own run minted**
 *   (`mintedSessionId`), not merely the first id to arrive. "We had no session
 *   id and now we do" is NOT the same question: a mission can be armed while a
 *   send is still in flight (or has failed outright, so no id is ever minted),
 *   and the human can then click straight into an unrelated existing chat.
 *   That is also a `null -> real` transition, and keying on the edge alone
 *   wrote the mission into whatever chat they happened to open. Reproduced in
 *   the running app before this argument existed: a mission armed in a blank
 *   compose landed under an existing chat's id purely because it was navigated
 *   to. The damage is worse than mis-labelling — that chat's transcript then
 *   gets watched for auto-status markers, and its watchdog eventually posts a
 *   `response-needed` inbox item for a mission it never ran, which is exactly
 *   the interruption `/auto` promises not to make.
 * - Only `null -> real` carries. Moving between two real sessions is a thread
 *   switch, and dragging a mission across it would fire chat A's mission
 *   against chat B's transcript — the same cross-chat leak from the other
 *   direction.
 * - A record already stored under the arriving id wins. It is the durable one;
 *   the held copy would be a strictly worse duplicate.
 * - Only an ARMED record carries. A finished mission has nothing left to
 *   watch, and re-persisting it under a new id would resurrect a settled
 *   record as if the session owned it.
 */
export function reconcileAutoMissionOnSessionChange(args: {
  previousSessionId: string | null | undefined;
  nextSessionId: string | null | undefined;
  /** The record the view currently holds in memory (may be unpersisted). */
  held: AutoMissionRecord | null;
  /** What storage already holds for `nextSessionId`. */
  stored: AutoMissionRecord | null;
  /**
   * The session id this view's OWN generation just minted and adopted — the
   * `ownsDisplayedView` branch of the chat stream's `session` event. Null when
   * the id arrived any other way (navigating to an existing chat, a send still
   * in flight, a send that failed). Consumed one-shot by the caller so an id
   * can only ever be adopted on the transition immediately following its mint.
   */
  mintedSessionId: string | null | undefined;
}): { record: AutoMissionRecord | null; persistUnder: string | null } {
  const { previousSessionId, nextSessionId, held, stored, mintedSessionId } = args;
  if (stored) return { record: stored, persistUnder: null };
  const adopting =
    !previousSessionId && Boolean(nextSessionId) && nextSessionId === mintedSessionId;
  if (adopting && isAutoMissionArmed(held) && held) {
    return { record: held, persistUnder: nextSessionId as string };
  }
  return { record: null, persistUnder: null };
}

/** The shape the watcher needs from a chat turn (structural, not the Turn type). */
export type AutoTurnLike = {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  pending?: boolean;
};

export type AutoMissionPing = {
  turnId: string;
  state: "needs-approval" | "blocked" | "failed" | "done";
  note?: string;
};

/** States that end the mission. `needs-approval` and `blocked` do not: answering the familiar resumes it. */
const TERMINAL: ReadonlySet<AutoMissionPing["state"]> = new Set(["failed", "done"]);

/** States that draw the human back in — all four ping; only `failed`/`done` end the mission. */
const ATTENTION: ReadonlySet<AutoMissionPing["state"]> = new Set([
  "needs-approval",
  "blocked",
  "failed",
  "done",
]);

function isAttentionState(state: AutoMissionState): state is AutoMissionPing["state"] {
  return ATTENTION.has(state as AutoMissionPing["state"]);
}

/**
 * Decide which terminal states still owe the human a ping, given the record
 * and the current transcript.
 *
 * Only SETTLED assistant turns count — a marker mid-stream can still be
 * followed by more work, and a partial marker is not yet trustworthy. Turns
 * already in `record.notified` are skipped, which is what makes the whole
 * path idempotent across reloads and re-renders.
 *
 * Returns every un-notified turn owing a ping, in transcript order (normally
 * zero or one; a reload of a transcript holding a blocked and a later done
 * legitimately returns both).
 */
export function pendingAutoMissionPings(
  record: AutoMissionRecord | null,
  turns: readonly AutoTurnLike[],
): AutoMissionPing[] {
  if (!isAutoMissionArmed(record) || !record) return [];
  const seen = new Set(record.notified);
  const out: AutoMissionPing[] = [];
  const missionStartedAt = Date.parse(record.startedAt);
  for (const t of turns) {
    if (t.role !== "assistant" || t.pending || !t.text) continue;
    // A new mission reuses the chat transcript. Do not interpret a terminal
    // marker left by the previous mission as the new mission's completion.
    // Legacy/test turns without createdAt remain eligible because there is no
    // trustworthy boundary to apply to them.
    if (
      t.createdAt
      && Number.isFinite(missionStartedAt)
      && Number.isFinite(Date.parse(t.createdAt))
      && Date.parse(t.createdAt) < missionStartedAt
    ) continue;
    if (seen.has(t.id)) continue;
    const { update } = extractAutoStatusMarkers(t.text);
    if (!update) continue;
    if (!isAttentionState(update.state)) continue;
    out.push({ turnId: t.id, state: update.state, note: update.note });
    // `done`/`failed` end the mission — nothing after them can still ping.
    if (TERMINAL.has(update.state)) break;
  }
  return out;
}

/**
 * How long a mission may go quiet before the client stops waiting for a
 * terminal marker. Deliberately generous: a real mission can legitimately run
 * a long time, and a premature "timed out" is a worse experience than a late
 * completion.
 */
export const AUTO_MISSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Has an armed mission gone quiet past its deadline?
 *
 * This is the safety net for the failure mode the marker protocol cannot
 * survive on its own: the familiar finishes — or dies, or exhausts its
 * context, or simply forgets — WITHOUT emitting a terminal marker. The
 * transcript then holds nothing to ping on, so the mission stays armed in
 * storage forever and the human, who was promised exactly one interruption,
 * never gets it. A missed completion ping is the worst outcome this feature
 * has, so it cannot be left to the model's goodwill.
 *
 * Measured from the last sign of life rather than from mission start, so a
 * long but visibly-progressing mission is never cut off. Clock-injected so the
 * decision is testable.
 */
export function isAutoMissionTimedOut(
  record: AutoMissionRecord | null,
  turns: readonly AutoTurnLike[],
  nowMs: number,
  timeoutMs: number = AUTO_MISSION_TIMEOUT_MS,
): boolean {
  if (!isAutoMissionArmed(record) || !record) return false;
  // A stream still in flight is alive by definition, however long it runs.
  if (turns.some((t) => t.pending)) return false;
  const started = new Date(record.startedAt).getTime();
  const base = Number.isNaN(started) ? nowMs : started;
  const lastSeen = Math.max(base, record.lastActivityAt ?? 0);
  return nowMs - lastSeen >= timeoutMs;
}

/**
 * Stamp "the mission is still alive" — called whenever the transcript grows.
 * Returns the same record when nothing changed, so callers can skip the write.
 */
export function touchAutoMission(record: AutoMissionRecord, nowMs: number): AutoMissionRecord {
  if ((record.lastActivityAt ?? 0) >= nowMs) return record;
  return { ...record, lastActivityAt: nowMs };
}

/**
 * Whether the human has been shown the one-time "here is what autonomous mode
 * actually does" briefing. Global rather than per-session: the contract is a
 * property of the feature, not of a chat.
 */
export const AUTO_BRIEFED_KEY = "cave:auto-mission:briefed";

const AUTO_DRAFT_PREFIX = /^\/(?:auto|autopilot)(?=\s|$)/i;

export function autoMissionStatusDraft(value: string): string | null {
  return value.trim() ? null : "/auto status";
}

export function isAutoModeDraft(value: string): boolean {
  return AUTO_DRAFT_PREFIX.test(value.trimStart());
}

export function toggleAutoModeDraft(value: string): string {
  const draft = value.trimStart();
  if (isAutoModeDraft(draft)) {
    return draft.replace(AUTO_DRAFT_PREFIX, "").trimStart();
  }
  return draft ? `/auto ${draft}` : "/auto ";
}
