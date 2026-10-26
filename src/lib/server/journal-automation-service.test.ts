// @ts-nocheck
// /api/journal/automation logic against an injected daemon transport — no
// real daemon, and a throwaway COVEN_HOME for the routine's journal dir.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeDefinitionDigest } from "@opencoven/coven-client";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-journal-automation-"));
process.env.COVEN_HOME = root;

const service = await import("./journal-automation-service.ts");
const { journalRoutineId } = await import("../journal-automation.ts");

test.after(async () => {
  delete process.env.COVEN_HOME;
  await rm(root, { recursive: true, force: true });
});

function okPayload(payload) {
  return {
    ok: true,
    status: 200,
    data: { ok: true, accepted: true, action: "x", status: "completed", event: { kind: "k", action: "x", payload } },
  };
}

/** A tiny in-memory automations daemon. */
function fakeDaemon({ routines = [], runs = {}, offline = false, reject = null, runOutcome = null } = {}) {
  const store = new Map(routines.map((r) => [r.id, { schemaVersion: 1, name: "Daily reflection", status: "PAUSED", rrule: "FREQ=DAILY;BYHOUR=8", timezone: "UTC", misfire: "latest", overlap: "forbid", timeoutMinutes: 10, runtime: "coven-code", familiarId: "astra", prompt: "Reflect", tags: [], ...r }]));
  const documents = new Map();
  const revisions = new Map(routines.map((r) => [r.id, 1]));
  const calls = [];
  const transport = async (request) => {
    calls.push(request.body);
    if (offline) return { ok: false, status: 0, data: null, error: "daemon unavailable: connect ECONNREFUSED" };
    const { action, ...params } = request.body;
    if (reject && reject.action === action) {
      return { ok: true, status: 200, data: { ok: true, accepted: false, action, status: "rejected", reason: reject.reason } };
    }
    switch (action) {
      case "coven.automations.list":
        return okPayload({ routines: [...store.values()] });
      case "coven.automations.create": {
        const routine = { ...params.definition };
        store.set(routine.id, routine);
        revisions.set(routine.id, 1);
        return okPayload({ routine });
      }
      // Edits go through Coven's versioned revise at the revision just read.
      case "coven.automations.definition.get.v1":
        return okPayload(store.has(params.id)
          ? { routine: store.get(params.id), revision: revisions.get(params.id), tombstonedAt: null }
          : { routine: null });
      case "coven.automations.definition.revise.v1": {
        const routine = { ...params.definition };
        if (params.expectedRevision !== revisions.get(routine.id)) {
          return { ok: false, status: 409, data: { ok: false, accepted: false, action, status: "rejected", reason: "conflict",
            error: { code: "REVISION_CONFLICT", currentRevision: revisions.get(routine.id) } } };
        }
        store.set(routine.id, routine);
        revisions.set(routine.id, params.expectedRevision + 1);
        return okPayload({ outcome: "committed", revision: params.expectedRevision + 1, result: { routine, revision: params.expectedRevision + 1 } });
      }
      case "coven.automations.runs":
        return okPayload({ runs: runs[params.id] ?? [] });
      case "coven.automations.run":
        return okPayload(runOutcome ?? { runId: "run-1", status: "running", sessionId: "s-1" });
      default:
        return okPayload({ error: `unknown action ${action}` });
    }
  };
  const readTransport = async (request) => {
    if (offline) return { ok: false, status: 0, data: null };
    if (request.method === "GET") return { ok: true, status: 200, data: Buffer.from(JSON.stringify({ capabilities: [{
      id: "coven.automations", label: "Automations", adapter: "coven-daemon", status: "available", policy: "allow",
      actions: ["coven.automations.definition.get.v1", "coven.automations.runs", "coven.automations.command.v1", "coven.automations.definition.create.v1", "coven.automations.definition.revise.v1", "coven.automations.definition.pause.v1"],
      variantNegotiation: { version: 1, contractProfile: "coven.automations.v1", description: "Fixture",
        supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
        experimental: [], refused: [], negotiationRules: [] },
    }] })) };
    if (request.body.action === "coven.automations.command.v1") {
      calls.push(request.body);
      const { command, adoptionKey, expectedRevision, payload } = request.body.envelope;
      const id = payload.definition?.automationId ?? payload.automationId;
      const conflict = command !== "definition.create.v1" && expectedRevision !== revisions.get(id);
      const refused = conflict || reject?.action === "coven.automations.command.v1";
      if (refused) {
        const code = conflict ? "REVISION_CONFLICT" : "VALIDATION_FAILED";
        return { ok: false, status: 409, data: Buffer.from(JSON.stringify({ ok: false, accepted: false, action: request.body.action, status: "rejected", result: {
          schemaVersion: "coven.automations.v1", command, adoptionKey, outcome: "rejected", error: { code, message: "refused", httpStatus: 409, retryable: false, currentRevision: revisions.get(id) },
        } })) };
      }
      const nextRevision = command === "definition.create.v1" ? 1 : expectedRevision + 1;
      let doc = payload.definition;
      if (command === "definition.pause.v1") {
        doc = { ...documents.get(id), lifecycleState: "paused", revision: nextRevision };
        doc.integrity = computeDefinitionDigest(doc).digest;
      }
      documents.set(id, doc);
      revisions.set(id, nextRevision);
      store.set(id, { schemaVersion: 1, id, name: doc.display.name, status: doc.lifecycleState === "active" ? "ACTIVE" : "PAUSED",
        rrule: doc.trigger.schedule.rrule, timezone: doc.trigger.schedule.timezone, misfire: "latest", overlap: "forbid",
        timeoutMinutes: doc.policies.timeout.perRunMinutes, runtime: doc.runtimeRequirements.runtimeId, familiarId: doc.binding.familiarId,
        cwd: doc.action.cwd, prompt: doc.action.prompt, model: doc.runtimeRequirements.model, tags: doc.display.tags ?? [], retry: doc.policies.retry });
      return { ok: true, status: 200, data: Buffer.from(JSON.stringify({ ok: true, accepted: true, action: request.body.action, status: "completed", result: {
        schemaVersion: "coven.automations.v1", command, adoptionKey, outcome: "committed", revision: nextRevision, result: {},
      } })) };
    }
    const response = await transport(request);
    const action = request.body.action;
    if (!response.data?.accepted) return { ok: false, status: 400, data: Buffer.from(JSON.stringify({ ok: false, accepted: false, action, status: "rejected", reason: "refused" })) };
    const payload = response.data.event.payload;
    if (action === "coven.automations.definition.get.v1" && documents.has(request.body.id)) payload.definition = documents.get(request.body.id);
    if (payload.runs) payload.runs = payload.runs.map(run => ({ occurrenceId: null, sessionId: null, familiarId: null, runtime: null,
      exitCode: null, logJson: null, outputCommit: null, finishedAt: null, receiptId: null, attempts: [], ...run }));
    return { ok: true, status: 200, data: Buffer.from(JSON.stringify({ ok: true, accepted: true, action, status: "completed", event: { kind: "automations.changed", action, payload } })) };
  };
  return { transport, readTransport, calls, store };
}

