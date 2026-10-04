// @ts-nocheck
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

import {
  openClawPublicKeyRawBase64UrlFromPem,
  type OpenClawDeviceCredentialStore,
} from "../../../../lib/server/openclaw-device-credentials.ts";
import {
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  openClawDiscoveryFromHello,
  openClawSchemaBundleSigningPayload,
  selectOpenClawToolProfile,
  BUILTIN_OPENCLAW_TOOL_PROFILES,
} from "../../../../lib/openclaw-compatibility.ts";

// Slice 2 of issue #4892, end to end through the real chat send route:
// the per-conversation bridge negotiation (RuntimeBridge.negotiateSession)
// decides whether a turn streams structured tool activity, projected tool
// events persist on the conversation's turns so a resumed session still shows
// them, a degraded turn persists no tool activity, and a validated registry
// profile bundle is adopted in place of the built-in profile. Everything is
// fixture-driven: local WebSocket fixtures stand in for the Gateway, the
// registry keys are throwaway ed25519 fixture keys, and no live OpenClaw call
// is made anywhere.

const home = await mkdtemp(path.join(tmpdir(), "cave-openclaw-negotiation-"));
const workspace = path.join(home, "workspace");
const bin = path.join(home, "bin");
await mkdir(workspace, { recursive: true });
await mkdir(bin, { recursive: true });

const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  OPENCLAW_GATEWAY_DISPATCH: process.env.OPENCLAW_GATEWAY_DISPATCH,
  OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
  OPENCLAW_BIN: process.env.OPENCLAW_BIN,
  OPENCLAW_TEST_LOG: process.env.OPENCLAW_TEST_LOG,
};
const callLog = path.join(home, "openclaw-calls.jsonl");
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.OPENCLAW_TEST_LOG = callLog;
await writeFile(
  path.join(home, "familiars.toml"),
  ['[[familiar]]', 'id = "wren"', 'openclaw_agent = "main"'].join("\n"),
  "utf8",
);

// A plain-chat CLI shim: whenever the route falls back from the Gateway to
// the CLI bridge, its reply text identifies the fallback unambiguously.
const shimScript = path.join(bin, "openclaw");
await writeFile(shimScript, ["#!/usr/bin/env node",
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.OPENCLAW_TEST_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
  "if (process.argv[2] === 'agent') {",
  "  process.stdout.write(JSON.stringify({ result: { payloads: [{ text: 'shim plain-chat reply' }] } }));",
  "  process.exit(0);",
  "}",
  "if (process.argv.join(' ') === 'agents list --json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'main', isDefault: true }]));",
  "  process.exit(0);",
  "}",
  "process.exit(1);",
].join("\n"), { mode: 0o755 });

