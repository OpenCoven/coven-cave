import { GatewayClient, type GatewayClientHostDeps } from "@openclaw/gateway-client";
import {
  ChatEventSchema,
  GATEWAY_SERVER_CAPS,
  HelloOkSchema,
  type HelloOk,
} from "@openclaw/gateway-protocol";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { Value } from "typebox/value";
import {
  loadOpenClawCompatibility,
  openClawDiscoveryFromHello,
  parseOpenClawToolEvent,
  quarantineOpenClawProfile,
  type OpenClawCompatibilityDiagnostic,
  type OpenClawCompatibilitySource,
  type OpenClawGatewayDiscovery,
  type OpenClawToolProfile,
} from "./openclaw-compatibility.ts";
import {
  createOpenClawDeviceCredentialStore,
  openClawPublicKeyRawBase64UrlFromPem,
  signOpenClawDevicePayload,
  type OpenClawDeviceCredentialStore,
  type OpenClawDeviceIdentity,
} from "./server/openclaw-device-credentials.ts";

/**
 * The direct Gateway transport is intentionally opt-in.  It owns a turn only
 * after `chat.send` returns the Gateway-generated run id; before that point
 * callers may retain the existing CLI fallback without risking a duplicate
 * agent turn.
 */
const GATEWAY_DISPATCH_ENV = "OPENCLAW_GATEWAY_DISPATCH";
const GATEWAY_URL_ENV = "OPENCLAW_GATEWAY_URL";
const STARTUP_TIMEOUT_MS = 3_000;
const REQUIRED_GATEWAY_METHODS = ["chat.send", "chat.abort"];
const REQUIRED_GATEWAY_CAPABILITIES = [GATEWAY_SERVER_CAPS.CHAT_SEND_ROUTING_CONTRACT];

export type OpenClawGatewayChatEvent =
  | { kind: "status"; phase: string }
  | { kind: "delta"; text: string; replace: boolean }
  | { kind: "final"; text?: string }
  | { kind: "aborted"; message?: string }
  | { kind: "error"; message: string };

export type OpenClawGatewayEvent =
  | OpenClawGatewayChatEvent
  | { kind: "tool_start"; id: string; name: string; input: unknown; seq: number }
  | { kind: "tool_progress"; id: string; output: unknown; seq: number }
  | { kind: "tool_end"; id: string; name: string; output: unknown; isError: boolean; seq: number }
  | {
      kind: "compatibility";
      code:
        | OpenClawCompatibilityDiagnostic
        | "unknown-tool-event"
        | "tool-event-sequence-gap"
        | "tool-event-reconnect-gap";
      fingerprint?: string;
    };

export type OpenClawGatewayDispatch =
  | { kind: "unavailable"; reason: string }
  | { kind: "indeterminate"; reason: string }
  | {
      kind: "accepted";
      runId: string;
      done: Promise<{ state: "final" | "aborted" | "error"; message?: string }>;
      abort: () => Promise<void>;
      close: () => void;
    };

type GatewayClientPort = Pick<GatewayClient, "start" | "stop" | "request">;
type GatewayClientFactory = (options: ConstructorParameters<typeof GatewayClient>[0]) => GatewayClientPort;

type GatewayChatPayload = {
  runId: string;
  sessionKey: string;
  agentId?: string;
  seq: number;
  state: "status" | "delta" | "final" | "aborted" | "error";
  phase?: string;
  deltaText?: string;
  replace?: boolean;
  message?: unknown;
  errorMessage?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function openClawAgentEventPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  return {
    runId: payload.runId,
    seq: payload.seq,
    stream: payload.stream,
    ts: payload.ts,
    data: payload.data,
    ...(hasOwn(payload, "spawnedBy") ? { spawnedBy: payload.spawnedBy } : {}),
    ...(hasOwn(payload, "isHeartbeat") ? { isHeartbeat: payload.isHeartbeat } : {}),
  };
}

function matchesOptionalRoutingField(
  value: Record<string, unknown>,
  key: string,
  expected: string,
): boolean {
  return !hasOwn(value, key) || value[key] === expected;
}

