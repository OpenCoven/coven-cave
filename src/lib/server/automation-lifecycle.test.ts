import assert from "node:assert/strict";
import test from "node:test";
import { CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import type { CovenAutomationRoutine } from "@opencoven/coven-client";
import {
  readAutomationLifecycleDetail,
  readAutomationLifecycleOverview,
  sendAutomationLifecycleCommand,
} from "./automation-lifecycle.ts";

const signal = new AbortController().signal;
const failure = (code: string) => new CovenClientError(normalizeCovenError({ code }, "automations.read"));

function routine(id: string, status: CovenAutomationRoutine["status"], extra: Partial<CovenAutomationRoutine> = {}): CovenAutomationRoutine {
  return {
    schemaVersion: 1, id, name: id, status, rrule: "FREQ=DAILY;BYHOUR=9", timezone: "America/Chicago",
    misfire: "latest", overlap: "forbid", timeoutMinutes: 5, runtime: "coven-code", prompt: "secret prompt text", ...extra,
  };
}

const query = (...ids: string[]) => new URLSearchParams(ids.map((id) => ["id", id]));

function reader(overrides: Partial<{ list: () => Promise<unknown>; get: (id: string) => Promise<unknown>; health: (id: string) => Promise<unknown> }>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      list: async () => { calls.push("list"); return overrides.list ? overrides.list() : Promise.reject(failure("unavailable")); },
      get: async (id: string) => { calls.push(`get:${id}`); return overrides.get ? overrides.get(id) : Promise.reject(failure("unavailable")); },
      health: async (id: string) => { calls.push(`health:${id}`); return overrides.health ? overrides.health(id) : Promise.reject(failure("unavailable")); },
    } as never,
  };
}

