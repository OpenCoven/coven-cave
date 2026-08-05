import { COVEN_IDENTITY_CANON_HEADER } from "./coven-identity-canon.ts";
import { relativeTime } from "./daily-report.ts";

type SessionLike = {
  id: string;
  title: string;
};

export const MAX_CHAT_TITLE_LENGTH = 120;

// Strip complete emoji grapheme sequences at title edges without treating plain
// digits, #, or * as emoji. This covers:
//   - keycaps such as 1️⃣ ([#*0-9] + optional VS16 + U+20E3)
//   - variation selectors VS15 (U+FE0E, text presentation) and VS16 (U+FE0F)
//   - Fitzpatrick skin-tone modifiers (Emoji_Modifier)
//   - tag sequences used for regional-indicator flag sequences
//   - ZWJ compounds such as 👩‍💻 and multi-member family sequences 👨‍👩‍👧‍👦
const PICTOGRAPHIC = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})`;
const EMOJI_TAG_SEQUENCE = String.raw`(?:[\u{E0020}-\u{E007E}]+\u{E007F})`;
// VS15 (U+FE0E) requests text presentation; VS16 (U+FE0F) requests emoji
// presentation. Both must be consumed as part of the preceding base character
// so they do not leak into the stripped output (e.g. "❤︎ Fix" → "Fix").
const EMOJI_COMPONENT = String.raw`${PICTOGRAPHIC}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})?(?:${EMOJI_TAG_SEQUENCE})?`;
const EMOJI_SEQUENCE = String.raw`(?:[#*0-9]\uFE0F?\u20E3|${EMOJI_COMPONENT}(?:\u200D${EMOJI_COMPONENT})*)`;
const LEADING_EMOJI_RE = new RegExp(String.raw`^(?:\s|${EMOJI_SEQUENCE})+`, "gu");
const TRAILING_EMOJI_RE = new RegExp(String.raw`(?:\s|${EMOJI_SEQUENCE})+$`, "gu");
export function stripLeadingTrailingEmoji(title: string): string {
  return title.replace(LEADING_EMOJI_RE, "").replace(TRAILING_EMOJI_RE, "").trim();
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

export const MAX_SUMMARY_TITLE_LENGTH = 40;
export const MAX_SUMMARY_TITLE_WORDS = 7;

// Question/request lead-ins that frame a topic without being part of it.
// Stripped once from the front of an already filler-cleaned prompt so
// "What's the best way to cache sessions" → "Best way to cache sessions".
// Anchored and conservative — if stripping leaves nothing meaningful the
// caller keeps the unstripped text.
const QUESTION_LEAD_IN_RE =
  /^(?:what(?:['’]s| is| are)(?: the)?|how (?:do|can|would|should) (?:i|we|you)|how to|why (?:is|are|does|do|did)|where (?:is|are|can|do)|when (?:is|are|does|do|should)|who (?:is|are)|is there (?:a|any) way to|tell me about|explain(?: to me)?|show me(?: how to)?)\b[\s,:;\-–—]*/i;

// Answer-heading boilerplate: "Here is the ...", "Here are ...", "Here's the ...",
// "Here's ...", "This is a ..." Stripped once from the front of assistant heading
// text so the title names the topic, not the meta-framing.
// Covers the contraction forms with straight (') and Unicode (', ') apostrophes.
const ANSWER_HEADING_RE =
  /^(?:here\s+(?:is|are)|here['\u2018\u2019]s|this is)(?:\s+(?:a|an|the))?\s+/i;

// Boilerplate-only guard: "This is.", "Here is.", "Here's.", etc. with no content
// after the framing phrase must collapse to null, not produce a stub title.
// Checked before stripping so "This is a test" goes through normally.
const BOILERPLATE_ONLY_RE =
  /^(?:here\s+(?:is|are)|here['\u2018\u2019]s|this is)(?:\s+(?:a|an|the))?\s*[.,:;!?]?\s*$/i;

// Returns null only when no word boundary exists (lastSpace < 0), so a truly
// single over-length token with no spaces produces null and the caller keeps
// its current title. Multiword strings are always cut at the last word boundary,
// even when that boundary is early in the string — a short first word followed
// by a long second word must not collapse to null.
const TRAILING_TITLE_PUNCTUATION_RE =
  /[.,:;!?\u2026\u3002\uFF01\uFF1F][\s.,:;!?\u2026\u3002\uFF01\uFF1F]*$/u;
const TRAILING_TRUNCATION_PUNCTUATION_RE =
  /[.,:;!?\-–—\u2026\u3002\uFF01\uFF1F][\s.,:;!?\-–—\u2026\u3002\uFF01\uFF1F]*$/u;

function stripTrailingTitlePunctuation(text: string): string {
  return text.replace(TRAILING_TITLE_PUNCTUATION_RE, "").trimEnd();
}

function appendTruncationEllipsis(text: string): string {
  const stem = text
    .trimEnd()
    .replace(TRAILING_TRUNCATION_PUNCTUATION_RE, "")
    .trimEnd();
  return `${stem}…`;
}

function clampAtWordBoundary(text: string, maxLen: number): string | null {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace < 0) return null;
  return appendTruncationEllipsis(slice.slice(0, lastSpace));
}

function stripLineMarkdown(text: string): string {
  return text
    .replace(/^(?:\s{0,3}>\s*)+/gm, "")
    .replace(/^[\t ]*(?:[-+*]|\d{1,9}[.)])[\t ]+(?:\[[ xX]\][\t ]+)?/gm, "")
    .replace(/^\s{0,3}\[[^\]]+\]:\s+\S+.*$/gm, " ");
}

function normalizeGeneratedTitleSource(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const source = input.trim();
  if (!source) return null;
  return source.slice(0, MAX_CHAT_TITLE_LENGTH);
}

/**
 * Shared formatter for all auto-generated titles (first-exchange naming,
 * periodic auto-rename, sparkle generation). Deterministic offline contract:
 * normalizes markdown links to their label, removes other markdown and edge
 * emoji, strips answer-heading boilerplate, conversational filler, and
 * question/request lead-ins, removes trailing sentence-ending punctuation,
 * capitalizes, caps at MAX_SUMMARY_TITLE_WORDS words, and clamps at
 * MAX_SUMMARY_TITLE_LENGTH chars at a word boundary (ellipsis only when cut).
 * Returns null when nothing useful remains (< 2 chars after cleanup) or when a
 * single over-length token has no word boundary to cut at cleanly.
 */
function formatGeneratedTitle(text: string): string | null {
  // Remove reference definitions and blockquote prefixes before line structure
  // is collapsed. Nested blockquotes are consumed as one prefix.
  let s = stripLineMarkdown(text);
  // Normalize markdown images: ![alt](url) → alt text if non-empty, else stripped.
  // Must run before link normalization to avoid the leading ! leaking into the output.
  // Supports one level of nested parentheses in the destination (e.g. url_(anchor)).
  s = s.replace(
    /!\[([^\]]*)\]\((?:[^()]*|\([^()]*\))*(?:\s+"[^"]*")?\)/g,
    (_, alt) => alt.trim(),
  );
  // Normalize markdown links: [label](url) → label; destination discarded.
  // Supports one level of nested parentheses so [Docs](https://x.test/a_(b)) → Docs.
  s = s.replace(/\[([^\]]+)\]\((?:[^()]*|\([^()]*\))*(?:\s+"[^"]*")?\)/g, "$1");
  // Normalize full/collapsed reference links and shortcut reference links.
  s = s
    .replace(/\[([^\]]+)\]\s*\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\](?!\s*\()/g, "$1");
  // Strip strikethrough: ~~text~~ → text.
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // Strip remaining markdown syntax without removing the base of *️⃣ / #️⃣
  // keycap emoji before the edge-emoji pass can consume the full sequence.
  s = s
    .replace(/[_`]+|[*#](?!\uFE0F?\u20E3)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Cleanup loop: trailing punctuation → edge emoji → leading separators exposed by
  // emoji removal → trailing punctuation again, so "🎉: Fix parser." → "Fix parser"
  // and "Fix parser 🎉." are both fully cleaned.
  // Unicode sentence-ending punct (。！？) stripped alongside ASCII .!?
  s = stripTrailingTitlePunctuation(s).trim();
  s = stripLeadingTrailingEmoji(s);
  s = s.replace(/^[\s,:;.!?\-–—]+/, "").trim(); // strip separators exposed after emoji removal
  s = stripTrailingTitlePunctuation(s).trim();
  // Boilerplate-only: "This is.", "Here is.", "Here's." → null (no meaningful fallback).
  if (BOILERPLATE_ONLY_RE.test(s)) return null;
  // Strip answer-heading boilerplate: "Here is the …", "Here are …", "Here's the …", "This is a …"
  s = s.replace(ANSWER_HEADING_RE, "").trim();
  // Strip conversational filler (leading politeness/request framing such as
  // "can you", "please") so framing is removed from any input path, not only
  // from text pre-processed through cleanPromptForTitle.
  let prev = "";
  while (s && s !== prev) {
    prev = s;
    s = s.replace(LEADING_FILLER_RE, "");
  }
  s = s.replace(TRAILING_FILLER_RE, "").trim();
  // Strip question/request lead-ins: "How do I …", "What's the best …", etc.
  s = s.replace(QUESTION_LEAD_IN_RE, "").trim();
  // Final trailing-punctuation pass in case stripping exposed new punctuation.
  // Unicode sentence-ending punct (。！？) stripped alongside ASCII .!?
  s = stripTrailingTitlePunctuation(s).trim();
  // Allow two-character acronyms such as "AI"; single chars are not meaningful.
  if (s.length < 2) return null;
  // Capitalize.
  s = s.charAt(0).toUpperCase() + s.slice(1);
  // Cap at the word limit and make the omission visible. The ellipsis remains
  // attached to the final retained word, so it does not increase word count.
  const words = s.split(/\s+/);
  if (words.length > MAX_SUMMARY_TITLE_WORDS) {
    s = appendTruncationEllipsis(
      words
        .slice(0, MAX_SUMMARY_TITLE_WORDS)
        .join(" "),
    );
  }
  // Clamp at character limit; null when no word boundary exists (prevents
  // mid-word fragments from single over-length tokens).
  return clampAtWordBoundary(s, MAX_SUMMARY_TITLE_LENGTH);
}

/** First markdown heading (h1–h3) in the opening lines of an assistant reply,
 *  normalized through formatGeneratedTitle. Assistant headings are often a
 *  genuine summary of a long ask ("# Retry policy options"). Null when the
 *  reply doesn't open with a usable heading. */
export function titleFromAssistantReply(assistantText: string | null | undefined): string | null {
  if (typeof assistantText !== "string") return null;
  const lines = assistantText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:>\s*)+/, ""))
    .filter(Boolean)
    .slice(0, 3);
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    if (!match) continue;
    const formatted = formatGeneratedTitle(match[1]);
    if (formatted) return formatted;
  }
  return null;
}

/** Short summary title for a chat thread, derived from its first exchange.
 *  Pure heuristic (no model call): the filler-cleaned user prompt when it fits
 *  the summary length, formatted through formatGeneratedTitle (strips question
 *  lead-ins, trailing punct, etc.); otherwise an assistant heading; otherwise
 *  the formatted cleaned prompt clamped at a word boundary. Null when nothing
 *  meaningful can be derived — callers keep their current title. */
export function chatSummaryTitle(input: {
  userText?: string | null;
  assistantText?: string | null;
}): string | null {
  const normalized = normalizeGeneratedTitleSource(input.userText);
  const cleaned = normalized ? cleanPromptForTitle(stripLineMarkdown(normalized)) : null;
  // Short prompts: apply shared formatter and return directly when they fit.
  if (cleaned && cleaned.length <= MAX_SUMMARY_TITLE_LENGTH) {
    const formatted = formatGeneratedTitle(cleaned);
    if (formatted) return formatted;
  }
  // Long prompts (or short prompts that collapsed to nothing): prefer an
  // assistant heading — often a more informative summary than a truncated ask.
  const fromReply = titleFromAssistantReply(input.assistantText);
  if (fromReply) return fromReply;
  // Final fallback: format the full cleaned prompt (question lead-ins stripped,
  // capped at word/char limits).
  if (!cleaned) return null;
  return formatGeneratedTitle(cleaned);
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
