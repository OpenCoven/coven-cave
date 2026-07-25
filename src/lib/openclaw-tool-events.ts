import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { caveHome } from "./coven-paths.ts";
import { formatToolInputValue, flattenToolResultContent, type RecordedToolEvent, type ToolStreamEvent } from "./chat-tool-events.ts";
import { writeFileAtomic } from "./server/atomic-write.ts";

/**
 * Compatibility is deliberately feature-first. A future gateway that still
 * offers this protocol adapter works without a Cave release; a gateway that
 * does not is kept on the existing plain CLI transcript path.
 */
export const OPENCLAW_TOOL_PROTOCOL_ADAPTERS = [
  {
    protocol: 4,
    // `sessions.messages.subscribe` is the scoped Gateway API. Do not require
    // the older broad `sessions.subscribe` surface: it is neither needed to
    // observe this turn nor present in every otherwise-compatible Gateway.
    requiredMethods: ["sessions.messages.subscribe"],
    requiredEvents: ["session.tool"],
    // `features.capabilities` is a Gateway server-capability list; tool-events
    // is instead a client capability negotiated in connect.params.caps.
    // Protocol v4 plus these discovered features is the documented schema
    // contract for this adapter.
    requiredCapabilities: [],
    schema: "openclaw.session-tool.v1",
  },
] as const;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 8;
const CACHE_MAX_BYTES = 16 * 1024;
const MAX_GATEWAY_FRAME_BYTES = 1024 * 1024;
const MAX_PREAUTH_FRAME_BYTES = 64 * 1024;
const MAX_TRACKED_TOOL_CALLS = 1_024;
const MAX_TOOL_IDENTIFIER_LENGTH = 512;
const MAX_TOOL_TEXT_LENGTH = 64 * 1024;

export type OpenClawToolCompatibility = {
  protocol: number;
  serverVersion: string;
  schema: string;
  supported: boolean;
  reason?: "unsupported_protocol" | "missing_feature" | "invalid_hello";
};

type GatewayHello = {
  type?: unknown;
  protocol?: unknown;
  server?: { version?: unknown; connId?: unknown };
  features?: { methods?: unknown; events?: unknown; capabilities?: unknown };
  snapshot?: unknown;
  auth?: { role?: unknown; scopes?: unknown };
  policy?: { maxPayload?: unknown; maxBufferedBytes?: unknown; tickIntervalMs?: unknown };
};

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeServerVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._+-]{1,128}$/.test(value);
}

function boundedToolText(value: unknown, formatter: (raw: unknown) => string | undefined): string | undefined {
  const text = formatter(value);
  return text && text.length <= MAX_TOOL_TEXT_LENGTH ? text : undefined;
}

/** Validate negotiated metadata before an adapter may process live events. */
export function resolveOpenClawToolCompatibility(value: unknown): OpenClawToolCompatibility {
  const hello = value as GatewayHello;
  if (
    !hello ||
    typeof hello !== "object" ||
    hello.type !== "hello-ok" ||
    !Number.isInteger(hello.protocol) ||
    !hello.server ||
    !safeServerVersion(hello.server.version) ||
    typeof hello.server.connId !== "string" ||
    !hello.server.connId.trim() ||
    !hello.features
    || (hello.features.capabilities !== undefined && strings(hello.features.capabilities) === null)
    || !hello.snapshot || typeof hello.snapshot !== "object" || Array.isArray(hello.snapshot)
    || !hello.auth || hello.auth.role !== "operator" || !strings(hello.auth.scopes)?.includes("operator.read")
    || !hello.policy || !positiveSafeInteger(hello.policy.maxPayload)
    || !positiveSafeInteger(hello.policy.maxBufferedBytes)
    || !positiveSafeInteger(hello.policy.tickIntervalMs)
  ) {
    return { protocol: -1, serverVersion: "unknown", schema: "none", supported: false, reason: "invalid_hello" };
  }
  const adapter = OPENCLAW_TOOL_PROTOCOL_ADAPTERS.find((candidate) => candidate.protocol === hello.protocol);
  if (!adapter) {
    return {
      protocol: hello.protocol as number,
      serverVersion: hello.server.version,
      schema: "none",
      supported: false,
      reason: "unsupported_protocol",
    };
  }
  const methods = strings(hello.features.methods);
  const events = strings(hello.features.events);
  const capabilities = strings(hello.features.capabilities) ?? [];
  const supported =
    methods !== null &&
    events !== null &&
    adapter.requiredMethods.every((method) => methods.includes(method)) &&
    adapter.requiredEvents.every((event) => events.includes(event)) &&
    adapter.requiredCapabilities.every((capability) => capabilities.includes(capability));
  return {
    protocol: hello.protocol as number,
    serverVersion: hello.server.version,
    schema: adapter.schema,
    supported,
    ...(supported ? {} : { reason: "missing_feature" as const }),
  };
}

