import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { DaemonByteRequest } from "../coven-daemon.ts";
import { callDaemonTargetBytes } from "../coven-daemon.ts";
import { CovenAutomationsUnavailableError } from "../coven-automations-types.ts";
import { getRoutine, listRoutines, listRoutineRuns, readRoutineDefinition, readRoutineLog } from "./automation-consumer-reads.ts";

const routine = { schemaVersion: 1, id: "daily", name: "Daily", status: "DISABLED", rrule: "FREQ=DAILY",
  timezone: "America/Chicago", misfire: "latest", overlap: "forbid", timeoutMinutes: 10,
  runtime: "codex", familiarId: "alba", prompt: "Reflect" };
const run = { id: "old-run", automationId: "daily", occurrenceId: "occ-1", sessionId: null,
  familiarId: null, runtime: null, status: "succeeded", exitCode: 0, logJson: "A stored log",
  outputCommit: null, startedAt: "2026-10-01T08:00:00Z", finishedAt: "2026-10-01T08:01:00Z",
  receiptId: null, attempts: [], automationRevision: 4, definitionDigest: null, authorityProfile: null, timeoutAt: null };
const actions = ["coven.automations.definition.list.v1", "coven.automations.definition.get.v1", "coven.automations.runs", "coven.automations.run.get.v1"];
function wire(payload: unknown) {
  const calls: DaemonByteRequest[] = [];
  return { calls, transport: async (request: DaemonByteRequest) => {
    calls.push(request);
    const action = (request.body as { action?: string } | undefined)?.action;
    const value = request.method === "GET" ? { capabilities: [{ id: "coven.automations", label: "Automations", adapter: "coven-daemon",
      status: "available", policy: "allow", actions,
      variantNegotiation: { version: 1, contractProfile: "coven.automations.v1", description: "Fixture",
        supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
        experimental: [], refused: [], negotiationRules: [] } }] }
      : { ok: true, accepted: true, action, status: "completed", event: { kind: "automations.changed", action, payload } };
    return { ok: true, status: 200, data: Buffer.from(JSON.stringify(value)) };
  } };
}

test("typed list keeps disabled state and IANA timezone and normalizes omitted tags", async () => {
  const { transport, calls } = wire({ routines: [routine], revisionById: { daily: 4 }, tombstonedAtById: {} });
  const result = await listRoutines(transport);
  assert.equal(result[0].status, "DISABLED");
  assert.equal(result[0].timezone, "America/Chicago");
  assert.deepEqual(result[0].tags, []);
  assert.deepEqual(calls[1].body, { action: actions[0], includeTombstoned: false });
});

test("definition reads retain the reviewed revision and omit tombstoned definitions", async () => {
  const snapshot = await readRoutineDefinition("daily", wire({ routine, revision: 4, tombstonedAt: null }).transport);
  assert.equal(snapshot?.revision, 4);
  assert.equal(snapshot?.routine.id, "daily");
  assert.equal(await getRoutine("daily", wire({ routine, revision: 4, tombstonedAt: "2026-10-02T00:00:00Z" }).transport), null);
});

test("bounded history preserves nullable fields and refuses a different automation or unrepresentable state", async () => {
  const { transport, calls } = wire({ runs: [run] });
  const result = await listRoutineRuns("daily", 1, transport);
  assert.equal(result[0].runtime, undefined);
  assert.equal(result[0].exitCode, 0);
  assert.equal(result[0].status, "succeeded");
  assert.deepEqual(calls[1].body, { action: actions[2], id: "daily", limit: 1 });
  for (const bad of [{ ...run, automationId: "other" }, { ...run, status: "new-unrepresentable-state" }]) {
    await assert.rejects(listRoutineRuns("daily", 1, wire({ runs: [bad] }).transport));
  }
  await assert.rejects(listRoutineRuns("daily", 101, wire({ runs: [] }).transport));
});

test("log lookup uses run identity rather than a recent-history scan and checks automation ownership", async () => {
  const { calls, transport } = wire({ run });
  assert.deepEqual(await readRoutineLog("daily", "old-run", transport), { log: "A stored log", truncated: false });
  assert.deepEqual(calls[1].body, { action: actions[3], id: "old-run" });
  assert.equal(await readRoutineLog("another", "old-run", transport), null);
  assert.equal(await readRoutineLog("daily", "old-run", wire({ run: null }).transport), null);
});

test("log presentation redacts stored secrets without claiming receipt authentication", async () => {
  const result = await readRoutineLog("daily", "old-run", wire({ run: { ...run, logJson: 'authorization: Bearer synthetic-fixture-token' } }).transport);
  assert.ok(result);
  assert.doesNotMatch(result.log, /synthetic-fixture-token/);
});

test("offline reads remain degraded failures rather than empty successful results", async () => {
  await assert.rejects(listRoutines(async () => ({ ok: false, status: 0, data: null })), error =>
    error instanceof CovenAutomationsUnavailableError && error.degraded);
});

test("the real byte transport preserves a supported multi-prompt inventory above 16 KiB", async () => {
  const first = { ...routine, prompt: "x".repeat(9_000) };
  const second = { ...first, id: "evening" };
  const inventory = { routines: [first, second], revisionById: { daily: 4, evening: 1 }, tombstonedAtById: {} };
  const fixture = wire(inventory);
  const requests: DaemonByteRequest[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const response = await fixture.transport({ method: req.method as "GET" | "POST", path: req.url!,
      ...(text ? { body: JSON.parse(text) } : {}), maxResponseBytes: 4_194_304 });
    res.end(response.data);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await listRoutines(request => {
      requests.push(request);
      return callDaemonTargetBytes({ mode: "hub", label: "Server hub", url: `http://127.0.0.1:${address.port}` }, request);
    });
    assert.deepEqual(result.map(value => [value.id, value.prompt]), [["daily", first.prompt], ["evening", second.prompt]]);
    assert.equal(requests[0].maxResponseBytes, 16_384);
    assert.equal(requests[1].maxResponseBytes, 4_194_304);
    assert.ok(requests.every(request => request.retryTransportFailure === false));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
