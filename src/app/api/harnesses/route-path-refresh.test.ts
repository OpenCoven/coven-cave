// @ts-nocheck
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { probeCodexRuntimeAvailability } from "../../../lib/codex-runtime-availability.ts";
import { BoundedProcessOutput, terminateProcessTree } from "../../../lib/process-execution.ts";

// Exercise the real catalog handler and the real bounded adapter subprocess.
// Optional CLIs are absent and login-shell discovery is slow; discovery must
// not block delivery of the installed Codex adapter's successful response.
const scratch = mkdtempSync(path.join(tmpdir(), "cave-catalog-refresh-"));
try {
  const cli = path.join(scratch, "cli.cjs");
  writeFileSync(cli, `
const args = process.argv.slice(2);
if (args[0] === 'adapter') setTimeout(() => console.log(JSON.stringify([{id:'codex',available:true}])), 100);
else if (args[0] === 'which') {
  if (args[1] === 'codex' || args[1] === 'copilot' || (args[1] === 'late-cli' && process.env.TEST_PATH_REFRESHED === '1')) console.log('/fixture/' + args[1]);
  else process.exitCode = 1;
} else console.log('codex-cli 0.169.0');
`);
  let syncRefreshes = 0;
  let asyncRefreshes = 0;
  const initialEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEST_PATH_REFRESHED: "0" };
  const refreshedEnv = { ...initialEnv, TEST_PATH_REFRESHED: "1" };
  const require = createRequire(import.meta.url);
  const modules = {
    "next/server": { NextResponse: { json: (body) => Response.json(body) } },
    "node:child_process": { spawn: (command, args, options) =>
      command === "which" || command === "where" || command === "codex" || command === "late-cli" || command === "copilot"
        ? spawn(process.execPath, [cli, command === "where" ? "which" : command, ...args], options)
        : spawn(command, args, options) },
    "@/lib/harness-spawn-env": { warmHarnessSpawnPath: async () => {}, harnessSpawnEnv: () => initialEnv },
    "@/lib/harness-version": { pickVersionLine: (value) => value.trim() },
    "@/lib/harness-adapters": {
      COMPATIBILITY_ADAPTERS: ["codex", "missing-cli", "late-cli", "copilot", "grok"].map((id) => ({ id, binary: id, label: id })),
      covenHelpSupportsAdapterList: () => false,
      mergeAdapterReports: (reports) => reports,
    },
    "@/lib/coven-bin": {
      covenLaunchCommand: () => ({ command: process.execPath, fixedArgs: [cli] }),
      covenSpawnEnv: () => initialEnv,
      covenWrapperSpawnEnv: (env = initialEnv) => env,
      pickWindowsLauncher: (lines) => lines[0],
      refreshCovenSpawnEnv: () => {
        syncRefreshes++;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1700);
        return refreshedEnv;
      },
      refreshCovenSpawnEnvAsync: async () => {
        asyncRefreshes++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return refreshedEnv;
      },
    },
    "@/lib/copilot-stream": { copilotStreamSpec: () => null },
    "@/lib/codex-runtime-availability": { probeCodexRuntimeAvailability },
    "@/lib/grok-bin": {
      grokBin: (env) => {
        if (!env) {
          syncRefreshes++;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1700);
        }
        return "grok";
      },
      grokLaunchCommandForBinary: (command) => ({ command, fixedArgs: [] }),
    },
    "@/lib/opencode-bin": {},
    "@/lib/openclaw-bridge": { listOpenClawAgents: async () => [] },
    "@/lib/grok-build": {},
    "@/lib/server/copilot-runtime-launch": {},
    "@/lib/runtime-availability": {
      evaluateRuntimeAvailability: () => ({ state: "ready", resolvedPath: process.execPath }),
      summarizeRuntimeAvailability: (availability) => availability,
    },
    "@/lib/process-execution": { BoundedProcessOutput, terminateProcessTree },
  };
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: (id) => modules[id] ?? require(id),
    process, console, Buffer, setTimeout, clearTimeout,
  }, { filename: "harnesses/route.ts" });
  const response = await exports.GET();
  const body = await response.json();
  const codex = body.harnesses.find((h) => h.id === "codex");
  assert.equal(codex.availability.state, "ready", "missing optional runtimes must not starve Codex's successful adapter probe");
  assert.equal(codex.installed, true);
  assert.equal(syncRefreshes, 0, "catalog discovery never blocks the event loop refreshing PATH");
  assert.equal(asyncRefreshes, 1, "all misses share one asynchronous refresh per catalog request");
  assert.equal(body.harnesses.find((h) => h.id === "late-cli").installed, true, "a CLI installed after the cached PATH is recovered");
  assert.equal(body.harnesses.find((h) => h.id === "missing-cli").installed, false);
  assert.equal(body.harnesses.find((h) => h.id === "copilot").installed, true, "Copilot remains discoverable when its direct stream manifest is absent");
  console.log("catalog asynchronous PATH refresh behavior passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