type GatewayToolPayload = {
  runId?: unknown;
  sessionKey?: unknown;
  agentId?: unknown;
  seq?: unknown;
  ts?: unknown;
  stream?: unknown;
  data?: {
    phase?: unknown;
    toolCallId?: unknown;
    name?: unknown;
    args?: unknown;
    partialResult?: unknown;
    result?: unknown;
    isError?: unknown;
  };
};

export type OpenClawGatewayToolEvent = {
  /** `toolCallId` is only guaranteed within its Gateway run. */
  runId: string;
  id: string;
  name: string;
  phase: "start" | "update" | "result";
  input?: string;
  output?: string;
  isError: boolean;
  seq: number;
  timestamp: number;
};

/**
 * Strictly accept only the documented session-scoped tool envelope. Unknown
 * schemas return null so callers retain a visible plain-chat fallback rather
 * than inventing an activity card from arbitrary runtime output.
 */
export function normalizeOpenClawGatewayToolEvent(
  frame: unknown,
  expectedSessionKey: string,
  expectedAgentId: string,
): OpenClawGatewayToolEvent | null {
  const envelope = frame as { type?: unknown; event?: unknown; payload?: GatewayToolPayload };
  const payload = envelope?.payload;
  const data = payload?.data;
  const phase = data?.phase;
  const seq = payload?.seq;
  const timestamp = payload?.ts;
  if (
    envelope?.type !== "event" ||
    envelope.event !== "session.tool" ||
    !payload ||
    typeof payload.runId !== "string" ||
    !payload.runId.trim() ||
    payload.runId.length > MAX_TOOL_IDENTIFIER_LENGTH ||
    payload.sessionKey !== expectedSessionKey ||
    payload.agentId !== expectedAgentId ||
    payload.stream !== "tool" ||
    !data ||
    typeof data.toolCallId !== "string" ||
    !data.toolCallId.trim() ||
    data.toolCallId.length > MAX_TOOL_IDENTIFIER_LENGTH ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > MAX_TOOL_IDENTIFIER_LENGTH ||
    (phase !== "start" && phase !== "update" && phase !== "result") ||
    (data.isError !== undefined && typeof data.isError !== "boolean") ||
    !nonNegativeSafeInteger(seq) ||
    !nonNegativeSafeInteger(timestamp)
  ) {
    return null;
  }
  const output =
    phase === "update"
      ? boundedToolText(data.partialResult, flattenToolResultContent)
      : phase === "result"
        ? boundedToolText(data.result, flattenToolResultContent)
        : undefined;
  return {
    runId: payload.runId,
    id: data.toolCallId,
    name: data.name,
    phase,
    ...(phase === "start" ? { input: boundedToolText(data.args, formatToolInputValue) } : {}),
    ...(output ? { output } : {}),
    // Gateway's documented tool terminal is `phase: "result"`; `isError` is
    // optional metadata on that terminal frame. Treating its absence as an
    // unsupported frame leaves every ordinary successful tool card running
    // until the CLI closes, then incorrectly settles it as an error.
    isError: data.isError === true,
    seq,
    timestamp,
  };
}

/** Reconciles replayed and out-of-order frames without downgrading terminal state. */
export class OpenClawToolEventLedger {
  private readonly tools = new Map<string, RecordedToolEvent>();
  private readonly startedAt = new Map<string, number>();
  private readonly seenSequences = new Set<string>();
  private readonly lastSequenceByTool = new Map<string, number>();

  /**
   * Gateway sessions can contain consecutive or queued runs. Keep the
   * transport id stable while namespacing it for Cave's per-turn tool model;
   * the protocol does not promise that two different runs cannot reuse a
   * toolCallId.
   */
  private toolKey(event: OpenClawGatewayToolEvent): string {
    return `${event.runId}:${event.id}`;
  }

