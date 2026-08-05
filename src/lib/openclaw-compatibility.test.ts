import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs, { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

import {
  BUILTIN_OPENCLAW_SCHEMA_BUNDLE,
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  clearOpenClawProfileQuarantineForTests,
  loadOpenClawCompatibility,
  openClawSchemaBundlePayloadHash,
  openClawSchemaBundleSigningPayload,
  parseOpenClawToolEvent,
  quarantineOpenClawProfile,
  redactedOpenClawToolFingerprint,
  selectOpenClawToolProfile,
  type OpenClawSchemaBundle,
  validateOpenClawToolProfiles,
  verifyOpenClawSchemaBundle,
  openClawDiscoveryFromHello,
} from "./openclaw-compatibility.ts";

const gatewayBeta4 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta4.json", import.meta.url), "utf8"),
);
const gatewayBeta5 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const toolLifecycleV1 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/tool-lifecycle-v1.json", import.meta.url), "utf8"),
);

assert.equal(
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  "ed68832d5ecbc52de7ad5394933cb2a0df7b0f0b6f7a880127f688becbd76bd2",
);

const beta4Discovery = openClawDiscoveryFromHello(gatewayBeta4);
const beta5Discovery = openClawDiscoveryFromHello(gatewayBeta5);

assert.deepStrictEqual(beta4Discovery, {
  serverVersion: "2026.7.2-beta.4",
  protocol: 4,
  methods: ["chat.send", "chat.abort"],
  events: ["chat"],
  serverCapabilities: ["chat-send-routing-contract"],
  clientCapabilities: ["tool-events"],
  agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
});

assert.deepStrictEqual(beta5Discovery, {
  serverVersion: "2026.7.2-beta.5",
  protocol: 4,
  methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
  events: ["chat", "agent", "session.tool"],
  serverCapabilities: ["chat-send-routing-contract"],
  clientCapabilities: ["tool-events"],
  agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
});

assert.ok(Value.Check(HelloOkSchema, gatewayBeta4));
assert.ok(Value.Check(HelloOkSchema, gatewayBeta5));

assert.deepStrictEqual(
  toolLifecycleV1.frames.map((frame: { event: string }) => frame.event),
  ["agent", "agent", "agent", "session.tool"],
);

for (const frame of toolLifecycleV1.frames) {
  assert.ok(Value.Check(AgentEventSchema, frame.payload), frame.event);
}

const profiles = validateOpenClawToolProfiles(BUILTIN_OPENCLAW_TOOL_PROFILES);
assert.ok(profiles, "the built-in OpenClaw tool profiles must pass structural validation");
const [beta5Profile] = profiles;

assert.deepStrictEqual(beta5Profile, {
  id: "openclaw-agent-tool-v1",
  priority: 100,
  requires: {
    serverVersions: ["2026.7.2-beta.5"],
    protocol: 4,
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
    methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.tool"],
    serverCapabilities: ["chat-send-routing-contract"],
    clientCapabilities: ["tool-events"],
  },
  eventNames: ["agent", "session.tool"],
  streams: ["tool"],
  phases: {
    start: ["start"],
    update: ["update"],
    result: ["result"],
  },
  aliases: {
    phase: ["phase"],
    toolCallId: ["toolCallId"],
    name: ["name"],
    args: ["args"],
    partialResult: ["partialResult"],
    result: ["result"],
    isError: ["isError"],
    status: ["status"],
    exitCode: ["exitCode"],
  },
  errorStates: ["error", "failed", "failure"],
  source: {
    repo: "openclaw/openclaw",
    package: "@openclaw/gateway-protocol@2026.7.2-beta.5",
    blobSha: "d66b514a7e7565d89c87ab6f1a509623128093f0",
  },
});

assert.equal(selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, beta4Discovery), null, "beta4 must not match the beta5-only tool profile");
assert.deepStrictEqual(
  selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, beta5Discovery),
  beta5Profile,
  "beta5 discovery selects the reviewed built-in profile",
);
const { priority: _omittedPriority, ...beta5ProfileWithoutPriority } = {
  ...beta5Profile,
  id: "openclaw-agent-tool-default-priority",
  source: { ...beta5Profile.source },
};
assert.deepStrictEqual(
  validateOpenClawToolProfiles([beta5ProfileWithoutPriority]),
  [{ ...beta5ProfileWithoutPriority, priority: 0 }],
  "compatible profiles without an explicit priority validate with the default effective priority",
);
assert.deepStrictEqual(
  selectOpenClawToolProfile([beta5ProfileWithoutPriority], beta5Discovery),
  { ...beta5ProfileWithoutPriority, priority: 0 },
  "compatible profiles without an explicit priority remain selectable",
);
assert.deepStrictEqual(
  selectOpenClawToolProfile(
    [
      beta5ProfileWithoutPriority,
      { ...beta5Profile, id: "openclaw-agent-tool-priority-1", source: { ...beta5Profile.source }, priority: 1 },
    ],
    beta5Discovery,
  ),
  { ...beta5Profile, id: "openclaw-agent-tool-priority-1", source: { ...beta5Profile.source }, priority: 1 },
  "explicit priorities still outrank the default effective priority deterministically",
);
assert.equal(
  selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, {
    ...beta5Discovery,
    methods: [...beta5Discovery.methods, "chat.extra"],
  }),
  null,
  "beta5 discovery with any extra method is unselectable",
);
assert.equal(
  selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, {
    ...beta5Discovery,
    events: [...beta5Discovery.events, "session.extra"],
  }),
  null,
  "beta5 discovery with any extra event is unselectable",
);
assert.equal(
  selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, {
    ...beta5Discovery,
    serverCapabilities: [...beta5Discovery.serverCapabilities, "extra-capability"],
  }),
  null,
  "beta5 discovery with any extra server capability is unselectable",
);

assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, toolLifecycleV1.frames[0].payload, beta5Profile),
  { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
);
const openClawEditStart = {
  ...toolLifecycleV1.frames[0].payload,
  data: {
    ...toolLifecycleV1.frames[0].payload.data,
    toolCallId: "tool-edit",
    name: "edit",
    args: {
      path: "/repo/src/openclaw.ts",
      edits: [{ oldText: "const before = true;", newText: "const after = true;" }],
    },
  },
};
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, openClawEditStart, beta5Profile),
  {
    kind: "tool_start",
    id: "tool-edit",
    name: "edit",
    input: {
      path: "/repo/src/openclaw.ts",
      edits: [{ oldText: "const before = true;", newText: "const after = true;" }],
    },
    seq: 3,
  },
  "OpenClaw edit starts preserve the adapter's path plus camelCase edit pairs",
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[1].event, toolLifecycleV1.frames[1].payload, beta5Profile),
  { kind: "tool_progress", id: "tool-1", output: "hi", seq: 7 },
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, toolLifecycleV1.frames[2].payload, beta5Profile),
  { kind: "tool_end", id: "tool-1", name: "exec", output: { text: "hi", exitCode: 0 }, isError: false, seq: 9 },
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[3].event, toolLifecycleV1.frames[3].payload, beta5Profile),
  {
    kind: "tool_end",
    id: "tool-2",
    name: "edit",
    output: { status: "failed", text: "validation failed" },
    isError: true,
    seq: 5,
  },
  "nested result.status is only consulted through the Cave-owned bounded envelope logic",
);

const unknownEvent = parseOpenClawToolEvent("chat", toolLifecycleV1.frames[0].payload, beta5Profile);
assert.equal(unknownEvent.kind, "unknown");
assert.match(unknownEvent.fingerprint, /^[a-f0-9]{16}$/);

const unknownStream = parseOpenClawToolEvent(
  toolLifecycleV1.frames[0].event,
  { ...toolLifecycleV1.frames[0].payload, stream: "chat" },
  beta5Profile,
);
assert.equal(unknownStream.kind, "unknown");

const unknownPhase = parseOpenClawToolEvent(
  toolLifecycleV1.frames[0].event,
  { ...toolLifecycleV1.frames[0].payload, data: { ...toolLifecycleV1.frames[0].payload.data, phase: "mystery" } },
  beta5Profile,
);
assert.equal(unknownPhase.kind, "unknown");

const { args: _missingArgs, ...startWithoutArgs } = toolLifecycleV1.frames[0].payload.data;
const missingStartInputPayload = { ...toolLifecycleV1.frames[0].payload, data: startWithoutArgs };
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[0].event, missingStartInputPayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(missingStartInputPayload) },
  "tool starts without a raw input payload are malformed",
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(
    toolLifecycleV1.frames[0].event,
    { ...toolLifecycleV1.frames[0].payload, data: { ...toolLifecycleV1.frames[0].payload.data, args: null } },
    beta5Profile,
  ),
  { kind: "tool_start", id: "tool-1", name: "exec", input: null, seq: 3 },
  "explicit null tool inputs remain valid raw payloads",
);

const { partialResult: _missingPartialResult, ...updateWithoutPartialResult } = toolLifecycleV1.frames[1].payload.data;
const missingProgressPayload = { ...toolLifecycleV1.frames[1].payload, data: updateWithoutPartialResult };
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[1].event, missingProgressPayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(missingProgressPayload) },
  "tool updates without a raw progress payload are malformed",
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(
    toolLifecycleV1.frames[1].event,
    { ...toolLifecycleV1.frames[1].payload, data: { ...toolLifecycleV1.frames[1].payload.data, partialResult: false } },
    beta5Profile,
  ),
  { kind: "tool_progress", id: "tool-1", output: false, seq: 7 },
  "explicit falsy tool progress remains a valid raw payload",
);

