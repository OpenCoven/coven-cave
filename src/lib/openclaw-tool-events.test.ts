// @ts-nocheck
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
import {
  OpenClawToolEventLedger,
  createOpenClawCapabilityCache,
  normalizeOpenClawGatewayToolEvent,
  readVerifiedOpenClawCapabilityCache,
  resolveOpenClawToolCompatibility,
  subscribeOpenClawGatewayToolEvents,
} from "./openclaw-tool-events.ts";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/openclaw-session-tool-v4.json", import.meta.url), "utf8"),
);
const hello = fixture.hello;

assert.deepEqual(resolveOpenClawToolCompatibility(hello), {
  protocol: 4,
  serverVersion: "2026.7.24",
  schema: "openclaw.session-tool.v1",
  supported: true,
});
assert.equal(
  resolveOpenClawToolCompatibility({ ...hello, protocol: 5 }).reason,
  "unsupported_protocol",
  "a newer incompatible protocol must fall back until an adapter is shipped",
);
assert.equal(
  resolveOpenClawToolCompatibility({
    ...hello,
    features: { ...hello.features, methods: ["chat.send"] },
  }).reason,
  "missing_feature",
  "capability discovery must be stricter than a version match",
);
assert.equal(
  resolveOpenClawToolCompatibility({
    ...hello,
    features: { ...hello.features, events: ["chat"] },
  }).reason,
  "missing_feature",
  "the session.tool event must be discovered explicitly",
);
assert.equal(
  resolveOpenClawToolCompatibility({
    ...hello,
    features: { ...hello.features, capabilities: ["unexpected-server-capability"] },
  }).reason,
  undefined,
  "server capabilities do not replace the client tool-events capability",
);
assert.equal(
  resolveOpenClawToolCompatibility({
    ...hello,
    features: { ...hello.features, capabilities: ["unexpected-server-capability", 1] },
  } as never).reason,
  "invalid_hello",
  "malformed optional server-capability metadata must fail closed",
);

const [startFrame, updateFrame, terminalFrame] = fixture.frames;
const gatewaySessionKey = "agent:nova:explicit:cave-session";
assert.deepEqual(normalizeOpenClawGatewayToolEvent(startFrame, gatewaySessionKey, "nova"), {
  runId: "run-1",
  id: "call-1",
  name: "exec",
  phase: "start",
  input: '{\n  "command": "pwd"\n}',
  isError: false,
  seq: 1,
  timestamp: 1_000,
});
assert.equal(
  normalizeOpenClawGatewayToolEvent(startFrame, "another-session", "nova"),
  null,
  "a subscription must never leak a different session's tool payload",
);
assert.equal(
  normalizeOpenClawGatewayToolEvent({ ...startFrame, event: "agent" }, gatewaySessionKey, "nova"),
  null,
  "unknown event families must not become fabricated activity",
);
assert.equal(
  normalizeOpenClawGatewayToolEvent({
    ...terminalFrame,
    payload: { ...terminalFrame.payload, data: { ...terminalFrame.payload.data, isError: undefined } },
  }, gatewaySessionKey, "nova"),
  null,
  "a terminal frame without an explicit outcome must not be rendered as success",
);

const ledger = new OpenClawToolEventLedger();
assert.equal(
  normalizeOpenClawGatewayToolEvent(startFrame, gatewaySessionKey, "other-agent"),
  null,
  "a session subscription must not accept a different agent's tool payload",
);
assert.equal(
  resolveOpenClawToolCompatibility({ ...hello, auth: { role: "operator", scopes: [] } }).reason,
  "invalid_hello",
  "a connect response without the authenticated read scope must fall back",
);
const start = normalizeOpenClawGatewayToolEvent(startFrame, gatewaySessionKey, "nova");
assert.ok(start);
assert.deepEqual(ledger.accept(start, 1_000), {
  id: "run-1:call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  status: "running",
});
const update = normalizeOpenClawGatewayToolEvent(
  updateFrame,
  gatewaySessionKey,
  "nova",
);
assert.ok(update);
assert.deepEqual(ledger.accept(update, 1_100), {
  id: "run-1:call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  output: "still running",
  status: "running",
});
const terminal = normalizeOpenClawGatewayToolEvent(
  terminalFrame,
  gatewaySessionKey,
  "nova",
);
assert.ok(terminal);
assert.deepEqual(ledger.accept(terminal, 1_200), {
  id: "run-1:call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  output: '{\n  "output": "ok"\n}',
  status: "ok",
  durationMs: 200,
});
assert.equal(ledger.accept(terminal, 1_300), null, "replayed frames must not duplicate a bubble");
assert.equal(ledger.accept(start, 1_400), null, "late start frames must not downgrade terminal state");
assert.deepEqual(
  ledger.accept({ runId: "run-error", id: "call-error", name: "exec", phase: "result", output: "cancelled", isError: true }, 1_500),
  { id: "run-error:call-error", name: "exec", output: "cancelled", status: "error" },
  "terminal error/cancel results must never appear successful",
);
const unfinished = new OpenClawToolEventLedger();
unfinished.accept(start, 1_000);
assert.deepEqual(unfinished.finalizeUnsettled("cancelled", 1_120), [
  {
    id: "run-1:call-1",
    name: "exec",
    input: '{\n  "command": "pwd"\n}',
    output: "cancelled",
    status: "error",
    durationMs: 120,
  },
]);

