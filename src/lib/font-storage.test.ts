// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { fontStack, fontOptionById, DEFAULT_FONT_ID } from "./font-catalog.ts";
import {
  FONT_SERIF_KEY,
  FONT_SANS_KEY,
  FONT_MONO_KEY,
  readFontPref,
  writeFontPref,
  applyFont,
  readFontPairPref,
  writeFontPairPref,
  applyFontPair,
} from "./font-storage.ts";

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

test("write then read round-trips a valid sans id", () => {
  setupDom();
  writeFontPref("sans", "geist");
  assert.equal(readFontPref("sans"), "geist");
  assert.equal(globalThis.window.localStorage.getItem(FONT_SANS_KEY), "geist");
});

test("write then read round-trips a valid serif id", () => {
  setupDom();
  writeFontPref("serif", "instrument-serif");
  assert.equal(readFontPref("serif"), "instrument-serif");
  assert.equal(globalThis.window.localStorage.getItem(FONT_SERIF_KEY), "instrument-serif");
});

test("unknown/garbage id reads back as the slot default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "not-a-font");
  store.set(FONT_SERIF_KEY, "not-a-font");
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
  assert.equal(readFontPref("serif"), DEFAULT_FONT_ID.serif);
});

test("a mono id stored under the sans key falls back to default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "fira-code");
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
});

test("a sans id stored under the serif key falls back to default", () => {
  const { store } = setupDom();
  store.set(FONT_SERIF_KEY, "inter");
  assert.equal(readFontPref("serif"), DEFAULT_FONT_ID.serif);
});

test("applyFont(non-default) sets the var to the fontStack", () => {
  const { props } = setupDom();
  applyFont("sans", "geist");
  assert.equal(props.get("--font-sans"), fontStack(fontOptionById("geist")));
});

test("applyFont(default) removes the override", () => {
  const { props } = setupDom();
  applyFont("sans", "geist");
  applyFont("sans", DEFAULT_FONT_ID.sans);
  assert.equal(props.has("--font-sans"), false);
});

test("mono slot uses the mono key and --font-mono var", () => {
  const { props } = setupDom();
  // geist-mono is a non-default mono (default is jetbrains-mono), so it
  // sets the override rather than clearing it.
  writeFontPref("mono", "geist-mono");
  applyFont("mono", "geist-mono");
  assert.equal(readFontPref("mono"), "geist-mono");
  assert.equal(props.get("--font-mono"), fontStack(fontOptionById("geist-mono")));
});

test("serif slot uses the serif key and --font-serif var", () => {
  const { props } = setupDom();
  // fraunces is a non-default serif (default is eb-garamond), so it
  // sets the override rather than clearing it.
  writeFontPref("serif", "fraunces");
  applyFont("serif", "fraunces");
  assert.equal(readFontPref("serif"), "fraunces");
  assert.equal(props.get("--font-serif"), fontStack(fontOptionById("fraunces")));
});

test("readFontPairPref accepts only curated serif/sans/mono pairs", () => {
  const { store } = setupDom();
  store.set(FONT_SERIF_KEY, "instrument-serif");
  store.set(FONT_SANS_KEY, "inter");
  store.set(FONT_MONO_KEY, "jetbrains-mono");
  assert.equal(readFontPairPref().id, "editorial-witch");

  // Reset back to canon.
  store.set(FONT_SERIF_KEY, "eb-garamond");
  assert.equal(readFontPairPref().id, "coven-canon");
});

test("writeFontPairPref stores all three paired slots together", () => {
  setupDom();
  writeFontPairPref("editorial-witch");
  assert.equal(readFontPref("serif"), "instrument-serif");
  assert.equal(readFontPref("sans"), "inter");
  assert.equal(readFontPref("mono"), "jetbrains-mono");
  assert.equal(
    globalThis.window.localStorage.getItem(FONT_SERIF_KEY),
    "instrument-serif",
  );
  assert.equal(globalThis.window.localStorage.getItem(FONT_SANS_KEY), "inter");
  assert.equal(globalThis.window.localStorage.getItem(FONT_MONO_KEY), "jetbrains-mono");
});

test("applyFontPair applies the curated serif/sans/mono stacks together", () => {
  const { props } = setupDom();
  applyFontPair("editorial-witch");
  // sans + mono match the coven-canon defaults so applyFont clears their overrides.
  // Only serif differs from default (instrument-serif vs eb-garamond) so it's set.
  assert.equal(props.get("--font-serif"), fontStack(fontOptionById("instrument-serif")));
  assert.equal(props.has("--font-sans"), false, "sans matches default; override should be cleared");
  assert.equal(props.has("--font-mono"), false, "mono matches default; override should be cleared");
});