const astraId = journalRoutineId("astra");
let adoptionCounter = 0;
const mutation = () => ({ adoptionKey: `journal-test:${++adoptionCounter}`, source: null, timezone: "UTC" });
const parsePut = body => service.parseJournalAutomationPut(body && { mutation: mutation(), ...body });
async function saveReviewed(input, deps) {
  const observed = await service.readJournalAutomation(input.familiar, deps);
  const source = observed.body.routine?.reviewedSource ?? null;
  return service.saveJournalAutomation({ ...input, mutation: { ...mutation(), source, ...(source ? { expectedRevision: source.revision } : {}) } }, deps);
}

test("journal editing refuses a stale reviewed source without replacing a newer schedule", async () => {
  const daemon = fakeDaemon({ routines: [{ id: astraId, status: "PAUSED", tags: ["personal"], model: "chosen-model" }] });
  const observed = await service.readJournalAutomation("astra", daemon);
  const source = observed.body.routine.reviewedSource;
  const input = { familiar: "astra", enabled: true, hour: 9, minute: 0, familiarName: "Astra",
    mutation: { ...mutation(), source, expectedRevision: source.revision } };
  const first = await service.saveJournalAutomation(input, daemon);
  assert.equal(first.status, 200);
  const stale = await service.saveJournalAutomation({ ...input, hour: 16,
    mutation: { ...input.mutation, adoptionKey: mutation().adoptionKey } }, daemon);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.conflict, true);
  assert.equal(daemon.store.get(astraId).rrule, "FREQ=DAILY;BYHOUR=9");
  assert.equal(daemon.store.get(astraId).model, "chosen-model");
  assert.deepEqual(daemon.store.get(astraId).tags, ["personal", "journal"]);
});

