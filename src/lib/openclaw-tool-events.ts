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
    requiredMethods: ["sessions.messages.subscribe"],
    requiredEvents: ["session.tool"],
    schema: "openclaw.session-tool.v1",
  },
] as const;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 8;

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
  server?: { version?: unknown };
  features?: { methods?: unknown; events?: unknown };
};

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
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
    typeof hello.server.version !== "string" ||
    !hello.features
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
  const supported =
    methods !== null &&
    events !== null &&
    adapter.requiredMethods.every((method) => methods.includes(method)) &&
    adapter.requiredEvents.every((event) => events.includes(event));
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
  id: string;
  name: string;
  phase: "start" | "update" | "result";
  input?: string;
  output?: string;
  isError: boolean;
  seq?: number;
  timestamp?: number;
};

/**
 * Strictly accept only the documented session-scoped tool envelope. Unknown
 * schemas return null so callers retain a visible plain-chat fallback rather
 * than inventing an activity card from arbitrary runtime output.
 */
export function normalizeOpenClawGatewayToolEvent(
  frame: unknown,
  expectedSessionKey: string,
): OpenClawGatewayToolEvent | null {
  const envelope = frame as { type?: unknown; event?: unknown; payload?: GatewayToolPayload };
  const payload = envelope?.payload;
  const data = payload?.data;
  if (
    envelope?.type !== "event" ||
    envelope.event !== "session.tool" ||
    !payload ||
    payload.sessionKey !== expectedSessionKey ||
    payload.stream !== "tool" ||
    !data ||
    typeof data.toolCallId !== "string" ||
    !data.toolCallId.trim() ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    (data.phase !== "start" && data.phase !== "update" && data.phase !== "result")
  ) {
    return null;
  }
  const output =
    data.phase === "update"
      ? flattenToolResultContent(data.partialResult)
      : data.phase === "result"
        ? flattenToolResultContent(data.result)
        : undefined;
  return {
    id: data.toolCallId,
    name: data.name,
    phase: data.phase,
    ...(data.phase === "start" ? { input: formatToolInputValue(data.args) } : {}),
    ...(output ? { output } : {}),
    isError: data.isError === true,
    ...(typeof payload.seq === "number" ? { seq: payload.seq } : {}),
    ...(typeof payload.ts === "number" ? { timestamp: payload.ts } : {}),
  };
}

/** Reconciles replayed and out-of-order frames without downgrading terminal state. */
export class OpenClawToolEventLedger {
  private readonly tools = new Map<string, RecordedToolEvent>();
  private readonly startedAt = new Map<string, number>();
  private readonly seenSequences = new Set<number>();

