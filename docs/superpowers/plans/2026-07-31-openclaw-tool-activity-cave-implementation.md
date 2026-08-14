# OpenClaw Tool-Activity Cave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signed, refreshable OpenClaw tool-event compatibility and project validated Gateway tool lifecycle into Cave chat, persistence, and resume.

**Architecture:** Cave upgrades to the official OpenClaw beta.5 Gateway packages, discovers the authenticated server contract without advertising `tool-events`, resolves a signed data-only profile, then reconnects with the capability before dispatch. The existing Gateway run correlation remains authoritative; a dedicated compatibility module validates outer `AgentEventSchema` frames plus bounded tool data, while `ToolCallTracker` handles SSE and persistence.

**Tech Stack:** TypeScript, Node.js 24, `@openclaw/gateway-client`, `@openclaw/gateway-protocol`, TypeBox validators, Ed25519 signatures, atomic JSON cache, Next.js route SSE, Node assertion tests.

---

## File Map

- Create `src/lib/openclaw-compatibility.ts`: profile types, official schema hash, signed-bundle verification, cache/rollback protection, profile selection, quarantine, and bounded tool parser.
- Create `src/lib/openclaw-compatibility.test.ts`: registry, profile, parser, fingerprint, cache, rollback, and quarantine conformance.
- Create `src/lib/openclaw-fixtures/gateway-beta4.json`: exact beta.4 discovery fixture.
- Create `src/lib/openclaw-fixtures/gateway-beta5.json`: exact beta.5 discovery fixture.
- Create `src/lib/openclaw-fixtures/tool-lifecycle-v1.json`: source-verified start/update/result/error frames.
- Modify `src/lib/openclaw-gateway.ts`: two-phase discovery/dispatch, capability negotiation, `agent`/`session.tool` validation, and normalized tool events.
- Modify `src/lib/openclaw-gateway.test.ts`: authenticated discovery, reconnect, correlation, lifecycle, replay, gap, cancellation, and quarantine coverage.
- Modify `src/app/api/chat/send/route.ts`: feed normalized OpenClaw tool lifecycle through `ToolCallTracker`, emit notices, settle cards, and persist tools.
- Modify `src/app/api/chat/send/harness-routing-tool-events.test.ts`: route source-contract assertions for OpenClaw tracking and persistence.
- Modify `src/lib/openclaw-conversation.ts`: correlate assistant tool-use blocks and tool-role results in JSONL fallback history.
- Modify `src/lib/openclaw-conversation.test.ts` and `src/lib/openclaw-conversation-tools.test.ts`: JSONL resume and backward-compatibility coverage.
- Modify `src/lib/openclaw-bridge.ts` and `src/lib/openclaw-bridge.test.ts`: advertise bridge support for negotiated streaming/tool events.
- Modify `package.json` and `pnpm-lock.yaml`: pin official OpenClaw beta.5 packages.
- Modify `scripts/run-tests.mjs`: wire the compatibility test and release guard test.
- Create `scripts/check-openclaw-registry-release.mjs`: release-time public trust-anchor validation.
- Create `scripts/check-openclaw-registry-release.test.mjs`: guard and secret-redaction tests.
- Create `docs/openclaw-compatibility-registry.md`: publisher, canonicalization, rotation, checkpoint, and release handoff.
- Modify `.github/workflows/release.yml`: require and export OpenClaw registry URL/keyring/checkpoint.
- Modify `docs/specs/2026-07-25-openclaw-gateway-dispatch-plan.md`: replace the “wait for upstream schema” boundary with the signed-profile implementation.