const outOfOrder = new OpenClawToolEventLedger();
assert.deepEqual(
  outOfOrder.accept({ runId: "run-2", id: "call-2", name: "read", phase: "result", output: "done", isError: false }, 2_000),
  { id: "run-2:call-2", name: "read", output: "done", status: "ok" },
  "a factual terminal event may render without inventing a missing start event",
);
const concurrent = new OpenClawToolEventLedger();
concurrent.accept({ runId: "run-concurrent", id: "call-a", name: "exec", phase: "start", input: "a", isError: false }, 2_000);
concurrent.accept({ runId: "run-concurrent", id: "call-b", name: "exec", phase: "start", input: "b", isError: false }, 2_001);
assert.deepEqual(
  concurrent.accept({ runId: "run-concurrent", id: "call-b", name: "exec", phase: "result", output: "B", isError: false }, 2_010),
  { id: "run-concurrent:call-b", name: "exec", input: "b", output: "B", status: "ok", durationMs: 9 },
  "concurrent same-name calls remain keyed by their Gateway toolCallId",
);
const ordered = new OpenClawToolEventLedger();
ordered.accept({ runId: "run-ordered", id: "call-ordered", name: "exec", phase: "start", input: "a", isError: false, seq: 10 });
assert.equal(
  ordered.accept({ runId: "run-ordered", id: "call-ordered", name: "exec", phase: "update", output: "stale", isError: false, seq: 9 }),
  null,
  "out-of-order updates must not overwrite newer output while a call is running",
);
const reusedToolCallId = new OpenClawToolEventLedger();
reusedToolCallId.accept({ runId: "run-first", id: "call-reused", name: "exec", phase: "result", output: "first", isError: false, seq: 1 }, 3_000);
assert.deepEqual(
  reusedToolCallId.accept({ runId: "run-second", id: "call-reused", name: "exec", phase: "start", input: "second", isError: false, seq: 1 }, 3_001),
  { id: "run-second:call-reused", name: "exec", input: "second", status: "running" },
  "toolCallId reuse in another Gateway run must not suppress or merge a new tool card",
);

const entry = {
  runtimeKey: "0123456789abcdef01234567",
  protocol: 4,
  serverVersion: "2026.7.24",
  schema: "openclaw.session-tool.v1",
  supported: true,
  observedAt: 100,
  expiresAt: 10_000,
};
const validCache = createOpenClawCapabilityCache([entry]);
assert.deepEqual(readVerifiedOpenClawCapabilityCache(JSON.stringify(validCache), 500), [entry]);
const cacheWithUnexpectedField = createOpenClawCapabilityCache([{ ...entry, token: "must-not-survive" }]);
assert.deepEqual(
  readVerifiedOpenClawCapabilityCache(JSON.stringify(cacheWithUnexpectedField), 500),
  [entry],
  "verified cache reads must strip unrecognized fields before a later rewrite can retain them",
);
assert.deepEqual(
  readVerifiedOpenClawCapabilityCache(JSON.stringify({ ...validCache, integrity: "tampered" }), 500),
  [],
  "cache integrity failures must not enable streaming",
);
assert.deepEqual(readVerifiedOpenClawCapabilityCache(JSON.stringify(validCache), 10_000), []);

