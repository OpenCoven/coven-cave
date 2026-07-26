// @ts-nocheck
import assert from "node:assert/strict";
import {
  dispatchOpenClawGatewayTurn,
  normalizeOpenClawGatewayChatEvent,
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

assert.equal(textFromOpenClawGatewayMessage("plain"), "plain");
assert.equal(textFromOpenClawGatewayMessage({ text: "envelope" }), "envelope");
assert.equal(
  textFromOpenClawGatewayMessage({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
  "ab",
);
assert.equal(textFromOpenClawGatewayMessage({ raw: "not published" }), undefined);

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
  },
  onEvent: (event) => emitted.push(event),
  clientFactory: (options) => {
    clientOptions = options;
    assert.equal(options.caps, undefined, "chat-only dispatch must not request unpublished tool-event capabilities");
    return {
      start() {
        queueMicrotask(() =>
          options.onHelloOk?.({
            type: "hello-ok",
            protocol: 4,
            server: { version: "2026.7.2-beta.4", connId: "test-connection" },
            features: { methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"], events: ["chat"] },
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
  assert.deepEqual(await dispatch.done, { state: "final", message: "Hello" });
}
assert.deepEqual(
  emitted.filter((event) => event.kind === "delta"),
  [{ kind: "delta", text: "Hello", replace: false }],
  "only the accepted run reaches Cave output; a foreign same-session run is rejected",
);

// A reconnect is not an excuse to trust an event before the documented
// session subscription returns. The queued frame is accepted only after the
// re-subscription succeeds.
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
    features: { methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"], events: ["chat"] },
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
  [{ kind: "delta", text: "Hello", replace: false }],
  "the queued frame is projected after re-subscription succeeds",
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
  assert.deepEqual(await reconnectDispatch.done, { state: "final", message: "done" });
}

console.log("openclaw Gateway run correlation tests passed");
