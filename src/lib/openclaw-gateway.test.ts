// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dispatchOpenClawGatewayTurn,
  normalizeOpenClawGatewayChatEvent,
  openClawGatewayPairedDeviceAuthStatus,
  textFromOpenClawGatewayMessage,
} from "./openclaw-gateway.ts";
import {
  loadOpenClawCompatibility,
  openClawDiscoveryFromHello,
  redactedOpenClawToolFingerprint,
} from "./openclaw-compatibility.ts";
import { createOpenClawDeviceCredentialStore } from "./server/openclaw-device-credentials.ts";

const gatewayBeta4 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta4.json", import.meta.url), "utf8"),
);
const gatewayBeta5 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const toolLifecycleV1 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/tool-lifecycle-v1.json", import.meta.url), "utf8"),
);

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
  openClawGatewayPairedDeviceAuthStatus(createOpenClawDeviceCredentialStore({ platform: "linux" })),
  {
    available: false,
    reason:
      "OpenClaw Gateway dispatch requires the macOS Keychain credential store; linux has no supported OS credential store",
  },
  "platforms without an OS credential store must not activate the Gateway route",
);
assert.deepEqual(
  openClawGatewayPairedDeviceAuthStatus(
    createOpenClawDeviceCredentialStore({ platform: "darwin", securityBinaryExists: () => false }),
  ),
  { available: false, reason: "The macOS security tool is unavailable for the OpenClaw credential store" },
  "a macOS host without the security tool fails closed instead of degrading to env tokens",
);
assert.deepEqual(
  openClawGatewayPairedDeviceAuthStatus(
    createOpenClawDeviceCredentialStore({
      platform: "darwin",
      securityBinaryExists: () => true,
      runSecurity: () => assert.fail("a status probe must not touch the keychain"),
    }),
  ),
  { available: true },
  "a macOS host with the security tool reports paired-device auth as available without keychain reads",
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
  credentialStore: createOpenClawDeviceCredentialStore({ platform: "linux" }),
});
assert.deepEqual(
  unpairedDispatch,
  {
    kind: "unavailable",
    reason:
      "OpenClaw Gateway dispatch requires the macOS Keychain credential store; linux has no supported OS credential store",
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
// contract that production uses: it discovers without capabilities, reconnects
// with the selected profile, subscribes before send, binds the acknowledged
// run id, and ignores a foreign run with the same session.
const createdOptions = [];
const gatewayRequests = [];
const gatewayLifecycle = [];
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
    const clientIndex = createdOptions.push(options) - 1;
    gatewayLifecycle.push(["construct", clientIndex]);
    assert.equal(options.token, undefined, "Gateway process tokens must not reach the client");
    assert.equal(options.deviceToken, undefined, "Gateway process device tokens must not reach the client");
    assert.deepEqual(
      options.env,
      { NODE_ENV: process.env.NODE_ENV ?? "production" },
      "Gateway auth must not inherit Cave's process environment",
    );
    return {
      start() {
        gatewayLifecycle.push(["start", clientIndex]);
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {
        gatewayLifecycle.push(["stop", clientIndex]);
      },
      async request(method, params, requestOptions) {
        gatewayRequests.push({ clientIndex, method, params });
        gatewayLifecycle.push(["request", clientIndex, method]);
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
assert.equal(createdOptions.length, 2, "Gateway dispatch uses separate discovery and dispatch clients");
assert.equal(createdOptions[0].caps, undefined, "discovery must not advertise tool events");
assert.deepEqual(createdOptions[1].caps, ["tool-events"], "dispatch advertises only the selected profile capabilities");
assert.equal(createdOptions[0].minProtocol, 4);
assert.equal(createdOptions[0].maxProtocol, 4);
assert.equal(createdOptions[1].minProtocol, 4);
assert.equal(createdOptions[1].maxProtocol, 4);
assert.equal(
  gatewayRequests.some((entry) => entry.clientIndex === 0 && entry.method === "chat.send"),
  false,
  "the discovery client can never dispatch",
);
assert.deepEqual(
  gatewayRequests.map(({ clientIndex, method }) => ({ clientIndex, method })),
  [
    { clientIndex: 1, method: "sessions.messages.subscribe" },
    { clientIndex: 1, method: "chat.send" },
  ],
  "only the dispatch client subscribes, and subscription completes before chat.send",
);
assert.ok(
  gatewayLifecycle.findIndex(([operation, index]) => operation === "stop" && index === 0)
    < gatewayLifecycle.findIndex(([operation, index]) => operation === "construct" && index === 1),
  "discovery is stopped before the capability-enabled client is constructed",
);
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

async function assertNegotiationUnavailable({
  id,
  hellos,
  compatibilitySource,
  expectedReason,
}) {
  const options = [];
  const requests = [];
  const stopped = [];
  const result = await dispatchOpenClawGatewayTurn({
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    message: id,
    idempotencyKey: `cave-request-${id}`,
    env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
    onEvent: () => assert.fail(`${id} must fail before Gateway event projection`),
    compatibilitySource,
    clientFactory: (clientOptions) => {
      const clientIndex = options.push(clientOptions) - 1;
      return {
        start() {
          const hello = hellos[clientIndex] ?? hellos.at(-1);
          queueMicrotask(() => clientOptions.onHelloOk?.(structuredClone(hello)));
        },
        stop() {
          stopped.push(clientIndex);
        },
        async request(method, params, requestOptions) {
          requests.push({ clientIndex, method, params });
          if (method === "chat.send") {
            requestOptions?.onSent?.();
            return { runId: expected.runId };
          }
          return { subscribed: true };
        },
      };
    },
  });
  assert.equal(result.kind, "unavailable", `${id} must retain the CLI fallback`);
  if (expectedReason) assert.equal(result.reason, expectedReason);
  assert.equal(
    requests.some((entry) => entry.method === "chat.send"),
    false,
    `${id} must fail before chat.send`,
  );
  assert.deepEqual(
    [...new Set(stopped)].sort(),
    options.map((_, clientIndex) => clientIndex),
    `${id} must stop every client it constructed`,
  );
  return { options, requests, stopped };
}

const beta4Unavailable = await assertNegotiationUnavailable({
  id: "beta4-no-profile",
  hellos: [gatewayBeta4],
  expectedReason: "OpenClaw tool compatibility: no-compatible-profile",
});
assert.equal(beta4Unavailable.options.length, 1, "an unsupported discovery never creates a dispatch client");

const changedVersion = await assertNegotiationUnavailable({
  id: "changed-version",
  hellos: [
    helloOk(),
    { ...helloOk(), server: { ...helloOk().server, version: "2026.7.2-beta.6" } },
  ],
  expectedReason: "OpenClaw Gateway changed during compatibility negotiation",
});
assert.deepEqual(changedVersion.options.map((options) => options.caps), [undefined, ["tool-events"]]);

for (const missingEvent of ["agent", "session.tool"]) {
  const secondHello = helloOk();
  secondHello.features.events = secondHello.features.events.filter((event) => event !== missingEvent);
  const missing = await assertNegotiationUnavailable({
    id: `missing-${missingEvent}`,
    hellos: [helloOk(), secondHello],
    expectedReason: "OpenClaw Gateway changed during compatibility negotiation",
  });
  assert.deepEqual(missing.options.map((options) => options.caps), [undefined, ["tool-events"]]);
}

for (const [id, secondHello] of [
  ["operator-scope", {
    ...helloOk(),
    auth: { ...helloOk().auth, scopes: ["operator.read"] },
  }],
  ["chat-abort-method", {
    ...helloOk(),
    features: {
      ...helloOk().features,
      methods: helloOk().features.methods.filter((method) => method !== "chat.abort"),
    },
  }],
  ["session-subscribe-method", {
    ...helloOk(),
    features: {
      ...helloOk().features,
      methods: helloOk().features.methods.filter((method) => method !== "sessions.messages.subscribe"),
    },
  }],
  ["routing-capability", {
    ...helloOk(),
    features: { ...helloOk().features, capabilities: [] },
  }],
]) {
  const missing = await assertNegotiationUnavailable({
    id: `missing-${id}`,
    hellos: [helloOk(), secondHello],
  });
  assert.deepEqual(missing.options.map((options) => options.caps), [undefined, ["tool-events"]]);
}

const beta6Hello = {
  ...helloOk(),
  server: { ...helloOk().server, version: "2026.7.2-beta.6" },
};
const registryUnavailable = await assertNegotiationUnavailable({
  id: "registry-unavailable",
  hellos: [beta6Hello],
  compatibilitySource: {
    url: "http://registry.example/openclaw/current.json",
    publicKeys: { invalid: "not-an-ed25519-public-key" },
  },
  expectedReason: "OpenClaw tool compatibility: profile-registry-refresh-rejected",
});
assert.equal(registryUnavailable.options.length, 1, "a failed registry with no usable profile never creates dispatch");

let credentialFailureClients = 0;
const negotiationCredentialFailure = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "credential failure",
  idempotencyKey: "cave-request-negotiation-credential-failure",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: () => assert.fail("a credential-store failure must not emit events"),
  credentialStore: {
    status: () => ({ available: true }),
    loadOrCreateDeviceIdentity: () => {
      throw new Error("OpenClaw credential-store failure");
    },
  },
  clientFactory: () => {
    credentialFailureClients += 1;
    assert.fail("a credential-store failure must not construct either Gateway client");
  },
});
assert.deepEqual(
  negotiationCredentialFailure,
  { kind: "unavailable", reason: "OpenClaw credential-store failure" },
);
assert.equal(credentialFailureClients, 0);

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

let preAckGapClientCount = 0;
let preAckGapStops = 0;
const preAckGapEvents = [];
const preAckGapDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "gap after send before acknowledgement",
  idempotencyKey: "cave-request-pre-ack-gap",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: (event) => preAckGapEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = preAckGapClientCount++;
    return {
      start() { queueMicrotask(() => options.onHelloOk?.(helloOk())); },
      stop() {
        if (clientIndex === 1) preAckGapStops += 1;
      },
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          options.onGap?.({ expected: 1, received: 2 });
          options.onEvent?.({
            type: "event",
            event: "chat",
            payload: {
              runId: expected.runId,
              sessionKey: expected.sessionKey,
              agentId: expected.agentId,
              seq: 0,
              state: "final",
            },
          });
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});
assert.deepEqual(
  preAckGapDispatch,
  { kind: "indeterminate", reason: "Gateway transport sequence gap" },
  "a post-send pre-acknowledgement gap forbids CLI fallback even if chat.send later returns a run id",
);
assert.deepEqual(
  preAckGapEvents,
  [],
  "a terminal frame queued after the authoritative pre-acknowledgement gap is never projected",
);
assert.ok(preAckGapStops > 0, "a pre-acknowledgement gap stops the dispatch stream");

let preSendGapClientCount = 0;
let preSendGapChatSends = 0;
const preSendGapEvents = [];
const preSendGapDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "gap before send",
  idempotencyKey: "cave-request-pre-send-gap",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: (event) => preSendGapEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = preSendGapClientCount++;
    return {
      start() { queueMicrotask(() => options.onHelloOk?.(helloOk())); },
      stop() {},
      async request(method) {
        if (method === "sessions.messages.subscribe") {
          assert.equal(clientIndex, 1);
          options.onGap?.({ expected: 1, received: 2 });
          return { subscribed: true };
        }
        if (method === "chat.send") preSendGapChatSends += 1;
        return { runId: expected.runId };
      },
    };
  },
});
assert.deepEqual(
  preSendGapDispatch,
  { kind: "unavailable", reason: "Gateway transport sequence gap" },
  "a transport gap before chat.send retains the CLI fallback",
);
assert.equal(preSendGapChatSends, 0, "a pre-send transport gap never dispatches");
assert.deepEqual(preSendGapEvents, [], "a pre-send transport gap does not project an accepted-run error");

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
  return structuredClone(gatewayBeta5);
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

