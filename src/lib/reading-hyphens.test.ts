// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_HYPHENS_KEY,
  READING_HYPHENS_VALUES,
  DEFAULT_READING_HYPHENS,
  normalizeReadingHyphens,
  readReadingHyphens,
  applyReadingHyphens,
} from "./reading-hyphens.ts";

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
  assert.equal(normalizeReadingHyphens("on"), "on");
  assert.equal(normalizeReadingHyphens("auto"), DEFAULT_READING_HYPHENS);
  assert.equal(normalizeReadingHyphens(undefined), DEFAULT_READING_HYPHENS);
});

test("apply(on) sets the var to auto and persists", () => {
  const { store, props } = setupDom();
  applyReadingHyphens("on");
  assert.equal(props.get("--cave-reading-hyphens"), READING_HYPHENS_VALUES.on);
  assert.equal(props.get("--cave-reading-hyphens"), "auto");
  assert.equal(store.get(READING_HYPHENS_KEY), "on");
  assert.equal(readReadingHyphens(), "on");
});

test("apply(off/default) removes the override so the manual fallback applies", () => {
  const { store, props } = setupDom();
  applyReadingHyphens("on");
  applyReadingHyphens("off");
  assert.equal(props.has("--cave-reading-hyphens"), false);
  assert.equal(store.get(READING_HYPHENS_KEY), "off");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_HYPHENS_KEY, "garbage");
  assert.equal(readReadingHyphens(), DEFAULT_READING_HYPHENS);
});
