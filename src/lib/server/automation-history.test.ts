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

test("stream IDs preserve the SDK Unicode and code-point bounds", async () => {
  for (const id of ["routine with spaces", "日課", "🧙".repeat(320), "a".repeat(320)]) {
    let calls = 0;
    const result = await readAutomationHistory(id, new URLSearchParams(), new AbortController().signal, {
      events: async query => { calls++; assert.equal(query.stream.id, id); return { ...page, stream: { ...stream, id } }; },
    });
    assert.equal(result.kind, "available"); assert.equal(calls, 1);
  }
  for (const id of ["", "a".repeat(321), "🧙".repeat(321), "\ud800"]) {
    let calls = 0;
    const result = await readAutomationHistory(id, new URLSearchParams(), new AbortController().signal, {
      events: async () => { calls++; return page; },
    });
    assert.equal(result.kind, "invalid"); assert.equal(calls, 0);
  }
});

test("misfire history preserves each canonical disposition without free-text reasons", async () => {
  const dispositions = {
    none: "No scheduling disposition recorded.",
    collapsed_to_latest: "Missed slots collapsed to the latest occurrence.",
    skipped_overlap: "Skipped because another occurrence overlaps.",
    skipped_paused: "Skipped because the routine was paused.",
    skipped_invalid: "Skipped because the routine was invalid.",
  } as const;
  for (const [disposition, expected] of Object.entries(dispositions)) {
    const result = await readAutomationHistory("daily", new URLSearchParams(), new AbortController().signal, {
      events: async () => ({ ...page, events: [{ ...event, kind: "occurrence.misfire_recorded", payload: {
        disposition: disposition as keyof typeof dispositions, collapsedSlots: [],
      } }] }),
    });
    assert.equal(result.kind, "available");
    if (result.kind === "available") assert.equal(result.entries[0].detail, expected);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});
