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

// #5637: opening a mature chat is not the thread reaching its checkpoint.
{
  const { advanceReviewCheckpoint } = await import("./thread-self-report.ts");
  type Checkpoint = import("./thread-self-report.ts").ReviewCheckpoint;
  const step = (previous: Checkpoint, sessionId: string | null, eligible: boolean, historyPainted = true) =>
    advanceReviewCheckpoint(previous, { sessionId, eligible, historyPainted });
  const start: Checkpoint = { sessionId: null, eligible: null };

  // Open an eligible chat: the switch run sees the previous thread's values,
  // then loading, then the painted history. Nothing is reached.
  let r = step(start, "a", false, true);
  assert.equal(r.reached, false, "the switch run never takes a baseline");
  r = step(r.next, "a", false, false);
  assert.equal(r.reached, false, "history still loading");
  r = step(r.next, "a", true, true);
  assert.equal(r.reached, false, "the first painted view is the baseline, even when eligible");
  assert.deepEqual(r.next, { sessionId: "a", eligible: true });
  r = step(r.next, "a", true, true);
  assert.equal(r.reached, false);

  // A live thread that crosses its checkpoint after the baseline is reviewed.
  let live = step(start, "b", false, true);
  live = step(live.next, "b", false, true);
  assert.equal(live.reached, false, "baseline: not yet eligible");
  live = step(live.next, "b", true, true);
  assert.equal(live.reached, true, "the checkpoint reached while watching");

  // Switching threads resets the baseline instead of comparing across them.
  const switched = step({ sessionId: "b", eligible: false }, "c", true, true);
  assert.equal(switched.reached, false);
  assert.deepEqual(switched.next, { sessionId: "c", eligible: null });
}
