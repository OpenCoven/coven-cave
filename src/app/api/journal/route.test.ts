// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

// ── Optimistic-concurrency guard (cave-9f2e) ─────────────────────────────────
// Each (date, familiar) entry is one file and two surfaces write it (Grimoire
// autosave + the generate/edit flow). Without a conflict check the second writer
// silently drops the first. POST accepts an opt-in `expectedModified` baseline
// and 409s when the file changed underneath, mirroring the memory-file
// convention. The baseline is compared against the SAME file the write replaces
// — the reflectedBy familiar's entry — so another familiar's entry for the date
// can never trip (or be clobbered by) the guard.
assert.match(
  source,
  /const expectedModified = typeof body\.expectedModified === "string" \? body\.expectedModified : null;/,
  "POST reads an opt-in expectedModified baseline",
);
assert.match(
  source,
  /const current = await readJournalWriteTarget\(date, reflectedBy\);/,
  "POST reads the (date, familiar) entry it replaces once to drive the guard + generatedAt preservation",
);
assert.match(
  source,
  /if \(expectedModified !== null && current\.exists && current\.modified !== expectedModified\)/,
  "POST 409s only when a baseline was sent and the entry changed on disk",
);
assert.match(
  source,
  /\{ status: 409 \}/,
  "a journal write conflict returns 409 (not a silent overwrite)",
);
assert.match(source, /conflict: true/, "the 409 body flags the conflict so the UI can reload");

// ── next-paths never persists as journal content (cave-onp8) ─────────────────
// A compliant familiar echoes the <coven:next-paths> chat directive back; the
// journal has no chip row, so the block must be stripped at the persistence
// boundary no matter which client wrote it.
assert.match(
  source,
  /import \{ extractNextPaths \} from "@\/lib\/next-paths";/,
  "the route uses the canonical next-paths extractor",
);
assert.match(
  source,
  /typeof body\.reflection === "string" \? extractNextPaths\(body\.reflection\)\.visible : ""/,
  "POST strips the next-paths directive block before storing the reflection",
);

// ── generatedAt is preserved on manual saves, only stamped on generation ─────
// The route used to stamp generatedAt: new Date() on EVERY save, so a hand-edit
// read as a fresh generation ("· 2m ago"). Only the generate flow sends a
// generatedAt now; manual saves preserve the existing stamp (or null when new).
assert.doesNotMatch(
  source,
  /generatedAt: new Date\(\)\.toISOString\(\)/,
  "the route must not restamp generatedAt to now on every save",
);
assert.match(
  source,
  /typeof body\.generatedAt === "string"\s*\n?\s*\? body\.generatedAt\s*\n?\s*: current\.exists\s*\n?\s*\? current\.entry\.generatedAt\s*\n?\s*: null/,
  "generatedAt uses the body's value (generation) else preserves the on-disk stamp else null",
);

// ── The stats block reports the day's sources ("Memories Prototype") ─────────
// The entry pane's Sources chips need the memory files touched on that local
// day; the inventory is already in hand for the stats, so the same response
// carries the attributed file list (familiar-scoped like the stats).
assert.match(
  source,
  /journalDaySources,?\s*\n?\} from "@\/lib\/journal-memory-stats";/,
  "the route imports the day-source attribution helper",
);
assert.match(
  source,
  /const sources = journalDaySources\(memoryEntries, date, familiarId\);/,
  "sources are computed from the same inventory + familiar scope as the stats",
);
assert.match(
  source,
  /\{ ok: true, date, stats, context, sources \}/,
  "the ?stats=1 response carries the day's sources",
);

// ── Per-familiar storage (one entry per familiar per day) ────────────────────
// Two familiars journaling the same day used to overwrite one coven-wide file.
// Reads, lists, and deletes are now familiar-scoped in the store; the route
// passes the familiar through instead of post-filtering a coven-wide record.
assert.match(
  source,
  /const record = await readJournalEntry\(date, familiarId\);/,
  "a familiar-scoped day read resolves that familiar's own entry in the store",
);
assert.doesNotMatch(
  source,
  /rawRecord\.entry\.reflectedBy !== familiarId/,
  "the route no longer hides a coven-wide record after reading it",
);
assert.match(
  source,
  /const days = await listJournalEntries\(familiarId\);/,
  "the day list narrows to a familiar in the store (rows keyed by date + familiar)",
);
assert.match(
  source,
  /const familiar = searchParams\.get\("familiar"\) \|\| null;\s*\n\s*if \(familiar !== null && !isJournalFamiliarId\(familiar\)\)/,
  "DELETE accepts an optional familiar, validated by the shared slug guard",
);
assert.match(
  source,
  /const deleted = await deleteJournalEntry\(date, familiar\);/,
  "DELETE removes only that familiar's entry when one is named",
);
assert.match(source, /\{ ok: true, date, familiar, deleted \}/, "DELETE echoes the familiar it acted on");
assert.match(
  source,
  /~\/\.coven\/journal\/familiars\/<id>\/<date>\.md/,
  "the route doc names the per-familiar layout",
);

console.log("journal route.test.ts: ok");
