// @ts-nocheck
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { LiveRegionProvider } from "@/components/ui/live-region";
import { AskSalemView } from "./ask-salem-view";
import { paletteDestinations } from "@/lib/workspace-destination-policy";
import { normalizeWorkspacePaneRequest } from "@/lib/workspace-pane-request";
import { readModeParam, readSplitPageParam } from "@/lib/workspace-url-state";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const view = () => createElement(LiveRegionProvider, { children: createElement(AskSalemView) });

test("legacy Salem view explains retirement without a composer or an assistant request", async () => {
  let renderer;
  try {
    await act(async () => { renderer = create(view()); });
    assert.match(JSON.stringify(renderer.toJSON()), /Ask Salem has been retired/);
    assert.match(JSON.stringify(renderer.toJSON()), /Export saved Salem history/);
    for (const type of ["form", "textarea", "select", "input"]) assert.equal(renderer.root.findAllByType(type).length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("the palette no longer offers the retired Salem destination", () => {
  assert.equal(paletteDestinations().some((entry) => entry.id === "salem"), false);
});

test("saved primary and split Salem links retain their address for the inert notice", () => {
  const previous = globalThis.window;
  globalThis.window = { location: { search: "?mode=salem&split=salem" } };
  try {
    assert.equal(readModeParam(), "salem");
    assert.equal(readSplitPageParam(), "salem");
    assert.equal(normalizeWorkspacePaneRequest("legacy", "salem")?.pageId, "salem");
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

for (const sample of [
  { name: "existing history", raw: JSON.stringify(Array.from({ length: 60 }, (_, at) => ({ role: "user", text: `保留 ${at}`, at, legacy: true }))) },
  { name: "unrecognized legacy payload", raw: "{legacy payload preserved verbatim" },
  { name: "missing history", raw: null },
  { name: "blocked browser storage", blocked: true },
]) {
  test(`history export preserves ${sample.name} without an assistant request or storage write`, async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousFrame = globalThis.requestAnimationFrame;
    const frames = [];
    globalThis.requestAnimationFrame = fn => frames.push(fn);
    let blob;
    let clicks = 0;
    let renderer;
    globalThis.window = { localStorage: {
      getItem: key => {
        assert.equal(key, "cave:ask-salem:thread:v1");
        if (sample.blocked) throw new Error("Storage access denied");
        return sample.raw;
      },
      setItem: () => { throw new Error("Must not rewrite old history"); },
      removeItem: () => { throw new Error("Must not delete old history"); },
    } };
    globalThis.document = { createElement: tag => {
      assert.equal(tag, "a");
      return { click() { assert.equal(this.download, "cave-salem-history.json"); clicks++; } };
    } };
    globalThis.fetch = () => { throw new Error("Retirement must not fetch"); };
    const createUrl = mock.method(URL, "createObjectURL", value => { blob = value; return "blob:retained-history"; });
    const revokeUrl = mock.method(URL, "revokeObjectURL", () => {});
    try {
      await act(async () => { renderer = create(view()); });
      await act(async () => { renderer.root.findByType("button").props.onClick(); });
      if (sample.raw !== null && !sample.blocked) {
        assert.equal(clicks, 1);
        assert.equal(await blob.text(), sample.raw, "export must not parse, truncate or normalize old data");
        assert.equal(createUrl.mock.callCount(), 1);
        assert.equal(revokeUrl.mock.callCount(), 0, "Safari download keeps its URL until the next frame");
        assert.equal(frames.length, 1);
        frames[0]();
        assert.deepEqual(revokeUrl.mock.calls.map(call => call.arguments), [["blob:retained-history"]]);
      } else {
        assert.equal(clicks, 0);
        assert.equal(createUrl.mock.callCount(), 0);
        assert.match(JSON.stringify(renderer.toJSON()), sample.blocked ? /Couldn't export saved history/ : /No saved Salem history/);
      }
    } finally {
      if (renderer) await act(async () => renderer.unmount());
      createUrl.mock.restore();
      revokeUrl.mock.restore();
      globalThis.fetch = previousFetch;
      if (previousFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousFrame;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  });
}
