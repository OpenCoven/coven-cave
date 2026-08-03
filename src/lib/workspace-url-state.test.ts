import assert from "node:assert/strict";
import test from "node:test";

import { readModeParam } from "./workspace-url-state.ts";

function withSearch(search: string, run: () => void): void {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { search } } as unknown as Window & typeof globalThis;
  try {
    run();
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previousWindow;
  }
}

test("readModeParam accepts generic role-surface deep links", () => {
  withSearch("?mode=surface%3Aresearcher-desk", () => {
    assert.equal(readModeParam(), "surface:researcher-desk");
  });
});

test("readModeParam still rejects empty and unknown modes", () => {
  withSearch("?mode=surface%3A", () => {
    assert.equal(readModeParam(), null);
  });
  withSearch("?mode=not-a-workspace", () => {
    assert.equal(readModeParam(), null);
  });
});
