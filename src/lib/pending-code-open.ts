/**
 * Where a file open was raised from, when it came out of a conversation
 * (cave-f6mu9). The Code surface shows this as a source-context card above the
 * workbench so a file that arrived from a chat message says which message —
 * otherwise the reader lands on a file with no memory of why, and the trip
 * back to the conversation is a guess.
 */
export type PendingCodeOrigin = {
  /** Chat session title. */
  sessionTitle?: string | null;
  /** Familiar that produced the block. */
  familiar?: string | null;
  /** 1-based message position in the transcript. */
  messageIndex?: number | null;
  /** "lines 14–19" — the range the reader selected before handing off. */
  selectionLabel?: string | null;
};

export type PendingCodeOpen =
  | {
      kind: "files";
      // Omitted for a "browse at root" open (Projects hub → Files): the Files
      // tab shows the tree with nothing selected. Present for a file open.
      path?: string;
      line?: number;
      // When set, the target browses THIS project root instead of the active
      // session's — a bounded "peek" that lets the Projects hub drill into any
      // project's files (cave-z44).
      root?: string;
      // The chat session the open was raised from (cave-ohcj): the Code
      // surface selects this session's workbench so the file lands beside the
      // conversation's diff/terminal context. Absent for root-only browses.
      sessionId?: string;
      /** Present when the open came from a chat code block. */
      origin?: PendingCodeOrigin;
      nonce: number;
    }
  | {
      kind: "changes";
      path: string;
      sessionId?: string;
      origin?: PendingCodeOrigin;
      nonce: number;
    };

// ── Module store (cave-cc5r) ─────────────────────────────────────────────────
// The Code surface lives inside a Role Surface room, but file/diff opens are
// raised by shell-level handlers in Workspace (cave:open-project-file etc.).
// This tiny store bridges them: Workspace enqueues + navigates to the room;
// the room's CodeView consumes the open and clears it. Kept module-level so
// the open survives the room mounting after navigation.

let pending: PendingCodeOpen | null = null;
const listeners = new Set<() => void>();

export function enqueuePendingCodeOpen(open: PendingCodeOpen): void {
  pending = open;
  for (const fn of listeners) fn();
}

export function clearPendingCodeOpen(): void {
  if (pending === null) return;
  pending = null;
  for (const fn of listeners) fn();
}

export function getPendingCodeOpen(): PendingCodeOpen | null {
  return pending;
}

export function subscribePendingCodeOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
