import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// useChangesSummary is the lightweight "are there uncommitted edits?" signal
// that drives the Code surface's diff-first auto-switch. It must mirror
// SessionChangesInner's poll discipline and never double-poll.
const src = readFileSync(new URL("./use-changes-summary.ts", import.meta.url), "utf8");

assert.match(src, /POLL_MS = 5000/, "5s interval matches SessionChangesInner");
assert.match(
  src,
  /if \(!active \|\| !projectRoot\) return/,
  "gated on active + projectRoot so it pauses once the full panel takes over polling",
);
assert.match(src, /document\.visibilityState !== "visible"/, "skips work while the document is hidden");
assert.match(src, /inFlight\.current/, "single-flight guard prevents overlapping requests");
assert.match(src, /`\/api\/changes\?projectRoot=\$\{encodeURIComponent\(projectRoot\)\}`/, "hits /api/changes for the root");
assert.doesNotMatch(src, /&path=/, "summary request omits a file path — it only needs the count");
// cave-e794: the recurring poll + on-return refresh go through the shared
// usePausablePoll hook instead of a hand-rolled interval + visibility trio.
assert.match(
  src,
  /usePausablePoll\(\(\) => void load\(\), POLL_MS, \{ enabled: active && Boolean\(projectRoot\) \}\)/,
  "polls through usePausablePoll (hidden pause + on-return refresh centralized)",
);
assert.doesNotMatch(src, /setInterval\(/, "no hand-rolled interval remains");
assert.doesNotMatch(src, /addEventListener\("visibilitychange"/, "no hand-rolled visibility listener remains");
assert.match(
  src,
  /generation\.current !== gen\) return;/,
  "a stale in-flight response for a previous root can't write into the new root's state",
);
assert.match(src, /Array\.isArray\(json\.files\) \? json\.files\.length : 0/, "count is the changed-file list length");

console.log("use-changes-summary.test.ts: ok");
