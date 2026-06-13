// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { fontStack, fontOptionById, DEFAULT_FONT_ID } from "./font-catalog.ts";
import {
  FONT_SANS_KEY,
  FONT_MONO_KEY,
  readFontPref,
  writeFontPref,
  applyFont,
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

test("write then read round-trips a valid id", () => {
  setupDom();
  writeFontPref("sans", "inter");
  assert.equal(readFontPref("sans"), "inter");
  assert.equal(globalThis.window.localStorage.getItem(FONT_SANS_KEY), "inter");
});

test("unknown/garbage id reads back as the slot default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "not-a-font");
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
});

test("a mono id stored under the sans key falls back to default", () => {
  const { store } = setupDom();
  store.set(FONT_SANS_KEY, "fira-code");
  assert.equal(readFontPref("sans"), DEFAULT_FONT_ID.sans);
});

test("applyFont(non-default) sets the var to the fontStack", () => {
  const { props } = setupDom();
  applyFont("sans", "inter");
  assert.equal(props.get("--font-sans"), fontStack(fontOptionById("inter")));
});

test("applyFont(default) removes the override", () => {
  const { props } = setupDom();
  applyFont("sans", "inter");
  applyFont("sans", DEFAULT_FONT_ID.sans);
  assert.equal(props.has("--font-sans"), false);
});

test("mono slot uses the mono key and --font-mono var", () => {
  const { props } = setupDom();
  // geist-mono is a non-default mono now (default is jetbrains-mono), so it
  // sets the override rather than clearing it.
  writeFontPref("mono", "geist-mono");
  applyFont("mono", "geist-mono");
  assert.equal(readFontPref("mono"), "geist-mono");
  assert.equal(props.get("--font-mono"), fontStack(fontOptionById("geist-mono")));
});
