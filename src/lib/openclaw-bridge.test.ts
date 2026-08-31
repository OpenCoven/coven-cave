// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  openClawDiscoveryFromHello,
  parseOpenClawToolEvent,
  selectOpenClawToolProfile,
  validateOpenClawToolProfiles,
} from "./openclaw-compatibility.ts";
import {
  OpenClawAgentResolutionError,
  OpenClawBridgeNegotiationLedger,
  createOpenClawBridgeToolProjector,
  extractOpenClawSessionId,
  extractOpenClawText,
  hasValidOpenClawPayloadEnvelope,
  isOpenClawGatewayCredentialFailure,
  negotiateOpenClawBridgeSession,
  openClawBridgeCapabilities,
  openClawBridgeCapabilitiesFromNegotiation,
  openClawBridgeNegotiationDiagnostic,
  openClawAgentArgs,
  openClawCliExecutionMode,
  openClawSessionKey,
  parseOpenClawBridgeDiscovery,
  parseOpenClawAgentList,
  readTomlString,
  resolveOpenClawAgentBindingFromSources,
  resolveOpenClawAgentId,
  resolveOpenClawAgentIdFromSources,
  slugifyOpenClawAgentName,
  validateOpenClawBridgeSchemaHash,
} from "./openclaw-bridge.ts";

assert.equal(readTomlString('id = "nova"', "id"), "nova");
assert.equal(readTomlString("openclaw_agent = cody-main # comment", "openclaw_agent"), "cody-main");
assert.equal(readTomlString("role = ''", "role"), "");
assert.equal(readTomlString("id = \"nova\"", "openclaw_agent"), null);

assert.equal(slugifyOpenClawAgentName("Cody Main"), "cody-main");
assert.equal(slugifyOpenClawAgentName("  Nova / Release Review  "), "nova-release-review");
assert.deepEqual(
  parseOpenClawAgentList([
    {
      id: " main ",
      name: null,
      identityName: null,
      isDefault: true,
      workspace: "C:\\Users\\example\\.openclaw\\workspace",
      futureField: "ignored",
    },
  ]),
  [
    {
      id: "main",
      isDefault: true,
      workspace: "C:\\Users\\example\\.openclaw\\workspace",
    },
  ],
  "the live registry parser should normalize the stable agent contract",
);
assert.deepEqual(
  parseOpenClawAgentList([{ id: "main" }, { id: "main" }]),
  [],
  "duplicate live agent ids should fail closed",
);
assert.deepEqual(
  parseOpenClawAgentList([{ id: "main", isDefault: "yes" }]),
  [],
  "malformed live registry fields should fail closed",
);

const candidateAgents = [
  { id: "fallback-match", name: "Nova", identityName: "Nova Identity" },
  { id: "nova", name: "Wrong Exact Name" },
  { id: "cody-main", name: "Cody Main" },
  { id: "identity-hit", identityName: "Release Review" },
];

assert.deepEqual(openClawBridgeCapabilities(), {
  streaming: true,
  toolEvents: true,
  stableSessionKey: true,
  localFileAttachments: false,
  sshRuntime: false,
  modelOverride: false,
  nativeMemory: true,
  nativeSkills: true,
  nativeMessaging: true,
});
const bridgeSource = await readFile(new URL("./openclaw-bridge.ts", import.meta.url), "utf8");
assert.match(
  bridgeSource,
  /Bridge implementation support\. Runtime activation remains compatibility-negotiated\./,
  "capabilities describe implemented negotiation support rather than promising every runtime qualifies",
);

assert.equal(
  extractOpenClawText({ result: { payloads: [{ content: "scalar reply" }] } }),
  "scalar reply",
  "OpenClaw scalar payload content should not be discarded",
);
assert.equal(
  extractOpenClawText({
    result: { payloads: [{ content: { text: "object reply" } }] },
  }),
  "object reply",
  "OpenClaw object payload content with a text field should not be discarded",
);

assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("nova", "explicit-nova", candidateAgents),
  {
    caveFamiliarId: "nova",
    openclawAgentId: "explicit-nova",
    source: "explicit",
  },
  "explicit openclaw_agent binding should return typed binding metadata",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("nova", null, candidateAgents),
  {
    caveFamiliarId: "nova",
    openclawAgentId: "nova",
    source: "id-match",
  },
  "exact agent id should report id-match source metadata",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("release-review", null, candidateAgents),
  {
    caveFamiliarId: "release-review",
    openclawAgentId: "identity-hit",
    source: "name-match",
  },
  "slugified display or identity-name matches should report name-match source metadata",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("wren", null, [
    { id: "main", isDefault: true },
  ]),
  {
    caveFamiliarId: "wren",
    openclawAgentId: "main",
    source: "default",
  },
  "a unique OpenClaw default should bind a differently named Cave familiar",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("wren", null, [
    { id: "main", isDefault: true },
    { id: "research", isDefault: false },
  ]),
  {
    caveFamiliarId: "wren",
    openclawAgentId: "main",
    source: "default",
  },
  "one declared default should remain deterministic when other agents exist",
);
assert.throws(
  () => resolveOpenClawAgentBindingFromSources("unknown", null, candidateAgents),
  (error) =>
    error instanceof OpenClawAgentResolutionError &&
    error.code === "OPENCLAW_AGENT_NOT_FOUND" &&
    /No OpenClaw agent is bound to Cave familiar "unknown"/.test(error.message),
  "missing OpenClaw agent resolution should fail clearly by default",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("unknown", null, candidateAgents, {
    allowFallback: true,
  }),
  {
    caveFamiliarId: "unknown",
    openclawAgentId: "unknown",
    source: "fallback",
  },
  "fallback-to-familiar-id should be explicit and source-tagged",
);
assert.throws(
  () =>
    resolveOpenClawAgentBindingFromSources("unknown", null, [
      { id: "main", isDefault: true },
      { id: "other", isDefault: true },
    ]),
  (error) => error instanceof OpenClawAgentResolutionError,
  "ambiguous default declarations should still fail closed",
);

assert.equal(
  resolveOpenClawAgentIdFromSources("nova", "explicit-nova", candidateAgents),
  "explicit-nova",
  "explicit openclaw_agent binding should win over every discovered agent",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("nova", null, candidateAgents),
  "nova",
  "exact agent id should win over slugified display or identity name",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("cody-main", null, candidateAgents),
  "cody-main",
  "slugified agent display name should resolve when no exact id exists",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("release-review", null, candidateAgents),
  "identity-hit",
  "slugified identity name should resolve when no exact id or display name exists",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("unknown", null, candidateAgents, {
    allowFallback: true,
  }),
  "unknown",
  "legacy id-only helper can still opt into fallback-to-familiar-id",
);