let settledLifecycleOptions;
let settledLifecycleClientCount = 0;
const settledLifecycleEvents = [];
const settledLifecycleDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "ignore lifecycle callbacks after final",
  idempotencyKey: "cave-request-settled-lifecycle",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => settledLifecycleEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = settledLifecycleClientCount++;
    if (clientIndex === 1) settledLifecycleOptions = options;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});

assert.equal(settledLifecycleDispatch.kind, "accepted");
settledLifecycleOptions.onEvent?.({
  type: "event",
  event: "chat",
  payload: {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 0,
    state: "final",
  },
});
if (settledLifecycleDispatch.kind === "accepted") {
  const finalResult = await settledLifecycleDispatch.done;
  settledLifecycleOptions.onClose?.(1006, "late close");
  settledLifecycleOptions.onConnectError?.(new Error("late reconnect failure"));
  settledLifecycleOptions.onHelloOk?.({
    ...helloOk(),
    server: { ...helloOk().server, version: "2026.7.2-beta.6" },
  });
  settledLifecycleOptions.onHelloOk?.({});
  settledLifecycleOptions.onReconnectPaused?.({ attempts: 1, elapsedMs: 1 });
  await Promise.resolve();
  assert.deepEqual(
    settledLifecycleEvents,
    [{ kind: "final" }],
    "lifecycle callbacks after a terminal event cannot project a new user-visible error",
  );
  assert.deepEqual(
    await settledLifecycleDispatch.done,
    finalResult,
    "lifecycle callbacks after a terminal event cannot replace the final result",
  );
}

