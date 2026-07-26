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
assert.match(
  source,
  /const resolvedBinary = h\.id === "grok" \? grokBin\(\) : h\.binary;[\s\S]*?h\.id === "grok" && resolvedBinary !== h\.binary[\s\S]*?: await which\(h\.binary\)/,
  "WSL must report a Windows grok.exe discovered by the native launcher even though Linux which does not use PATHEXT",
);

assert.match(
  source,
  /if \(id === "claude"\) \{[\s\S]*?evaluateCovenBackedRuntimeAvailability\(\{[\s\S]*?runner: "claude",[\s\S]*?covenCommand: launch\.command,[\s\S]*?env,[\s\S]*?unresolvedCovenWindowsShim: launch\.unresolvedWindowsShim === true/,
  "Claude runtime status must share the Coven-plus-Claude availability plan used by native chat",
);
assert.match(
  source,
  /const env = id === "opencode" \? openCodeSpawnEnv\(null\) : harnessSpawnEnv\(null\);[\s\S]*?id === "claude"[\s\S]*?env,/,
  "Claude status probes the same scoped harness environment shape as a local chat launch",
);

console.log("harness route tests passed");
