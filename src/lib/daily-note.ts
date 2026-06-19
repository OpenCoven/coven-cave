/**
 * Daily Notes — a familiar's per-day journal.
 *
 * Each note is a single Markdown file on disk
 * (`~/.coven/workspaces/familiars/<id>/notes/<YYYY-MM-DD>.md`) split into two
 * fixed sections: free-form **Notes** (what the familiar worked on / observed)
 * and **Self-reflection** (how it went, what to do differently). Storing plain
 * Markdown — rather than JSON — keeps the file human-readable and lets a
 * familiar/agent author it directly; this module is the pure parse/format/validate
 * layer shared by the API route (fs) and the UI (no fs).
 */

export type DailyNote = {
  notes: string;
  reflection: string;
};

/** Section headings, in file order. The labels double as the UI section titles. */
export const DAILY_NOTE_SECTIONS = {
  notes: "Notes",
  reflection: "Self-reflection",
} as const;

const DATE_SLUG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A note date must be a strict `YYYY-MM-DD` slug AND a real calendar day. The
 * regex alone already excludes path separators and `..`, so this also serves as
 * the path-injection barrier for the notes route's filename construction.
 */
export function isValidNoteDate(date: string): boolean {
  if (!DATE_SLUG.test(date) || date.includes("..")) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Pull the **Notes** and **Self-reflection** bodies out of a note Markdown file.
 * Tolerant of hand/agent edits: a missing section yields an empty string, and any
 * leading `# Daily Notes …` title or preamble before the first `## ` heading is
 * ignored. Headings are matched case-insensitively.
 */
export function parseDailyNote(markdown: string): DailyNote {
  const out: DailyNote = { notes: "", reflection: "" };
  if (!markdown) return out;

  // Split on level-2 headings, keeping each heading with its body.
  const parts = markdown.split(/^##[ \t]+/m);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase();
    const body = (newline === -1 ? "" : part.slice(newline + 1)).replace(/\s+$/, "");
    if (heading === DAILY_NOTE_SECTIONS.notes.toLowerCase()) {
      out.notes = trimLeadingBlankLines(body);
    } else if (heading === DAILY_NOTE_SECTIONS.reflection.toLowerCase()) {
      out.reflection = trimLeadingBlankLines(body);
    }
  }
  return out;
}

/** Serialize a note back to the canonical Markdown layout for a given day. */
export function formatDailyNote(date: string, note: DailyNote): string {
  const notes = (note.notes ?? "").trim();
  const reflection = (note.reflection ?? "").trim();
  return [
    `# Daily Notes — ${date}`,
    "",
    `## ${DAILY_NOTE_SECTIONS.notes}`,
    "",
    notes,
    "",
    `## ${DAILY_NOTE_SECTIONS.reflection}`,
    "",
    reflection,
    "",
  ].join("\n");
}

/** True when neither section has any content — used to delete instead of writing an empty file. */
export function isEmptyNote(note: DailyNote): boolean {
  return !(note.notes ?? "").trim() && !(note.reflection ?? "").trim();
}

/** A short one-line preview of a note for the date list (prefers Notes, falls back to reflection). */
export function notePreview(note: DailyNote, max = 120): string {
  const source = (note.notes || note.reflection || "").replace(/[#*_`>\-]/g, "").replace(/\s+/g, " ").trim();
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}

function trimLeadingBlankLines(value: string): string {
  return value.replace(/^\s*\n/, "").replace(/\s+$/, "");
}
