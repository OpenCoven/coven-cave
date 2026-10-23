import assert from "node:assert/strict";
import test from "node:test";
import { CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import { readAutomationInFlight } from "./automation-in-flight.ts";

const signal = new AbortController().signal;
const failure = (code: string) => new CovenClientError(normalizeCovenError({ code }, "automations.occurrences"));
const occurrence = (automationId: string, kind = "manual") => ({
  id: `occ-${automationId}`, automationId, automationRevision: 2, scheduledFor: "2026-10-18T14:04:32.400393000Z", kind, state: "claimed",
  failureReason: "failed to spawn harness `coven-code`", leaseOwner: null, definitionDigest: "3076898f", fenceGeneration: 1,
  createdAt: "2026-10-18T14:04:32.400Z", updatedAt: "2026-10-18T14:04:32.543Z", leaseExpiresAt: null, schedulerGeneration: null,
});

function reader(answer: (view: string) => unknown[] | Error) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      occurrences: async (query: { view: string; limit: number; automationId?: string }) => {
        calls.push(query);
        const result = answer(query.view);
        if (result instanceof Error) throw result;
        return { occurrences: result };
      },
    } as never,
  };
}

test("four scheduler views, most urgent first, across every automation, folded per automation", async () => {
  const { client, calls } = reader((view) => view === "claimed" ? [occurrence("cave-release-canary-run")] : []);
  const result = await readAutomationInFlight(new URLSearchParams(), signal, client);
  assert.deepEqual(calls, [
    { view: "recovery_required", limit: 100 }, { view: "running", limit: 100 }, { view: "claimed", limit: 100 }, { view: "due", limit: 100 },
  ]);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.deepEqual(result.byAutomation, {
    "cave-release-canary-run": { state: "claimed", count: 1, since: "2026-10-18T14:04:32.400Z", manual: true },
  });
  assert.doesNotMatch(JSON.stringify(result), /spawn|3076898f/);
});

test("parameters are refused before the daemon, and failures say whether Coven lacks the views or cannot be reached", async () => {
  const none = reader(() => []);
  assert.deepEqual(await readAutomationInFlight(new URLSearchParams("view=running"), signal, none.client), { kind: "invalid" });
  assert.equal(none.calls.length, 0);
  for (const [code, kind] of [["capability_unsupported", "unsupported"], ["unsupported_operation", "unsupported"], ["unavailable", "unavailable"], ["timeout", "unavailable"]]) {
    assert.deepEqual(await readAutomationInFlight(new URLSearchParams(), signal, reader(() => failure(code)).client), { kind });
  }
});

test("one malformed occurrence fails the read rather than misreporting a row", async () => {
  const { client } = reader((view) => view === "running" ? [{ ...occurrence("nightly"), scheduledFor: "soon" }] : []);
  assert.deepEqual(await readAutomationInFlight(new URLSearchParams(), signal, client), { kind: "unavailable" });
});