test("a lost journal command response remains uncertain and does not trigger another mutation", async () => {
  const daemon = fakeDaemon();
  let commands = 0;
  const readTransport = async request => {
    if (request.body?.action === "coven.automations.command.v1") {
      commands += 1;
      await daemon.readTransport(request);
      return { ok: false, status: 0, data: null };
    }
    return daemon.readTransport(request);
  };
  const result = await service.saveJournalAutomation({ familiar: "astra", enabled: true, hour: 9, minute: 0,
    familiarName: "Astra", mutation: mutation() }, { ...daemon, readTransport });
  assert.equal(result.status, 503);
  assert.equal(result.body.uncertain, true);
  assert.equal(commands, 1);
  assert.equal(daemon.store.has(astraId), true, "the fixture committed before dropping the reply");
  assert.equal(daemon.calls.some(call => call.envelope?.command === "definition.activate.v1"), false);
});

test("GET reports no routine yet as available + null", async () => {
  const daemon = fakeDaemon();
  const result = await service.readJournalAutomation("astra", { ...daemon });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, available: true, routine: null, lastRun: null, lastRunEntry: null, lastRunFailure: null });
});

test("GET returns the routine with its parsed time and the newest run", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, name: "x", status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["journal"] }],
    runs: {
      [astraId]: [
        { id: "r1", automationId: astraId, runtime: "coven-code", status: "succeeded", startedAt: "2026-09-29T21:30:00Z" },
        { id: "r2", automationId: astraId, runtime: "coven-code", status: "failed", startedAt: "2026-09-30T21:30:00Z" },
      ],
    },
  });
  const result = await service.readJournalAutomation("astra", { ...daemon });
  assert.equal(result.body.routine.hour, 21);
  assert.equal(result.body.routine.minute, 0);
  assert.equal(result.body.routine.status, "ACTIVE");
  assert.equal(result.body.lastRun.id, "r2", "the newest run by startedAt, whatever the ledger order");
});

test("GET with an invalid familiar never reaches the daemon", async () => {
  const daemon = fakeDaemon();
  for (const bad of [null, "", "../astra", "a/b"]) {
    const result = await service.readJournalAutomation(bad, { ...daemon });
    assert.equal(result.status, 400);
  }
  assert.equal(daemon.calls.length, 0);
});

test("an offline daemon is reported as unavailable (503), never papered over", async () => {
  const daemon = fakeDaemon({ offline: true });
  const read = await service.readJournalAutomation("astra", { ...daemon });
  assert.equal(read.status, 503);
  assert.equal(read.body.ok, false);
  assert.equal(read.body.available, false);
  assert.match(read.body.error, /unavailable/);
  const put = await saveReviewed(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "Astra" },
    { ...daemon },
  );
  assert.equal(put.status, 503);
  assert.equal(put.body.available, false);
  const run = await service.runJournalAutomation("astra", { ...daemon });
  assert.equal(run.status, 503);
});

test("a daemon too old for coven.automations.* is unavailable, not a validation error", async () => {
  const daemon = fakeDaemon({ reject: { action: "coven.automations.definition.get.v1", reason: "unknown action" } });
  const read = await service.readJournalAutomation("astra", { ...daemon });
  assert.equal(read.status, 503);
  assert.equal(read.body.available, false);
});