const { result: _missingResult, ...resultWithoutOutput } = toolLifecycleV1.frames[2].payload.data;
const missingResultOutputPayload = { ...toolLifecycleV1.frames[2].payload, data: resultWithoutOutput };
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, missingResultOutputPayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(missingResultOutputPayload) },
  "tool results without a raw output payload are malformed",
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(
    toolLifecycleV1.frames[2].event,
    { ...toolLifecycleV1.frames[2].payload, data: { ...toolLifecycleV1.frames[2].payload.data, result: 0 } },
    beta5Profile,
  ),
  { kind: "tool_end", id: "tool-1", name: "exec", output: 0, isError: false, seq: 9 },
  "explicit falsy tool outputs remain valid raw payloads",
);
const invalidIsErrorPayload = {
  ...toolLifecycleV1.frames[2].payload,
  data: { ...toolLifecycleV1.frames[2].payload.data, isError: "true" },
};
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, invalidIsErrorPayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(invalidIsErrorPayload) },
  "configured isError aliases fail closed on non-boolean values",
);
const invalidStatusPayload = {
  ...toolLifecycleV1.frames[2].payload,
  data: { ...toolLifecycleV1.frames[2].payload.data, status: 500 },
};
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, invalidStatusPayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(invalidStatusPayload) },
  "configured status aliases fail closed on non-string values",
);
const invalidDataExitCodePayload = {
  ...toolLifecycleV1.frames[2].payload,
  data: { ...toolLifecycleV1.frames[2].payload.data, exitCode: "1" },
};
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, invalidDataExitCodePayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(invalidDataExitCodePayload) },
  "configured exitCode aliases fail closed on non-numeric values",
);
const invalidNestedExitCodePayload = {
  ...toolLifecycleV1.frames[2].payload,
  data: {
    ...toolLifecycleV1.frames[2].payload.data,
    result: { text: "bad nested exit code", exitCode: "1" },
  },
};
assert.deepStrictEqual(
  parseOpenClawToolEvent(toolLifecycleV1.frames[2].event, invalidNestedExitCodePayload, beta5Profile),
  { kind: "unknown", fingerprint: redactedOpenClawToolFingerprint(invalidNestedExitCodePayload) },
  "nested result.exitCode fails closed on non-numeric values",
);

assert.equal(
  parseOpenClawToolEvent(
    toolLifecycleV1.frames[0].event,
    { ...toolLifecycleV1.frames[0].payload, data: { ...toolLifecycleV1.frames[0].payload.data, toolCallId: "" } },
    beta5Profile,
  ).kind,
  "unknown",
  "tool starts without a non-empty id are malformed",
);
assert.equal(
  parseOpenClawToolEvent(
    toolLifecycleV1.frames[2].event,
    { ...toolLifecycleV1.frames[2].payload, data: { ...toolLifecycleV1.frames[2].payload.data, name: "" } },
    beta5Profile,
  ).kind,
  "unknown",
  "tool results without a non-empty name are malformed",
);

assert.deepStrictEqual(
  parseOpenClawToolEvent(
    "agent",
    {
      ...toolLifecycleV1.frames[2].payload,
      data: {
        phase: "result",
        toolCallId: "tool-3",
        name: "exec",
        result: { text: "failed with status only", status: "failure" },
      },
    },
    beta5Profile,
  ),
  {
    kind: "tool_end",
    id: "tool-3",
    name: "exec",
    output: { text: "failed with status only", status: "failure" },
    isError: true,
    seq: 9,
  },
  "nested result.status participates only through the bounded parser logic",
);
assert.deepStrictEqual(
  parseOpenClawToolEvent(
    "agent",
    {
      ...toolLifecycleV1.frames[2].payload,
      data: {
        phase: "result",
        toolCallId: "tool-4",
        name: "exec",
        result: { text: "boom", exitCode: 17 },
      },
    },
    beta5Profile,
  ),
  {
    kind: "tool_end",
    id: "tool-4",
    name: "exec",
    output: { text: "boom", exitCode: 17 },
    isError: true,
    seq: 9,
  },
  "nonzero nested result.exitCode settles tool activity as an error",
);

assert.equal(
  validateOpenClawToolProfiles([
    beta5Profile,
    { ...beta5Profile, source: { ...beta5Profile.source }, priority: 101 },
  ]),
  null,
  "duplicate profile ids are rejected at the validation boundary",
);
assert.equal(
  validateOpenClawToolProfiles([
    beta5Profile,
    { ...beta5Profile, id: "openclaw-agent-tool-v2", source: { ...beta5Profile.source } },
  ]),
  null,
  "duplicate priorities are rejected at the validation boundary",
);
assert.equal(
  validateOpenClawToolProfiles([
    beta5ProfileWithoutPriority,
    { ...beta5Profile, id: "openclaw-agent-tool-v2", source: { ...beta5Profile.source }, priority: 0 },
  ]),
  null,
  "omitted and explicit zero priorities collide on the same effective priority",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      phases: {
        start: ["start", "shared-phase"],
        update: ["shared-phase"],
        result: ["result"],
      },
    },
  ]),
  null,
  "phase tokens cannot be reused across semantic buckets",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      aliases: {
        ...beta5Profile.aliases,
        status: ["sharedAlias"],
        exitCode: ["sharedAlias"],
      },
    },
  ]),
  null,
  "direct field aliases cannot be reused across semantic buckets",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      aliases: { ...beta5Profile.aliases, status: ["result.status"] },
    },
  ]),
  null,
  "nested registry paths are not valid direct field aliases",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      requires: { ...beta5Profile.requires, clientCapabilities: ["tool-events", "other"] },
    },
  ]),
  null,
  "only the reviewed tool-events client capability is allowed",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      unexpected: true,
    },
  ]),
  null,
  "closed profile validation rejects unexpected top-level keys",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      id: "é".repeat(129),
      source: { ...beta5Profile.source },
    },
  ]),
  null,
  "profile strings are bounded by UTF-8 bytes, not characters",
);
assert.equal(
  validateOpenClawToolProfiles([
    {
      ...beta5Profile,
      source: { ...beta5Profile.source },
      errorStates: Array.from({ length: 17 }, (_, index) => `error-${index}`),
    },
  ]),
  null,
  "bounded lists reject more than sixteen entries",
);
assert.equal(
  selectOpenClawToolProfile(
    [
      beta5Profile,
      { ...beta5Profile, id: "openclaw-agent-tool-v2", source: { ...beta5Profile.source }, priority: 100 },
    ],
    beta5Discovery,
  ),
  null,
  "invalid profile lists are not selectable",
);

