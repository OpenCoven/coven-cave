// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// SurfaceRail — the shared collapsible/resizable list rail primitive that the
// design-handoff surfaces (Sessions / Projects / Group / Familiar) reuse.
// Pure logic (clamp, persistence, keyboard resize) is exercised directly from
// src/lib/surface-rail-state.ts; the component + stylesheet contracts are
// pinned as source text per repo convention.

import {
  SURFACE_RAIL_DEFAULT_WIDTH,
  SURFACE_RAIL_MIN_WIDTH,
  SURFACE_RAIL_MAX_WIDTH,
  SURFACE_RAIL_COLLAPSED_WIDTH,
  SURFACE_RAIL_KEY_STEP,
  clampSurfaceRailWidth,
  readSurfaceRailPrefs,
  writeSurfaceRailWidth,
  writeSurfaceRailOpen,
  surfaceRailWidthKey,
  surfaceRailOpenKey,
  surfaceRailKeyboardResize,
} from "../lib/surface-rail-state.ts";

const src = readFileSync(new URL("./ui/surface-rail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/surface-rail.css", import.meta.url), "utf8");

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

const throwingStorage = {
  getItem() {
    throw new Error("storage denied");
  },
  setItem() {
    throw new Error("storage denied");
  },
};

test("clamp: 200–440 range, rounded, NaN falls back to the default", () => {
  assert.equal(SURFACE_RAIL_DEFAULT_WIDTH, 280);
  assert.equal(SURFACE_RAIL_MIN_WIDTH, 200);
  assert.equal(SURFACE_RAIL_MAX_WIDTH, 440);
  assert.equal(clampSurfaceRailWidth(280), 280);
  assert.equal(clampSurfaceRailWidth(320.6), 321, "widths round to whole px");
  assert.equal(clampSurfaceRailWidth(10), SURFACE_RAIL_MIN_WIDTH);
  assert.equal(clampSurfaceRailWidth(-50), SURFACE_RAIL_MIN_WIDTH);
  assert.equal(clampSurfaceRailWidth(9999), SURFACE_RAIL_MAX_WIDTH);
  assert.equal(clampSurfaceRailWidth(Number.NaN), SURFACE_RAIL_DEFAULT_WIDTH);
  assert.equal(clampSurfaceRailWidth(Number.NaN, 300), 300, "explicit fallback wins");
  assert.equal(
    clampSurfaceRailWidth(Number.POSITIVE_INFINITY, 300),
    300,
    "non-finite candidates use the fallback, not the max",
  );
});

test("persistence keys derive from storageKey (`<key>:width` / `<key>:open`)", () => {
  assert.equal(surfaceRailWidthKey("cave:familiar-tab:rail"), "cave:familiar-tab:rail:width");
  assert.equal(surfaceRailOpenKey("cave:familiar-tab:rail"), "cave:familiar-tab:rail:open");
});

test("read: defaults on empty storage, persisted values clamp, garbage/failed storage falls back", () => {
  assert.deepEqual(readSurfaceRailPrefs(fakeStorage(), "k"), {
    width: SURFACE_RAIL_DEFAULT_WIDTH,
    open: true,
  });
  assert.deepEqual(
    readSurfaceRailPrefs(fakeStorage({ "k:width": "320", "k:open": "0" }), "k"),
    { width: 320, open: false },
  );
  assert.deepEqual(
    readSurfaceRailPrefs(fakeStorage({ "k:width": "9999", "k:open": "1" }), "k"),
    { width: SURFACE_RAIL_MAX_WIDTH, open: true },
    "persisted widths re-clamp on read",
  );
  assert.deepEqual(
    readSurfaceRailPrefs(fakeStorage({ "k:width": "banana" }), "k", 260),
    { width: 260, open: true },
    "unparseable widths keep the caller default",
  );
  assert.deepEqual(readSurfaceRailPrefs(null, "k"), {
    width: SURFACE_RAIL_DEFAULT_WIDTH,
    open: true,
  });
  assert.deepEqual(
    readSurfaceRailPrefs(throwingStorage, "k"),
    { width: SURFACE_RAIL_DEFAULT_WIDTH, open: true },
    "storage failures are silently ignored",
  );
});

test("write: clamped width + open flag round-trip; failures never throw", () => {
  const storage = fakeStorage();
  writeSurfaceRailWidth(storage, "k", 999);
  writeSurfaceRailOpen(storage, "k", false);
  assert.equal(storage.map.get("k:width"), String(SURFACE_RAIL_MAX_WIDTH));
  assert.equal(storage.map.get("k:open"), "0");
  writeSurfaceRailOpen(storage, "k", true);
  assert.equal(storage.map.get("k:open"), "1");
  assert.deepEqual(readSurfaceRailPrefs(storage, "k"), { width: SURFACE_RAIL_MAX_WIDTH, open: true });
  assert.doesNotThrow(() => writeSurfaceRailWidth(throwingStorage, "k", 300));
  assert.doesNotThrow(() => writeSurfaceRailOpen(throwingStorage, "k", true));
});