test("one list read answers for every requested id, and only lifecycle facts leave the server", async () => {
  const { client, calls } = reader({
    list: async () => ({
      routines: [routine("nightly", "ACTIVE"), routine("weekly", "PAUSED", { timezone: "utc" }), routine("old", "DISABLED"), routine("other", "ACTIVE")],
      revisionById: { nightly: 4, weekly: 2, old: 9, other: 1 },
      tombstonedAtById: {},
    }),
  });
  const result = await readAutomationLifecycleOverview(query("nightly", "weekly", "old", "missing"), signal, client);
  assert.equal(result.kind, "available");
  assert.deepEqual(calls, ["list"]);
  if (result.kind !== "available") return;
  assert.deepEqual(result.records, [
    { id: "nightly", kind: "present", state: "active", revision: 4, timezone: "America/Chicago" },
    { id: "weekly", kind: "present", state: "paused", revision: 2, timezone: "utc" },
    { id: "old", kind: "present", state: "disabled", revision: 9, timezone: "America/Chicago" },
    { id: "missing", kind: "absent" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret prompt|other/);
  assert.ok(Number.isFinite(Date.parse(result.readAt)));
});

test("a list answer Cave cannot decode falls back to bounded per-id reads", async () => {
  const { client, calls } = reader({
    // The SDK caps a definition list at 16 KiB; long prompts make it undecodable.
    list: async () => { throw failure("invalid_response"); },
    get: async (id: string) => {
      if (id === "huge") throw failure("invalid_response");
      if (id === "gone") return { routine: null };
      if (id === "buried") return { routine: routine("buried", "ACTIVE"), revision: 3, tombstonedAt: "2026-10-01T00:00:00.000Z" };
      return { routine: routine(id, "PAUSED"), revision: 6, tombstonedAt: null };
    },
  });
  const result = await readAutomationLifecycleOverview(query("a", "huge", "gone", "buried"), signal, client);
  assert.deepEqual(calls.sort(), ["get:a", "get:buried", "get:gone", "get:huge", "list"]);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.deepEqual(result.records, [
    { id: "a", kind: "present", state: "paused", revision: 6, timezone: "America/Chicago" },
    { id: "huge", kind: "unreadable" },
    { id: "gone", kind: "absent" },
    { id: "buried", kind: "absent" },
  ]);
});

test("an unreachable or unsupporting daemon is reported, never turned into an empty list", async () => {
  assert.deepEqual(await readAutomationLifecycleOverview(query("a"), signal, reader({}).client), { kind: "unavailable" });
  assert.deepEqual(await readAutomationLifecycleOverview(query("a"), signal, reader({
    list: async () => { throw failure("capability_unsupported"); },
  }).client), { kind: "unsupported" });
  // A per-id fallback that loses the daemon stops and says so.
  const { client } = reader({
    list: async () => { throw failure("invalid_response"); },
    get: async (id: string) => { if (id === "b") throw failure("timeout"); return { routine: routine(id, "ACTIVE"), revision: 1, tombstonedAt: null }; },
  });
  assert.deepEqual(await readAutomationLifecycleOverview(query("a", "b", "c"), signal, client), { kind: "unavailable" });
});

test("overview requests are validated before any daemon read", async () => {
  const { client, calls } = reader({});
  for (const bad of [
    new URLSearchParams(), new URLSearchParams("id=a&cursor=1"), query("a", "a"), query("has space"),
    query(...Array.from({ length: 101 }, (_, index) => `a${index}`)), query("x".repeat(97)),
  ]) {
    assert.deepEqual(await readAutomationLifecycleOverview(bad, signal, client), { kind: "invalid" });
  }
  assert.deepEqual(calls, []);
});

test("detail adds Coven's health facts, keeping its free-text reasons out", async () => {
  const { client } = reader({
    get: async () => ({ routine: routine("nightly", "ACTIVE"), revision: 4, tombstonedAt: null }),
    health: async () => ({ health: {
      automationId: "nightly", nextDueAt: "2026-10-19T14:00:00.000Z", lastPlannedAt: null, lastStartedAt: "2026-10-18T14:00:00.000Z",
      lastSuccessAt: "2026-10-18T14:01:00.000Z", consecutiveFailures: 0, leaseOwner: "worker-7", leaseExpiresAt: null,
      staleReason: "lease lost on /Users/val/.coven", currentAttempt: null, maxAttempts: 1, retryNotBefore: null,
      consecutiveExhaustions: 0, quarantinedAt: null, quarantineFailureClass: null, quarantineReason: "private reason",
    } }),
  });
  const result = await readAutomationLifecycleDetail("nightly", signal, client);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.deepEqual(result.record, { id: "nightly", kind: "present", state: "active", revision: 4, timezone: "America/Chicago" });
  assert.deepEqual(result.health, {
    nextDueAt: "2026-10-19T14:00:00.000Z", lastPlannedAt: null, lastStartedAt: "2026-10-18T14:00:00.000Z",
    lastSuccessAt: "2026-10-18T14:01:00.000Z", consecutiveFailures: 0, quarantined: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /worker-7|private reason|\.coven|secret prompt/);
});

test("detail keeps the lifecycle when health cannot be read, and reads no health for an absent id", async () => {
  const healthless = reader({ get: async () => ({ routine: routine("n", "PAUSED"), revision: 2, tombstonedAt: null }) });
  const result = await readAutomationLifecycleDetail("n", signal, healthless.client);
  assert.equal(result.kind === "available" && result.health, null);
  const absent = reader({ get: async () => ({ routine: null }) });
  assert.deepEqual((await readAutomationLifecycleDetail("n", signal, absent.client) as { record: unknown }).record, { id: "n", kind: "absent" });
  assert.deepEqual(absent.calls, ["get:n"]);
  assert.deepEqual(await readAutomationLifecycleDetail("bad id", signal, absent.client), { kind: "invalid" });
  assert.deepEqual(await readAutomationLifecycleDetail("n", signal, reader({}).client), { kind: "unavailable" });
});

function commander(answer: (command: string, id: string, expectedRevision: number, context: unknown) => Promise<unknown>) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      pause: async (id: string, expectedRevision: number, context: unknown) => {
        sent.push(["pause", id, expectedRevision, context]);
        return answer("pause", id, expectedRevision, context);
      },
      activate: async (id: string, expectedRevision: number, context: unknown) => {
        sent.push(["activate", id, expectedRevision, context]);
        return answer("activate", id, expectedRevision, context);
      },
    } as never,
  };
}