// ── Registry bundle fixture (throwaway ed25519 key, Node crypto) ────────────
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOW = Date.parse("2026-08-24T00:00:00.000Z");
const beta5Hello = JSON.parse(
  await readFile(new URL("../../../../lib/openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const versionFixtures = JSON.parse(
  await readFile(new URL("../../../../lib/openclaw-fixtures/bridge-negotiation-versions.json", import.meta.url), "utf8"),
);
const beta5Discovery = openClawDiscoveryFromHello(beta5Hello);
const concurrentDiscovery = versionFixtures.discoveries.concurrentVersion;
const beta5Profile = selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, beta5Discovery);
assert.ok(beta5Profile, "the pinned beta5 fixture selects the built-in profile");
const concurrentProfile = {
  ...structuredClone(beta5Profile),
  id: "openclaw-agent-tool-v2",
  priority: 90,
  requires: {
    ...structuredClone(beta5Profile.requires),
    serverVersions: [concurrentDiscovery.serverVersion],
    // A real Gateway hello always maps to the pinned protocol schema hash
    // (openClawDiscoveryFromHello stamps it), so the refreshed profile
    // declares a second simultaneously-supported server VERSION under the
    // same validated schema.
    agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  },
  source: { ...beta5Profile.source, blobSha: "b".repeat(40) },
};
const unsignedBundle = {
  format: 1,
  runtime: "openclaw",
  sequence: 2,
  issuedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  keyId: "fixture",
  profiles: [structuredClone(concurrentProfile)],
};
const bundleSignature = sign(
  null,
  Buffer.from(openClawSchemaBundleSigningPayload(unsignedBundle), "utf8"),
  privateKeyPem,
);
const signedBundle = {
  ...unsignedBundle,
  signature: { algorithm: "ed25519", value: bundleSignature.toString("base64") },
};
const tamperedBundle = structuredClone(signedBundle);
tamperedBundle.profiles = structuredClone(tamperedBundle.profiles);
tamperedBundle.profiles[0].priority = 1; // payload mutated after signing

// ── Local Gateway fixtures ───────────────────────────────────────────────────
function startGatewayFixture(helloExtra, onChatSend) {
  const gateway = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const listening = once(gateway, "listening");
  const sockets = new Set();
  let connectionCount = 0;
  let chatSendCount = 0;
  gateway.on("connection", (socket) => {
    sockets.add(socket);
    const connection = ++connectionCount;
    socket.on("close", () => sockets.delete(socket));
    socket.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: `negotiation-${connection}` },
    }));
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type !== "req") return;
      if (frame.method === "connect") {
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 4,
            server: { version: helloExtra.serverVersion, connId: `negotiation-${connection}` },
            features: {
              methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
              events: ["chat", "agent", "session.tool"],
              capabilities: ["chat-send-routing-contract"],
            },
            snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 0 },
            auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
            policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 1024 * 1024, tickIntervalMs: 30_000 },
          },
        }));
        return;
      }
      if (frame.method === "sessions.messages.subscribe") {
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { subscribed: true } }));
        return;
      }
      if (frame.method !== "chat.send") return;
      chatSendCount += 1;
      const runId = `negotiation-route-run-${connection}`;
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId } }));
      onChatSend(socket, { runId, sessionKey: frame.params.sessionKey, agentId: frame.params.agentId });
    });
  });
  return {
    chatSendCount: () => chatSendCount,
    async address() {
      await listening;
      const address = gateway.address();
      assert.ok(address && typeof address === "object");
      return `ws://127.0.0.1:${address.port}`;
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise((resolve) => gateway.close(resolve));
    },
  };
}

let includeDisclosureTools = false;
let onGatewayTurn = null;
const gatewayA = startGatewayFixture({ serverVersion: "2026.7.2-beta.5" }, (socket, routed) => {
  onGatewayTurn?.();
  const emit = (seq, event, payload) => socket.send(JSON.stringify({ type: "event", event, seq, payload }));
  emit(1, "agent", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 0, stream: "tool", ts: 1000,
    data: { phase: "start", toolCallId: "tool-1", name: "exec", args: { command: "printf route-ok" } },
  });
  emit(2, "chat", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 0, state: "delta", deltaText: "Gateway answer",
  });
  emit(3, "agent", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 1, stream: "tool", ts: 1200,
    data: { phase: "result", toolCallId: "tool-1", name: "exec", result: { text: "route-ok", exitCode: 0 }, isError: false },
  });
  let nextEventSeq = 4;
  let nextToolSeq = 2;
  if (includeDisclosureTools) {
    const tool = (data) => emit(nextEventSeq++, "agent", {
      runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
      seq: nextToolSeq++, stream: "tool", ts: 1300, data,
    });
    tool({ phase: "start", toolCallId: "call-array", name: "read", args: { path: "safe.ts" } });
    tool({ phase: "update", toolCallId: "call-array", partialResult: "PRIVATE_PROGRESS_SENTINEL" });
    tool({ phase: "result", toolCallId: "call-array", name: "read", result: [{ type: "future_opaque_payload", text: "PRIVATE_ARRAY_SENTINEL" }], isError: false });
    // A result can arrive before its start; synthetic request presentation
    // must apply the same output disclosure policy as an ordinary result.
    tool({ phase: "result", toolCallId: "call-object", name: "read", result: { type: "future_opaque_payload", text: "PRIVATE_OBJECT_SENTINEL" }, isError: false });
    tool({ phase: "start", toolCallId: "mixed-blocks", name: "read", args: { path: "safe.ts" } });
    tool({ phase: "result", toolCallId: "mixed-blocks", name: "read", result: [
      { type: "text", text: "Readable result" }, { type: "future_opaque_payload", text: "PRIVATE_MIXED_SENTINEL" },
    ], isError: false });
  }
  emit(nextEventSeq, "chat", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 1, state: "final", message: { text: "opaque final" },
  });
});

