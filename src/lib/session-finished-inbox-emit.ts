import { createItem, loadInbox, type InboxItem } from "@/lib/cave-inbox";
import { defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { loadState } from "@/lib/cave-config";
import { broadcastCreated } from "@/lib/inbox-scheduler";
import {
  hasUnresolvedSessionFinishedItem,
  sessionFinishedItem,
  shouldNotifySessionFinished,
} from "@/lib/session-finished-inbox";

/**
 * Server-side IO wiring for the session-finished inbox item (cave-fgey). Pure
 * decision logic lives in session-finished-inbox.ts; this module reads/writes
 * the inbox + cave state and broadcasts to the inbox SSE stream. Best-effort:
 * a failure here must never break the caller's primary operation (the chat
 * turn completing), so this always resolves instead of throwing.
 */

/**
 * Emit one 'agent' inbox item for a just-finished session when the user
 * wasn't watching that chat (or the turn ran long), deduped per session.
 * Returns the created item, or null when nothing was emitted.
 */
export async function emitSessionFinishedItem(input: {
  familiarId: string;
  /** Display name at completion time; falls back to familiarId in the title. */
  familiarName: string;
  sessionId: string;
  /** True when the user is watching this chat right now (request attached). */
  watchedByUser: boolean;
  /** Turn duration in ms; null when unknown. */
  durationMs: number | null | undefined;
}): Promise<InboxItem | null> {
  try {
    if (!input.sessionId) return null;
    if (
      !shouldNotifySessionFinished({
        watchedByUser: input.watchedByUser,
        durationMs: input.durationMs,
      })
    ) {
      return null;
    }
    const [{ items }, state] = await Promise.all([loadInbox(), loadState()]);
    if (hasUnresolvedSessionFinishedItem(items, input.sessionId)) return null;
    // The cave-state title is authoritative (auto-rename and manual renames
    // both write sessionTitles); fall back to the neutral default.
    const sessionTitle =
      state.sessionTitles?.[input.sessionId]?.trim() ||
      defaultChatTitleForSession(input.sessionId);
    const item = await createItem(
      sessionFinishedItem({
        familiarId: input.familiarId,
        familiarName: input.familiarName,
        sessionTitle,
        sessionId: input.sessionId,
      }),
    );
    broadcastCreated(item);
    return item;
  } catch {
    return null;
  }
}
