import assert from "node:assert/strict";
import test from "node:test";

import type { DaemonResponse } from "@/lib/coven-daemon";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import {
  CovenAutomationRevisionConflictError,
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutineRuns,
  listRoutines,
  runRoutine,
  updateRoutine,
} from "@/lib/server/coven-automations-client";
import { toCodexAutomationPayload, codexRruleText } from "@/lib/coven-automations-facade";

type CapturedRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};

function transportWith(handler: (request: CapturedRequest) => DaemonResponse<unknown>) {
  const calls: CapturedRequest[] = [];
  const transport = async <T = unknown>(request: CapturedRequest): Promise<DaemonResponse<T>> => {
    calls.push(request);
    return handler(request) as DaemonResponse<T>;
  };
  return { calls, transport };
}

function okPayload<T>(payload: T): DaemonResponse<unknown> {
  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      accepted: true,
      action: "x",
      status: "completed",
      event: { kind: "automations.changed", action: "x", payload },
    },
  };
}

const ROUTINE = {
  schemaVersion: 1,
  id: "daily-notes",
  name: "Daily notes",
  status: "PAUSED" as const,
  rrule: "FREQ=DAILY;BYHOUR=9",
  timezone: "utc" as const,
  misfire: "latest" as const,
  overlap: "forbid" as const,
  timeoutMinutes: 30,
  runtime: "coven-code",
  familiarId: "charm",
  cwd: "/work/project",
  prompt: "Write the reflection.",
  tags: ["reflection"],
};

test("listRoutines posts the list action and unwraps routines", async () => {
  const { calls, transport } = transportWith(() => okPayload({ routines: [ROUTINE] }));
  const routines = await listRoutines(transport);
  assert.deepEqual(calls[0]?.body, { action: "coven.automations.list" });
  assert.deepEqual(routines, [ROUTINE]);
});

test("createRoutine stamps schema defaults and returns the stored routine", async () => {
  const { calls, transport } = transportWith((request) => {
    const body = request.body as { definition: Record<string, unknown> };
    return okPayload({ routine: { ...ROUTINE, ...body.definition } });
  });
  const created = await createRoutine(
    {
      id: "daily-notes",
      name: "Daily notes",
      status: "PAUSED",
      rrule: "FREQ=DAILY;BYHOUR=9",
      prompt: "Write the reflection.",
      runtime: "coven-code",
      timeoutMinutes: 30,
      tags: [],
    },
    transport,
  );
  const definition = (calls[0]?.body as { definition: Record<string, unknown> }).definition;
  assert.equal(definition.schemaVersion, 1);
  assert.equal(definition.misfire, "latest");
  assert.equal(definition.overlap, "forbid");
  assert.equal(definition.timezone, "local");
  assert.equal(created.id, "daily-notes");
});

test("daemon offline surfaces as a degraded unavailable error", async () => {
  const { transport } = transportWith(() => ({
    ok: false,
    status: 0,
    data: null,
    error: "daemon offline",
  }));
  await assert.rejects(
    () => listRoutines(transport),
    (err: unknown) =>
      err instanceof CovenAutomationsUnavailableError &&
      err.degraded &&
      err.message.includes("daemon offline"),
  );
});

test("a rejected action surfaces as a non-degraded error", async () => {
  const { transport } = transportWith(() => ({
    ok: true,
    status: 200,
    data: {
      ok: true,
      accepted: false,
      action: "x",
      status: "rejected",
      reason: "no routine with id `missing`",
    },
  }));
  await assert.rejects(
    () => getRoutine("missing", transport),
    (err: unknown) =>
      err instanceof CovenAutomationsUnavailableError &&
      !err.degraded &&
      err.message.includes("missing"),
  );
});

test("an HTTP 400 rejection keeps the daemon's reason instead of reading as offline", async () => {
  // The live daemon answers a refused create with HTTP 400 and its envelope;
  // this used to collapse into "automations daemon unavailable".
  const { transport } = transportWith(() => ({
    ok: false,
    status: 400,
    data: {
      ok: false,
      accepted: false,
      action: "coven.automations.create",
      status: "rejected",
      reason: "rrule failed validation: rrule key `BYMINUTE` is not supported",
    },
  }));
  await assert.rejects(
    () => createRoutine({ ...ROUTINE, id: "journal-reflection-astra" }, transport),
    (err: unknown) =>
      err instanceof CovenAutomationsUnavailableError &&
      !err.degraded &&
      err.message.includes("BYMINUTE"),
  );
});

test("runRoutine surfaces failed runs without throwing", async () => {
  const { transport } = transportWith(() =>
    okPayload({ runId: "run-1", status: "failed", error: "routine has no cwd" }),
  );
  const outcome = await runRoutine("daily-notes", transport);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error, "routine has no cwd");
});

test("listRoutineRuns maps the ledger runs", async () => {
  const { transport } = transportWith(() =>
    okPayload({
      runs: [
        {
          id: "run-1",
          automationId: "daily-notes",
          runtime: "coven-code",
          status: "succeeded",
          startedAt: "2026-08-28T09:00:00.000Z",
        },
      ],
    }),
  );
  const runs = await listRoutineRuns("daily-notes", 20, transport);
  assert.equal(runs[0]?.status, "succeeded");
});

