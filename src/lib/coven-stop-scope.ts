/**
 * Stop, scoped (design proposal §8).
 *
 * One unlabelled Stop button never said what it stopped — the current turn, the
 * queue, or everything — or what survived. This names each scope and its
 * consequence, so the copy is the warning and no confirmation dialog is needed:
 * every option is recoverable, because partial output is always kept.
 */

import type { CovenResponseMode } from "./group-chat.ts";

export type CovenStopScope = "current" | "pause" | "all";

export type CovenStopItem = {
  scope: CovenStopScope;
  label: string;
  /** The consequence, stated. Rendered under the label, never as a tooltip. */
  detail: string;
  /** Only "Stop everything" reads danger; the others are ordinary controls. */
  danger: boolean;
};

/**
 * Build the Stop menu for the run in flight.
 *
 * Pause appears only in a rotation: broadcast has already started everyone, so
 * there is no queue left to hold and an offer to hold one would be a lie.
 */
export function covenStopItems(args: {
  mode: CovenResponseMode;
  /** Display name of the familiar currently producing output, if any. */
  currentName?: string | null;
  /** Whether any familiar is still queued behind the current one. */
  hasQueued: boolean;
}): CovenStopItem[] {
  const items: CovenStopItem[] = [];
  const roundRobin = args.mode === "round-robin";
  if (args.currentName) {
    items.push({
      scope: "current",
      label: `Stop ${args.currentName} (current)`,
      detail: `Ends this turn; ${roundRobin ? "the rotation continues" : "others keep running"}. Keeps what streamed.`,
      danger: false,
    });
  }
  if (roundRobin && args.hasQueued) {
    items.push({
      scope: "pause",
      label: "Pause after current reply",
      detail: `Finishes ${args.currentName ?? "the current turn"}, then holds the queue.`,
      danger: false,
    });
  }
  items.push({
    scope: "all",
    label: "Stop everything",
    detail: "Ends the run now. Completed and partial replies are kept.",
    danger: true,
  });
  return items;
}
