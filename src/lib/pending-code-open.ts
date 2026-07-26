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
      nonce: number;
    }
  | {
      kind: "changes";
      path: string;
      sessionId?: string;
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
