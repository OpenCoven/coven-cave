// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// RunActivityStrip: a persistent, compact "what's the agent doing now" strip
// pinned above the transcript, with a dismissible last-run summary after settle.
const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// currentProgress is extracted from ProgressGroup and shared with the strip.
assert.match(src, /function currentProgress\(progress: ProgressEvent\[\]\)/, "currentProgress helper is extracted");
assert.match(src, /const current = currentProgress\(progress\)/, "ProgressGroup reuses currentProgress");

assert.match(src, /function RunActivityStrip\(/, "RunActivityStrip component exists");
assert.match(src, /const live = !!activeTurn/, "strip is live while a turn is pending");
assert.match(src, /const turn = activeTurn \?\? lastTurn/, "falls back to the last settled turn after settle");
assert.match(src, /dismissedId === turn\.id/, "the settled last-run summary is dismissible");
assert.match(src, /toolArgSummary\(runningTool\.name, runningTool\.input\)/, "headline shows the running tool's arg summary");

// Reads live turn data directly (not via segmentTurn) so it works for legacy
// non-segmented turns too.
assert.match(src, /const tools = turn\.tools \?\? \[\]/, "reads turn.tools directly");
assert.match(src, /const progress = turn\.progress \?\? \[\]/, "reads turn.progress directly");

// Mounted above the transcript, fed by the active + last-settled turns.
assert.match(
  src,
  /<RunActivityStrip activeTurn=\{activePendingTurn\} lastTurn=\{lastSettledAssistantTurn\} \/>/,
  "RunActivityStrip is mounted above the transcript",
);

console.log("run-activity-strip.test.ts: ok");
