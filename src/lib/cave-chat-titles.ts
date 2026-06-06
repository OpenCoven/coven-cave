type SessionLike = {
  id: string;
  title: string;
};

export const MAX_CHAT_TITLE_LENGTH = 120;

// Strip leading/trailing emoji and whitespace from session titles.
// Emoji in the middle of a title are left intact.
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+|[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/gu;
export function stripLeadingTrailingEmoji(title: string): string {
  return title.replace(EMOJI_RE, "").trim();
}

export function normalizeChatTitle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const title = input.trim().replace(/\s+/g, " ");
  if (!title) return null;
  return title.slice(0, MAX_CHAT_TITLE_LENGTH);
}

export function mergeSessionTitleOverrides<T extends SessionLike>(
  sessions: T[],
  titles: Record<string, string | undefined>,
): T[] {
  return sessions.map((session) => {
    const title = normalizeChatTitle(titles[session.id]);
    return title ? { ...session, title } : session;
  });
}