### Task 1: Pin beta.5 and capture official compatibility fixtures

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/lib/openclaw-fixtures/gateway-beta4.json`
- Create: `src/lib/openclaw-fixtures/gateway-beta5.json`
- Create: `src/lib/openclaw-fixtures/tool-lifecycle-v1.json`
- Test: `src/lib/openclaw-compatibility.test.ts`

- [ ] **Step 1: Write the failing package/fixture conformance test**

Create `src/lib/openclaw-compatibility.test.ts` with the initial assertions:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AgentEventSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";
import {
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  openClawDiscoveryFromHello,
} from "./openclaw-compatibility.ts";

const beta4 = JSON.parse(
  await readFile(new URL("./openclaw-fixtures/gateway-beta4.json", import.meta.url), "utf8"),
);
const beta5 = JSON.parse(
  await readFile(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const lifecycle = JSON.parse(
  await readFile(new URL("./openclaw-fixtures/tool-lifecycle-v1.json", import.meta.url), "utf8"),
);

assert.equal(OPENCLAW_AGENT_EVENT_SCHEMA_HASH, "ed68832d5ecbc52de7ad5394933cb2a0df7b0f0b6f7a880127f688becbd76bd2");
assert.equal(openClawDiscoveryFromHello(beta4).serverVersion, "2026.7.2-beta.4");
assert.equal(openClawDiscoveryFromHello(beta5).serverVersion, "2026.7.2-beta.5");
for (const frame of lifecycle.frames) {
  assert.equal(Value.Check(AgentEventSchema, frame.payload), true);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: FAIL because `openclaw-compatibility.ts` and the fixtures do not exist.

- [ ] **Step 3: Add exact source-verified fixtures**

Create `gateway-beta4.json` and `gateway-beta5.json` as full valid
`HelloOkSchema` payloads. beta.4 must advertise chat-only behavior; beta.5 must
advertise the tool event families and capability:

```json
{
  "type": "hello-ok",
  "protocol": 4,
  "server": { "version": "2026.7.2-beta.5", "connId": "fixture-beta5" },
  "features": {
    "methods": ["chat.send", "chat.abort", "sessions.messages.subscribe"],
    "events": ["chat", "agent", "session.tool"],
    "capabilities": ["chat-send-routing-contract"]
  },
  "snapshot": {
    "presence": [],
    "health": {},
    "stateVersion": { "presence": 0, "health": 0 },
    "uptimeMs": 0
  },
  "auth": {
    "role": "operator",
    "scopes": ["operator.read", "operator.write"]
  },
  "policy": {
    "maxPayload": 26214400,
    "maxBufferedBytes": 52428800,
    "tickIntervalMs": 15000
  }
}
```

Create `tool-lifecycle-v1.json` with exact upstream field shapes:

```json
{
  "source": {
    "repo": "openclaw/openclaw",
    "paths": [
      "src/gateway/server-chat.ts",
      "src/gateway/server-chat.agent-events.test.ts",
      "ui/src/pages/activity/tool-activity.ts"
    ]
  },
  "frames": [
    {
      "event": "agent",
      "payload": {
        "runId": "run-1",
        "seq": 3,
        "stream": "tool",
        "ts": 1000,
        "data": {
          "phase": "start",
          "toolCallId": "tool-1",
          "name": "exec",
          "args": { "command": "echo hi" }
        }
      }
    },
    {
      "event": "agent",
      "payload": {
        "runId": "run-1",
        "seq": 7,
        "stream": "tool",
        "ts": 1100,
        "data": {
          "phase": "update",
          "toolCallId": "tool-1",
          "name": "exec",
          "partialResult": "hi"
        }
      }
    },
    {
      "event": "agent",
      "payload": {
        "runId": "run-1",
        "seq": 9,
        "stream": "tool",
        "ts": 1200,
        "data": {
          "phase": "result",
          "toolCallId": "tool-1",
          "name": "exec",
          "result": { "text": "hi", "exitCode": 0 },
          "isError": false
        }
      }
    },
    {
      "event": "session.tool",
      "payload": {
        "runId": "run-2",
        "seq": 5,
        "stream": "tool",
        "ts": 1300,
        "data": {
          "phase": "result",
          "toolCallId": "tool-2",
          "name": "edit",
          "result": { "status": "failed", "text": "validation failed" },
          "isError": true
        }
      }
    }
  ]
}
```

- [ ] **Step 4: Upgrade the official packages**

Run:

```bash
pnpm add --save-exact @openclaw/gateway-client@2026.7.2-beta.5 @openclaw/gateway-protocol@2026.7.2-beta.5
```

Expected: `package.json` and `pnpm-lock.yaml` pin beta.5 with no other
dependency changes.

- [ ] **Step 5: Implement the minimal discovery/hash exports**

Start `src/lib/openclaw-compatibility.ts` with:

```ts
import { createHash } from "node:crypto";
import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export const OPENCLAW_AGENT_EVENT_SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify(canonicalize(AgentEventSchema)))
  .digest("hex");

export type OpenClawGatewayDiscovery = {
  serverVersion: string;
  protocol: number;
  methods: string[];
  events: string[];
  serverCapabilities: string[];
  agentEventSchemaHash: string;
};

export function openClawDiscoveryFromHello(value: unknown): OpenClawGatewayDiscovery {
  if (!Value.Check(HelloOkSchema, value)) throw new TypeError("invalid OpenClaw hello");
  return {
    serverVersion: value.server.version,
    protocol: value.protocol,
    methods: [...value.features.methods],
    events: [...value.features.events],
    serverCapabilities: [...(value.features.capabilities ?? [])],
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  };
}
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: PASS for fixture loading, official outer-schema validation, and the
beta.4/beta.5 schema hash.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/openclaw-compatibility.ts src/lib/openclaw-compatibility.test.ts src/lib/openclaw-fixtures
git commit -S -m "test(openclaw): pin gateway compatibility fixtures" \
  -m "Co-authored-by: Timothy Wayne Gregg <5861166+CompleteDotTech@users.noreply.github.com>"
```

### Task 2: Implement bounded profile selection and tool parsing

**Files:**
- Modify: `src/lib/openclaw-compatibility.ts`
- Modify: `src/lib/openclaw-compatibility.test.ts`

- [ ] **Step 1: Add failing profile-selection and parser tests**

Append tests that define a sequence-one profile and assert strict selection:

```ts
const profile = {
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
  phases: { start: ["start"], update: ["update"], result: ["result"] },
  fields: {
    phase: ["phase"],
    id: ["toolCallId"],
    name: ["name"],
    input: ["args"],
    progress: ["partialResult"],
    output: ["result"],
    error: ["isError"],
    status: ["status"],
    exitCode: ["exitCode"],
    errorStates: ["error", "failed", "failure"],
  },
  source: {
    repo: "openclaw/openclaw",
    package: "@openclaw/gateway-protocol@2026.7.2-beta.5",
    blobSha: "d66b514a7e7565d89c87ab6f1a509623128093f0",
  },
};

assert.equal(selectOpenClawToolProfile([profile], openClawDiscoveryFromHello(beta5))?.id, profile.id);
assert.equal(selectOpenClawToolProfile([profile], openClawDiscoveryFromHello(beta4)), undefined);

