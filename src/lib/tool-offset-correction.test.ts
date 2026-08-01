// @ts-nocheck
import assert from "node:assert/strict";
import { ToolCallTracker } from "./chat-tool-events.ts";
import { rebaseToolTextOffsets } from "./tool-offset-correction.ts";

const inserted = [
  { id: "before", textOffset: 4 },
  { id: "at-boundary", textOffset: 5 },
  { id: "missing" },
];
assert.deepEqual(
  rebaseToolTextOffsets(inserted, { after: 5, delta: 3 }),
  [
    { id: "before", textOffset: 4 },
    { id: "at-boundary", textOffset: 8 },
    { id: "missing" },
  ],
  "a positive insertion shifts only finite offsets at or after the correction boundary",
);

const shortened = [
  { id: "before", textOffset: 6 },
  { id: "at-boundary", textOffset: 7 },
  { id: "after", textOffset: 12 },
  { id: "missing" },
  { id: "non-finite", textOffset: Number.NaN },
];
assert.deepEqual(
  rebaseToolTextOffsets(shortened, { after: 7, delta: -100 }),
  [
    { id: "before", textOffset: 6 },
    { id: "at-boundary", textOffset: 7 },
    { id: "after", textOffset: 7 },
    { id: "missing" },
    { id: "non-finite", textOffset: Number.NaN },
  ],
  "shortening clamps corrected suffix tools while leaving earlier, missing, and non-finite offsets unchanged",
);

const unchanged = [{ id: "same", textOffset: 9 }];
assert.equal(
  rebaseToolTextOffsets(unchanged, undefined),
  unchanged,
  "an omitted correction preserves the original tool list",
);

const tracker = new ToolCallTracker(() => 1_000);
tracker.envelopeToolUse("before", "read", undefined, 6);
tracker.envelopeToolUse("after", "write", undefined, 15);
tracker.rebaseTextOffsets(7, -8);
const liveTools = rebaseToolTextOffsets(
  [
    { id: "before", textOffset: 6 },
    { id: "after", textOffset: 15 },
  ],
  { after: 7, delta: -8 },
);
assert.deepEqual(
  liveTools?.map((tool) => tool.textOffset),
  tracker.snapshot().map((tool) => tool.textOffset),
  "persisted tracker and live client rebasing produce the same offsets",
);

console.log("tool-offset-correction.test.ts: ok");
