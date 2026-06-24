// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRefresh } from "./use-refresh-on-focus.ts";

// ── shouldRefresh: throttle gate ──
assert.equal(shouldRefresh(0, 1500, 1500), true, "fires once the interval has elapsed");
assert.equal(shouldRefresh(0, 1499, 1500), false, "suppressed inside the interval");
assert.equal(shouldRefresh(1000, 3000, 1500), true, "fires when enough time has passed since last");
assert.equal(shouldRefresh(1000, 1200, 1500), false, "suppressed for a rapid re-focus flurry");

// ── source wiring: all three foreground signals + Tauri focus ──
const src = readFileSync(new URL("./use-refresh-on-focus.ts", import.meta.url), "utf8");
assert.match(src, /window\.addEventListener\("focus", run\)/, "wires window focus");
assert.match(src, /document\.addEventListener\("visibilitychange", onVisible\)/, "wires visibilitychange");
assert.match(src, /getCurrentWindow\(\)\.onFocusChanged/, "wires the Tauri native focus event (the desktop fix)");
assert.match(src, /if \(isTauri\(\)\)/, "the Tauri path is guarded behind isTauri()");
assert.match(src, /removeEventListener\("focus", run\)[\s\S]*?removeEventListener\("visibilitychange"/, "cleans up the web listeners");

console.log("use-refresh-on-focus.test.ts: ok");
