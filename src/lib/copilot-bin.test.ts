import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCopilotLaunchCommand } from "./copilot-bin.ts";

const root = mkdtempSync(path.join(tmpdir(), "coven-copilot-bin-"));
const entry = path.join(root, "node_modules", "@github", "copilot", "index.js");
const shim = path.join(root, "copilot.cmd");
mkdirSync(path.dirname(entry), { recursive: true });
writeFileSync(entry, "console.log('fixture')", { flag: "w" });
writeFileSync(shim, `@echo off\n"%~dp0\\node_modules\\@github\\copilot\\index.js" %*\n`);

const windowsShim = await resolveCopilotLaunchCommand(shim, { platform: "win32" });
assert.equal(windowsShim.command, process.execPath, "a Windows npm shim runs through Node, never cmd.exe");
assert.deepEqual(windowsShim.fixedArgs, [entry], "the npm shim entry point is kept separate from untrusted argv");
assert.deepEqual(
  windowsShim.requiredFiles,
  [entry],
  "the converted argv-list launch records its required entry artifact for preflight",
);

console.log("copilot-bin: ok");
