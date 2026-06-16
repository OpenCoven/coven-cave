import type { Card } from "@/lib/cave-board-types";
import type { InboxItem, NewItemInput } from "@/lib/cave-inbox";

/**
 * Archive-nudge: the "final nudge" emitted when a chat tied to a task reaches
 * the end of its execution lifecycle (card lifecycle → `completed`) and is
 * ready to be archived. The nudge lands in the inbox as a system reminder
 * linked to the task's chat session, and is cleared automatically when the
 * session is archived.
 *
 * `auto` on the inbox item is the durable discriminator: it marks the item as
 * machine-generated so we can dedup on create and resolve on archive without
 * brittle title/string matching. Human/user reminders never set it.
 */
export const ARCHIVE_NUDGE_AUTO = "archive-nudge";

/** Statuses that mean a nudge is no longer pending the user's attention. */
const RESOLVED: ReadonlyArray<InboxItem["status"]> = ["done", "dismissed"];

/**
 * Build the inbox payload for a card's archive nudge, or `null` when the card
 * isn't eligible (not completed, or has no linked chat session). Pure — does
 * no IO and never dedups; callers gate creation with {@link shouldCreateArchiveNudge}.
 */
export function archiveNudgeForCard(card: Card): NewItemInput | null {
  if (card.lifecycle !== "completed") return null;
  const sessionId = card.sessionId;
  if (!sessionId) return null;
  const title = card.title?.trim() || "Untitled task";
  return {
    kind: "reminder",
    title: `Ready to archive: ${title}`,
    body: "This task is complete. Archive its chat to clear it from your active sessions.",
    source: "system",
    familiarId: card.familiarId ?? null,
    sessionId,
    link: { kind: "session", ref: sessionId },
    auto: ARCHIVE_NUDGE_AUTO,
  };
}

/**
 * True when `item` is an archive nudge. When `sessionId` is supplied, also
 * requires the nudge to target that session (matched on either the item's
 * `sessionId` or its session link ref).
 */
export function isArchiveNudge(item: InboxItem, sessionId?: string): boolean {
  if (item.auto !== ARCHIVE_NUDGE_AUTO) return false;
  if (sessionId == null) return true;
  return item.sessionId === sessionId || item.link?.ref === sessionId;
}

/**
 * Whether a new archive nudge should be created for `card`, given the current
 * inbox `items` and the set of already-archived session ids. Avoids duplicate
 * nudges for the same session and skips chats that are already archived.
 */
export function shouldCreateArchiveNudge(
  card: Card,
  items: InboxItem[],
  archivedSessionIds: string[],
): boolean {
  const input = archiveNudgeForCard(card);
  if (!input) return false;
  const sessionId = card.sessionId as string;
  if (archivedSessionIds.includes(sessionId)) return false;
  const alreadyActive = items.some(
    (it) => isArchiveNudge(it, sessionId) && !RESOLVED.includes(it.status),
  );
  return !alreadyActive;
}

/**
 * The active archive nudges that should be marked done when `sessionId` is
 * archived (so the nudge disappears once the user acts on it).
 */
export function archiveNudgesToResolve(items: InboxItem[], sessionId: string): InboxItem[] {
  return items.filter(
    (it) => isArchiveNudge(it, sessionId) && !RESOLVED.includes(it.status),
  );
}
