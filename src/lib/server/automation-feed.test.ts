import assert from "node:assert/strict";
import test from "node:test";
import { CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import { readAutomationFeed } from "./automation-feed.ts";

const signal = new AbortController().signal;
const failure = (code: string) => new CovenClientError(normalizeCovenError({ code }, "automations.events"));

type Stream = { kind: string; id: string };
function event(sequence: number, stream: Stream, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "coven.automations.v1", eventId: `evt${String(sequence).padStart(32, "0")}`, stream, sequence,
    recordedAt: "2026-10-18T08:31:46.897Z", observedAt: "2026-10-18T08:31:46.897Z",
    producer: { component: "coven", instanceId: "test" }, summary: "private summary text",
    privacy: { classification: "operational", retention: { classification: "standard" } },
    kind: "attempt.transitioned",
    payload: { entity: "attempt", from: "dispatching", to: "failed", reason: "failed to spawn harness", attemptNumber: 1 },
    automationId: "nightly", occurrenceId: "occ-1", runId: "run-1", attemptId: "attempt-run-1-1",
    ...extra,
  };
}
function page(stream: Stream, events: unknown[], checkpoint = "cp") {
  return { stream, after: null, events, nextAfter: events.length ? events.length - 1 : null, checkpoint, checkpointExpiresAt: "2026-10-19T08:00:00.000Z" };
}

function reader(answer: (query: { stream: Stream; checkpoint?: string }, call: number) => unknown) {
  const calls: { stream: Stream; checkpoint?: string }[] = [];
  return {
    calls,
    client: { events: async (query: { stream: Stream; checkpoint?: string }) => { calls.push(query); return answer(query, calls.length); } } as never,
  };
}

test("a run stream read shows labels and transitions only, never reasons or summaries", async () => {
  const stream = { kind: "run", id: "run-1" };
  const { client, calls } = reader(() => page(stream, [
    event(0, stream, { kind: "run.transitioned", payload: { entity: "run", from: "none", to: "running", reason: "Coven recorded the run state" }, attemptId: undefined }),
    event(1, stream),
  ], "cp-run"));
  const result = await readAutomationFeed("nightly", new URLSearchParams({ stream: "run", streamId: "run-1" }), signal, client);
  assert.deepEqual(calls, [{ stream }]);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.deepEqual(result.events.map(({ topic, label, detail }) => ({ topic, label, detail })), [
    { topic: "run", label: "Run changed", detail: "none → running" },
    { topic: "run", label: "Attempt changed", detail: "dispatching → failed" },
  ]);
  assert.equal(result.checkpoint, "cp-run");
  assert.equal(result.caughtUp, true);
  assert.equal(result.throughSequence, 1);
  assert.doesNotMatch(JSON.stringify(result), /private summary|spawn/);
});

test("the automation stream is the default, and a checkpoint resumes it", async () => {
  const stream = { kind: "automation", id: "nightly" };
  const { client, calls } = reader(() => page(stream, [], "cp-next"));
  const result = await readAutomationFeed("nightly", new URLSearchParams({ checkpoint: "cp-prev" }), signal, client);
  assert.deepEqual(calls, [{ stream, checkpoint: "cp-prev" }]);
  assert.equal(result.kind === "available" && result.throughSequence, null);
  assert.equal(result.kind === "available" && result.checkpoint, "cp-next");
});

test("catch-up walks full pages toward the head, and stops at a bound without claiming to be caught up", async () => {
  const stream = { kind: "automation", id: "nightly" };
  const full = (offset: number) => Array.from({ length: 100 }, (_, index) => event(offset + index, stream, {
    kind: "definition.revised", payload: { revision: offset + index + 1 }, occurrenceId: undefined, runId: undefined, attemptId: undefined,
  }));
  const short = reader((_query, call) => page(stream, call < 3 ? full((call - 1) * 100) : [], `cp-${call}`));
  const caught = await readAutomationFeed("nightly", new URLSearchParams(), signal, short.client);
  assert.equal(short.calls.length, 3);
  assert.deepEqual(short.calls.slice(1).map((call) => call.checkpoint), ["cp-1", "cp-2"]);
  assert.equal(caught.kind === "available" && caught.caughtUp, true);
  if (caught.kind !== "available") return;
  assert.equal(caught.events.length, 50, "only the newest bounded events come back");
  assert.equal(caught.omitted, 150);
  assert.equal(caught.throughSequence, 199);
  assert.equal(caught.events[0].sequence, 150);

  const endless = reader((_query, call) => page(stream, full((call - 1) * 100), `cp-${call}`));
  const bounded = await readAutomationFeed("nightly", new URLSearchParams(), signal, endless.client);
  assert.equal(endless.calls.length, 10);
  assert.equal(bounded.kind === "available" && bounded.caughtUp, false);
  assert.equal(bounded.kind === "available" && bounded.checkpoint, "cp-10");
});

test("protected events are counted, not shown", async () => {
  const stream = { kind: "run", id: "run-1" };
  const { client } = reader(() => page(stream, [event(0, stream, { privacy: { classification: "sensitive", retention: { classification: "standard" } } })]));
  const result = await readAutomationFeed("nightly", new URLSearchParams({ stream: "run", streamId: "run-1" }), signal, client);
  assert.equal(result.kind === "available" && result.events.length, 0);
  assert.equal(result.kind === "available" && result.omitted, 1);
  assert.equal(result.kind === "available" && result.throughSequence, 0);
});

test("a stream carrying another automation's events is refused", async () => {
  const stream = { kind: "run", id: "run-1" };
  for (const extra of [{ automationId: "weekly" }, { automationId: undefined }]) {
    const { client } = reader(() => page(stream, [event(0, stream, extra)]));
    assert.deepEqual(await readAutomationFeed("nightly", new URLSearchParams({ stream: "run", streamId: "run-1" }), signal, client), { kind: "invalid" });
  }
});

test("a lost position is expired whether Coven says expired or no longer knows the checkpoint", async () => {
  for (const [code, checkpoint, kind] of [
    ["CURSOR_EXPIRED", "cp", "expired"], ["NOT_FOUND", "cp", "expired"], ["NOT_FOUND", null, "unavailable"],
    ["capability_unsupported", null, "unsupported"], ["invalid_options", null, "invalid"], ["unavailable", "cp", "unavailable"],
  ] as const) {
    const { client } = reader(() => { throw failure(code); });
    const query = new URLSearchParams(checkpoint ? { checkpoint } : {});
    assert.deepEqual(await readAutomationFeed("nightly", query, signal, client), { kind });
  }
});

test("malformed stream requests never reach the daemon", async () => {
  for (const [id, query] of [
    ["has space", ""], ["nightly", "stream=receipt&streamId=r"], ["nightly", "stream=run"], ["nightly", "stream=automation&streamId=x"],
    ["nightly", "stream=run&streamId=../x"], ["nightly", "checkpoint="], ["nightly", `checkpoint=${"x".repeat(513)}`],
    ["nightly", "checkpoint=a&checkpoint=b"], ["nightly", "after=0"],
  ]) {
    const { client, calls } = reader(() => assert.fail("must not dispatch"));
    assert.deepEqual(await readAutomationFeed(id, new URLSearchParams(query), signal, client), { kind: "invalid" });
    assert.equal(calls.length, 0);
  }
});