  accept(event: OpenClawGatewayToolEvent, receivedAt = Date.now()): ToolStreamEvent | null {
    if (event.seq !== undefined) {
      if (this.seenSequences.has(event.seq)) return null;
      this.seenSequences.add(event.seq);
      // A bounded replay guard is enough for one live turn and prevents an
      // untrusted runtime from growing this set indefinitely.
      if (this.seenSequences.size > 4096) this.seenSequences.clear();
    }
    const existing = this.tools.get(event.id);
    if (existing && existing.status !== "running") return null;
    const status: ToolStreamEvent["status"] =
      event.phase === "result" ? (event.isError ? "error" : "ok") : "running";
    const startedAt = this.startedAt.get(event.id) ?? event.timestamp ?? receivedAt;
    if (event.phase === "start") this.startedAt.set(event.id, event.timestamp ?? receivedAt);
    const next: RecordedToolEvent = {
      id: event.id,
      name: existing?.name ?? event.name,
      ...(existing?.input ?? event.input ? { input: existing?.input ?? event.input } : {}),
      ...(event.output ?? existing?.output ? { output: event.output ?? existing?.output } : {}),
      status,
      ...(status !== "running" && this.startedAt.has(event.id)
        ? { durationMs: Math.max(0, receivedAt - startedAt) }
        : {}),
    };
    this.tools.set(event.id, next);
    if (status !== "running") this.startedAt.delete(event.id);
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
    const parsed = JSON.parse(raw) as CapabilityCache;
    if (!parsed || !Array.isArray(parsed.entries) || parsed.integrity !== cacheIntegrity(parsed.entries)) return [];
    return parsed.entries.filter(
      (entry): entry is OpenClawCapabilityCacheEntry =>
        typeof entry?.runtimeKey === "string" &&
        typeof entry.protocol === "number" &&
        typeof entry.serverVersion === "string" &&
        typeof entry.schema === "string" &&
        typeof entry.supported === "boolean" &&
        typeof entry.observedAt === "number" &&
        typeof entry.expiresAt === "number" &&
        entry.expiresAt > now,
    );
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
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
  } catch {
    return null;
  }
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  return { url, ...(token ? { token } : {}) };
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
  onToolEvent(event: OpenClawGatewayToolEvent): void;
  onDiagnostic?(diagnostic: { code: string; protocol?: number; schema?: string }): void;
  timeoutMs?: number;
  /** Test seam; production always persists verified compatibility metadata. */
  persistCapabilityCache?: boolean;
}): Promise<OpenClawGatewayToolSubscription> {
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
  const socket = new WebSocket(config.url);
  let closed = false;
  let connected = false;
  let subscriptionId = "";
  let negotiatedCompatibility: OpenClawToolCompatibility | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
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
  return await new Promise<OpenClawGatewayToolSubscription>((resolve) => {
    const timer = setTimeout(() => {
      if (!connected) {
        options.onDiagnostic?.({ code: "gateway_handshake_timeout" });
        close();
        resolve(fallback("gateway_handshake_timeout"));
      }
    }, timeoutMs);
    const finish = (value: OpenClawGatewayToolSubscription) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.on("error", () => {
      if (!connected) finish(fallback("gateway_unavailable"));
    });
    socket.on("close", () => {
      if (!connected) finish(fallback("gateway_closed"));
    });
    socket.on("message", (raw) => {
      let frame: GatewayResponse & { event?: unknown };
      try {
        frame = JSON.parse(raw.toString()) as GatewayResponse & { event?: unknown };
      } catch {
        options.onDiagnostic?.({ code: "gateway_invalid_frame" });
        return;
      }
      if (frame.type === "event" && frame.event === "connect.challenge") {
        socket.send(
          JSON.stringify({
            type: "req",
            id: "cave-openclaw-connect",
            method: "connect",
            params: {
              minProtocol: 4,
              maxProtocol: 4,
              client: { id: "coven-cave", version: process.env.npm_package_version ?? "unknown", platform: process.platform, mode: "operator" },
              role: "operator",
              scopes: ["operator.read"],
              caps: ["tool-events"],
              commands: [],
              permissions: {},
              ...(config.token ? { auth: { token: config.token } } : {}),
            },
          }),
        );
        return;
      }
      if (frame.type === "res" && frame.id === "cave-openclaw-connect") {
        const compatibility = frame.ok === true ? resolveOpenClawToolCompatibility(frame.payload) : undefined;
        if (!compatibility?.supported) {
          options.onDiagnostic?.({ code: "gateway_incompatible", protocol: compatibility?.protocol, schema: compatibility?.schema });
          close();
          finish(fallback(compatibility?.reason ?? "gateway_connect_rejected", compatibility));
          return;
        }
        negotiatedCompatibility = compatibility;
        const observedAt = Date.now();
        if (options.persistCapabilityCache !== false) {
          void saveOpenClawCapabilityCache({
            ...compatibility,
            runtimeKey: runtimeKey(config.url),
            observedAt,
            expiresAt: observedAt + CACHE_TTL_MS,
          });
        }
        subscriptionId = "cave-openclaw-subscribe";
        socket.send(
          JSON.stringify({
            type: "req",
            id: subscriptionId,
            method: "sessions.messages.subscribe",
            params: { key: options.sessionKey, agentId: options.agentId },
          }),
        );
        return;
      }
      if (frame.type === "res" && frame.id === subscriptionId) {
        if (frame.ok !== true) {
          close();
          finish(fallback("gateway_subscription_rejected"));
          return;
        }
        connected = true;
        finish({ active: true, compatibility: negotiatedCompatibility, close });
        return;
      }
      const toolEvent = normalizeOpenClawGatewayToolEvent(frame, options.sessionKey);
      if (toolEvent) options.onToolEvent(toolEvent);
    });
  });
}
