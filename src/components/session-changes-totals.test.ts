// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const p = readFileSync(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");
assert.match(p, /const totalInsertions = files\.reduce\(\(sum, f\) => sum \+ \(f\.insertions \?\? 0\), 0\)/, "aggregate insertions");
assert.match(p, /const totalDeletions = files\.reduce\(\(sum, f\) => sum \+ \(f\.deletions \?\? 0\), 0\)/, "aggregate deletions");
assert.match(p, /totalInsertions \+ totalDeletions > 0/, "aggregate shown only when non-empty");
assert.match(p, /text-\[var\(--accent-presence\)\]">\+\{totalInsertions\}/, "total + colored accent");
assert.match(p, /text-\[var\(--color-danger\)\]">−\{totalDeletions\}/, "total − colored danger");
console.log("session-changes-totals.test.ts passed");
