/**
 * Journal generation prompt — the editable template behind "Generate today's
 * entry" ("Memories Prototype" redesign: the entry pane's Generation prompt
 * section).
 *
 * The template carries `{familiar}`, `{date}`, and `{context}` placeholders;
 * `renderJournalPrompt` substitutes them at generation time. The UI shows the
 * template verbatim (placeholders highlighted), so what you read is exactly
 * what will be sent. A customized template persists in localStorage; reset
 * clears it back to the default.
 */

export const JOURNAL_PROMPT_PLACEHOLDERS = ["{familiar}", "{date}", "{context}"] as const;

export const DEFAULT_JOURNAL_PROMPT = [
  "You are {familiar}, reflecting on {date} as my familiar.",
  "",
  "Write a short, first-person reflective journal entry about my day. Two to four sentences. Warm and concrete, grounded in what actually happened — never invent activity. Plain prose or light markdown.",
  "No heading, no preamble, no sign-off — return only the reflection text.",
  "",
  "Here is what happened today:",
  "{context}",
].join("\n");

export type JournalPromptVars = { familiar: string; date: string; context: string };

/** Substitute the placeholders. A template that dropped `{context}` still
 *  gets the day's activity appended — generation must stay grounded. */
export function renderJournalPrompt(template: string, vars: JournalPromptVars): string {
  let out = template
    .replaceAll("{familiar}", vars.familiar)
    .replaceAll("{date}", vars.date);
  if (out.includes("{context}")) {
    out = out.replaceAll("{context}", vars.context);
  } else if (vars.context.trim()) {
    out = `${out}\n\nHere is what happened today:\n${vars.context}`;
  }
  return out;
}

export type PromptSegment = { text: string; placeholder: boolean };

/** Split a template into text/placeholder runs for the highlight overlay
 *  (any `{…}` token counts, mirroring the prototype's highlighter). */
export function splitPromptSegments(template: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const re = /\{[^{}\n]+\}/g;
  let last = 0;
  for (const match of template.matchAll(re)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: template.slice(last, at), placeholder: false });
    segments.push({ text: match[0], placeholder: true });
    last = at + match[0].length;
  }
  if (last < template.length) segments.push({ text: template.slice(last), placeholder: false });
  return segments;
}

// ── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "cave:journal:prompt";

/** The stored custom template, or null when the default applies. */
export function readStoredJournalPrompt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

/** Persist a custom template; null (or a blank/default value) clears it. */
export function writeStoredJournalPrompt(value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || !value.trim() || value === DEFAULT_JOURNAL_PROMPT) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // storage unavailable (private mode) — the session just uses the default
  }
}
