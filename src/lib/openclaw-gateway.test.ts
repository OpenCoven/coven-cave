// @ts-nocheck
import assert from "node:assert/strict";
import {
  dispatchOpenClawGatewayTurn,
  normalizeOpenClawGatewayChatEvent,
  openClawGatewayPairedDeviceAuthStatus,
  textFromOpenClawGatewayMessage,
} from "./openclaw-gateway.ts";

const expected = {
  runId: "run-accepted",
  sessionKey: "agent:nova:explicit:cave-123",
  agentId: "nova",
};

const delta = {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 4,
  state: "delta",
  deltaText: "Hello",
};

assert.deepEqual(
  normalizeOpenClawGatewayChatEvent(delta, expected),
  delta,
  "published v4 chat deltas remain available to the run that Gateway accepted",
);

assert.equal(
  normalizeOpenClawGatewayChatEvent({ ...delta, runId: "another-run" }, expected),
  null,
  "a valid frame from another run in the exact same session must never reach this turn",
);
assert.equal(
  normalizeOpenClawGatewayChatEvent({ ...delta, agentId: "other-agent" }, expected),
  null,
  "agent-scoped routing is required in addition to canonical session keys",
);
const { agentId: _omittedAgentId, ...chatEventWithoutAgentId } = delta;
assert.equal(
  normalizeOpenClawGatewayChatEvent(chatEventWithoutAgentId, expected),
  null,
  "frames without the dispatched agent id cannot be attributed to this turn",
);
assert.equal(
  normalizeOpenClawGatewayChatEvent({ ...delta, seq: "4" }, expected),
  null,
  "the official schema rejects malformed sequence values before lifecycle reconciliation",
);
assert.equal(
  normalizeOpenClawGatewayChatEvent({ ...delta, state: "tool" }, expected),
  null,
  "unpublished tool payload shapes fail closed instead of becoming cards",
);

assert.equal(textFromOpenClawGatewayMessage("plain"), undefined);
assert.equal(textFromOpenClawGatewayMessage({ text: "envelope" }), undefined);
assert.equal(
  textFromOpenClawGatewayMessage({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
  undefined,
  "the published ChatEvent schema leaves message opaque, so its observed contents must not reach Cave output",
);
assert.equal(textFromOpenClawGatewayMessage({ raw: "not published" }), undefined);
assert.deepEqual(
  openClawGatewayPairedDeviceAuthStatus(),
  {
    available: false,
    reason: "Cave has no cross-platform OS-backed paired-device credential store for OpenClaw Gateway dispatch",
  },
  "Cave must not activate the Gateway route before its host-owned paired-device credentials are secure",
);

const missingRequestId = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: () => assert.fail("a Gateway without a Cave request id must not emit events"),
  clientFactory: () => assert.fail("a Gateway without a Cave request id must not connect"),
});
assert.deepEqual(
  missingRequestId,
  { kind: "unavailable", reason: "Gateway dispatch requires a Cave request id" },
  "without a stable Cave request id the route retains the CLI fallback",
);

const unpairedDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "cave-request-unpaired",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    OPENCLAW_GATEWAY_TOKEN: "must-not-activate-direct-dispatch",
  },
  onEvent: () => assert.fail("an unpaired Gateway must not emit events"),
});
assert.deepEqual(
  unpairedDispatch,
  {
    kind: "unavailable",
    reason: "Cave has no cross-platform OS-backed paired-device credential store for OpenClaw Gateway dispatch",
  },
  "an environment token alone must never activate a write-capable Gateway dispatch",
);

let stoppedAfterStartupFailure = false;
const startupFailure = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "cave-request-startup-failure",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: () => assert.fail("a Gateway that fails to start must not emit events"),
  clientFactory: () => ({
    start() {
      throw new Error("Gateway client startup failed");
    },
    stop() {
      stoppedAfterStartupFailure = true;
    },
    async request() {
      assert.fail("a Gateway that failed to start must not dispatch");
    },
  }),
});
assert.deepEqual(
  startupFailure,
  { kind: "unavailable", reason: "Gateway client startup failed" },
  "a pre-dispatch client startup failure retains the CLI fallback",
);
assert.equal(stoppedAfterStartupFailure, true, "a partially started Gateway client is stopped before fallback");

