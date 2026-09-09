import type { TranscriptGroup } from "./chat-transcript-groups.ts";

/** A hard mounting budget, including while browsing or finding. Voice calls
 * remain atomic: one call can contain more turns than this GROUP budget. */
export const CHAT_TRANSCRIPT_WINDOW_GROUPS = 60;
export const CHAT_TRANSCRIPT_WINDOW_OVERLAP = 6;

export type ChatTranscriptWindow = { start: number; end: number };

/** null follows the tail; a numbered start stays put when new groups arrive. */
export function chatTranscriptWindow(
  groupCount: number,
  start: number | null,
): ChatTranscriptWindow {
  const count = Math.max(0, Math.trunc(groupCount));
  const lastStart = Math.max(0, count - CHAT_TRANSCRIPT_WINDOW_GROUPS);
  const boundedStart = start === null || !Number.isFinite(start)
    ? lastStart
    : Math.max(0, Math.min(Math.trunc(start), lastStart));
  return { start: boundedStart, end: Math.min(count, boundedStart + CHAT_TRANSCRIPT_WINDOW_GROUPS) };
}

/** Overlap keeps boundary turns mounted so paging can preserve a DOM anchor. */
export function pageChatTranscriptWindow(
  groupCount: number,
  start: number | null,
  direction: -1 | 1,
): ChatTranscriptWindow {
  const current = chatTranscriptWindow(groupCount, start);
  return chatTranscriptWindow(
    groupCount,
    current.start + direction * (CHAT_TRANSCRIPT_WINDOW_GROUPS - CHAT_TRANSCRIPT_WINDOW_OVERLAP),
  );
}

/** Find searches all active turns, but mounts only the target's bounded page.
 * Hits anywhere inside a voice call select its whole group, never a split call. */
export function chatTranscriptWindowForTurn(
  groups: readonly TranscriptGroup[],
  turnId: string,
  start: number | null,
): ChatTranscriptWindow | null {
  const index = groups.findIndex((group) => group.kind === "single"
    ? group.turn.id === turnId
    : group.turns.some((turn) => turn.id === turnId));
  if (index < 0) return null;
  const current = chatTranscriptWindow(groups.length, start);
  if (index >= current.start && index < current.end) return current;
  return chatTranscriptWindow(groups.length, index - Math.floor(CHAT_TRANSCRIPT_WINDOW_GROUPS / 2));
}
