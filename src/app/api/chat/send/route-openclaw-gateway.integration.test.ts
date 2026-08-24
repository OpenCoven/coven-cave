// @ts-nocheck
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDeviceAuthPayloadV3 } from "@openclaw/gateway-client";
import { WebSocketServer } from "ws";

import {
  openClawPublicKeyRawBase64UrlFromPem,
  type OpenClawDeviceCredentialStore,
} from "../../../../lib/server/openclaw-device-credentials.ts";

const home = await mkdtemp(path.join(tmpdir(), "cave-openclaw-gateway-route-"));
const workspace = path.join(home, "workspace");
await mkdir(workspace, { recursive: true });

const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  OPENCLAW_GATEWAY_DISPATCH: process.env.OPENCLAW_GATEWAY_DISPATCH,
  OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
};

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rawPublicKey = openClawPublicKeyRawBase64UrlFromPem(publicKeyPem);
const identity = {
  deviceId: createHash("sha256").update(Buffer.from(rawPublicKey, "base64url")).digest("hex"),
  publicKeyPem,
  privateKeyPem,
};
const credentialStore: OpenClawDeviceCredentialStore = {
  status: () => ({ available: true }),
  loadOrCreateDeviceIdentity: () => identity,
  loadDeviceAuthToken: () => null,
  storeDeviceAuthToken: () => undefined,
  clearDeviceAuthToken: () => undefined,
};

const gateway = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(gateway, "listening");
const address = gateway.address();
assert.ok(address && typeof address === "object");
const sockets = new Set();
const requests = [];
let connectionCount = 0;
let subscribedSessionKey;

const hello = (connId) => ({
  type: "hello-ok",
  protocol: 4,
  server: { version: "2026.7.2-beta.5", connId },
  features: {
    methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.tool"],
    capabilities: ["chat-send-routing-contract"],
  },
  snapshot: {
    presence: [],
    health: {},
    stateVersion: { presence: 0, health: 0 },
    uptimeMs: 0,
  },
  auth: {
    role: "operator",
    scopes: ["operator.read", "operator.write"],
  },
  policy: {
    maxPayload: 1024 * 1024,
    maxBufferedBytes: 1024 * 1024,
    tickIntervalMs: 30_000,
  },
});

gateway.on("connection", (socket) => {
  sockets.add(socket);
  const connection = ++connectionCount;
  socket.on("close", () => sockets.delete(socket));
  socket.send(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: `route-test-${connection}` },
  }));
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type !== "req") return;
    requests.push({ connection, method: frame.method, params: frame.params });
    if (frame.method === "connect") {
      assert.equal(frame.params.role, "operator");
      assert.deepEqual(frame.params.scopes, ["operator.read", "operator.write"]);
      assert.equal(frame.params.device.id, identity.deviceId);
      assert.equal(frame.params.device.publicKey, rawPublicKey);
      assert.equal(frame.params.device.nonce, `route-test-${connection}`);
      const signedPayload = buildDeviceAuthPayloadV3({
        deviceId: frame.params.device.id,
        clientId: frame.params.client.id,
        clientMode: frame.params.client.mode,
        role: frame.params.role,
        scopes: frame.params.scopes,
        signedAtMs: frame.params.device.signedAt,
        nonce: frame.params.device.nonce,
        platform: frame.params.client.platform,
        deviceFamily: frame.params.client.deviceFamily,
      });
      assert.equal(
        verify(
          null,
          Buffer.from(signedPayload, "utf8"),
          publicKey,
          Buffer.from(frame.params.device.signature, "base64url"),
        ),
        true,
        "the route completes the challenge with its paired-device signature",
      );
      socket.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: hello(`route-test-${connection}`),
      }));
      return;
    }
    if (frame.method === "sessions.messages.subscribe") {
      assert.equal(connection, 2, "only the capability-enabled connection subscribes");
      assert.equal(frame.params.agentId, "main");
      subscribedSessionKey = frame.params.key;
      socket.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { subscribed: true },
      }));
      return;
    }
    if (frame.method !== "chat.send") return;

    const runId = "gateway-route-run";
    const sessionKey = frame.params.sessionKey;
    const agentId = frame.params.agentId;
    assert.equal(
      subscribedSessionKey,
      sessionKey,
      "chat.send is accepted only after the same canonical session was subscribed",
    );
    socket.send(JSON.stringify({
      type: "res",
      id: frame.id,
      ok: true,
      payload: { runId },
    }));

    const emit = (seq, event, payload) => socket.send(JSON.stringify({
      type: "event",
      event,
      seq,
      payload,
    }));
    queueMicrotask(() => {
      emit(1, "agent", {
        runId: "concurrent-foreign-run",
        sessionKey,
        agentId,
        seq: 0,
        stream: "tool",
        ts: 900,
        data: {
          phase: "start",
          toolCallId: "foreign-tool",
          name: "exec",
          args: { command: "must not leak" },
        },
      });
      emit(2, "agent", {
        runId,
        sessionKey,
        agentId,
        seq: 0,
        stream: "tool",
        ts: 1000,
        data: {
          phase: "start",
          toolCallId: "tool-1",
          name: "exec",
          args: { command: "printf route-ok" },
        },
      });
      emit(3, "chat", {
        runId,
        sessionKey,
        agentId,
        seq: 0,
        state: "delta",
        deltaText: "Gateway answer",
      });
      emit(4, "agent", {
        runId,
        sessionKey,
        agentId,
        seq: 1,
        stream: "tool",
        ts: 1100,
        data: {
          phase: "update",
          toolCallId: "tool-1",
          name: "exec",
          partialResult: "route-",
        },
      });
      emit(5, "agent", {
        runId,
        sessionKey,
        agentId,
        seq: 2,
        stream: "tool",
        ts: 1200,
        data: {
          phase: "result",
          toolCallId: "tool-1",
          name: "exec",
          result: { text: "route-ok", exitCode: 0 },
          isError: false,
        },
      });
      emit(6, "chat", {
        runId,
        sessionKey,
        agentId,
        seq: 1,
        state: "final",
        message: { text: "opaque final message" },
      });
    });
  });
});

