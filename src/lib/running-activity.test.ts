// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import {
  automationActivityItems,
  boardTaskActivityItems,
  buildRunningActivityPayload,
  fetchRunningActivity,
  flowActivityItems,
  sessionActivityItems,
  workflowActivityItems,
} from "./running-activity.ts";

const SESSION = (over = {}) => ({
  id: "s1",
  project_root: "/repo/a",
  harness: "claude",
  title: "Draft release notes",
  status: "running",
  exit_code: null,
  archived_at: null,
  created_at: "2026-08-23T09:00:00.000Z",
  updated_at: "2026-08-23T09:00:00.000Z",
  familiarId: "onyx",
  ...over,
});

const CARD = (over = {}) => ({
  id: "c1",
  title: "Wire the release pipeline",
  status: "running",
  familiarId: null,
  sessionId: null,
  updatedAt: "2026-08-23T10:00:00.000Z",
  runningSince: "2026-08-23T09:30:00.000Z",
  ...over,
});

test("sessionActivityItems keeps only live, unarchived sessions", () => {
  const items = sessionActivityItems([
    SESSION(),
    SESSION({ id: "s2", status: "starting" }),
    SESSION({ id: "s3", status: "working" }),
    SESSION({ id: "s4", status: "completed" }),
    SESSION({ id: "s5", status: "idle" }),
    SESSION({ id: "s6", status: "running", archived_at: "2026-08-20T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    items.map((i) => i.targetId),
    ["s1", "s2", "s3"],
    "running/starting/working survive; done/idle/archived do not",
  );
  assert.equal(items[0].kind, "session");
  assert.equal(items[0].title, "Draft release notes");
  assert.equal(items[0].status, "running");
  assert.equal(items[0].familiarId, "onyx");
  assert.equal(items[0].id, "session:s1");
});

test("boardTaskActivityItems keeps only running cards and carries their session", () => {
  const items = boardTaskActivityItems([
    CARD(),
    CARD({ id: "c2", status: "backlog" }),
    CARD({ id: "c3", status: "review" }),
    CARD({ id: "c4", sessionId: "s-backing" }),
  ]);
  assert.deepEqual(items.map((i) => i.targetId), ["c1", "c4"]);
  assert.equal(items[1].sessionId, "s-backing");
  assert.equal(items[0].kind, "board-task");
  assert.equal(items[0].status, "running");
  assert.equal(items[0].startedAt, "2026-08-23T09:30:00.000Z");
});

test("automationActivityItems keeps running and queued runs with a title fallback", () => {
  const items = automationActivityItems([
    { id: "r1", automationId: "a1", automationName: "Morning sweep", status: "running", startedAt: "2026-08-23T08:00:00.000Z" },
    { id: "r2", automationId: "a2", automationName: "Nightly", status: "queued", startedAt: "2026-08-23T08:01:00.000Z" },
    { id: "r3", automationId: "a3", automationName: "Done", status: "succeeded", startedAt: "2026-08-23T08:02:00.000Z" },
    { id: "r4", automationId: "a4", status: "running", startedAt: "2026-08-23T08:03:00.000Z" },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["automation:r1", "automation:r2", "automation:r4"]);
  assert.equal(items[1].status, "queued");
  assert.equal(items[2].title, "a4", "falls back to the automation id");
});

test("flowActivityItems keeps running/queued runs and carries the executor session", () => {
  const items = flowActivityItems([
    { id: "r1", flowId: "f1", flowName: "Deploy", status: "running", startedAt: "2026-08-23T08:00:00.000Z", sessionId: "sess" },
    { id: "r2", flowId: "f2", status: "queued", startedAt: "2026-08-23T08:01:00.000Z" },
    { id: "r3", flowId: "f3", status: "succeeded", startedAt: "2026-08-23T08:02:00.000Z" },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["flow:r1", "flow:r2"]);
  assert.equal(items[0].sessionId, "sess");
  assert.equal(items[0].targetId, "f1");
  assert.equal(items[1].title, "f2", "falls back to the flow id");
});

test("workflowActivityItems keeps running/queued runs keyed by workflow id", () => {
  const items = workflowActivityItems([
    { id: "r1", workflowId: "wf1", status: "running", startedAt: "2026-08-23T08:00:00.000Z", sessionId: "sess" },
    { id: "r2", workflowId: "wf2", status: "queued", startedAt: "2026-08-23T08:01:00.000Z" },
    { id: "r3", workflowId: "wf3", status: "blocked", startedAt: "2026-08-23T08:02:00.000Z" },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["workflow:r1", "workflow:r2"]);
  assert.equal(items[0].targetId, "wf1");
  assert.equal(items[0].sessionId, "sess");
});

test("buildRunningActivityPayload marks a failing source unavailable and preserves the rest", () => {
  const payload = buildRunningActivityPayload(
    {
      sessions: { ok: true, items: sessionActivityItems([SESSION()]) },
      board: { ok: true, items: [] },
      automations: { ok: true, items: [] },
      flows: { ok: false, error: "corrupt flow-runs.json" },
      workflows: { ok: true, items: [] },
    },
    "2026-08-23T12:00:00.000Z",
  );
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.unavailable, ["flows"]);
  assert.equal(payload.sources.flows.ok, false);
  assert.equal(payload.sources.flows.error, "corrupt flow-runs.json");
  assert.equal(payload.total, 1, "the live session still surfaces");
  assert.equal(payload.items[0].targetId, "s1");
  assert.equal(payload.generatedAt, "2026-08-23T12:00:00.000Z");
});

test("buildRunningActivityPayload deduplicates task-backed sessions only", () => {
  const sessions = sessionActivityItems([SESSION({ id: "s1" }), SESSION({ id: "s2" })]);
  const board = boardTaskActivityItems([CARD({ sessionId: "s1" })]);
  const flows = flowActivityItems([
    { id: "fr", flowId: "f1", status: "running", startedAt: "2026-08-23T09:00:00.000Z", sessionId: "s2" },
  ]);
  const payload = buildRunningActivityPayload({
    sessions: { ok: true, items: sessions },
    board: { ok: true, items: board },
    automations: { ok: true, items: [] },
    flows: { ok: true, items: flows },
    workflows: { ok: true, items: [] },
  });
  const sessionTargets = payload.items.filter((i) => i.kind === "session").map((i) => i.targetId);
  assert.deepEqual(sessionTargets, ["s2"], "the board-task-backed session s1 is dropped");
  assert.equal(payload.items.some((i) => i.kind === "board-task" && i.targetId === "c1"), true);
  assert.equal(
    payload.items.some((i) => i.kind === "session" && i.targetId === "s2"),
    true,
    "a flow-backed session is NOT deduplicated — only task-backed sessions are",
  );
  assert.equal(payload.total, 3, "board task + flow + the non-task session");
});

test("buildRunningActivityPayload sorts newest-first and counts post-dedup", () => {
  const payload = buildRunningActivityPayload({
    sessions: { ok: true, items: [] },
    board: { ok: true, items: [] },
    automations: {
      ok: true,
      items: [
        { id: "automation:old", kind: "automation", title: "Old", status: "running", startedAt: "2026-08-23T08:00:00.000Z", targetId: "a-old" },
        { id: "automation:new", kind: "automation", title: "New", status: "running", startedAt: "2026-08-23T10:00:00.000Z", targetId: "a-new" },
        { id: "automation:none", kind: "automation", title: "NoClock", status: "running", targetId: "a-none" },
      ],
    },
    flows: { ok: true, items: [] },
    workflows: { ok: true, items: [] },
  });
  assert.deepEqual(
    payload.items.map((i) => i.id),
    ["automation:new", "automation:old", "automation:none"],
    "dated items sort newest-first; an undated item sorts last",
  );
  assert.equal(payload.total, 3);
});

function fetchJson(payload, ok = true) {
  return async () => ({ ok, json: async () => payload });
}

function completePayload() {
  return buildRunningActivityPayload(
    {
      sessions: { ok: true, items: sessionActivityItems([SESSION()]) },
      board: { ok: true, items: [] },
      automations: { ok: true, items: [] },
      flows: { ok: true, items: [] },
      workflows: { ok: true, items: [] },
    },
    "2026-08-23T12:00:00.000Z",
  );
}

test("fetchRunningActivity accepts a complete payload", async () => {
  const payload = completePayload();
  assert.deepEqual(await fetchRunningActivity(fetchJson(payload)), payload);
});

test("fetchRunningActivity rejects malformed ok payloads before they reach React state", async () => {
  const valid = completePayload();
  const malformed = [
    { ok: true },
    { ...valid, items: null },
    { ...valid, unavailable: undefined },
    { ...valid, items: [{ ...valid.items[0], startedAt: 123 }] },
    { ...valid, unavailable: ["unknown-source"] },
    { ...valid, unavailable: ["flows"] },
    {
      ...valid,
      sources: { ...valid.sources, board: { ok: true, count: "zero" } },
    },
    { ...valid, total: valid.total + 1 },
  ];

  for (const [index, payload] of malformed.entries()) {
    assert.equal(
      await fetchRunningActivity(fetchJson(payload)),
      null,
      `malformed payload ${index + 1} must fail closed`,
    );
  }
});

console.log("running-activity.test.ts: ok");
