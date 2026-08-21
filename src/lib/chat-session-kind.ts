// Work-kind filter for the chat list — narrows the list to conversations that
// ARE Board tasks (origin "board") or whose work reached GitHub (the rows
// wearing the PR-status badge). Mirrors chat-session-status.ts: pure
// derivation + counts + filter, so it pins/tests without a DOM.
//
// Kinds are independent lenses, not a partition: one chat can be both a Board
// task and on GitHub, and most chats are neither. So the chips are exclusive
// toggles ("Tasks only" / "GitHub only"), never a segmented control whose
// counts must sum to the total.

import type { IconName } from "./icon";
import type { SessionRow } from "./types";
import { sessionPrStatus } from "./session-pr-status.ts";

export type ChatSessionKindKey = "task" | "github";
export type ChatSessionKindFilter = "all" | ChatSessionKindKey;

/** Chip order in the toolbar. */
export const CHAT_SESSION_KIND_ORDER: readonly ChatSessionKindKey[] = ["task", "github"];

export type ChatSessionKindPresentation = {
  /** Sentence-case label for the filter chip. */
  label: string;
  /** Glyph carried beside the label. */
  icon: IconName;
  /** Title/aria copy explaining what the chip narrows to. */
  description: string;
};

export const CHAT_SESSION_KIND: Record<ChatSessionKindKey, ChatSessionKindPresentation> = {
  task: {
    label: "Tasks",
    icon: "ph:kanban",
    description: "Only chats started from a Board task",
  },
  github: {
    label: "GitHub",
    icon: "ph:git-pull-request",
    description: "Only chats whose work reached a pull request",
  },
};

/** Whether a row belongs to a kind. "github" matches exactly the rows that
 *  wear the PR-status badge (same derivation), so the filter and the symbol
 *  can never disagree about what counts as "on GitHub". */
export function chatSessionKindMatches(row: SessionRow, kind: ChatSessionKindKey): boolean {
  if (kind === "task") return row.origin === "board";
  return sessionPrStatus(row.pullRequest) !== null;
}

/** Counts for every chip, including `all`. Counted BEFORE the kind filter
 *  applies (but after search), so pressing one chip never changes the numbers
 *  under the other chips — same behaviour as the status chips. */
export function countChatSessionKinds(
  rows: readonly SessionRow[],
): Record<ChatSessionKindFilter, number> {
  const counts: Record<ChatSessionKindFilter, number> = { all: rows.length, task: 0, github: 0 };
  for (const row of rows) {
    for (const kind of CHAT_SESSION_KIND_ORDER) {
      if (chatSessionKindMatches(row, kind)) counts[kind] += 1;
    }
  }
  return counts;
}

export function filterChatRowsByKind(
  rows: readonly SessionRow[],
  filter: ChatSessionKindFilter,
): SessionRow[] {
  if (filter === "all") return [...rows];
  return rows.filter((row) => chatSessionKindMatches(row, filter));
}