const [start, update, result, failure] = lifecycle.frames;
assert.deepEqual(parseOpenClawToolEvent(start.event, start.payload, profile), {
  kind: "tool_start",
  id: "tool-1",
  name: "exec",
  input: { command: "echo hi" },
  seq: 3,
});
assert.deepEqual(parseOpenClawToolEvent(update.event, update.payload, profile), {
  kind: "tool_progress",
  id: "tool-1",
  output: "hi",
  seq: 7,
});
assert.deepEqual(parseOpenClawToolEvent(result.event, result.payload, profile), {
  kind: "tool_end",
  id: "tool-1",
  name: "exec",
  output: { text: "hi", exitCode: 0 },
  isError: false,
  seq: 9,
});
assert.equal(parseOpenClawToolEvent("unknown.event", start.payload, profile).kind, "unknown");
assert.equal(parseOpenClawToolEvent("agent", { ...start.payload, stream: "future" }, profile).kind, "unknown");
assert.equal(parseOpenClawToolEvent("agent", { ...start.payload, data: { ...start.payload.data, phase: "future" } }, profile).kind, "unknown");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: FAIL because profile types, selector, and parser are missing.

- [ ] **Step 3: Add the closed data-only profile contract**

Add these public types:

```ts
export type OpenClawToolProfile = {
  id: string;
  priority?: number;
  requires: {
    serverVersions: string[];
    protocol: number;
    agentEventSchemaHash: string;
    methods: string[];
    events: string[];
    serverCapabilities: string[];
    clientCapabilities: ["tool-events"];
  };
  eventNames: Array<"agent" | "session.tool">;
  streams: ["tool"];
  phases: { start: string[]; update: string[]; result: string[] };
  fields: {
    phase: string[];
    id: string[];
    name: string[];
    input: string[];
    progress: string[];
    output: string[];
    error: string[];
    status: string[];
    exitCode: string[];
    errorStates: string[];
  };
  source: { repo: "openclaw/openclaw"; package: string; blobSha: string };
};

export type OpenClawParsedToolEvent =
  | { kind: "tool_start"; id: string; name: string; input: unknown; seq: number }
  | { kind: "tool_progress"; id: string; output: unknown; seq: number }
  | { kind: "tool_end"; id: string; name: string; output: unknown; isError: boolean; seq: number }
  | { kind: "unknown"; fingerprint: string };
```

Validate every object key against a closed allowlist. Bound profiles to 32,
every alias array to 16 entries, strings to 256 bytes, and source SHA to 40 or
64 lowercase hex characters. Permit only the two event names, `tool` stream,
and `tool-events` client capability.

- [ ] **Step 4: Implement deterministic selection**

```ts
export function selectOpenClawToolProfile(
  profiles: readonly OpenClawToolProfile[],
  discovery: OpenClawGatewayDiscovery,
): OpenClawToolProfile | undefined {
  return profiles
    .filter((profile) =>
      profile.requires.serverVersions.includes(discovery.serverVersion)
      && profile.requires.protocol === discovery.protocol
      && profile.requires.agentEventSchemaHash === discovery.agentEventSchemaHash
      && profile.requires.methods.every((value) => discovery.methods.includes(value))
      && profile.requires.events.every((value) => discovery.events.includes(value))
      && profile.requires.serverCapabilities.every((value) =>
        discovery.serverCapabilities.includes(value),
      ),
    )
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))[0];
}
```

Reject duplicate profile IDs and duplicate priorities during bundle validation
so selection never depends on input order.

- [ ] **Step 5: Implement the bounded parser and fingerprint**

Validate the outer payload with `Value.Check(AgentEventSchema, payload)`.
Read only direct aliases from `payload.data`; never interpret nested registry
paths. Require non-empty ID/name on start/result and ID on update. Resolve
errors from explicit booleans, selected status strings, and non-zero exit code.

Use a value-free fingerprint:

```ts
export function redactedOpenClawToolFingerprint(value: unknown): string {
  const safeKeys = new Set([
    "runId", "seq", "stream", "ts", "phase", "toolCallId", "name",
    "status", "isError", "exitCode",
  ]);
  const shape = (input: unknown, depth = 0): unknown => {
    if (depth >= 3) return Array.isArray(input) ? "array" : typeof input;
    if (Array.isArray(input)) return input.length ? [shape(input[0], depth + 1)] : ["empty"];
    if (!input || typeof input !== "object") return typeof input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => safeKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, shape(child, depth + 1)]),
    );
  };
  return createHash("sha256").update(JSON.stringify(shape(value))).digest("hex").slice(0, 16);
}
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: PASS for beta.5 selection and all four lifecycle fixtures; beta.4,
unknown event names, streams, and phases stay unsupported.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openclaw-compatibility.ts src/lib/openclaw-compatibility.test.ts
git commit -S -m "feat(openclaw): validate signed tool profiles"
```

### Task 3: Add signed registry cache, rollback protection, and quarantine

**Files:**
- Modify: `src/lib/openclaw-compatibility.ts`
- Modify: `src/lib/openclaw-compatibility.test.ts`

- [ ] **Step 1: Write failing trust/cache tests**

Use `generateKeyPairSync("ed25519")`, a temporary cache directory, and an
injected `fetchImpl`. Cover:

