// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { useAutomationFeed } = await import("./use-automation-feed.ts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const id = (n) => `evt${String(n).padStart(32, "0")}`;
const event = (n, topic, label) => ({ id: id(n), sequence: n, recordedAt: `2026-10-18T08:00:0${n}.000Z`, topic, label, detail: "dispatching → failed" });
const available = (events, checkpoint) => ({
  kind: "available", readAt: "2026-10-18T08:00:00.000Z", checkpoint, caughtUp: true, events, omitted: 0,
  throughSequence: events.at(-1)?.sequence ?? null,
});

function harness(streams) {
  const handle = { changes: [] };
  function Probe({ extra }) {
    Object.assign(handle, useAutomationFeed("nightly", extra, (change) => handle.changes.push(change)));
    return null;
  }
  return { handle, render: (extra = streams) => createElement(Probe, { extra }) };
}

test("follows the automation stream plus named streams, announcing only new events", async () => {
  const original = globalThis.fetch;
  const requests = [];
  const answers = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const next = answers.shift() ?? available([], "cp-same");
    return { json: async () => next };
  };
  const { handle, render } = harness([{ kind: "run", id: "run-1" }]);
  let renderer;
  try {
    answers.push(available([event(0, "definition", "Definition created")], "cp-a0"), available([event(0, "run", "Run changed")], "cp-r0"));
    await act(async () => { renderer = create(render()); });
    assert.deepEqual(requests, [
      "/api/coven-automations/nightly/feed?stream=automation",
      "/api/coven-automations/nightly/feed?stream=run&streamId=run-1",
    ]);
    assert.deepEqual(handle.changes, [], "the first read is a baseline");
    assert.match(String(handle.state.lastReadAt), /^\d+$/);

    answers.push(available([], "cp-a0"), available([event(1, "run", "Attempt changed")], "cp-r1"));
    await act(async () => { await handle.refresh(); });
    assert.equal(requests[2], "/api/coven-automations/nightly/feed?stream=automation&checkpoint=cp-a0");
    assert.equal(requests[3], "/api/coven-automations/nightly/feed?stream=run&streamId=run-1&checkpoint=cp-r0");
    assert.deepEqual(handle.changes, [{ topics: ["run"], reset: false }]);
    assert.equal(handle.state.lastEvent.label, "Attempt changed");

    // The same event again is dropped, and announces nothing.
    answers.push(available([], "cp-a0"), available([event(1, "run", "Attempt changed")], "cp-r1"));
    await act(async () => { await handle.refresh(); });
    assert.equal(handle.changes.length, 1);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("an expired checkpoint resets the stream, asks for a full re-read and starts again from the beginning", async () => {
  const original = globalThis.fetch;
  const requests = [];
  const answers = [available([event(0, "definition", "Definition created")], "cp-a0"), { kind: "expired" }];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const next = answers.shift() ?? available([event(0, "definition", "Definition created")], "cp-fresh");
    return { json: async () => next };
  };
  const { handle, render } = harness([]);
  let renderer;
  try {
    await act(async () => { renderer = create(render()); });
    await act(async () => { await handle.refresh(); });
    assert.deepEqual(handle.changes, [{ topics: ["definition", "occurrence", "run"], reset: true }]);
    assert.equal(handle.state.lastReset.reason, "expired");
    await act(async () => { await handle.refresh(); });
    assert.equal(requests[2], "/api/coven-automations/nightly/feed?stream=automation", "no checkpoint after the reset");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("a failed pass marks the feed disconnected and keeps the last checkpoint", async () => {
  const original = globalThis.fetch;
  const requests = [];
  let fail = false;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (fail) throw new TypeError("network");
    return { json: async () => available([], "cp-a") };
  };
  const { handle, render } = harness([]);
  let renderer;
  try {
    await act(async () => { renderer = create(render()); });
    fail = true;
    await act(async () => { await handle.refresh(); });
    assert.equal(typeof handle.state.failingSince, "number");
    fail = false;
    await act(async () => { await handle.refresh(); });
    assert.equal(requests.at(-1), "/api/coven-automations/nightly/feed?stream=automation&checkpoint=cp-a");
    assert.equal(handle.state.failingSince, null);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("unmounting aborts the read in flight", async () => {
  const original = globalThis.fetch;
  const signals = [];
  globalThis.fetch = (_url, options) => { signals.push(options.signal); return new Promise(() => {}); };
  const { render } = harness([]);
  let renderer;
  try {
    await act(async () => { renderer = create(render()); });
    await act(async () => renderer.unmount());
    renderer = null;
    assert.equal(signals[0].aborted, true);
  } finally { globalThis.fetch = original; }
});
