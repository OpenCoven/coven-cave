import assert from "node:assert/strict";
import test from "node:test";
import type { CovenAutomationEventPage } from "@opencoven/coven-client";
import { readAutomationHistory } from "./automation-history.ts";

const stream = { kind: "automation" as const, id: "daily" };
const event = {
  schemaVersion: "coven.automations.v1" as const, eventId: "evt12345678901234567890", stream, sequence: 0,
  kind: "definition.created" as const, recordedAt: "2026-09-21T00:00:00.000Z", observedAt: "2026-09-21T00:00:00.000Z",
  producer: { component: "coven-daemon", instanceId: "private-host" }, summary: "private-prompt",
  payload: { revision: 1, importedFrom: "private-path" },
  privacy: { classification: "operational" as const, retention: { classification: "standard" as const } },
};
const page: CovenAutomationEventPage = { stream, after: null, events: [event], nextAfter: 0,
  checkpoint: "checkpoint", checkpointExpiresAt: "2026-10-01T00:00:00.000Z" };

test("history uses the canonical stream and exposes only bounded display metadata", async () => {
  const signal = new AbortController().signal;
  const result = await readAutomationHistory("daily", new URLSearchParams(), signal, { events: async (query, options) => {
    assert.deepEqual(query, { stream });
    assert.equal(options?.signal, signal);
    return page;
  } });
  assert.equal(result.kind, "available");
  assert.doesNotMatch(JSON.stringify(result), /private/);
  if (result.kind === "available") {
    assert.equal(result.entries[0].sequence, 0);
    assert.equal(result.entries[0].detail, "Revision 1");
    assert.equal(result.checkpoint, "checkpoint");
  }
});

test("protected event contents and identifiers stay out of browser history", async () => {
  const result = await readAutomationHistory("daily", new URLSearchParams(), new AbortController().signal, {
    events: async () => ({ ...page, events: [{ ...event, eventId: "private-identity", privacy: { ...event.privacy, classification: "restricted" } }] }),
  });
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(result.kind, "available");
  if (result.kind === "available") { assert.equal(result.entries.length, 0); assert.equal(result.withheld, 1); }
});

test("invalid, duplicate and conflicting cursor input never dispatches", async () => {
  for (const query of ["after=0", "checkpoint=", "checkpoint=a&checkpoint=b", `checkpoint=${"x".repeat(513)}`]) {
    const result = await readAutomationHistory("daily", new URLSearchParams(query), new AbortController().signal, {
      events: async () => { throw new Error("must not dispatch"); },
    });
    assert.equal(result.kind, "invalid");
  }
});

test("cursor expiry and unavailable reads remain failures with no reset or raw detail", async () => {
  for (const [code, expected] of [["CURSOR_EXPIRED", "expired"], ["capability_unsupported", "unsupported"], ["unavailable", "unavailable"]]) {
    let calls = 0;
    const result = await readAutomationHistory("daily", new URLSearchParams("checkpoint=prior"), new AbortController().signal, {
      events: async query => { calls++; assert.equal(query.checkpoint, "prior"); throw Object.assign(new Error("private error"), { code }); },
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, expected);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});