test("PUT enable creates a PAUSED coven-code routine in the familiar's journal dir", async () => {
  const daemon = fakeDaemon();
  const result = await saveReviewed(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "Astra" },
    { ...daemon, workspaceDir: async () => "/ws/astra" },
  );
  assert.equal(result.status, 200);
  const created = daemon.store.get(astraId);
  const journalDir = path.join(root, "journal", "familiars", "astra");
  assert.equal(created.id, astraId);
  assert.equal(created.status, "PAUSED");
  assert.equal(daemon.calls.some(call => call.envelope?.command === "definition.activate.v1"), false);
  assert.equal(created.rrule, "FREQ=DAILY;BYHOUR=21");
  assert.equal(created.runtime, "coven-code");
  assert.equal(created.timeoutMinutes, 10);
  assert.deepEqual(created.tags, ["journal"]);
  assert.equal(created.familiarId, "astra");
  assert.equal(created.cwd, journalDir, "the routine's cwd is the familiar's journal dir");
  assert.equal(created.timezone, "UTC");
  assert.ok((await stat(journalDir)).isDirectory(), "the cwd exists before the routine is created");
  assert.ok(created.prompt.includes(`${journalDir}/<day>.md`), "the prompt names the entry files it writes");
  assert.match(created.prompt, /board\.json'/, "the prompt reads the Cave board by default");
  assert.ok(created.prompt.includes("/ws/astra"), "the prompt names the familiar's workspace");
  assert.equal(result.body.routine.hour, 21);
});

test("PUT disable pauses an existing routine and keeps its model + tags", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["mine"], model: "m-1" }],
  });
  const result = await saveReviewed(
    { familiar: "astra", enabled: false, hour: 7, minute: 0, familiarName: null },
    { ...daemon },
  );
  assert.equal(result.status, 200);
  const updated = daemon.store.get(astraId);
  assert.equal(updated.status, "PAUSED");
  assert.equal(updated.rrule, "FREQ=DAILY;BYHOUR=7", "the time changes with the same save");
  assert.equal(updated.model, "m-1");
  assert.deepEqual(updated.tags, ["mine", "journal"]);
  assert.equal(daemon.calls.some((c) => c.action === "coven.automations.create"), false);
});

test("PUT keeps a routine's runtime unless a new one is chosen", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: [], runtime: "copilot" }],
  });
  await saveReviewed(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null, runtime: null },
    { ...daemon },
  );
  assert.equal(daemon.store.get(astraId).runtime, "copilot", "a save without a choice keeps the current harness");
  await saveReviewed(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null, runtime: "codex" },
    { ...daemon },
  );
  assert.equal(daemon.store.get(astraId).runtime, "codex", "an explicit choice switches it");
  assert.equal(typeof parsePut({ familiar: "astra", enabled: true, hour: 1, runtime: "bash" }), "string", "only known harnesses");
  assert.equal(parsePut({ familiar: "astra", enabled: true, hour: 1, runtime: "claude" }).runtime, "claude");
});

test("a succeeded run that wrote nothing is reported as not written", async () => {
  // A signed-out harness prints "Login expired" and still exits 0, so the
  // daemon says succeeded. The entry check is what tells the pane otherwise.
  const startedAt = "2026-10-01T20:22:03.000Z";
  const routines = [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: [] }];
  const runs = { [astraId]: [{ id: "r1", automationId: astraId, runtime: "coven-code", status: "succeeded", startedAt, sessionId: "s-1" }] };
  const day = (() => {
    const d = new Date(startedAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const missing = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async () => ({ exists: false, source: null, modified: null }),
  });
  assert.deepEqual(missing.body.lastRunEntry, { date: day, written: false });

  const stale = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async () => ({ exists: true, source: "familiar", modified: "2026-10-01T08:00:00.000Z" }),
  });
  assert.equal(stale.body.lastRunEntry.written, false, "an entry older than the run is not this run's");

  const legacy = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async () => ({ exists: true, source: "legacy", modified: "2026-10-01T20:23:00.000Z" }),
  });
  assert.equal(legacy.body.lastRunEntry.written, false, "the routine only ever writes the familiar's own file");

  const written = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async (date, familiar) => {
      assert.equal(date, day, "the run's local day is checked");
      assert.equal(familiar, "astra");
      return { exists: true, source: "familiar", modified: "2026-10-01T20:23:00.000Z" };
    },
  });
  assert.deepEqual(written.body.lastRunEntry, { date: day, written: true });

  const running = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs: { [astraId]: [{ ...runs[astraId][0], status: "running" }] } }),
    readEntry: async () => assert.fail("a running run is not checked"),
  });
  assert.equal(running.body.lastRunEntry, null);
});

