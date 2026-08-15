// @ts-nocheck
// Guards on the Grimoire graph scan bounds (cave-ed4s3).
//
// The module is read as SOURCE TEXT rather than imported: it pulls in
// knowledge-vault / memory-file-inventory / journal-store through extensionless
// specifiers that only Next's resolver understands, so `node --test` cannot
// load it. The constants below are the whole point of the file, and they are
// plain exported literals, so text is enough to pin them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scan = readFileSync(new URL("./grimoire-graph-scan.ts", import.meta.url), "utf8");

const capMatch = scan.match(/export const MEMORY_SCAN_CAP = (\d+);/);
assert.ok(capMatch, "MEMORY_SCAN_CAP is a plain exported literal");
const cap = Number(capMatch[1]);

// ── The cap has a RENDER ceiling, not just an I/O one ────────────────────────
// This is the trap the constant exists to avoid, and the reason it carries a
// measurement table. The file's own cost model talks only about read time, and
// on read time alone you would happily scan the entire corpus: bounded 32KB
// reads of all 3393 files measured ~1.4s total, cached after the first pass.
//
// But the graph view ticks lib/grimoire-force.ts ~148 times to settle, and its
// repulsion is symmetric O(n²). Measured 2026-08-08:
//
//   cap 400 -> 1.3ms/tick (0.19s settle)      cap 2000 -> 12.8ms (1.89s)
//   cap 1200 -> 4.4ms/tick (0.65s settle)     cap 3393 -> 36.6ms (5.42s)
//
// At 2000 the simulation alone eats 77% of a 60fps frame before anything is
// drawn, on a fast machine, and re-pays it on every reheat. So this asserts a
// band: low enough that the renderer keeps its headroom, high enough that the
// scoped-coverage regression this bead fixed cannot be silently reverted.
assert.ok(
  cap >= 1000,
  `MEMORY_SCAN_CAP is ${cap}; below 1000 a scoped familiar sees so little of their own memory that the Relations view stops being about them (cave-ed4s3)`,
);
assert.ok(
  cap <= 1500,
  `MEMORY_SCAN_CAP is ${cap}, above the measured render ceiling. Raising it is a RENDERER change first — make grimoire-force repulsion Barnes-Hut, or bound node count independently of the scan — not an I/O judgement call (cave-ed4s3)`,
);

// The rationale must survive with the number. A bare constant invites the next
// raise on read-time evidence, which is exactly how this got to a state where
// a scoped view showed 35 of a familiar's 260 files.
assert.match(
  scan,
  /O\(n²\)/,
  "the cap documents the O(n²) renderer constraint that actually bounds it",
);
// cave-z6xvd inverted this: the cap is applied AFTER the scope now, so the doc
// must say so. The previous pin asserted the OPPOSITE ordering, which is how
// this test earns its keep — a change to the ordering cannot land while the
// comment still promises the old one.
assert.match(
  scan,
  /applied AFTER the familiar scope/,
  "the cap documents that the scope precedes it, which is what makes a scoped view complete",
);
assert.match(
  scan,
  /familiarInScope\(familiarScope, m\.familiarId\)/,
  "the memory set is scoped BEFORE it is truncated, not after",
);

// ── Bounds are reported, never silently applied ──────────────────────────────
// Every consumer's honesty depends on this: the graph view reconciles its
// scoped shortfall against `meta.memory`, so dropping either field would leave
// the notice unable to say what was left out.
assert.match(
  scan,
  /scanned: memoryScanSet\.length,[\s\S]{0,80}total: memoryMarkdown\.length/,
  "meta reports both the scanned count and the true total for memory",
);
// Both counts are scope-relative once a scope is supplied, so the notice must be
// able to tell which reading it holds rather than inferring it from the numbers.
assert.match(
  scan,
  /scoped: familiarScope\.size > 0/,
  "meta says whether its memory counts are scope-relative",
);
assert.match(
  scan,
  /journal: \{ scanned: journalScanSet\.length, total: journalDays\.length \}/,
  "meta reports both the scanned count and the true total for journal",
);

// The resolution index deliberately spans the WHOLE corpus, scanned or not, so
// a [[link]] into an unscanned file still resolves and lands as a leaf node.
// Truncating this too would turn every out-of-window link into a dropped edge —
// silently shrinking the graph rather than bounding the read.
assert.match(
  scan,
  /memory: memoryEntries\.map\(\(m\) => \(\{ path: m\.fullPath \}\)\)/,
  "the wiki index covers every memory file, not just the scanned window",
);

console.log("grimoire-graph-scan.test.ts: ok");
