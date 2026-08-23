// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_WIDTH_KEY,
  READING_WIDTH_VALUES,
  DEFAULT_READING_WIDTH,
  normalizeReadingWidth,
  readReadingWidth,
  applyReadingWidth,
} from "./reading-width.ts";

function setupDom() {
  const store = new Map();
  const props = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: (k) => props.delete(k),
      },
    },
  };
  return { store, props };
}

test("normalize falls back to default for junk/unknown", () => {
  assert.equal(normalizeReadingWidth("narrow"), "narrow");
  assert.equal(normalizeReadingWidth("huge"), DEFAULT_READING_WIDTH);
  assert.equal(normalizeReadingWidth(undefined), DEFAULT_READING_WIDTH);
});

test("apply(non-default) sets the var to the level's px value and persists", () => {
  const { store, props } = setupDom();
  applyReadingWidth("medium");
  assert.equal(props.get("--cave-reading-width"), READING_WIDTH_VALUES.medium);
  assert.equal(store.get(READING_WIDTH_KEY), "medium");
  assert.equal(readReadingWidth(), "medium");
});

test("apply(default/full) removes the override so .cave-md fills its container", () => {
  const { store, props } = setupDom();
  applyReadingWidth("narrow");
  applyReadingWidth("full");
  assert.equal(props.has("--cave-reading-width"), false);
  assert.equal(store.get(READING_WIDTH_KEY), "full");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_WIDTH_KEY, "garbage");
  assert.equal(readReadingWidth(), DEFAULT_READING_WIDTH);
});
