import assert from "node:assert/strict";
import { chatActivityTimeline } from "./chat-activity-timeline.ts";
import { ToolCallTracker } from "./chat-tool-events.ts";
import { ReasoningBlockTracker } from "./server/chat-reasoning-projection.ts";
import { sliceImageBlocks } from "./image-blocks.ts";
import { sliceApproveBlocks } from "./approve-blocks.ts";
import { readFileSync } from "node:fs";
import type { ToolEvent } from "./chat-turn-state.ts";
import type { ChatReasoningBlock } from "./chat-reasoning-blocks.ts";
import { unwrapPreviewShell } from "./markdown-preview-shell.ts";

function fixture(offset: number) {
  let sequence = 0;
  const context = { runId: "11111111-2222-4333-8444-555555555555", harness: "hermes", version: null, protocol: null, nextSequence: () => sequence++ };
  const tools = new ToolCallTracker(() => 100, "", context);
  const summaries = new ReasoningBlockTracker(() => context, tools.attemptId, () => 100);
  const before = summaries.observe("before", "complete", "Inspect.", "provider-summary", "runtime-report", undefined, 0)!;
  const call = tools.envelopeToolUse("read", "read_file", "marker.txt", offset)!;
  const after = summaries.observe("after", "complete", "Done.", "provider-summary", "runtime-report", undefined, offset)!;
  return { before, after, call, tools, summaries };
}
const prefix = "Inspecting 🧙 café.\n";
const text = prefix + "Final answer.\n";
const f = fixture(prefix.length);
const timeline = chatActivityTimeline(text, f.tools.snapshot(), [f.after, f.before])!;
assert.deepEqual(timeline.map((entry) => entry.kind), ["reasoning", "text", "tool", "reasoning", "text"]);
assert.deepEqual(timeline.filter((entry) => entry.kind === "text").map((entry) => entry.text), [prefix, "Final answer.\n"]);
const keys = timeline.filter((entry) => entry.kind !== "text").map((entry) => entry.key);
f.tools.envelopeToolResult("read", "safe output", false);
assert.deepEqual(chatActivityTimeline(text + "More.\n", f.tools.snapshot(), [f.before, f.after])!.filter((entry) => entry.kind !== "text").map((entry) => entry.key), keys);
assert.equal(chatActivityTimeline(text, [{ ...f.tools.snapshot()[0]!, textOffset: undefined }], [f.before]), null, "legacy offsets are not invented");
assert.equal(chatActivityTimeline(text, f.tools.snapshot(), [{ ...f.before, observation: { ...f.before.observation, sequence: 1 } }]), null, "conflicting sequence is not sorted into false chronology");

for (const atomic of [
  '```ts\nconst value = 1;\n\nconst next = 2;\n```',
  '<coven:approve kind="questions" prompt="Read `code`\n\nthen choose?" options="Yes|No" />',
  '<coven:proposal-review>\n\n{"verdict":"reject"}\n\n</coven:proposal-review>',
]) {
  const source = `Before.\n\n${atomic}\n\nAfter.`;
  const g = fixture(source.indexOf("\n\n", source.indexOf(atomic)) + 2);
  const spans = chatActivityTimeline(source, g.tools.snapshot(), [g.before, g.after])!.filter((entry) => entry.kind === "text").map((entry) => entry.text);
  assert(spans.some((span) => span.includes(atomic)), "an atomic block remains in one rich-render pass");
}
const images = '<coven:image src="https://example.com/a.png" group="deck" />\n\nBetween.\n\n<coven:image src="https://example.com/b.png" group="deck" />\n\nEnd.';
const grouped = fixture(images.indexOf("Between"));
const imageSpans = chatActivityTimeline(images, grouped.tools.snapshot(), [])!.filter((entry) => entry.kind === "text").map((entry) => entry.text);
assert.equal(imageSpans.flatMap(sliceImageBlocks).filter((piece) => piece.kind === "carousel").length, 1);
const questions = '<coven:approve kind="questions" prompt="First?" options="Yes|No" />\n\n<coven:approve kind="questions" prompt="Second?" options="Yes|No" />';
const q = fixture(questions.indexOf("\n\n") + 2);
const questionSpans = chatActivityTimeline(questions, q.tools.snapshot(), [])!.filter((entry) => entry.kind === "text").map((entry) => entry.text);
assert.equal(questionSpans.flatMap(sliceApproveBlocks).filter((piece) => piece.kind === "approve").length, 1);
const shared = JSON.parse(readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-timeline-v1.json", import.meta.url), "utf8")) as {
  schemaVersion: number; scenarios: Array<{ id: string; text: string; tools: ToolEvent[]; reasoningBlocks: ChatReasoningBlock[];
    expectedKinds: string[] | null; expectedText?: string[]; atomic?: string; renderParity?: boolean; expectedLinks?: string[] }>;
};
assert.equal(shared.schemaVersion, 1);
// Use the installed renderer, not a Markdown approximation. References and
// footnotes are currently literal in its unsplit baseline; splitting must not
// drop their definitions or invent links. Inline links still remain usable.
(globalThis as Record<string, unknown>).HTMLElement = class {};
(globalThis as Record<string, unknown>).customElements = { define: () => {}, get: () => undefined };
const [{ parse }, { renderAsync }] = await Promise.all([import("@create-markdown/core"), import("@create-markdown/preview")]);
async function rendered(source: string) {
  return unwrapPreviewShell(await renderAsync(parse(source), { linkTarget: "_blank" })).trim();
}
for (const scenario of shared.scenarios) {
  const entries = chatActivityTimeline(scenario.text, scenario.tools, scenario.reasoningBlocks);
  assert.deepEqual(entries?.map((entry) => entry.kind) ?? null, scenario.expectedKinds, scenario.id);
  const text = entries?.flatMap((entry) => entry.kind === "text" ? [entry.text] : []) ?? [];
  if (scenario.expectedText) assert.deepEqual(text, scenario.expectedText, scenario.id);
  if (scenario.atomic) assert(text.some((span) => span.includes(scenario.atomic!)), scenario.id);
  if (scenario.renderParity) {
    const baseline = await rendered(scenario.text);
    const split = (await Promise.all(text.map(rendered))).join("\n");
    assert.equal(split, baseline, `${scenario.id}: renderer semantics survive chronological splitting`);
    assert.deepEqual([...split.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), scenario.expectedLinks, scenario.id);
  }
}
console.log(`chat-activity-timeline: passed (${shared.scenarios.length} shared native/web scenarios)`);

const nativePlain = JSON.parse(readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/native-plain-paragraph-v1.json", import.meta.url), "utf8")) as Array<{ id: string; source: string; plainText: string | null }>;
for (const item of nativePlain) {
  if (item.plainText === null) continue; // Conservative fallback keeps the existing renderer.
  const blocks = parse(item.source);
  assert.equal(blocks.length, 1, item.id);
  const block = blocks[0]!;
  assert.equal(block.type, "paragraph", item.id);
  assert.equal(block.children?.length ?? 0, 0, item.id);
  assert.equal(block.content.map((span) => span.text).join(""), item.plainText, item.id);
  assert(block.content.every((span) => Object.keys(span.styles).length === 0), item.id);
}
console.log(`native plain paragraphs: passed (${nativePlain.length} conservative cases)`);