```ts
assert.equal(verifyOpenClawSchemaBundle(signedBundle, publicKeyPem, NOW), true);
assert.equal(verifyOpenClawSchemaBundle({ ...signedBundle, sequence: 0 }, publicKeyPem, NOW), false);
assert.equal(verifyOpenClawSchemaBundle(tamperedBundle, publicKeyPem, NOW), false);
assert.equal(
  await loadOpenClawCompatibility(discovery, {
    cacheDir,
    url: "https://registry.example/openclaw/current.json",
    publicKeys: { "openclaw-2026": publicKeyPem },
    checkpoint: { sequence: 1, payloadHash: openClawSchemaBundlePayloadHash(signedBundle) },
    fetchImpl,
    now: () => NOW,
  }).then((value) => value.mode),
  "structured",
);
```

Also assert:

- lower sequence rejection;
- equal-sequence payload rewrite rejection;
- checkpoint mismatch rejection;
- corrupted cache fallback to the built-in profile;
- expired remote-only profile disables structured mode;
- one in-flight refresh for concurrent callers;
- stale lock reclamation;
- profile quarantine returns `profile-quarantined`;
- a higher signed profile revision with the same ID is selectable.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: FAIL because bundle verification, cache, and quarantine APIs are
missing.

- [ ] **Step 3: Add bundle and resolution types**

```ts
export type OpenClawSchemaBundle = {
  format: 1;
  runtime: "openclaw";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  keyId?: string;
  retiredProfileIds?: string[];
  profiles: OpenClawToolProfile[];
  signature?: { algorithm: "ed25519"; value: string };
};

export type OpenClawRegistryCheckpoint = { sequence: number; payloadHash: string };
export type OpenClawRegistryKeyring = Record<string, string>;

export type OpenClawCompatibilityDiagnostic =
  | "capability-probe-unavailable"
  | "no-compatible-profile"
  | "profile-registry-refresh-rejected"
  | "cached-profile-unavailable"
  | "profile-quarantined";

export type OpenClawCompatibility =
  | {
      mode: "structured";
      discovery: OpenClawGatewayDiscovery;
      profile: OpenClawToolProfile;
      bundleSource: "built-in" | "cache" | "remote";
    }
  | {
      mode: "plain";
      discovery: OpenClawGatewayDiscovery;
      bundleSource: "built-in" | "cache" | "remote";
      diagnostic: OpenClawCompatibilityDiagnostic;
    };

export type OpenClawCompatibilitySource = {
  cacheDir?: string;
  url?: string;
  publicKeys?: OpenClawRegistryKeyring;
  checkpoint?: OpenClawRegistryCheckpoint;
  fetchImpl?: typeof fetch;
  now?: () => number;
};
```

- [ ] **Step 4: Implement canonical signing and genesis**

Use sorted-key recursive JSON canonicalization identical to OpenCode/Grok.
`BUILTIN_OPENCLAW_SCHEMA_BUNDLE` is the unsigned, source-trusted representation
of sequence one and contains the beta.5 profile from Task 2. The remote
sequence-one signing payload must exactly equal the built-in signing payload.

Export:

```ts
export function openClawSchemaBundleSigningPayload(bundle: OpenClawSchemaBundle): string;
export function openClawSchemaBundlePayloadHash(bundle: OpenClawSchemaBundle): string;
export function verifyOpenClawSchemaBundle(
  value: unknown,
  publicKeys: string | OpenClawRegistryKeyring,
  now?: number,
  options?: { allowExpired?: boolean },
): value is OpenClawSchemaBundle;
```

- [ ] **Step 5: Implement bounded cache and trust anchors**

Follow these exact constants:

```ts
const MAX_BUNDLE_BYTES = 256 * 1024;
const MAX_CACHE_BYTES = 512 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 5_000;
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 500;
const CACHE_LOCK_POLL_MS = 20;
const MAX_TRUST_ANCHORS = 16;
const CACHE_FILE = "openclaw-schema-bundle-v1.json";
```

Store cache under the same Cave compatibility cache root used by OpenCode/Grok.
Write with `writeJsonAtomic`, persist signer ID and fetched time, and journal
verified `(sequence, payloadHash)` anchors. Never enumerate more than 32
journal directory entries.

- [ ] **Step 6: Implement production/dev trust-source precedence**

Read immutable production values:

```ts
const PACKAGED_URL = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL;
const PACKAGED_PUBLIC_KEY = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY;
const PACKAGED_PUBLIC_KEYS = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS;
const PACKAGED_CHECKPOINT = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT;
```

Allow mutable `COVEN_OPENCLAW_*` values only outside production. Export an
injectable `loadOpenClawCompatibility(discovery, source?)` for tests and
Gateway use.

- [ ] **Step 7: Implement bounded revision quarantine**

Hash the canonical profile object. Keep at most 64 profile IDs in insertion
order:

```ts
export function quarantineOpenClawProfile(profile: OpenClawToolProfile): void;
export function clearOpenClawProfileQuarantineForTests(): void;
```

Only the exact quarantined revision is disabled; a signed changed revision can
recover.

