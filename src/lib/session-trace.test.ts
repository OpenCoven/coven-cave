import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTracePayload,
  mergeTraceEvents,
  summarizeTracePayload,
  traceEventTone,
  type SessionTraceEvent,
} from "./session-trace.ts";

function event(seq: number, kind = "note", payload = "{}"): SessionTraceEvent {
  return {
    seq,
    id: `evt-${seq}`,
    session_id: "s-1",
    kind,
    payload_json: payload,
    created_at: "2026-07-12T00:00:00.000Z",
  };
}

describe("traceEventTone", () => {
  it("classifies daemon kinds by conventional fragments", () => {
    assert.equal(traceEventTone("session.started"), "start");
    assert.equal(traceEventTone("process.spawn"), "start");
    assert.equal(traceEventTone("process.exit"), "end");
    assert.equal(traceEventTone("run-complete"), "end");
    assert.equal(traceEventTone("run-error"), "error");
    assert.equal(traceEventTone("tool.failure"), "error");
    assert.equal(traceEventTone("permission-denied"), "error");
    assert.equal(traceEventTone("heartbeat"), "info");
  });

  it("prefers error over lifecycle words when both appear", () => {
    // "start" and "error" both match — errors must win so failures never
    // render as calm lifecycle chips.
    assert.equal(traceEventTone("startup-error"), "error");
  });
});

describe("summarizeTracePayload", () => {
  it("returns null for empty payloads", () => {
    assert.equal(summarizeTracePayload(""), null);
    assert.equal(summarizeTracePayload("{}"), null);
    assert.equal(summarizeTracePayload("null"), null);
    assert.equal(summarizeTracePayload('""'), null);
  });

  it("uses bare strings and non-JSON text directly", () => {
    assert.equal(summarizeTracePayload('"hello world"'), "hello world");
    assert.equal(summarizeTracePayload("plain text payload"), "plain text payload");
  });

  it("prefers conventional message keys in order", () => {
    assert.equal(summarizeTracePayload('{"status":"ok","text":"the text"}'), "the text");
    assert.equal(summarizeTracePayload('{"message":"the message"}'), "the message");
    assert.equal(summarizeTracePayload('{"error":"boom"}'), "boom");
  });

  it("falls back to a compact key: value join of primitive fields", () => {
    assert.equal(
      summarizeTracePayload('{"pid":42,"ok":true,"ignored":{"nested":1}}'),
      "pid: 42 · ok: true",
    );
  });

  it("clips long summaries and collapses whitespace", () => {
    const long = JSON.stringify({ text: `a  b\n${"x".repeat(400)}` });
    const summary = summarizeTracePayload(long);
    assert.ok(summary);
    assert.ok(summary.length <= 241, "clipped to the cap plus ellipsis");
    assert.match(summary, /^a b x/);
    assert.match(summary, /…$/);
  });
});

describe("formatTracePayload", () => {
  it("pretty-prints objects and rejects payloads with no extra detail", () => {
    assert.equal(formatTracePayload("{}"), null);
    assert.equal(formatTracePayload('"just a string"'), null);
    assert.equal(formatTracePayload("not json"), null);
    assert.match(formatTracePayload('{"a":1}') ?? "", /"a": 1/);
  });
});

describe("mergeTraceEvents", () => {
  it("appends pages in seq order and dedupes overlapping rows", () => {
    const first = [event(1), event(2), event(3)];
    const next = [event(3, "dup"), event(4), event(5)];
    const merged = mergeTraceEvents(first, next);
    assert.deepEqual(merged.map((item) => item.seq), [1, 2, 3, 4, 5]);
    // The newer page wins on overlap — a refetched row may carry updates.
    assert.equal(merged[2].kind, "dup");
  });

  it("sorts even when pages arrive out of order", () => {
    const merged = mergeTraceEvents([event(5)], [event(2)]);
    assert.deepEqual(merged.map((item) => item.seq), [2, 5]);
  });
});
