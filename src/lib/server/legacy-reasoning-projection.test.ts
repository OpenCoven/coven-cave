import assert from "node:assert/strict";
import { projectLegacyAssistantText, LegacyReasoningStreamProjection, projectLegacyToolOffsets } from "./legacy-reasoning-projection.ts";
import type { StreamEvent } from "../stream-events.ts";
import { ReasoningBlockTracker } from "./chat-reasoning-projection.ts";

const source = 'Intro. <thinking>PRIVATE_ONE ` unclosed code <reasoning>PRIVATE_TWO</reasoning></thinking>\nAnswer.\n```xml\n<thinking>literal</thinking>\n```\nKeep `<reasoning>inline</reasoning>`.';
const expected = 'Intro. \nAnswer.\n```xml\n<thinking>literal</thinking>\n```\nKeep `<reasoning>inline</reasoning>`.';
assert.equal(projectLegacyAssistantText(source), expected);
for (let width = 1; width < 25; width++) {
  const projection = new LegacyReasoningStreamProjection();
  const events: StreamEvent[] = [];
  for (let i = 0; i < source.length; i += width) events.push(...projection.project({ kind: "assistant_chunk", text: source.slice(i, i + width) }));
  events.push(...projection.project({ kind: "done" }));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|private/);
  let visible = "";
  for (const event of events) {
    if (event.kind === "assistant_chunk") visible += event.text;
    else if (event.kind === "assistant_replace") visible = event.text;
  }
  assert.equal(visible, expected, `chunk width ${width}`);
}
assert.equal(projectLegacyAssistantText("Before<thinking>PRIVATE_UNCLOSED"), "Before");
assert.equal(projectLegacyAssistantText("Before<ThInKiNg>PRIVATE</tHiNkInG>After"), "BeforeAfter");
assert.equal(projectLegacyAssistantText("<thinking>A<thinking>B</thinking>C</thinking>Answer"), "Answer");
assert.equal(projectLegacyAssistantText("```xml\n<thinking>literal without a closing fence"), "```xml\n<thinking>literal without a closing fence");
assert.equal(projectLegacyAssistantText("  2 <", true), "  2 ");
assert.equal(projectLegacyAssistantText("  2 <"), "  2 <");
assert.equal(projectLegacyAssistantText("Visible <rea", true), "Visible ");
const question = '<coven:approve kind="questions" prompt="Keep ` and <thinking>literal</thinking>?" options="Yes|No" />';
assert.equal(projectLegacyAssistantText(`${question}<thinking>PRIVATE</thinking>Answer`), `${question}Answer`);
assert.equal(projectLegacyAssistantText(`<thinking>PRIVATE \`</thinking>${question}Answer`), `${question}Answer`);
for (let width = 1; width < 25; width++) {
  const projection = new LegacyReasoningStreamProjection();
  const raw = `${question}<thinking>PRIVATE</thinking>Answer`;
  let visible = "";
  for (let i = 0; i < raw.length; i += width) {
    for (const event of projection.project({ kind: "assistant_chunk", text: raw.slice(i, i + width) })) {
      assert.doesNotMatch(JSON.stringify(event), /PRIVATE/);
      if (event.kind === "assistant_chunk") visible += event.text;
      else if (event.kind === "assistant_replace") visible = event.text;
    }
  }
  assert.equal(visible, `${question}Answer`, `question width ${width}`);
}
const replacement = new LegacyReasoningStreamProjection();
replacement.project({ kind: "assistant_chunk", text: "Before<thinking>PRIVATE</thinking>" });
assert.deepEqual(replacement.project({ kind: "assistant_replace", text: "After<thinking>PRIVATE</thinking>!", toolOffsetCorrection: { after: 600, delta: 800 } }), [
  { kind: "assistant_replace", text: "After!" },
]);
assert.deepEqual(projectLegacyToolOffsets([{ textOffset: source.indexOf("Answer") }], source), [{ textOffset: "Intro. \n".length }]);
const reasoning = new ReasoningBlockTracker(() => ({ runId: "11111111-2222-4333-8444-555555555555", harness: "hermes", version: null, protocol: "hermes-responses-v1", nextSequence: () => 4 }), "22222222-2222-4333-8444-555555555555");
const block = reasoning.observe("summary", "complete", "Display summary.", "provider-summary", "runtime-report", undefined, source.indexOf("Answer"))!;
const orderedProjection = new LegacyReasoningStreamProjection();
orderedProjection.project({ kind: "assistant_chunk", text: source });
const projected = orderedProjection.project({ kind: "reasoning", block });
assert.deepEqual(projected, [{ kind: "reasoning", block: { ...block, textOffset: "Intro. \n".length } }],
  "reasoning anchors are rebased before SSE and replay retention; private text length does not leak");
assert.equal(block.textOffset, source.indexOf("Answer"), "display projection does not mutate the private tracker");
const interrupted = new LegacyReasoningStreamProjection();
assert.deepEqual(interrupted.project({ kind: "assistant_chunk", text: "<think" }), []);
assert.deepEqual(interrupted.project({ kind: "done", isError: true }), [{ kind: "done", isError: true }]);
const cancelled = new LegacyReasoningStreamProjection();
cancelled.project({ kind: "assistant_chunk", text: "Safe <think" });
cancelled.interrupt();
assert.deepEqual(cancelled.project({ kind: "done", isError: false }), [{ kind: "done", isError: false }], "a stop request does not release a pending tag or invent an error");
console.log("legacy-reasoning-projection: passed");
