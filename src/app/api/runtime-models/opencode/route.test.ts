// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /rejectNonLocalRequest\(req\)/, "local model inventory is never exposed to remote callers");
assert.match(source, /listOpenCodeModels\(\)/, "route reads the local authenticated OpenCode inventory");
assert.match(source, /force-dynamic/, "model inventory is not statically cached");
console.log("opencode runtime-model route: ok");
