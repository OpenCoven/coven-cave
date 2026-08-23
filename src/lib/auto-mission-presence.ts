/**
 * Reading `/auto` missions from OUTSIDE the chat that started one.
 *
 * A mission is designed to be left alone, so the moment it matters most is the
 * moment the human has navigated away — and until now the only place it was
 * legible was the chat's own transcript card.
 *
 * ## Why this reads liveness from the caller instead of from the record
 *
 * The stored record cannot answer "is this still running". Its terminal
 * detection and its watchdog both live in the mounted ChatView for that exact
 * session: navigate elsewhere and nothing clears it, so an armed record
 * outlives the mission it describes and keeps saying "in progress" for work
 * that finished. A surface built on the record alone would therefore be wrong
 * precisely in the situation it exists for.
 *
 * So the caller supplies the sessions the SERVER reports as running
 * (`hasActiveChatRun` -> `status: "running"`, projected through
 * /api/sessions/list) and this module only decorates those. Liveness comes
 * from the server; identity — which mission, since when — comes from the
 * record. Neither half can claim a mission is in flight on its own, and when
 * the run ends the row simply stops existing rather than going stale.
 *
 * ## Why not the inbox
 *
 * `/api/inbox` is an attention surface. An item created there with no fireAt
 * lands `status: "fired"`, and workspace's SSE subscriber answers a fired item
 * with a toast plus `nativeNotify(...)` and a sound, while `unreadInboxCount`
 * badges the bell and `groupInboxFeed` files it under "Needs you". That is the
 * interruption `/auto` promises not to make, so an in-flight mission is
 * reported in ambient chrome instead.
 *
 * Pure, with injected storage (the auto-mission-state.ts convention) so the
 * whole decision path is testable under `node --test` with no DOM.
 */

import {
  isAutoMissionArmed,
  readAutoMission,
  type AutoMissionStorage,
} from "./auto-mission-state.ts";

export type ArmedAutoMission = {
  sessionId: string;
  /** The mission text as the human typed it. */
  mission: string;
  startedAt: string;
};

/**
 * The armed missions among `sessionIds`, keyed by session id.
 *
 * Only the ids handed in are consulted — the map can never name a session the
 * caller did not already believe was running, which is what keeps a stale
 * record from becoming a visible claim. Sessions with no record, or with a
 * settled one, are simply absent.
 */
export function armedAutoMissionsFor(
  sessionIds: Iterable<string>,
  storage: AutoMissionStorage | null | undefined,
): Map<string, ArmedAutoMission> {
  const out = new Map<string, ArmedAutoMission>();
  if (!storage) return out;
  for (const sessionId of sessionIds) {
    if (!sessionId || out.has(sessionId)) continue;
    // No try/catch here on purpose: readAutoMission already swallows a storage
    // that throws (private mode, revoked access) and returns null, so a second
    // guard would be unreachable. A mutation run confirmed it — removing it
    // changed nothing observable.
    const record = readAutoMission(sessionId, storage);
    if (!isAutoMissionArmed(record) || !record) continue;
    // A blank mission cannot be labelled. Reporting it would replace the row's
    // real title with an empty string — worse than leaving the row alone.
    if (!record.mission.trim()) continue;
    out.set(sessionId, {
      sessionId,
      mission: record.mission,
      startedAt: record.startedAt,
    });
  }
  return out;
}

/**
 * Longest mission text a row will show before clipping.
 *
 * A mission is free text a human typed and can be a paragraph. The row is one
 * line in a 340px popover, so an unbounded string would either blow the layout
 * out or be cut by CSS with no ellipsis in the accessible name.
 */
export const AUTO_MISSION_ROW_MAX = 96;

/**
 * One row's worth of presentation for an in-flight mission.
 *
 * `title` replaces the session title deliberately. An `/auto` chat's title is
 * derived from its first message, which is the generated directive — so the
 * row currently reads "Run this as an autonomous /auto mission: …", leaking a
 * system prompt into the menu bar instead of naming the work. The mission text
 * is both the honest label and the one the human would recognise.
 */
export function autoMissionRowPresentation(mission: ArmedAutoMission): {
  title: string;
  /** Short marker that distinguishes a mission row from an ordinary chat. */
  tag: string;
  /** Accessible name / tooltip — says in-flight without demanding anything. */
  description: string;
} {
  const collapsed = mission.mission.replace(/\s+/g, " ").trim();
  const title =
    collapsed.length > AUTO_MISSION_ROW_MAX
      ? `${collapsed.slice(0, AUTO_MISSION_ROW_MAX - 1).trimEnd()}…`
      : collapsed;
  return {
    title,
    tag: "Mission",
    description: `Auto mission in progress — ${title}`,
  };
}
