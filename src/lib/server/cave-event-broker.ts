/**
 * The process-local event-plane broker behind `/api/events-ws` (#5830).
 *
 * It owns one random epoch per server boot, one monotonic sequence, a version
 * per topic, a replay ring bounded by count and bytes, each client's installed
 * topic set and highest cumulative acknowledgement, and diagnostic counters.
 * It sends invalidations only; REST snapshots stay authoritative.
 *
 * The socket, timers and epoch source are injected so the whole state machine
 * runs under deterministic tests. `server.ts` adapts a `ws` WebSocket to
 * `EventSocket` and is bundled with this module into server.mjs.
 */

import { randomUUID } from "node:crypto";
import {
  CAVE_EVENT_CLOSE,
  CAVE_EVENT_PROTOCOL,
  CAVE_EVENT_TOPICS,
  CaveEventProtocolError,
  MAX_EVENT_MESSAGE_BYTES,
  normalizeEntityIds,
  parseEventClientMessage,
  type CaveEventTopic,
  type EventClientMessage,
  type EventServerMessage,
} from "../cave-event-plane-protocol.ts";

/** The subset of a `ws` WebSocket the broker needs. */
export type EventSocket = {
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code: number, reason: string): void;
  ping(): void;
  terminate(): void;
};

export type EventBrokerOptions = {
  ringCountLimit?: number;
  ringByteLimit?: number;
  heartbeatMs?: number;
  /** Close a client before sending once its unsent output passes this. */
  bufferedAmountLimit?: number;
  newEpoch?: () => string;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export const EVENT_RING_COUNT_DEFAULT = 2_048;
export const EVENT_RING_COUNT_MAX = 16_384;
export const EVENT_RING_BYTE_LIMIT = 1024 * 1024;
export const EVENT_HEARTBEAT_MS = 25_000;
export const EVENT_BUFFERED_AMOUNT_LIMIT = 256 * 1024;

type TopicCounts = Record<CaveEventTopic, number>;

export type EventPlaneDiagnostics = {
  epoch: string;
  seq: number;
  versions: TopicCounts;
  connections: number;
  /** Connections that completed hello and received their ready barrier. */
  readyConnections: number;
  subscriptions: TopicCounts;
  published: TopicCounts;
  delivered: TopicCounts;
  replayed: number;
  replayGaps: number;
  restartResyncs: number;
  acknowledgements: number;
  ringEvents: number;
  ringBytes: number;
  closures: {
    protocol: number;
    invalidFrame: number;
    slowConsumer: number;
    heartbeat: number;
  };
};

export type EventBroker = {
  /** Take over a connected socket. Returns the handlers to wire to its events. */
  attach(socket: EventSocket): EventSocketHandlers;
  publish(topic: CaveEventTopic, entityIds?: readonly string[]): void;
  diagnostics(): EventPlaneDiagnostics;
  epoch(): string;
  shutdown(): void;
};

export type EventSocketHandlers = {
  message(data: unknown, isBinary: boolean): void;
  pong(): void;
  closed(): void;
};

type ClientState = {
  helloed: boolean;
  topics: Set<CaveEventTopic>;
  acknowledged: number;
  /** Answered the last heartbeat ping. */
  alive: boolean;
  /** Heartbeats seen without a hello. A silent socket can't hold a slot. */
  silentBeats: number;
};

type RingRecord = { seq: number; topic: CaveEventTopic; encoded: string; bytes: number };

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;
const zeroCounts = (): TopicCounts =>
  Object.fromEntries(CAVE_EVENT_TOPICS.map((topic) => [topic, 0])) as TopicCounts;

/**
 * A positive safe integer from the environment, clamped to `maximum`, or the
 * fallback for anything missing or malformed.
 */
export function boundedPositiveInt(raw: string | undefined, fallback: number, maximum: number): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}

function frameText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data) && data.every((part) => part instanceof Uint8Array)) {
    return Buffer.concat(data as Uint8Array[]).toString("utf8");
  }
  return null;
}

function frameBytes(data: unknown): number {
  if (typeof data === "string") return byteLength(data);
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + ((part as Uint8Array)?.byteLength ?? 0), 0);
  return Number.POSITIVE_INFINITY;
}