- [ ] **Step 8: Run the focused test**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
```

Expected: PASS for signatures, rollback protection, cache use, refresh,
checkpointing, and quarantine.

- [ ] **Step 9: Commit**

```bash
git add src/lib/openclaw-compatibility.ts src/lib/openclaw-compatibility.test.ts
git commit -S -m "feat(openclaw): add signed compatibility registry"
```

### Task 4: Refactor Gateway dispatch into discovery and capability-enabled transport

**Files:**
- Modify: `src/lib/openclaw-gateway.ts`
- Modify: `src/lib/openclaw-gateway.test.ts`

- [ ] **Step 1: Write failing two-phase negotiation tests**

Add a client factory that records two constructed clients. Assert:

```ts
assert.equal(createdOptions[0].caps, undefined);
assert.deepEqual(createdOptions[1].caps, ["tool-events"]);
assert.equal(requests[0].method, "sessions.messages.subscribe");
assert.equal(requests.find((entry) => entry.method === "chat.send")?.clientIndex, 1);
```

Cover these failures before `chat.send`:

- beta.4 has no compatible tool profile;
- beta.5 hello changes to another version on the second connection;
- second hello removes `agent` or `session.tool`;
- second hello removes required scopes/methods/capabilities;
- registry refresh fails with no usable built-in/cache;
- credential-store failure.

Every case must return `{ kind: "unavailable" }` and leave CLI fallback safe.

- [ ] **Step 2: Run the Gateway test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-gateway.test.ts
```

Expected: FAIL because the dispatcher constructs one chat-only client.

- [ ] **Step 3: Extend Gateway event and dispatch types**

```ts
export type OpenClawGatewayEvent =
  | OpenClawGatewayChatEvent
  | { kind: "tool_start"; id: string; name: string; input: unknown; seq: number }
  | { kind: "tool_progress"; id: string; output: unknown; seq: number }
  | { kind: "tool_end"; id: string; name: string; output: unknown; isError: boolean; seq: number }
  | {
      kind: "compatibility";
      code: OpenClawCompatibilityDiagnostic | "unknown-tool-event";
      fingerprint?: string;
    };
```

Change `onEvent` to receive `OpenClawGatewayEvent`. Add an injectable
`compatibilitySource` argument forwarded to `loadOpenClawCompatibility`.

- [ ] **Step 4: Extract an authenticated connection helper**

Create a private helper that:

- receives optional `caps`;
- creates a client with the existing keychain-backed `hostDeps`;
- validates `HelloOkSchema`, role/scopes, methods, chat routing capability,
  and `chat`;
- returns `{ client, hello, stop }`;
- never receives Gateway process secrets;
- stops on timeout or invalid hello.

Keep `chat.send` outside this helper so discovery cannot dispatch.

- [ ] **Step 5: Implement the two phases**

Pseudocode must be realized exactly:

```ts
const discoveryConnection = await connect({ caps: undefined });
const discovery = openClawDiscoveryFromHello(discoveryConnection.hello);
const compatibility = await loadOpenClawCompatibility(discovery, args.compatibilitySource);
discoveryConnection.stop();

if (compatibility.mode !== "structured") {
  return {
    kind: "unavailable",
    reason: `OpenClaw tool compatibility: ${compatibility.diagnostic}`,
  };
}

const dispatchConnection = await connect({
  caps: compatibility.profile.requires.clientCapabilities,
});
const dispatchDiscovery = openClawDiscoveryFromHello(dispatchConnection.hello);
if (!sameOpenClawDiscovery(discovery, dispatchDiscovery)) {
  dispatchConnection.stop();
  return { kind: "unavailable", reason: "OpenClaw Gateway changed during compatibility negotiation" };
}
```

Implement `sameOpenClawDiscovery` as an exact comparison of server version,
protocol, official outer-schema hash, and sorted method/event/capability sets:

```ts
function sameOpenClawDiscovery(
  left: OpenClawGatewayDiscovery,
  right: OpenClawGatewayDiscovery,
): boolean {
  const sorted = (values: string[]) => [...values].sort();
  return left.serverVersion === right.serverVersion
    && left.protocol === right.protocol
    && left.agentEventSchemaHash === right.agentEventSchemaHash
    && JSON.stringify(sorted(left.methods)) === JSON.stringify(sorted(right.methods))
    && JSON.stringify(sorted(left.events)) === JSON.stringify(sorted(right.events))
    && JSON.stringify(sorted(left.serverCapabilities))
      === JSON.stringify(sorted(right.serverCapabilities));
}
```

The second connection owns subscription, `chat.send`, reconnect, abort, and
close.

- [ ] **Step 6: Preserve acknowledgement and reconnect fences**

Retain:

- stable Cave idempotency key;
- `onSent` indeterminate acknowledgement behavior;
- exact accepted run ID;
- subscription before `chat.send`;
- no CLI fallback after possible dispatch;
- cancellation settlement before `chat.abort`;
- transport generation invalidation on close;
- reconnect subscription restoration before accepting frames.

- [ ] **Step 7: Run Gateway tests**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-gateway.test.ts
```

Expected: PASS for old chat correlation tests plus new discovery/reconnect
tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/openclaw-gateway.ts src/lib/openclaw-gateway.test.ts
git commit -S -m "feat(openclaw): negotiate tool-event compatibility"
```

### Task 5: Project validated `agent` and `session.tool` lifecycle

**Files:**
- Modify: `src/lib/openclaw-gateway.ts`
- Modify: `src/lib/openclaw-gateway.test.ts`

- [ ] **Step 1: Add failing lifecycle/correlation tests**

Drive the second client's `onEvent` with:

- matching `agent` start/update/result;
- matching `session.tool` result;
- foreign run;
- foreign agent/session;
- duplicate event;
- lower `AgentEvent.seq`;
- sparse forward tool sequence;
- malformed data;
- transport `onGap`;
- close/reconnect with an unfinished tool.