test("current routines are checked for the day before the run, and a skipped day counts", async () => {
  // v3+ routines reflect on yesterday and leave an existing entry alone, so
  // the entry for the previous local day is what the run is answerable for.
  const { buildJournalRoutinePrompt } = await import("../journal-automation.ts");
  const prompt = buildJournalRoutinePrompt({ familiarId: "astra", journalDir: "/j/astra" });
  const startedAt = "2026-10-07T13:00:00.000Z";
  const routines = [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=8", tags: [], prompt }];
  const runs = { [astraId]: [{ id: "r1", automationId: astraId, runtime: "coven-code", status: "succeeded", startedAt, sessionId: "s-1" }] };
  const previousDay = (() => {
    const d = new Date(startedAt);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const written = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async (date) => {
      assert.equal(date, previousDay, "the reflected day, not the run's own day");
      return { exists: true, source: "familiar", modified: "2026-10-06T23:00:00.000Z" };
    },
  });
  assert.deepEqual(written.body.lastRunEntry, { date: previousDay, written: true }, "an entry the run left as written still counts");

  const missing = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async () => ({ exists: false, source: null, modified: null }),
  });
  assert.deepEqual(missing.body.lastRunEntry, { date: previousDay, written: false });

  const legacy = await service.readJournalAutomation("astra", {
    ...fakeDaemon({ routines, runs }),
    readEntry: async () => ({ exists: true, source: "legacy", modified: "2026-10-07T13:01:00.000Z" }),
  });
  assert.equal(legacy.body.lastRunEntry.written, false, "a legacy file is never the routine's");
});

test("PUT with boardPath null leaves the board step out of the prompt", async () => {
  const daemon = fakeDaemon();
  await saveReviewed(
    { familiar: "astra", enabled: true, hour: 8, minute: 0, familiarName: "Astra" },
    { ...daemon, boardPath: null },
  );
  const created = daemon.store.get(astraId);
  assert.match(created.prompt, /echo 'no board'/);
});

test("PUT with hour null keeps a schedule set elsewhere", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=WEEKLY;BYHOUR=9;BYDAY=MO", tags: [], runtime: "copilot" }],
  });
  const result = await saveReviewed(
    { familiar: "astra", enabled: false, hour: null, minute: 0, familiarName: null, runtime: null },
    { ...daemon },
  );
  assert.equal(result.status, 200);
  const updated = daemon.store.get(astraId);
  assert.equal(updated.rrule, "FREQ=WEEKLY;BYHOUR=9;BYDAY=MO", "the custom rule is untouched");
  assert.equal(updated.runtime, "copilot", "and so is the harness");
  assert.equal(updated.status, "PAUSED");
  assert.equal(result.body.routine.hour, null, "the pane is told it is not a single daily hour");

  const fresh = await saveReviewed(
    { familiar: "nova", enabled: true, hour: null, minute: 0, familiarName: null, runtime: null },
    { ...fakeDaemon() },
  );
  assert.equal(fresh.status, 400, "a new routine needs an hour");
  assert.equal(parsePut({ familiar: "astra", enabled: true, hour: null }).hour, null);
  assert.equal(typeof parsePut({ familiar: "astra", enabled: true }), "string", "a missing hour is still refused");
});

test("PUT disable with no routine is a no-op", async () => {
  const daemon = fakeDaemon();
  const result = await saveReviewed(
    { familiar: "nova", enabled: false, hour: 21, minute: 0, familiarName: null },
    { ...daemon },
  );
  assert.deepEqual(result.body, { ok: true, available: true, routine: null, lastRun: null });
  assert.deepEqual(daemon.calls.map((c) => c.action), ["coven.automations.definition.get.v1"]);
});