let pendingAckOptions;
let resolvePendingAckSend;
let markPendingAckSendStarted;
let pendingAckClientCount = 0;
const pendingAckEvents = [];
const pendingAckSendStarted = new Promise((resolve) => {
  markPendingAckSendStarted = resolve;
});
const pendingAckDispatchPromise = dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "pending acknowledgement reconnect",
  idempotencyKey: "cave-request-pending-ack-reconnect",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => pendingAckEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = pendingAckClientCount++;
    if (clientIndex === 1) pendingAckOptions = options;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          markPendingAckSendStarted();
          return new Promise((resolve) => {
            resolvePendingAckSend = resolve;
          });
        }
        return {};
      },
    };
  },
});

await pendingAckSendStarted;
pendingAckOptions.onClose?.(1006, "network reset before acknowledgement");
pendingAckOptions.onEvent?.({
  type: "event",
  event: "chat",
  payload: { ...delta, seq: 0 },
});
pendingAckOptions.onHelloOk?.(helloOk());
await Promise.resolve();
await Promise.resolve();
resolvePendingAckSend({ runId: expected.runId });
const pendingAckDispatch = await pendingAckDispatchPromise;
assert.equal(pendingAckDispatch.kind, "accepted");
assert.deepEqual(
  pendingAckEvents,
  [],
  "a closed transport's pre-acknowledgement frame is never drained after reconnect",
);
pendingAckOptions.onEvent?.({
  type: "event",
  event: "chat",
  payload: { ...delta, seq: 0 },
});
pendingAckOptions.onEvent?.({
  type: "event",
  event: "chat",
  payload: {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 1,
    state: "final",
  },
});
if (pendingAckDispatch.kind === "accepted") {
  assert.deepEqual(await pendingAckDispatch.done, { state: "final" });
}

let overflowClientCount = 0;
let overflowDispatchStops = 0;
const overflowEvents = [];
const overflowDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "overflow pre-acknowledgement queue",
  idempotencyKey: "cave-request-pre-ack-overflow",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => overflowEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = overflowClientCount++;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {
        if (clientIndex === 1) overflowDispatchStops += 1;
      },
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          for (let seq = 0; seq <= 128; seq += 1) {
            options.onEvent?.({
              type: "event",
              event: "chat",
              payload: seq === 128
                ? {
                    runId: expected.runId,
                    sessionKey: expected.sessionKey,
                    agentId: expected.agentId,
                    seq,
                    state: "final",
                  }
                : { ...delta, seq, deltaText: `chunk-${seq}` },
            });
          }
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});

assert.equal(overflowDispatch.kind, "accepted");
assert.deepEqual(
  overflowEvents.filter((event) => event.kind === "error"),
  [{ kind: "error", message: "Gateway pre-acknowledgement event buffer overflow" }],
  "an accepted dispatch reports pre-acknowledgement overflow instead of silently dropping its terminal frame",
);
assert.equal(
  overflowEvents.some((event) => event.kind === "delta"),
  false,
  "an overflowed pre-acknowledgement queue does not project a partial response",
);
if (overflowDispatch.kind === "accepted") {
  assert.deepEqual(
    await overflowDispatch.done,
    { state: "error", message: "Gateway pre-acknowledgement event buffer overflow" },
  );
}
assert.ok(overflowDispatchStops > 0, "pre-acknowledgement overflow stops the dispatch client");

let abortClientCount = 0;
let abortDispatchStops = 0;
const abortEvents = [];
const abortRejectingDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "abort rejection",
  idempotencyKey: "cave-request-abort-rejection",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => abortEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = abortClientCount++;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {
        if (clientIndex === 1) abortDispatchStops += 1;
      },
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          return { runId: expected.runId };
        }
        if (method === "chat.abort") throw new Error("Gateway abort transport failed");
        return {};
      },
    };
  },
});

