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
  resolveOpenClawToolCompatibility({ ...hello, features: { methods: [], events: [] } }).reason,
  "missing_feature",
  "capability discovery must be stricter than a version match",
);

const [startFrame, updateFrame, terminalFrame] = fixture.frames;
assert.deepEqual(normalizeOpenClawGatewayToolEvent(startFrame, "cave-session"), {
  id: "call-1",
  name: "exec",
  phase: "start",
  input: '{\n  "command": "pwd"\n}',
  isError: false,
  seq: 1,
  timestamp: 1_000,
});
assert.equal(
  normalizeOpenClawGatewayToolEvent(startFrame, "another-session"),
  null,
  "a subscription must never leak a different session's tool payload",
);
assert.equal(
  normalizeOpenClawGatewayToolEvent({ ...startFrame, event: "agent" }, "cave-session"),
  null,
  "unknown event families must not become fabricated activity",
);

const ledger = new OpenClawToolEventLedger();
const start = normalizeOpenClawGatewayToolEvent(startFrame, "cave-session");
assert.ok(start);
assert.deepEqual(ledger.accept(start, 1_000), {
  id: "call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  status: "running",
});
const update = normalizeOpenClawGatewayToolEvent(
  updateFrame,
  "cave-session",
);
assert.ok(update);
assert.deepEqual(ledger.accept(update, 1_100), {
  id: "call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  output: "still running",
  status: "running",
});
const terminal = normalizeOpenClawGatewayToolEvent(
  terminalFrame,
  "cave-session",
);
assert.ok(terminal);
assert.deepEqual(ledger.accept(terminal, 1_200), {
  id: "call-1",
  name: "exec",
  input: '{\n  "command": "pwd"\n}',
  output: '{\n  "output": "ok"\n}',
  status: "ok",
  durationMs: 200,
});
assert.equal(ledger.accept(terminal, 1_300), null, "replayed frames must not duplicate a bubble");
assert.equal(ledger.accept(start, 1_400), null, "late start frames must not downgrade terminal state");
const unfinished = new OpenClawToolEventLedger();
unfinished.accept(start, 1_000);
assert.deepEqual(unfinished.finalizeUnsettled("cancelled", 1_120), [
  {
    id: "call-1",
    name: "exec",
    input: '{\n  "command": "pwd"\n}',
    output: "cancelled",
    status: "error",
    durationMs: 120,
  },
]);

const outOfOrder = new OpenClawToolEventLedger();
assert.deepEqual(
  outOfOrder.accept({ id: "call-2", name: "read", phase: "result", output: "done", isError: false }, 2_000),
  { id: "call-2", name: "read", output: "done", status: "ok" },
  "a factual terminal event may render without inventing a missing start event",
);

const entry = {
  runtimeKey: "gateway-abc",
  protocol: 4,
  serverVersion: "2026.7.24",
  schema: "openclaw.session-tool.v1",
  supported: true,
  observedAt: 100,
  expiresAt: 10_000,
};
const validCache = createOpenClawCapabilityCache([entry]);
assert.deepEqual(readVerifiedOpenClawCapabilityCache(JSON.stringify(validCache), 500), [entry]);
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
gateway.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "fixture" } }));
  socket.on("message", (raw) => {
    const request = JSON.parse(raw.toString());
    if (request.method === "connect") {
      assert.deepEqual(request.params.caps, ["tool-events"]);
      assert.deepEqual(request.params.scopes, ["operator.read"]);
      socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, payload: hello }));
    }
    if (request.method === "sessions.messages.subscribe") {
      assert.deepEqual(request.params, { key: "cave-session", agentId: "nova" });
      socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, payload: {} }));
      socket.send(JSON.stringify(startFrame));
    }
  });
});
const previousGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
const previousGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
process.env.OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${address.port}`;
process.env.OPENCLAW_GATEWAY_TOKEN = "fixture-token";
try {
  const subscription = await subscribeOpenClawGatewayToolEvents({
    sessionKey: "cave-session",
    agentId: "nova",
    persistCapabilityCache: false,
    onToolEvent: (event) => receivedFrames.push(event),
  });
  assert.equal(subscription.active, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(receivedFrames, [
    {
      id: "call-1",
      name: "exec",
      phase: "start",
      input: '{\n  "command": "pwd"\n}',
      isError: false,
      seq: 1,
      timestamp: 1_000,
    },
  ]);
  subscription.close();
} finally {
  if (previousGatewayUrl === undefined) delete process.env.OPENCLAW_GATEWAY_URL;
  else process.env.OPENCLAW_GATEWAY_URL = previousGatewayUrl;
  if (previousGatewayToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
  else process.env.OPENCLAW_GATEWAY_TOKEN = previousGatewayToken;
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
}

console.log("openclaw-tool-events.test.ts: ok");