function restoreEnv() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function closeGateway() {
  for (const socket of sockets) socket.terminate();
  await new Promise((resolve) => gateway.close(resolve));
}

try {
  process.env.COVEN_HOME = home;
  process.env.COVEN_CAVE_HOME = path.join(home, "cave");
  process.env.OPENCLAW_GATEWAY_DISPATCH = "1";
  process.env.OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${address.port}`;
  await writeFile(
    path.join(home, "familiars.toml"),
    ['[[familiar]]', 'id = "wren"', 'openclaw_agent = "main"'].join("\n"),
    "utf8",
  );

  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { postChatForTests } = await import("./route.ts");

  await saveConfig({ familiars: { wren: { harness: "openclaw", model: "" } } });
  const project = await createProject({ name: "OpenClaw Gateway route fixture", root: workspace });
  await grantProjectToFamiliar({
    familiarId: "wren",
    projectId: project.id,
    source: "human",
    access: "write",
  });

  const sessionId = "openclaw-gateway-route-session";
  const response = await postChatForTests(
    new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "wren",
        prompt: "exercise the direct Gateway route",
        projectRoot: workspace,
        sessionId,
        runId: "cave-route-request",
      }),
    }),
    { openClawGatewayCredentialStore: credentialStore },
  );
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));

  assert.deepEqual(
    events.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["Gateway answer"],
    "the authenticated Gateway delta reaches route SSE",
  );
  assert.equal(
    events.some((event) => JSON.stringify(event).includes("foreign-tool")),
    false,
    "a concurrent foreign run cannot leak a tool card into route SSE",
  );
  assert.deepEqual(
    events
      .filter((event) => event.kind === "tool_use" && event.id === "openclaw:tool-1")
      .map((event) => event.status),
    ["running", "running", "ok"],
    "one matching Gateway run emits start, update, and result cards",
  );
  assert.equal(
    events.findLast((event) => event.kind === "done")?.responseMetadata?.gatewaySessionId,
    "gateway-route-run",
    "the route exposes the authoritative Gateway run id",
  );

  const conversation = await loadConversation(sessionId);
  const assistant = conversation?.turns.at(-1);
  assert.equal(assistant?.text, "Gateway answer");
  assert.equal(assistant?.responseMetadata?.gatewaySessionId, "gateway-route-run");
  assert.deepEqual(
    assistant?.tools?.map((tool) => ({
      id: tool.id,
      name: tool.name,
      status: tool.status,
      output: tool.output,
    })),
    [{
      id: "openclaw:tool-1",
      name: "exec",
      status: "ok",
      output: '{"text":"route-ok","exitCode":0}',
    }],
    "the accepted run persists one settled tool card and no concurrent-run card",
  );
  assert.equal(
    requests.filter((request) => request.method === "chat.send").length,
    1,
    "the route dispatches exactly one authoritative Gateway turn",
  );
  assert.deepEqual(
    requests
      .filter((request) => request.connection === 2)
      .map((request) => request.method),
    ["connect", "sessions.messages.subscribe", "chat.send"],
    "the authenticated dispatch subscribes before sending the turn",
  );
} finally {
  restoreEnv();
  await closeGateway();
  await rm(home, { recursive: true, force: true });
}

console.log("openclaw Gateway route integration test passed");
