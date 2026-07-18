// Source pins for the React wrapper — the controller behind it has
// behavioral coverage in dictation-controller.test.ts. These pins keep the
// wrapper honest about lifecycle wiring without a DOM renderer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-dictation.ts", import.meta.url), "utf8");

test("hook builds the controller with the shared ears resolver", () => {
  assert.match(src, /createDictationController\(/);
  assert.match(src, /resolveDictationEars,?\s*\)/);
});

test("controller is closed on unmount and on a cancelled init race", () => {
  assert.match(src, /cancelled = true;\s*\n\s*controllerRef\.current\?\.close\(\)/);
  assert.match(src, /if \(cancelled\) \{\s*\n\s*controller\?\.close\(\)/);
});

test("finals clear the partial before reaching the consumer", () => {
  assert.match(src, /onFinal: \(text\) => \{\s*\n\s*setPartial\(""\);\s*\n\s*onFinalRef\.current\(text\)/);
});

test("callback refs keep the effect mount-once (no stale closures)", () => {
  assert.match(src, /onFinalRef\.current = onFinal/);
  assert.match(src, /\}, \[\]\);/);
});
