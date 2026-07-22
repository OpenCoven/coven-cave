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
  /export function grokCandidateBinNames[\s\S]*platform === "win32"[\s\S]*\["grok\.exe", "grok\.cmd", "grok\.bat", "grok"\][\s\S]*microsoft\|wsl[\s\S]*\["grok", "grok\.exe", "grok\.cmd", "grok\.bat"\]/,
  "WSL finds native Windows executables and npm command shims while Windows supports the same shims",
);
assert.match(
  source,
  /function candidateDirs\(env: NodeJS\.ProcessEnv\)[\s\S]*split\(path\.delimiter\)/,
  "Grok discovery must use Cave's cross-platform augmented PATH",
);
assert.match(
  source,
  /grokBinFromPath\(covenSpawnEnv\(\)\) \?\? grokBinFromPath\(refreshCovenSpawnEnv\(\)\)/,
  "Grok discovery must refresh a stale desktop PATH before reporting a newly installed WSL, npm, or native launcher as absent",
);
assert.match(
  source,
  /path\.join\(\/\* turbopackIgnore: true \*\/ directory, name\)/,
  "dynamic PATH probes must not make Turbopack trace the whole project into the sidecar",
);
assert.match(
  source,
  /const shimPlatform = \/\\\.\(cmd\|bat\)\$\/i\.test\(binary\) \? "win32" : process\.platform;[\s\S]*covenLaunchCommandForBinary\(binary, shimPlatform\)/,
  "Windows npm shims discovered from either Windows or WSL must be converted to a direct Node launch, not spawned as .cmd files",
);

console.log("grok-bin tests passed");
