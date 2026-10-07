"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  getCaveEventPlaneClient,
  type CaveEventInvalidation,
  type CaveEventPlaneClient,
  type CaveEventPlaneState,
} from "./cave-event-plane-client.ts";
import type { CaveEventRolloutMode, CaveEventTopic } from "./cave-event-plane-protocol.ts";

export type CaveEventPlaneTopicHealth = {
  /**
   * The connection is healthy and the server installed this topic. Only then
   * may a covered fallback poll pause, and only in `primary` mode.
   */
  ready: boolean;
  rolloutMode: CaveEventRolloutMode;
  state: CaveEventPlaneState;
};

const SERVER_HEALTH: CaveEventPlaneTopicHealth = { ready: false, rolloutMode: "off", state: "idle" };
const noop = () => () => {};

/**
 * Subscribe a component to one event-plane topic (#5833).
 *
 * The hook never fetches. `onInvalidate` tells the existing owner, such as a
 * store, a list or a poll, that its snapshot may be stale; that owner still
 * controls loading, optimistic state and errors. The callback is held in a
 * ref, so a new identity on each render does not resubscribe.
 */
export function useCaveEventPlane(
  topic: CaveEventTopic,
  onInvalidate: (event: CaveEventInvalidation) => void,
  options: { enabled?: boolean; client?: CaveEventPlaneClient } = {},
): CaveEventPlaneTopicHealth {
  const enabled = options.enabled !== false;
  const client = options.client ?? (typeof window === "undefined" ? null : getCaveEventPlaneClient());
  const callback = useRef(onInvalidate);
  callback.current = onInvalidate;

  useEffect(() => {
    if (!enabled || !client) return;
    return client.subscribe(topic, (event) => callback.current(event));
  }, [client, enabled, topic]);

  const subscribe = useCallback((listener: () => void) => (client ? client.onChange(listener) : noop()), [client]);
  const ready = useSyncExternalStore(
    subscribe,
    () => Boolean(enabled && client?.topicReady(topic)),
    () => false,
  );
  const rolloutMode = useSyncExternalStore(subscribe, () => client?.rolloutMode() ?? "off", () => "off" as const);
  const state = useSyncExternalStore(subscribe, () => client?.state() ?? "idle", () => "idle" as const);
  return client ? { ready, rolloutMode, state } : SERVER_HEALTH;
}
