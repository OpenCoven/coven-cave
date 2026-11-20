import assert from "node:assert/strict";
import test from "node:test";
import {
  REFLECTION_PROMPT_PREFIX,
  classifyReply,
  isReflectionRun,
  pairedReply,
  planReply,
  ratePercent,
  tallyRuns,
} from "./reflection-replay.mjs";

const prompt = { role: "user", text: `${REFLECTION_PROMPT_PREFIX} s1), oldest to newest:\n\n...` };
const good = '{"overallConfidence": 80, "overallConfidenceReason": "ok"}';
const run = (turns, extra = {}) => ({ origin: "enhance", createdAt: "2026-10-10T00:00:00Z", turns: [prompt, ...turns], ...extra });

test("only conversations opened by the reflection prompt are runs", () => {
  assert.equal(isReflectionRun(run([])), true);
  assert.equal(isReflectionRun({ turns: [{ role: "user", text: "hello" }] }), false);
  assert.equal(isReflectionRun({ turns: [] }), false);
});

test("the paired selector takes the first reply before any follow-up; the plan selector takes the last", () => {
  const conversation = run([
    { role: "assistant", text: good },
    { role: "user", text: "and again?" },
    { role: "assistant", text: "no json this time" },
  ]);
  assert.equal(pairedReply(conversation), good);
  assert.equal(planReply(conversation), "no json this time");
  assert.equal(pairedReply(run([{ role: "user", text: "follow-up first" }, { role: "assistant", text: good }])), null);
});

test("each reply is classified without returning its text", () => {
  assert.equal(classifyReply(null), "no-reply");
  assert.equal(classifyReply(good), "pass");
  assert.equal(classifyReply("```json\n" + good + "\n```"), "pass");
  assert.equal(classifyReply("I can't reflect on that."), "no-object");
  assert.equal(classifyReply('{"overallConfidence": 80, "reason": "unclosed'), "invalid-object");
});

test("every run counts in the all corpus; the replied corpus keeps hidden runs that replied", () => {
  const conversations = [
    run([{ role: "assistant", text: good }]),
    run([{ role: "assistant", text: "prose only" }]),
    run([]),
    run([{ role: "assistant", text: good }], { origin: undefined }),
    run([{ role: "assistant", text: good }], { createdAt: "2026-11-01T00:00:00Z" }),
    { turns: [{ role: "user", text: "ordinary chat" }, { role: "assistant", text: good }] },
    null,
  ];
  const all = tallyRuns(conversations);
  assert.equal(all.runs, 5, "a run with no reply still counts");
  assert.equal(all.unreadable, 1);
  assert.deepEqual(all.paired, { pass: 3, "no-reply": 1, "no-object": 1, "invalid-object": 0 });
  const replied = tallyRuns(conversations, { corpus: "replied" });
  assert.equal(replied.runs, 3, "no-reply and origin-less runs are outside the replied corpus");
  assert.equal(tallyRuns(conversations, { corpus: "replied", until: "2026-10-17" }).runs, 2, "--until drops later runs");
});

test("the rate rounds down, so a near miss never reads as the gate", () => {
  assert.equal(ratePercent(890, 899), "98.998");
  assert.equal(ratePercent(1000, 1010), "99.009");
  assert.equal(ratePercent(99, 100), "99.000");
  assert.equal(ratePercent(0, 0), "0.000");
});