assert.equal(abortRejectingDispatch.kind, "accepted");
if (abortRejectingDispatch.kind === "accepted") {
  await assert.doesNotReject(
    () => abortRejectingDispatch.abort(),
    "abort remains fire-and-forget after the turn has settled locally",
  );
  assert.deepEqual(
    await abortRejectingDispatch.done,
    { state: "aborted", message: "Cancelled by user" },
  );
}
assert.deepEqual(abortEvents, [{ kind: "aborted", message: "Cancelled by user" }]);
assert.ok(abortDispatchStops > 0, "an abort transport rejection still stops the dispatch client");

for (const [driftId, driftHello] of [
  ["version", {
    ...helloOk(),
    server: { ...helloOk().server, version: "2026.7.2-beta.6" },
  }],
  ["events", {
    ...helloOk(),
    features: {
      ...helloOk().features,
      events: helloOk().features.events.filter((event) => event !== "agent"),
    },
  }],
  ["methods", {
    ...helloOk(),
    features: {
      ...helloOk().features,
      methods: helloOk().features.methods.filter((method) => method !== "chat.abort"),
    },
  }],
]) {
  let dispatchOptions;
  let clientCount = 0;
  let dispatchStops = 0;
  let subscriptionCalls = 0;
  const driftEvents = [];
  const driftDispatch = await dispatchOpenClawGatewayTurn({
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    message: `reconnect ${driftId} drift`,
    idempotencyKey: `cave-request-reconnect-${driftId}-drift`,
    env: {
      OPENCLAW_GATEWAY_DISPATCH: "1",
      OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    },
    onEvent: (event) => driftEvents.push(event),
    clientFactory: (options) => {
      const clientIndex = clientCount++;
      if (clientIndex === 1) dispatchOptions = options;
      return {
        start() {
          queueMicrotask(() => options.onHelloOk?.(helloOk()));
        },
        stop() {
          if (clientIndex === 1) dispatchStops += 1;
        },
        async request(method, _params, requestOptions) {
          if (method === "sessions.messages.subscribe") {
            subscriptionCalls += 1;
            return { subscribed: true };
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

  assert.equal(driftDispatch.kind, "accepted");
  const subscriptionsBeforeDrift = subscriptionCalls;
  dispatchOptions.onClose?.(1006, "network reset");
  dispatchOptions.onHelloOk?.(structuredClone(driftHello));
  assert.deepEqual(
    driftEvents,
    [{ kind: "error", message: "OpenClaw Gateway changed during compatibility negotiation" }],
    `a reconnect ${driftId} drift fails the Gateway-owned turn safely`,
  );
  if (driftDispatch.kind === "accepted") {
    assert.deepEqual(
      await driftDispatch.done,
      { state: "error", message: "OpenClaw Gateway changed during compatibility negotiation" },
    );
  }
  assert.equal(
    subscriptionCalls,
    subscriptionsBeforeDrift,
    `a reconnect ${driftId} drift must never resubscribe`,
  );
  assert.ok(dispatchStops > 0, `a reconnect ${driftId} drift stops the dispatch client`);
}

let preSendDriftClientCount = 0;
let preSendDriftChatSends = 0;
let preSendDriftStops = 0;
const preSendDrift = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "pre-send reconnect drift",
  idempotencyKey: "cave-request-pre-send-reconnect-drift",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: () => assert.fail("a pre-send compatibility drift retains fallback without emitting"),
  clientFactory: (options) => {
    const clientIndex = preSendDriftClientCount++;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {
        if (clientIndex === 1) preSendDriftStops += 1;
      },
      async request(method) {
        if (method === "sessions.messages.subscribe") {
          options.onHelloOk?.({
            ...helloOk(),
            server: { ...helloOk().server, version: "2026.7.2-beta.6" },
          });
          return { subscribed: true };
        }
        if (method === "chat.send") preSendDriftChatSends += 1;
        return { runId: expected.runId };
      },
    };
  },
});
assert.deepEqual(
  preSendDrift,
  { kind: "unavailable", reason: "OpenClaw Gateway changed during compatibility negotiation" },
  "a compatibility drift during initial subscription fails before dispatch ownership",
);
assert.equal(preSendDriftChatSends, 0, "a pre-send compatibility drift never calls chat.send");
assert.ok(preSendDriftStops > 0, "a pre-send compatibility drift stops the dispatch client");

let preSendInvalidClientCount = 0;
let preSendInvalidSubscriptions = 0;
let preSendInvalidChatSends = 0;
let preSendInvalidStops = 0;
const preSendInvalidEvents = [];
const preSendInvalid = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "pre-send invalid reauthenticated hello",
  idempotencyKey: "cave-request-pre-send-invalid-hello",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => preSendInvalidEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = preSendInvalidClientCount++;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {
        if (clientIndex === 1) preSendInvalidStops += 1;
      },
      async request(method) {
        if (method === "sessions.messages.subscribe") {
          preSendInvalidSubscriptions += 1;
          if (preSendInvalidSubscriptions === 1) {
            options.onHelloOk?.({});
            return { subscribed: true };
          }
          throw new Error("invalid hello triggered a subscription retry loop");
        }
        if (method === "chat.send") preSendInvalidChatSends += 1;
        return { runId: expected.runId };
      },
    };
  },
});
assert.deepEqual(
  preSendInvalid,
  { kind: "unavailable", reason: "Gateway returned an invalid hello response for the pinned v4 schema" },
  "an invalid reauthenticated hello before send fails through the pre-dispatch lifecycle fence",
);
assert.equal(preSendInvalidSubscriptions, 1, "an invalid pre-send hello never retries subscription");
assert.equal(preSendInvalidChatSends, 0, "an invalid pre-send hello never calls chat.send");
assert.deepEqual(preSendInvalidEvents, [], "an invalid pre-send hello retains fallback without emitting");
assert.ok(preSendInvalidStops > 0, "an invalid pre-send hello stops the dispatch client");