const previousCovenHome = process.env.COVEN_HOME;
const tempCovenHome = await mkdtemp(path.join(tmpdir(), "openclaw-bridge-"));
try {
  await mkdir(tempCovenHome, { recursive: true });
  await writeFile(
    path.join(tempCovenHome, "familiars.toml"),
    [
      "[[familiar]]",
      'id = "nova"',
      'openclaw_agent = "nova-explicit"',
    ].join("\n"),
    "utf8",
  );
  process.env.COVEN_HOME = tempCovenHome;
  assert.equal(
    await resolveOpenClawAgentId("nova"),
    "nova-explicit",
    "explicit openclaw_agent binding should return before listing OpenClaw agents",
  );
} finally {
  if (previousCovenHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousCovenHome;
  await rm(tempCovenHome, { recursive: true, force: true });
}

assert.equal(openClawSessionKey("ABC_123:Weird"), "cave-abc-123-weird");
assert.equal(
  extractOpenClawText({ result: { payloads: [{ content: "scalar reply" }] } }),
  "scalar reply",
  "OpenClaw scalar payload content should not be discarded",
);
assert.equal(
  extractOpenClawText({
    result: { payloads: [{ content: { text: "object reply" } }] },
  }),
  "object reply",
  "OpenClaw object payload content with a text field should not be discarded",
);
assert.deepEqual(openClawAgentArgs("hi", "nova", "ABC_123"), [
  "agent",
  "--agent",
  "nova",
  "--message",
  "hi",
  "--json",
  "--session-id",
  "cave-abc-123",
]);
assert.equal(
  openClawAgentArgs("hi", "nova", "ABC_123").includes("--session-id"),
  true,
  "OpenClaw bridge must pass the stable Cave-owned id through --session-id",
);
assert.equal(
  openClawAgentArgs("hi", "nova", "ABC_123").includes("--local"),
  false,
  "OpenClaw bridge must preserve the configured CLI Gateway route by default",
);
assert.equal(
  openClawAgentArgs("hi", "nova", "ABC_123", "local").includes("--local"),
  true,
  "OpenClaw bridge adds --local only for an explicit embedded attempt",
);
assert.equal(openClawCliExecutionMode({}), "gateway");
assert.equal(openClawCliExecutionMode({ OPENCLAW_EMBEDDED_LOCAL: "true" }), "local");
assert.equal(
  isOpenClawGatewayCredentialFailure("GatewayCredentialsRequiredError: gateway agent requires credentials before opening a websocket"),
  true,
  "only the CLI's credential-gate signature can trigger a local recovery",
);
assert.equal(
  isOpenClawGatewayCredentialFailure("connection timed out"),
  false,
  "an ambiguous Gateway failure must not bypass a configured remote session",
);

assert.equal(
  extractOpenClawText({
    result: {
      payloads: [
        { text: "first" },
        { content: [{ type: "text", text: "second" }] },
      ],
    },
  }),
  "first\n\nsecond",
);
assert.equal(extractOpenClawText({ summary: "fallback summary" }), "fallback summary");
assert.equal(
  extractOpenClawText({ payloads: [{ text: "current local response" }] }),
  "current local response",
  "OpenClaw's current embedded --json result should be read from top-level payloads",
);
assert.equal(hasValidOpenClawPayloadEnvelope({ payloads: [{ text: "valid" }] }), true);
assert.equal(hasValidOpenClawPayloadEnvelope({ payloads: {} as any }), false);
assert.equal(hasValidOpenClawPayloadEnvelope({ payloads: [null] as any }), false);
assert.equal(hasValidOpenClawPayloadEnvelope({ result: { payloads: {} as any } }), false);
assert.equal(hasValidOpenClawPayloadEnvelope(null as any), false);
assert.equal(hasValidOpenClawPayloadEnvelope({ result: [] as any }), false);

assert.equal(extractOpenClawSessionId({ sessionId: "top" }), "top");
assert.equal(extractOpenClawSessionId({ result: { sessionId: "result" } }), "result");
assert.equal(
  extractOpenClawSessionId({ result: { meta: { agentMeta: { sessionId: "result-meta" } } } }),
  "result-meta",
);
assert.equal(
  extractOpenClawSessionId({ meta: { agentMeta: { sessionId: "meta" } } }),
  "meta",
);
assert.equal(extractOpenClawSessionId({}, "fallback"), "fallback");

// ── Versioned gateway/bridge negotiation conformance (issue #4892) ──────────
// Fixture-driven only: OpenClaw is not installed on this host and no test
// performs a live OpenClaw call or any stdout parsing.

const gatewayBeta4Hello = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta4.json", import.meta.url), "utf8"),
);
const gatewayBeta5Hello = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const toolLifecycleV1 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/tool-lifecycle-v1.json", import.meta.url), "utf8"),
);
const negotiationVersionFixtures = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/bridge-negotiation-versions.json", import.meta.url), "utf8"),
);
const unknownEventFixtures = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/bridge-negotiation-unknown-events.json", import.meta.url), "utf8"),
);

const beta4Discovery = openClawDiscoveryFromHello(gatewayBeta4Hello);
const beta5Discovery = openClawDiscoveryFromHello(gatewayBeta5Hello);
const beta5Profile = selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, beta5Discovery);
assert.ok(beta5Profile, "the pinned beta5 fixture selects the built-in profile");

