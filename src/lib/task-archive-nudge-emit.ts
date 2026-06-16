import type { Card } from "@/lib/cave-board-types";
import { createItem, loadInbox, markDone } from "@/lib/cave-inbox";
import { broadcastCreated, broadcastUpdated } from "@/lib/inbox-scheduler";
import { loadState } from "@/lib/cave-config";
import {
  archiveNudgeForCard,
  archiveNudgesToResolve,
  shouldCreateArchiveNudge,
} from "@/lib/task-archive-nudge";

/**
 * Server-side IO wiring for archive nudges. Pure decision logic lives in
 * `task-archive-nudge.ts`; this module reads/writes the inbox + cave state and
 * broadcasts to the inbox SSE stream. Every entry point is best-effort: a
 * failure here must never break the caller's primary operation (a lifecycle
 * transition or a session archive), so callers should not await-and-throw.
 */

/**
 * Emit the "ready to archive" nudge for a card that just reached the end of its
 * task execution lifecycle. No-op unless the card is `completed`, has a linked
 * chat session that isn't already archived, and has no active nudge already.
 * Returns the created item, or null when nothing was emitted.
 */
export async function emitArchiveNudge(card: Card) {
  try {
    const [{ items }, state] = await Promise.all([loadInbox(), loadState()]);
    const archivedSessionIds = Object.keys(state.sessionArchived ?? {});
    if (!shouldCreateArchiveNudge(card, items, archivedSessionIds)) return null;
    const input = archiveNudgeForCard(card);
    if (!input) return null;
    const item = await createItem(input);
    broadcastCreated(item);
    return item;
  } catch {
    return null;
  }
}

/**
 * Resolve (mark done) any active archive nudges for a session that was just
 * archived, so the "ready to archive" prompt disappears once the user acts.
 * Returns the number of nudges resolved.
 */
export async function resolveArchiveNudges(sessionId: string): Promise<number> {
  try {
    const { items } = await loadInbox();
    const pending = archiveNudgesToResolve(items, sessionId);
    let resolved = 0;
    for (const nudge of pending) {
      const updated = await markDone(nudge.id);
      if (updated) {
        broadcastUpdated(updated);
        resolved += 1;
      }
    }
    return resolved;
  } catch {
    return 0;
  }
}