const gatewayB = startGatewayFixture({ serverVersion: concurrentDiscovery.serverVersion }, (socket, routed) => {
  const emit = (seq, event, payload) => socket.send(JSON.stringify({ type: "event", event, seq, payload }));
  emit(1, "chat", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 0, state: "delta", deltaText: "bundle gateway answer",
  });
  emit(2, "chat", {
    runId: routed.runId, sessionKey: routed.sessionKey, agentId: routed.agentId,
    seq: 1, state: "final", message: { text: "opaque final" },
  });
});

const credentialStoreIdentity = {
  deviceId: createHash("sha256").update(
    Buffer.from(openClawPublicKeyRawBase64UrlFromPem(publicKeyPem), "base64url"),
  ).digest("hex"),
  publicKeyPem,
  privateKeyPem,
};
const credentialStore: OpenClawDeviceCredentialStore = {
  status: () => ({ available: true }),
  loadOrCreateDeviceIdentity: () => credentialStoreIdentity,
  loadDeviceAuthToken: () => null,
  storeDeviceAuthToken: () => undefined,
  clearDeviceAuthToken: () => undefined,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { __postChatForTests } = await import("./route.ts");
  const { subscribeRunStream } = await import("@/lib/server/chat-stream-buffer");
  const { hasActiveChatRun } = await import("@/lib/server/chat-stop-registry");

  await saveConfig({ familiars: { wren: { harness: "openclaw", model: "" } } });
  const project = await createProject({ name: "OpenClaw negotiation fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "wren", projectId: project.id, source: "human", access: "write" });

  const gatewayAUrl = await gatewayA.address();
  const gatewayBUrl = await gatewayB.address();
  const post = (body, dependencies = {}) => __postChatForTests(
    new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { openClawGatewayCredentialStore: credentialStore, ...dependencies },
  );

  // ── 1. Structured negotiation streams and persists tool activity ──────────
  process.env.OPENCLAW_GATEWAY_DISPATCH = "1";
  process.env.OPENCLAW_GATEWAY_URL = gatewayAUrl;
  // A first turn has no conversation id on its request. Its early replay
  // stream must already belong to the admitted run before Gateway activity
  // arrives; transport selection cannot leave this buffer without an owner.
  const firstRun = "cave-negotiation-first-turn";
  let firstTurnAdmitted = false;
  let firstTurnReplayAvailable = false;
  onGatewayTurn = () => {
    firstTurnAdmitted = hasActiveChatRun(firstRun);
    const earlyReplay = subscribeRunStream(firstRun, 0, () => {}, () => {});
    firstTurnReplayAvailable = Boolean(earlyReplay && !earlyReplay.done);
    earlyReplay?.unsubscribe();
  };
  const firstTurnEvents = await readSse(await post({
    familiarId: "wren", prompt: "start a new negotiated conversation",
    projectRoot: workspace, runId: firstRun,
  }));
  onGatewayTurn = null;
  assert.equal(firstTurnAdmitted, true, "a first-turn replay stream has an admission owner before Gateway events");
  assert.equal(firstTurnReplayAvailable, true, "early first-turn events are replayable before transport selection finishes");
  assert.equal(firstTurnEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.equal(hasActiveChatRun(firstRun), false, "settlement releases first-turn admission");

  const structuredSession = "openclaw-negotiation-structured";
  const structuredEventsRaw = await post({
    familiarId: "wren",
    prompt: "negotiate the pinned gateway",
    projectRoot: workspace,
    sessionId: structuredSession,
    runId: "cave-negotiation-run-1",
  });
  const structuredEvents = await readSse(structuredEventsRaw);
  assert.equal(
    structuredEvents.some((event) => event.kind === "progress" && event.id === "openclaw-negotiation"),
    false,
    "a structured negotiation surfaces no diagnostic",
  );
  assert.deepEqual(
    structuredEvents
      .filter((event) => event.kind === "tool_use" && event.id === "openclaw:tool-1")
      .map((event) => event.status),
    ["running", "ok"],
    "negotiated structured mode streams the projected tool lifecycle",
  );
  assert.equal(structuredEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.deepEqual(structuredEvents.findLast((event) => event.kind === "done")?.responseMetadata?.runtimeIdentity, {
    schemaVersion: 1, harness: "openclaw", version: "2026.7.2-beta.5", model: null,
    activity: { schemaVersion: 1, path: "gateway", tools: "supported", reasoning: "unsupported" },
  }, "an accepted gateway turn keeps the negotiated version without inventing a model");

  const structuredConversation = await loadConversation(structuredSession);
  const structuredTurn = structuredConversation?.turns.at(-1);
  assert.deepEqual(
    structuredTurn?.tools?.map((tool) => ({ id: tool.id, name: tool.name, status: tool.status, output: tool.output })),
    [{
      id: "openclaw:tool-1",
      name: "exec",
      status: "ok",
      output: '{"text":"route-ok","exitCode":0}',
    }],
    "validated projected tool activity persists on the conversation's assistant turn",
  );

  // ── 1b. Opaque payloads cannot bypass the typed result decoder ─────────────
  includeDisclosureTools = true;
  const requestsBeforeDisclosure = gatewayA.chatSendCount();
  const disclosureSession = "openclaw-negotiation-disclosure";
  const disclosureResponse = await post({
    familiarId: "wren", prompt: "inspect the supported tool results", projectRoot: workspace,
    sessionId: disclosureSession, runId: "cave-negotiation-disclosure",
  });
  assert.equal(disclosureResponse.status, 200);
  const disclosureRaw = await disclosureResponse.text();
  const disclosureEvents = disclosureRaw.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  includeDisclosureTools = false;
  assert.equal(disclosureEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.doesNotMatch(JSON.stringify(disclosureEvents), /PRIVATE_\w+_SENTINEL/);
  const disclosureTools = disclosureEvents.filter((event) => event.kind === "tool_use");
  assert.ok(disclosureEvents.findIndex((event) => event.kind === "response_metadata") <
    disclosureEvents.findIndex((event) => event.kind === "tool_use"), "launch identity precedes early Gateway tool events");
  assert.equal(disclosureEvents.find((event) => event.kind === "response_metadata").responseMetadata.runtimeIdentity.version, null,
    "the launch report does not borrow a version before Gateway acceptance");
  const toolFrames = disclosureRaw.split("\n\n").filter((frame) => frame.includes('"kind":"tool_use"'));
  const toolSequences = toolFrames.map((frame) => Number(frame.match(/^id: (\d+)$/m)?.[1]));
  assert.equal(toolSequences.length, disclosureTools.length);
  assert.ok(toolSequences.every((seq, index) => Number.isSafeInteger(seq) && seq > (toolSequences[index - 1] ?? 0)),
    "even synchronously drained Gateway events carry a stable replay cursor");
  const expectedResults = [
    { id: "openclaw:tool-1", status: "ok", output: '{"text":"route-ok","exitCode":0}' },
    { id: "openclaw:call-array", status: "ok", output: undefined },
    { id: "openclaw:call-object", status: "ok", output: undefined },
    { id: "openclaw:mixed-blocks", status: "ok", output: "Readable result" },
  ];
  const resultFields = (tool) => ({ id: tool.id, status: tool.status, output: tool.output });
  assert.deepEqual(disclosureTools.filter((tool) => tool.status === "ok").map(resultFields), expectedResults);
  assert.ok(disclosureTools.filter((tool) => tool.status === "running").every((tool) => tool.output === undefined),
    "partial progress retains lifecycle metadata only");
  const replay = subscribeRunStream("cave-negotiation-disclosure", 0, () => {}, () => {});
  assert.ok(replay?.done);
  const replayEvents = replay.replay.map((entry) => JSON.parse(entry.json));
  assert.deepEqual(replayEvents.filter((event) => event.kind === "tool_use"), disclosureTools);
  assert.doesNotMatch(JSON.stringify(replayEvents), /PRIVATE_\w+_SENTINEL/);
  replay.unsubscribe();
  const resumedReplay = subscribeRunStream("cave-negotiation-disclosure", toolSequences[0], () => {}, () => {});
  assert.ok(resumedReplay?.done);
  assert.equal(resumedReplay.gapBeforeSeq, null);
  assert.deepEqual(resumedReplay.replay.map((entry) => JSON.parse(entry.json)).filter((event) => event.kind === "tool_use"), disclosureTools.slice(1),
    "resume after the first early tool event neither loses nor repeats observations");
  resumedReplay.unsubscribe();
  assert.equal(gatewayA.chatSendCount(), requestsBeforeDisclosure + 1, "replay does not dispatch another Gateway turn");
  const disclosureTurn = (await loadConversation(disclosureSession))?.turns.at(-1);
  assert.deepEqual(disclosureTurn?.tools?.map(resultFields), expectedResults);
  assert.doesNotMatch(JSON.stringify(disclosureTurn), /PRIVATE_\w+_SENTINEL/);

  // ── 2. Resume: the persisted tool activity is still there on a later turn ──
  const resumedEvents = await readSse(await post({
    familiarId: "wren",
    prompt: "resume the negotiated conversation",
    projectRoot: workspace,
    sessionId: structuredSession,
    runId: "cave-negotiation-run-2",
  }));
  assert.equal(resumedEvents.findLast((event) => event.kind === "done")?.isError, false);
  const resumedConversation = await loadConversation(structuredSession);
  const resumedTurns = resumedConversation?.turns ?? [];
  assert.ok(resumedTurns.length >= 4, "the resumed turn appended to the same conversation");
  assert.deepEqual(
    resumedTurns[1]?.tools?.map((tool) => tool.id),
    ["openclaw:tool-1"],
    "a resumed session still shows the earlier turn's persisted tool activity",
  );

  // ── 3. A degraded negotiation (seam discovery, unvalidated schema hash) ───
  const degradedEvents = await readSse(await post({
    familiarId: "wren",
    prompt: "degrade on an unvalidated schema",
    projectRoot: workspace,
    sessionId: structuredSession,
    runId: "cave-negotiation-run-3",
  }, {
    openClawBridgeDiscovery: { ...beta5Discovery, agentEventSchemaHash: "f".repeat(64) },
  }));
  const degradedDiagnostic = degradedEvents.find(
    (event) => event.kind === "progress" && event.id === "openclaw-negotiation",
  );
  assert.ok(degradedDiagnostic, "a degraded negotiation surfaces its visible diagnostic");
  assert.equal(degradedDiagnostic.status, "notice");
  assert.match(
    degradedDiagnostic.detail,
    /discovered event schema \[redacted\] is not a validated compatibility schema; plain chat is retained\./,
    "the diagnostic passes through the shared display filter and never carries provider payloads",
  );
  assert.equal(
    degradedEvents.some((event) => event.kind === "tool_use"),
    false,
    "a degraded turn streams no tool activity",
  );
  assert.equal(degradedEvents.findLast((event) => event.kind === "done")?.isError, false);
  const degradedConversation = await loadConversation(structuredSession);
  const degradedTurn = degradedConversation?.turns.at(-1);
  assert.equal(degradedTurn?.tools, undefined, "a degraded turn persists no tool activity");
  assert.deepEqual(
    degradedConversation?.turns[1]?.tools?.map((tool) => tool.id),
    ["openclaw:tool-1"],
    "the earlier structured turn's tool activity survives a degraded turn",
  );

  // ── 4. A validated registry bundle is adopted in place of the built-in ────
  process.env.OPENCLAW_GATEWAY_URL = gatewayBUrl;
  const bundleSession = "openclaw-negotiation-bundle";
  const bundleEvents = await readSse(await post({
    familiarId: "wren",
    prompt: "negotiate the refreshed schema version",
    projectRoot: workspace,
    sessionId: bundleSession,
    runId: "cave-negotiation-run-4",
  }, {
    openClawRegistryBundle: signedBundle,
    openClawRegistryPublicKeys: { fixture: publicKeyPem },
  }));
  assert.deepEqual(
    bundleEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["bundle gateway answer"],
    "the adopted registry bundle lets the refreshed gateway version negotiate structured mode",
  );
  assert.equal(
    bundleEvents.some((event) => event.kind === "progress" && event.id === "openclaw-negotiation"),
    false,
    "an adopted bundle negotiates without a diagnostic",
  );
  assert.equal(bundleEvents.findLast((event) => event.kind === "done")?.isError, false);

  // ── 5. Rollback protection: a failing candidate never replaces the set ────
  const tamperedEvents = await readSse(await post({
    familiarId: "wren",
    prompt: "offer a tampered bundle",
    projectRoot: workspace,
    sessionId: bundleSession,
    runId: "cave-negotiation-run-5",
  }, {
    openClawRegistryBundle: tamperedBundle,
    openClawRegistryPublicKeys: { fixture: publicKeyPem },
  }));
  const tamperedNotice = tamperedEvents.find(
    (event) => event.kind === "progress" && event.id === "openclaw-registry-bundle",
  );
  assert.ok(tamperedNotice, "a rejected bundle surfaces a value-free notice");
  assert.equal(tamperedNotice.detail, "registry-bundle-signature-unverified");
  assert.deepEqual(
    tamperedEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["bundle gateway answer"],
    "the conversation keeps negotiating on its last validated set after a rejection",
  );
  assert.equal(tamperedEvents.findLast((event) => event.kind === "done")?.isError, false);

  // ── 6. The plain CLI path stays quiet: no negotiation, no noise ───────────
  delete process.env.OPENCLAW_GATEWAY_DISPATCH;
  delete process.env.OPENCLAW_GATEWAY_URL;
  process.env.OPENCLAW_BIN = shimScript;
  const cliEvents = await readSse(await post({
    familiarId: "wren",
    prompt: "plain CLI turn",
    projectRoot: workspace,
    sessionId: "openclaw-negotiation-cli",
    runId: "cave-negotiation-run-6",
  }));
  assert.deepEqual(
    cliEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["shim plain-chat reply"],
    "without a discovered gateway record the CLI bridge keeps its plain-chat behavior",
  );
  assert.equal(
    cliEvents.some((event) => event.kind === "progress" && event.id === "openclaw-negotiation"),
    false,
    "the plain CLI path surfaces no negotiation diagnostic",
  );
  assert.equal(cliEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.equal(cliEvents.findLast((event) => event.kind === "done")?.responseMetadata?.runtimeIdentity?.version, null,
    "CLI fallback must not adopt a gateway version from an unused transport");
  const cliConversation = await loadConversation("openclaw-negotiation-cli");
  assert.deepEqual(cliConversation.turns.at(-1).responseMetadata.runtimeIdentity.activity,
    { schemaVersion: 1, path: "cli", tools: "unsupported", reasoning: "unsupported" });
  assert.equal(cliConversation?.turns.at(-1)?.tools, undefined, "the CLI path persists no tool activity");
} finally {
  restoreEnv();
  await gatewayA.close();
  await gatewayB.close();
  await rm(home, { recursive: true, force: true });
}

console.log("route-openclaw-negotiation.integration.test.ts: ok");
