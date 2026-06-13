// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_ALIGN_KEY,
  DEFAULT_READING_ALIGN,
  normalizeReadingAlign,
  readReadingAlign,
  applyReadingAlign,
} from "./reading-align.ts";

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
  assert.equal(normalizeReadingAlign("justify"), "justify");
  assert.equal(normalizeReadingAlign("center"), DEFAULT_READING_ALIGN);
  assert.equal(normalizeReadingAlign(undefined), DEFAULT_READING_ALIGN);
});

test("apply(non-default) sets the var and persists", () => {
  const { store, props } = setupDom();
  applyReadingAlign("justify");
  assert.equal(props.get("--cave-reading-align"), "justify");
  assert.equal(store.get(READING_ALIGN_KEY), "justify");
  assert.equal(readReadingAlign(), "justify");
});

test("apply(default/left) removes the override so the stylesheet fallback wins", () => {
  const { store, props } = setupDom();
  applyReadingAlign("justify");
  applyReadingAlign("left");
  assert.equal(props.has("--cave-reading-align"), false);
  assert.equal(store.get(READING_ALIGN_KEY), "left");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_ALIGN_KEY, "garbage");
  assert.equal(readReadingAlign(), DEFAULT_READING_ALIGN);
});
