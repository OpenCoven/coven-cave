// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./relative-time.tsx", import.meta.url), "utf8");

assert.match(src, /<time\b/, "renders a semantic <time> element");
assert.match(src, /dateTime=\{iso\}/, "sets a machine-readable dateTime");
assert.match(src, /title=\{exact\}/, "exposes the exact timestamp on hover");
assert.match(src, /relativeTime\(iso, now, prefs\.density\)/, "uses shared relativeTime honoring density");
assert.match(src, /formatDate\(iso, prefs/, "builds the exact title from the shared absolute formatter");
assert.match(src, /useDateTimePrefs\(\)/, "subscribes to date/time prefs so changes apply live");

console.log("ui/relative-time.test.ts: ok");
