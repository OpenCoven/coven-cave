// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { AutomationOccurrences } = await import("./automation-occurrences.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = (node) => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (renderer, pattern) => renderer.root.findAllByType("button").find((node) => pattern.test(text(node)));

// Cave's own projection of what Coven 0.4.10 recorded for a Run now with no runtime binary.
const occurrence = {
  id: "occ-3ef12c9439ef478aacc4e863682088a7", automationRevision: 2, scheduledFor: "2026-10-18T08:31:46.886Z", kind: "manual",
  state: "claimed", fenceGeneration: 1, leaseExpiresAt: null, reasonRecorded: true,
  createdAt: "2026-10-18T08:31:46.886Z", updatedAt: "2026-10-18T08:31:47.199Z",
};
const done = { ...occurrence, id: "occ-older", state: "succeeded", kind: "scheduled", reasonRecorded: false };
const run = {
  id: "run-0ce1422cb4c24b87b33dfd1834a3edf7", status: "running", automationRevision: 2, startedAt: "2026-10-18T08:31:46.897Z",
  finishedAt: null, timeoutAt: "2026-10-18T08:36:46.897Z", exitCode: null, runtime: "coven-code", familiarId: null,
  sessionId: "session-2aaabc1cef394d7ea0da9a6961cdf966", receiptRecorded: false,
  attempts: [{
    id: "attempt-run-0ce1422cb4c24b87b33dfd1834a3edf7-1", attemptNumber: 1, state: "failed", failureClass: "runtime_unavailable",
    retryClassification: "initial", priorDisposition: null, dispatchGeneration: 1, notBefore: "2026-10-18T08:31:46.897Z",
    openedAt: "2026-10-18T08:31:46.897Z", settledAt: "2026-10-18T08:31:47.199Z", reasonRecorded: true,
  }],
};
const pageAnswer = { kind: "available", readAt: "2026-10-18T08:32:00.000Z", occurrences: [occurrence, done], nextCursor: null };
const detailAnswer = { kind: "available", readAt: "2026-10-18T08:32:01.000Z", occurrence: { ...occurrence, runs: [run], runsTruncated: false } };

function mount(props = {}) {
  const watched = [];
  return { watched, element: (extra = {}) => createElement(AutomationOccurrences, { automationId: "nightly", refreshNonce: 0, onWatchStreams: (streams) => watched.push(streams), ...props, ...extra }) };
}

test("occurrences, runs and attempts each keep their own state, and free text never renders", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return { ok: true, json: async () => String(url).endsWith("/occurrences") ? pageAnswer : detailAnswer };
  };
  const { watched, element } = mount();
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    assert.equal(requests[0], "/api/coven-automations/nightly/occurrences");
    const listed = text(renderer.toJSON());
    assert.match(listed, /Run now: Claimed/);
    assert.match(listed, /Scheduled: Succeeded/);
    assert.match(listed, /Read at/);
    assert.deepEqual(watched.at(-1), [{ kind: "occurrence", id: occurrence.id }], "only the open occurrence is followed");

    await act(async () => { button(renderer, /Run now: Claimed/).props.onClick(); });
    assert.equal(requests[1], `/api/coven-automations/nightly/occurrences/${occurrence.id}`);
    const expanded = text(renderer.toJSON());
    assert.match(expanded, /Run: Running/);
    assert.match(expanded, /Attempt 1: Failed/);
    assert.match(expanded, /Runtime unavailable/);
    assert.match(expanded, /no attempt is in progress/);
    assert.match(expanded, /Coven recorded a reason for this state/);
    assert.doesNotMatch(expanded, /spawn|automation:run/);
    assert.equal(button(renderer, /Run now: Claimed/).props["aria-expanded"], true);
    assert.deepEqual(watched.at(-1), [{ kind: "occurrence", id: occurrence.id }, { kind: "run", id: run.id }]);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
  assert.deepEqual(watched.at(-1), [], "unmounting stops following");
});

test("a failed re-read keeps the earlier answer, visibly stale", async () => {
  const original = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async () => fail
    ? { ok: false, json: async () => ({ kind: "unavailable" }) }
    : { ok: true, json: async () => pageAnswer };
  const { element } = mount();
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    fail = true;
    await act(async () => { button(renderer, /Re-read now/).props.onClick(); });
    const shown = text(renderer.toJSON());
    assert.match(shown, /Couldn't read occurrences/);
    assert.match(shown, /from the earlier read and may be stale/);
    assert.match(shown, /Run now: Claimed/);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("a changefeed signal re-reads at once, and older pages load from the cursor", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("cursor=")) return { ok: true, json: async () => ({ ...pageAnswer, occurrences: [{ ...done, id: "occ-oldest", state: "skipped" }], nextCursor: null }) };
    return { ok: true, json: async () => ({ ...pageAnswer, nextCursor: "page-2" }) };
  };
  const { element } = mount();
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    await act(async () => { renderer.update(element({ refreshNonce: 1 })); });
    assert.equal(requests.length, 2);
    await act(async () => { button(renderer, /Show older/).props.onClick(); });
    assert.equal(requests[2], "/api/coven-automations/nightly/occurrences?cursor=page-2");
    assert.match(text(renderer.toJSON()), /Scheduled: Skipped/);
    assert.equal(button(renderer, /Show older/), undefined);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("an empty history says how occurrences appear", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...pageAnswer, occurrences: [] }) });
  const { element } = mount();
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    assert.match(text(renderer.toJSON()), /Coven has no occurrences for this cron yet/);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});
