// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  READING_DROPCAP_KEY,
  READING_DROPCAP_ATTR,
  DEFAULT_READING_DROPCAP,
  normalizeReadingDropcap,
  readReadingDropcap,
  applyReadingDropcap,
} from "./reading-dropcap.ts";

function setupDom() {
  const store = new Map();
  const attrs = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    },
  };
  return { store, attrs };
}

test("normalize falls back to default for junk/unknown", () => {
  assert.equal(normalizeReadingDropcap("on"), "on");
  assert.equal(normalizeReadingDropcap("maybe"), DEFAULT_READING_DROPCAP);
  assert.equal(normalizeReadingDropcap(undefined), DEFAULT_READING_DROPCAP);
});

test("apply(on) sets the data attribute and persists", () => {
  const { store, attrs } = setupDom();
  applyReadingDropcap("on");
  assert.equal(attrs.get(READING_DROPCAP_ATTR), "on");
  assert.equal(store.get(READING_DROPCAP_KEY), "on");
  assert.equal(readReadingDropcap(), "on");
});

test("apply(off/default) removes the attribute so the gated rule never matches", () => {
  const { store, attrs } = setupDom();
  applyReadingDropcap("on");
  applyReadingDropcap("off");
  assert.equal(attrs.has(READING_DROPCAP_ATTR), false);
  assert.equal(store.get(READING_DROPCAP_KEY), "off");
});

test("read returns default for unknown stored value", () => {
  const { store } = setupDom();
  store.set(READING_DROPCAP_KEY, "garbage");
  assert.equal(readReadingDropcap(), DEFAULT_READING_DROPCAP);
});

// The drop-cap rule must be scoped to the library reader (.library-preview-md)
// and gated by the attribute — never the shared chat/memory .cave-md surface.
test("CSS rule is library-scoped + attribute-gated", () => {
  const css = readFileSync(new URL("../styles/library.css", import.meta.url), "utf8");
  assert.match(
    css,
    /html\[data-reading-dropcap="on"\] \.library-preview-md\.cave-md p:first-of-type::first-letter/,
    "drop-cap rule must target the library reader's first paragraph, gated by the attribute",
  );
});
