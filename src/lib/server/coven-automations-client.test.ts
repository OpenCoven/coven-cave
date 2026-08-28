import assert from "node:assert/strict";
import test from "node:test";

import type { DaemonResponse } from "@/lib/coven-daemon";
import {
  CovenAutomationsUnavailableError,
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

function transportWith(
  handler: (request: CapturedRequest) => DaemonResponse<unknown>,
) {
  const calls: CapturedRequest[] = [];
  const transport = async (request: CapturedRequest): Promise<DaemonResponse<unknown>> => {
    calls.push(request);
    return handler(request);
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

test("deleteRoutine reports the deletion flag", async () => {
  const { transport } = transportWith(() => okPayload({ id: "daily-notes", deleted: true }));
  assert.equal(await deleteRoutine("daily-notes", transport), true);
});

test("updateRoutine keeps schema defaults", async () => {
  const { calls, transport } = transportWith((request) => {
    const body = request.body as { definition: Record<string, unknown> };
    return okPayload({ routine: { ...ROUTINE, ...body.definition } });
  });
  const updated = await updateRoutine(
    { ...ROUTINE, name: "Daily notes v2" },
    transport,
  );
  assert.equal(updated.name, "Daily notes v2");
  assert.equal((calls[0]?.body as { definition: Record<string, unknown> }).definition.schemaVersion, 1);
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