test("PUT surfaces a daemon refusal as 422 with the reason", async () => {
  const daemon = fakeDaemon({ reject: { action: "coven.automations.command.v1", reason: "cwd outside task boundary" } });
  const result = await saveReviewed(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null },
    { ...daemon },
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.available, true);
  assert.match(result.body.error, /VALIDATION_FAILED/);
});

test("parseJournalAutomationPut validates every field", () => {
  const good = { mutation: mutation(), familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "  Astra\nthe Bright " };
  assert.deepEqual(parsePut(good), {
    mutation: good.mutation,
    familiar: "astra",
    enabled: true,
    hour: 21,
    minute: 0,
    familiarName: "Astra the Bright",
    runtime: null,
  });
  assert.equal(typeof parsePut(null), "string");
  assert.equal(typeof parsePut({ ...good, familiar: "../x" }), "string");
  assert.equal(typeof parsePut({ ...good, enabled: "yes" }), "string");
  assert.equal(typeof parsePut({ ...good, hour: 24 }), "string");
  assert.equal(typeof parsePut({ ...good, minute: "30" }), "string");
  assert.equal(typeof parsePut({ ...good, minute: 30 }), "string", "the native scheduler cannot run at :30");
  const { minute: _omit, ...noMinute } = good;
  assert.equal(parsePut(noMinute).minute, 0, "minute is optional and means :00");
});

test("POST run needs an existing routine, then runs it", async () => {
  const empty = fakeDaemon();
  const missing = await service.runJournalAutomation("astra", { ...empty });
  assert.equal(missing.status, 404);
  assert.equal(empty.calls.some((c) => c.action === "coven.automations.run"), false);

  const daemon = fakeDaemon({ routines: [{ id: astraId, status: "PAUSED", rrule: "FREQ=DAILY;BYHOUR=21", tags: [] }] });
  const ran = await service.runJournalAutomation("astra", { ...daemon });
  assert.equal(ran.status, 200);
  assert.deepEqual(ran.body.run, { runId: "run-1", status: "running", sessionId: "s-1" });
  assert.deepEqual(daemon.calls.at(-1), { action: "coven.automations.run", id: astraId });
});

test("POST run reports a failed run with the daemon's error", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: [] }],
    runOutcome: { runId: "run-2", status: "failed", error: "runtime coven-code not installed" },
  });
  const result = await service.runJournalAutomation("astra", { ...daemon });
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /not installed/);
});

test("GET explains a failed last run from its session log", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, name: "x", status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["journal"] }],
    runs: {
      [astraId]: [
        { id: "r9", automationId: astraId, runtime: "claude", status: "failed", sessionId: "session-q", startedAt: "2026-10-06T02:00:29Z" },
      ],
    },
  });
  const asked = [];
  const result = await service.readJournalAutomation("astra", {
    ...daemon,
    readSessionLog: async (id) => {
      asked.push(id);
      return [{ message: "You've hit your weekly limit · resets 1am (America/Chicago)\n" }, { message: 'exit: {"exitCode":1}' }];
    },
  });
  assert.deepEqual(asked, ["session-q"]);
  assert.equal(result.body.lastRunFailure.kind, "quota");
  assert.match(result.body.lastRunFailure.message, /weekly limit/);
});

test("GET leaves lastRunFailure null for a succeeded run or an unreadable log", async () => {
  const routines = [{ id: astraId, name: "x", status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["journal"] }];
  const ok = fakeDaemon({ routines, runs: { [astraId]: [{ id: "r1", automationId: astraId, runtime: "claude", status: "succeeded", sessionId: "s", startedAt: "2026-10-06T02:00:29Z" }] } });
  let reads = 0;
  const okResult = await service.readJournalAutomation("astra", {
    ...ok,
    readSessionLog: async () => { reads += 1; return []; },
    readEntry: async () => ({ exists: true, source: "file", modified: "2026-10-06T02:01:00Z" }),
  });
  assert.equal(okResult.body.lastRunFailure, null);
  assert.equal(reads, 0, "a succeeded run's log is never read");
  const failed = fakeDaemon({ routines, runs: { [astraId]: [{ id: "r2", automationId: astraId, runtime: "claude", status: "failed", sessionId: "s", startedAt: "2026-10-06T02:00:29Z" }] } });
  const failedResult = await service.readJournalAutomation("astra", {
    ...failed,
    readSessionLog: async () => { throw new Error("daemon down"); },
  });
  assert.equal(failedResult.status, 200, "a log read failure never hides the routine");
  assert.equal(failedResult.body.lastRunFailure, null);
});