// The direct dispatcher is tested through the same official-client callback
// contract that production uses: it waits for hello and subscription, binds
// the acknowledged run id, and ignores a foreign run with the same session.
let clientOptions;
const emitted = [];
const dispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "cave-request-123",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    OPENCLAW_GATEWAY_TOKEN: "must-not-reach-the-client",
    OPENCLAW_GATEWAY_DEVICE_TOKEN: "must-not-reach-the-client",
  },
  onEvent: (event) => emitted.push(event),
  clientFactory: (options) => {
    clientOptions = options;
    assert.equal(options.token, undefined, "Gateway process tokens must not reach the client");
    assert.equal(options.deviceToken, undefined, "Gateway process device tokens must not reach the client");
    assert.deepEqual(
      options.env,
      { NODE_ENV: process.env.NODE_ENV ?? "production" },
      "Gateway auth must not inherit Cave's process environment",
    );
    assert.equal(options.caps, undefined, "chat-only dispatch must not request unpublished tool-event capabilities");
    return {
      start() {
        queueMicrotask(() =>
          options.onHelloOk?.({
            type: "hello-ok",
            protocol: 4,
            server: { version: "2026.7.2-beta.4", connId: "test-connection" },
            features: {
              methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
              events: ["chat"],
              capabilities: ["chat-send-routing-contract"],
            },
            snapshot: {
              presence: [],
              health: {},
              stateVersion: { presence: 0, health: 0 },
              uptimeMs: 0,
            },
            auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
            policy: { maxPayload: 1024, maxBufferedBytes: 1024, tickIntervalMs: 1000 },
          }),
        );
      },
      stop() {},
      async request(method, params, requestOptions) {
        if (method === "chat.send") {
          assert.equal(params.idempotencyKey, "cave-request-123", "Gateway receives Cave's stable request id");
          requestOptions?.onSent?.();
          queueMicrotask(() => {
            options.onEvent?.({
              type: "event",
              event: "chat",
              payload: { ...delta, runId: "foreign-run", seq: 0 },
            });
            options.onEvent?.({
              type: "event",
              event: "chat",
              payload: { ...delta, seq: 0 },
            });
            options.onEvent?.({
              type: "event",
              event: "chat",
              payload: {
                runId: expected.runId,
                sessionKey: expected.sessionKey,
                agentId: expected.agentId,
                seq: 1,
                state: "final",
                message: { text: "Hello" },
              },
            });
          });
          return { runId: expected.runId };
        }
        return { subscribed: true, key: expected.sessionKey };
      },
    };
  },
});

assert.equal(dispatch.kind, "accepted", "a documented accepted run id enables Gateway ownership");
assert.equal(clientOptions.caps, undefined, "chat-only dispatch must not request unpublished tool-event capabilities");
assert.equal(clientOptions.minProtocol, 4);
assert.equal(clientOptions.maxProtocol, 4);
if (dispatch.kind === "accepted") {
  assert.deepEqual(await dispatch.done, { state: "final" });
}
assert.deepEqual(
  emitted.filter((event) => event.kind === "delta"),
  [{ kind: "delta", text: "Hello", replace: false }],
  "only the accepted run reaches Cave output; a foreign same-session run is rejected",
);
assert.ok(
  emitted.some((event) => event.kind === "final" && !("text" in event)),
  "an opaque final message never becomes assistant-visible text",
);

const missingRoutingCapability = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "capability check",
  idempotencyKey: "cave-request-missing-routing-capability",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: () => assert.fail("an incompatible Gateway must not emit events"),
  clientFactory: (options) => ({
    start() {
      queueMicrotask(() => options.onHelloOk?.({
        ...helloOk(),
        features: {
          ...helloOk().features,
          capabilities: [],
        },
      }));
    },
    stop() {},
    async request() {
      assert.fail("a Gateway without the routing capability must not dispatch");
    },
  }),
});
assert.deepEqual(
  missingRoutingCapability,
  {
    kind: "unavailable",
    reason: "Gateway does not advertise the required chat-send-routing-contract capability",
  },
  "agent and session routing must not be trusted without the published routing capability",
);

