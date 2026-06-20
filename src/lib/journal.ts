/**
 * Personal Journal — one entry per day. Each entry is a Markdown file at
 * `~/.coven/journal/<YYYY-MM-DD>.md`: a small frontmatter block (which familiar
 * reflected, when) followed by the reflection body. This is the pure
 * parse/format/validate layer shared by the API route (fs) and the UI (no fs).
 *
 * Date validation is reused from daily-note (`isValidNoteDate`), which doubles
 * as the path-injection barrier for the route's filename construction.
 */

export type JournalEntry = {
  reflectedBy: string | null;
  generatedAt: string | null;
  reflection: string;
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** Pull `reflectedBy` / `generatedAt` from frontmatter and the reflection body out of a journal file. */
export function parseJournalEntry(markdown: string): JournalEntry {
  const out: JournalEntry = { reflectedBy: null, generatedAt: null, reflection: "" };
  if (!markdown) return out;
  let body = markdown;
  const m = FRONTMATTER.exec(markdown);
  if (m) {
    body = markdown.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key === "reflectedBy") out.reflectedBy = val || null;
      else if (key === "generatedAt") out.generatedAt = val || null;
    }
  }
  out.reflection = body.replace(/^\s*\n/, "").replace(/\s+$/, "");
  return out;
}

/** Serialize an entry to its canonical Markdown layout (frontmatter + reflection). */
export function formatJournalEntry(entry: JournalEntry): string {
  return [
    "---",
    `reflectedBy: ${entry.reflectedBy ?? ""}`,
    `generatedAt: ${entry.generatedAt ?? ""}`,
    "---",
    "",
    (entry.reflection ?? "").trim(),
    "",
  ].join("\n");
}

/** True when the reflection body is blank — used to delete instead of writing an empty file. */
export function isEmptyEntry(entry: JournalEntry): boolean {
  return !(entry.reflection ?? "").trim();
}

/** A short, markdown-stripped one-line preview for the day list. */
export function entryPreview(entry: JournalEntry, max = 120): string {
  const source = (entry.reflection || "")
    .replace(/^#.*$/gm, "")
    .replace(/[#*_`>\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}

type JournalContextInput = {
  reminders: { title: string }[];
  responses: { title: string }[];
  familiars: { title: string }[];
};

/**
 * A compact, plain-text digest of a day's tracked activity, handed to the
 * familiar as context for the reflection it writes. Pure — no fs, no inbox
 * loading; the route passes in the already-sliced day breakdown.
 */
export function buildJournalContext(date: string, input: JournalContextInput): string {
  const { reminders, responses, familiars } = input;
  const total = reminders.length + responses.length + familiars.length;
  if (total === 0) return `${date}: a quiet day — nothing tracked in the inbox.`;

  const lines: string[] = [
    `${date}: ${reminders.length} reminder${reminders.length === 1 ? "" : "s"}, ` +
      `${responses.length} response${responses.length === 1 ? "" : "s"}, ` +
      `${familiars.length} familiar update${familiars.length === 1 ? "" : "s"}.`,
  ];
  const titles = [...responses, ...reminders, ...familiars].map((i) => i.title).filter(Boolean).slice(0, 8);
  for (const t of titles) lines.push(`- ${t}`);
  return lines.join("\n");
}