async function createToolGatewayHarness(id) {
  let dispatchOptions;
  let clientCount = 0;
  let subscriptionCalls = 0;
  let stopCalls = 0;
  const events = [];
  const dispatch = await dispatchOpenClawGatewayTurn({
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    message: id,
    idempotencyKey: `cave-request-${id}`,
    env: {
      OPENCLAW_GATEWAY_DISPATCH: "1",
      OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    },
    onEvent: (event) => events.push(event),
    clientFactory: (options) => {
      const clientIndex = clientCount++;
      if (clientIndex === 1) dispatchOptions = options;
      return {
        start() {
          queueMicrotask(() => options.onHelloOk?.(helloOk()));
        },
        stop() {
          if (clientIndex === 1) stopCalls += 1;
        },
        async request(method, _params, requestOptions) {
          if (method === "sessions.messages.subscribe") {
            subscriptionCalls += 1;
            return { subscribed: true };
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
  assert.equal(dispatch.kind, "accepted", `${id} must accept the Gateway run`);
  assert.ok(dispatchOptions, `${id} must expose the dispatch client's callbacks`);
  return {
    dispatch,
    dispatchOptions,
    events,
    subscriptionCalls: () => subscriptionCalls,
    stopCalls: () => stopCalls,
  };
}

function toolPayload(frameIndex, overrides = {}) {
  const fixture = structuredClone(toolLifecycleV1.frames[frameIndex].payload);
  return {
    ...fixture,
    runId: expected.runId,
    ...overrides,
    ...(overrides.data ? { data: { ...fixture.data, ...overrides.data } } : {}),
  };
}

function emitGatewayEvent(options, event, payload) {
  options.onEvent?.({ type: "event", event, payload });
}

const optionalRoutingTools = await createToolGatewayHarness("optional-tool-routing");
const foreignRoutingMarker = "foreign-tool-routing-must-not-project";
const foreignRoutingOverrides = [
  { sessionKey: "agent:other:explicit:foreign" },
  { key: "agent:other:explicit:foreign" },
  { agentId: "other-agent" },
  { session: "foreign-session" },
  { session: null },
  { snapshot: [] },
  { snapshot: null },
  { snapshot: { sessionKey: "agent:other:explicit:foreign" } },
  { snapshot: { key: "agent:other:explicit:foreign" } },
  { snapshot: { agentId: "other-agent" } },
  { snapshot: { session: "foreign-session" } },
  { snapshot: { session: null } },
  { session: { sessionKey: "agent:other:explicit:foreign" } },
  { session: { key: "agent:other:explicit:foreign" } },
  { session: { agentId: "other-agent" } },
];
for (const [index, routing] of foreignRoutingOverrides.entries()) {
  emitGatewayEvent(optionalRoutingTools.dispatchOptions, "agent", toolPayload(0, {
    seq: index + 3,
    ...routing,
    data: {
      toolCallId: `foreign-tool-${index}`,
      args: { command: foreignRoutingMarker },
    },
  }));
}
const validRoutingOverrides = [
  {},
  { session: {} },
  { snapshot: {} },
  { snapshot: { session: {} } },
  {
    session: {
      sessionKey: expected.sessionKey,
      key: expected.sessionKey,
      agentId: expected.agentId,
    },
  },
  {
    snapshot: {
      sessionKey: expected.sessionKey,
      key: expected.sessionKey,
      agentId: expected.agentId,
      session: {
        sessionKey: expected.sessionKey,
        key: expected.sessionKey,
        agentId: expected.agentId,
      },
    },
  },
];
for (const [index, routing] of validRoutingOverrides.entries()) {
  emitGatewayEvent(optionalRoutingTools.dispatchOptions, "agent", toolPayload(0, {
    seq: index + 20,
    ...routing,
    data: {
      toolCallId: `valid-tool-${index}`,
      args: { command: `echo valid ${index}` },
    },
  }));
}
emitGatewayEvent(optionalRoutingTools.dispatchOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 0,
  state: "final",
});
assert.deepEqual(
  optionalRoutingTools.events,
  [
    ...validRoutingOverrides.map((_routing, index) => ({
      kind: "tool_start",
      id: `valid-tool-${index}`,
      name: "exec",
      input: { command: `echo valid ${index}` },
      seq: index + 20,
    })),
    { kind: "final" },
  ],
  "malformed and foreign routing containers reject selected tool frames while valid or missing containers project",
);
assert.equal(
  JSON.stringify(optionalRoutingTools.events).includes(foreignRoutingMarker),
  false,
  "foreign optional routing fields cannot expose tool payloads from another session",
);
if (optionalRoutingTools.dispatch.kind === "accepted") {
  assert.deepEqual(await optionalRoutingTools.dispatch.done, { state: "final" });
}

const correlatedTools = await createToolGatewayHarness("correlated-tool-lifecycle");
const correlatedOptions = correlatedTools.dispatchOptions;
emitGatewayEvent(correlatedOptions, "future.tool", {
  ...toolPayload(0),
  data: { ...toolPayload(0).data, secret: "unknown outer event must stay private" },
});
emitGatewayEvent(correlatedOptions, "agent", {
  runId: expected.runId,
  seq: 2,
  stream: "assistant",
  ts: 950,
  data: { text: "non-tool agent sequence" },
});
emitGatewayEvent(correlatedOptions, "agent", toolPayload(0, { runId: "foreign-run" }));
emitGatewayEvent(correlatedOptions, "agent", toolPayload(0, {
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  status: "running",
}));
emitGatewayEvent(correlatedOptions, "session.tool", toolPayload(0, {
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  status: "running",
}));
emitGatewayEvent(correlatedOptions, "agent", toolPayload(1, { seq: 2 }));
emitGatewayEvent(correlatedOptions, "session.tool", toolPayload(1, {
  seq: 4,
  sessionKey: "agent:other:explicit:foreign",
  agentId: expected.agentId,
}));
emitGatewayEvent(correlatedOptions, "session.tool", toolPayload(1, {
  seq: 5,
  sessionKey: expected.sessionKey,
  agentId: "other-agent",
}));
emitGatewayEvent(correlatedOptions, "agent", toolPayload(1));
emitGatewayEvent(correlatedOptions, "agent", {
  runId: expected.runId,
  seq: 8,
  stream: "assistant",
  ts: 1150,
  data: { text: "shared upstream sequence" },
});
emitGatewayEvent(correlatedOptions, "session.tool", toolPayload(1, {
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
}));
emitGatewayEvent(correlatedOptions, "agent", toolPayload(2));
emitGatewayEvent(correlatedOptions, "session.tool", toolPayload(3, {
  seq: 12,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
}));
emitGatewayEvent(correlatedOptions, "chat", { ...delta, seq: 0 });
emitGatewayEvent(correlatedOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 1,
  state: "final",
});
assert.deepEqual(
  correlatedTools.events,
  [
    { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
    { kind: "tool_progress", id: "tool-1", output: "hi", seq: 7 },
    {
      kind: "tool_end",
      id: "tool-1",
      name: "exec",
      output: { text: "hi", exitCode: 0 },
      isError: false,
      seq: 9,
    },
    {
      kind: "tool_end",
      id: "tool-2",
      name: "edit",
      output: { status: "failed", text: "validation failed" },
      isError: true,
      seq: 12,
    },
    { kind: "delta", text: "Hello", replace: false },
    { kind: "final" },
  ],
  "only exact-run, exact-session tool lifecycle projects; sparse tool seq remains independent from chat seq",
);
if (correlatedTools.dispatch.kind === "accepted") {
  assert.deepEqual(await correlatedTools.dispatch.done, { state: "final" });
}

let preAckToolOptions;
let preAckToolClientCount = 0;
const preAckToolEvents = [];
const preAckToolDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "pre-ack tool correlation",
  idempotencyKey: "cave-request-pre-ack-tool-correlation",
  env: {
    OPENCLAW_GATEWAY_DISPATCH: "1",
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
  },
  onEvent: (event) => preAckToolEvents.push(event),
  clientFactory: (options) => {
    const clientIndex = preAckToolClientCount++;
    if (clientIndex === 1) preAckToolOptions = options;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          emitGatewayEvent(options, "agent", toolPayload(0, { runId: "foreign-run" }));
          emitGatewayEvent(options, "agent", toolPayload(0));
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});
assert.equal(preAckToolDispatch.kind, "accepted");
assert.deepEqual(
  preAckToolEvents,
  [{ kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 }],
  "bounded pre-acknowledgement tool frames drain only after the accepted run id correlates them",
);
emitGatewayEvent(preAckToolOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 0,
  state: "final",
});
if (preAckToolDispatch.kind === "accepted") {
  assert.deepEqual(await preAckToolDispatch.done, { state: "final" });
}

async function dispatchPreAckOrderedFrames(id, emitFrames) {
  const events = [];
  const dispatch = await dispatchOpenClawGatewayTurn({
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    message: id,
    idempotencyKey: `cave-request-${id}`,
    env: {
      OPENCLAW_GATEWAY_DISPATCH: "1",
      OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    },
    onEvent: (event) => events.push(event),
    clientFactory: (options) => ({
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "sessions.messages.subscribe") return { subscribed: true };
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          emitFrames(options);
          return { runId: expected.runId };
        }
        return {};
      },
    }),
  });
  assert.equal(dispatch.kind, "accepted");
  return { dispatch, events };
}

