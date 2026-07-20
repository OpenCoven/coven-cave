import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_MOTION_WINDOW_MS,
  BROWSER_RECONCILE_INTERVAL_MS,
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
