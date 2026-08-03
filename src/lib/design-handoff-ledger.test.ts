// The Claude Design ledger (docs/design-handoff/IMPLEMENTATION-STATUS.md) is
// the answer to "which design frames have we built?". A ledger nobody checks
// rots into a list of paths that no longer exist, which is worse than no
// ledger — it reads authoritative while being wrong.
//
// This gate pins the half a test CAN check: the repo side. Every source path
// and every commit SHA the doc cites must resolve, and the doc must keep
// naming the live MCP as its source of truth (an audit driven off the stale
// zips in ~/Downloads under-reports the corpus — see the doc's own preamble).
//
// It deliberately does NOT try to verify the live project list: that needs
// network + OAuth, and a test that silently skips is a test that lies.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const LEDGER = "docs/design-handoff/IMPLEMENTATION-STATUS.md";
const doc = readFileSync(path.join(root, LEDGER), "utf8");

// ── the doc must keep pointing at the live source of truth ──────────────────

assert.match(
  doc,
  /mcp__claude-design__list_projects/,
  "the ledger must name the live MCP call that regenerates it",
);
assert.match(
  doc,
  /stale snapshots/i,
  "the ledger must keep the warning that ~/Downloads zips under-report the corpus",
);
assert.match(doc, /^## Landed$/m, "the ledger keeps a Landed section");
assert.match(doc, /^## Outstanding$/m, "the ledger keeps an Outstanding section");
assert.match(
  doc,
  /^### Not deliverables$/m,
  "the ledger separates specs and explorations from real outstanding work",
);

// ── every cited source path must exist ──────────────────────────────────────

// Backticked paths that look like repo files (contain a slash and a known
// extension, or are a known directory root). Frame names end in .dc.html and
// live in Claude Design, not here — those are excluded.
const cited = new Set(
  [...doc.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1])
    .filter((token) => !token.endsWith(".dc.html"))
    .filter((token) => /^(src|scripts|apps|docs)\//.test(token)),
);

assert.ok(cited.size >= 4, `expected the ledger to cite repo paths, found ${cited.size}`);
for (const rel of cited) {
  assert.ok(existsSync(path.join(root, rel)), `${LEDGER} cites a path that no longer exists: ${rel}`);
}

// Bare component filenames the doc names as evidence (e.g. `citation.tsx`).
// Resolve them anywhere under src/ rather than pinning a directory, so a file
// move updates the ledger's meaning without breaking the gate.
const bareFiles = new Set(
  [...doc.matchAll(/`([a-z0-9-]+\.(?:tsx|ts|mjs))`/g)].map((m) => m[1]),
);
if (bareFiles.size > 0) {
  const tracked = execFileSync("git", ["ls-files", "src", "scripts", "apps"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).split("\n");
  const basenames = new Set(tracked.map((file) => path.basename(file)));
  for (const file of bareFiles) {
    assert.ok(basenames.has(file), `${LEDGER} names a file that no longer exists: ${file}`);
  }
}

// ── every cited commit must resolve ─────────────────────────────────────────

// A ledger row's whole value is that you can go read the change it points at.
// Shallow clones can't resolve history, so this asserts only when the object
// is reachable at all — but a WRONG sha (never in this repo) still fails.
const shas = new Set([...doc.matchAll(/\|\s*`([0-9a-f]{10})`/g)].map((m) => m[1]));
assert.ok(shas.size >= 10, `expected the ledger to cite landing commits, found ${shas.size}`);
let resolvable = 0;
for (const sha of shas) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    resolvable += 1;
  } catch {
    // Unreachable here: either a shallow clone, or a bad sha. Distinguished below.
  }
}
// If ANY resolve, history is present — so the ones that didn't are wrong.
if (resolvable > 0) {
  assert.equal(
    resolvable,
    shas.size,
    `${LEDGER} cites ${shas.size - resolvable} commit(s) this repo has never seen`,
  );
}

console.log(
  `design-handoff-ledger.test.ts OK (${cited.size} paths, ${bareFiles.size} files, ${shas.size} commits${resolvable === 0 ? " — shallow clone, commits unchecked" : ""})`,
);
