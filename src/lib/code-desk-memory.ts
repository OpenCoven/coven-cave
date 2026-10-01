/**
 * Per-session memory for the Coding Desk (#5718).
 *
 * CodeView mounts one workbench per selected session (`key={selected.id}`),
 * so switching to another session and back used to throw away the reader's
 * work on the first: the open-file tabs, the viewed ticks and a half-written
 * follow-up. This module keeps those three things per session for the life
 * of the page, bounded so a long day of switching cannot grow it forever.
 *
 * Restoring viewed ticks is safe by construction: each tick is recorded
 * against the file's status and diffstat (`codeRailFileSignature`), so a file
 * that changed while you were away no longer matches its old tick and reads
 * as unviewed again.
 *
 * Deliberately memory-only. A draft or a tick surviving a reload would need
 * a storage story (private mode, quota, other tabs) that this does not need
 * to answer to fix the round trip.
 */

import type { CodeOpenFiles } from "@/lib/code-open-files";
import type { CodeRailViewedState } from "@/lib/code-side-rail";

export const CODE_DESK_MEMORY_LIMIT = 24;

export type CodeDeskMemory = {
  openFiles: CodeOpenFiles;
  viewed: CodeRailViewedState;
  draft: string;
};

export type CodeDeskMemoryStore = {
  read: (sessionId: string) => CodeDeskMemory | null;
  write: (sessionId: string, memory: Partial<CodeDeskMemory>) => void;
  forget: (sessionId: string) => void;
  size: () => number;
};

function isEmpty(memory: CodeDeskMemory): boolean {
  return memory.openFiles.paths.length === 0 && Object.keys(memory.viewed).length === 0 && memory.draft === "";
}

/** A bounded, most-recently-written-first store. Pure; one per page below. */
export function createCodeDeskMemoryStore(limit = CODE_DESK_MEMORY_LIMIT): CodeDeskMemoryStore {
  // Map iteration order is insertion order, so delete-then-set moves an entry
  // to the end and the first key is always the least recently written.
  const entries = new Map<string, CodeDeskMemory>();
  return {
    read(sessionId) {
      return entries.get(sessionId) ?? null;
    },
    write(sessionId, patch) {
      if (!sessionId) return;
      const previous = entries.get(sessionId) ?? {
        openFiles: { paths: [], active: null },
        viewed: {},
        draft: "",
      };
      const next: CodeDeskMemory = { ...previous, ...patch };
      entries.delete(sessionId);
      // Nothing worth remembering: drop the entry rather than hold a blank.
      if (isEmpty(next)) return;
      entries.set(sessionId, next);
      while (entries.size > Math.max(1, limit)) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    forget(sessionId) {
      entries.delete(sessionId);
    },
    size() {
      return entries.size;
    },
  };
}

/** The page's store. Module scope so it outlives CodeView remounts too. */
export const codeDeskMemory = createCodeDeskMemoryStore();
