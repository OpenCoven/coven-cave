import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { responseMetadataIdentity, type ChatResponseMetadata } from "./chat-response-metadata.ts";
import { mergeToolObservation, normalizeToolStatus, settleToolObservations } from "./chat-tool-state.ts";
import { mergeReasoningBlock, normalizeReasoningBlock, type ChatReasoningBlock } from "./chat-reasoning-blocks.ts";
import { HermesSseDecoder, parseHermesResponsesEvent } from "./hermes-responses-stream.ts";

type Tool = { id: string; name: string; status: string; durationMs?: number };
type Corpus = {
  schemaVersion: number;
  identityScenarios: Array<{ id: string; metadata: ChatResponseMetadata; expected: unknown }>;
  toolScenarios: Array<{ id: string; events: Tool[]; expected: Tool[] }>;
  reasoningScenarios: Array<{ id: string; blocks: unknown[]; expected: ChatReasoningBlock[] }>;
};
// One resource is bundled into the native unit-test target and read here.
// These fixtures qualify display folds, not runtime admission or UI behavior.
const corpus = JSON.parse(readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-v1.json", import.meta.url), "utf8")) as Corpus;
assert.equal(corpus.schemaVersion, 1);
for (const scenario of corpus.identityScenarios) {
  assert.deepEqual(responseMetadataIdentity(scenario.metadata) ?? null, scenario.expected, scenario.id);
  assert.deepEqual(responseMetadataIdentity(JSON.parse(JSON.stringify(scenario.metadata))) ?? null, scenario.expected, `${scenario.id}: stored JSON`);
}
for (const scenario of corpus.toolScenarios) {
  let tools: Array<Omit<Tool, "status"> & { status: ReturnType<typeof normalizeToolStatus> }> = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const raw of scenario.events) {
      const incoming = { id: raw.id, name: raw.name, status: normalizeToolStatus(raw.status ?? "running"), durationMs: raw.durationMs };
      const index = tools.findIndex((tool) => tool.id === incoming.id);
      if (index < 0) tools.push(incoming);
      else tools[index] = mergeToolObservation(tools[index]!, incoming);
    }
    tools = settleToolObservations(tools)!;
    assert.deepEqual(JSON.parse(JSON.stringify(tools)), scenario.expected, `${scenario.id}: pass ${pass}`);
  }
}
for (const scenario of corpus.reasoningScenarios) {
  let blocks: ChatReasoningBlock[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const raw of scenario.blocks) {
      const block = normalizeReasoningBlock(raw);
      if (block) blocks = mergeReasoningBlock(blocks, block);
    }
    assert.deepEqual(blocks, scenario.expected, `${scenario.id}: pass ${pass}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(blocks)), scenario.expected, `${scenario.id}: stored JSON`);
}
console.log(`shared activity corpus: ${corpus.identityScenarios.length} identity, ${corpus.toolScenarios.length} tool, ${corpus.reasoningScenarios.length} reasoning scenarios passed`);

// The same provider frames drive the opt-in real native TCP test. Exercise the
// production SSE decoder/parser here, including fragmented multibyte text.
const http = JSON.parse(readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-http-v1.json", import.meta.url), "utf8"));
assert.equal(http.schemaVersion, 1);
const wire = Buffer.from([...http.beforeRelease, ...http.afterRelease]
  .map(([event, data]: [string, unknown]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""));
const utf8 = new TextDecoder();
const decoder = new HermesSseDecoder();
const frames: Array<{ event: string; data: string }> = [];
for (let offset = 0; offset < wire.length; offset += 7) {
  frames.push(...decoder.push(utf8.decode(wire.subarray(offset, offset + 7), { stream: true })));
}
frames.push(...decoder.push(utf8.decode()), ...decoder.finish());
const events = frames.map((frame) => parseHermesResponsesEvent(frame.event, JSON.parse(frame.data)));
assert.equal(events.filter((event) => event.kind === "text").map((event) => event.text).join(""), http.expected.answer);
assert.deepEqual(events.flatMap((event) => event.kind === "reasoning" && event.phase === "complete" ? [event.text] : []),
  http.expected.summaries);
assert.deepEqual(events.filter((event) => event.kind === "tool_start").map((event) => [event.id, event.name, Boolean(event.executionObserved)]),
  [[http.expected.toolId, http.expected.toolName, false], [http.expected.toolId, http.expected.toolName, true]]);
assert.equal(events.filter((event) => event.kind === "tool_end" && !event.isError).length, 1);
assert.deepEqual(events.at(-1), { kind: "done", isError: false, id: "native-http-response", model: http.expected.model });
for (const sentinel of http.expected.privateSentinels) assert.ok(!JSON.stringify(events).includes(sentinel));
console.log("shared HTTP activity scenario: fragmented provider frames and disclosure passed");
