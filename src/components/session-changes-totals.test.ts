// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const p = readFileSync(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");
assert.match(p, /const totalInsertions = listCut \? listCut\.insertions : files\.reduce\(\(sum, f\) => sum \+ \(f\.insertions \?\? 0\), 0\)/, "aggregate insertions, the whole tree's when the list is cut (#5807)");
assert.match(p, /const totalDeletions = listCut \? listCut\.deletions : files\.reduce\(\(sum, f\) => sum \+ \(f\.deletions \?\? 0\), 0\)/, "aggregate deletions, the whole tree's when the list is cut (#5807)");
assert.match(p, /totalInsertions \+ totalDeletions > 0/, "aggregate shown only when non-empty");
assert.match(p, /text-\[var\(--accent-presence\)\]">\+\{totalInsertions\}/, "total + colored accent");
assert.match(p, /text-\[var\(--color-danger\)\]">−\{totalDeletions\}/, "total − colored danger");
// A cut list (#5807): the count is every changed file, the panel says how many
// it isn't showing, and Commit is off because the list can't name them all.
assert.match(p, /\{listCut \? listCut\.total : files\.length\}/, "the count badge counts every changed file");
assert.match(p, /const canCommit = loaded && !notARepo && !error && files\.length > 0 && !listCut;/, "a cut list can't be committed");
assert.match(p, /if \(!message \|\| listCut \|\| changesOutbound\.get\(outboundKey\)\.pending\) return;/, "nor through the keyboard shortcut");
assert.match(p, /data-testid="changes-list-cut"[\s\S]{0,600}Showing the first \{files\.length\.toLocaleString\(\)\} of \{listCut\.total\.toLocaleString\(\)\} changed files\./, "the panel says how many it shows");
assert.match(p, /\{\(listCut\.total - files\.length\)\.toLocaleString\(\)\} aren&rsquo;t listed, so Commit is off\./, "and how many it leaves out, and why Commit is off");
// A commit found landed late is pinned to its commit when HEAD is it (#5807).
assert.match(p, /timedOutCommitLanded\(timedOutCommit, \{ branch, files, head: headOid, headSubject \}\)/, "the list's head is offered to the landed check");
assert.match(p, /headOid: landed\.headOid,/, "Create PR is pinned to the landed commit");
console.log("session-changes-totals.test.ts passed");
