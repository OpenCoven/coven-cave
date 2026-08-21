// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./use-stick-to-bottom.ts", import.meta.url), "utf8");

assert.match(
  hook,
  /onStickChange\?: \(stuck: boolean\) => void/,
  "callers can observe stick/release transitions",
);
assert.match(
  hook,
  /const onStickChangeRef = useRef\(opts\?\.onStickChange\);\s*onStickChangeRef\.current = opts\?\.onStickChange;/,
  "the transition notifier reads the latest callback without rebuilding listeners",
);
assert.match(
  hook,
  /const setStuck = useCallback\(\(next: boolean\) => \{\s*if \(stuckRef\.current === next\) return;\s*stuckRef\.current = next;\s*onStickChangeRef\.current\?\.\(next\);\s*\}, \[\]\);/,
  "notifications fire only after an actual stick-state transition",
);
assert.match(
  hook,
  /const stick = useCallback\(\(\) => \{\s*setStuck\(true\);/,
  "an explicit stick reports a released-to-stuck transition",
);
assert.match(
  hook,
  /e\.deltaY < 0 && stuckRef\.current && scrollable\(\)\) setStuck\(false\)/,
  "explicit upward intent reports release",
);
assert.match(
  hook,
  /el\.scrollHeight - el\.scrollTop - el\.clientHeight <= 4\) setStuck\(true\)/,
  "only the true bottom reports an automatic re-stick",
);
assert.match(
  hook,
  /return \{ stuckRef, schedulePin, stick \}/,
  "the existing pin API remains intact",
);
assert.doesNotMatch(
  hook,
  /gap < 48|clientHeight < 48/,
  "position-based auto-restick heuristics stay removed",
);

console.log("use-stick-to-bottom.test.ts: ok");