// Edits and deletes are versioned commands at an expected revision (#5217): once
// a versioned command touches a definition, Coven refuses the legacy update and
// turns the legacy delete into a no-op.
function versionedDaemon({ revision = 3, routine = ROUTINE as unknown, answer }: {
  revision?: number;
  routine?: unknown;
  answer?: (body: Record<string, unknown>) => DaemonResponse<unknown>;
} = {}) {
  return transportWith((request) => {
    const body = request.body as Record<string, unknown>;
    if (body.action === "coven.automations.definition.get.v1") {
      return okPayload(routine === null ? { routine: null } : { routine, revision, tombstonedAt: null });
    }
    if (answer) return answer(body);
    if (body.expectedRevision !== revision) {
      return { ok: false, status: 409, data: { ok: false, accepted: false, action: body.action, status: "rejected", reason: "moved",
        error: { code: "REVISION_CONFLICT", currentRevision: revision, httpStatus: 409, retryable: false } } };
    }
    return body.action === "coven.automations.definition.tombstone.v1"
      ? okPayload({ outcome: "committed", revision: revision + 1, result: { deleted: true, id: body.id, revision: revision + 1 } })
      : okPayload({ outcome: "committed", revision: revision + 1, result: { routine: body.definition, revision: revision + 1 } });
  });
}

test("deleteRoutine tombstones at the revision Coven holds", async () => {
  const { calls, transport } = versionedDaemon();
  assert.equal(await deleteRoutine("daily-notes", transport), true);
  const tombstone = calls[1]?.body as Record<string, unknown>;
  assert.equal(tombstone.action, "coven.automations.definition.tombstone.v1");
  assert.equal(tombstone.id, "daily-notes");
  assert.equal(tombstone.expectedRevision, 3);
  assert.match(String(tombstone.adoptionKey), /^cave-[0-9a-f-]{36}$/);
});

test("deleteRoutine reports false for a definition Coven does not hold, without sending a tombstone", async () => {
  const { calls, transport } = versionedDaemon({ routine: null });
  assert.equal(await deleteRoutine("daily-notes", transport), false);
  assert.equal(calls.length, 1);
});

test("a delete at a revision the definition has moved past is a typed conflict", async () => {
  const { transport } = versionedDaemon({ revision: 5 });
  await assert.rejects(deleteRoutine("daily-notes", transport, { expectedRevision: 4 }), (error) => {
    assert.ok(error instanceof CovenAutomationRevisionConflictError);
    assert.equal(error.currentRevision, 5);
    assert.equal(error.degraded, false);
    return true;
  });
});

test("updateRoutine revises at the expected revision and keeps schema defaults", async () => {
  const { calls, transport } = versionedDaemon({ revision: 2 });
  const updated = await updateRoutine({ ...ROUTINE, name: "Daily notes v2" }, transport);
  assert.equal(updated.name, "Daily notes v2");
  const revise = calls[1]?.body as { action: string; expectedRevision: number; definition: Record<string, unknown> };
  assert.equal(revise.action, "coven.automations.definition.revise.v1");
  assert.equal(revise.expectedRevision, 2);
  assert.equal(revise.definition.schemaVersion, 1);
  // A caller that saw a revision sends it, and no read is needed.
  const seen = versionedDaemon({ revision: 2 });
  await assert.rejects(updateRoutine({ ...ROUTINE }, seen.transport, { expectedRevision: 1 }), CovenAutomationRevisionConflictError);
  assert.equal((seen.calls[0]?.body as Record<string, unknown>).action, "coven.automations.definition.revise.v1");
});

test("a revise whose answer was lost is resent once under the same adoption key", async () => {
  let attempts = 0;
  const { calls, transport } = versionedDaemon({
    revision: 2,
    answer: (body) => (++attempts === 1
      ? { ok: false, status: 0, data: null, error: "socket hang up" }
      : okPayload({ outcome: "replayed", revision: 3, result: { routine: body.definition, revision: 3 }, replay: { firstCommittedAt: "x" } })),
  });
  const updated = await updateRoutine({ ...ROUTINE, name: "Again" }, transport);
  assert.equal(updated.name, "Again");
  const sends = calls.filter((call) => (call.body as Record<string, unknown>).action === "coven.automations.definition.revise.v1");
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].body, sends[1].body);
});

test("a revise Coven refuses for another reason keeps the reason and is not an outage", async () => {
  const { transport } = versionedDaemon({
    answer: (body) => ({ ok: false, status: 422, data: { ok: false, accepted: false, action: body.action, status: "rejected",
      reason: "disabled definitions must use an explicit lifecycle transition", error: { code: "ILLEGAL_TRANSITION" } } }),
  });
  await assert.rejects(updateRoutine({ ...ROUTINE }, transport), (error) => {
    assert.ok(error instanceof CovenAutomationsUnavailableError);
    assert.ok(!(error instanceof CovenAutomationRevisionConflictError));
    assert.equal(error.degraded, false);
    assert.match(error.message, /explicit lifecycle transition/);
    return true;
  });
});

test("facade maps daemon routines onto the Codex payload shape", () => {
  const payload = toCodexAutomationPayload(ROUTINE);
  assert.equal(payload.id, "daily-notes");
  assert.equal(payload.kind, "cron");
  assert.equal(payload.status, "PAUSED");
  assert.equal(payload.rrule, "RRULE:FREQ=DAILY;BYHOUR=9");
  assert.equal(payload.scheduleHuman, "Daily at 09:00");
  assert.deepEqual(payload.familiars, ["charm"]);
  assert.deepEqual(payload.cwds, ["/work/project"]);
});

test("codexRruleText does not double the RRULE prefix", () => {
  assert.equal(codexRruleText("FREQ=DAILY"), "RRULE:FREQ=DAILY");
  assert.equal(codexRruleText("RRULE:FREQ=DAILY"), "RRULE:FREQ=DAILY");
});

console.log("coven automations client: ok");