function matchesOpenClawSessionToolRouting(
  payload: Record<string, unknown>,
  expected: { sessionKey: string; agentId: string },
): boolean {
  if (
    !matchesOptionalRoutingField(payload, "sessionKey", expected.sessionKey)
    || !matchesOptionalRoutingField(payload, "agentId", expected.agentId)
  ) {
    return false;
  }
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : null;
  if (
    snapshot
    && (
      !matchesOptionalRoutingField(snapshot, "sessionKey", expected.sessionKey)
      || !matchesOptionalRoutingField(snapshot, "agentId", expected.agentId)
    )
  ) {
    return false;
  }
  const session = isRecord(payload.session) ? payload.session : null;
  return !session
    || (
      !hasOwn(session, "key")
      || session.key === expected.sessionKey
    )
    && matchesOptionalRoutingField(session, "agentId", expected.agentId);
}

function profileSelectsToolFrame(
  profile: OpenClawToolProfile,
  eventName: string,
  payload: unknown,
): boolean {
  if (!profile.eventNames.includes(eventName as OpenClawToolProfile["eventNames"][number])) {
    return false;
  }
  if (eventName !== "agent") return true;
  return isRecord(payload)
    && typeof payload.stream === "string"
    && profile.streams.includes(payload.stream as OpenClawToolProfile["streams"][number]);
}

function gatewayDispatchEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[GATEWAY_DISPATCH_ENV] === "1" || env[GATEWAY_DISPATCH_ENV] === "true";
}

/**
 * The published client delegates device-identity creation, challenge signing,
 * and device-token lifecycle to hostDeps. Cave backs those with the OS
 * credential store (macOS Keychain); platforms without a supported store fail
 * closed so the route never activates a write-capable Gateway transport with
 * process-environment tokens.
 */
export function openClawGatewayPairedDeviceAuthStatus(
  credentialStore?: OpenClawDeviceCredentialStore,
): { available: boolean; reason?: string } {
  return (credentialStore ?? createOpenClawDeviceCredentialStore()).status();
}

/**
 * hostDeps ignore the `env` bag the client threads through its token hooks:
 * device tokens live in the OS credential store only, and reviving env-token
 * auth here would reopen the write-capable-transport-from-env hole this
 * boundary exists to close.
 */
function hostDepsForCredentialStore(
  store: OpenClawDeviceCredentialStore,
  deviceIdentity: OpenClawDeviceIdentity,
): GatewayClientHostDeps {
  return {
    loadOrCreateDeviceIdentity: () => deviceIdentity,
    signDevicePayload: signOpenClawDevicePayload,
    publicKeyRawBase64UrlFromPem: openClawPublicKeyRawBase64UrlFromPem,
    loadDeviceAuthToken: ({ deviceId, role }) => store.loadDeviceAuthToken({ deviceId, role }),
    storeDeviceAuthToken: ({ deviceId, role, token, scopes }) =>
      store.storeDeviceAuthToken({ deviceId, role, token, scopes }),
    clearDeviceAuthToken: ({ deviceId, role }) => store.clearDeviceAuthToken({ deviceId, role }),
  };
}

function supportedHello(hello: HelloOk): string | null {
  if (hello.protocol !== PROTOCOL_VERSION) return `Gateway protocol ${hello.protocol} is not supported`;
  if (hello.auth.role !== "operator") return "Gateway did not grant the operator role";
  const scopes = new Set(hello.auth.scopes);
  if (!scopes.has("operator.read") || !scopes.has("operator.write")) {
    return "Gateway did not grant operator.read and operator.write";
  }
  const methods = new Set(hello.features.methods);
  if (REQUIRED_GATEWAY_METHODS.some((method) => !methods.has(method))) {
    return "Gateway does not advertise the required chat.send and chat.abort methods";
  }
  const capabilities = new Set(hello.features.capabilities ?? []);
  if (REQUIRED_GATEWAY_CAPABILITIES.some((capability) => !capabilities.has(capability))) {
    return "Gateway does not advertise the required chat-send-routing-contract capability";
  }
  if (!hello.features.events.includes("chat")) return "Gateway does not advertise the versioned chat event";
  return null;
}

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

type AuthenticatedGatewayConnection = {
  client: GatewayClientPort;
  hello: HelloOk;
  stop: () => void;
};

