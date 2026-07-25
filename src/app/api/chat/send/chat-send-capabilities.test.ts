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
const proseOperand = parseOpenCodeRunCapabilitiesHelp(`
  --format  Prints <json> output when enabled
`, "3.1.0");
assert.equal(proseOperand.json, false, "an operand-looking token in an option description never confirms a value-taking format flag");
assert.deepEqual(proseOperand.valueOptions, [], "only the option syntax column can prove that OpenCode accepts an argv value");

const toolEventsOutput = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Output format: text, json
  --include-tool-events         Include tool lifecycle frames in JSON output
`, "3.1.1");
assert.deepEqual(
  toolEventsOutput.noValueOptions,
  ["--include-tool-events"],
  "a declared output-only tool-event switch can be independently confirmed before a signed schema forwards it",
);

const booleanJson = parseOpenCodeRunCapabilitiesHelp(`
  --json                         Emit JSON events
  --event-json-v2                Emit JSON v2 events
  --format <format>              Output format: text
`, "3.2.0");
assert.deepEqual(
  booleanJson.structuredOutputs,
  [],
  "a boolean JSON switch is never mis-recorded as an option that accepts the literal json value",
);
assert.deepEqual(
  booleanJson.structuredSwitches,
  [
    { option: "--json", protocols: ["json"] },
    { option: "--event-json-v2", protocols: ["json-v2"] },
  ],
  "explicit valueless JSON switches retain their independently probed launch contract",
);
assert.deepEqual(booleanJson.protocols, ["json", "json-v2"]);

const proseOnlyJson = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Select an output format; use --json for JSON output
  --json                         Emit JSON events
`, "3.3.0");
assert.deepEqual(
  proseOnlyJson.structuredOutputs,
  [],
  "a JSON mention in a value-taking option's prose is not treated as an accepted format value",
);
assert.deepEqual(proseOnlyJson.protocols, ["json"], "only the independently declared boolean JSON switch contributes a protocol");

const malformedEnumStartedAt = Date.now();
parseOpenCodeRunCapabilitiesHelp(`--format <${"item,".repeat(12_000)}`, "3.3.1");
assert.ok(Date.now() - malformedEnumStartedAt < 1_000, "malformed format enums are scanned in bounded linear time");

const resumeCapabilities = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Output format: text, json
  --resume                        Resume the most recent session
  --session <id>                 Resume a named session
`, "3.4.0");
assert.equal(resumeCapabilities.session, true);
assert.deepEqual(resumeCapabilities.valueOptions, ["--format", "--session"], "only session options with an explicit argument can receive Cave's native session id");

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
