import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

import {
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  parseOpenClawToolEvent,
  redactedOpenClawToolFingerprint,
  selectOpenClawToolProfile,
  validateOpenClawToolProfiles,
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

console.log("openclaw-compatibility: ok");
