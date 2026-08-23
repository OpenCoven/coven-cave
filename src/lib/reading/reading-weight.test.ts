// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READING_WEIGHT_KEY,
  READING_WEIGHT_VALUES,
  DEFAULT_READING_WEIGHT,
  normalizeReadingWeight,
  readReadingWeight,
  applyReadingWeight,
} from "./reading-weight.ts";

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
  assert.equal(normalizeReadingWeight("light"), "light");
  assert.equal(normalizeReadingWeight("bold"), DEFAULT_READING_WEIGHT);
  assert.equal(normalizeReadingWeight(undefined), DEFAULT_READING_WEIGHT);
});

test("apply(non-default) sets the var to the level's weight and persists", () => {
  const { store, props } = setupDom();
  applyReadingWeight("light");
  assert.equal(props.get("--cave-reading-weight"), READING_WEIGHT_VALUES.light);
  assert.equal(store.get(READING_WEIGHT_KEY), "light");
  assert.equal(readReadingWeight(), "light");
});

test("apply(default/normal) removes the override so the inherited 400 applies", () => {
  const { store, props } = setupDom();
  applyReadingWeight("medium");
  applyReadingWeight("normal");
  assert.equal(props.has("--cave-reading-weight"), false);
  assert.equal(store.get(READING_WEIGHT_KEY), "normal");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_WEIGHT_KEY, "garbage");
  assert.equal(readReadingWeight(), DEFAULT_READING_WEIGHT);
});
