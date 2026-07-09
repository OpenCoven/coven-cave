// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

// ── Optimistic-concurrency guard (cave-9f2e) ─────────────────────────────────
// The journal is one file per date and two surfaces write it (Grimoire autosave
// + the generate/edit flow). Without a conflict check the second writer silently
// drops the first. POST accepts an opt-in `expectedModified` baseline and 409s
// when the file changed underneath, mirroring the memory-file convention.
assert.match(
  source,
  /const expectedModified = typeof body\.expectedModified === "string" \? body\.expectedModified : null;/,
  "POST reads an opt-in expectedModified baseline",
);
assert.match(
  source,
  /const current = await readJournalEntry\(date\);/,
  "POST reads the current entry once to drive the guard + generatedAt preservation",
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

console.log("journal route.test.ts: ok");
