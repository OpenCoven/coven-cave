// @ts-nocheck
import assert from "node:assert/strict";
import {
  openCodeCapabilityProbeCacheable,
  openCodeCapabilityProbeScope,
  openCodeCapabilityProbeTimeoutMs,
  openCodeProbeCleanupGraceMs,
  openCodeProbeSpawnOptions,
  openCodeProbeTreeKillCommand,
  openCodeRunCapabilities,
  parseOpenCodeRunCapabilitiesHelp,
} from "./chat-send-capabilities.ts";

assert.equal(openCodeCapabilityProbeTimeoutMs("linux"), 2_500, "non-Windows capability probes retain the short bounded deadline");
assert.equal(openCodeCapabilityProbeTimeoutMs("win32"), 6_000, "Windows PowerShell/npm launchers receive a bounded cold-start allowance");
assert.equal(openCodeProbeCleanupGraceMs(), 1_000, "timed-out probe cleanup has a short final deadline so chat can fall back");
assert.equal(openCodeCapabilityProbeCacheable("linux"), false, "POSIX clients are reprobed rather than reusing a same-version help contract");
assert.equal(openCodeCapabilityProbeCacheable("win32"), false, "Windows launcher shims are reprobed rather than reusing stale downstream capability evidence");
assert.notEqual(
  openCodeCapabilityProbeScope("opal"),
  openCodeCapabilityProbeScope("moss"),
  "capability evidence from one familiar's scoped environment cannot be reused for another familiar",
);
assert.equal(openCodeCapabilityProbeScope(), "default", "the unscoped probe cache has a stable explicit scope");
assert.deepEqual(openCodeProbeSpawnOptions("linux"), { detached: true }, "POSIX OpenCode probes create an isolated process group that timeout cleanup can terminate");
assert.deepEqual(openCodeProbeSpawnOptions("win32"), { detached: false }, "Windows probes rely on taskkill's explicit process-tree cleanup rather than a detached process group");
const firstCapabilities = await openCodeRunCapabilities("probe-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text, json\n" },
  versionProbe: { complete: true, output: "opencode 1.0.0" },
}));
const replacementCapabilities = await openCodeRunCapabilities("probe-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text\n" },
  versionProbe: { complete: true, output: "opencode 1.0.0" },
}));
assert.equal(firstCapabilities.json, true);
assert.equal(replacementCapabilities.json, false, "an in-place same-version CLI replacement is reprobed before Cave chooses JSON argv");
assert.deepEqual(
  openCodeProbeTreeKillCommand(4242, "win32"),
  { command: "taskkill.exe", args: ["/PID", "4242", "/T", "/F"] },
  "timed-out Windows probes terminate their launcher tree rather than only PowerShell",
);
assert.equal(openCodeProbeTreeKillCommand(4242, "linux"), null, "non-Windows probes retain process-local termination");

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

const currentYargsHelp = parseOpenCodeRunCapabilitiesHelp(`
  --format                       Select output format [string] [choices: "default", "json"]
  -s, --session                  Resume a named session [string]
  -m, --model                    Select a model [string]
  --event-stream                 Configure event framing
                                  [string]
`, "1.18.5");
assert.equal(currentYargsHelp.json, true, "current yargs choices confirm JSON output without treating prose as syntax");
assert.equal(currentYargsHelp.session, true, "current yargs inline string metadata confirms native session support");
assert.equal(currentYargsHelp.model, true, "current yargs inline string metadata confirms model forwarding support");
assert.deepEqual(currentYargsHelp.valueOptions, ["--format", "--session", "--model", "--event-stream"], "inline and wrapped yargs type annotations confirm value-taking options");
assert.deepEqual(currentYargsHelp.noValueOptions, [], "inline or wrapped yargs value annotations never become evidence for a valueless launch flag");
assert.equal(currentYargsHelp.endOfOptions, false, "a conventional delimiter is not assumed when current help does not document it");

const documentedDelimiter = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Output format: text, json
  --                            End of options
`, "future");
assert.equal(documentedDelimiter.endOfOptions, true, "only a dedicated documented delimiter row permits the route to insert --");

const toolEventsOutput = parseOpenCodeRunCapabilitiesHelp(`
  --format <format>             Output format: text, json
  --include-tool-events         Include tool lifecycle frames in JSON output
  --tool-events                 Emit tool lifecycle frames in JSON output
`, "3.1.1");
assert.deepEqual(
  toolEventsOutput.noValueOptions,
  ["--include-tool-events", "--tool-events"],
  "declared output-only tool-event switches can be independently confirmed before a signed schema forwards them",
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

assert.equal(openCodeCapabilityProbeCacheable("win32"), false, "Windows re-probes every turn because a shim target can change in place");
assert.equal(openCodeCapabilityProbeCacheable("linux"), false, "POSIX re-probes every turn because a same-version shim can change its help contract");

console.log("chat-send-capabilities.test.ts: ok");
