import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /service: "CovenCave"/, "readiness identifies the expected service");
assert.match(source, /version: APP_VERSION/, "readiness reports the packaged app version");
assert.match(
  source,
  /name: "coven-cave-native-readiness"[\s\S]*version: 1/,
  "readiness exposes an explicit native protocol",
);
assert.match(
  source,
  /bundle: process\.env\.COVEN_CAVE_BUNDLE === "1"/,
  "readiness distinguishes packaged and development runtimes",
);
assert.match(source, /api: "ready"/, "readiness confirms the app router completed initialization");

console.log("native-readiness route contract: ok");
