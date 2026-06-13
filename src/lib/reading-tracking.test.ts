// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_TRACKING_KEY,
  READING_TRACKING_VALUES,
  DEFAULT_READING_TRACKING,
  normalizeReadingTracking,
  readReadingTracking,
  applyReadingTracking,
} from "./reading-tracking.ts";

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
  assert.equal(normalizeReadingTracking("wider"), "wider");
  assert.equal(normalizeReadingTracking("huge"), DEFAULT_READING_TRACKING);
  assert.equal(normalizeReadingTracking(undefined), DEFAULT_READING_TRACKING);
});

test("apply(non-default) sets the var to the level's em value and persists", () => {
  const { store, props } = setupDom();
  applyReadingTracking("wide");
  assert.equal(props.get("--cave-reading-tracking"), READING_TRACKING_VALUES.wide);
  assert.equal(store.get(READING_TRACKING_KEY), "wide");
  assert.equal(readReadingTracking(), "wide");
});

test("apply(default/normal) removes the override so the stylesheet fallback wins", () => {
  const { store, props } = setupDom();
  applyReadingTracking("wider");
  applyReadingTracking("normal");
  assert.equal(props.has("--cave-reading-tracking"), false);
  assert.equal(store.get(READING_TRACKING_KEY), "normal");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_TRACKING_KEY, "garbage");
  assert.equal(readReadingTracking(), DEFAULT_READING_TRACKING);
});
