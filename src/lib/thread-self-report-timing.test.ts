import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as selfReport from "./thread-self-report.ts";

const shouldAutoReviewThread = selfReport.shouldAutoReviewThread as
  | ((input: {
      settledAssistantTurns: number;
      terminal: boolean;
      busy: boolean;
    }) => boolean)
  | undefined;

assert.equal(typeof shouldAutoReviewThread, "function", "thread review exposes one timing decision");

if (shouldAutoReviewThread) {
  assert.equal(
    shouldAutoReviewThread({ settledAssistantTurns: 1, terminal: true, busy: false }),
    false,
    "one-shot threads do not produce noisy self-reports",
  );
  assert.equal(
    shouldAutoReviewThread({ settledAssistantTurns: 2, terminal: true, busy: false }),
    true,
    "a terminal thread is reviewed once it has enough exchange evidence",
  );
  assert.equal(
    shouldAutoReviewThread({ settledAssistantTurns: 7, terminal: false, busy: false }),
    false,
    "an open thread waits through its first title checkpoint",
  );
  assert.equal(
    shouldAutoReviewThread({ settledAssistantTurns: 8, terminal: false, busy: false }),
    true,
    "a mature open thread is reviewed after two four-turn title checkpoints",
  );
  assert.equal(
    shouldAutoReviewThread({ settledAssistantTurns: 8, terminal: false, busy: true }),
    false,
    "reviews never start while a response is still running",
  );
}

const chatView = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
assert.match(
  chatView,
  /shouldAutoReviewThread\(\{[\s\S]*settledAssistantTurns[\s\S]*terminal[\s\S]*busy/,
  "ChatView delegates auto-review timing to the audited policy",
);

console.log("thread-self-report-timing.test.ts: ok");
