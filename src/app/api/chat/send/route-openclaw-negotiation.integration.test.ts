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
      const runId = `negotiation-route-run-${connection}`;
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId } }));
      onChatSend(socket, { runId, sessionKey: frame.params.sessionKey, agentId: frame.params.agentId });
    });
  });
  return {
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

const gatewayA = startGatewayFixture({ serverVersion: "2026.7.2-beta.5" }, (socket, routed) => {
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
  emit(4, "chat", {
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
    new RegExp(`discovered event schema ${"f".repeat(64)} is not a validated compatibility schema; plain chat is retained\\.`),
    "the diagnostic is value-free: schema hash only, never payloads",
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
  const cliConversation = await loadConversation("openclaw-negotiation-cli");
  assert.equal(cliConversation?.turns.at(-1)?.tools, undefined, "the CLI path persists no tool activity");
} finally {
  restoreEnv();
  await gatewayA.close();
  await gatewayB.close();
  await rm(home, { recursive: true, force: true });
}

console.log("route-openclaw-negotiation.integration.test.ts: ok");
