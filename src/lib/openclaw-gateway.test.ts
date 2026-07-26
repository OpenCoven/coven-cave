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

// The direct dispatcher is tested through the same official-client callback
// contract that production uses: it waits for hello and subscription, binds
// the acknowledged run id, and ignores a foreign run with the same session.
let clientOptions;
const emitted = [];
const dispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => emitted.push(event),
  clientFactory: (options) => {
    clientOptions = options;
    return {
      start() {
        queueMicrotask(() =>
          options.onHelloOk?.({
            protocol: 4,
            features: { methods: ["chat.send", "sessions.messages.subscribe"], events: ["chat"] },
            auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
          }),
        );
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "chat.send") {
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
assert.equal(clientOptions.caps?.[0], "tool-events", "the official client requests tool events without parsing unpublished tools");
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

console.log("openclaw Gateway run correlation tests passed");
