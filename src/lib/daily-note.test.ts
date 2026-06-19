import assert from "node:assert/strict";
import {
  DAILY_NOTE_SECTIONS,
  formatDailyNote,
  isEmptyNote,
  isValidNoteDate,
  notePreview,
  parseDailyNote,
} from "./daily-note.ts";

// ── isValidNoteDate ──────────────────────────────────────────────────────────
assert.equal(isValidNoteDate("2026-06-18"), true, "accepts a real YYYY-MM-DD day");
assert.equal(isValidNoteDate("2026-02-29"), false, "rejects a non-existent calendar day");
assert.equal(isValidNoteDate("2026-13-01"), false, "rejects an out-of-range month");
assert.equal(isValidNoteDate("2026-6-1"), false, "rejects an unpadded slug");
assert.equal(isValidNoteDate("../../etc/passwd"), false, "rejects path traversal");
assert.equal(isValidNoteDate("2026-06-18.md"), false, "rejects a slug with an extension");

// ── parse / format round-trip ────────────────────────────────────────────────
const note = { notes: "Shipped the notes tab.", reflection: "Tests caught a parse bug early." };
const md = formatDailyNote("2026-06-18", note);
assert.match(md, /^# Daily Notes — 2026-06-18/, "format writes a dated title");
assert.match(md, /## Notes/, "format writes the Notes heading");
assert.match(md, /## Self-reflection/, "format writes the Self-reflection heading");

const parsed = parseDailyNote(md);
assert.equal(parsed.notes, note.notes, "round-trips the notes body");
assert.equal(parsed.reflection, note.reflection, "round-trips the reflection body");

// ── parse tolerates hand/agent edits ─────────────────────────────────────────
const messy = "# Daily Notes\n\nsome preamble\n\n## notes\nlowercase heading body\n\n## Self-Reflection\nmixed case\n";
const messyParsed = parseDailyNote(messy);
assert.equal(messyParsed.notes, "lowercase heading body", "matches headings case-insensitively");
assert.equal(messyParsed.reflection, "mixed case", "ignores preamble before the first section");

const onlyNotes = parseDailyNote("## Notes\njust notes\n");
assert.equal(onlyNotes.reflection, "", "missing section parses to an empty string");

// ── isEmptyNote ──────────────────────────────────────────────────────────────
assert.equal(isEmptyNote({ notes: "  ", reflection: "\n" }), true, "whitespace-only note is empty");
assert.equal(isEmptyNote({ notes: "x", reflection: "" }), false, "any content makes it non-empty");

// ── notePreview ──────────────────────────────────────────────────────────────
assert.equal(
  notePreview({ notes: "", reflection: "fell back to reflection" }),
  "fell back to reflection",
  "preview falls back to reflection when notes are empty",
);
assert.ok(notePreview({ notes: "x".repeat(300), reflection: "" }).endsWith("…"), "long previews are truncated");

assert.equal(DAILY_NOTE_SECTIONS.reflection, "Self-reflection", "the reflection section is named Self-reflection");

console.log("daily-note: all assertions passed");
