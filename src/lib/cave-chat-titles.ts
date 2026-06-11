import { COVEN_IDENTITY_CANON_HEADER } from "./coven-identity-canon.ts";

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

const MAX_PROMPT_TITLE_LENGTH = 64;

/** Default title for a chat session started from a user prompt: the prompt
 *  itself, whitespace-collapsed and truncated to a title-sized string. */
export function chatTitleFromPrompt(prompt: string | null | undefined): string | null {
  const normalized = normalizeChatTitle(prompt);
  if (!normalized) return null;
  if (normalized.length <= MAX_PROMPT_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_PROMPT_TITLE_LENGTH - 1).trimEnd()}\u2026`;
}

/** Reject harness-derived titles that leaked the identity-canon preamble the
 *  chat route prepends to every harness prompt. Returns the normalized title,
 *  or null when the caller should fall back to a default. */
export function sanitizeSessionTitle(title: string | null | undefined): string | null {
  const normalized = normalizeChatTitle(title);
  if (!normalized) return null;
  if (normalized.startsWith(COVEN_IDENTITY_CANON_HEADER)) return null;
  return normalized;
}

export function defaultChatTitleForSession(sessionId: string | null | undefined): string {
  const normalized = normalizeChatTitle(sessionId);
  const compactId = (normalized?.replace(/^session[-_:\s]*/i, "") || normalized || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8);
  const shortId = compactId || normalized?.slice(0, 8);
  return shortId ? `New Session ${shortId}` : "New Session";
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
