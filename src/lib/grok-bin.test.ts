// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./grok-bin.ts", import.meta.url), "utf8");

assert.match(source, /GROK_BIN/, "Grok Build discovery should allow an explicit override");
assert.match(
  source,
  /"grok\.exe", "grok\.cmd", "grok\.bat", "grok"/,
  "Windows discovery must support both the native Grok executable and npm command shims",
);

assert.match(
  source,
  /export function grokCandidateBinNames[\s\S]*platform === "win32"[\s\S]*\["grok\.exe", "grok\.cmd", "grok\.bat", "grok"\][\s\S]*microsoft\|wsl[\s\S]*\["grok", "grok\.exe"\]/,
  "WSL finds a Windows native Grok executable while Windows also supports npm command shims",
);
assert.match(
  source,
  /covenSpawnEnv\(\)[\s\S]*split\(path\.delimiter\)/,
  "Grok discovery must use Cave's cross-platform augmented PATH",
);
assert.match(
  source,
  /path\.join\(\/\* turbopackIgnore: true \*\/ directory, name\)/,
  "dynamic PATH probes must not make Turbopack trace the whole project into the sidecar",
);
assert.match(
  source,
  /covenLaunchCommandForBinary\(binary\)/,
  "Windows npm shims must be converted to a direct Node launch, not spawned as .cmd files",
);

console.log("grok-bin tests passed");
