/**
 * Composer routing — what happens when you press Enter, stated in the composer.
 *
 * The old surface said "Message 3 familiars…": a count, not an order, not a
 * mode, and no answer to what Enter does during a run. This derives all of it
 * from the same inputs the send path uses, so the preview cannot drift from the
 * behaviour it describes (design proposal §7).
 */

import type { CovenResponseMode } from "./group-chat.ts";

export type CovenRoutingMember = { id: string; name: string };

export type CovenRoutingChip = {
  id: string;
  name: string;
  /** Round robin renders "→" between chips: order is meaning. */
  arrow: boolean;
  /** Broadcast renders "·": an unordered set. */
  dot: boolean;
};

export type CovenComposerRouting = {
  /** Leading phrase before the recipient chips. Empty when there are none. */
  lead: string;
  chips: CovenRoutingChip[];
  placeholder: string;
  /** Always states what Enter does *right now*. */
  enterNote: string;
  /** Send button label — follows intent, not a fixed word. */
  sendLabel: string;
  sendTitle: string;
  /** Enter queues instead of sending while a run is active. */
  queues: boolean;
  /** The mode control is meaningless below two familiars. */
  showModeControl: boolean;
};

function joinNames(names: readonly string[], joiner: "then" | "and"): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (joiner === "then") return names.join(", then ");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const ENTER_IDLE_MULTI =
  "Enter sends · Shift+Enter new line · @name routes to one familiar without advancing the rotation.";
const ENTER_IDLE_SINGLE = "Enter sends · Shift+Enter new line.";
const ENTER_RUNNING =
  "A run is active — Enter queues your message; it won't interrupt anyone. @name replies to one familiar.";

export function covenComposerRouting(args: {
  mode: CovenResponseMode;
  /** Roster order, already filtered to familiars included in the next run. */
  members: readonly CovenRoutingMember[];
  /** Familiars the current draft @mentions, if any. */
  mentioned?: readonly CovenRoutingMember[];
  /** A run is in flight on this coven. */
  running: boolean;
}): CovenComposerRouting {
  const roundRobin = args.mode === "round-robin";
  const mentioned = args.mentioned ?? [];
  const showModeControl = args.members.length >= 2;

  if (mentioned.length > 0) {
    const names = mentioned.map((m) => m.name);
    const target = joinNames(names, "and");
    return {
      lead: mentioned.length === 1 ? "Replies only to" : "Replies only to",
      chips: mentioned.map((m) => ({ id: m.id, name: m.name, arrow: false, dot: false })),
      placeholder: `Reply to ${target}…`,
      // A mention is a side conversation: it must not look like it advances the
      // queue, because it does not.
      enterNote: args.running
        ? ENTER_RUNNING
        : `Enter sends to ${target} only — the rotation doesn't advance. Shift+Enter for a new line.`,
      sendLabel: args.running ? "Queue" : `Send to ${target}`,
      sendTitle: args.running
        ? "Queues until the run finishes — Stop is the only interrupt"
        : `Send to ${target} without advancing the rotation`,
      queues: args.running,
      showModeControl,
    };
  }

  if (args.members.length === 0) {
    return {
      lead: "",
      chips: [],
      placeholder: "Add familiars to this coven first…",
      enterNote: "The composer unlocks once the coven has members.",
      sendLabel: "Send",
      sendTitle: "Add familiars to this coven first",
      queues: false,
      showModeControl: false,
    };
  }

  const names = args.members.map((m) => m.name);

  if (args.members.length === 1) {
    return {
      lead: "Sends to",
      chips: [{ id: args.members[0].id, name: names[0], arrow: false, dot: false }],
      placeholder: args.running
        ? "Message the coven — held until this run finishes…"
        : `Message ${names[0]}…`,
      enterNote: args.running ? ENTER_RUNNING : ENTER_IDLE_SINGLE,
      sendLabel: args.running ? "Queue" : "Send",
      sendTitle: args.running
        ? "Queues until the run finishes — Stop is the only interrupt"
        : `Send to ${names[0]}`,
      queues: args.running,
      showModeControl,
    };
  }

  return {
    lead: args.running
      ? roundRobin
        ? "Next message: in turn to"
        : "Next message: broadcast to"
      : roundRobin
        ? "Sends in turn to"
        : "Broadcasts to",
    chips: args.members.map((m, index) => ({
      id: m.id,
      name: m.name,
      arrow: roundRobin && index > 0,
      dot: !roundRobin && index > 0,
    })),
    placeholder: args.running
      ? "Message the coven — held until this run finishes…"
      : roundRobin
        ? `Send to ${joinNames(names, "then")}…`
        : `Broadcast to ${joinNames(names, "and")}…`,
    enterNote: args.running ? ENTER_RUNNING : ENTER_IDLE_MULTI,
    sendLabel: args.running ? "Queue" : "Send",
    sendTitle: args.running
      ? "Queues until the run finishes — Stop is the only interrupt"
      : roundRobin
        ? "Send in turn to every included familiar"
        : "Broadcast to every included familiar",
    queues: args.running,
    showModeControl,
  };
}
