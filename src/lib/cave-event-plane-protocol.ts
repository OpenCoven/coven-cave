/**
 * Cave event plane, protocol v1 (#5830, design:
 * docs/superpowers/specs/2026-08-28-demand-driven-websocket-event-plane-design.md).
 *
 * The event socket carries invalidations only: "this snapshot may be stale",
 * never resource payloads. REST snapshots stay authoritative. Everything here
 * is shared by the server broker (bundled into server.mjs), the browser and
 * Tauri client, and — through the golden fixture — the Swift client, so the
 * parsers are strict and fail closed: an unknown topic, an unsupported
 * protocol, or an out-of-bounds field is refused, never ignored.
 *
 * This module is isomorphic. It must not import Node-only or DOM-only APIs.
 */

export const CAVE_EVENT_PROTOCOL = 1 as const;
export const CAVE_EVENT_PATH = "/api/events-ws" as const;
/** Inbound and outbound frames are bounded before parsing. */
export const MAX_EVENT_MESSAGE_BYTES = 16 * 1024;
export const MAX_EVENT_ENTITY_IDS = 32;
export const MAX_EVENT_ENTITY_ID_BYTES = 256;
/** Client ids and epochs are opaque labels, not payloads. */
export const MAX_EVENT_LABEL_BYTES = 128;

/** Close codes are fixed across the server, TypeScript client, and Swift client. */
export const CAVE_EVENT_CLOSE = {
  /** Unsupported protocol version. Not retryable with the same client. */
  protocol: 4_400,
  /** Malformed, binary, oversized, or otherwise invalid frame. */
  invalidFrame: 4_402,
  /** Slow consumer. Retryable with backoff. */
  slowConsumer: 4_408,
} as const;

export const CAVE_EVENT_TOPICS = [
  "sessions",
  "board",
  "runs",
  "familiars",
  "daemon",
] as const;

export type CaveEventTopic = (typeof CAVE_EVENT_TOPICS)[number];
export type CaveEventRolloutMode = "off" | "shadow" | "primary";
export const CAVE_EVENT_ROLLOUT_MODES: readonly CaveEventRolloutMode[] = ["off", "shadow", "primary"];

export type CaveEventPlaneCapability = {
  enabled: boolean;
  protocolVersion: typeof CAVE_EVENT_PROTOCOL;
  path: typeof CAVE_EVENT_PATH;
  topics: CaveEventTopic[];
  rolloutMode: {
    web: CaveEventRolloutMode;
    ios: CaveEventRolloutMode;
  };
};

export type CaveEventResumeCursor = { epoch: string; seq: number };

export type EventClientMessage =
  | {
      type: "hello";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      clientId: string;
      topics: CaveEventTopic[];
      resume?: CaveEventResumeCursor;
    }
  | {
      /** Replaces the complete topic set; the server answers with a new `ready`. */
      type: "subscribe";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      topics: CaveEventTopic[];
    }
  | {
      /** Cumulative: the highest sequence the client has processed. */
      type: "ack";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      epoch: string;
      seq: number;
    };

export type CaveEventResyncReason = "server-restarted" | "replay-gap";
const RESYNC_REASONS: readonly CaveEventResyncReason[] = ["server-restarted", "replay-gap"];

export type EventServerMessage =
  | {
      /**
       * The subscription barrier. Sent after `hello` and after every
       * complete-set `subscribe`; a client replaces topic health only from
       * the latest `ready`, and starts its authoritative fetch after it.
       */
      type: "ready";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      epoch: string;
      seq: number;
      topics: CaveEventTopic[];
      versions: Partial<Record<CaveEventTopic, number>>;
    }
  | {
      type: "invalidate";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      epoch: string;
      seq: number;
      topic: CaveEventTopic;
      version: number;
      entityIds?: string[];
    }
  | {
      type: "resync-required";
      protocol: typeof CAVE_EVENT_PROTOCOL;
      epoch: string;
      seq: number;
      topics: CaveEventTopic[];
      reason: CaveEventResyncReason;
    };

/** A refused frame, carrying the close code it maps to. */
export class CaveEventProtocolError extends Error {
  readonly closeCode: number;

  constructor(message: string, closeCode: number = CAVE_EVENT_CLOSE.invalidFrame) {
    super(message);
    this.name = "CaveEventProtocolError";
    this.closeCode = closeCode;
  }
}

const encoder = new TextEncoder();
const utf8Bytes = (value: string): number => encoder.encode(value).byteLength;

export function isCaveEventTopic(value: unknown): value is CaveEventTopic {
  return typeof value === "string" && (CAVE_EVENT_TOPICS as readonly string[]).includes(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function invalid(message: string): never {
  throw new CaveEventProtocolError(message);
}

function safeCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`event ${field} must be a non-negative safe integer`);
  }
  return value;
}

function label(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`event ${field} must be a non-empty string`);
  if (utf8Bytes(value) > MAX_EVENT_LABEL_BYTES) invalid(`event ${field} exceeds ${MAX_EVENT_LABEL_BYTES} bytes`);
  return value;
}

/** A duplicate-free list of allowlisted topics, in the caller's order. */
export function normalizeTopics(value: unknown): CaveEventTopic[] {
  if (!Array.isArray(value)) invalid("event topics must be an array");
  const seen = new Set<CaveEventTopic>();
  for (const topic of value) {
    if (!isCaveEventTopic(topic)) invalid(`unknown event topic: ${String(topic).slice(0, 32)}`);
    if (seen.has(topic)) invalid(`duplicate event topic: ${topic}`);
    seen.add(topic);
  }
  return [...seen];
}

