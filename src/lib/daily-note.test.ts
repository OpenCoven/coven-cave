import assert from "node:assert/strict";
import {
  buildActivityDigest,
  DAILY_NOTE_SECTIONS,
  excerptOf,
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

// ── excerptOf ────────────────────────────────────────────────────────────────
assert.equal(excerptOf("# Heading\n\nThe **real** body line."), "The real body line.", "strips headings + markdown");
assert.equal(excerptOf(""), "", "empty input yields empty excerpt");
assert.ok(excerptOf("x".repeat(300)).endsWith("…"), "long excerpts are truncated");

// ── buildActivityDigest ──────────────────────────────────────────────────────
assert.equal(
  buildActivityDigest([], []),
  "_No tracked activity for this day yet._",
  "empty activity yields the honest empty state",
);

const digest = buildActivityDigest(
  [{ title: "Letta research", harness: "claude" }, { title: "Deck pass" }],
  [{ file: "2026-06-18.md", excerpt: "sharpened identity contrast" }],
);
assert.match(digest, /2 sessions today:/, "counts sessions");
assert.match(digest, /- Letta research _\(claude\)_/, "lists session title + harness");
assert.match(digest, /- Deck pass$/m, "a session without a harness omits the suffix");
assert.match(digest, /Memory touched \(1\):/, "counts memory files");
assert.match(digest, /- `2026-06-18\.md` — sharpened identity contrast/, "shows memory excerpt");

assert.equal(
  buildActivityDigest([{ title: "only a session" }], []).includes("Memory touched"),
  false,
  "omits the memory block when there are no memory files",
);


// Scheduled scaffolding must obey the same active-day rule as the UI.
{
  const { readFileSync } = await import("node:fs");
  const generator = readFileSync(new URL("../../scripts/generate-daily-notes.mjs", import.meta.url), "utf8");
  assert.match(generator, /if \(!sessions\.length && !memory\.length\)[\s\S]*?continue;/, "inactive days never get scaffolds, including explicit regeneration");
}

// Exercise the scheduled seeder against isolated data, including explicit
// digest refreshes. Never read the developer's real familiar registry/socket.
{
  const { mkdtemp, mkdir, rm, writeFile, utimes, readFile, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(join(tmpdir(), "cave-note-seeder-"));
  const workspace = join(root, "sage");
  const date = "2026-10-01";
  const noteFile = join(workspace, "notes", `${date}.md`);
  const run = () => promisify(execFile)(process.execPath, ["--experimental-strip-types", new URL("../../scripts/generate-daily-notes.mjs", import.meta.url).pathname, date, "--section", "notes"], { env: { ...process.env, COVEN_HOME: root }, timeout: 10000 });
  try {
    await writeFile(join(root, "familiars.toml"), `[[familiar]]\nid = "sage"\nworkspace = "${workspace}"\n`);
    await run();
    await assert.rejects(() => access(noteFile), "an inactive familiar gets no file");
    await mkdir(join(workspace, "memory"), { recursive: true });
    const memoryFile = join(workspace, "memory", "lesson.md");
    await writeFile(memoryFile, "A real lesson.");
    const stamp = new Date(2026, 9, 1, 12);
    await utimes(memoryFile, stamp, stamp);
    await run();
    assert.match(await readFile(noteFile, "utf8"), /lesson.md/);
    await writeFile(noteFile, formatDailyNote(date, { notes: "Old digest", reflection: "My authored reflection" }));
    await run();
    assert.equal(parseDailyNote(await readFile(noteFile, "utf8")).reflection, "My authored reflection");
  } finally { await rm(root, { recursive: true, force: true }); }
}

console.log("daily-note: all assertions passed");