  accept(event: OpenClawGatewayToolEvent, receivedAt = Date.now()): ToolStreamEvent | null {
    const key = this.toolKey(event);
    const existing = this.tools.get(key);
    if (!existing && this.tools.size >= MAX_TRACKED_TOOL_CALLS) return null;
    // Session replay can deliver an update/result before the matching start.
    // Admit that later start only to fill immutable metadata; it must never
    // change an already-observed status or overwrite newer output.
    const lateStartBackfill =
      event.phase === "start" &&
      existing !== undefined &&
      existing.input === undefined &&
      event.input !== undefined;
    if (event.seq !== undefined) {
      const lastSequence = this.lastSequenceByTool.get(key);
      if (lastSequence !== undefined && event.seq <= lastSequence && !lateStartBackfill) return null;
      // Gateway sequence counters are scoped to a run, not this observer's
      // entire long-lived session. A new run commonly starts again at 1.
      const sequenceKey = `${event.runId}:${event.seq}`;
      if (this.seenSequences.has(sequenceKey) && !lateStartBackfill) return null;
      this.seenSequences.add(sequenceKey);
      // A bounded replay guard is enough for one live turn and prevents an
      // untrusted runtime from growing this set indefinitely.
      if (this.seenSequences.size > 4096) this.seenSequences.clear();
      if (lastSequence === undefined || event.seq > lastSequence) {
        this.lastSequenceByTool.set(key, event.seq);
      }
    }
    if (existing && existing.status !== "running") {
      if (!lateStartBackfill) return null;
      const next = { ...existing, input: event.input };
      this.tools.set(key, next);
      return next;
    }
    const status: ToolStreamEvent["status"] =
      event.phase === "start" && existing
        ? existing.status
        : event.phase === "result"
          ? (event.isError ? "error" : "ok")
          : "running";
    const startedAt = this.startedAt.get(key) ?? event.timestamp ?? receivedAt;
    if (event.phase === "start") this.startedAt.set(key, event.timestamp ?? receivedAt);
    const next: RecordedToolEvent = {
      id: key,
      name: existing?.name ?? event.name,
      ...(existing?.input ?? event.input ? { input: existing?.input ?? event.input } : {}),
      ...(event.output ?? existing?.output ? { output: event.output ?? existing?.output } : {}),
      status,
      ...(status !== "running" && this.startedAt.has(key)
        ? { durationMs: Math.max(0, receivedAt - startedAt) }
        : {}),
    };
    this.tools.set(key, next);
    if (status !== "running") this.startedAt.delete(key);
    return next;
  }

  snapshot(): RecordedToolEvent[] {
    return Array.from(this.tools.values());
  }

  /** End every unresolved card explicitly when the surrounding run terminates. */
  finalizeUnsettled(message: string, receivedAt = Date.now()): ToolStreamEvent[] {
    const settled: ToolStreamEvent[] = [];
    for (const [id, tool] of this.tools) {
      if (tool.status !== "running") continue;
      const startedAt = this.startedAt.get(id);
      const terminal: RecordedToolEvent = {
        ...tool,
        output: tool.output ?? message,
        status: "error",
        ...(startedAt !== undefined ? { durationMs: Math.max(0, receivedAt - startedAt) } : {}),
      };
      this.tools.set(id, terminal);
      this.startedAt.delete(id);
      settled.push(terminal);
    }
    return settled;
  }
}

export type OpenClawCapabilityCacheEntry = OpenClawToolCompatibility & {
  runtimeKey: string;
  observedAt: number;
  expiresAt: number;
};

type CapabilityCache = { entries: OpenClawCapabilityCacheEntry[]; integrity: string };

function cachePath(): string {
  return path.join(caveHome(), "openclaw-tool-capabilities.json");
}

