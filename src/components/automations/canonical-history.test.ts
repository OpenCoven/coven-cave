// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { CanonicalAutomationHistory } = await import("./canonical-history.tsx");
const { LiveRegionProvider } = await import("../ui/live-region.tsx");
const history = automationId => createElement(LiveRegionProvider, null, createElement(CanonicalAutomationHistory, { automationId }));
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
    await act(async () => { renderer = create(history("daily")); });
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
    await act(async () => { renderer = create(history("daily")); });
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
    await act(async () => { renderer = create(history("daily")); });
    await act(async () => button(renderer, "Read history").props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Couldn't read history/);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

async function withDownloads(run) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalFrame = globalThis.requestAnimationFrame;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const focused = {};
  const state = { blobs: [], revoked: [], links: [], frames: [], clickError: false };
  globalThis.document = { activeElement: focused, createElement(tag) {
    assert.equal(tag, "a");
    const link = { clicked: false, removed: false, click() {
      if (state.clickError) throw new Error("synthetic-fixture-private-download-failure");
      this.clicked = true;
    }, remove() { this.removed = true; }, focus() { assert.fail("the download anchor must not take focus"); } };
    state.links.push(link);
    return link;
  } };
  URL.createObjectURL = blob => { state.blobs.push(blob); return `blob:fixture-${state.blobs.length}`; };
  URL.revokeObjectURL = url => state.revoked.push(url);
  globalThis.requestAnimationFrame = callback => { state.frames.push(callback); return state.frames.length; };
  try { await run(state); assert.equal(globalThis.document.activeElement, focused); }
  finally {
    for (const frame of state.frames) frame();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete globalThis.document;
    globalThis.requestAnimationFrame = originalFrame;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
}

test("metadata export is disabled without a read and downloads only the current page", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  let renderer;
  try { await withDownloads(async state => {
    await act(async () => { renderer = create(history("daily")); });
    assert.equal(button(renderer, "Export metadata"), undefined);
    await act(async () => button(renderer, "Read history").props.onClick());
    assert.equal(button(renderer, "Export metadata").props.disabled, true);
    await act(async () => requests[0].resolve({ ok: true, json: async () => page }));
    assert.equal(button(renderer, "Export metadata").props.disabled, false);
    await act(async () => button(renderer, "Export metadata").props.onClick());
    assert.equal(requests.length, 1);
    assert.equal(state.blobs.length, 1);
    assert.equal(state.blobs[0].type, "application/json;charset=utf-8");
    const exported = JSON.parse(await state.blobs[0].text());
    assert.equal(exported.entries[0].type, "definition.created");
    assert.equal(exported.freshness, "read");
    assert.equal(exported.completeHistory, false);
    assert.equal(state.links[0].download, "coven-automation-history-metadata.json");
    assert.equal(state.links[0].clicked, true);
    assert.equal(state.links[0].removed, true);
    assert.deepEqual(state.revoked, []);
    state.frames.shift()();
    assert.deepEqual(state.revoked, ["blob:fixture-1"]);
    assert.match(JSON.stringify(renderer.toJSON()), /History metadata download prepared/);
  }); } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("failed history cannot export empty success and retained failed-refresh history exports stale", async () => {
  const original = globalThis.fetch;
  const responses = [{ ok: false, kind: "unavailable" }, { ok: true, ...page }, { ok: false, kind: "expired" }];
  let requests = 0;
  globalThis.fetch = async () => { const response = responses[requests++]; return { ok: response.ok, json: async () => response }; };
  let renderer;
  try { await withDownloads(async state => {
    await act(async () => { renderer = create(history("daily")); });
    await act(async () => button(renderer, "Read history").props.onClick());
    assert.equal(button(renderer, "Export metadata").props.disabled, true);
    await act(async () => button(renderer, "Retry").props.onClick());
    await act(async () => button(renderer, "Check for newer events").props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Previously read history below is stale/);
    await act(async () => button(renderer, "Export metadata").props.onClick());
    const exported = JSON.parse(await state.blobs[0].text());
    assert.equal(exported.freshness, "stale");
    assert.equal(exported.readAt, page.readAt);
    assert.equal(requests, 3);
    state.clickError = true;
    await act(async () => button(renderer, "Export metadata").props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Couldn't prepare history metadata\. Try exporting again/);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /synthetic-fixture-private-download-failure/);
    assert.deepEqual(state.revoked, ["blob:fixture-2"]);
    assert.equal(state.links[1].removed, true);
  }); } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});

test("changing automation aborts the old read and exports only the selected page", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  let renderer;
  try { await withDownloads(async state => {
    await act(async () => { renderer = create(history("daily")); });
    await act(async () => button(renderer, "Read history").props.onClick());
    await act(async () => renderer.update(history("other")));
    assert.equal(requests[0].options.signal.aborted, true);
    await act(async () => requests[0].resolve({ ok: true, json: async () => page }));
    assert.equal(button(renderer, "Export metadata").props.disabled, true);
    const selected = { ...page, entries: [{ ...page.entries[0], id: "selected12345678901234567890" }] };
    await act(async () => requests[1].resolve({ ok: true, json: async () => selected }));
    await act(async () => button(renderer, "Export metadata").props.onClick());
    assert.equal(JSON.parse(await state.blobs[0].text()).entries[0].id, selected.entries[0].id);
    assert.equal(requests.length, 2);
  }); } finally { await act(async () => renderer?.unmount()); globalThis.fetch = original; }
});
