/**
 * scribe-craft — pure writing-desk logic for the Scribe room.
 *
 * Word counting, reading time, tag parsing, and desk summaries over the
 * scribe's local drafts. Kept JSX-free (type-only imports) so the rules are
 * unit-testable under plain `node --experimental-strip-types`.
 */

export type ScribeDraft = {
  id: string;
  title: string;
  body: string;
  /** Raw comma/space separated tag input, parsed at publish time. */
  tags: string;
  createdAt: string;
  updatedAt: string;
  /** Knowledge Vault entry id once published; republish updates in place. */
  publishedId: string | null;
};

/** Count prose words — whitespace-separated runs that contain a letter or digit. */
export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  if (!matches) return 0;
  return matches.filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

const WORDS_PER_MINUTE = 200;

/** "—" for empty, "<1 min read", then "N min read" at ~200 wpm. */
export function readingTimeLabel(words: number): string {
  if (words <= 0) return "—";
  const minutes = words / WORDS_PER_MINUTE;
  if (minutes < 1) return "<1 min read";
  return `${Math.round(minutes)} min read`;
}

/** Split a raw tag string the same way the Knowledge API does. */
export function parseTags(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export type DeskSummary = {
  drafts: number;
  published: number;
  words: number;
};

export function deskSummary(drafts: readonly Pick<ScribeDraft, "body" | "publishedId">[]): DeskSummary {
  return {
    drafts: drafts.length,
    published: drafts.filter((d) => d.publishedId != null).length,
    words: drafts.reduce((total, draft) => total + countWords(draft.body), 0),
  };
}

export type ScribeStatus = {
  label: string;
  tone: "ok" | "busy";
};

/** The room's one-line status chip, derived from the persisted drafts. */
export function scribeStatus(summary: Pick<DeskSummary, "drafts" | "words">): ScribeStatus {
  if (summary.drafts === 0) return { label: "desk clear", tone: "ok" };
  return {
    label: `${summary.drafts} draft${summary.drafts === 1 ? "" : "s"} · ${summary.words} words`,
    tone: "busy",
  };
}
