import assert from "node:assert/strict";

import {
  hasMeaningfulAssistantOutput,
  shouldUseEmptySuccessfulFallback,
} from "./chat-assistant-output.ts";

assert.equal(
  hasMeaningfulAssistantOutput({ visibleProse: "Visible prose" }),
  true,
  "visible prose remains meaningful output",
);

for (const [label, input] of [
  ["rich blocks", { visibleProse: "", hasRichBlocks: true }],
  ["results", { visibleProse: "", resultCount: 1 }],
  ["attachments", { visibleProse: "", attachmentCount: 1 }],
  ["skill status", { visibleProse: "", skillUpdateCount: 1 }],
  ["auto status", { visibleProse: "", hasAutoStatusUpdate: true }],
  ["edit cards", { visibleProse: "", editCardCount: 1 }],
  ["follow-up cards", { visibleProse: "", followUpCount: 1 }],
  ["attention request", { visibleProse: "", hasAttentionRequest: true }],
] as const) {
  assert.equal(
    hasMeaningfulAssistantOutput(input),
    true,
    `${label} should count as meaningful assistant output even without prose`,
  );
  assert.equal(
    shouldUseEmptySuccessfulFallback({ emptySuccessful: true, ...input }),
    false,
    `${label} should suppress the empty-success fallback`,
  );
}

assert.equal(
  hasMeaningfulAssistantOutput({ visibleProse: "   " }),
  false,
  "blank prose with no structured output remains empty",
);
assert.equal(
  shouldUseEmptySuccessfulFallback({ emptySuccessful: true, visibleProse: "   " }),
  true,
  "a truly empty successful turn still uses the explicit fallback",
);
assert.equal(
  shouldUseEmptySuccessfulFallback({ emptySuccessful: false, visibleProse: "   " }),
  false,
  "non-empty-success states never route through the fallback guard",
);

console.log("chat-assistant-output.test.ts: ok");
