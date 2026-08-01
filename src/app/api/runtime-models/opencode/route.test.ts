// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /rejectNonLocalRequest\(req\)/, "local model inventory is never exposed to remote callers");
assert.match(
  source,
  /listRuntimeModelInventory\(\s*"opencode",\s*familiarId,\s*\{ allowOpenCodeInventory: true \},?\s*\)/,
  "the compatibility route preserves scope through the shared inventory resolver",
);
assert.match(
  source,
  /NextResponse\.json\(\{ ok: true, \.\.\.inventory \}\)/,
  "the compatibility route returns its success discriminator with the full inventory contract",
);
assert.match(source, /force-dynamic/, "model inventory is not statically cached");
console.log("opencode runtime-model route: ok");
