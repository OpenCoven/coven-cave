// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../scripts/test-alias-register.mjs");
const { OpenCovenSubmissionPage } = await import("./opencoven-submissions-absent-page.tsx");
const { LiveRegionProvider } = await import("./ui/live-region.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RETAINED = "/api/opencoven/submissions/retained";
// {"x":"<FF>"}: the recovery export must hand over the stored bytes unchanged (#6402).
const stored = Buffer.from("7b2278223a22ff227d", "hex");

function button(renderer, label) {
  const text = (node) => typeof node === "string" ? node : node.children.map(text).join("");
  return renderer.root.findAllByType("button").find((node) => text(node) === label);
}

test("the recovery export keeps its object URL alive through the click's frame", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalFrame = globalThis.requestAnimationFrame;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const state = { requests: [], blobs: [], links: [], revoked: [], frames: [] };
  globalThis.fetch = async (url) => {
    state.requests.push(url);
    if (url === RETAINED) return { ok: true, json: async () => ({ ok: true, exists: true, count: null }) };
    assert.equal(url, `${RETAINED}?download=1`);
    return { ok: true, blob: async () => new Blob([stored]) };
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, "a");
    const link = { clicked: false, click() { this.clicked = true; } };
    state.links.push(link);
    return link;
  } };
  URL.createObjectURL = (blob) => { state.blobs.push(blob); return `blob:fixture-${state.blobs.length}`; };
  URL.revokeObjectURL = (url) => state.revoked.push(url);
  globalThis.requestAnimationFrame = (callback) => { state.frames.push(callback); return state.frames.length; };
  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(LiveRegionProvider, null, createElement(OpenCovenSubmissionPage)));
    });
    const exportButton = button(renderer, "Export");
    assert.ok(exportButton, "saved data offers an export");
    await act(async () => exportButton.props.onClick());
    assert.equal(state.links.length, 1);
    assert.equal(state.links[0].clicked, true);
    assert.equal(state.links[0].href, "blob:fixture-1");
    assert.equal(state.links[0].download, "opencoven-submissions.json");
    assert.deepEqual(Buffer.from(await state.blobs[0].arrayBuffer()), stored, "the download is the stored bytes");
    // Safari, the engine of the packaged macOS shell, needs the URL to outlive the click.
    assert.deepEqual(state.revoked, [], "the object URL is not revoked in the click's own task");
    for (const frame of state.frames.splice(0)) frame();
    assert.deepEqual(state.revoked, ["blob:fixture-1"], "the next frame releases it");
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete globalThis.document;
    globalThis.requestAnimationFrame = originalFrame;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
