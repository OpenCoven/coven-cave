// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /canonicalHarnessId\(rawRuntime\)/, "runtime aliases are canonicalized");
assert.match(
  source,
  /listRuntimeModelInventory\(runtime, familiarId,\s*\{[\s\S]*?allowOpenCodeInventory:/,
  "the runtime endpoint consumes the shared capability-aware inventory",
);
assert.match(source, /\.\.\.inventory/, "the endpoint returns provenance and default ownership");
assert.match(
  source,
  /runtime === "opencode"[\s\S]*?rejectNonLocalRequest\(req\)/,
  "only OpenCode's credential-scoped inventory remains local-only",
);
assert.match(source, /force-dynamic/, "runtime inventories are never statically rendered");
assert.match(source, /runtime = "nodejs"/, "runtime probes execute in Node");

console.log("dynamic runtime-model route: ok");
