// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { useAutomationLifecycle } = await import("./use-automation-lifecycle.ts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const overview = (revision) => ({
  kind: "available", readAt: new Date().toISOString(),
  records: [{ id: "nightly", kind: "present", state: "active", revision, timezone: "UTC" }],
});

function harness() {
  const handle = {};
  function Probe() {
    Object.assign(handle, useAutomationLifecycle(["nightly"]));
    return null;
  }
  return { handle, Probe };
}

test("reads the overview for the listed ids and exposes a live view", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method ?? "GET" });
    return { json: async () => overview(4) };
  };
  const { handle, Probe } = harness();
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(Probe)); });
    assert.equal(requests[0].url, "/api/coven-automation-lifecycle?id=nightly");
    const view = handle.view("nightly");
    assert.equal(view.state, "active");
    assert.equal(view.revision, 4);
    assert.equal(view.freshness, "live");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("a lost command answer is resent once under the same adoption key, then the state is re-read", async () => {
  const original = globalThis.fetch;
  const posts = [];
  let reads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      posts.push(JSON.parse(options.body));
      // The first answer is lost on the way back; the resend is reconciled by Coven.
      if (posts.length === 1) throw new TypeError("network");
      return { json: async () => ({ kind: "committed", revision: 5, replayed: true }) };
    }
    reads++;
    return { json: async () => overview(reads > 1 ? 5 : 4) };
  };
  const { handle, Probe } = harness();
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(Probe)); });
    let result;
    await act(async () => { result = await handle.send("nightly", "pause", 4); });
    assert.deepEqual(result, { kind: "committed", revision: 5, replayed: true });
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0], posts[1], "the resend is byte-identical, adoption key included");
    assert.equal(posts[0].expectedRevision, 4);
    assert.match(posts[0].adoptionKey, /^cave-/);
    assert.equal(handle.view("nightly").revision, 5, "the lifecycle is re-read after the command");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("a refresh that fails after a good read keeps the last state, marked stale", async () => {
  const original = globalThis.fetch;
  let healthy = true;
  globalThis.fetch = async () => {
    if (!healthy) return { json: async () => ({ kind: "unavailable" }) };
    return { json: async () => overview(4) };
  };
  const { handle, Probe } = harness();
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(Probe)); });
    healthy = false;
    await act(async () => { await handle.refresh(); });
    const view = handle.view("nightly");
    assert.equal(view.state, "active");
    assert.equal(view.freshness, "stale");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});
