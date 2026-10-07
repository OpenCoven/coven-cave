/**
 * Demand-driven browser and Tauri client for the Cave event plane (#5833;
 * design: docs/superpowers/specs/2026-08-28-demand-driven-websocket-event-plane-design.md).
 *
 * One manager per webview owns at most one socket, opened only while some
 * topic has a subscriber and the server advertises the plane with a web
 * rollout mode other than `off`. Subscribers hear "this topic may be stale"
 * and refresh through their existing owners: this module never fetches a
 * resource snapshot itself.
 *
 * - `shadow` mode validates, sequences, acknowledges and counts invalidations
 *   but never notifies, so polling stays authoritative.
 * - `primary` mode delivers them, coalesced over 100 ms and held while the
 *   window is hidden.
 *
 * A topic is ready, which lets a caller pause its fallback poll, only after the
 * server's latest `ready` barrier includes it on a healthy connection.
 *
 * Every dependency (socket, capability fetch, clock, timers, randomness,
 * visibility) is injected, so the state machine runs under deterministic tests.
 */

import {
  CAVE_EVENT_CLOSE,
  CAVE_EVENT_PROTOCOL,
  CAVE_EVENT_TOPICS,
  MAX_EVENT_ENTITY_IDS,
  parseEventServerMessage,
  type CaveEventPlaneCapability,
  type CaveEventRolloutMode,
  type CaveEventTopic,
  type EventServerMessage,
} from "./cave-event-plane-protocol.ts";
import { websocketUrl } from "./websocket-url.ts";

export type CaveEventPlaneState =
  | "disabled"
  | "idle"
  | "connecting"
  | "ready"
  | "backing-off"
  | "degraded";

export type CaveEventInvalidation = {
  topic: CaveEventTopic;
  version: number;
  /** Advisory. Absent means the whole topic may be stale. */
  entityIds?: readonly string[];
};

/** The subset of a browser WebSocket the manager uses. */
export type CaveEventSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
};

export type CaveEventPlaneDependencies = {
  /** The advertised capability, or null when it can't be read. */
  fetchCapability(): Promise<CaveEventPlaneCapability | null>;
  createSocket(url: string): CaveEventSocket;
  socketUrl(path: string): string;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** In [0, 1). Drives backoff jitter. */
  random(): number;
  visibility: {
    isVisible(): boolean;
    /** Fires on visibility and focus changes. Returns an unsubscribe. */
    onChange(listener: () => void): () => void;
  };
  clientId: string;
};

export type CaveEventPlaneClientDiagnostics = {
  state: CaveEventPlaneState;
  rolloutMode: CaveEventRolloutMode;
  connectAttempts: number;
  opens: number;
  reconnects: number;
  currentBackoffMs: number;
  invalidationsObserved: Record<CaveEventTopic, number>;
  invalidationsDelivered: Record<CaveEventTopic, number>;
  coalesced: number;
  resyncs: number;
  acknowledgementsSent: number;
  invalidServerMessages: number;
  fallbackActivations: number;
};

export type CaveEventPlaneClient = {
  subscribe(topic: CaveEventTopic, listener: (event: CaveEventInvalidation) => void): () => void;
  /** True only while the connection is ready and its latest barrier installed this topic. */
  topicReady(topic: CaveEventTopic): boolean;
  state(): CaveEventPlaneState;
  rolloutMode(): CaveEventRolloutMode;
  /** For useSyncExternalStore: fires whenever state, readiness or mode changes. */
  onChange(listener: () => void): () => void;
  diagnostics(): CaveEventPlaneClientDiagnostics;
  refreshCapabilities(): Promise<void>;
  dispose(): void;
};

export const EVENT_CONNECT_TIMEOUT_MS = 8_000;
export const EVENT_IDLE_CLOSE_MS = 15_000;
export const EVENT_COALESCE_MS = 100;
export const EVENT_ACK_INTERVAL_MS = 1_000;
export const EVENT_BACKOFF_INITIAL_MS = 500;
export const EVENT_BACKOFF_MAX_MS = 30_000;

const OPEN = 1;
const zeroCounts = () =>
  Object.fromEntries(CAVE_EVENT_TOPICS.map((topic) => [topic, 0])) as Record<CaveEventTopic, number>;

type Dirty = { version: number; entityIds: Set<string> | null };