/**
 * Advisory entity ids. Omitted means a full invalidation of the topic, and a
 * client must stay correct without ids. Returns `undefined` for none.
 */
export function normalizeEntityIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid("event entity ids must be an array");
  if (value.length > MAX_EVENT_ENTITY_IDS) invalid(`an event names at most ${MAX_EVENT_ENTITY_IDS} entity ids`);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || id.length === 0) invalid("event entity ids must be non-empty strings");
    if (utf8Bytes(id) > MAX_EVENT_ENTITY_ID_BYTES) {
      invalid(`event entity ids are at most ${MAX_EVENT_ENTITY_ID_BYTES} bytes`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

function decodeFrame(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") invalid("event frames must be text");
  if (utf8Bytes(raw) > MAX_EVENT_MESSAGE_BYTES) invalid("event message exceeds 16 KiB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid("event message is not JSON");
  }
  if (!isPlainRecord(parsed)) invalid("event message must be an object");
  if (parsed.protocol !== CAVE_EVENT_PROTOCOL) {
    throw new CaveEventProtocolError("unsupported event protocol", CAVE_EVENT_CLOSE.protocol);
  }
  return parsed;
}

function resumeCursor(value: unknown): CaveEventResumeCursor | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) invalid("event resume cursor must be an object");
  return { epoch: label(value.epoch, "resume epoch"), seq: safeCount(value.seq, "resume seq") };
}

export function parseEventClientMessage(raw: unknown): EventClientMessage {
  const message = decodeFrame(raw);
  switch (message.type) {
    case "hello": {
      const resume = resumeCursor(message.resume);
      return {
        type: "hello",
        protocol: CAVE_EVENT_PROTOCOL,
        clientId: label(message.clientId, "client id"),
        topics: normalizeTopics(message.topics),
        ...(resume ? { resume } : {}),
      };
    }
    case "subscribe":
      return { type: "subscribe", protocol: CAVE_EVENT_PROTOCOL, topics: normalizeTopics(message.topics) };
    case "ack":
      return {
        type: "ack",
        protocol: CAVE_EVENT_PROTOCOL,
        epoch: label(message.epoch, "ack epoch"),
        seq: safeCount(message.seq, "ack seq"),
      };
    default:
      return invalid("unknown event message type");
  }
}

function topicVersions(value: unknown, topics: readonly CaveEventTopic[]): Partial<Record<CaveEventTopic, number>> {
  if (!isPlainRecord(value)) invalid("event versions must be an object");
  const versions: Partial<Record<CaveEventTopic, number>> = {};
  for (const [key, version] of Object.entries(value)) {
    if (!isCaveEventTopic(key)) invalid(`unknown event topic: ${key.slice(0, 32)}`);
    if (!topics.includes(key)) invalid(`event version for an unsubscribed topic: ${key}`);
    versions[key] = safeCount(version, "topic version");
  }
  return versions;
}

export function parseEventServerMessage(raw: unknown): EventServerMessage {
  const message = decodeFrame(raw);
  const epoch = label(message.epoch, "epoch");
  const seq = safeCount(message.seq, "seq");
  switch (message.type) {
    case "ready": {
      const topics = normalizeTopics(message.topics);
      return {
        type: "ready",
        protocol: CAVE_EVENT_PROTOCOL,
        epoch,
        seq,
        topics,
        versions: topicVersions(message.versions, topics),
      };
    }
    case "invalidate": {
      if (!isCaveEventTopic(message.topic)) invalid(`unknown event topic: ${String(message.topic).slice(0, 32)}`);
      const entityIds = normalizeEntityIds(message.entityIds);
      return {
        type: "invalidate",
        protocol: CAVE_EVENT_PROTOCOL,
        epoch,
        seq,
        topic: message.topic,
        version: safeCount(message.version, "topic version"),
        ...(entityIds ? { entityIds } : {}),
      };
    }
    case "resync-required": {
      const reason = message.reason;
      if (typeof reason !== "string" || !(RESYNC_REASONS as readonly string[]).includes(reason)) {
        invalid("unknown event resync reason");
      }
      return {
        type: "resync-required",
        protocol: CAVE_EVENT_PROTOCOL,
        epoch,
        seq,
        topics: normalizeTopics(message.topics),
        reason: reason as CaveEventResyncReason,
      };
    }
    default:
      return invalid("unknown event message type");
  }
}

/**
 * The advertised capability. The server's master switch must be explicitly
 * on (`COVEN_CAVE_EVENT_PLANE_ENABLED=1`), and each platform's rollout mode
 * defaults to `off`; an unrecognized value fails closed to `off`.
 */
export function eventPlaneCapabilityFromEnv(env: Readonly<Record<string, string | undefined>>): CaveEventPlaneCapability {
  const mode = (raw: string | undefined): CaveEventRolloutMode => {
    const value = raw?.trim().toLowerCase();
    return (CAVE_EVENT_ROLLOUT_MODES as readonly string[]).includes(value ?? "") ? (value as CaveEventRolloutMode) : "off";
  };
  return {
    enabled: isEventPlaneEnabled(env),
    protocolVersion: CAVE_EVENT_PROTOCOL,
    path: CAVE_EVENT_PATH,
    topics: [...CAVE_EVENT_TOPICS],
    rolloutMode: { web: mode(env.COVEN_CAVE_EVENT_WEB_MODE), ios: mode(env.COVEN_CAVE_EVENT_IOS_MODE) },
  };
}

/** The master switch. Only an explicit `1` or `true` turns the plane on. */
export function isEventPlaneEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.COVEN_CAVE_EVENT_PLANE_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}