// Fixture-backed websocket transcript: proves the actual handshake advertises
// tool-events, subscribes by Cave session key, and routes only that session's
// structured lifecycle into the consumer without a real personal gateway.
const gateway = new WebSocketServer({ port: 0 });
await once(gateway, "listening");
const address = gateway.address();
assert.ok(address && typeof address !== "string");
const receivedFrames = [];
let gatewaySocket;
let connectRequests = 0;
let subscriptionRequests = 0;
gateway.on("connection", (socket) => {
  gatewaySocket = socket;
  // A pre-auth event must never be rendered, even if it happens to look like
  // the selected session's tool frame.
  socket.send(JSON.stringify(startFrame));
  socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "fixture" } }));
  socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "replayed-fixture" } }));
  socket.on("message", (raw) => {
    const request = JSON.parse(raw.toString());
    if (request.method === "connect") {
      connectRequests += 1;
      assert.deepEqual(request.params.caps, ["tool-events"]);
      assert.deepEqual(request.params.scopes, ["operator.read"]);
      assert.deepEqual(request.params.auth, { token: "fixture-token" });
      assert.deepEqual(request.params.client, {
        id: "gateway-client",
        version: process.env.npm_package_version ?? "unknown",
        platform: process.platform,
        mode: "backend",
      });
      socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, payload: hello }));
    }
    if (request.method === "sessions.messages.subscribe") {
      subscriptionRequests += 1;
      assert.deepEqual(request.params, { key: gatewaySessionKey, agentId: "nova" });
      socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, payload: {} }));
      socket.send(JSON.stringify(startFrame));
      socket.send(JSON.stringify(updateFrame));
      socket.send(JSON.stringify(terminalFrame));
      socket.send(JSON.stringify({ type: "event", event: "session.tool", payload: { data: {} } }));
    }
  });
});
const previousGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
const previousGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
process.env.OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${address.port}`;
process.env.OPENCLAW_GATEWAY_TOKEN = "fixture-token";
try {
  let disconnects = 0;
  let resolveEvents: (() => void) | undefined;
  const eventsReceived = new Promise<void>((resolve) => {
    resolveEvents = resolve;
  });
  let resolveDisconnect: (() => void) | undefined;
  const disconnected = new Promise<void>((resolve) => {
    resolveDisconnect = resolve;
  });
  const subscription = await subscribeOpenClawGatewayToolEvents({
    sessionKey: gatewaySessionKey,
    agentId: "nova",
    persistCapabilityCache: false,
    onToolEvent: (event) => {
      receivedFrames.push(event);
      if (receivedFrames.length === 3) resolveEvents?.();
    },
    onDisconnect: () => {
      disconnects += 1;
      resolveDisconnect?.();
    },
  });
  assert.equal(subscription.active, true);
  assert.equal(connectRequests, 1, "a replayed challenge must not repeat the authenticated connect request");
  assert.equal(subscriptionRequests, 1, "a replayed handshake must not duplicate the session subscription");
  await Promise.race([
    eventsReceived,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Gateway tool lifecycle was not observed")), 1_000)),
  ]);
  assert.deepEqual(receivedFrames, [
    {
      runId: "run-1",
      id: "call-1",
      name: "exec",
      phase: "start",
      input: '{\n  "command": "pwd"\n}',
      isError: false,
      seq: 1,
      timestamp: 1_000,
    },
    {
      runId: "run-1",
      id: "call-1",
      name: "exec",
      phase: "update",
      output: "still running",
      isError: false,
      seq: 2,
      timestamp: 1_050,
    },
    {
      runId: "run-1",
      id: "call-1",
      name: "exec",
      phase: "result",
      output: '{\n  "output": "ok"\n}',
      isError: false,
      seq: 3,
      timestamp: 1_100,
    },
  ]);
  gatewaySocket.close();
  await Promise.race([
    disconnected,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Gateway close was not observed")), 1_000)),
  ]);
  assert.equal(disconnects, 1, "an unexpected Gateway close must settle the route exactly once");
  subscription.close();
  process.env.OPENCLAW_GATEWAY_URL = "ws://gateway.example.test";
  assert.equal(
    (await subscribeOpenClawGatewayToolEvents({
      sessionKey: gatewaySessionKey,
      agentId: "nova",
      persistCapabilityCache: false,
      onToolEvent: () => assert.fail("a plaintext remote Gateway must not be contacted"),
    })).active,
    false,
  );
  process.env.OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${address.port}`;
  // A URL alone is never enough to turn on Gateway streaming: the token must
  // be present so the normal path always performs an authenticated handshake.
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  assert.equal(
    (await subscribeOpenClawGatewayToolEvents({
      sessionKey: gatewaySessionKey,
      agentId: "nova",
      persistCapabilityCache: false,
      onToolEvent: () => assert.fail("unauthenticated Gateway must not emit events"),
    })).active,
    false,
  );
} finally {
  if (previousGatewayUrl === undefined) delete process.env.OPENCLAW_GATEWAY_URL;
  else process.env.OPENCLAW_GATEWAY_URL = previousGatewayUrl;
  if (previousGatewayToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
  else process.env.OPENCLAW_GATEWAY_TOKEN = previousGatewayToken;
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
}

console.log("openclaw-tool-events.test.ts: ok");
