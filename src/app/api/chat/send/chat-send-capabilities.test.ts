// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openCodeExecutableIdentity, parseOpenCodeRunCapabilitiesHelp } from "./chat-send-capabilities.ts";

const capabilities = parseOpenCodeRunCapabilitiesHelp(`
  --structured-output <format>  Output format: text, json-v3
  --event-stream                Emit structured lifecycle events
  --no-color                    Disable terminal color
  --permission <mode>           Set tool permission policy
`, "3.0.0");

assert.deepEqual(
  capabilities.noValueOptions,
  ["--event-stream", "--no-color"],
  "only declared flags without a value placeholder can satisfy a signed no-value launch requirement",
);
assert.equal(capabilities.structuredOutputs?.[0]?.option, "--structured-output");
assert.deepEqual(capabilities.structuredOutputs?.[0]?.values, ["json-v3"]);

const valueTaking = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Output format: text, json
  --event-stream MODE           Configure lifecycle frame mode
  --no-color                    Disable terminal color
`, "3.1.0");
assert.deepEqual(
  valueTaking.noValueOptions,
  ["--no-color"],
  "an unbracketed positional token after a flag is ambiguous and cannot be launched without a value",
);

const launcherA = await mkdtemp(path.join(tmpdir(), "cave-opencode-launch-a-"));
const launcherB = await mkdtemp(path.join(tmpdir(), "cave-opencode-launch-b-"));
const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
await writeFile(path.join(launcherA, executable), "first");
await writeFile(path.join(launcherB, executable), "second");
const identityA = await openCodeExecutableIdentity({ PATH: launcherA });
const identityB = await openCodeExecutableIdentity({ PATH: launcherB });
assert.notEqual(identityA, identityB, "capability-cache identity changes when PATH resolves a different OpenCode executable");

const windowsLauncher = await mkdtemp(path.join(tmpdir(), "cave-opencode-launch-windows-"));
await writeFile(path.join(windowsLauncher, "opencode.cmd"), "shim");
await writeFile(path.join(windowsLauncher, "opencode.exe"), "binary");
const windowsIdentity = await openCodeExecutableIdentity(
  { PATH: windowsLauncher, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
  "win32",
);
assert.match(windowsIdentity, /opencode\.exe\0/i, "Windows capability identity follows PowerShell PATHEXT precedence over a co-located cmd shim");

console.log("chat-send-capabilities.test.ts: ok");