const secretFingerprintA = redactedOpenClawToolFingerprint({
  runId: "run-1",
  seq: 9,
  stream: "tool",
  ts: 1200,
  data: {
    phase: "result",
    toolCallId: "tool-9",
    name: "exec",
    result: {
      status: "failed",
      exitCode: 1,
      secret: "token-a",
      "/Users/buns/private.txt": "never log me",
      nested: { prompt: "alpha" },
    },
  },
});
const secretFingerprintB = redactedOpenClawToolFingerprint({
  runId: "run-2",
  seq: 9,
  stream: "tool",
  ts: 1300,
  data: {
    phase: "result",
    toolCallId: "tool-9",
    name: "exec",
    result: {
      status: "failed",
      exitCode: 1,
      apiKey: "token-b",
      "/Users/buns/other.txt": "still secret",
      nested: { prompt: "beta" },
    },
  },
});
assert.equal(secretFingerprintA, secretFingerprintB, "tool fingerprints capture only the reviewed envelope shape");
assert.doesNotMatch(secretFingerprintA, /token|private|alpha|beta/, "fingerprints must not retain secret values or dynamic keys");
assert.match(secretFingerprintA, /^[a-f0-9]{16}$/);

const REGISTRY_NOW = Date.parse("2026-07-31T18:00:00.000Z");
const registryTestRoot = await mkdtemp(path.join(process.cwd(), ".openclaw-registry-test-"));
const cacheFile = (cacheDir: string) => path.join(cacheDir, "openclaw-schema-bundle-v1.json");
const makeCacheDir = async (name: string): Promise<string> => {
  const cacheDir = path.join(registryTestRoot, name);
  await mkdir(cacheDir, { recursive: true });
  return cacheDir;
};

const registryKeyPair = generateKeyPairSync("ed25519");
const registryPublicKey = registryKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const registryKeyring = { "openclaw-2026": registryPublicKey };
const signBundle = (bundle: OpenClawSchemaBundle): OpenClawSchemaBundle => {
  const unsigned = structuredClone(bundle);
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(
        null,
        Buffer.from(openClawSchemaBundleSigningPayload(unsigned)),
        registryKeyPair.privateKey,
      ).toString("base64"),
    },
  };
};
const revisedProfile = (
  marker: string,
  {
    id = beta5Profile.id,
    priority = beta5Profile.priority,
    serverVersion = beta5Discovery.serverVersion,
  }: { id?: string; priority?: number; serverVersion?: string } = {},
) => ({
  ...structuredClone(beta5Profile),
  id,
  priority,
  requires: {
    ...structuredClone(beta5Profile.requires),
    serverVersions: [serverVersion],
  },
  errorStates: [...beta5Profile.errorStates, `error-${marker}`],
  source: {
    ...beta5Profile.source,
    blobSha: marker.repeat(40),
  },
});
const signedBundle = (
  sequence: number,
  profiles = [revisedProfile("a")],
  overrides: Partial<OpenClawSchemaBundle> = {},
): OpenClawSchemaBundle => signBundle({
  format: 1,
  runtime: "openclaw",
  sequence,
  issuedAt: "2026-07-31T00:00:00.000Z",
  expiresAt: "2027-07-31T00:00:00.000Z",
  keyId: "openclaw-2026",
  profiles,
  ...overrides,
});

