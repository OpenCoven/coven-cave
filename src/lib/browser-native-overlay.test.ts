import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_MOTION_WINDOW_MS,
  BROWSER_RECONCILE_INTERVAL_MS,
  nativeBrowserBounds,
  NATIVE_WEBVIEW_COVER_SELECTOR,
  WEBVIEW_OFFSCREEN,
} from "./browser-native-overlay.ts";

test("native browser overlay constants retain the desktop lifecycle contract", () => {
  assert.match(NATIVE_WEBVIEW_COVER_SELECTOR, /\[role="dialog"\]/);
  assert.match(NATIVE_WEBVIEW_COVER_SELECTOR, /\[role="listbox"\]/);
  assert.equal(WEBVIEW_OFFSCREEN, -10000);
  assert.equal(BROWSER_RECONCILE_INTERVAL_MS, 100);
  assert.equal(BROWSER_MOTION_WINDOW_MS, 400);
});

test("native browser bounds use the renderer's physical pixel ratio", () => {
  const rect = { left: 56.25, top: 35.5, width: 1314.5, height: 872.25 };
  assert.deepEqual(nativeBrowserBounds(rect, false, 1.5), {
    x: 84,
    y: 53,
    w: 1972,
    h: 1309,
  });
  assert.deepEqual(nativeBrowserBounds(rect, true, 2), {
    x: WEBVIEW_OFFSCREEN,
    y: WEBVIEW_OFFSCREEN,
    w: 2629,
    h: 1745,
  });
  assert.deepEqual(nativeBrowserBounds(rect, false, Number.NaN), {
    x: 56,
    y: 36,
    w: 1315,
    h: 872,
  });

  assert.deepEqual(nativeBrowserBounds({ left: 0.4, top: 0.4, width: 1.2, height: 1.2 }, false, 1.25), {
    x: 1,
    y: 1,
    w: 1,
    h: 1,
  });
});
