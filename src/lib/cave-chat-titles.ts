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

// High-precision lead-ins that carry no information in a title: politeness and
// explicit request framing. Stripped (case-insensitively, repeatedly) from the
// front so "please fix the search bar" → "Fix the search bar" and "can you add
// a youtube viewer" → "Add a youtube viewer". Deliberately conservative —
// content-initial words like "now"/"just"/"and" are left alone to avoid eating
// real titles ("Now and Then is a Beatles song …").
const LEADING_FILLER_RE =
  /^(?:please|pls|plz|kindly|can you|could you|would you|will you|can we|could we|would we|let'?s|i (?:want|need|wanna) to|i'?d like to|i would like to|help me(?: to)?|go ahead(?: and)?)\b[\s,:;.!?\-–—]*/i;

// Trailing politeness ("restart it please", "fix this, thanks").
const TRAILING_FILLER_RE =
  /[\s,;.!?\-–—]*\b(?:please|pls|plz|kindly|thanks|thank you|thx|ty)\b[\s.!?]*$/i;

/** Strip conversational filler from a prompt so it reads like a title: drop
 *  leading politeness/request framing and trailing politeness, then capitalize.
 *  Falls back to the raw (whitespace-collapsed) prompt when stripping would
 *  leave nothing meaningful. */
export function cleanPromptForTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  let s = normalized;
  let prev = "";
  while (s && s !== prev) {
    prev = s;
    s = s.replace(LEADING_FILLER_RE, "");
  }
  s = s.replace(TRAILING_FILLER_RE, "").trim();
  if (s.length < 3) return normalized;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Default title for a chat session started from a user prompt: the prompt
 *  cleaned of conversational filler (see cleanPromptForTitle), whitespace-
 *  collapsed and truncated to a title-sized string. The cut backs up to the
 *  last word boundary (unless that would lose too much) so the title doesn't end
 *  mid-word — "…the changes we made" not "…the changes we ma". */
export function chatTitleFromPrompt(prompt: string | null | undefined): string | null {
  const normalized = normalizeChatTitle(prompt);
  if (!normalized) return null;
  const cleaned = cleanPromptForTitle(normalized);
  if (cleaned.length <= MAX_PROMPT_TITLE_LENGTH) return cleaned;
  const slice = cleaned.slice(0, MAX_PROMPT_TITLE_LENGTH - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace >= MAX_PROMPT_TITLE_LENGTH * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trimEnd()}…`;
}

// Matches the current header ("Coven identity canon:") and legacy variants
// with a parenthetical before the colon ("Coven identity canon (binding):"),
// which ~17 historical sessions still carry. A colon-less title like
// "Coven identity canon (binding)" is a legitimate human-chosen name and
// passes through.
const CANON_TITLE_LEAK_RE = new RegExp(
  `^${COVEN_IDENTITY_CANON_HEADER.replace(/:$/, "")}\\s*(\\([^)]*\\))?\\s*:`,
);

// The other preamble the chat route prepends to every harness prompt is the
// runtime filesystem boundary (see buildRuntimeScopePreamble in
// chat-runtime-scope.ts, kept server-only — hence the literal here, tied to the
// source by session-title-canon.test.ts). Daemon-derived titles leak it as
// "Runtime filesystem boundary: - This is the local…", duplicated across every
// chat in a project. Reject it so those fall back to a neutral title.
const RUNTIME_SCOPE_TITLE_LEAK_RE = /^Runtime filesystem boundary\s*:/;

/** Reject harness-derived titles that leaked one of the preambles the chat
 *  route prepends to every harness prompt (identity canon or runtime scope).
 *  Returns the normalized title, or null when the caller should fall back to a
 *  default. */
export function sanitizeSessionTitle(title: string | null | undefined): string | null {
  const normalized = normalizeChatTitle(title);
  if (!normalized) return null;
  if (CANON_TITLE_LEAK_RE.test(normalized)) return null;
  if (RUNTIME_SCOPE_TITLE_LEAK_RE.test(normalized)) return null;
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