// Discovery validation hook: only the exact Cave-owned discovery shape passes.
assert.deepStrictEqual(
  parseOpenClawBridgeDiscovery(beta5Discovery),
  beta5Discovery,
  "a HelloOk-derived discovery round-trips the bridge discovery validation hook",
);
assert.equal(parseOpenClawBridgeDiscovery(null), null, "a missing discovery fails closed");
assert.equal(parseOpenClawBridgeDiscovery({}), null, "an empty discovery fails closed");
assert.equal(
  parseOpenClawBridgeDiscovery({ ...beta5Discovery, agentEventSchemaHash: "not-a-hash" }),
  null,
  "a discovery whose schema hash is not a lowercase sha-256 digest fails closed",
);
assert.equal(
  parseOpenClawBridgeDiscovery({ ...beta5Discovery, futureField: true }),
  null,
  "unknown discovery fields fail closed",
);
assert.equal(
  parseOpenClawBridgeDiscovery({
    ...beta5Discovery,
    methods: [...beta5Discovery.methods, beta5Discovery.methods[0]],
  }),
  null,
  "duplicate discovery entries fail closed",
);
assert.equal(
  parseOpenClawBridgeDiscovery({ ...beta5Discovery, protocol: 0 }),
  null,
  "a non-positive wire protocol fails closed",
);

// Schema-hash validation hook: a hash is only trusted when a validated
// profile declares exactly it.
assert.equal(
  validateOpenClawBridgeSchemaHash(beta5Discovery.agentEventSchemaHash),
  beta5Discovery.agentEventSchemaHash,
  "the pinned built-in schema hash validates against the built-in profile",
);
assert.equal(
  validateOpenClawBridgeSchemaHash(beta5Discovery.agentEventSchemaHash, [beta5Profile]),
  beta5Discovery.agentEventSchemaHash,
  "an explicitly provided validated profile list validates its own declared hash",
);
assert.equal(validateOpenClawBridgeSchemaHash("f".repeat(64)), null, "an undeclared schema hash never validates");
assert.equal(validateOpenClawBridgeSchemaHash("OPENCLAW_SHA256".repeat(2)), null, "non-hex schema hashes never validate");
assert.equal(validateOpenClawBridgeSchemaHash(null), null, "missing schema hashes never validate");
assert.equal(
  validateOpenClawBridgeSchemaHash(beta5Discovery.agentEventSchemaHash, []),
  null,
  "an empty validated profile set cannot vouch for any schema",
);
assert.equal(OPENCLAW_AGENT_EVENT_SCHEMA_HASH, beta5Discovery.agentEventSchemaHash);

// Supported-version happy path: negotiation yields structured capabilities and
// projects the pinned tool lifecycle with stable ids, statuses, inputs/outputs.
const negotiationLedger = new OpenClawBridgeNegotiationLedger();
const happyNegotiation = negotiateOpenClawBridgeSession({
  conversationId: "conv-happy",
  discovery: beta5Discovery,
  ledger: negotiationLedger,
});
assert.deepEqual(
  happyNegotiation,
  {
    outcome: "structured",
    gatewayVersion: "2026.7.2-beta.5",
    protocol: 4,
    schemaHash: beta5Discovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v1",
    capabilities: { streaming: true, toolEvents: true },
  },
  "the pinned beta5 gateway negotiates structured tool activity",
);
assert.deepEqual(
  negotiationLedger.lastValidated("conv-happy"),
  {
    gatewayVersion: "2026.7.2-beta.5",
    protocol: 4,
    schemaHash: beta5Discovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v1",
  },
  "a validated negotiation is recorded per conversation",
);
assert.equal(
  openClawBridgeNegotiationDiagnostic(happyNegotiation),
  null,
  "a structured negotiation surfaces no diagnostic",
);
assert.deepEqual(
  openClawBridgeCapabilitiesFromNegotiation(happyNegotiation),
  { ...openClawBridgeCapabilities(), streaming: true, toolEvents: true },
  "negotiated capabilities derive streaming/toolEvents from the negotiation outcome",
);

const happyProjector = createOpenClawBridgeToolProjector(happyNegotiation);
const happyProjected = toolLifecycleV1.frames.flatMap((frame) =>
  happyProjector.project(parseOpenClawToolEvent(frame.event, frame.payload, beta5Profile)));
