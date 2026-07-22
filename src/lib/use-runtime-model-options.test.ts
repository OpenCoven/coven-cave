// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-runtime-model-options.ts", import.meta.url), "utf8");

assert.match(
  source,
  /openCodeInventory\.familiarId === inventoryFamiliarId[\s\S]*?\? openCodeInventory\.models[\s\S]*?: staticModels/,
  "OpenCode model menus must not expose a previous familiar's scoped inventory while a new scope loads",
);
assert.match(
  source,
  /const canonicalRuntime = canonicalHarnessId\(runtime\);[\s\S]*?canonicalRuntime !== "opencode"/,
  "package aliases such as opencode-ai use OpenCode's authenticated inventory",
);
assert.match(
  source,
  /setOpenCodeInventory\(\{ familiarId: inventoryFamiliarId, models: json\.models \}\)/,
  "a completed inventory request remains associated with the familiar scope that issued it",
);

console.log("use-runtime-model-options.test.ts: ok");