test("GET flags a routine saved with older reflection instructions", async () => {
  const { JOURNAL_ROUTINE_PROMPT_MARKER } = await import("../journal-automation.ts");
  const base = { id: astraId, name: "x", status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["journal"] };
  const stale = await service.readJournalAutomation("astra", { ...fakeDaemon({ routines: [{ ...base, prompt: "You are Astra, writing today's entry." }] }) });
  assert.equal(stale.body.promptOutdated, true);
  const fresh = await service.readJournalAutomation("astra", { ...fakeDaemon({ routines: [{ ...base, prompt: `...\n${JOURNAL_ROUTINE_PROMPT_MARKER}` }] }) });
  assert.equal(fresh.body.promptOutdated, false);
  const none = await service.readJournalAutomation("astra", { ...fakeDaemon() });
  assert.equal(none.body.promptOutdated, undefined, "no routine, nothing to update");
});

test("a saved routine's prompt carries the current instructions marker", async () => {
  const { JOURNAL_ROUTINE_PROMPT_MARKER } = await import("../journal-automation.ts");
  const daemon = fakeDaemon();
  const result = await saveReviewed(
    { familiar: "astra", enabled: true, hour: 4, minute: 0, familiarName: "Astra" },
    { ...daemon },
  );
  assert.ok(result.body.routine.prompt.includes(JOURNAL_ROUTINE_PROMPT_MARKER));
  assert.equal(result.body.promptOutdated, false);
});


test("journal lookup is one typed get at the stable ID and exposes its reviewed revision", async () => {
  const daemon = fakeDaemon({ routines: [{ id: astraId, status: "PAUSED" }] });
  const result = await service.readJournalAutomation("astra", daemon);
  assert.equal(result.status, 200);
  assert.equal(daemon.calls[0].action, "coven.automations.definition.get.v1");
  assert.equal(daemon.calls[0].id, astraId);
  assert.equal(result.body.routine.revision, 1);
  assert.equal(result.body.routine.reviewedSource.routine.id, astraId);
});

test("a history failure preserves the journal definition while identifying unavailable run evidence", async () => {
  const daemon = fakeDaemon({ routines: [{ id: astraId }], reject: { action: "coven.automations.runs", reason: "unreadable" } });
  const result = await service.readJournalAutomation("astra", daemon);
  assert.equal(result.status, 200);
  assert.equal(result.body.routine.id, astraId);
  assert.equal(result.body.lastRun, null);
  assert.equal(result.body.lastRunUnavailable, true);
});


test("journal writes without a caller revision and adoption contract are refused before any daemon call", async () => {
  const daemon = fakeDaemon();
  const result = await service.saveJournalAutomation({ familiar: "astra", enabled: true, hour: 8, minute: 0, familiarName: null, runtime: null }, daemon);
  assert.equal(result.status, 400);
  assert.equal(daemon.calls.length, 0);
});

test("journal retry keeps its prepared prompt when the familiar workspace changes", async () => {
  const daemon = fakeDaemon();
  let workspace = "/workspace/original";
  const commands = [];
  const deps = { ...daemon, workspaceDir: async () => workspace, readTransport: async request => {
    if (request.body?.action === "coven.automations.command.v1") {
      commands.push(request.body);
      return { ok: false, status: 0, data: null };
    }
    return daemon.readTransport(request);
  } };
  const input = { familiar: "astra", enabled: true, hour: 9, minute: 0, familiarName: "Astra", mutation: mutation() };
  const first = await service.saveJournalAutomation(input, deps);
  assert.equal(first.body.uncertain, true);
  workspace = "/workspace/changed";
  await service.saveJournalAutomation(input, deps);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], commands[0], "the exact command, including derived prompt, must survive retry");
});
