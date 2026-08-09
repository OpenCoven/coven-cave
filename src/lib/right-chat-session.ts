import type { SessionRow } from "./types.ts";
import { filterVisibleChatSessions } from "./chat-projects.ts";

export function eligibleRightChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
): SessionRow[] {
  if (familiarId === null) return [];
  return filterVisibleChatSessions(sessions, familiarId);
}

export function resolveLatestRightChatSessionId(
  sessions: SessionRow[],
  familiarId: string | null,
): string | null {
  return eligibleRightChatSessions(sessions, familiarId)[0]?.id ?? null;
}
