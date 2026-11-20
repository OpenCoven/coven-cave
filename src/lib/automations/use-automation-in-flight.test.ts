// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { useAutomationInFlight } = await import("./use-automation-in-flight.ts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const overview = (state) => ({
  kind: "available", readAt: new Date().toISOString(), truncated: [],
  byAutomation: { nightly: { state, count: 1, since: "2026-10-18T09:00:00.000Z", manual: false } },
});

function harness(enabled) {
  const handle = {};
  function Probe({ on }) {
    Object.assign(handle, useAutomationInFlight(on));
    return null;
  }
  return { handle, element: (on = enabled) => createElement(Probe, { on }) };
}

test("reads the overview once on mount and exposes each row's live state", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return { json: async () => overview("running") }; };
  const { handle, element } = harness(true);
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    assert.deepEqual(urls, ["/api/coven-automation-occurrences"]);
    assert.deepEqual(handle.view("nightly"), { entry: overview("running").byAutomation.nightly, freshness: "live" });
    assert.deepEqual(handle.view("weekly"), { entry: null, freshness: "live" });
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("a failed re-read keeps the last answer, marked stale, and a disabled hook reads nothing", async () => {
  const original = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async () => { if (fail) throw new TypeError("network"); return { json: async () => overview("claimed") }; };
  const { handle, element } = harness(true);
  let renderer;
  try {
    await act(async () => { renderer = create(element()); });
    fail = true;
    await act(async () => { await handle.refresh(); });
    assert.equal(handle.cache.latest, "unavailable");
    assert.deepEqual(handle.view("nightly").freshness, "stale");
    assert.equal(handle.view("nightly").entry.state, "claimed");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }

  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { json: async () => overview("due") }; };
  const off = harness(false);
  try {
    await act(async () => { renderer = create(off.element()); });
    await act(async () => { await off.handle.refresh(); });
    assert.equal(calls, 0);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});
