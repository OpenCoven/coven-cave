// The "N earlier turns" fold — the last piece of the
// "Chat Session - Prototype.dc.html" handoff (see
// docs/design-handoff/IMPLEMENTATION-STATUS.md; the rest landed in cave-n3jg2).
//
// A long thread opens on the recent exchange and puts everything older behind
// one pill on a rule. This is a READING affordance and is deliberately distinct
// from `TRANSCRIPT_RENDER_CAP` / `historyExpanded`, which is a mounting budget:
// the cap answers "how many rows can the browser afford right now?", the fold
// answers "how much of this conversation is still the conversation?". They
// compose — opening the fold also lifts the cap, because a pill that says
// "hide earlier turns" has promised every earlier turn.
//
// Counts are in TURNS, not groups: a voice call is one group carrying several
// turns, and a label reading "3 earlier turns" over a fold hiding eight would
// be a lie the reader cannot see through.

import type { TranscriptGroup } from "./chat-transcript-groups.ts";

/** Groups always left visible below a closed fold — roughly three exchanges,
 *  which is enough to know where you are without scrolling. */
export const CHAT_FOLD_KEEP_GROUPS = 6;

/** Below this, folding costs a divider and saves nothing. Hiding one or two
 *  turns behind a control is worse than just showing them. */
export const CHAT_FOLD_MIN_HIDDEN_TURNS = 3;

export type ChatTranscriptFold = {
  /** Index into groupedTurns where the visible tail starts; 0 when nothing folds. */
  startIndex: number;
  /** Turns behind the fold. 0 means there is no fold to draw. */
  hiddenTurns: number;
};

const NO_FOLD: ChatTranscriptFold = { startIndex: 0, hiddenTurns: 0 };

function turnsIn(group: TranscriptGroup): number {
  return group.kind === "call" ? group.turns.length : 1;
}

export function chatTranscriptFold(groups: readonly TranscriptGroup[]): ChatTranscriptFold {
  if (groups.length <= CHAT_FOLD_KEEP_GROUPS) return NO_FOLD;
  const startIndex = groups.length - CHAT_FOLD_KEEP_GROUPS;
  let hiddenTurns = 0;
  for (let i = 0; i < startIndex; i += 1) hiddenTurns += turnsIn(groups[i]);
  if (hiddenTurns < CHAT_FOLD_MIN_HIDDEN_TURNS) return NO_FOLD;
  return { startIndex, hiddenTurns };
}

/** Closed, the pill names what it is hiding; open, it names the way back.
 *  Never "N earlier turns" while they are on screen — the label would be
 *  describing something the reader can already see. */
export function chatFoldLabel(hiddenTurns: number, open: boolean): string {
  if (open) return "hide earlier turns";
  return `${hiddenTurns} earlier ${hiddenTurns === 1 ? "turn" : "turns"}`;
}

/** Accessible name for the toggle. The visible pill is terse mono chrome; a
 *  screen reader gets the whole sentence. */
export function chatFoldAriaLabel(hiddenTurns: number, open: boolean): string {
  if (open) return "Hide earlier turns";
  return `Show ${hiddenTurns} earlier ${hiddenTurns === 1 ? "turn" : "turns"}`;
}
