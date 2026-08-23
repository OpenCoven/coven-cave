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
// cave-v8hh: the request goes through the shared changes-summary gate so the
// chip + header + rail badge + panel cost one request per root per 5s window.
assert.match(
  src,
  /fetchChangesSummary\(projectRoot, opts\)/,
  "fetches through the shared changes-summary gate (no private fetch)",
);
assert.doesNotMatch(src, /fetch\(`\/api\/changes/, "no direct /api/changes fetch remains");
assert.match(
  src,
  /void load\(\{ force: true \}\)/,
  "reload() forces through the gate so a post-mutation refresh never reuses a cached response",
);
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
// cave-68vv: the Environment panel's `+N −N` totals ride the SAME summary
// response — summed by the pure model helper, not a second fetch.
assert.match(src, /setTotals\(sumFileTotals\(json\.files\)\)/, "diff totals summed from the shared summary response");
assert.match(src, /totals, loaded, notARepo, branch, worktree, reload/, "totals exposed alongside the existing summary fields");

console.log("use-changes-summary.test.ts: ok");
