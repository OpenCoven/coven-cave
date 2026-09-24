// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { CanonicalAutomationHistory } = await import("./canonical-history.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function button(renderer, label) {
  const text = node => typeof node === "string" ? node : node.children.map(text).join("");
  return renderer.root.findAllByType("button").find(node => text(node) === label);
}
const page = { kind: "available", checkpoint: "checkpoint", withheld: 0, hasEntries: true,
  readAt: "2026-09-21T00:00:00.000Z", entries: [{ id: "evt12345678901234567890", sequence: 0,
    recordedAt: "2026-09-21T00:00:00.000Z", label: "Definition created", detail: "Revision 1" }] };

test("history is on demand, aborts on close and ignores late responses", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(CanonicalAutomationHistory, { automationId: "daily" })); });
    assert.equal(requests.length, 0);
    await act(async () => { button(renderer, "Read history").props.onClick(); });
    assert.equal(requests.length, 1);
    assert.equal(button(renderer, "Retry").props.disabled, true);
    await act(async () => { button(renderer, "Hide history").props.onClick(); });
    assert.equal(requests[0].options.signal.aborted, true);
    await act(async () => { requests[0].resolve({ ok: true, json: async () => page }); });
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Revision 1/);
    assert.equal(requests.length, 1);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("expired history retains an explicit stale view and only restarts on user action", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(CanonicalAutomationHistory, { automationId: "daily" })); });
    await act(async () => button(renderer, "Read history").props.onClick());
    await act(async () => requests[0].resolve({ ok: true, json: async () => page }));
    assert.match(JSON.stringify(renderer.toJSON()), /Revision 1/);
    await act(async () => button(renderer, "Check for newer events").props.onClick());
    assert.match(requests[1].url, /checkpoint=checkpoint$/);
    await act(async () => requests[1].resolve({ ok: false, json: async () => ({ kind: "expired" }) }));
    assert.match(JSON.stringify(renderer.toJSON()), /Previously read history below is stale/);
    assert.equal(requests.length, 2);
    await act(async () => button(renderer, "Start again").props.onClick());
    assert.equal(requests[2].url, "/api/coven-automations/daily/events");
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("malformed successful responses render an unavailable state instead of history", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...page, entries: [null] }) });
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(CanonicalAutomationHistory, { automationId: "daily" })); });
    await act(async () => button(renderer, "Read history").props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Couldn't read history/);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});