Assert sparse `3 -> 7 -> 9` tool sequence is accepted, while duplicate/lower
sequence is ignored. Assert malformed data emits one compatibility event,
quarantines the profile, and validated chat deltas/final still complete.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-gateway.test.ts
```

Expected: FAIL because `onEvent` handles only `chat`.

- [ ] **Step 3: Add exact tool correlation**

For `agent` and `session.tool`:

1. Validate and parse with the selected profile.
2. Require payload `runId === expectedRunId`.
3. For session-scoped frames, require matching `sessionKey` and `agentId` when
   those snapshot fields are present.
4. Deduplicate by `${runId}:${seq}:${toolCallId}:${kind}`.
5. Track the highest tool sequence and ignore equal/lower values; do not
   require adjacency.

- [ ] **Step 4: Fail closed on incompatible tool data**

On `unknown`:

```ts
quarantineOpenClawProfile(compatibility.profile);
args.onEvent({
  kind: "compatibility",
  code: "unknown-tool-event",
  fingerprint: parsed.fingerprint,
});
toolProjectionEnabled = false;
```

Do not stop chat processing. Ignore subsequent tool frames for the turn.

- [ ] **Step 5: Settle unfinished tools on transport uncertainty**

The Gateway layer cannot construct Cave cards itself, so emit a compatibility
event for `tool-event-reconnect-gap` or `tool-event-sequence-gap`. The route
will settle open tracker calls. Continue assistant chat only when the chat
stream remains valid; preserve the existing terminal error for an actual chat
sequence gap.

- [ ] **Step 6: Run Gateway tests**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-gateway.test.ts
```

