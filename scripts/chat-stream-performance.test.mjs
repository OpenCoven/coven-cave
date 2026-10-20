import assert from "node:assert/strict";
import test from "node:test";
import {
  createStreamWorkload,
  evaluateStreamPerformance,
  overlappingLongTasks,
} from "../tests/fixtures/chat-stream-performance.ts";

function samples(pattern = "burst", longestTaskMs = 200) {
  return Array.from({ length: 100 }, (_, index) => ({
    index, pattern, complete: true, observerSupported: true,
    sendCount: 1, textMatches: true, draftMatches: true,
    eventCount: 10_000, textBytes: 89_294, sseBytes: 618_430, historyTurns: 1_000,
    longestTaskMs,
  }));
}

test("the generated workload preserves all numbered records and indexed response text", () => {
  const { frames, expectedText } = createStreamWorkload();
  assert.equal(frames.length, 10_000);
  assert.equal(Buffer.byteLength(frames.join("")), 618_430);
  assert.equal(Buffer.byteLength(expectedText), 89_294);
  const records = frames.map((frame, index) => {
    const match = /^id: ([0-9]+)\ndata: (.+)\n\n$/.exec(frame);
    assert.ok(match);
    assert.equal(Number(match[1]), index + 1);
    return JSON.parse(match[2]);
  });
  assert.deepEqual(records[0], { kind: "session", sessionId: "context-a" });
  assert.deepEqual(records.at(-1), {
    kind: "done", sessionId: "context-a", persistedTurnId: "context-a-1001",
  });
  const chunks = records.slice(1, -1);
  assert.equal(chunks.length, 9_998);
  assert.ok(chunks.every(record => record.kind === "assistant_chunk"));
  assert.equal(chunks.map(record => record.text).join(""), expectedText);
  assert.equal(chunks[0].text, "w0000000 ");
  assert.equal(chunks[99].text, "\n\n");
  assert.equal(chunks.at(-2).text, "w0009996 ");
  assert.equal(chunks.at(-1).text, "ENDSTREAM10000");
  assert.equal(new Set(expectedText.match(/w[0-9]{7}/g)).size, 9_898);
});

test("100 complete trials at the existing ceiling pass with the measured percentile", () => {
  const result = evaluateStreamPerformance("burst", samples());
  assert.equal(result.pass, true);
  assert.equal(result.p95Ms, 200);
  assert.equal(result.maximumMs, 200);
  assert.deepEqual(result.failures, []);
});

test("six slow trials breach p95 while five affect the reported maximum", () => {
  const five = samples();
  for (let index = 0; index < 5; index++) five[index].longestTaskMs = 201;
  assert.equal(evaluateStreamPerformance("burst", five).pass, true);
  assert.equal(evaluateStreamPerformance("burst", five).maximumMs, 201);
  five[5].longestTaskMs = 201;
  const result = evaluateStreamPerformance("burst", five);
  assert.equal(result.pass, false);
  assert.equal(result.p95Ms, 201);
  assert.ok(result.failures.some(reason => reason.includes("200")));
});

test("shuffled trial order keeps the same percentile without mutating input", () => {
  const input = samples().map((sample, index) => ({ ...sample, longestTaskMs: 100 - index }));
  const original = structuredClone(input);
  const result = evaluateStreamPerformance("burst", input);
  assert.equal(result.p95Ms, 95);
  assert.equal(result.maximumMs, 100);
  assert.deepEqual(input, original);
});

test("missing, excess, duplicated, and invalid trial identities cannot claim a distribution", () => {
  for (const input of [
    undefined, null, {}, [], samples().slice(1), [...samples(), samples()[0]],
    samples().map((sample, index) => index === 99 ? { ...sample, index: 0 } : sample),
    samples().map((sample, index) => index === 99 ? { ...sample, index: 100 } : sample),
    samples().map((sample, index) => index === 99 ? { ...sample, index: 0.5 } : sample),
  ]) {
    const result = evaluateStreamPerformance("burst", input);
    assert.equal(result.pass, false);
    assert.equal(result.p95Ms, null);
    assert.ok(result.failures.length > 0);
  }
});

test("one invalid semantic or workload observation fails even below the latency ceiling", () => {
  for (const patch of [
    { complete: false }, { observerSupported: false }, { sendCount: 0 }, { sendCount: 2 },
    { textMatches: false }, { draftMatches: false },
    { eventCount: 9_999 }, { textBytes: 89_293 }, { sseBytes: 618_429 }, { historyTurns: 999 },
    { pattern: "paced" }, { longestTaskMs: NaN }, { longestTaskMs: Infinity },
    { longestTaskMs: -1 }, { longestTaskMs: undefined }, { complete: undefined },
  ]) {
    const input = samples("burst", 0);
    input[40] = { ...input[40], ...patch };
    const result = evaluateStreamPerformance("burst", input);
    assert.equal(result.pass, false, JSON.stringify(patch));
    assert.equal(result.p95Ms, null);
  }
});

test("fast burst trials cannot conceal a slow paced distribution or an unknown pattern", () => {
  assert.equal(evaluateStreamPerformance("burst", samples("burst", 0)).pass, true);
  assert.equal(evaluateStreamPerformance("paced", samples("paced", 260)).pass, false);
  assert.equal(evaluateStreamPerformance("unknown", samples()).pass, false);
});

test("overlap measurement includes a task already blocking at stream release", () => {
  const entries = [
    { start: 0, duration: 50 },
    { start: 90, duration: 260 },
    { start: 150, duration: 60 },
    { start: 390, duration: 70 },
    { start: 400, duration: 80 },
  ];
  assert.deepEqual(overlappingLongTasks(entries, 100, 400), [entries[1], entries[2], entries[3]]);
});

test("invalid observer entries and time windows fail instead of disappearing", () => {
  for (const entries of [
    [{ start: NaN, duration: 260 }], [{ start: 0, duration: Infinity }],
    [{ start: 0, duration: -1 }], [{ start: -1, duration: 60 }],
  ]) assert.throws(() => overlappingLongTasks(entries, 100, 400));
  for (const [start, end] of [[NaN, 400], [100, Infinity], [400, 100], [-1, 400]]) {
    assert.throws(() => overlappingLongTasks([], start, end));
  }
});