export function createEventBroker(options: EventBrokerOptions = {}): EventBroker {
  const ringCountLimit = Math.max(1, Math.min(options.ringCountLimit ?? EVENT_RING_COUNT_DEFAULT, EVENT_RING_COUNT_MAX));
  const ringByteLimit = Math.max(1, options.ringByteLimit ?? EVENT_RING_BYTE_LIMIT);
  const heartbeatMs = options.heartbeatMs ?? EVENT_HEARTBEAT_MS;
  const bufferedAmountLimit = options.bufferedAmountLimit ?? EVENT_BUFFERED_AMOUNT_LIMIT;
  const startInterval = options.setInterval ?? ((callback, ms) => {
    const handle = setInterval(callback, ms);
    handle.unref?.();
    return handle;
  });
  const stopInterval = options.clearInterval ?? ((handle) => clearInterval(handle as NodeJS.Timeout));

  const epoch = (options.newEpoch ?? randomUUID)();
  let seq = 0;
  const versions = zeroCounts();
  const ring: RingRecord[] = [];
  let ringBytes = 0;
  const clients = new Map<EventSocket, ClientState>();
  let heartbeat: unknown = null;

  const counters = {
    published: zeroCounts(),
    delivered: zeroCounts(),
    replayed: 0,
    replayGaps: 0,
    restartResyncs: 0,
    acknowledgements: 0,
    closures: { protocol: 0, invalidFrame: 0, slowConsumer: 0, heartbeat: 0 },
  };

  const forget = (socket: EventSocket) => {
    clients.delete(socket);
    if (clients.size === 0 && heartbeat !== null) {
      stopInterval(heartbeat);
      heartbeat = null;
    }
  };

  // Reasons are fixed strings: a refusal never discloses epoch, sequence or
  // topic state to a client that hasn't completed a valid hello.
  const refuse = (socket: EventSocket, code: number, reason: string) => {
    if (code === CAVE_EVENT_CLOSE.protocol) counters.closures.protocol += 1;
    else if (code === CAVE_EVENT_CLOSE.slowConsumer) counters.closures.slowConsumer += 1;
    else counters.closures.invalidFrame += 1;
    forget(socket);
    try {
      socket.close(code, reason);
    } catch {
      socket.terminate();
    }
  };

  /** Send unless the client is already too far behind; then close it. */
  const deliver = (socket: EventSocket, encoded: string): boolean => {
    if (socket.bufferedAmount > bufferedAmountLimit) {
      refuse(socket, CAVE_EVENT_CLOSE.slowConsumer, "slow consumer");
      return false;
    }
    try {
      socket.send(encoded);
      return true;
    } catch {
      forget(socket);
      socket.terminate();
      return false;
    }
  };

  const sendMessage = (socket: EventSocket, message: EventServerMessage) => deliver(socket, JSON.stringify(message));

  const installedVersions = (topics: Iterable<CaveEventTopic>) => {
    const out: Partial<Record<CaveEventTopic, number>> = {};
    for (const topic of topics) out[topic] = versions[topic];
    return out;
  };

  const ready = (socket: EventSocket, state: ClientState) =>
    sendMessage(socket, {
      type: "ready",
      protocol: CAVE_EVENT_PROTOCOL,
      epoch,
      seq,
      topics: [...state.topics],
      versions: installedVersions(state.topics),
    });

  const resync = (socket: EventSocket, state: ClientState, reason: "server-restarted" | "replay-gap") =>
    sendMessage(socket, {
      type: "resync-required",
      protocol: CAVE_EVENT_PROTOCOL,
      epoch,
      seq,
      topics: [...state.topics],
      reason,
    });

  const handleHello = (socket: EventSocket, state: ClientState, message: Extract<EventClientMessage, { type: "hello" }>) => {
    state.helloed = true;
    state.topics = new Set(message.topics);
    const resume = message.resume;
    if (resume) {
      if (resume.epoch !== epoch) {
        counters.restartResyncs += 1;
        if (!resync(socket, state, "server-restarted")) return;
      } else if (resume.seq > seq) {
        refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "impossible resume cursor");
        return;
      } else {
        // The oldest sequence still replayable; everything after the cursor
        // must be in the ring, or the client has missed events.
        const oldest = ring[0]?.seq ?? seq + 1;
        if (resume.seq < oldest - 1) {
          counters.replayGaps += 1;
          if (!resync(socket, state, "replay-gap")) return;
        } else {
          for (const record of ring) {
            if (record.seq <= resume.seq || !state.topics.has(record.topic)) continue;
            if (!deliver(socket, record.encoded)) return;
            counters.replayed += 1;
          }
          state.acknowledged = resume.seq;
        }
      }
    }
    ready(socket, state);
  };

  const handleMessage = (socket: EventSocket, data: unknown, isBinary: boolean) => {
    const state = clients.get(socket);
    if (!state) return;
    if (isBinary) {
      refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "binary frames are not accepted");
      return;
    }
    if (frameBytes(data) > MAX_EVENT_MESSAGE_BYTES) {
      refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "frame too large");
      return;
    }
    const text = frameText(data);
    if (text === null) {
      refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "invalid frame");
      return;
    }
    let message: EventClientMessage;
    try {
      message = parseEventClientMessage(text);
    } catch (error) {
      const code = error instanceof CaveEventProtocolError ? error.closeCode : CAVE_EVENT_CLOSE.invalidFrame;
      refuse(socket, code, code === CAVE_EVENT_CLOSE.protocol ? "unsupported protocol" : "invalid frame");
      return;
    }
    if (!state.helloed) {
      if (message.type !== "hello") {
        refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "hello required");
        return;
      }
      handleHello(socket, state, message);
      return;
    }
    switch (message.type) {
      case "hello":
        refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "duplicate hello");
        return;
      case "subscribe":
        // A complete replacement, answered with a fresh barrier.
        state.topics = new Set(message.topics);
        ready(socket, state);
        return;
      case "ack":
        if (message.epoch !== epoch || message.seq > seq) {
          refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "invalid acknowledgement");
          return;
        }
        if (message.seq > state.acknowledged) {
          state.acknowledged = message.seq;
          counters.acknowledgements += 1;
        }
        return;
    }
  };

  const beat = () => {
    for (const [socket, state] of [...clients]) {
      if (!state.alive) {
        counters.closures.heartbeat += 1;
        forget(socket);
        socket.terminate();
        continue;
      }
      if (!state.helloed) {
        state.silentBeats += 1;
        if (state.silentBeats >= 2) {
          refuse(socket, CAVE_EVENT_CLOSE.invalidFrame, "hello required");
          continue;
        }
      }
      state.alive = false;
      try {
        socket.ping();
      } catch {
        forget(socket);
        socket.terminate();
      }
    }
  };

  return {
    attach(socket) {
      clients.set(socket, { helloed: false, topics: new Set(), acknowledged: 0, alive: true, silentBeats: 0 });
      if (heartbeat === null) heartbeat = startInterval(beat, heartbeatMs);
      return {
        message: (data, isBinary) => handleMessage(socket, data, isBinary),
        pong: () => {
          const state = clients.get(socket);
          if (state) state.alive = true;
        },
        closed: () => forget(socket),
      };
    },

    publish(topic, entityIds) {
      if (!(CAVE_EVENT_TOPICS as readonly string[]).includes(topic)) throw new Error(`unknown event topic: ${topic}`);
      const ids = normalizeEntityIds(entityIds);
      seq += 1;
      versions[topic] += 1;
      counters.published[topic] += 1;
      const message: EventServerMessage = {
        type: "invalidate",
        protocol: CAVE_EVENT_PROTOCOL,
        epoch,
        seq,
        topic,
        version: versions[topic],
        ...(ids ? { entityIds: ids } : {}),
      };
      const encoded = JSON.stringify(message);
      const bytes = byteLength(encoded);
      ring.push({ seq, topic, encoded, bytes });
      ringBytes += bytes;
      while (ring.length > ringCountLimit || ringBytes > ringByteLimit) {
        const evicted = ring.shift();
        if (!evicted) break;
        ringBytes -= evicted.bytes;
      }
      for (const [socket, state] of [...clients]) {
        if (!state.helloed || !state.topics.has(topic)) continue;
        if (deliver(socket, encoded)) counters.delivered[topic] += 1;
      }
    },

    diagnostics() {
      const subscriptions = zeroCounts();
      let readyConnections = 0;
      for (const state of clients.values()) {
        if (state.helloed) readyConnections += 1;
        for (const topic of state.topics) subscriptions[topic] += 1;
      }
      return {
        epoch,
        seq,
        versions: { ...versions },
        connections: clients.size,
        readyConnections,
        subscriptions,
        published: { ...counters.published },
        delivered: { ...counters.delivered },
        replayed: counters.replayed,
        replayGaps: counters.replayGaps,
        restartResyncs: counters.restartResyncs,
        acknowledgements: counters.acknowledgements,
        ringEvents: ring.length,
        ringBytes,
        closures: { ...counters.closures },
      };
    },

    epoch: () => epoch,

    shutdown() {
      if (heartbeat !== null) stopInterval(heartbeat);
      heartbeat = null;
      for (const socket of [...clients.keys()]) {
        clients.delete(socket);
        try {
          socket.close(1001, "server shutting down");
        } catch {
          socket.terminate();
        }
      }
    },
  };
}