const gappedEvents = [];
const gappedDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "gap",
  idempotencyKey: "cave-request-gap",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: (event) => gappedEvents.push(event),
  clientFactory: (options) => ({
    start() { queueMicrotask(() => options.onHelloOk?.(helloOk())); },
    stop() {},
    async request(method, _params, requestOptions) {
      if (method === "chat.send") {
        requestOptions?.onSent?.();
        queueMicrotask(() => options.onEvent?.({
          type: "event",
          event: "chat",
          payload: { ...delta, seq: 1 },
        }));
        return { runId: expected.runId };
      }
      return { subscribed: true };
    },
  }),
});
if (gappedDispatch.kind === "accepted") {
  assert.deepEqual(
    await gappedDispatch.done,
    { state: "error", message: "Gateway event sequence gap" },
    "the first accepted event must be sequence zero; otherwise the Gateway turn is incomplete",
  );
}
assert.deepEqual(gappedEvents, [{ kind: "error", message: "Gateway event sequence gap" }]);

// A reconnect is not an excuse to trust an event before the documented
// session subscription returns. A callback delivered while the old socket is
// closed has no transport-generation provenance, so it is dropped rather
// than being replayed after the next subscription succeeds.
let reconnectOptions;
let releaseFirstResubscribe;
let releaseSecondResubscribe;
let subscriptionCalls = 0;
const reconnectEvents = [];
const reconnectDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello again",
  idempotencyKey: "cave-request-reconnect",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => reconnectEvents.push(event),
  clientFactory: (options) => {
    reconnectOptions = options;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") {
          subscriptionCalls += 1;
          if (subscriptionCalls === 1) return { subscribed: true };
          return new Promise((resolve) => {
            if (subscriptionCalls === 2) releaseFirstResubscribe = () => resolve({ subscribed: true });
            else releaseSecondResubscribe = () => resolve({ subscribed: true });
          });
        }
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});

function helloOk() {
  return {
    type: "hello-ok",
    protocol: 4,
    server: { version: "2026.7.2-beta.4", connId: "reconnect-connection" },
    features: {
      methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
      events: ["chat"],
      capabilities: ["chat-send-routing-contract"],
    },
    snapshot: {
      presence: [],
      health: {},
      stateVersion: { presence: 0, health: 0 },
      uptimeMs: 0,
    },
    auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
    policy: { maxPayload: 1024, maxBufferedBytes: 1024, tickIntervalMs: 1000 },
  };
}

assert.equal(reconnectDispatch.kind, "accepted");
// The published client reports a failed *reconnect attempt* through
// onConnectError before it retries. That must not terminate a Gateway-owned
// run; a subsequent authenticated hello restores the subscription.
reconnectOptions.onConnectError?.(new Error("transient reconnect failure"));
reconnectOptions.onClose?.(1006, "network reset");
reconnectOptions.onEvent?.({ type: "event", event: "chat", payload: { ...delta, seq: 0 } });
assert.deepEqual(
  reconnectEvents,
  [],
  "a closed transport cannot project a buffered frame before its reconnect hello re-subscribes",
);
reconnectOptions.onHelloOk?.(helloOk());
reconnectOptions.onHelloOk?.(helloOk());
reconnectOptions.onEvent?.({ type: "event", event: "chat", payload: { ...delta, seq: 0 } });
await Promise.resolve();
assert.deepEqual(reconnectEvents, [], "a pre-subscription reconnect frame is not projected");
releaseFirstResubscribe();
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(reconnectEvents, [], "a stale reconnect subscription cannot reopen a newer connection's stream");
releaseSecondResubscribe();
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(
  reconnectEvents,
  [],
  "a frame delivered after transport close is never replayed on the reconnected stream",
);
reconnectOptions.onEvent?.({ type: "event", event: "chat", payload: { ...delta, seq: 0 } });
assert.deepEqual(
  reconnectEvents,
  [{ kind: "delta", text: "Hello", replace: false }],
  "a new frame is projected only after re-subscription succeeds",
);
reconnectOptions.onEvent?.({
  type: "event",
  event: "chat",
  payload: {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 1,
    state: "final",
    message: { text: "done" },
  },
});
if (reconnectDispatch.kind === "accepted") {
  assert.deepEqual(await reconnectDispatch.done, { state: "final" });
}

console.log("openclaw Gateway run correlation tests passed");
