import { GatewayClient } from "@openclaw/gateway-client";
import { ChatEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { Value } from "typebox/value";

/**
 * The direct Gateway transport is intentionally opt-in.  It owns a turn only
 * after `chat.send` returns the Gateway-generated run id; before that point
 * callers may retain the existing CLI fallback without risking a duplicate
 * agent turn.
 */
const GATEWAY_DISPATCH_ENV = "OPENCLAW_GATEWAY_DISPATCH";
const GATEWAY_URL_ENV = "OPENCLAW_GATEWAY_URL";
const GATEWAY_TOKEN_ENV = "OPENCLAW_GATEWAY_TOKEN";
const GATEWAY_DEVICE_TOKEN_ENV = "OPENCLAW_GATEWAY_DEVICE_TOKEN";
const STARTUP_TIMEOUT_MS = 3_000;
const REQUIRED_GATEWAY_METHODS = ["chat.send", "chat.abort", "sessions.messages.subscribe"];

export type OpenClawGatewayChatEvent =
  | { kind: "status"; phase: string }
  | { kind: "delta"; text: string; replace: boolean }
  | { kind: "final"; text?: string }
  | { kind: "aborted"; message?: string }
  | { kind: "error"; message: string };

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

type GatewayHello = {
  protocol: number;
  features: { methods: string[]; events: string[]; capabilities?: string[] };
  auth: { role: string; scopes: string[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function gatewayDispatchEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[GATEWAY_DISPATCH_ENV] === "1" || env[GATEWAY_DISPATCH_ENV] === "true";
}

/**
 * The published client delegates device-identity creation, challenge signing,
 * and device-token lifecycle to hostDeps. Cave has not yet implemented the
 * required cross-platform OS credential-store boundary, so the route must not
 * activate a write-capable Gateway transport with process-environment tokens.
 */
export function openClawGatewayPairedDeviceAuthStatus(): { available: boolean; reason?: string } {
  return {
    available: false,
    reason: "Cave has no cross-platform OS-backed paired-device credential store for OpenClaw Gateway dispatch",
  };
}

function supportedHello(hello: GatewayHello): string | null {
  if (hello.protocol !== PROTOCOL_VERSION) return `Gateway protocol ${hello.protocol} is not supported`;
  if (hello.auth.role !== "operator") return "Gateway did not grant the operator role";
  const scopes = new Set(hello.auth.scopes);
  if (!scopes.has("operator.read") || !scopes.has("operator.write")) {
    return "Gateway did not grant operator.read and operator.write";
  }
  const methods = new Set(hello.features.methods);
  if (REQUIRED_GATEWAY_METHODS.some((method) => !methods.has(method))) {
    return "Gateway does not advertise the required chat.send, chat.abort, and sessions.messages.subscribe methods";
  }
  if (!hello.features.events.includes("chat")) return "Gateway does not advertise the versioned chat event";
  return null;
}

/** Extract text only from the documented chat envelope shapes. */
export function textFromOpenClawGatewayMessage(message: unknown): string | undefined {
  if (typeof message === "string") return message;
  if (!isRecord(message)) return undefined;
  if (typeof message.text === "string") return message.text;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
  return text || undefined;
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
  onEvent: (event: OpenClawGatewayChatEvent) => void;
  env?: NodeJS.ProcessEnv;
  /** Injectable only so the official-client lifecycle can be tested without a live Gateway. */
  clientFactory?: GatewayClientFactory;
}): Promise<OpenClawGatewayDispatch> {
  const env = args.env ?? process.env;
  if (!gatewayDispatchEnabled(env)) return { kind: "unavailable", reason: "Gateway dispatch is disabled" };
  if (!nonEmptyString(args.idempotencyKey)) {
    return { kind: "unavailable", reason: "Gateway dispatch requires a Cave request id" };
  }
  const url = env[GATEWAY_URL_ENV];
  if (!nonEmptyString(url)) return { kind: "unavailable", reason: "Gateway URL is not configured" };

  let client: GatewayClientPort;
  let helloResolve: (() => void) | undefined;
  let helloReject: ((error: Error) => void) | undefined;
  let connected = false;
  // Each authenticated hello represents a new transport generation. A
  // subscription completion from an older connection must never make the
  // newest connection's stream trusted again.
  let connectionGeneration = 0;
  let expectedRunId: string | undefined;
  let streamReady = false;
  let highestSequence = -1;
  let dispatchSent = false;
  let settled = false;
  const queuedChatEvents: unknown[] = [];
  let doneResolve!: (value: { state: "final" | "aborted" | "error"; message?: string }) => void;
  const done = new Promise<{ state: "final" | "aborted" | "error"; message?: string }>((resolve) => {
    doneResolve = resolve;
  });

  const settle = (state: "final" | "aborted" | "error", message?: string) => {
    if (settled) return;
    settled = true;
    doneResolve({ state, ...(message ? { message } : {}) });
  };

  const drainQueuedChatEvents = () => {
    if (!expectedRunId || !streamReady || settled) return;
    for (const queued of queuedChatEvents.splice(0)) processChatEvent(queued);
  };

  const processChatEvent = (payload: unknown) => {
    if (!expectedRunId || !streamReady || settled) {
      if (queuedChatEvents.length < 128) queuedChatEvents.push(payload);
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
    if (highestSequence >= 0 && event.seq !== highestSequence + 1) {
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
    drainQueuedChatEvents();
    return true;
  };

  const hello = new Promise<void>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
  });

  const clientOptions: ConstructorParameters<typeof GatewayClient>[0] = {
    url,
    token: env[GATEWAY_TOKEN_ENV],
    deviceToken: env[GATEWAY_DEVICE_TOKEN_ENV],
    clientName: "gateway-client",
    clientDisplayName: "Coven Cave",
    clientVersion: "2026.7.2-beta.4",
    platform: process.platform,
    mode: "backend",
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    connectChallengeTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: STARTUP_TIMEOUT_MS,
    onHelloOk: (rawHello) => {
      const failure = Value.Check(HelloOkSchema, rawHello)
        ? supportedHello(rawHello as GatewayHello)
        : "Gateway returned an invalid hello response for the pinned v4 schema";
      if (failure) {
        const error = new Error(failure);
        helloReject?.(error);
        if (connected) {
          args.onEvent({ kind: "error", message: failure });
          settle("error", failure);
        }
        client.stop();
        return;
      }
      if (!connected) {
        connected = true;
        connectionGeneration += 1;
        helloResolve?.();
        return;
      }
      // The official client reconnects after a transport loss. Restore the
      // documented session stream before accepting resumed chat frames. Frames
      // that arrive during this window remain queued until that subscription
      // has succeeded, so a reconnect never turns an unverified stream into
      // accepted lifecycle state.
      const generation = ++connectionGeneration;
      void subscribeToSession(generation)
        .catch(() => {
          if (generation !== connectionGeneration || settled) return;
          const message = "Gateway reconnect could not restore the session stream";
          args.onEvent({ kind: "error", message });
          settle("error", message);
          client.stop();
        });
    },
    onConnectError: (error) => {
      if (!connected) helloReject?.(error);
      // GatewayClient reports failures while attempting its *next* socket as
      // onConnectError too. Once the first hello has completed, stopping here
      // would defeat the client's documented reconnect policy before a later
      // hello can restore the subscription. A terminal reconnect pause is
      // handled below instead.
    },
    onReconnectPaused: () => {
      if (settled) return;
      const message = "Gateway reconnect was paused after dispatch";
      args.onEvent({ kind: "error", message });
      settle("error", message);
      client.stop();
    },
    onEvent: (frame) => {
      if (frame.event === "chat") processChatEvent(frame.payload);
    },
    onGap: () => {
      if (!expectedRunId || settled) return;
      const message = "Gateway transport sequence gap";
      args.onEvent({ kind: "error", message });
      settle("error", message);
      client.stop();
    },
  };
  client = args.clientFactory?.(clientOptions) ?? new GatewayClient(clientOptions);

  client.start();
  try {
    await withTimeout(hello, STARTUP_TIMEOUT_MS, "Gateway did not complete its authenticated hello");
    // A reconnect can arrive while the initial subscription is in flight.
    // Retry until the completion belongs to the latest authenticated hello;
    // an old socket's rejection is similarly irrelevant once a newer hello
    // has already arrived.
    for (;;) {
      const generation = connectionGeneration;
      try {
        if (await subscribeToSession(generation)) break;
      } catch (error) {
        if (generation === connectionGeneration) throw error;
      }
    }
  } catch (error) {
    client.stop();
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
        reason: "Gateway dispatch acknowledgement was lost; Cave will not start a duplicate CLI turn",
      };
    }
    return { kind: "unavailable", reason: error instanceof Error ? error.message : "Gateway dispatch failed" };
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
      } finally {
        client.stop();
      }
    },
    close: () => client.stop(),
  };
}
