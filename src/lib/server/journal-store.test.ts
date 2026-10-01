// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Every case runs against a throwaway COVEN_HOME — never the real ~/.coven.
const root = await mkdtemp(path.join(os.tmpdir(), "cave-journal-store-"));
process.env.COVEN_HOME = root;

const store = await import("./journal-store.ts");
const { formatJournalEntry } = await import("../journal.ts");
const date = "2026-07-26";
const journalDir = path.join(root, "journal");
const legacyFile = (d) => path.join(journalDir, `${d}.md`);
const familiarFile = (id, d) => path.join(journalDir, "familiars", id, `${d}.md`);
const entry = (reflectedBy, reflection, generatedAt = null) => ({ reflectedBy, generatedAt, reflection });
const exists = async (file) => readFile(file, "utf8").then(() => true, () => false);

async function reset() {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
}

async function writeLegacy(d, e, mtime) {
  await mkdir(journalDir, { recursive: true });
  await writeFile(legacyFile(d), formatJournalEntry(e), "utf8");
  if (mtime) await utimes(legacyFile(d), mtime, mtime);
}

async function writeFamiliar(id, d, e, mtime) {
  await mkdir(path.dirname(familiarFile(id, d)), { recursive: true });
  await writeFile(familiarFile(id, d), formatJournalEntry(e), "utf8");
  if (mtime) await utimes(familiarFile(id, d), mtime, mtime);
}