const preAckFinalThenTool = await dispatchPreAckOrderedFrames("pre-ack-final-then-tool", (options) => {
  emitGatewayEvent(options, "chat", {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 0,
    state: "final",
  });
  emitGatewayEvent(options, "agent", toolPayload(0));
});
assert.deepEqual(
  preAckFinalThenTool.events,
  [{ kind: "final" }],
  "pre-acknowledgement frames preserve final-before-tool arrival order so a later tool frame cannot project",
);
if (preAckFinalThenTool.dispatch.kind === "accepted") {
  assert.deepEqual(await preAckFinalThenTool.dispatch.done, { state: "final" });
}

const preAckToolThenFinal = await dispatchPreAckOrderedFrames("pre-ack-tool-then-final", (options) => {
  emitGatewayEvent(options, "agent", toolPayload(0));
  emitGatewayEvent(options, "chat", {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 0,
    state: "final",
  });
});
assert.deepEqual(
  preAckToolThenFinal.events,
  [
    { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
    { kind: "final" },
  ],
  "pre-acknowledgement frames preserve tool-before-final arrival order",
);
if (preAckToolThenFinal.dispatch.kind === "accepted") {
  assert.deepEqual(await preAckToolThenFinal.dispatch.done, { state: "final" });
}

const mixedPreAckOverflow = await dispatchPreAckOrderedFrames("mixed-pre-ack-overflow", (options) => {
  for (let index = 0; index < 64; index += 1) {
    emitGatewayEvent(options, "agent", toolPayload(0, {
      seq: index + 100,
      data: {
        toolCallId: `mixed-overflow-tool-${index}`,
        args: { command: `echo ${index}` },
      },
    }));
    emitGatewayEvent(options, "chat", { ...delta, seq: index, deltaText: `chunk-${index}` });
  }
  emitGatewayEvent(options, "chat", {
    runId: expected.runId,
    sessionKey: expected.sessionKey,
    agentId: expected.agentId,
    seq: 64,
    state: "final",
  });
});
assert.deepEqual(
  mixedPreAckOverflow.events,
  [{ kind: "error", message: "Gateway pre-acknowledgement event buffer overflow" }],
  "the shared pre-acknowledgement bound fails before projecting any queued chat or tool frame",
);
if (mixedPreAckOverflow.dispatch.kind === "accepted") {
  assert.deepEqual(
    await mixedPreAckOverflow.dispatch.done,
    { state: "error", message: "Gateway pre-acknowledgement event buffer overflow" },
  );
}

const replayedToolSequence = await createToolGatewayHarness("replayed-tool-sequence");
emitGatewayEvent(replayedToolSequence.dispatchOptions, "agent", toolPayload(0));
emitGatewayEvent(replayedToolSequence.dispatchOptions, "agent", toolPayload(1, {
  seq: 2,
  data: {
    phase: "future-replayed-phase",
    partialResult: "stale-malformed-tool-data-must-not-quarantine",
  },
}));
emitGatewayEvent(replayedToolSequence.dispatchOptions, "agent", toolPayload(1));
emitGatewayEvent(replayedToolSequence.dispatchOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 0,
  state: "final",
});
assert.deepEqual(
  replayedToolSequence.events,
  [
    { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
    { kind: "tool_progress", id: "tool-1", output: "hi", seq: 7 },
    { kind: "final" },
  ],
  "a stale malformed AgentEvent is ignored before parsing so a later fresh sparse sequence still projects",
);
if (replayedToolSequence.dispatch.kind === "accepted") {
  assert.deepEqual(await replayedToolSequence.dispatch.done, { state: "final" });
}
assert.equal(
  (await loadOpenClawCompatibility(openClawDiscoveryFromHello(helloOk()))).mode,
  "structured",
  "a stale malformed AgentEvent does not quarantine or disable the selected tool profile",
);

const toolGap = await createToolGatewayHarness("tool-transport-gap");
emitGatewayEvent(toolGap.dispatchOptions, "agent", toolPayload(0));
toolGap.dispatchOptions.onGap?.({ expected: 4, received: 6 });
emitGatewayEvent(toolGap.dispatchOptions, "agent", toolPayload(1));
emitGatewayEvent(toolGap.dispatchOptions, "chat", { ...delta, seq: 0 });
emitGatewayEvent(toolGap.dispatchOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 1,
  state: "final",
});
assert.deepEqual(
  toolGap.events,
  [
    { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
    { kind: "compatibility", code: "tool-event-sequence-gap" },
    { kind: "error", message: "Gateway transport sequence gap" },
  ],
  "an authoritative transport gap settles open tools before terminating the Gateway-owned dispatch",
);
if (toolGap.dispatch.kind === "accepted") {
  assert.deepEqual(
    await toolGap.dispatch.done,
    { state: "error", message: "Gateway transport sequence gap" },
  );
}
assert.ok(toolGap.stopCalls() > 0, "an authoritative transport gap stops the dispatch client");

const reconnectingTool = await createToolGatewayHarness("tool-reconnect-gap");
emitGatewayEvent(reconnectingTool.dispatchOptions, "agent", toolPayload(0));
const subscriptionsBeforeToolReconnect = reconnectingTool.subscriptionCalls();
reconnectingTool.dispatchOptions.onClose?.(1006, "tool transport reset");
emitGatewayEvent(reconnectingTool.dispatchOptions, "agent", toolPayload(1));
reconnectingTool.dispatchOptions.onHelloOk?.(helloOk());
await Promise.resolve();
await Promise.resolve();
assert.equal(
  reconnectingTool.subscriptionCalls(),
  subscriptionsBeforeToolReconnect + 1,
  "chat subscription is restored after a tool reconnect gap",
);
emitGatewayEvent(reconnectingTool.dispatchOptions, "agent", toolPayload(2));
emitGatewayEvent(reconnectingTool.dispatchOptions, "chat", { ...delta, seq: 0 });
emitGatewayEvent(reconnectingTool.dispatchOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 1,
  state: "final",
});
assert.deepEqual(
  reconnectingTool.events,
  [
    { kind: "tool_start", id: "tool-1", name: "exec", input: { command: "echo hi" }, seq: 3 },
    { kind: "compatibility", code: "tool-event-reconnect-gap" },
    { kind: "delta", text: "Hello", replace: false },
    { kind: "final" },
  ],
  "a reconnect with unfinished tools disables later tool projection while validated chat resumes",
);
if (reconnectingTool.dispatch.kind === "accepted") {
  assert.deepEqual(await reconnectingTool.dispatch.done, { state: "final" });
}

