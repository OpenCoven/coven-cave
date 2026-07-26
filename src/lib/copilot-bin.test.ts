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

// A shim whose entry point cannot be proven from the reviewed `%dp0` form
// must never be handed to cmd.exe. The caller receives an explicit
// unlaunchable plan instead of a shell-based fallback.
const unsafeShim = path.join(root, "copilot-unsafe.cmd");
writeFileSync(unsafeShim, "@echo off\n%COMSPEC% /c \"copilot %*\"\n");
const unsafeWindowsShim = await resolveCopilotLaunchCommand(unsafeShim, { platform: "win32" });
assert.equal(unsafeWindowsShim.command, unsafeShim, "an unproven shim stays an inert launch target");
assert.equal(unsafeWindowsShim.unresolvedWindowsShim, true, "an unproven shim is explicitly unlaunchable");
assert.deepEqual(unsafeWindowsShim.requiredFiles, [], "an unproven shim exposes no invented entry artifact");

console.log("copilot-bin: ok");