const key = "cave-0b4d3a2e-6f3c-4d9e-9a51-2c8f0f1e7d42";

test("pause and resume send the expected revision and the adoption key, once", async () => {
  const { client, sent } = commander(async (command, _id, expectedRevision, context) => ({
    outcome: "committed", command: `definition.${command}.v1`, adoptionKey: (context as { adoptionKey: string }).adoptionKey,
    revision: expectedRevision + 1, result: {},
  }));
  assert.deepEqual(await sendAutomationLifecycleCommand("nightly", { command: "pause", expectedRevision: 4, adoptionKey: key }, signal, client),
    { kind: "committed", revision: 5, replayed: false });
  assert.deepEqual(await sendAutomationLifecycleCommand("nightly", { command: "activate", expectedRevision: 5, adoptionKey: key }, signal, client),
    { kind: "committed", revision: 6, replayed: false });
  assert.deepEqual(sent, [
    ["pause", "nightly", 4, { adoptionKey: key, intent: "Pause from Cave", principalId: "cave" }],
    ["activate", "nightly", 5, { adoptionKey: key, intent: "Resume from Cave", principalId: "cave" }],
  ]);
});

test("Coven's typed refusals and lost answers map to distinct outcomes", async () => {
  const cases: [unknown, unknown][] = [
    [{ outcome: "replayed", revision: 5, replay: { firstCommittedAt: "x" } }, { kind: "committed", revision: 5, replayed: true }],
    [{ outcome: "rejected", error: { code: "REVISION_CONFLICT", retryable: false, currentRevision: 7 } }, { kind: "conflict", currentRevision: 7 }],
    [{ outcome: "rejected", error: { code: "REVISION_CONFLICT", retryable: false } }, { kind: "conflict", currentRevision: null }],
    [{ outcome: "rejected", error: { code: "ILLEGAL_TRANSITION", retryable: false } }, { kind: "rejected", code: "ILLEGAL_TRANSITION" }],
    [{ outcome: "rejected", error: { code: "NOT_FOUND", retryable: false } }, { kind: "rejected", code: "NOT_FOUND" }],
  ];
  for (const [answer, expected] of cases) {
    const { client } = commander(async () => answer);
    assert.deepEqual(await sendAutomationLifecycleCommand("n", { command: "pause", expectedRevision: 4, adoptionKey: key }, signal, client), expected);
  }
  for (const [code, kind] of [["outcome_unknown", "unknown"], ["capability_unsupported", "unsupported"], ["unavailable", "unavailable"], ["invalid_options", "invalid"]]) {
    const { client } = commander(async () => { throw failure(code); });
    assert.deepEqual(await sendAutomationLifecycleCommand("n", { command: "activate", expectedRevision: 1, adoptionKey: key }, signal, client), { kind });
  }
});

test("malformed commands are refused before anything is sent", async () => {
  const { client, sent } = commander(async () => { throw new Error("must not send"); });
  for (const body of [
    null, "pause", {}, { command: "delete", expectedRevision: 1, adoptionKey: key },
    { command: "pause", expectedRevision: 0, adoptionKey: key }, { command: "pause", expectedRevision: 1.5, adoptionKey: key },
    { command: "pause", adoptionKey: key }, { command: "pause", expectedRevision: 1, adoptionKey: "reused" },
    { command: "pause", expectedRevision: 1, adoptionKey: key, status: "ACTIVE" },
  ]) {
    assert.deepEqual(await sendAutomationLifecycleCommand("n", body, signal, client), { kind: "invalid" }, JSON.stringify(body));
  }
  assert.deepEqual(await sendAutomationLifecycleCommand("bad id", { command: "pause", expectedRevision: 1, adoptionKey: key }, signal, client), { kind: "invalid" });
  assert.deepEqual(sent, []);
});
