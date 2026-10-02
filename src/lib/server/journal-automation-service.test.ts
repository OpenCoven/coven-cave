// @ts-nocheck
// /api/journal/automation logic against an injected daemon transport — no
// real daemon, and a throwaway COVEN_HOME for the routine's journal dir.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  const store = new Map(routines.map((r) => [r.id, r]));
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
      case "coven.automations.create":
      case "coven.automations.update": {
        const routine = { ...params.definition };
        store.set(routine.id, routine);
        return okPayload({ routine });
      }
      case "coven.automations.runs":
        return okPayload({ runs: runs[params.id] ?? [] });
      case "coven.automations.run":
        return okPayload(runOutcome ?? { runId: "run-1", status: "running", sessionId: "s-1" });
      default:
        return okPayload({ error: `unknown action ${action}` });
    }
  };
  return { transport, calls, store };
}

const astraId = journalRoutineId("astra");

test("GET reports no routine yet as available + null", async () => {
  const daemon = fakeDaemon();
  const result = await service.readJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, available: true, routine: null, lastRun: null, lastRunEntry: null });
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
  const result = await service.readJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(result.body.routine.hour, 21);
  assert.equal(result.body.routine.minute, 0);
  assert.equal(result.body.routine.status, "ACTIVE");
  assert.equal(result.body.lastRun.id, "r2", "the newest run by startedAt, whatever the ledger order");
});

test("GET with an invalid familiar never reaches the daemon", async () => {
  const daemon = fakeDaemon();
  for (const bad of [null, "", "../astra", "a/b"]) {
    const result = await service.readJournalAutomation(bad, { transport: daemon.transport });
    assert.equal(result.status, 400);
  }
  assert.equal(daemon.calls.length, 0);
});

test("an offline daemon is reported as unavailable (503), never papered over", async () => {
  const daemon = fakeDaemon({ offline: true });
  const read = await service.readJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(read.status, 503);
  assert.equal(read.body.ok, false);
  assert.equal(read.body.available, false);
  assert.match(read.body.error, /daemon unavailable/);
  const put = await service.saveJournalAutomation(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "Astra" },
    { transport: daemon.transport },
  );
  assert.equal(put.status, 503);
  assert.equal(put.body.available, false);
  const run = await service.runJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(run.status, 503);
});

test("a daemon too old for coven.automations.* is unavailable, not a validation error", async () => {
  const daemon = fakeDaemon({ reject: { action: "coven.automations.list", reason: "unknown action" } });
  const read = await service.readJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(read.status, 503);
  assert.equal(read.body.available, false);
});

test("PUT enable creates an ACTIVE coven-code routine in the familiar's journal dir", async () => {
  const daemon = fakeDaemon();
  const result = await service.saveJournalAutomation(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "Astra" },
    { transport: daemon.transport, workspaceDir: async () => "/ws/astra" },
  );
  assert.equal(result.status, 200);
  const created = daemon.calls.find((c) => c.action === "coven.automations.create").definition;
  const journalDir = path.join(root, "journal", "familiars", "astra");
  assert.equal(created.id, astraId);
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.rrule, "FREQ=DAILY;BYHOUR=21");
  assert.equal(created.runtime, "coven-code");
  assert.equal(created.timeoutMinutes, 10);
  assert.deepEqual(created.tags, ["journal"]);
  assert.equal(created.familiarId, "astra");
  assert.equal(created.cwd, journalDir, "the routine's cwd is the familiar's journal dir");
  assert.equal(created.timezone, "local");
  assert.ok((await stat(journalDir)).isDirectory(), "the cwd exists before the routine is created");
  assert.ok(created.prompt.includes(`${journalDir}/DATE.md`), "the prompt names the one file it writes");
  assert.ok(created.prompt.includes("/ws/astra"), "the prompt names the familiar's workspace");
  assert.equal(result.body.routine.hour, 21);
});