Expected: PASS for lifecycle, sparse sequence, foreign-run rejection,
quarantine, and reconnect behavior.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openclaw-gateway.ts src/lib/openclaw-gateway.test.ts
git commit -S -m "feat(openclaw): project correlated tool lifecycle"
```

### Task 6: Emit SSE cards and persist Gateway tools

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Modify: `src/app/api/chat/send/harness-routing-tool-events.test.ts`
- Test: `src/lib/chat-tool-events.test.ts`

- [ ] **Step 1: Add failing route source-contract assertions**

Append assertions requiring:

```ts
assert.match(
  chatRoute,
  /const gatewayToolTracker = new ToolCallTracker\(/,
);
assert.match(
  chatRoute,
  /event\.kind === "tool_start"[\s\S]*?gatewayToolTracker\.envelopeToolUse\(/,
);
assert.match(
  chatRoute,
  /event\.kind === "tool_progress"[\s\S]*?gatewayToolTracker\.envelopeToolProgress\(/,
);
assert.match(
  chatRoute,
  /event\.kind === "tool_end"[\s\S]*?gatewayToolTracker\.envelopeToolResult\(/,
);
assert.match(
  chatRoute,
  /tools: toPersistedTools\(gatewayToolTracker\.snapshot\(\)/,
);
assert.match(
  chatRoute,
  /OpenClaw tool activity needs an update[\s\S]*?status: "notice"/,
);
```

- [ ] **Step 2: Run the route contract test to verify it fails**

Run:

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing-tool-events.test.ts
```

Expected: FAIL because Gateway tool events are not tracked.

- [ ] **Step 3: Add a Gateway tracker beside assistant text state**

Import `ToolCallTracker`, `formatToolInputValue`, and `toPersistedTools`.

```ts
const gatewayToolTracker = new ToolCallTracker(Date.now, "openclaw:");
let gatewayToolProjectionEnabled = true;
let gatewayCompatibilityDiagnosticSent = false;
```

- [ ] **Step 4: Map normalized Gateway events**

In `onEvent`:

```ts
if (event.kind === "tool_start" && gatewayToolProjectionEnabled) {
  const tool = gatewayToolTracker.envelopeToolUse(
    event.id,
    event.name,
    formatToolInputValue(event.input),
    gatewayAssistantText.length,
  );
  if (tool) push({ kind: "tool_use", ...tool });
  return;
}
if (event.kind === "tool_progress" && gatewayToolProjectionEnabled) {
  const tool = gatewayToolTracker.envelopeToolProgress(
    event.id,
    formatToolInputValue(event.output),
  );
  if (tool) push({ kind: "tool_use", ...tool });
  return;
}
if (event.kind === "tool_end" && gatewayToolProjectionEnabled) {
  const tool = gatewayToolTracker.envelopeToolResult(
    event.id,
    formatToolInputValue(event.output),
    event.isError,
  );
  if (tool) push({ kind: "tool_use", ...tool });
  return;
}
```

On compatibility diagnostics, disable tool projection, settle open cards with
`failOpenCalls("[OpenClaw tool activity became incompatible]")`, and emit one
neutral progress notice:

```ts
pushProgress(
  "openclaw-tool-compatibility",
  "OpenClaw tool activity needs an update",
  "notice",
  `${event.code}${event.fingerprint ? ` (${event.fingerprint})` : ""}`,
);
```

- [ ] **Step 5: Fence cancellation and terminal uncertainty**

Before/while calling `gatewayDispatch.abort()`, settle all open calls with
`"[tool cancelled by user]"`. On terminal Gateway error or unfinished tool
calls, settle with `"[tool did not settle before the Gateway turn ended]"`.
Push every settlement so live cards stop spinning.

- [ ] **Step 6: Persist the final tool snapshot**

Add:

```ts
const persistedGatewayTools = toPersistedTools(
  gatewayToolTracker.snapshot(),
  gatewayAssistantText.length - gatewayAssistantText.trimStart().length,
);
```

Set `tools: persistedGatewayTools` on the saved assistant turn only when
defined. Preserve `cancelled`, `isError`, response metadata, work branch, and
first-turn-stub behavior.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing-tool-events.test.ts
node --experimental-strip-types src/lib/chat-tool-events.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/send/route.ts src/app/api/chat/send/harness-routing-tool-events.test.ts
git commit -S -m "feat(chat): persist OpenClaw Gateway tool activity"
```

### Task 7: Preserve OpenClaw JSONL fallback resume

**Files:**
- Modify: `src/lib/openclaw-conversation.ts`
- Modify: `src/lib/openclaw-conversation.test.ts`
- Modify: `src/lib/openclaw-conversation-tools.test.ts`

- [ ] **Step 1: Write a failing JSONL correlation test**

Extend the fixture with an assistant tool-use block and matching tool result:

```ts
{
  type: "message",
  id: "a-tool",
  parentId: "u1",
  timestamp: "2026-06-08T06:00:02.000Z",
  message: {
    role: "assistant",
    content: [
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "call-1", name: "exec", input: { command: "pwd" } }
    ]
  }
}
{
  type: "message",
  id: "tool-result",
  parentId: "a-tool",
  timestamp: "2026-06-08T06:00:03.000Z",
  message: {
    role: "tool",
    tool_call_id: "call-1",
    name: "exec",
    content: [{ type: "text", text: "/repo" }],
    status: "ok"
  }
}
```

Assert the assistant turn contains one tool with stable ID, formatted input,
output, `ok`, and duration.

- [ ] **Step 2: Run the conversation test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-conversation.test.ts
```

Expected: FAIL because assistant tool-use blocks are ignored.

- [ ] **Step 3: Parse assistant tool-use blocks**

When reading assistant content, retain text blocks and collect blocks whose
type is `tool_use`, `tool_call`, or `function_call`. Require a string ID and
name. Create running tool records with `formatToolInputValue(input)`.

- [ ] **Step 4: Reconcile tool-role results**

Maintain a bounded `Map<string, { turn: ChatTurn; startedAt: number }>` for at
most 512 open IDs. A tool-role message settles the exact ID; if no start exists,
retain the current backward-compatible behavior of attaching a result-only
tool to the preceding assistant turn. Never correlate by tool name.

- [ ] **Step 5: Coerce unfinished history safely**

Before returning, convert any remaining running tool to `error` with
`"[tool did not settle before the saved OpenClaw session ended]"`. A reloaded
conversation must never display a permanent spinner.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-conversation.test.ts
node --experimental-strip-types src/lib/openclaw-conversation-tools.test.ts
```

Expected: PASS for stable ID correlation, result-only legacy records, and path
traversal guards.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openclaw-conversation.ts src/lib/openclaw-conversation.test.ts src/lib/openclaw-conversation-tools.test.ts
git commit -S -m "fix(openclaw): preserve tool activity on resume"
```

### Task 8: Advertise negotiated bridge capability and wire tests

**Files:**
- Modify: `src/lib/openclaw-bridge.ts`
- Modify: `src/lib/openclaw-bridge.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing capability assertion**

Change the expected bridge capabilities:

```ts
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
```

Add a source assertion explaining these booleans mean the bridge supports
negotiation, not that every installed runtime qualifies.

- [ ] **Step 2: Run the bridge test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-bridge.test.ts
```

Expected: FAIL with `false !== true`.

- [ ] **Step 3: Update the capability contract**

Return `streaming: true` and `toolEvents: true`. Add a concise type comment:

```ts
/** Bridge implementation support. Runtime activation remains compatibility-negotiated. */
```

- [ ] **Step 4: Wire the new test**

Add `src/lib/openclaw-compatibility.test.ts` immediately before
`src/lib/openclaw-gateway.test.ts` in the API test list.

- [ ] **Step 5: Run focused and wiring tests**

Run:

```bash
node --experimental-strip-types src/lib/openclaw-bridge.test.ts
pnpm check:tests-wired
```

Expected: PASS and the wired-test count increases by two after Task 9 adds the
release guard test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/openclaw-bridge.ts src/lib/openclaw-bridge.test.ts scripts/run-tests.mjs
git commit -S -m "feat(openclaw): advertise negotiated tool support"
```

### Task 9: Add release trust-anchor guard and registry documentation

**Files:**
- Create: `scripts/check-openclaw-registry-release.mjs`
- Create: `scripts/check-openclaw-registry-release.test.mjs`
- Create: `docs/openclaw-compatibility-registry.md`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/run-tests.mjs`
- Modify: `docs/specs/2026-07-25-openclaw-gateway-dispatch-plan.md`

- [ ] **Step 1: Write the failing release guard test**

Copy the OpenCode test structure but use OpenClaw names:

```ts
assert.match(
  workflow,
  /Require signed OpenClaw compatibility registry[\s\S]*?NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL[\s\S]*?check-openclaw-registry-release\.mjs/,
);
assert.match(workflow, /NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS/);
assert.match(workflow, /NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT/);
assert.match(docs, /Signature canonicalization \(format 1\)/);
assert.match(docs, /openclaw\/current\.json/);
```

Spawn the guard with
`https://publisher:publisher-token-must-not-leak@registry.example/openclaw.json`
and assert failure stderr contains “without credentials” but not the secret.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node scripts/check-openclaw-registry-release.test.mjs
```

Expected: FAIL because the guard, workflow block, and docs do not exist.

- [ ] **Step 3: Implement the release guard**

Use the same closed validation as OpenCode/Grok:

```js
const url = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL;
const publicKey = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY;
const publicKeys = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS;
const checkpoint = process.env.NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT;
```

Require HTTPS without userinfo, one to four named Ed25519 keys, and a checkpoint
object with exactly two members: a positive safe-integer `sequence` and a
`payloadHash` matching `/^[a-f0-9]{64}$/`.

- [ ] **Step 4: Add the release workflow gate**

Rename the emergency input description to mention OpenClaw. Add after Grok:

```yaml
- name: Require signed OpenClaw compatibility registry
  if: ${{ github.event_name != 'workflow_dispatch' || !inputs.allow_unconfigured_registries }}
  shell: bash
  env:
    NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL: ${{ secrets.OPENCLAW_SCHEMA_REGISTRY_URL }}
    NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY: ${{ secrets.OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY }}
    NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS: ${{ secrets.OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS }}
    NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT: ${{ secrets.OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT }}
  run: |
    node scripts/check-openclaw-registry-release.mjs
    {
      echo "NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL=$NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_URL"
      echo "NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY<<COVEN_OPENCLAW_KEY_EOF"
      printf '%s\n' "$NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY"
      echo "COVEN_OPENCLAW_KEY_EOF"
      echo "NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS<<COVEN_OPENCLAW_KEYS_EOF"
      printf '%s\n' "$NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS"
      echo "COVEN_OPENCLAW_KEYS_EOF"
      echo "NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT=$NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT"
    } >> "$GITHUB_ENV"
```

- [ ] **Step 5: Write the registry runbook**

Document:

- endpoint `https://opencoven.github.io/coven-runtimes/openclaw/current.json`;
- source-trusted built-in profile;
- public release secrets;
- private key custody in `coven-runtimes`;
- monotonic publication and checkpoint;
- format-1 canonicalization vector;
- rotation overlap and revocation;
- beta.5 source provenance and outer schema hash;
- no payload values in diagnostics.

- [ ] **Step 6: Update the old Gateway plan**

Replace the “wait for upstream typed schema” boundary with:

- official outer `AgentEventSchema`;
- signed data-profile authority;
- two-phase `tool-events` negotiation;
- direct `agent` plus late-subscriber `session.tool`;
- sparse tool sequence handling;
- registry deployment dependency.

- [ ] **Step 7: Wire and run release tests**

Add `scripts/check-openclaw-registry-release.test.mjs` beside the other registry
guards in `scripts/run-tests.mjs`.

Run:

```bash
node scripts/check-openclaw-registry-release.test.mjs
pnpm check:tests-wired
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/release.yml scripts/check-openclaw-registry-release.mjs scripts/check-openclaw-registry-release.test.mjs scripts/run-tests.mjs docs/openclaw-compatibility-registry.md docs/specs/2026-07-25-openclaw-gateway-dispatch-plan.md
git commit -S -m "ci(openclaw): require signed compatibility registry"
```

### Task 10: Run the integrated verification and record the Cave handoff

**Files:**
- Modify only if failures expose defects in Task 1-9 files.
- Update Bead: `cave-53iko`

- [ ] **Step 1: Run the complete focused set**

```bash
node --experimental-strip-types src/lib/openclaw-compatibility.test.ts
node --experimental-strip-types src/lib/openclaw-gateway.test.ts
node --experimental-strip-types src/lib/openclaw-bridge.test.ts
node --experimental-strip-types src/lib/openclaw-conversation.test.ts
node --experimental-strip-types src/lib/openclaw-conversation-tools.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing-tool-events.test.ts
node scripts/check-openclaw-registry-release.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 2: Run repository gates**

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
pnpm test:api
git diff --check
```

Expected: PASS. If `pnpm test:api` exposes an unchanged platform-specific
baseline failure, reproduce it on clean `origin/main` before attributing it.

- [ ] **Step 3: Inspect the exact diff**

```bash
git status --short
git --no-pager diff origin/main...HEAD --stat
git --no-pager diff origin/main...HEAD -- src/lib/openclaw-compatibility.ts src/lib/openclaw-gateway.ts src/app/api/chat/send/route.ts
```

Expected: only OpenClaw compatibility, route projection, release guard, tests,
fixtures, dependency pins, and directly related docs.

- [ ] **Step 4: Record durable verification**

```bash
bd update cave-53iko --append-notes "CAVE IMPLEMENTATION: branch feat/cave-53iko-openclaw-tool-activity; record final commit SHA, focused test results, typecheck/lint/API results, exact official package version, built-in profile payload hash, and the remaining coven-runtimes publisher plan."
```

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add src/lib/openclaw-compatibility.ts src/lib/openclaw-compatibility.test.ts src/lib/openclaw-gateway.ts src/lib/openclaw-gateway.test.ts src/app/api/chat/send/route.ts src/app/api/chat/send/harness-routing-tool-events.test.ts src/lib/openclaw-conversation.ts src/lib/openclaw-conversation.test.ts src/lib/openclaw-conversation-tools.test.ts
git commit -S -m "test(openclaw): complete compatibility conformance"
```

Skip this commit when verification required no code changes.

The Cave bead remains in progress until the publisher plan is complete and the
release anchors are configured.
