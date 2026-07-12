import { COVEN_IDENTITY_CANON_HEADER } from "./coven-identity-canon.ts";
import { relativeTime } from "./daily-report.ts";

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

// --- Auto-naming: short summary titles -------------------------------------

export const MAX_SUMMARY_TITLE_LENGTH = 48;

// Question/request lead-ins that frame a topic without being part of it.
// Stripped once from the front of an already filler-cleaned prompt so
// "What's the best way to cache sessions" → "Best way to cache sessions".
// Anchored and conservative — if stripping leaves nothing meaningful the
// caller keeps the unstripped text.
const QUESTION_LEAD_IN_RE =
  /^(?:what(?:['’]s| is| are)(?: the)?|how (?:do|can|would|should) (?:i|we|you)|how to|why (?:is|are|does|do|did)|where (?:is|are|can|do)|when (?:is|are|does|do|should)|who (?:is|are)|is there (?:a|any) way to|tell me about|explain(?: to me)?|show me(?: how to)?)\b[\s,:;\-–—]*/i;

function clampAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace >= maxLen * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trimEnd().replace(/[,;:\-–—]$/, "")}…`;
}

/** First markdown heading (h1–h3) in the opening lines of an assistant reply,
 *  cleaned of markdown syntax and edge emoji. Assistant headings are often a
 *  genuine summary of a long ask ("# Retry policy options"). Null when the
 *  reply doesn't open with a usable heading. */
export function titleFromAssistantReply(assistantText: string | null | undefined): string | null {
  if (typeof assistantText !== "string") return null;
  const lines = assistantText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    if (!match) continue;
    const cleaned = stripLeadingTrailingEmoji(match[1].replace(/[*_`#]+/g, "").trim());
    if (cleaned.length >= 3 && cleaned.length <= 80) {
      return clampAtWordBoundary(cleaned, MAX_SUMMARY_TITLE_LENGTH);
    }
  }
  return null;
}

/** Short summary title for a chat thread, derived from its first exchange.
 *  Pure heuristic (no model call, matching the prompt-enhancer convention):
 *  the filler-cleaned user prompt when it already fits; otherwise an opening
 *  assistant heading when one exists; otherwise the cleaned prompt with its
 *  question lead-in stripped, clamped at a word boundary. Null when nothing
 *  meaningful can be derived — callers keep their current title. */
export function chatSummaryTitle(input: {
  userText?: string | null;
  assistantText?: string | null;
}): string | null {
  const normalized = normalizeChatTitle(input.userText);
  const cleaned = normalized ? cleanPromptForTitle(normalized) : null;
  if (cleaned && cleaned.length <= MAX_SUMMARY_TITLE_LENGTH) return cleaned;
  const fromReply = titleFromAssistantReply(input.assistantText);
  if (fromReply) return fromReply;
  if (!cleaned) return null;
  const stripped = cleaned.replace(QUESTION_LEAD_IN_RE, "").trim();
  const topic = stripped.length >= 3 ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : cleaned;
  return clampAtWordBoundary(topic, MAX_SUMMARY_TITLE_LENGTH);
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

/**
 * Neutral title for an untitled session. We intentionally do NOT encode the
 * session id (the old "New Session <first-8-of-id>" was pure noise); rows are
 * disambiguated at display time by `disambiguateSessionTitles`. `sessionId` is
 * kept in the signature for call-site stability.
 */
export function defaultChatTitleForSession(_sessionId?: string | null): string {
  return "New chat";
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

/**
 * Within one rendered session list, suffix any title shared by 2+ rows with its
 * relative time so the rows stay distinguishable (two "New chat" or two
 * "Workflow: Annotate Document" sessions). Titles appearing once are returned
 * unchanged. Pure — returns a map keyed by row id.
 */
export function disambiguateSessionTitles(
  rows: { id: string; title: string; updated_at?: string | null }[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.title, (counts.get(r.title) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const r of rows) {
    if ((counts.get(r.title) ?? 0) > 1) {
      const when = relativeTime(r.updated_at ?? undefined);
      out.set(r.id, when ? `${r.title} · ${when}` : r.title);
    } else {
      out.set(r.id, r.title);
    }
  }
  return out;
}