try {
  // ── Missing / broken stores fail honestly ─────────────────────────────────
  const missing = await store.readJournalEntry(date);
  assert.equal(missing.exists, false, "a missing journal day is a normal empty record");
  assert.equal(missing.source, null, "a missing record names no source layout");
  assert.deepEqual(await store.listJournalEntries(), [], "a missing journal directory is an empty list");
  assert.equal(await store.deleteJournalEntry(date), false, "deleting a missing journal day is a no-op");
  assert.equal(await store.deleteJournalEntry(date, "astra"), false, "deleting a missing familiar day is a no-op");

  await mkdir(legacyFile(date), { recursive: true });
  await assert.rejects(
    store.readJournalEntry(date),
    "a non-file journal entry must surface its filesystem error",
  );
  await assert.rejects(
    store.deleteJournalEntry(date),
    "a non-file journal entry must not masquerade as an already-deleted file",
  );

  await reset();
  await writeFile(journalDir, "not a directory", "utf8");
  await assert.rejects(
    store.listJournalEntries(),
    "a broken journal directory must not masquerade as an empty journal",
  );

  // ── Familiar ids are a strict slug before any path is built ───────────────
  await reset();
  for (const bad of ["../astra", "a/b", "..", ".hidden", "", "a".repeat(65)]) {
    assert.equal(store.isJournalFamiliarId(bad), false, `"${bad}" is not a journal familiar id`);
    assert.throws(() => store.familiarJournalDir(bad), `familiarJournalDir rejects "${bad}"`);
  }
  assert.equal(store.familiarJournalDir("astra"), path.join(journalDir, "familiars", "astra"));
  // A traversal id on write never escapes: it falls back to the legacy file.
  await store.writeJournalEntry(date, entry("../evil", "sneaky"));
  assert.equal(await exists(legacyFile(date)), true, "an invalid familiar id writes the legacy layout");
  assert.equal(await exists(path.join(root, "evil")), false, "nothing is written outside the journal dir");

  // ── Two familiars on the same day no longer overwrite each other ──────────
  await reset();
  const astra = await store.writeJournalEntry(date, entry("astra", "Astra's day", "2026-07-26T21:30:00.000Z"));
  const nova = await store.writeJournalEntry(date, entry("nova", "Nova's day"));
  assert.equal(astra.source, "familiar");
  assert.equal(await exists(familiarFile("astra", date)), true, "astra writes her own file");
  assert.equal(await exists(familiarFile("nova", date)), true, "nova writes his own file");
  assert.equal(await exists(legacyFile(date)), false, "attributed writes never touch the legacy file");
  assert.equal((await store.readJournalEntry(date, "astra")).entry.reflection, "Astra's day");
  assert.equal((await store.readJournalEntry(date, "nova")).entry.reflection, "Nova's day");
  assert.equal((await store.readJournalEntry(date, "sage")).exists, false, "a familiar never reads another's entry");
  assert.equal(nova.entry.reflectedBy, "nova");

  let rows = await store.listJournalEntries();
  assert.deepEqual(
    rows.map((r) => [r.date, r.reflectedBy, r.source]),
    [[date, "astra", "familiar"], [date, "nova", "familiar"]],
    "one row per (date, familiar), tie broken by familiar id",
  );
  assert.deepEqual((await store.listJournalEntries("nova")).map((r) => r.reflectedBy), ["nova"], "the list narrows to one familiar");

  // Date-only read: no legacy file → the most recently modified familiar file.
  await utimes(familiarFile("astra", date), new Date("2026-07-26T10:00:00Z"), new Date("2026-07-26T10:00:00Z"));
  await utimes(familiarFile("nova", date), new Date("2026-07-26T12:00:00Z"), new Date("2026-07-26T12:00:00Z"));
  assert.equal((await store.readJournalEntry(date)).entry.reflectedBy, "nova", "date-only read picks the newest familiar file");
  await utimes(familiarFile("nova", date), new Date("2026-07-26T10:00:00Z"), new Date("2026-07-26T10:00:00Z"));
  assert.equal((await store.readJournalEntry(date)).entry.reflectedBy, "astra", "an mtime tie resolves to the lowest familiar id");

  // Deleting one familiar's day leaves the other's intact.
  assert.equal(await store.deleteJournalEntry(date, "astra"), true);
  assert.equal(await exists(familiarFile("astra", date)), false);
  assert.equal(await exists(familiarFile("nova", date)), true, "another familiar's entry survives a scoped delete");

  // A blank attributed write deletes only that familiar's entry.
  await store.writeJournalEntry(date, entry("nova", "   "));
  assert.equal(await exists(familiarFile("nova", date)), false, "a blank reflection deletes instead of writing");

  // ── Legacy files stay readable and are attributed by frontmatter ──────────
  await reset();
  await writeLegacy(date, entry("astra", "Old coven-wide entry"));
  await writeLegacy("2026-07-25", entry(null, "Unattributed entry"));
  assert.equal((await store.readJournalEntry(date, "astra")).source, "legacy", "astra reads her legacy entry");
  assert.equal((await store.readJournalEntry(date, "nova")).exists, false, "nova never reads astra's legacy entry");
  assert.equal((await store.readJournalEntry(date)).entry.reflection, "Old coven-wide entry", "a date-only read prefers the legacy file");
  rows = await store.listJournalEntries();
  assert.deepEqual(rows.map((r) => [r.date, r.reflectedBy, r.source]), [[date, "astra", "legacy"], ["2026-07-25", null, "legacy"]]);
  assert.deepEqual((await store.listJournalEntries("astra")).map((r) => r.date), [date], "legacy rows filter by reflectedBy");
  assert.equal(await exists(legacyFile(date)), true, "reading never migrates a legacy file");

  // The write target for the POST guard: astra's write replaces her legacy file.
  const target = await store.readJournalWriteTarget(date, "astra");
  assert.equal(target.source, "legacy");
  assert.equal((await store.readJournalWriteTarget(date, "nova")).exists, false, "nova's write replaces nothing");
  assert.equal((await store.readJournalWriteTarget("2026-07-25", null)).entry.reflection, "Unattributed entry");

  // Re-saving as the same familiar moves the entry into her own file and
  // removes the legacy duplicate after the write succeeded.
  await store.writeJournalEntry(date, entry("astra", "Edited entry"));
  assert.equal(await exists(familiarFile("astra", date)), true);
  assert.equal(await exists(legacyFile(date)), false, "the same familiar's legacy file is removed after the write");
  // Another familiar's write leaves a foreign legacy file alone.
  await writeLegacy(date, entry("sage", "Sage's legacy entry"));
  await store.writeJournalEntry(date, entry("nova", "Nova's new entry"));
  assert.equal(await exists(legacyFile(date)), true, "a legacy file owned by another familiar is never removed");
  rows = await store.listJournalEntries();
  assert.deepEqual(
    rows.filter((r) => r.date === date).map((r) => r.reflectedBy),
    ["astra", "nova", "sage"],
    "the union lists every familiar's row for the date",
  );

  // A per-familiar file shadows a stale legacy file from the same familiar.
  await writeLegacy(date, entry("astra", "stale legacy copy"));
  rows = await store.listJournalEntries("astra");
  assert.deepEqual(rows.map((r) => [r.date, r.source]), [[date, "familiar"]], "no duplicate row for one familiar");
  assert.equal((await store.readJournalEntry(date, "astra")).entry.reflection, "Edited entry", "the familiar file wins");

  // Unattributed writes keep the legacy behaviour.
  await store.writeJournalEntry("2026-07-24", entry(null, "Hand-written"));
  assert.equal(await exists(legacyFile("2026-07-24")), true, "a null reflectedBy writes the legacy file");

  // Date-only delete removes exactly what the date-only read showed.
  await reset();
  await writeFamiliar("nova", date, entry("nova", "only nova"));
  assert.equal(await store.deleteJournalEntry(date), true);
  assert.equal(await exists(familiarFile("nova", date)), false, "date-only delete removes the resolved familiar file");

  // The directory owns a per-familiar file, whatever its frontmatter claims.
  await writeFamiliar("astra", date, entry("someone-else", "mine"));
  assert.equal((await store.readJournalEntry(date, "astra")).entry.reflectedBy, "astra");
  assert.deepEqual((await store.listJournalEntries()).map((r) => r.reflectedBy), ["astra"]);

  // Strays under familiars/ are ignored rather than breaking the list.
  await writeFile(path.join(journalDir, "familiars", "stray.md"), "x", "utf8");
  await mkdir(path.join(journalDir, "familiars", "..bad"), { recursive: true });
  assert.deepEqual((await store.listJournalEntries()).map((r) => r.reflectedBy), ["astra"]);

  // ensureFamiliarJournalDir creates the automation routine's cwd.
  const dir = await store.ensureFamiliarJournalDir("kitty");
  assert.ok((await readdir(path.join(journalDir, "familiars"))).includes("kitty"));
  assert.equal(dir, path.join(journalDir, "familiars", "kitty"));

  console.log("journal-store.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  await rm(root, { recursive: true, force: true });
}
