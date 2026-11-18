// @ts-nocheck
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Every address-bar write in app source goes through src/lib/history-url.ts
// (#6442). A direct `history.replaceState(null, …)` in a mount effect runs
// before Next wraps history and erases the markers Next needs to restore the
// entry, so browser Back leaves the previous page on screen.

const ROOT = path.resolve("src");
const HELPER = "src/lib/history-url.ts";
// The sidecar auth bridge is an inline <script> string that runs before Next
// hydrates, so it cannot import the helper. It already passes
// `window.history.state`, and Next writes its own entry state afterwards.
const EXEMPT = new Map([["src/components/security/sidecar-auth-bridge.tsx", 1]]);
const WRITE = /\b(?:replaceState|pushState)\s*\(/g;
const NULL_WRITE = /\b(?:replaceState|pushState)\s*\(\s*null\b/;

const entries = await readdir(ROOT, { recursive: true, withFileTypes: true });
const offenders = [];
const exemptCounts = new Map();
let scanned = 0;
for (const entry of entries) {
  if (!entry.isFile() || !/\.(?:ts|tsx|mts|js|jsx|mjs)$/.test(entry.name)) continue;
  if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) continue;
  const file = path.relative(process.cwd(), path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join("/");
  if (file === HELPER) continue;
  scanned++;
  const source = await readFile(file, "utf8");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    const writes = line.match(WRITE)?.length ?? 0;
    if (!writes) return;
    if (EXEMPT.has(file)) {
      assert.doesNotMatch(line, NULL_WRITE, `${file}:${index + 1} must not write a null history state`);
      exemptCounts.set(file, (exemptCounts.get(file) ?? 0) + writes);
      return;
    }
    offenders.push(`${file}:${index + 1}: ${trimmed}`);
  });
}

assert.ok(scanned > 500, `expected to scan the app source tree, scanned ${scanned} files`);
assert.deepEqual(
  offenders,
  [],
  `history writes must use replaceHistoryUrl/pushHistoryUrl from ${HELPER} (#6442):\n${offenders.join("\n")}`,
);
for (const [file, expected] of EXEMPT) {
  assert.equal(exemptCounts.get(file) ?? 0, expected, `${file} keeps exactly its recorded history write; update the exemption deliberately`);
}

// The helper itself never writes a null state (its doc comment may quote one).
const helperCode = (await readFile(HELPER, "utf8"))
  .split("\n")
  .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
  .join("\n");
assert.match(helperCode, /history\.replaceState\(/, "the helper still owns the replace write");
assert.doesNotMatch(helperCode, NULL_WRITE, "the history helper never writes a null state");

console.log(`history-url sites: ${scanned} source files route history writes through ${HELPER}`);
