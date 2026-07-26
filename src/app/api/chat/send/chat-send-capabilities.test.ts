// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openCodeCapabilityLaunchIdentity,
  openCodeCapabilityProbeCacheable,
  openCodeCapabilityProbeScope,
  openCodeCapabilityProbeTimeoutMs,
  openCodeVerifiedCapabilityFallbackTtlMs,
  openCodeVerifiedCapabilityFallbackLimit,
  openCodeProbeCleanupGraceMs,
  openCodeProbeSpawnOptions,
  openCodeProbeTreeKillCommand,
  openCodeRunCapabilities,
  hermesChatSupportsModel,
  hermesHelpSupportsModel,
  parseOpenCodeRunCapabilitiesHelp,
} from "./chat-send-capabilities.ts";

assert.equal(hermesHelpSupportsModel("  --query <prompt>\n"), false, "a launchable Hermes without --model remains a capability-only limitation");
assert.equal(hermesHelpSupportsModel("  --model <id>\n"), true, "Hermes model forwarding requires the documented flag");

// A broken `chat --help` invocation can still print a usage block containing
// --model. It is not capability evidence: the direct launch remains usable,
// but Cave must omit the optional flag rather than repeating the failure.
{
  const probeDir = await mkdtemp(path.join(tmpdir(), "cave-hermes-help-failure-"));
  const previousCwd = process.cwd();
  try {
    await writeFile(
      path.join(probeDir, "chat"),
      'process.stdout.write("  --model <id>\\n"); process.exit(1);\\n',
    );
    process.chdir(probeDir);
    assert.equal(
      await hermesChatSupportsModel({ command: process.execPath, env: process.env, cwd: probeDir }),
      false,
      "a failed Hermes help probe does not forward --model from its error usage",
    );
  } finally {
    process.chdir(previousCwd);
    await rm(probeDir, { recursive: true, force: true });
  }
}

assert.equal(openCodeCapabilityProbeTimeoutMs("linux"), 2_500, "non-Windows capability probes retain the short bounded deadline");
assert.equal(openCodeCapabilityProbeTimeoutMs("win32"), 6_000, "Windows PowerShell/npm launchers receive a bounded cold-start allowance");
assert.equal(openCodeProbeCleanupGraceMs(), 1_000, "timed-out probe cleanup has a short final deadline so chat can fall back");
assert.equal(openCodeVerifiedCapabilityFallbackTtlMs(), 60_000, "only a short-lived verified OpenCode contract can survive a transient probe failure");
assert.equal(openCodeVerifiedCapabilityFallbackLimit(), 64, "verified capability evidence remains bounded across scoped launches");
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
}), () => "probe-fixture-launcher");
const replacementCapabilities = await openCodeRunCapabilities("probe-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text\n" },
  versionProbe: { complete: true, output: "opencode 1.0.0" },
}), () => "probe-fixture-launcher");
assert.equal(firstCapabilities.json, true);
assert.equal(replacementCapabilities.json, false, "an in-place same-version CLI replacement is reprobed before Cave chooses JSON argv");