function cacheIntegrity(entries: OpenClawCapabilityCacheEntry[]): string {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function createOpenClawCapabilityCache(
  entries: OpenClawCapabilityCacheEntry[],
): CapabilityCache {
  return { entries, integrity: cacheIntegrity(entries) };
}

export function readVerifiedOpenClawCapabilityCache(
  raw: string,
  now = Date.now(),
): OpenClawCapabilityCacheEntry[] {
  try {
    if (raw.length > CACHE_MAX_BYTES) return [];
    const parsed = JSON.parse(raw) as CapabilityCache;
    if (
      !parsed ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > CACHE_MAX_ENTRIES ||
      parsed.integrity !== cacheIntegrity(parsed.entries)
    ) return [];
    return parsed.entries.flatMap((entry) => {
      const valid =
        typeof entry?.runtimeKey === "string" && /^[a-f0-9]{24}$/.test(entry.runtimeKey) &&
        Number.isSafeInteger(entry.protocol) &&
        safeServerVersion(entry.serverVersion) &&
        OPENCLAW_TOOL_PROTOCOL_ADAPTERS.some(
          (adapter) => entry.protocol === adapter.protocol && entry.schema === adapter.schema,
        ) &&
        entry.supported === true &&
        Number.isSafeInteger(entry.observedAt) &&
        Number.isSafeInteger(entry.expiresAt) &&
        entry.observedAt <= entry.expiresAt &&
        entry.expiresAt <= entry.observedAt + CACHE_TTL_MS &&
        entry.expiresAt > now;
      // Return a fresh, closed projection rather than the parsed record. This
      // keeps future or tampered cache fields (including credentials) from
      // surviving a later atomic rewrite even though cache data never grants
      // permission to stream.
      return valid
        ? [{
            runtimeKey: entry.runtimeKey,
            protocol: entry.protocol,
            serverVersion: entry.serverVersion,
            schema: entry.schema,
            supported: true,
            observedAt: entry.observedAt,
            expiresAt: entry.expiresAt,
          }]
        : [];
    });
  } catch {
    return [];
  }
}

export async function loadOpenClawCapabilityCache(now = Date.now()): Promise<OpenClawCapabilityCacheEntry[]> {
  try {
    return readVerifiedOpenClawCapabilityCache(await readFile(cachePath(), "utf8"), now);
  } catch {
    return [];
  }
}

/** Atomic, integrity-checked cache write; retain the prior file as rollback evidence. */
export async function saveOpenClawCapabilityCache(entry: OpenClawCapabilityCacheEntry): Promise<void> {
  const file = cachePath();
  const entries = (await loadOpenClawCapabilityCache(entry.observedAt))
    .filter((candidate) => candidate.runtimeKey !== entry.runtimeKey)
    .concat(entry)
    .sort((a, b) => b.observedAt - a.observedAt)
    .slice(0, CACHE_MAX_ENTRIES);
  await mkdir(path.dirname(file), { recursive: true });
  // Preserve a complete prior cache before the atomic replacement. A corrupt
  // or newer unsupported runtime can therefore be rolled back without ever
  // treating stale metadata as permission to stream.
  try {
    await writeFileAtomic(`${file}.previous`, await readFile(file, "utf8"));
  } catch {
    /* first write */
  }
  await writeFileAtomic(file, JSON.stringify(createOpenClawCapabilityCache(entries)));
}

function runtimeKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

function gatewayConfigFromEnv(): { url: string; token?: string } | null {
  const url = process.env.OPENCLAW_GATEWAY_URL?.trim();
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "localhost";
    if (
      (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") ||
      (parsed.protocol === "ws:" && !loopback) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) return null;
  } catch {
    return null;
  }
  return { url, token };
}

export type OpenClawGatewayToolSubscription = {
  active: boolean;
  compatibility?: OpenClawToolCompatibility;
  fallbackReason?: string;
  close(): void;
};

type GatewayResponse = { type?: unknown; id?: unknown; ok?: unknown; payload?: unknown; error?: { message?: unknown } };

/**
 * Opens a short-lived, authenticated operator subscription beside the CLI
 * invocation. The CLI remains the authoritative text/result channel, which
 * preserves old installations and lets unsupported runtimes degrade cleanly.
 */
export async function subscribeOpenClawGatewayToolEvents(options: {
  sessionKey: string;
  agentId: string;
  /**
   * The Gateway-issued run id for this exact invocation. Session subscriptions
   * intentionally see every run for that session, so no tool frame is safe to
   * render without this correlation value.
   */
  expectedRunId?: string;
  onToolEvent(event: OpenClawGatewayToolEvent): void;
  onDisconnect?(): void;
  onDiagnostic?(diagnostic: { code: string; protocol?: number; schema?: string }): void;
  timeoutMs?: number;
  /** Test seam; production always persists verified compatibility metadata. */
  persistCapabilityCache?: boolean;
}): Promise<OpenClawGatewayToolSubscription> {
  if (
    typeof options.expectedRunId !== "string" ||
    !options.expectedRunId.trim() ||
    options.expectedRunId.length > MAX_TOOL_IDENTIFIER_LENGTH
  ) {
    // `openclaw agent --json` returns its accepted run id only with the final
    // response, after live events may already have arrived. The legacy CLI
    // transport therefore remains plain chat until it can provide this proof;
    // guessing from the first session event would attach concurrent work to
    // the wrong Cave turn.
    return { active: false, fallbackReason: "gateway_run_correlation_unavailable", close() {} };
  }
  const expectedRunId = options.expectedRunId;
  const config = gatewayConfigFromEnv();
  if (!config) return { active: false, fallbackReason: "gateway_not_configured", close() {} };
  // The cache is diagnostic/fallback state only. It never authorizes a stream:
  // a live connection must still complete the authenticated handshake above.
  const cachedCompatibility = options.persistCapabilityCache === false
    ? undefined
    : (await loadOpenClawCapabilityCache()).find(
        (entry) => entry.runtimeKey === runtimeKey(config.url) && entry.supported,
      );
  const timeoutMs = options.timeoutMs ?? 4_000;
  let socket: WebSocket;
  try {
    socket = new WebSocket(config.url, { maxPayload: MAX_GATEWAY_FRAME_BYTES });
  } catch {
    return { active: false, fallbackReason: "gateway_unavailable", close() {} };
  }
  let closed = false;
  let connected = false;
  let finished = false;
  let disconnected = false;
  let connectRequested = false;
  let handshakeAccepted = false;
  let messageSubscriptionRequested = false;
  let messageSubscriptionId = "";
  let maxInboundFrameBytes = MAX_PREAUTH_FRAME_BYTES;
  let maxBufferedBytes = MAX_GATEWAY_FRAME_BYTES;
  let tickIntervalMs: number | undefined;
  let tickWatchdog: ReturnType<typeof setTimeout> | null = null;
  let negotiatedCompatibility: OpenClawToolCompatibility | undefined;
  const armTickWatchdog = () => {
    if (!connected || !tickIntervalMs || closed) return;
    if (tickWatchdog) clearTimeout(tickWatchdog);
    tickWatchdog = setTimeout(() => {
      notifyDisconnect();
      close();
    }, tickIntervalMs * 2);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    if (tickWatchdog) clearTimeout(tickWatchdog);
    try {
      socket.close();
    } catch {
      /* socket already closed */
    }
  };
  const fallback = (fallbackReason: string, compatibility?: OpenClawToolCompatibility) => ({
    active: false,
    ...(compatibility
      ? { compatibility }
      : cachedCompatibility
        ? {
            compatibility: {
              protocol: cachedCompatibility.protocol,
              serverVersion: cachedCompatibility.serverVersion,
              schema: cachedCompatibility.schema,
              supported: cachedCompatibility.supported,
            },
          }
        : {}),
    fallbackReason,
    close,
  });
  const notifyDisconnect = () => {
    if (disconnected || closed) return;
    disconnected = true;
    options.onDisconnect?.();
  };
  return await new Promise<OpenClawGatewayToolSubscription>((resolve) => {
    const timer = setTimeout(() => {
      if (!connected) {
        options.onDiagnostic?.({ code: "gateway_handshake_timeout" });
        close();
        finish(fallback("gateway_handshake_timeout"));
      }
    }, timeoutMs);
    const finish = (value: OpenClawGatewayToolSubscription) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    socket.on("error", () => {
      if (closed) return;
      if (!connected) {
        close();
        finish(fallback("gateway_unavailable"));
      } else {
        notifyDisconnect();
        close();
      }
    });
    socket.on("close", () => {
      if (!connected) {
        finish(fallback("gateway_closed"));
      } else if (!closed) {
        notifyDisconnect();
      }
      if (tickWatchdog) clearTimeout(tickWatchdog);
      closed = true;
    });
    socket.on("message", (raw) => {
      let frame: GatewayResponse & { event?: unknown };
      const rawText = raw.toString();
      if (Buffer.byteLength(rawText, "utf8") > maxInboundFrameBytes) {
        options.onDiagnostic?.({ code: "gateway_frame_too_large" });
        if (connected) notifyDisconnect();
        close();
        if (!connected) finish(fallback("gateway_frame_too_large"));
        return;
      }
      try {
        frame = JSON.parse(rawText) as GatewayResponse & { event?: unknown };
      } catch {
        options.onDiagnostic?.({ code: "gateway_invalid_frame" });
        if (connected) {
          notifyDisconnect();
          close();
        }
        return;
      }
      armTickWatchdog();
      if (frame.type === "event" && frame.event === "connect.challenge") {
        // Challenges and responses are transport frames too: ignore replays so
        // a duplicate challenge cannot send credentials or subscriptions twice.
        if (closed || connected || connectRequested) return;
        connectRequested = true;
        socket.send(
          JSON.stringify({
            type: "req",
            id: "cave-openclaw-connect",
            method: "connect",
            params: {
              minProtocol: 4,
              maxProtocol: 4,
              // These are the Gateway v4 registered identity values. Never
              // invent a product id or mode: the server validates both before
              // authentication, so an unknown value must fall back to CLI.
              client: { id: "gateway-client", version: process.env.npm_package_version ?? "unknown", platform: process.platform, mode: "backend" },
              role: "operator",
              scopes: ["operator.read"],
              caps: ["tool-events"],
              commands: [],
              permissions: {},
              auth: { token: config.token },
            },
          }),
        );
        return;
      }
      if (frame.type === "res" && frame.id === "cave-openclaw-connect") {
        if (closed || !connectRequested || handshakeAccepted) return;
        const compatibility = frame.ok === true ? resolveOpenClawToolCompatibility(frame.payload) : undefined;
        if (!compatibility?.supported) {
          options.onDiagnostic?.({ code: "gateway_incompatible", protocol: compatibility?.protocol, schema: compatibility?.schema });
          close();
          finish(fallback(compatibility?.reason ?? "gateway_connect_rejected", compatibility));
          return;
        }
        handshakeAccepted = true;
        negotiatedCompatibility = compatibility;
        const policy = (frame.payload as GatewayHello).policy;
        if (
          !policy ||
          !positiveSafeInteger(policy.maxPayload) ||
          !positiveSafeInteger(policy.maxBufferedBytes) ||
          !positiveSafeInteger(policy.tickIntervalMs)
        ) {
          close();
          finish(fallback("gateway_invalid_policy", compatibility));
          return;
        }
        // The runtime's negotiated frame ceiling is authoritative; Cave's own
        // lower cap remains a defense-in-depth limit.
        maxInboundFrameBytes = Math.min(MAX_GATEWAY_FRAME_BYTES, policy.maxPayload);
        maxBufferedBytes = policy.maxBufferedBytes;
        tickIntervalMs = policy.tickIntervalMs;
        const observedAt = Date.now();
        if (options.persistCapabilityCache !== false) {
          void saveOpenClawCapabilityCache({
            ...compatibility,
            runtimeKey: runtimeKey(config.url),
            observedAt,
            expiresAt: observedAt + CACHE_TTL_MS,
          }).catch(() => undefined);
        }
        messageSubscriptionId = "cave-openclaw-session-messages-subscribe";
        messageSubscriptionRequested = true;
        const subscriptionRequest = JSON.stringify({
          type: "req",
          id: messageSubscriptionId,
          method: "sessions.messages.subscribe",
          params: { key: options.sessionKey, agentId: options.agentId },
        });
        if (
          Buffer.byteLength(subscriptionRequest, "utf8") > maxInboundFrameBytes ||
          socket.bufferedAmount + Buffer.byteLength(subscriptionRequest, "utf8") > maxBufferedBytes
        ) {
          close();
          finish(fallback("gateway_policy_exceeded", negotiatedCompatibility));
          return;
        }
        socket.send(subscriptionRequest);
        return;
      }
      if (frame.type === "res" && frame.id === messageSubscriptionId) {
        if (closed || !messageSubscriptionRequested || !messageSubscriptionId || connected) return;
        if (frame.ok !== true) {
          close();
          finish(fallback("gateway_subscription_rejected"));
          return;
        }
        connected = true;
        armTickWatchdog();
        finish({ active: true, compatibility: negotiatedCompatibility, close });
        return;
      }
      // Do not render an event until the authenticated connect response and
      // the scoped subscription acknowledgement have both completed. A peer
      // can legally send arbitrary event envelopes before then.
      if (!connected || closed) return;
      const toolEvent = normalizeOpenClawGatewayToolEvent(frame, options.sessionKey, options.agentId);
      if (toolEvent?.runId === expectedRunId) options.onToolEvent(toolEvent);
    });
  });
}
