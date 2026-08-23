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
  assert.equal(normalizeCornerRadius("pill"), DEFAULT_CORNER_RADIUS);
  assert.equal(normalizeCornerRadius("squircle"), DEFAULT_CORNER_RADIUS);
  assert.equal(normalizeCornerRadius(undefined), DEFAULT_CORNER_RADIUS);
});

test("apply(non-default) overrides all five radius tokens and persists", () => {
  const { store, props } = setupDom();
  applyCornerRadius("round");
  assert.equal(props.get("--radius"), CORNER_RADIUS_VALUES.round.base);
  assert.equal(props.get("--radius-control"), CORNER_RADIUS_VALUES.round.control);
  assert.equal(props.get("--radius-card"), CORNER_RADIUS_VALUES.round.card);
  assert.equal(props.get("--radius-panel"), CORNER_RADIUS_VALUES.round.panel);
  assert.equal(props.get("--radius-pill"), CORNER_RADIUS_VALUES.round.pill);
  assert.equal(store.get(CORNER_RADIUS_KEY), "round");
  assert.equal(readCornerRadius(), "round");
});

// The defect this pins (cave-uvwhh / #4350): --radius-panel was absent from
// CORNER_RADIUS_VALUES, so "Sharp" dropped controls to 2px and cards to 4px
// while every modal and panel stayed at the :root 16px — a panel rounder than
// the cards inside it. The ladder must stay ordered and strictly increasing at
// every level, which is the property that keeps nested surfaces reading right.
test("every level keeps control < card < panel", () => {
  for (const level of ["sharp", "round"]) {
    const { control, card, panel } = CORNER_RADIUS_VALUES[level];
    const px = (v) => Number.parseFloat(v);
    assert.ok(
      px(control) < px(card) && px(card) < px(panel),
      `${level}: expected control < card < panel, got ${control} / ${card} / ${panel}`,
    );
  }
});

// Every non-pill step of the documented radius scale (design language §2:
// control 8 · card 12 · panel 16) must be rescaled by the setting. A token
// that themes.css rescales but this setting ignores is exactly how the two
// mechanisms drift apart.
test("the setting covers every radius token themes.css rescales", () => {
  const themed = ["control", "card", "panel"];
  for (const level of ["sharp", "round"]) {
    for (const step of themed) {
      assert.ok(
        typeof CORNER_RADIUS_VALUES[level][step] === "string",
        `${level} is missing a value for --radius-${step}`,
      );
    }
  }
});

test("sharp squares the signature pill; round keeps the full capsule", () => {
  const { props } = setupDom();
  applyCornerRadius("sharp");
  assert.equal(props.get("--radius-pill"), CORNER_RADIUS_VALUES.sharp.pill);
  assert.notEqual(CORNER_RADIUS_VALUES.sharp.pill, "999px");
  assert.equal(CORNER_RADIUS_VALUES.round.pill, "999px");
});

test("apply(default) removes the overrides so :root token values apply", () => {
  const { store, props } = setupDom();
  applyCornerRadius("sharp");
  applyCornerRadius("default");
  assert.equal(props.has("--radius"), false);
  assert.equal(props.has("--radius-control"), false);
  assert.equal(props.has("--radius-card"), false);
  assert.equal(props.has("--radius-panel"), false);
  assert.equal(props.has("--radius-pill"), false);
  assert.equal(store.get(CORNER_RADIUS_KEY), "default");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(CORNER_RADIUS_KEY, "garbage");
  assert.equal(readCornerRadius(), DEFAULT_CORNER_RADIUS);
});