assert.deepEqual(
  happyProjected,
  [
    { kind: "tool_use", id: "tool-1", name: "exec", input: '{"command":"echo hi"}', status: "running" },
    { kind: "tool_use", id: "tool-1", name: "exec", output: '"hi"', status: "running" },
    { kind: "tool_use", id: "tool-1", name: "exec", output: '{"text":"hi","exitCode":0}', status: "done" },
    {
      kind: "tool_use",
      id: "tool-2",
      name: "edit",
      output: '{"status":"failed","text":"validation failed"}',
      status: "error",
    },
  ],
  "validated tool activity projects running/completed/error events with stable ids and inputs/outputs",
);
assert.equal(
  new Set(happyProjected.map((event) => event.id)).size,
  2,
  "lifecycle frames keep one stable id per tool call",
);
assert.equal(happyProjector.paused, false, "the happy path never pauses the projector");
assert.deepEqual(
  happyProjector.project({ kind: "unknown", fingerprint: "0".repeat(16) }),
  [{
    kind: "progress",
    id: "openclaw-tool-compatibility",
    label: "OpenClaw tool activity",
    status: "error",
    detail: "unknown tool event (fingerprint 0000000000000000); plain chat retained",
  }],
  "a parsed unknown event fails closed with one value-free diagnostic",
);

// Unsupported-version fallback: authentic beta4 and a fixture future gateway
// both degrade to plain chat with a visible diagnostic.
const beta4Negotiation = negotiateOpenClawBridgeSession({
  conversationId: "conv-happy",
  discovery: beta4Discovery,
  ledger: negotiationLedger,
});
assert.deepEqual(
  beta4Negotiation,
  {
    outcome: "degraded",
    diagnostic: "unsupported-gateway-version",
    gatewayVersion: "2026.7.2-beta.4",
    protocol: 4,
    discoveredSchemaHash: beta4Discovery.agentEventSchemaHash,
    capabilities: { streaming: false, toolEvents: false },
  },
  "an unsupported gateway version degrades to plain chat",
);
assert.deepEqual(
  openClawBridgeCapabilitiesFromNegotiation(beta4Negotiation),
  { ...openClawBridgeCapabilities(), streaming: false, toolEvents: false },
  "degraded negotiation disables streaming and tool events",
);
assert.match(
  openClawBridgeNegotiationDiagnostic(beta4Negotiation),
  /gateway version 2026\.7\.2-beta\.4 has no validated compatibility profile; plain chat is retained\./,
  "the unsupported-version diagnostic names the version and the retained plain-chat mode",
);
assert.deepEqual(
  negotiationLedger.lastValidated("conv-happy"),
  {
    gatewayVersion: "2026.7.2-beta.5",
    protocol: 4,
    schemaHash: beta5Discovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v1",
  },
  "a degraded negotiation never replaces the conversation's validated negotiation",
);

const futureDiscovery = negotiationVersionFixtures.discoveries.unsupportedVersion;
assert.deepStrictEqual(
  parseOpenClawBridgeDiscovery(futureDiscovery),
  futureDiscovery,
  "the unsupported-version fixture passes the discovery validation hook",
);
const futureNegotiation = negotiateOpenClawBridgeSession({
  conversationId: "conv-happy",
  discovery: futureDiscovery,
  ledger: negotiationLedger,
});
assert.equal(futureNegotiation.diagnostic, "unsupported-gateway-version", "a gateway ahead of every validated profile degrades");
assert.equal(
  negotiateOpenClawBridgeSession({
    conversationId: "conv-happy",
    discovery: { ...beta5Discovery, protocol: 3 },
    ledger: negotiationLedger,
  }).diagnostic,
  "unsupported-wire-protocol",
  "a known version over an unvalidated wire protocol degrades with its own diagnostic",
);
assert.equal(
  negotiateOpenClawBridgeSession({
    conversationId: "conv-happy",
    discovery: { ...beta5Discovery, events: ["chat"] },
    ledger: negotiationLedger,
  }).diagnostic,
  "tool-events-not-offered",
  "a gateway that stops offering the tool-event contract degrades with its own diagnostic",
);

