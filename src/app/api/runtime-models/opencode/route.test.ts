// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /import \{ GET as getRuntimeInventory \} from "\.\.\/\[runtime\]\/route"/,
  "the static route uses the shared validation and execution-scope policy");
assert.match(source, /getRuntimeInventory\(req, \{ params: Promise\.resolve\(\{ runtime: "opencode" \}\) \}\)/,
  "OpenCode preserves the caller request and fixes only the runtime parameter");
assert.match(source, /force-dynamic/, "model inventory is not statically cached");
console.log("opencode runtime-model route: ok");