export function createCaveEventPlaneClient(deps: CaveEventPlaneDependencies): CaveEventPlaneClient {
  const listeners = new Map<CaveEventTopic, Set<(event: CaveEventInvalidation) => void>>();
  const changeListeners = new Set<() => void>();

  let capability: CaveEventPlaneCapability | null = null;
  let capabilityLoad: Promise<void> | null = null;
  let capabilityLoaded = false;

  let state: CaveEventPlaneState = "idle";
  let socket: CaveEventSocket | null = null;
  let helloSent = false;
  /** Topics the server's latest barrier installed. */
  let readyTopics = new Set<CaveEventTopic>();
  /** The resume cursor, kept in memory only. */
  let cursor: { epoch: string; seq: number } | null = null;
  let barrierSeen = false;

  const dirty = new Map<CaveEventTopic, Dirty>();
  let coalesceTimer: unknown = null;
  let connectTimer: unknown = null;
  let idleTimer: unknown = null;
  let backoffTimer: unknown = null;
  let ackTimer: unknown = null;
  let lastAckAt = Number.NEGATIVE_INFINITY;
  let ackedSeq = 0;
  let attempts = 0;
  let disposed = false;

  const counters = {
    connectAttempts: 0,
    opens: 0,
    reconnects: 0,
    currentBackoffMs: 0,
    invalidationsObserved: zeroCounts(),
    invalidationsDelivered: zeroCounts(),
    coalesced: 0,
    resyncs: 0,
    acknowledgementsSent: 0,
    invalidServerMessages: 0,
    fallbackActivations: 0,
  };

  const mode = (): CaveEventRolloutMode =>
    capability?.enabled ? capability.rolloutMode.web : "off";
  const subscribedTopics = (): CaveEventTopic[] =>
    CAVE_EVENT_TOPICS.filter((topic) => (listeners.get(topic)?.size ?? 0) > 0);

  const emitChange = () => {
    for (const listener of [...changeListeners]) listener();
  };
  const setState = (next: CaveEventPlaneState) => {
    if (next === state) return;
    if ((next === "backing-off" || next === "degraded") && state !== "backing-off" && state !== "degraded") {
      counters.fallbackActivations += 1;
    }
    state = next;
    emitChange();
  };
  const clear = (handle: unknown) => {
    if (handle !== null) deps.clearTimeout(handle);
  };

  const send = (message: object) => {
    if (socket?.readyState === OPEN) socket.send(JSON.stringify(message));
  };

  // ── Acknowledgements ─────────────────────────────────────────────────────
  const flushAck = () => {
    ackTimer = null;
    if (!cursor || cursor.seq <= ackedSeq || socket?.readyState !== OPEN) return;
    send({ type: "ack", protocol: CAVE_EVENT_PROTOCOL, epoch: cursor.epoch, seq: cursor.seq });
    ackedSeq = cursor.seq;
    lastAckAt = deps.now();
    counters.acknowledgementsSent += 1;
  };
  const scheduleAck = () => {
    if (ackTimer !== null || !cursor || cursor.seq <= ackedSeq) return;
    const wait = Math.max(0, lastAckAt + EVENT_ACK_INTERVAL_MS - deps.now());
    if (wait === 0) flushAck();
    else ackTimer = deps.setTimeout(flushAck, wait);
  };

  // ── Delivery ─────────────────────────────────────────────────────────────
  const deliver = () => {
    coalesceTimer = null;
    if (mode() !== "primary" || !barrierSeen || !deps.visibility.isVisible()) return;
    const pending = [...dirty.entries()];
    dirty.clear();
    for (const [topic, entry] of pending) {
      const subscribers = listeners.get(topic);
      if (!subscribers || subscribers.size === 0) continue;
      const ids = entry.entityIds ? [...entry.entityIds] : undefined;
      const event: CaveEventInvalidation = { topic, version: entry.version, ...(ids && ids.length ? { entityIds: ids } : {}) };
      counters.invalidationsDelivered[topic] += 1;
      for (const listener of [...subscribers]) listener(event);
    }
  };
  const scheduleDelivery = () => {
    if (coalesceTimer !== null) return;
    if (mode() !== "primary" || !barrierSeen || !deps.visibility.isVisible()) return;
    coalesceTimer = deps.setTimeout(deliver, EVENT_COALESCE_MS);
  };
  const markDirty = (topic: CaveEventTopic, version: number, entityIds: readonly string[] | undefined) => {
    if ((listeners.get(topic)?.size ?? 0) === 0) return;
    if (mode() !== "primary") return;
    const existing = dirty.get(topic);
    if (existing) counters.coalesced += 1;
    let ids: Set<string> | null;
    if (!entityIds || (existing && existing.entityIds === null)) ids = null;
    else {
      ids = new Set(existing?.entityIds ?? []);
      for (const id of entityIds) ids.add(id);
      // Past the protocol bound the ids stop helping: refresh the whole topic.
      if (ids.size > MAX_EVENT_ENTITY_IDS) ids = null;
    }
    dirty.set(topic, { version: Math.max(version, existing?.version ?? 0), entityIds: ids });
    scheduleDelivery();
  };

  // ── Connection ───────────────────────────────────────────────────────────
  const teardownSocket = (code: number, reason: string) => {
    const current = socket;
    socket = null;
    helloSent = false;
    clear(connectTimer);
    connectTimer = null;
    clear(ackTimer);
    ackTimer = null;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onclose = null;
      current.onerror = null;
      try {
        current.close(code, reason);
      } catch {
        // Already closed.
      }
    }
    if (readyTopics.size > 0) {
      readyTopics = new Set();
      emitChange();
    }
  };

  const scheduleReconnect = () => {
    if (disposed || subscribedTopics().length === 0) {
      setState("idle");
      return;
    }
    const base = Math.min(EVENT_BACKOFF_MAX_MS, EVENT_BACKOFF_INITIAL_MS * 2 ** attempts);
    const delay = Math.round(Math.min(EVENT_BACKOFF_MAX_MS, base * (0.8 + 0.4 * deps.random())));
    attempts += 1;
    counters.currentBackoffMs = delay;
    setState("backing-off");
    clear(backoffTimer);
    backoffTimer = deps.setTimeout(() => {
      backoffTimer = null;
      counters.reconnects += 1;
      reconcile();
    }, delay);
  };

  const handleServerMessage = (message: EventServerMessage) => {
    switch (message.type) {
      case "ready": {
        const wanted = new Set(subscribedTopics());
        readyTopics = new Set(message.topics.filter((topic) => wanted.has(topic)));
        cursor = { epoch: message.epoch, seq: Math.max(message.seq, cursor?.epoch === message.epoch ? cursor.seq : 0) };
        barrierSeen = true;
        attempts = 0;
        counters.currentBackoffMs = 0;
        setState("ready");
        emitChange();
        // Replayed or resynced topics held until the barrier now go out.
        if (dirty.size > 0) scheduleDelivery();
        return;
      }
      case "invalidate": {
        if (cursor && cursor.epoch === message.epoch && message.seq <= cursor.seq) return;
        cursor = { epoch: message.epoch, seq: message.seq };
        counters.invalidationsObserved[message.topic] += 1;
        markDirty(message.topic, message.version, message.entityIds);
        scheduleAck();
        return;
      }
      case "resync-required": {
        counters.resyncs += 1;
        cursor = { epoch: message.epoch, seq: message.seq };
        ackedSeq = 0;
        for (const topic of message.topics) markDirty(topic, 0, undefined);
        return;
      }
    }
  };

  const connect = () => {
    if (!capability || socket) return;
    clear(backoffTimer);
    backoffTimer = null;
    counters.connectAttempts += 1;
    barrierSeen = false;
    setState("connecting");
    let next: CaveEventSocket;
    try {
      next = deps.createSocket(deps.socketUrl(capability.path));
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    connectTimer = deps.setTimeout(() => {
      connectTimer = null;
      teardownSocket(1000, "connect timeout");
      scheduleReconnect();
    }, EVENT_CONNECT_TIMEOUT_MS);
    next.onopen = () => {
      clear(connectTimer);
      connectTimer = null;
      counters.opens += 1;
      helloSent = true;
      send({
        type: "hello",
        protocol: CAVE_EVENT_PROTOCOL,
        clientId: deps.clientId,
        topics: subscribedTopics(),
        ...(cursor ? { resume: { epoch: cursor.epoch, seq: cursor.seq } } : {}),
      });
    };
    next.onmessage = (event) => {
      let message: EventServerMessage;
      try {
        message = parseEventServerMessage(event.data);
      } catch {
        // A server we can't understand is a broken connection, not data.
        counters.invalidServerMessages += 1;
        teardownSocket(CAVE_EVENT_CLOSE.invalidFrame, "invalid server message");
        setState("degraded");
        scheduleReconnect();
        return;
      }
      handleServerMessage(message);
    };
    next.onerror = () => {
      // The close that follows decides what happens next.
    };
    next.onclose = (event) => {
      socket = null;
      teardownSocket(1000, "closed");
      if (event.code === CAVE_EVENT_CLOSE.protocol) {
        // The server refused our protocol: re-read what it offers before retrying.
        setState("degraded");
        capabilityLoaded = false;
      }
      scheduleReconnect();
    };
  };

  const loadCapability = (): Promise<void> => {
    if (capabilityLoad) return capabilityLoad;
    capabilityLoad = deps
      .fetchCapability()
      .catch(() => null)
      .then((next) => {
        capability = next;
        capabilityLoaded = true;
        emitChange();
      })
      .finally(() => {
        capabilityLoad = null;
      });
    return capabilityLoad;
  };

  function reconcile(): void {
    if (disposed) return;
    const topics = subscribedTopics();
    if (topics.length === 0) {
      clear(backoffTimer);
      backoffTimer = null;
      if (socket && idleTimer === null) {
        // A grace period, so route changes that resubscribe don't reconnect.
        idleTimer = deps.setTimeout(() => {
          idleTimer = null;
          if (subscribedTopics().length > 0) return;
          flushAck();
          teardownSocket(1000, "idle");
          setState("idle");
        }, EVENT_IDLE_CLOSE_MS);
      }
      if (!socket) setState("idle");
      return;
    }
    clear(idleTimer);
    idleTimer = null;
    if (!capabilityLoaded) {
      void loadCapability().then(() => reconcile());
      return;
    }
    if (mode() === "off") {
      if (socket) teardownSocket(1000, "disabled");
      setState("disabled");
      return;
    }
    if (socket) {
      if (helloSent && socket.readyState === OPEN) {
        // A complete replacement. Added topics stay unready until the new barrier.
        const wanted = new Set(topics);
        const kept = new Set([...readyTopics].filter((topic) => wanted.has(topic)));
        if (kept.size !== readyTopics.size) {
          readyTopics = kept;
          emitChange();
        }
        send({ type: "subscribe", protocol: CAVE_EVENT_PROTOCOL, topics });
      }
      return;
    }
    if (backoffTimer !== null) return;
    connect();
  }

  const unsubscribeVisibility = deps.visibility.onChange(() => {
    if (!deps.visibility.isVisible()) return;
    // Foreground: flush what went stale while hidden, and retry now rather
    // than wait out a backoff, without opening a second connection.
    if (dirty.size > 0) {
      clear(coalesceTimer);
      coalesceTimer = null;
      deliver();
    }
    if (backoffTimer !== null && !socket) {
      clear(backoffTimer);
      backoffTimer = null;
      reconcile();
    }
  });

  return {
    subscribe(topic, listener) {
      if (!(CAVE_EVENT_TOPICS as readonly string[]).includes(topic)) throw new Error(`unknown event topic: ${topic}`);
      let set = listeners.get(topic);
      if (!set) listeners.set(topic, (set = new Set()));
      const before = set.size;
      set.add(listener);
      if (before === 0) reconcile();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set.delete(listener);
        if (set.size === 0) {
          dirty.delete(topic);
          reconcile();
        }
      };
    },
    topicReady: (topic) => state === "ready" && readyTopics.has(topic),
    state: () => state,
    rolloutMode: mode,
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    diagnostics: () => ({
      state,
      rolloutMode: mode(),
      connectAttempts: counters.connectAttempts,
      opens: counters.opens,
      reconnects: counters.reconnects,
      currentBackoffMs: counters.currentBackoffMs,
      invalidationsObserved: { ...counters.invalidationsObserved },
      invalidationsDelivered: { ...counters.invalidationsDelivered },
      coalesced: counters.coalesced,
      resyncs: counters.resyncs,
      acknowledgementsSent: counters.acknowledgementsSent,
      invalidServerMessages: counters.invalidServerMessages,
      fallbackActivations: counters.fallbackActivations,
    }),
    async refreshCapabilities() {
      capabilityLoaded = false;
      await loadCapability();
      reconcile();
    },
    dispose() {
      disposed = true;
      unsubscribeVisibility();
      for (const handle of [coalesceTimer, idleTimer, backoffTimer]) clear(handle);
      coalesceTimer = idleTimer = backoffTimer = null;
      flushAck();
      teardownSocket(1000, "disposed");
      listeners.clear();
      setState("idle");
    },
  };
}

function browserDependencies(): CaveEventPlaneDependencies {
  return {
    async fetchCapability() {
      const res = await fetch("/api/events/capability", { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { eventPlane?: CaveEventPlaneCapability };
      return body.eventPlane ?? null;
    },
    createSocket: (url) => new WebSocket(url) as unknown as CaveEventSocket,
    socketUrl: (path) => websocketUrl(path),
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: () => Math.random(),
    visibility: {
      isVisible: () => document.visibilityState === "visible",
      onChange(listener) {
        document.addEventListener("visibilitychange", listener);
        window.addEventListener("focus", listener);
        return () => {
          document.removeEventListener("visibilitychange", listener);
          window.removeEventListener("focus", listener);
        };
      },
    },
    clientId: `web-${Math.random().toString(36).slice(2, 10)}`,
  };
}

let singleton: CaveEventPlaneClient | null = null;

/** The webview's one manager. Created on first use, in the browser only. */
export function getCaveEventPlaneClient(): CaveEventPlaneClient {
  if (typeof window === "undefined") throw new Error("the event plane client runs in the browser only");
  singleton ??= createCaveEventPlaneClient(browserDependencies());
  return singleton;
}
