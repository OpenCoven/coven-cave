// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORNER_RADIUS_KEY,
  CORNER_RADIUS_VALUES,
  DEFAULT_CORNER_RADIUS,
  normalizeCornerRadius,
  readCornerRadius,
  applyCornerRadius,
} from "./appearance-corner-radius.ts";

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
  assert.equal(normalizeCornerRadius("pill"), "pill");
  assert.equal(normalizeCornerRadius("squircle"), DEFAULT_CORNER_RADIUS);
  assert.equal(normalizeCornerRadius(undefined), DEFAULT_CORNER_RADIUS);
});

test("apply(non-default) overrides all three radius tokens and persists", () => {
  const { store, props } = setupDom();
  applyCornerRadius("round");
  assert.equal(props.get("--radius"), CORNER_RADIUS_VALUES.round.base);
  assert.equal(props.get("--radius-control"), CORNER_RADIUS_VALUES.round.control);
  assert.equal(props.get("--radius-card"), CORNER_RADIUS_VALUES.round.card);
  assert.equal(store.get(CORNER_RADIUS_KEY), "round");
  assert.equal(readCornerRadius(), "round");
});

test("apply(pill) makes controls fully round but caps card radius at 20px", () => {
  const { props } = setupDom();
  applyCornerRadius("pill");
  assert.equal(props.get("--radius-control"), "999px");
  assert.equal(props.get("--radius-card"), "20px");
});

test("apply(default) removes the overrides so :root token values apply", () => {
  const { store, props } = setupDom();
  applyCornerRadius("sharp");
  applyCornerRadius("default");
  assert.equal(props.has("--radius"), false);
  assert.equal(props.has("--radius-control"), false);
  assert.equal(props.has("--radius-card"), false);
  assert.equal(store.get(CORNER_RADIUS_KEY), "default");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(CORNER_RADIUS_KEY, "garbage");
  assert.equal(readCornerRadius(), DEFAULT_CORNER_RADIUS);
});
