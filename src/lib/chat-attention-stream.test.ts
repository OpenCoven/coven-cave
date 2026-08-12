import assert from "node:assert/strict";
import test from "node:test";
import { createAttentionSafeTextAccumulator } from "./chat-attention-stream.ts";
import {
  scanChatResultProtocol,
  type ChatResultProtocolScan,
} from "./chat-result-markers.ts";

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

test("result-aware replacement preserves complete and partial attention syntax inside a valid result", () => {
  const label = "Literal <coven:attention /> and partial <coven:atten stay exact";
  const result = `<coven:result id="literal-attention" state="passed" label="${label}" />`;
  const raw = `${result}\n<coven:attention reason="decision" />`;
  const protocol = scanChatResultProtocol(raw);
  const accumulator = createAttentionSafeTextAccumulator();

  assert.equal(
    accumulator.replace(
      raw,
      protocol.markdownRangeSource,
      protocol.protectedRanges,
    ),
    `${result}\n`,
  );
  assert.equal(accumulator.settled(), `${result}\n`);
});

test("malformed and oversized result spans stay opaque while later attention still extracts", () => {
  const innerAttention = '<coven:attention reason="credentials" />';
  const candidates = [
    `<coven:result id="malformed" state="passed" label="Literal ${innerAttention} and <coven:atten tail" nope>`,
    `<coven:result id="oversized" state="passed" label="${"x".repeat(2_048)} ${innerAttention} and <coven:atten exact tail" />`,
  ];

  for (const candidate of candidates) {
    const raw = `${candidate}\n<coven:attention reason="approval" />`;
    const protocol = scanChatResultProtocol(raw);
    const accumulator = createAttentionSafeTextAccumulator();
    assert.equal(
      accumulator.replace(
        raw,
        protocol.markdownRangeSource,
        protocol.protectedRanges,
      ),
      `${candidate}\n`,
    );
    assert.equal(accumulator.terminal(), `${candidate}\n`);
  }
});

test("a real partial attention tail outside a result keeps pending, settled, and terminal semantics", () => {
  const result = '<coven:result id="partial-tail" state="passed" label="Literal <coven:attention />" />';
  const raw = `${result}\n<coven:atten`;
  const protocol = scanChatResultProtocol(raw);
  const accumulator = createAttentionSafeTextAccumulator();

  assert.equal(
    accumulator.replace(
      raw,
      protocol.markdownRangeSource,
      protocol.protectedRanges,
    ),
    `${result}\n`,
  );
  assert.equal(accumulator.settled(), raw);
  assert.equal(accumulator.terminal(), `${result}\n`);
});

test("result-only stream snapshots skip the result opacity scan", () => {
  let scanCalls = 0;
  const scanner = (source: string): ChatResultProtocolScan => {
    scanCalls += 1;
    return scanChatResultProtocol(source);
  };
  const accumulator = createAttentionSafeTextAccumulator(scanner);
  const raw = '<coven:result id="build" state="running" label="Build" />';

  assert.equal(accumulator.replace(raw), raw);
  assert.equal(accumulator.settled(), raw);
  assert.equal(scanCalls, 0);
});

test("attention plus result syntax derives one reusable opacity scan", () => {
  let scanCalls = 0;
  const scanner = (source: string): ChatResultProtocolScan => {
    scanCalls += 1;
    return scanChatResultProtocol(source);
  };
  const accumulator = createAttentionSafeTextAccumulator(scanner);
  const result =
    '<coven:result id="attention-label" state="passed" label="Literal <coven:attention />" />';
  const raw = `${result}\n<coven:attention reason="approval" />`;

  assert.equal(accumulator.replace(raw), `${result}\n`);
  assert.equal(accumulator.settled(), `${result}\n`);
  assert.equal(accumulator.terminal(), `${result}\n`);
  assert.equal(scanCalls, 1);
});

test("a partial attention prefix plus result syntax derives one scan", () => {
  let scanCalls = 0;
  const scanner = (source: string): ChatResultProtocolScan => {
    scanCalls += 1;
    return scanChatResultProtocol(source);
  };
  const accumulator = createAttentionSafeTextAccumulator(scanner);
  const result = '<coven:result id="build" state="running" label="Build" />';
  const raw = `${result}\n<coven:atten`;

  assert.equal(accumulator.replace(raw), `${result}\n`);
  assert.equal(accumulator.settled(), raw);
  assert.equal(scanCalls, 1);
});