test("keyboard resize: Left narrows / Right widens ±16, clamped; other keys are ignored", () => {
  assert.equal(SURFACE_RAIL_KEY_STEP, 16);
  assert.equal(surfaceRailKeyboardResize(280, "ArrowLeft"), 264);
  assert.equal(surfaceRailKeyboardResize(280, "ArrowRight"), 296);
  assert.equal(surfaceRailKeyboardResize(SURFACE_RAIL_MIN_WIDTH, "ArrowLeft"), SURFACE_RAIL_MIN_WIDTH);
  assert.equal(surfaceRailKeyboardResize(SURFACE_RAIL_MAX_WIDTH, "ArrowRight"), SURFACE_RAIL_MAX_WIDTH);
  assert.equal(surfaceRailKeyboardResize(280, "ArrowUp"), null);
  assert.equal(surfaceRailKeyboardResize(280, "Enter"), null);
});

test("component: prefs read lazily behind a window guard, written on change", () => {
  assert.match(
    src,
    /typeof window === "undefined" \? null : window\.localStorage/,
    "storage access is SSR-guarded",
  );
  assert.match(
    src,
    /useState\(\(\) => readSurfaceRailPrefs\(localStorageOrNull\(\), storageKey, defaultWidth\)\)/,
    "prefs are read lazily on first render",
  );
  assert.match(src, /writeSurfaceRailWidth\(localStorageOrNull\(\), storageKey, width\)/, "width persists on change");
  assert.match(src, /writeSurfaceRailOpen\(localStorageOrNull\(\), storageKey, open\)/, "open persists on change");
});

test("component: collapse toggle is a real button with aria-expanded and state-aware names", () => {
  assert.match(src, /aria-expanded=\{open\}/, "toggle announces expansion state");
  assert.match(src, /open \? "Collapse sidebar" : "Expand sidebar"/, "state-aware accessible name");
  assert.match(src, /title=\{toggleLabel\}\s*aria-label=\{toggleLabel\}/, "title and aria-label agree");
  assert.match(src, /<Icon name="ph:sidebar-simple"/, "curated sidebar icon");
});

test("component: resize handle is an accessible splitter (separator + arrows + double-click reset)", () => {
  assert.match(src, /role="separator"/, "splitter role");
  assert.match(src, /aria-orientation="vertical"/, "vertical orientation");
  assert.match(src, /aria-label="Resize sidebar"/, "labelled splitter");
  assert.match(src, /aria-valuemin=\{SURFACE_RAIL_MIN_WIDTH\}[\s\S]{0,80}?aria-valuemax=\{SURFACE_RAIL_MAX_WIDTH\}[\s\S]{0,80}?aria-valuenow=\{width\}/, "splitter reports its value range");
  assert.match(src, /tabIndex=\{0\}/, "keyboard focusable");
  assert.match(
    src,
    /const next = surfaceRailKeyboardResize\(width, event\.key\);[\s\S]{0,120}?setWidth\(next\)/,
    "arrow keys resize through the shared clamp",
  );
  assert.match(src, /onDoubleClick=\{\(\) => setWidth\(defaultWidth\)\}/, "double-click resets to the default width");
  assert.match(src, /setPointerCapture\(event\.pointerId\)/, "drag captures the pointer");
  assert.match(
    src,
    /clampSurfaceRailWidth\(drag\.startWidth \+ \(event\.clientX - drag\.startX\)\)/,
    "drag width stays clamped",
  );
});

test("component: children render-prop receives open + setOpen so rows can collapse to icons and re-expand the rail", () => {
  assert.match(
    src,
    /typeof children === "function" \? children\(open, setOpen\) : children/,
    "render-prop children get the open flag and the setter",
  );
});

test("stylesheet: 56px collapsed width, tokenized width transition suppressed for drag and reduced motion", () => {
  assert.match(
    css,
    new RegExp(`\\.surface-rail\\[data-open="false"\\] \\{[^}]*width: ${SURFACE_RAIL_COLLAPSED_WIDTH}px`),
    "collapsed width matches the exported constant",
  );
  assert.match(
    css,
    /\.surface-rail \{[^}]*transition: width var\(--duration-base\) var\(--ease-standard\)/,
    "open/collapse width transition uses motion tokens (~.18s ease)",
  );
  assert.match(css, /\.surface-rail\[data-dragging="true"\] \{[^}]*transition: none/, "no transition while dragging");
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,200}?\.surface-rail \{[^}]*transition: none/,
    "reduced motion drops the width transition",
  );
  assert.match(
    css,
    /\.surface-rail__resize:hover,[\s\S]{0,200}?background: color-mix\(in oklch, var\(--accent-presence\) 25%, transparent\)/,
    "resize affordance uses the 25% accent tint",
  );
  assert.match(css, /\.surface-rail \{[^}]*border-right: 1px solid var\(--border-hairline\)/, "right hairline seam");
});
