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
assert.match(
  source,
  /const localInventoryRequest = rejectNonLocalRequest\(req\) === null[\s\S]*?runtime === "hermes" && localInventoryRequest && familiarId[\s\S]*?bindingFor\(await loadConfig\(\), familiarId\)[\s\S]*?!binding\.hermesProfile[\s\S]*?!binding\.hasInvalidHermesProfileBinding[\s\S]*?!isSshRuntime\(binding\.runtime\)[\s\S]*?allowHermesInventory,/,
  "Hermes provider discovery is enabled only for a local request with a validated bare-local familiar binding",
);
assert.match(source, /\.\.\.inventory/, "the endpoint returns provenance and default ownership");
assert.match(
  source,
  /allowOpenCodeInventory: runtime === "opencode" && localInventoryRequest/,
  "OpenCode credential discovery remains local-only while remote callers receive safe metadata",
);
assert.doesNotMatch(
  source,
  /if \(forbidden\) return forbidden/,
  "remote inventory callers degrade safely instead of losing the endpoint contract",
);
assert.match(source, /force-dynamic/, "runtime inventories are never statically rendered");
assert.match(source, /runtime = "nodejs"/, "runtime probes execute in Node");

console.log("dynamic runtime-model route: ok");
