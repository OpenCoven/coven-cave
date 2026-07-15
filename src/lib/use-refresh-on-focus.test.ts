// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRefresh, safeUnlisten } from "./use-refresh-on-focus.ts";

// ── shouldRefresh: throttle gate ──
assert.equal(shouldRefresh(0, 1500, 1500), true, "fires once the interval has elapsed");
assert.equal(shouldRefresh(0, 1499, 1500), false, "suppressed inside the interval");
assert.equal(shouldRefresh(1000, 3000, 1500), true, "fires when enough time has passed since last");
assert.equal(shouldRefresh(1000, 1200, 1500), false, "suppressed for a rapid re-focus flurry");

// ── safeUnlisten: never throws into React cleanup ──
let called = 0;
safeUnlisten(() => { called++; });
assert.equal(called, 1, "invokes the unlisten fn");
safeUnlisten(undefined); // no-op, no crash
assert.doesNotThrow(
  () => safeUnlisten(() => { throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')"); }),
  "swallows Tauri unregisterListener throwing on a stale listener registry (HMR/webview reload)",
);

// Tauri v2's unlisten is an async fn typed `() => void` — a stale-registry
// TypeError arrives as a rejected promise, which must be swallowed too or it
// becomes an unhandled rejection (Next dev overlay error).
{
  let unhandled;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);
  safeUnlisten((async () => {
    throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
  }) as unknown as () => void);
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, undefined, "swallows the async rejection from Tauri v2's async unlisten fn");
}

// ── source wiring: all three foreground signals + Tauri focus ──
const src = readFileSync(new URL("./use-refresh-on-focus.ts", import.meta.url), "utf8");
assert.match(src, /window\.addEventListener\("focus", run\)/, "wires window focus");
assert.match(src, /document\.addEventListener\("visibilitychange", onVisible\)/, "wires visibilitychange");
assert.match(src, /getCurrentWindow\(\)\.onFocusChanged/, "wires the Tauri native focus event (the desktop fix)");
assert.match(src, /if \(isTauri\(\)\)/, "the Tauri path is guarded behind isTauri()");
assert.match(src, /removeEventListener\("focus", run\)[\s\S]*?removeEventListener\("visibilitychange"/, "cleans up the web listeners");
assert.match(src, /if \(disposed\) safeUnlisten\(un\);/, "late-resolving listen is torn down via the guard");
assert.match(src, /safeUnlisten\(unlisten\);/, "effect cleanup unlistens via the guard, not a bare call");
assert.doesNotMatch(src, /\bunlisten\?\.\(\)|\bun\(\)/, "no unguarded unlisten calls remain");

console.log("use-refresh-on-focus.test.ts: ok");