async function connectAuthenticatedOpenClawGateway(args: {
  url: string;
  caps?: string[];
  clientFactory?: GatewayClientFactory;
  credentialStore?: OpenClawDeviceCredentialStore;
  deviceIdentity?: OpenClawDeviceIdentity;
  onReauthenticatedHello?: (hello: HelloOk) => void;
  onInvalidHello?: (message: string) => void;
  onReconnectPaused?: ConstructorParameters<typeof GatewayClient>[0]["onReconnectPaused"];
  onClose?: ConstructorParameters<typeof GatewayClient>[0]["onClose"];
  onEvent?: ConstructorParameters<typeof GatewayClient>[0]["onEvent"];
  onGap?: ConstructorParameters<typeof GatewayClient>[0]["onGap"];
}): Promise<AuthenticatedGatewayConnection> {
  let client: GatewayClientPort | undefined;
  let connected = false;
  let stopRequested = false;
  let helloResolve!: (hello: HelloOk) => void;
  let helloReject!: (error: Error) => void;
  const hello = new Promise<HelloOk>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
  });
  const stop = () => {
    stopRequested = true;
    client?.stop();
  };
  const clientOptions: ConstructorParameters<typeof GatewayClient>[0] = {
    url: args.url,
    env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
    ...(args.deviceIdentity && args.credentialStore
      ? {
          deviceIdentity: args.deviceIdentity,
          hostDeps: hostDepsForCredentialStore(args.credentialStore, args.deviceIdentity),
        }
      : {}),
    ...(args.caps ? { caps: args.caps } : {}),
    clientName: "gateway-client",
    clientDisplayName: "Coven Cave",
    clientVersion: "2026.7.2-beta.5",
    platform: process.platform,
    mode: "backend",
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    connectChallengeTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: STARTUP_TIMEOUT_MS,
    onHelloOk: (rawHello) => {
      if (!Value.Check(HelloOkSchema, rawHello)) {
        const failure = "Gateway returned an invalid hello response for the pinned v4 schema";
        if (connected) args.onInvalidHello?.(failure);
        else helloReject(new Error(failure));
        stop();
        return;
      }
      if (!connected) {
        const failure = supportedHello(rawHello);
        if (failure) {
          helloReject(new Error(failure));
          stop();
          return;
        }
        connected = true;
        helloResolve(rawHello);
        return;
      }
      if (args.onReauthenticatedHello) {
        args.onReauthenticatedHello(rawHello);
        return;
      }
      const failure = supportedHello(rawHello);
      if (failure) {
        args.onInvalidHello?.(failure);
        stop();
      }
    },
    onConnectError: (error) => {
      if (!connected) helloReject(error);
    },
    onReconnectPaused: args.onReconnectPaused,
    onClose: args.onClose,
    onEvent: args.onEvent,
    onGap: args.onGap,
  };
  try {
    client = args.clientFactory?.(clientOptions) ?? new GatewayClient(clientOptions);
    if (stopRequested) client.stop();
    client.start();
    const authenticatedHello = await withTimeout(
      hello,
      STARTUP_TIMEOUT_MS,
      "Gateway did not complete its authenticated hello",
    );
    return { client, hello: authenticatedHello, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

/**
 * The published v4 ChatEvent schema deliberately leaves `message` opaque.
 * Do not infer a content envelope from an opaque value: doing so would make
 * unversioned Gateway payloads assistant-visible. Text reaches Cave only via
 * the schema's `deltaText` field until a versioned final-message validator is
 * published.
 */
export function textFromOpenClawGatewayMessage(message: unknown): string | undefined {
  void message;
  return undefined;
}

/**
 * Validate a published v4 `chat` payload and reject any event not belonging
 * to the single Gateway run accepted for this Cave turn.
 */
export function normalizeOpenClawGatewayChatEvent(
  payload: unknown,
  expected: { runId: string; sessionKey: string; agentId: string },
): GatewayChatPayload | null {
  if (!Value.Check(ChatEventSchema, payload)) return null;
  const event = payload as GatewayChatPayload;
  if (event.runId !== expected.runId || event.sessionKey !== expected.sessionKey) return null;
  if (event.agentId !== expected.agentId) return null;
  return event;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Dispatch a Cave turn through the supported Gateway v4 client.  The helper
 * never guesses a run id and never permits a caller to fall back to the CLI
 * once a request might have reached the Gateway.
 */
export async function dispatchOpenClawGatewayTurn(args: {
  sessionKey: string;
  agentId: string;
  message: string;
  /**
   * Cave's stable per-request id. It is sent verbatim to Gateway so a client
   * retry can be reconciled by the remote idempotency contract; generating a
   * fresh value here would make an acknowledgement loss duplicate work.
   */
  idempotencyKey: string;
  onEvent: (event: OpenClawGatewayEvent) => void;
  env?: NodeJS.ProcessEnv;
  /** Injectable only so the official-client lifecycle can be tested without a live Gateway. */
  clientFactory?: GatewayClientFactory;
  /** Injectable only so paired-device credential wiring can be tested without the OS keychain. */
  credentialStore?: OpenClawDeviceCredentialStore;
  /** Injectable compatibility registry source for deterministic negotiation tests. */
  compatibilitySource?: OpenClawCompatibilitySource;
}): Promise<OpenClawGatewayDispatch> {
  const env = args.env ?? process.env;
  if (!gatewayDispatchEnabled(env)) return { kind: "unavailable", reason: "Gateway dispatch is disabled" };
  // An injected test client without an injected store must never construct
  // the real OS credential store: that path exists to exercise the client
  // lifecycle hermetically and cannot create a real Gateway connection.
  const credentialStore =
    args.credentialStore ?? (args.clientFactory ? undefined : createOpenClawDeviceCredentialStore());
  const pairedDeviceAuth: { available: boolean; reason?: string } = credentialStore
    ? credentialStore.status()
    : { available: false, reason: "Gateway paired-device authentication is unavailable" };
  // Keep this guard in the dispatcher as well as the route. A future caller
  // must not be able to turn an environment token into a write-capable
  // Gateway session simply by bypassing the route-level fallback choice.
  if (!pairedDeviceAuth.available && !args.clientFactory) {
    return { kind: "unavailable", reason: pairedDeviceAuth.reason ?? "Gateway paired-device authentication is unavailable" };
  }
  if (!nonEmptyString(args.idempotencyKey)) {
    return { kind: "unavailable", reason: "Gateway dispatch requires a Cave request id" };
  }
  const url = env[GATEWAY_URL_ENV];
  if (!nonEmptyString(url)) return { kind: "unavailable", reason: "Gateway URL is not configured" };
  // Resolve the paired-device identity before any client is constructed. A
  // keychain failure here is a pre-dispatch compatibility failure — the
  // caller keeps the CLI fallback and no request can have reached the
  // Gateway. When no store is in play (injected test client), the dispatcher
  // proceeds without an identity exactly as before.
  let deviceIdentity: OpenClawDeviceIdentity | undefined;
  if (credentialStore && pairedDeviceAuth.available) {
    try {
      deviceIdentity = credentialStore.loadOrCreateDeviceIdentity();
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : "The OpenClaw paired-device credential store failed",
      };
    }
  }

  let discoveryConnection: AuthenticatedGatewayConnection | undefined;
  let discovery: OpenClawGatewayDiscovery;
  let compatibility: Awaited<ReturnType<typeof loadOpenClawCompatibility>>;
  try {
    discoveryConnection = await connectAuthenticatedOpenClawGateway({
      url,
      clientFactory: args.clientFactory,
      credentialStore,
      deviceIdentity,
    });
    discovery = openClawDiscoveryFromHello(discoveryConnection.hello);
    compatibility = await loadOpenClawCompatibility(discovery, args.compatibilitySource);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : "Gateway is unavailable",
    };
  } finally {
    discoveryConnection?.stop();
  }
  if (compatibility.mode !== "structured") {
    return {
      kind: "unavailable",
      reason: `OpenClaw tool compatibility: ${compatibility.diagnostic}`,
    };
  }
  const selectedToolProfile = compatibility.profile;

  let client!: GatewayClientPort;
  // Each authenticated hello represents a new transport generation. A
  // subscription completion from an older connection must never make the
  // newest connection's stream trusted again.
  let connectionGeneration = 0;
  let expectedRunId: string | undefined;
  let streamReady = false;
  let highestSequence = -1;
  let highestToolSequence = -1;
  let toolProjectionEnabled = true;
  let dispatchSent = false;
  let settled = false;
  let lifecycleFailure: string | undefined;
  let preAcknowledgementOverflowGeneration: number | undefined;
  let preAcknowledgementToolOverflowGeneration: number | undefined;
  const queuedChatEvents: Array<{ generation: number; payload: unknown }> = [];
  const queuedToolEvents: Array<{ generation: number; eventName: string; payload: unknown }> = [];
  const seenToolEvents = new Set<string>();
  const openToolIds = new Set<string>();
  let doneResolve!: (value: { state: "final" | "aborted" | "error"; message?: string }) => void;
  const done = new Promise<{ state: "final" | "aborted" | "error"; message?: string }>((resolve) => {
    doneResolve = resolve;
  });

  const settle = (state: "final" | "aborted" | "error", message?: string) => {
    if (settled) return;
    settled = true;
    doneResolve({ state, ...(message ? { message } : {}) });
  };

  const failDispatchLifecycle = (message: string) => {
    if (settled) {
      client?.stop();
      return;
    }
    lifecycleFailure = message;
    streamReady = false;
    connectionGeneration += 1;
    queuedChatEvents.splice(0);
    queuedToolEvents.splice(0);
    preAcknowledgementOverflowGeneration = undefined;
    preAcknowledgementToolOverflowGeneration = undefined;
    toolProjectionEnabled = false;
    openToolIds.clear();
    if (expectedRunId) {
      args.onEvent({ kind: "error", message });
      settle("error", message);
    }
    client?.stop();
  };

  const failForCompatibilityDrift = () => {
    failDispatchLifecycle("OpenClaw Gateway changed during compatibility negotiation");
  };

  const disableToolProjection = (
    code: "unknown-tool-event" | "tool-event-sequence-gap" | "tool-event-reconnect-gap",
    fingerprint?: string,
  ) => {
    if (!toolProjectionEnabled || settled) return;
    toolProjectionEnabled = false;
    queuedToolEvents.splice(0);
    preAcknowledgementToolOverflowGeneration = undefined;
    openToolIds.clear();
    args.onEvent({
      kind: "compatibility",
      code,
      ...(fingerprint ? { fingerprint } : {}),
    });
  };

  const processToolEvent = (eventName: string, payload: unknown) => {
    if (settled || !toolProjectionEnabled) return;
    if (!expectedRunId) {
      if (!streamReady) return;
      if (queuedToolEvents.length < 128) {
        queuedToolEvents.push({ generation: connectionGeneration, eventName, payload });
      } else {
        preAcknowledgementToolOverflowGeneration = connectionGeneration;
      }
      return;
    }
    if (!streamReady || !isRecord(payload) || payload.runId !== expectedRunId) return;
    if (
      eventName === "session.tool"
      && !matchesOpenClawSessionToolRouting(payload, {
        sessionKey: args.sessionKey,
        agentId: args.agentId,
      })
    ) {
      return;
    }
    const parsed = parseOpenClawToolEvent(
      eventName,
      openClawAgentEventPayload(payload),
      selectedToolProfile,
    );
    if (parsed.kind === "unknown") {
      quarantineOpenClawProfile(selectedToolProfile);
      disableToolProjection("unknown-tool-event", parsed.fingerprint);
      return;
    }
    const dedupeKey = `${expectedRunId}:${parsed.seq}:${parsed.id}:${parsed.kind}`;
    if (seenToolEvents.has(dedupeKey) || parsed.seq <= highestToolSequence) return;
    seenToolEvents.add(dedupeKey);
    highestToolSequence = parsed.seq;
    if (parsed.kind === "tool_start") openToolIds.add(parsed.id);
    if (parsed.kind === "tool_end") openToolIds.delete(parsed.id);
    args.onEvent(parsed);
  };

  const drainQueuedToolEvents = () => {
    if (!expectedRunId || !streamReady || settled || !toolProjectionEnabled) return;
    const overflowed = preAcknowledgementToolOverflowGeneration === connectionGeneration;
    preAcknowledgementToolOverflowGeneration = undefined;
    if (overflowed) {
      queuedToolEvents.splice(0);
      disableToolProjection("tool-event-sequence-gap");
      return;
    }
    for (const queued of queuedToolEvents.splice(0)) {
      if (queued.generation === connectionGeneration) {
        processToolEvent(queued.eventName, queued.payload);
      }
    }
  };

  const drainQueuedChatEvents = () => {
    if (!expectedRunId || !streamReady || settled) return;
    const overflowed = preAcknowledgementOverflowGeneration === connectionGeneration;
    preAcknowledgementOverflowGeneration = undefined;
    if (overflowed) {
      queuedChatEvents.splice(0);
      queuedToolEvents.splice(0);
      const message = "Gateway pre-acknowledgement event buffer overflow";
      args.onEvent({ kind: "error", message });
      settle("error", message);
      client.stop();
      return;
    }
    for (const queued of queuedChatEvents.splice(0)) {
      if (queued.generation === connectionGeneration) processChatEvent(queued.payload);
    }
  };

  const processChatEvent = (payload: unknown) => {
    if (settled) return;
    // Until `chat.send` returns, events cannot yet be correlated to a Cave
    // turn. Hold a bounded set so an accepted response can bind them to its
    // run id. Once a run has been accepted, however, a disconnect or a
    // reconnect subscription gap is a hard fence: an event callback has no
    // transport-generation provenance, so accepting it after the next hello
    // could expose a late frame buffered by the old socket.
    if (!expectedRunId) {
      if (!streamReady) return;
      if (queuedChatEvents.length < 128) {
        queuedChatEvents.push({ generation: connectionGeneration, payload });
      } else {
        preAcknowledgementOverflowGeneration = connectionGeneration;
      }
      return;
    }
    if (!streamReady) {
      return;
    }
    const event = normalizeOpenClawGatewayChatEvent(payload, {
      runId: expectedRunId,
      sessionKey: args.sessionKey,
      agentId: args.agentId,
    });
    if (!event) return;
    // Per-run ordering is authoritative. A duplicate or replay may not
    // mutate a completed card/turn; a gap is unsafe without a published
    // history-reconciliation schema, so finish this Gateway-owned turn as an
    // error instead of pretending its stream is complete.
    if (event.seq <= highestSequence) return;
    if (event.seq !== highestSequence + 1) {
      args.onEvent({ kind: "error", message: "Gateway event sequence gap" });
      settle("error", "Gateway event sequence gap");
      client.stop();
      return;
    }
    highestSequence = event.seq;
    if (event.state === "status" && nonEmptyString(event.phase)) {
      args.onEvent({ kind: "status", phase: event.phase });
      return;
    }
    if (event.state === "delta" && typeof event.deltaText === "string") {
      args.onEvent({ kind: "delta", text: event.deltaText, replace: event.replace === true });
      return;
    }
    const text = textFromOpenClawGatewayMessage(event.message);
    if (event.state === "final") {
      args.onEvent({ kind: "final", ...(text ? { text } : {}) });
      settle("final", text);
      return;
    }
    if (event.state === "aborted") {
      const message = event.errorMessage ?? text;
      args.onEvent({ kind: "aborted", ...(message ? { message } : {}) });
      settle("aborted", message);
      return;
    }
    const message = event.errorMessage ?? text ?? "Gateway chat run failed";
    args.onEvent({ kind: "error", message });
    settle("error", message);
  };

  const subscribeToSession = async (generation: number): Promise<boolean> => {
    if (generation === connectionGeneration) streamReady = false;
    await client.request("sessions.messages.subscribe", { key: args.sessionKey, agentId: args.agentId });
    if (generation !== connectionGeneration || settled) return false;
    streamReady = true;
    drainQueuedToolEvents();
    drainQueuedChatEvents();
    return true;
  };

  try {
    const dispatchConnection = await connectAuthenticatedOpenClawGateway({
      url,
      caps: selectedToolProfile.requires.clientCapabilities,
      clientFactory: args.clientFactory,
      credentialStore,
      deviceIdentity,
      onReauthenticatedHello: (hello) => {
        if (!sameOpenClawDiscovery(discovery, openClawDiscoveryFromHello(hello))) {
          failForCompatibilityDrift();
          return;
        }
        const failure = supportedHello(hello);
        if (failure) {
          failDispatchLifecycle(failure);
          return;
        }
        if (expectedRunId && openToolIds.size > 0) {
          disableToolProjection("tool-event-reconnect-gap");
        }
        // The official client reconnects after a transport loss. Restore the
        // documented session stream before accepting resumed chat frames.
        queuedChatEvents.splice(0);
        queuedToolEvents.splice(0);
        preAcknowledgementOverflowGeneration = undefined;
        preAcknowledgementToolOverflowGeneration = undefined;
        const generation = ++connectionGeneration;
        void subscribeToSession(generation)
          .catch(() => {
            if (generation !== connectionGeneration || settled) return;
            failDispatchLifecycle("Gateway reconnect could not restore the session stream");
          });
      },
      onInvalidHello: (failure) => {
        failDispatchLifecycle(failure);
      },
      onReconnectPaused: () => {
        failDispatchLifecycle("Gateway reconnect was paused after dispatch");
      },
      onClose: () => {
        if (settled) return;
        // A socket close invalidates the subscription immediately, not only
        // when the next hello arrives. A buffered callback from the closed
        // transport must not be accepted before the next subscription.
        if (expectedRunId && openToolIds.size > 0) {
          disableToolProjection("tool-event-reconnect-gap");
        }
        streamReady = false;
        queuedChatEvents.splice(0);
        queuedToolEvents.splice(0);
        preAcknowledgementOverflowGeneration = undefined;
        preAcknowledgementToolOverflowGeneration = undefined;
        connectionGeneration += 1;
      },
      onEvent: (frame) => {
        if (frame.event === "chat") {
          processChatEvent(frame.payload);
          return;
        }
        if (profileSelectsToolFrame(selectedToolProfile, frame.event, frame.payload)) {
          processToolEvent(frame.event, frame.payload);
        }
      },
      onGap: () => {
        if (settled) return;
        if (expectedRunId && toolProjectionEnabled && openToolIds.size > 0) {
          disableToolProjection("tool-event-sequence-gap");
          return;
        }
        failDispatchLifecycle("Gateway transport sequence gap");
      },
    });
    const dispatchDiscovery = openClawDiscoveryFromHello(dispatchConnection.hello);
    if (!sameOpenClawDiscovery(discovery, dispatchDiscovery)) {
      dispatchConnection.stop();
      return {
        kind: "unavailable",
        reason: "OpenClaw Gateway changed during compatibility negotiation",
      };
    }
    client = dispatchConnection.client;
    if (lifecycleFailure) {
      dispatchConnection.stop();
      return { kind: "unavailable", reason: lifecycleFailure };
    }
    connectionGeneration = 1;
    // A reconnect can arrive while the initial subscription is in flight.
    // Retry until the completion belongs to the latest authenticated hello;
    // an old socket's rejection is similarly irrelevant once a newer hello
    // has already arrived.
    for (;;) {
      if (lifecycleFailure) throw new Error(lifecycleFailure);
      const generation = connectionGeneration;
      try {
        if (await subscribeToSession(generation)) break;
      } catch (error) {
        if (generation === connectionGeneration) throw error;
      }
    }
  } catch (error) {
    client?.stop();
    return { kind: "unavailable", reason: error instanceof Error ? error.message : "Gateway is unavailable" };
  }

  let response: unknown;
  try {
    response = await client.request("chat.send", {
      sessionKey: args.sessionKey,
      agentId: args.agentId,
      message: args.message,
      idempotencyKey: args.idempotencyKey,
    }, {
      onSent: () => {
        dispatchSent = true;
      },
    });
  } catch (error) {
    client.stop();
    if (dispatchSent) {
      return {
        kind: "indeterminate",
        reason: lifecycleFailure
          ?? "Gateway dispatch acknowledgement was lost; Cave will not start a duplicate CLI turn",
      };
    }
    return {
      kind: "unavailable",
      reason: lifecycleFailure
        ?? (error instanceof Error ? error.message : "Gateway dispatch failed"),
    };
  }

  if (lifecycleFailure) {
    client.stop();
    return dispatchSent
      ? {
          kind: "indeterminate",
          reason: lifecycleFailure,
        }
      : { kind: "unavailable", reason: lifecycleFailure };
  }
  const runId = isRecord(response) && nonEmptyString(response.runId) ? response.runId : undefined;
  if (!runId) {
    client.stop();
    return {
      kind: "indeterminate",
      reason: "Gateway accepted a dispatch without a usable run id; Cave will not start a duplicate CLI turn",
    };
  }
  expectedRunId = runId;
  drainQueuedToolEvents();
  drainQueuedChatEvents();

  return {
    kind: "accepted",
    runId,
    done,
    abort: async () => {
      if (settled) return;
      // This fence is deliberately settled before the socket is stopped so a
      // queued or late final frame cannot turn a user-cancelled turn into ok.
      settle("aborted", "Cancelled by user");
      args.onEvent({ kind: "aborted", message: "Cancelled by user" });
      try {
        await client.request("chat.abort", {
          sessionKey: args.sessionKey,
          agentId: args.agentId,
          runId,
        });
      } catch {
        // Local cancellation is authoritative; the transport request is fire-and-forget.
      } finally {
        client.stop();
      }
    },
    close: () => client.stop(),
  };
}
