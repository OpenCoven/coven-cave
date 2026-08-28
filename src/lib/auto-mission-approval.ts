/**
 * `/auto` needs-approval affordance — the decision the status card needs to
 * offer an approve/deny control for a `needs-approval` state, and the inline
 * messages those buttons send through the existing send machinery to resume
 * the mission.
 *
 * `needs-approval` means "I need your go-ahead on something irreversible" —
 * the mission continues the moment the human says yes (or no). It is distinct
 * from `blocked` ("I cannot proceed at all"), which no answer unblocks and
 * therefore never renders an affordance. See docs/auto-mission-mode.md.
 */

import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";
import { isAutoMissionArmed, type AutoMissionRecord, type AutoTurnLike } from "./auto-mission-state.ts";

/** What "Approve" sends inline — the familiar asked for a go-ahead, so a yes resumes it. */
export const APPROVE_MISSION_MESSAGE = "Approved — go ahead.";

/** What "Deny" sends inline — a no resumes the conversation so the familiar can respond. */
export const DENY_MISSION_MESSAGE = "Denied — do not proceed.";

/**
 * Is this turn's `needs-approval` marker still awaiting the human's answer?
 *
 * True only while the mission is armed AND this turn is the current head of
 * the conversation. The transcript is the ground truth: the moment the human
 * approves or denies (or the familiar moves on), a later turn exists and the
 * affordance closes. Requiring the mission to still be armed also hides the
 * affordance after a watchdog timeout or `/auto stop`, neither of which adds a
 * turn — the transcript alone would otherwise keep offering approve/deny on a
 * mission that already ended.
 */
export function isAutoApprovalPending(
  record: AutoMissionRecord | null,
  turns: readonly AutoTurnLike[],
  turnId: string,
): boolean {
  if (!isAutoMissionArmed(record) || !record) return false;
  const head = turns[turns.length - 1];
  if (!head || head.id !== turnId) return false;
  if (head.role !== "assistant" || head.pending) return false;
  const { update } = extractAutoStatusMarkers(head.text);
  return update?.state === "needs-approval";
}