// --- paired-device credential wiring -------------------------------------

// Opaque placeholders: nothing in the wiring path parses key material.
const wiringIdentity = {
  deviceId: "0".repeat(64),
  privateKeyPem: "fake-device-private-key-pem",
  publicKeyPem: "fake-device-public-key-pem",
};
const wiringCalls = [];
const wiringStore = {
  status: () => ({ available: true }),
  loadOrCreateDeviceIdentity: () => wiringIdentity,
  loadDeviceAuthToken: (params) => {
    wiringCalls.push(["load", params]);
    return { token: "keychain-token", scopes: ["operator.read", "operator.write"] };
  },
  storeDeviceAuthToken: (params) => {
    wiringCalls.push(["store", params]);
  },
  clearDeviceAuthToken: (params) => {
    wiringCalls.push(["clear", params]);
  },
};
let wiringOptions;
const wiredDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "cave-request-wired",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: () => {},
  credentialStore: wiringStore,
  clientFactory: (options) => {
    wiringOptions = options;
    return {
      start() {
        queueMicrotask(() => options.onHelloOk?.(helloOk()));
      },
      stop() {},
      async request(method, _params, requestOptions) {
        if (method === "chat.send") {
          requestOptions?.onSent?.();
          return { runId: expected.runId };
        }
        return {};
      },
    };
  },
});
assert.equal(wiredDispatch.kind, "accepted", "an available credential store activates the Gateway dispatch path");
assert.equal(
  wiringOptions.deviceIdentity,
  wiringIdentity,
  "the client receives the store-resolved paired-device identity, not one it derives itself",
);
assert.deepEqual(
  Object.keys(wiringOptions.env),
  ["NODE_ENV"],
  "wiring the credential store must not widen the client's environment beyond NODE_ENV",
);
assert.equal(typeof wiringOptions.hostDeps.signDevicePayload, "function");
assert.equal(typeof wiringOptions.hostDeps.publicKeyRawBase64UrlFromPem, "function");
assert.equal(
  wiringOptions.hostDeps.loadOrCreateDeviceIdentity(),
  wiringIdentity,
  "hostDeps identity resolution returns the pre-resolved identity without another keychain round trip",
);
const loadedToken = wiringOptions.hostDeps.loadDeviceAuthToken({
  deviceId: wiringIdentity.deviceId,
  role: "operator",
  env: { OPENCLAW_GATEWAY_DEVICE_TOKEN: "env-token-must-not-be-read" },
});
assert.deepEqual(
  loadedToken,
  { token: "keychain-token", scopes: ["operator.read", "operator.write"] },
  "device tokens come from the credential store",
);
wiringOptions.hostDeps.storeDeviceAuthToken({
  deviceId: wiringIdentity.deviceId,
  role: "operator",
  token: "minted-token",
  scopes: ["operator.read"],
  env: { HOME: "/nope" },
});
wiringOptions.hostDeps.clearDeviceAuthToken({
  deviceId: wiringIdentity.deviceId,
  role: "operator",
  env: { HOME: "/nope" },
});
assert.deepEqual(
  wiringCalls,
  [
    ["load", { deviceId: wiringIdentity.deviceId, role: "operator" }],
    ["store", { deviceId: wiringIdentity.deviceId, role: "operator", token: "minted-token", scopes: ["operator.read"] }],
    ["clear", { deviceId: wiringIdentity.deviceId, role: "operator" }],
  ],
  "hostDeps delegate to the credential store and drop the client's env bag so env auth can never revive",
);
if (wiredDispatch.kind === "accepted") wiredDispatch.close();

