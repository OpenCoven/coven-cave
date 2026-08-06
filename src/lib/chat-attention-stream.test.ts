import assert from "node:assert/strict";
import test from "node:test";
import { createAttentionSafeTextAccumulator } from "./chat-attention-stream.ts";

test("stream chunks use pending extraction but settlement preserves prose after malformed tags", () => {
  const accumulator = createAttentionSafeTextAccumulator();
  assert.equal(accumulator.append("<coven:atten"), "");
  accumulator.append('tion" reason="decision">AFTER');
  assert.equal(accumulator.settled(), "AFTER");
});

test("replacement settlement does not mistake malformed attention markup for a request boundary", () => {
  const accumulator = createAttentionSafeTextAccumulator();
  accumulator.replace('<coven:attention reason="decision>AFTER');
  assert.equal(accumulator.visible(), "");
  assert.equal(accumulator.settled(), "AFTER");
});

test("fragmented valid markers stay hidden while streaming and strip once complete", () => {
  const accumulator = createAttentionSafeTextAccumulator();
  assert.equal(accumulator.append('<coven:attention reason="appro'), "");
  assert.equal(accumulator.append('val"/>AFTER'), "AFTER");
  assert.equal(accumulator.settled(), "AFTER");
});

test("terminal and cancelled output strip a truly partial marker prefix", () => {
  const accumulator = createAttentionSafeTextAccumulator();
  accumulator.append("Before <coven:atten");
  assert.equal(accumulator.visible(), "Before ");
  assert.equal(accumulator.settled(), "Before <coven:atten");
  assert.equal(accumulator.terminal(), "Before ");
  assert.equal(accumulator.cancelled(), "Before ");
});

test("fenced literals preserve attention markers verbatim", () => {
  const accumulator = createAttentionSafeTextAccumulator();
  accumulator.replace("```xml\n<coven:attention reason=\"approval\"/>\n```\nAFTER");
  assert.equal(accumulator.settled(), "```xml\n<coven:attention reason=\"approval\"/>\n```\nAFTER");
});
