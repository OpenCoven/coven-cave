// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_LEADING_KEY,
  READING_LEADING_VALUES,
  DEFAULT_READING_LEADING,
  normalizeReadingLeading,
  readReadingLeading,
  applyReadingLeading,
} from "./reading-leading.ts";

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
  assert.equal(normalizeReadingLeading("relaxed"), "relaxed");
  assert.equal(normalizeReadingLeading("nope"), DEFAULT_READING_LEADING);
  assert.equal(normalizeReadingLeading(undefined), DEFAULT_READING_LEADING);
});

test("apply(non-default) sets the var to the level's value and persists", () => {
  const { store, props } = setupDom();
  applyReadingLeading("relaxed");
  assert.equal(props.get("--cave-reading-leading"), String(READING_LEADING_VALUES.relaxed));
  assert.equal(store.get(READING_LEADING_KEY), "relaxed");
  assert.equal(readReadingLeading(), "relaxed");
});

test("apply(default/normal) removes the override so the stylesheet fallback wins", () => {
  const { store, props } = setupDom();
  applyReadingLeading("compact");
  applyReadingLeading("normal");
  assert.equal(props.has("--cave-reading-leading"), false);
  assert.equal(store.get(READING_LEADING_KEY), "normal");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_LEADING_KEY, "garbage");
  assert.equal(readReadingLeading(), DEFAULT_READING_LEADING);
});