const failingStoreDispatch = await dispatchOpenClawGatewayTurn({
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  message: "hello",
  idempotencyKey: "cave-request-store-failure",
  env: { OPENCLAW_GATEWAY_DISPATCH: "1", OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" },
  onEvent: () => assert.fail("a failed credential store must not emit events"),
  credentialStore: {
    ...wiringStore,
    loadOrCreateDeviceIdentity: () => {
      throw new Error("The macOS Keychain holds an invalid OpenClaw device identity");
    },
  },
  clientFactory: () => assert.fail("a failed credential store must not construct a Gateway client"),
});
assert.deepEqual(
  failingStoreDispatch,
  { kind: "unavailable", reason: "The macOS Keychain holds an invalid OpenClaw device identity" },
  "an identity failure is a pre-dispatch compatibility failure that retains the CLI fallback",
);

const malformedTools = await createToolGatewayHarness("malformed-tool-quarantine");
const secretToolValue = "sk-tool-secret-must-not-leak";
const malformedToolPayload = toolPayload(0, {
  data: {
    phase: "future-phase",
    args: {
      command: `cat /Users/private/${secretToolValue}`,
      authorization: `Bearer ${secretToolValue}`,
    },
  },
});
emitGatewayEvent(malformedTools.dispatchOptions, "agent", malformedToolPayload);
emitGatewayEvent(malformedTools.dispatchOptions, "session.tool", toolPayload(1, {
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  data: {
    phase: "another-future-phase",
    partialResult: secretToolValue,
  },
}));
emitGatewayEvent(malformedTools.dispatchOptions, "unrelated.unknown", {
  secret: secretToolValue,
});
emitGatewayEvent(malformedTools.dispatchOptions, "agent", toolPayload(0, { seq: 10 }));
emitGatewayEvent(malformedTools.dispatchOptions, "chat", { ...delta, seq: 0 });
emitGatewayEvent(malformedTools.dispatchOptions, "chat", {
  runId: expected.runId,
  sessionKey: expected.sessionKey,
  agentId: expected.agentId,
  seq: 1,
  state: "final",
});
assert.deepEqual(
  malformedTools.events,
  [
    {
      kind: "compatibility",
      code: "unknown-tool-event",
      fingerprint: redactedOpenClawToolFingerprint(malformedToolPayload),
    },
    { kind: "delta", text: "Hello", replace: false },
    { kind: "final" },
  ],
  "malformed selected tool data emits one safe diagnostic, disables tools, and preserves chat completion",
);
assert.equal(
  JSON.stringify(malformedTools.events).includes(secretToolValue),
  false,
  "tool compatibility diagnostics never expose raw tool payload values",
);
if (malformedTools.dispatch.kind === "accepted") {
  assert.deepEqual(await malformedTools.dispatch.done, { state: "final" });
}
assert.deepEqual(
  await loadOpenClawCompatibility(openClawDiscoveryFromHello(helloOk())),
  {
    mode: "plain",
    discovery: openClawDiscoveryFromHello(helloOk()),
    bundleSource: "built-in",
    diagnostic: "profile-quarantined",
  },
  "the malformed selected tool event quarantines the active profile revision exactly once for the process",
);

console.log("openclaw Gateway run correlation tests passed");