test("PUT disable pauses an existing routine and keeps its model + tags", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: ["mine"], model: "m-1" }],
  });
  const result = await service.saveJournalAutomation(
    { familiar: "astra", enabled: false, hour: 7, minute: 0, familiarName: null },
    { transport: daemon.transport },
  );
  assert.equal(result.status, 200);
  const updated = daemon.calls.find((c) => c.action === "coven.automations.update").definition;
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
  await service.saveJournalAutomation(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null, runtime: null },
    { transport: daemon.transport },
  );
  assert.equal(daemon.store.get(astraId).runtime, "copilot", "a save without a choice keeps the current harness");
  await service.saveJournalAutomation(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null, runtime: "codex" },
    { transport: daemon.transport },
  );
  assert.equal(daemon.store.get(astraId).runtime, "codex", "an explicit choice switches it");
  assert.equal(typeof service.parseJournalAutomationPut({ familiar: "astra", enabled: true, hour: 1, runtime: "bash" }), "string", "only known harnesses");
  assert.equal(service.parseJournalAutomationPut({ familiar: "astra", enabled: true, hour: 1, runtime: "claude" }).runtime, "claude");
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
    transport: fakeDaemon({ routines, runs }).transport,
    readEntry: async () => ({ exists: false, source: null, modified: null }),
  });
  assert.deepEqual(missing.body.lastRunEntry, { date: day, written: false });

  const stale = await service.readJournalAutomation("astra", {
    transport: fakeDaemon({ routines, runs }).transport,
    readEntry: async () => ({ exists: true, source: "familiar", modified: "2026-10-01T08:00:00.000Z" }),
  });
  assert.equal(stale.body.lastRunEntry.written, false, "an entry older than the run is not this run's");

  const legacy = await service.readJournalAutomation("astra", {
    transport: fakeDaemon({ routines, runs }).transport,
    readEntry: async () => ({ exists: true, source: "legacy", modified: "2026-10-01T20:23:00.000Z" }),
  });
  assert.equal(legacy.body.lastRunEntry.written, false, "the routine only ever writes the familiar's own file");

  const written = await service.readJournalAutomation("astra", {
    transport: fakeDaemon({ routines, runs }).transport,
    readEntry: async (date, familiar) => {
      assert.equal(date, day, "the run's local day is checked");
      assert.equal(familiar, "astra");
      return { exists: true, source: "familiar", modified: "2026-10-01T20:23:00.000Z" };
    },
  });
  assert.deepEqual(written.body.lastRunEntry, { date: day, written: true });

  const running = await service.readJournalAutomation("astra", {
    transport: fakeDaemon({ routines, runs: { [astraId]: [{ ...runs[astraId][0], status: "running" }] } }).transport,
    readEntry: async () => assert.fail("a running run is not checked"),
  });
  assert.equal(running.body.lastRunEntry, null);
});

test("PUT disable with no routine is a no-op", async () => {
  const daemon = fakeDaemon();
  const result = await service.saveJournalAutomation(
    { familiar: "nova", enabled: false, hour: 21, minute: 0, familiarName: null },
    { transport: daemon.transport },
  );
  assert.deepEqual(result.body, { ok: true, available: true, routine: null, lastRun: null });
  assert.deepEqual(daemon.calls.map((c) => c.action), ["coven.automations.list"]);
});

test("PUT surfaces a daemon refusal as 422 with the reason", async () => {
  const daemon = fakeDaemon({ reject: { action: "coven.automations.create", reason: "cwd outside task boundary" } });
  const result = await service.saveJournalAutomation(
    { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: null },
    { transport: daemon.transport },
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.available, true);
  assert.match(result.body.error, /cwd outside task boundary/);
});

test("parseJournalAutomationPut validates every field", () => {
  const good = { familiar: "astra", enabled: true, hour: 21, minute: 0, familiarName: "  Astra\nthe Bright " };
  assert.deepEqual(service.parseJournalAutomationPut(good), {
    familiar: "astra",
    enabled: true,
    hour: 21,
    minute: 0,
    familiarName: "Astra the Bright",
    runtime: null,
  });
  assert.equal(typeof service.parseJournalAutomationPut(null), "string");
  assert.equal(typeof service.parseJournalAutomationPut({ ...good, familiar: "../x" }), "string");
  assert.equal(typeof service.parseJournalAutomationPut({ ...good, enabled: "yes" }), "string");
  assert.equal(typeof service.parseJournalAutomationPut({ ...good, hour: 24 }), "string");
  assert.equal(typeof service.parseJournalAutomationPut({ ...good, minute: "30" }), "string");
  assert.equal(typeof service.parseJournalAutomationPut({ ...good, minute: 30 }), "string", "the native scheduler cannot run at :30");
  const { minute: _omit, ...noMinute } = good;
  assert.equal(service.parseJournalAutomationPut(noMinute).minute, 0, "minute is optional and means :00");
});

test("POST run needs an existing routine, then runs it", async () => {
  const empty = fakeDaemon();
  const missing = await service.runJournalAutomation("astra", { transport: empty.transport });
  assert.equal(missing.status, 404);
  assert.equal(empty.calls.some((c) => c.action === "coven.automations.run"), false);

  const daemon = fakeDaemon({ routines: [{ id: astraId, status: "PAUSED", rrule: "FREQ=DAILY;BYHOUR=21", tags: [] }] });
  const ran = await service.runJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(ran.status, 200);
  assert.deepEqual(ran.body.run, { runId: "run-1", status: "running", sessionId: "s-1" });
  assert.deepEqual(daemon.calls.at(-1), { action: "coven.automations.run", id: astraId });
});

test("POST run reports a failed run with the daemon's error", async () => {
  const daemon = fakeDaemon({
    routines: [{ id: astraId, status: "ACTIVE", rrule: "FREQ=DAILY;BYHOUR=21", tags: [] }],
    runOutcome: { runId: "run-2", status: "failed", error: "runtime coven-code not installed" },
  });
  const result = await service.runJournalAutomation("astra", { transport: daemon.transport });
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /not installed/);
});