// Schema-hash mismatch rollback: an unvalidated hash is reported, never
// adopted, and the conversation restores structured mode on a valid discovery.
const mismatchedNegotiation = negotiateOpenClawBridgeSession({
  conversationId: "conv-happy",
  discovery: { ...beta5Discovery, agentEventSchemaHash: "f".repeat(64) },
  ledger: negotiationLedger,
});
assert.deepEqual(
  mismatchedNegotiation,
  {
    outcome: "degraded",
    diagnostic: "schema-hash-unvalidated",
    gatewayVersion: "2026.7.2-beta.5",
    protocol: 4,
    discoveredSchemaHash: "f".repeat(64),
    capabilities: { streaming: false, toolEvents: false },
  },
  "a schema-hash mismatch degrades to plain chat",
);
assert.match(
  openClawBridgeNegotiationDiagnostic(mismatchedNegotiation),
  new RegExp(`discovered event schema ${"f".repeat(64)} is not a validated compatibility schema; plain chat is retained\\.`),
  "the mismatch diagnostic names the unvalidated hash without payload content",
);
assert.deepEqual(
  negotiationLedger.lastValidated("conv-happy"),
  {
    gatewayVersion: "2026.7.2-beta.5",
    protocol: 4,
    schemaHash: beta5Discovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v1",
  },
  "rollback protection: the ledger keeps the last validated schema and never adopts the mismatched one",
);
const mismatchedProjector = createOpenClawBridgeToolProjector(mismatchedNegotiation);
assert.deepEqual(
  mismatchedProjector.project(parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, toolLifecycleV1.frames[0].payload, beta5Profile)),
  [],
  "a degraded session retains plain chat and projects no tool events",
);
assert.deepEqual(
  negotiateOpenClawBridgeSession({
    conversationId: "conv-happy",
    discovery: beta5Discovery,
    ledger: negotiationLedger,
  }),
  happyNegotiation,
  "a later valid discovery restores the structured negotiation",
);

// Unknown-event fallback: every fixture violation parses unknown, the first
// unknown event settles open calls with one visible diagnostic, and the
// projector then stays paused so unvalidated shapes cannot leak into tool
// activity.
for (const frame of unknownEventFixtures.frames) {
  assert.equal(
    parseOpenClawToolEvent(frame.event, frame.payload, beta5Profile).kind,
    "unknown",
    `unknown-event fixture frame seq ${frame.payload.seq} fails closed under the validated profile`,
  );
}
const unknownProjector = createOpenClawBridgeToolProjector(happyNegotiation);
assert.deepEqual(
  unknownProjector.project(parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, toolLifecycleV1.frames[0].payload, beta5Profile)),
  [{ kind: "tool_use", id: "tool-1", name: "exec", input: '{"command":"echo hi"}', status: "running" }],
  "the unknown-event scenario starts from an open tool call",
);
const unknownOut = unknownProjector.project(
  parseOpenClawToolEvent(unknownEventFixtures.frames[0].event, unknownEventFixtures.frames[0].payload, beta5Profile),
);
assert.equal(unknownOut.length, 2, "the first unknown event settles the open call and emits one diagnostic");
assert.deepEqual(
  unknownOut[0],
  {
    kind: "tool_use",
    id: "tool-1",
    name: "exec",
    output: "[OpenClaw tool activity was paused: unrecognized event]",
    status: "error",
  },
  "open tool calls settle visibly instead of being silently lost",
);
assert.equal(unknownOut[1].kind, "progress");
assert.equal(unknownOut[1].id, "openclaw-tool-compatibility");
assert.equal(unknownOut[1].status, "error");
assert.match(
  unknownOut[1].detail,
  /^unknown tool event \(fingerprint [0-9a-f]{16}\); plain chat retained$/,
  "the unknown-event diagnostic is value-free: shape fingerprint only",
);
assert.equal(
  unknownOut[1].detail.includes("echo hi"),
  false,
  "the diagnostic never carries tool payload content",
);
assert.equal(unknownProjector.paused, true, "the projector pauses after the fail-closed diagnostic");
assert.deepEqual(
  unknownProjector.project(
    parseOpenClawToolEvent(unknownEventFixtures.frames[1].event, unknownEventFixtures.frames[1].payload, beta5Profile),
  ),
  [],
  "projection stays paused; later unknown events do not repeat diagnostics or emit events",
);

