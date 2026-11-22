// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("./grok-bin.ts", import.meta.url), "utf8");

assert.match(source, /GROK_BIN/, "Grok Build discovery should allow an explicit override");
assert.match(
  source,
  /"grok\.exe", "grok\.cmd", "grok\.bat", "grok"/,
  "Windows discovery must support both the native Grok executable and npm command shims",
);

assert.match(
  source,
  /export function grokCandidateBinNames[\s\S]*platform === "win32"[\s\S]*\["grok\.exe", "grok\.cmd", "grok\.bat", "grok"\][\s\S]*microsoft\|wsl[\s\S]*\["grok\.exe", "grok\.cmd", "grok\.bat", "grok"\]/,
  "WSL must prefer native Windows executables and npm command shims over their incompatible POSIX wrappers",
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
  /const windowsShim = \/\\\.\(cmd\|bat\)\$\/i\.test\(binary\);[\s\S]*covenLaunchCommandForBinary\(binary, shimPlatform\)[\s\S]*process\.platform !== "win32"[\s\S]*microsoft\|wsl[\s\S]*command: "node\.exe"/,
  "WSL must run Windows npm Grok shims with Windows Node so their Windows optional package is selected without spawning cmd.exe",
);

console.log("grok-bin tests passed");


// A catalog already refreshed PATH asynchronously. Resolving an optional Grok
// launcher inside that catalog must not run another global discovery.
const scratch = mkdtempSync(path.join(tmpdir(), "cave-grok-supplied-env-"));
try {
  const require = createRequire(import.meta.url);
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const forbidden = () => { throw new Error("supplied environment must not rediscover global PATH"); };
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => id === "./coven-bin" ? { covenSpawnEnv: forbidden, refreshCovenSpawnEnv: forbidden }
      : id === "node:child_process" ? { execFileSync: forbidden } : require(id),
    process: { platform: process.platform, env: {} },
  });
  assert.equal(exports.grokBin({ PATH: scratch }), "grok", "an absent optional CLI stays absent without blocking discovery");
  const name = process.platform === "win32" ? "grok.exe" : "grok";
  const binary = path.join(scratch, name);
  writeFileSync(binary, "fixture", { mode: 0o755 });
  assert.equal(exports.grokBin({ PATH: scratch }), binary, "the exact supplied PATH is used when a CLI becomes available");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
