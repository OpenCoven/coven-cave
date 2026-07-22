import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /spawn\(launch\.command, \[\.\.\.launch\.fixedArgs, "--no-auto-update", "models"\]/,
  "the harness catalog probe must not trigger Grok's automatic updater on routine UI refreshes",
);

assert.match(
  source,
  /pickWindowsLauncher\(found\.split\(\/\\r\?\\n\/\)\)/,
  "Windows discovery must choose one spawnable launcher from multi-line where output",
);

assert.match(
  source,
  /grokLaunchCommandForBinary\(path\)/,
  "Grok probes must run npm .cmd shims through their spawn-safe launch command",
);

console.log("harness route tests passed");