/**
 * What diagnostics surfaces may show about the plane (#5862): aggregate counts
 * only. The epoch, cursors, entity ids and credentials stay inside the broker.
 */
export type EventPlaneDiagnosticsSummary = {
  enabled: boolean;
  activeConnections: number;
  readyConnections: number;
  /** Clients subscribed per topic. */
  subscriptions: TopicCounts;
  /** Invalidations published per topic since the server started. */
  invalidations: TopicCounts;
  replayGaps: number;
  slowConsumerCloses: number;
};

export function summarizeEventPlaneDiagnostics(diagnostics: EventPlaneDiagnostics | null): EventPlaneDiagnosticsSummary {
  if (!diagnostics) {
    return {
      enabled: false,
      activeConnections: 0,
      readyConnections: 0,
      subscriptions: zeroCounts(),
      invalidations: zeroCounts(),
      replayGaps: 0,
      slowConsumerCloses: 0,
    };
  }
  return {
    enabled: true,
    activeConnections: diagnostics.connections,
    readyConnections: diagnostics.readyConnections,
    subscriptions: { ...diagnostics.subscriptions },
    invalidations: { ...diagnostics.published },
    replayGaps: diagnostics.replayGaps,
    slowConsumerCloses: diagnostics.closures.slowConsumer,
  };
}