try {
  const signedGenesis = signBundle(structuredClone(BUILTIN_OPENCLAW_SCHEMA_BUNDLE));
  assert.equal(
    openClawSchemaBundleSigningPayload({
      z: "last",
      runtime: "openclaw",
      sequence: 1,
      format: 1,
      issuedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
      profiles: [],
      signature: { algorithm: "ed25519", value: "excluded" },
    } as unknown as OpenClawSchemaBundle),
    `{"expiresAt":"2030-01-01T00:00:00.000Z","format":1,"issuedAt":"2026-07-31T00:00:00.000Z","profiles":[],"runtime":"openclaw","sequence":1,"z":"last"}`,
    "OpenClaw signing bytes recursively sort object keys and exclude the signature",
  );
  assert.equal(
    verifyOpenClawSchemaBundle(signedGenesis, registryPublicKey, REGISTRY_NOW),
    true,
    "a canonical Ed25519-signed genesis bundle verifies",
  );
  assert.equal(
    verifyOpenClawSchemaBundle({ ...signedGenesis, sequence: 0 }, registryPublicKey, REGISTRY_NOW),
    false,
    "registry sequence zero is invalid",
  );
  const tamperedGenesis = structuredClone(signedGenesis);
  tamperedGenesis.profiles[0].errorStates.push("tampered");
  assert.equal(
    verifyOpenClawSchemaBundle(tamperedGenesis, registryPublicKey, REGISTRY_NOW),
    false,
    "signed profile tampering invalidates the bundle",
  );
  const expiredGenesis = signBundle({
    ...structuredClone(BUILTIN_OPENCLAW_SCHEMA_BUNDLE),
    expiresAt: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(verifyOpenClawSchemaBundle(expiredGenesis, registryPublicKey, REGISTRY_NOW), false);
  assert.equal(
    verifyOpenClawSchemaBundle(expiredGenesis, registryPublicKey, REGISTRY_NOW, { allowExpired: true }),
    true,
    "allowExpired verifies immutable trust history without selecting it",
  );

  const otherKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(
    verifyOpenClawSchemaBundle(signedGenesis, { one: registryPublicKey, two: otherKey }, REGISTRY_NOW),
    false,
    "a rotating keyring requires a signed keyId",
  );
  assert.equal(
    verifyOpenClawSchemaBundle(
      signedBundle(2),
      Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
        index === 0 ? "openclaw-2026" : `key-${index}`,
        registryPublicKey,
      ])),
      REGISTRY_NOW,
    ),
    false,
    "the registry keyring is bounded",
  );
  assert.equal(
    verifyOpenClawSchemaBundle(
      { ...signedBundle(2), unexpected: true },
      registryKeyring,
      REGISTRY_NOW,
    ),
    false,
    "unknown bundle fields fail closed",
  );
  assert.equal(
    verifyOpenClawSchemaBundle(
      signBundle({
        ...structuredClone(BUILTIN_OPENCLAW_SCHEMA_BUNDLE),
        sequence: 2,
        keyId: "openclaw-2026",
        retiredProfileIds: ["not-a-built-in-profile"],
      }),
      registryKeyring,
      REGISTRY_NOW,
    ),
    false,
    "signed retirement is limited to compiled profile IDs",
  );
  assert.equal(
    verifyOpenClawSchemaBundle(
      signedBundle(2, Array.from({ length: 33 }, (_, index) =>
        revisedProfile(index.toString(16).slice(-1), {
          id: `openclaw-profile-${index}`,
          priority: index,
        }))),
      registryKeyring,
      REGISTRY_NOW,
    ),
    false,
    "a bundle cannot contain more than 32 profiles",
  );

  const genesisCacheDir = await makeCacheDir("genesis");
  const genesisCompatibility = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: genesisCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    checkpoint: {
      sequence: 1,
      payloadHash: openClawSchemaBundlePayloadHash(signedGenesis),
    },
    fetchImpl: async () => new Response(JSON.stringify(signedGenesis), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(genesisCompatibility.mode, "structured");
  assert.equal(genesisCompatibility.bundleSource, "remote");

  const sequenceTwo = signedBundle(2, [revisedProfile("a")], {
    retiredProfileIds: [beta5Profile.id],
  });
  const remoteCacheDir = await makeCacheDir("remote");
  const remoteCompatibility = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: remoteCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.credentials, "omit", "registry refreshes omit credentials");
      assert.equal(init?.redirect, "error", "registry refreshes reject redirects");
      return new Response(JSON.stringify(sequenceTwo), { status: 200 });
    },
    now: () => REGISTRY_NOW,
  });
  assert.equal(remoteCompatibility.mode, "structured");
  assert.equal(remoteCompatibility.bundleSource, "remote");
  const remoteCache = JSON.parse(await readFile(cacheFile(remoteCacheDir), "utf8"));
  assert.equal(remoteCache.fetchedAt, REGISTRY_NOW, "the cache records verified fetch time");
  assert.equal(remoteCache.verifiedKeyId, "openclaw-2026", "the cache records the verified signer");

  const highWaterProfile = revisedProfile("c");
  const highWaterBundle = signedBundle(3, [highWaterProfile], {
    retiredProfileIds: [beta5Profile.id],
  });
  const rollbackCacheDir = await makeCacheDir("rollback");
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: rollbackCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(highWaterBundle), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  const rollback = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: rollbackCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(sequenceTwo), { status: 200 }),
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  });
  assert.equal(rollback.mode, "structured");
  assert.equal(rollback.bundleSource, "cache", "a lower signed sequence cannot replace the high-water cache");
  assert.equal(rollback.profile.source.blobSha, highWaterProfile.source.blobSha);

  const equalRewriteCacheDir = await makeCacheDir("equal-rewrite");
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: equalRewriteCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(sequenceTwo), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  const equalRewriteProfile = revisedProfile("b");
  const equalRewrite = signedBundle(2, [equalRewriteProfile], {
    retiredProfileIds: [beta5Profile.id],
  });
  const equalRewriteResult = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: equalRewriteCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(equalRewrite), { status: 200 }),
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  });
  assert.equal(equalRewriteResult.mode, "structured");
  assert.equal(equalRewriteResult.bundleSource, "cache", "an equal-sequence payload rewrite is rejected");
  assert.equal(equalRewriteResult.profile.source.blobSha, revisedProfile("a").source.blobSha);

  const checkpointMismatch = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("checkpoint-mismatch"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    checkpoint: { sequence: 2, payloadHash: "0".repeat(64) },
    fetchImpl: async () => new Response(JSON.stringify(sequenceTwo), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(checkpointMismatch.mode, "structured");
  assert.equal(checkpointMismatch.bundleSource, "built-in", "checkpoint mismatches retain the source-trusted baseline");

  const corruptCacheDir = await makeCacheDir("corrupt");
  await writeFile(cacheFile(corruptCacheDir), "{corrupted-cache");
  const corruptedCache = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: corruptCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => { throw new Error("offline"); },
    now: () => REGISTRY_NOW,
  });
  assert.equal(corruptedCache.mode, "structured");
  assert.equal(corruptedCache.bundleSource, "built-in", "a corrupt first-use cache safely falls back to the built-in profile");

  const expiredRemoteProfile = revisedProfile("d", {
    id: "openclaw-agent-tool-remote-v2",
    priority: 101,
    serverVersion: "2026.7.2-beta.6",
  });
  const expiredRemoteBundle = signedBundle(2, [expiredRemoteProfile], {
    expiresAt: "2026-08-01T00:00:00.000Z",
  });
  const beta6Discovery = { ...beta5Discovery, serverVersion: "2026.7.2-beta.6" };
  const expiredRemoteCacheDir = await makeCacheDir("expired-remote");
  const liveRemoteOnly = await loadOpenClawCompatibility(beta6Discovery, {
    cacheDir: expiredRemoteCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(expiredRemoteBundle), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(liveRemoteOnly.mode, "structured");
  const expiredRemoteOnly = await loadOpenClawCompatibility(beta6Discovery, {
    cacheDir: expiredRemoteCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => { throw new Error("offline"); },
    now: () => Date.parse("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(expiredRemoteOnly.mode, "plain", "an expired remote-only profile disables structured mode");
  assert.equal(expiredRemoteOnly.diagnostic, "cached-profile-unavailable");

  const corruptAcceptedCacheDir = await makeCacheDir("corrupt-accepted");
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: corruptAcceptedCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(highWaterBundle), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  await writeFile(cacheFile(corruptAcceptedCacheDir), "{corrupted-cache");
  const corruptAccepted = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: corruptAcceptedCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => { throw new Error("offline"); },
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  });
  assert.equal(corruptAccepted.mode, "plain", "accepted newer history cannot revive an older built-in after cache corruption");
  assert.equal(corruptAccepted.diagnostic, "cached-profile-unavailable");

  const staleWriterCacheDir = await makeCacheDir("stale-writer");
  const sequenceFour = signedBundle(4, [revisedProfile("e")], {
    retiredProfileIds: [beta5Profile.id],
  });
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: staleWriterCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(sequenceFour), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  await writeFile(cacheFile(staleWriterCacheDir), JSON.stringify({
    fetchedAt: REGISTRY_NOW,
    verifiedKeyId: "openclaw-2026",
    bundle: highWaterBundle,
  }));
  const staleWriterRecovery = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: staleWriterCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(highWaterBundle), { status: 200 }),
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  });
  assert.equal(staleWriterRecovery.mode, "plain", "a stale writer cannot lower the immutable accepted anchor");

  const concurrentCacheDir = await makeCacheDir("concurrent");
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: concurrentCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(sequenceTwo), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  let fetchCalls = 0;
  let releaseRefresh: (() => void) | undefined;
  let markFetchStarted: (() => void) | undefined;
  const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const refreshStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const concurrentSource = {
    cacheDir: concurrentCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => {
      fetchCalls += 1;
      markFetchStarted?.();
      await refreshReleased;
      return new Response(JSON.stringify(highWaterBundle), { status: 200 });
    },
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  };
  const concurrentA = loadOpenClawCompatibility(beta5Discovery, concurrentSource);
  const concurrentB = loadOpenClawCompatibility(beta5Discovery, concurrentSource);
  await refreshStarted;
  assert.equal(fetchCalls, 1, "concurrent callers share one registry refresh flight");
  releaseRefresh?.();
  const [concurrentResultA, concurrentResultB] = await Promise.all([concurrentA, concurrentB]);
  assert.equal(concurrentResultA.bundleSource, "remote");
  assert.equal(concurrentResultB.bundleSource, "remote");

  const reclaimedWriterCacheDir = await makeCacheDir("reclaimed-writer");
  const reclaimedWriterCacheFile = cacheFile(reclaimedWriterCacheDir);
  const originalRename = fs.promises.rename;
  let cacheRenameIntercepted = false;
  let resumeWriterA: (() => void) | undefined;
  let markWriterAStalled: (() => void) | undefined;
  const writerAResume = new Promise<void>((resolve) => { resumeWriterA = resolve; });
  const writerAStalled = new Promise<void>((resolve) => { markWriterAStalled = resolve; });
  fs.promises.rename = async (source, destination) => {
    if (
      !cacheRenameIntercepted
      && String(destination) === reclaimedWriterCacheFile
      && String(source).endsWith(".tmp")
    ) {
      cacheRenameIntercepted = true;
      markWriterAStalled?.();
      await writerAResume;
    }
    return originalRename(source, destination);
  };
  syncBuiltinESMExports();
  let reclaimedWriterA: Promise<Awaited<ReturnType<typeof loadOpenClawCompatibility>>> | undefined;
  let writerAFetches = 0;
  let writerBFetches = 0;
  try {
    reclaimedWriterA = loadOpenClawCompatibility(beta5Discovery, {
      cacheDir: reclaimedWriterCacheDir,
      url: "https://writer-a.registry.example/openclaw/current.json",
      publicKeys: registryKeyring,
      fetchImpl: async () => {
        writerAFetches += 1;
        return new Response(JSON.stringify(sequenceTwo), { status: 200 });
      },
      now: () => REGISTRY_NOW,
    });
    await writerAStalled;
    await utimes(`${reclaimedWriterCacheFile}.lock`, new Date(0), new Date(0));

    const reclaimedWriterB = await loadOpenClawCompatibility(beta5Discovery, {
      cacheDir: reclaimedWriterCacheDir,
      url: "https://writer-b.registry.example/openclaw/current.json",
      publicKeys: registryKeyring,
      fetchImpl: async () => {
        writerBFetches += 1;
        return new Response(JSON.stringify(highWaterBundle), { status: 200 });
      },
      now: () => REGISTRY_NOW,
    });
    assert.equal(writerAFetches, 1);
    assert.equal(writerBFetches, 1);
    assert.equal(reclaimedWriterB.mode, "structured");
    assert.equal(reclaimedWriterB.bundleSource, "remote");
    if (reclaimedWriterB.mode === "structured") {
      assert.equal(reclaimedWriterB.profile.source.blobSha, highWaterProfile.source.blobSha);
    }

    resumeWriterA?.();
    const reclaimedWriterAResult = await reclaimedWriterA;
    assert.equal(reclaimedWriterAResult.mode, "structured");
    assert.equal(reclaimedWriterAResult.bundleSource, "cache");
    if (reclaimedWriterAResult.mode === "structured") {
      assert.equal(
        reclaimedWriterAResult.profile.source.blobSha,
        highWaterProfile.source.blobSha,
        "a reclaimed writer returns the newer concurrently accepted bundle",
      );
    }
    const reclaimedCache = JSON.parse(await readFile(reclaimedWriterCacheFile, "utf8"));
    assert.equal(reclaimedCache.bundle.sequence, highWaterBundle.sequence, "the newer writer remains the final cache state");

    let finalRaceFetchCalled = false;
    const finalRaceLoad = await loadOpenClawCompatibility(beta5Discovery, {
      cacheDir: reclaimedWriterCacheDir,
      url: "https://final.registry.example/openclaw/current.json",
      publicKeys: registryKeyring,
      fetchImpl: async () => {
        finalRaceFetchCalled = true;
        throw new Error("the recovered cache should be fresh");
      },
      now: () => REGISTRY_NOW,
    });
    assert.equal(finalRaceFetchCalled, false);
    assert.equal(finalRaceLoad.mode, "structured");
    assert.equal(finalRaceLoad.bundleSource, "cache");
    if (finalRaceLoad.mode === "structured") {
      assert.equal(finalRaceLoad.profile.source.blobSha, highWaterProfile.source.blobSha);
    }
  } finally {
    resumeWriterA?.();
    await reclaimedWriterA?.catch(() => undefined);
    fs.promises.rename = originalRename;
    syncBuiltinESMExports();
  }

  const staleLockCacheDir = await makeCacheDir("stale-lock");
  await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: staleLockCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(sequenceTwo), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  const staleLockFile = `${cacheFile(staleLockCacheDir)}.lock`;
  await writeFile(staleLockFile, "stale-owner");
  await utimes(staleLockFile, new Date(0), new Date(0));
  const staleLockResult = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: staleLockCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(highWaterBundle), { status: 200 }),
    now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
  });
  assert.equal(staleLockResult.bundleSource, "remote", "a stale cache lock is reclaimed");

  const overfullJournalCacheDir = await makeCacheDir("overfull-journal");
  const journalDir = `${cacheFile(overfullJournalCacheDir)}.anchor.journal`;
  await mkdir(journalDir, { recursive: true });
  await Promise.all(Array.from({ length: 33 }, (_, index) =>
    writeFile(path.join(journalDir, `junk-${index}.json`), "{}")));
  let overfullFetched = false;
  const overfullJournal = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: overfullJournalCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => {
      overfullFetched = true;
      return new Response(JSON.stringify(sequenceTwo), { status: 200 });
    },
    now: () => REGISTRY_NOW,
  });
  assert.equal(overfullFetched, false, "the trust journal never enumerates beyond 32 entries");
  assert.equal(overfullJournal.mode, "plain");

  let credentialFetchCalled = false;
  const credentialUrl = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("credential-url"),
    url: "https://user:password@registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => {
      credentialFetchCalled = true;
      return new Response(JSON.stringify(sequenceTwo), { status: 200 });
    },
    now: () => REGISTRY_NOW,
  });
  assert.equal(credentialFetchCalled, false, "credential-bearing registry URLs are rejected before fetch");
  assert.equal(credentialUrl.bundleSource, "built-in");

  const redirectResponse = new Response(JSON.stringify(sequenceTwo), { status: 200 });
  Object.defineProperty(redirectResponse, "redirected", { value: true });
  const redirectResult = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("redirect"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => redirectResponse,
    now: () => REGISTRY_NOW,
  });
  assert.equal(redirectResult.bundleSource, "built-in", "redirected registry responses are rejected");

  const oversizedResult = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("oversized"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response("x".repeat(256 * 1024 + 1), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(oversizedResult.bundleSource, "built-in", "oversized registry bodies fail closed");

  const oversizedCacheDir = await makeCacheDir("oversized-cache");
  await writeFile(cacheFile(oversizedCacheDir), "x".repeat(512 * 1024 + 1));
  const oversizedCache = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: oversizedCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => { throw new Error("offline"); },
    now: () => REGISTRY_NOW,
  });
  assert.equal(oversizedCache.bundleSource, "built-in", "oversized cache records are ignored");

  const mismatchedGenesis = signBundle({
    ...structuredClone(BUILTIN_OPENCLAW_SCHEMA_BUNDLE),
    expiresAt: "2031-01-01T00:00:00.000Z",
  });
  assert.equal(
    verifyOpenClawSchemaBundle(mismatchedGenesis, registryPublicKey, REGISTRY_NOW),
    true,
    "the genesis mismatch fixture is independently well-signed",
  );
  const genesisMismatch = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("genesis-mismatch"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(mismatchedGenesis), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(genesisMismatch.bundleSource, "built-in", "sequence one must exactly match the shipped genesis payload");

  const collidingBeta6Profile = revisedProfile("6", {
    id: "openclaw-agent-tool-beta6",
    priority: beta5Profile.priority,
    serverVersion: "2026.7.2-beta.6",
  });
  const collisionCacheDir = await makeCacheDir("merged-priority-collision");
  const collision = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: collisionCacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(
      signedBundle(3, [collidingBeta6Profile]),
    ), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(collision.mode, "structured", "a remote priority collision cannot disable a safe built-in match");
  assert.equal(collision.bundleSource, "built-in", "a merged-set collision rejects the remote refresh");
  if (collision.mode === "structured") {
    assert.equal(collision.profile.id, beta5Profile.id);
  }

  const validBeta6Profile = revisedProfile("7", {
    id: "openclaw-agent-tool-beta6-valid",
    priority: beta5Profile.priority + 1,
    serverVersion: "2026.7.2-beta.6",
  });
  const validAfterCollision = await loadOpenClawCompatibility(
    { ...beta5Discovery, serverVersion: "2026.7.2-beta.6" },
    {
      cacheDir: collisionCacheDir,
      url: "https://registry.example/openclaw/current.json",
      publicKeys: registryKeyring,
      fetchImpl: async () => new Response(JSON.stringify(
        signedBundle(2, [validBeta6Profile]),
      ), { status: 200 }),
      now: () => REGISTRY_NOW + 7 * 60 * 60 * 1000,
    },
  );
  assert.equal(validAfterCollision.mode, "structured", "a rejected collision does not advance the trust high-water mark");
  assert.equal(validAfterCollision.bundleSource, "remote");
  if (validAfterCollision.mode === "structured") {
    assert.equal(validAfterCollision.profile.id, validBeta6Profile.id);
  }

  const retiredCollision = await loadOpenClawCompatibility(
    { ...beta5Discovery, serverVersion: "2026.7.2-beta.6" },
    {
      cacheDir: await makeCacheDir("retired-priority-collision"),
      url: "https://registry.example/openclaw/current.json",
      publicKeys: registryKeyring,
      fetchImpl: async () => new Response(JSON.stringify(
        signedBundle(2, [collidingBeta6Profile], {
          retiredProfileIds: [beta5Profile.id],
        }),
      ), { status: 200 }),
      now: () => REGISTRY_NOW,
    },
  );
  assert.equal(retiredCollision.mode, "structured", "retiring the colliding built-in releases its effective priority");
  assert.equal(retiredCollision.bundleSource, "remote");
  if (retiredCollision.mode === "structured") {
    assert.equal(retiredCollision.profile.id, collidingBeta6Profile.id);
  }

  const retiredBundle = signedBundle(2, [
    revisedProfile("f", {
      id: "openclaw-agent-tool-remote-v3",
      priority: 101,
      serverVersion: "2026.7.2-beta.6",
    }),
  ], {
    retiredProfileIds: [beta5Profile.id],
  });
  const retired = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("retired"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(retiredBundle), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(retired.mode, "plain", "a signed retirement prevents unsafe built-in revival");
  assert.equal(retired.diagnostic, "no-compatible-profile");

  clearOpenClawProfileQuarantineForTests();
  quarantineOpenClawProfile(beta5Profile);
  const quarantined = await loadOpenClawCompatibility(beta5Discovery);
  assert.equal(quarantined.mode, "plain");
  assert.equal(quarantined.diagnostic, "profile-quarantined");

  const repairedProfile = revisedProfile("1");
  const repaired = await loadOpenClawCompatibility(beta5Discovery, {
    cacheDir: await makeCacheDir("repaired"),
    url: "https://registry.example/openclaw/current.json",
    publicKeys: registryKeyring,
    fetchImpl: async () => new Response(JSON.stringify(signedBundle(2, [repairedProfile], {
      retiredProfileIds: [beta5Profile.id],
    })), { status: 200 }),
    now: () => REGISTRY_NOW,
  });
  assert.equal(repaired.mode, "structured", "a higher signed revision with the same profile ID recovers");
  assert.equal(repaired.profile.source.blobSha, repairedProfile.source.blobSha);
  clearOpenClawProfileQuarantineForTests();
} finally {
  clearOpenClawProfileQuarantineForTests();
  await rm(registryTestRoot, { recursive: true, force: true });
}

console.log("openclaw-compatibility: ok");