// Malformed discovery fails closed without touching the ledger.
assert.deepEqual(
  negotiateOpenClawBridgeSession({ conversationId: "conv-malformed", discovery: null, ledger: negotiationLedger }),
  {
    outcome: "degraded",
    diagnostic: "gateway-discovery-unavailable",
    gatewayVersion: null,
    protocol: null,
    discoveredSchemaHash: null,
    capabilities: { streaming: false, toolEvents: false },
  },
  "a missing discovery degrades to plain chat with a diagnostic",
);
assert.equal(negotiationLedger.lastValidated("conv-malformed"), null, "a degraded conversation stays out of the ledger");

// Concurrent schema versions: a registry-style refresh carrying a second
// simultaneously-supported version lets distinct conversations negotiate
// distinct validated schemas at the same time.
const concurrentDiscovery = negotiationVersionFixtures.discoveries.concurrentVersion;
assert.deepStrictEqual(
  parseOpenClawBridgeDiscovery(concurrentDiscovery),
  concurrentDiscovery,
  "the concurrent-version fixture passes the discovery validation hook",
);
const concurrentProfile = {
  ...structuredClone(beta5Profile),
  id: "openclaw-agent-tool-v2",
  priority: 90,
  requires: {
    ...structuredClone(beta5Profile.requires),
    serverVersions: [concurrentDiscovery.serverVersion],
    agentEventSchemaHash: concurrentDiscovery.agentEventSchemaHash,
  },
  source: { ...beta5Profile.source, blobSha: "b".repeat(40) },
};
const refreshedProfiles = validateOpenClawToolProfiles([beta5Profile, concurrentProfile]);
assert.ok(
  refreshedProfiles,
  "a registry-style profile set carrying a second schema version validates alongside the built-in profile",
);
const concurrentLedger = new OpenClawBridgeNegotiationLedger();
const [concurrentA, concurrentB] = await Promise.all([
  Promise.resolve(negotiateOpenClawBridgeSession({
    conversationId: "conv-a",
    discovery: beta5Discovery,
    profiles: refreshedProfiles,
    ledger: concurrentLedger,
  })),
  Promise.resolve(negotiateOpenClawBridgeSession({
    conversationId: "conv-b",
    discovery: concurrentDiscovery,
    profiles: refreshedProfiles,
    ledger: concurrentLedger,
  })),
]);
assert.equal(concurrentA.outcome, "structured", "the first conversation negotiates its own schema version");
assert.equal(concurrentA.profileId, "openclaw-agent-tool-v1");
assert.equal(concurrentB.outcome, "structured", "the second conversation negotiates the refreshed schema version concurrently");
assert.equal(concurrentB.profileId, "openclaw-agent-tool-v2");
assert.notEqual(
  concurrentA.schemaHash,
  concurrentB.schemaHash,
  "concurrent conversations hold distinct validated schema hashes",
);
assert.deepEqual(
  concurrentLedger.lastValidated("conv-a"),
  {
    gatewayVersion: beta5Discovery.serverVersion,
    protocol: 4,
    schemaHash: beta5Discovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v1",
  },
  "the ledger keeps per-conversation validated schema versions concurrently",
);
assert.deepEqual(
  concurrentLedger.lastValidated("conv-b"),
  {
    gatewayVersion: concurrentDiscovery.serverVersion,
    protocol: 4,
    schemaHash: concurrentDiscovery.agentEventSchemaHash,
    profileId: "openclaw-agent-tool-v2",
  },
  "the second conversation's validated schema version is recorded independently",
);
assert.deepEqual(
  createOpenClawBridgeToolProjector(concurrentB).project(
    parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, toolLifecycleV1.frames[0].payload, concurrentProfile),
  ),
  [{ kind: "tool_use", id: "tool-1", name: "exec", input: '{"command":"echo hi"}', status: "running" }],
  "the concurrent schema version projects validated tool activity under its own profile",
);
assert.equal(
  negotiateOpenClawBridgeSession({
    conversationId: "conv-c",
    discovery: { ...beta5Discovery, agentEventSchemaHash: "e".repeat(64) },
    profiles: refreshedProfiles,
    ledger: concurrentLedger,
  }).diagnostic,
  "schema-hash-unvalidated",
  "a refreshed profile set still refuses hashes no validated profile declares",
);

console.log("openclaw-bridge.test.ts: ok");