let fallbackClock = 1_000;
const fallbackIdentity = () => "C:\\npm\\opencode.cmd\0 42\0 100";
const fallbackSeed = await openCodeRunCapabilities("fallback-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text, json\n" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), fallbackIdentity, () => fallbackClock);
assert.equal(fallbackSeed.probeStatus, "verified");
const transientFallback = await openCodeRunCapabilities("fallback-fixture", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), fallbackIdentity, () => fallbackClock);
assert.equal(transientFallback.probeStatus, "fallback", "a failed help probe can use only a recent complete contract for the same launcher");
assert.equal(transientFallback.json, true, "the verified JSON contract survives a transient probe failure without guessing new argv");
const changedIdentity = await openCodeRunCapabilities("fallback-fixture", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), () => "C:\\npm\\opencode.cmd\0 43\0 101", () => fallbackClock);
assert.equal(changedIdentity.probeStatus, "unavailable", "a changed launcher file never inherits a prior capability contract");
fallbackClock += openCodeVerifiedCapabilityFallbackTtlMs();
const expiredFallback = await openCodeRunCapabilities("fallback-fixture", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), fallbackIdentity, () => fallbackClock);
assert.equal(expiredFallback.probeStatus, "unavailable", "expired verified evidence cannot mask a later failed probe");
const noJsonHelp = await openCodeRunCapabilities("no-json-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text\n" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), fallbackIdentity, () => fallbackClock);
assert.equal(noJsonHelp.probeStatus, "verified");
assert.equal(noJsonHelp.json, false, "a complete help response without JSON remains a confirmed plain-mode capability");
const versionlessIdentity = () => "versionless-launcher";
await openCodeRunCapabilities("versionless-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text, json\n" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), versionlessIdentity, () => fallbackClock);
await openCodeRunCapabilities("versionless-fixture", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text\n" },
  versionProbe: { complete: false, output: "" },
}), versionlessIdentity, () => fallbackClock);
const versionlessFallback = await openCodeRunCapabilities("versionless-fixture", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), versionlessIdentity, () => fallbackClock);
assert.equal(versionlessFallback.probeStatus, "unavailable", "a complete capability response without a version invalidates every older launcher contract");
const raceIdentities = ["launcher-before", "launcher-after"];
const racedProbe = await openCodeRunCapabilities("probe-race", async () => ({
  helpProbe: { complete: true, output: "  --format <format>  Output format: text, json\n" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), () => raceIdentities.shift() ?? "launcher-after", () => fallbackClock);
assert.equal(racedProbe.probeStatus, "verified", "a complete probe remains usable for its current turn even when the launcher changes during probing");
const racedFallback = await openCodeRunCapabilities("probe-race", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), () => "launcher-after", () => fallbackClock);
assert.equal(racedFallback.probeStatus, "unavailable", "a launcher changed during a complete probe cannot seed later fallback evidence");

if (process.platform === "win32") {
  const identityRoot = mkdtempSync(path.join(tmpdir(), "cave-opencode-identity-"));
  try {
    const localBin = path.join(identityRoot, "node_modules", ".bin");
    const packageBin = path.join(identityRoot, "node_modules", "opencode-ai", "bin");
    mkdirSync(localBin, { recursive: true });
    mkdirSync(packageBin, { recursive: true });
    writeFileSync(path.join(localBin, "opencode.cmd"), "@echo off\r\n");
    writeFileSync(path.join(localBin, "opencode.exe"), "direct-executable");
    const packageExecutable = path.join(packageBin, "opencode.exe");
    writeFileSync(packageExecutable, "package-target-one");
    const cmdIdentity = await openCodeCapabilityLaunchIdentity({ PATH: localBin, PATHEXT: ".CMD;.EXE" }, "win32");
    const exeIdentity = await openCodeCapabilityLaunchIdentity({ PATH: localBin, PATHEXT: ".EXE;.CMD" }, "win32");
    assert.notEqual(cmdIdentity, exeIdentity, "PATHEXT order selects and fingerprints only the actual Windows launcher");
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(packageExecutable, timestamp, timestamp);
    writeFileSync(packageExecutable, "package-target-two");
    utimesSync(packageExecutable, timestamp, timestamp);
    const replacementIdentity = await openCodeCapabilityLaunchIdentity({ PATH: localBin, PATHEXT: ".CMD;.EXE" }, "win32");
    assert.notEqual(cmdIdentity, replacementIdentity, "a same-size package replacement with a restored timestamp changes the content fingerprint");
  } finally {
    rmSync(identityRoot, { recursive: true, force: true });
  }
}

const boundedClock = 10_000;
for (let index = 0; index <= openCodeVerifiedCapabilityFallbackLimit(); index += 1) {
  const identity = () => `bounded-launcher-${index}`;
  await openCodeRunCapabilities(`bounded-${index}`, async () => ({
    helpProbe: { complete: true, output: "  --format <format>  Output format: text, json\n" },
    versionProbe: { complete: true, output: "opencode 1.18.5" },
  }), identity, () => boundedClock);
}
const evictedFallback = await openCodeRunCapabilities("bounded-0", async () => ({
  helpProbe: { complete: false, output: "" },
  versionProbe: { complete: true, output: "opencode 1.18.5" },
}), () => "bounded-launcher-0", () => boundedClock);
assert.equal(evictedFallback.probeStatus, "unavailable", "bounded evidence evicts the oldest verified contract rather than retaining it indefinitely");
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
