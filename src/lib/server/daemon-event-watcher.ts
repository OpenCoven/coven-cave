/**
 * Publishes `daemon` to the event plane when the daemon's observed health
 * changes (#5843).
 *
 * The daemon is pull-only, so the server keeps one small health poll and
 * publishes only on a classification change: healthy, degraded or offline.
 * Clients then stop polling daemon status themselves. The probe, clock and
 * publisher are injected for tests; `startDaemonEventWatcher` wires the real
 * ones.
 */

import { callDaemon, type DaemonResponse } from "../coven-daemon.ts";
import { markResourceChanged } from "./cave-event-plane-publisher.ts";
import { daemonHealthRequest, daemonHealthResponseSucceeded } from "./daemon-health-request.ts";

export type DaemonClassification = "healthy" | "degraded" | "offline";

export const DAEMON_WATCH_INTERVAL_MS = 5_000;

/** A transport failure is offline; any other unhealthy answer is degraded. */
export function classifyDaemonHealthResponse(response: DaemonResponse<unknown>): DaemonClassification {
  if (daemonHealthResponseSucceeded(response)) return "healthy";
  return response.status === 0 ? "offline" : "degraded";
}

export type DaemonEventWatcherOptions = {
  probe(): Promise<DaemonClassification>;
  publish(): void;
  intervalMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type DaemonEventWatcher = {
  /** One observation. Publishes when the classification differs from the last one. */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
  current(): DaemonClassification | null;
};

export function createDaemonEventWatcher(options: DaemonEventWatcherOptions): DaemonEventWatcher {
  const intervalMs = options.intervalMs ?? DAEMON_WATCH_INTERVAL_MS;
  const schedule = options.setTimeout ?? ((callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  });
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let previous: DaemonClassification | null = null;
  let timer: unknown = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const tick = () => {
    // One probe at a time: a slow daemon must not pile up observations.
    inFlight ??= (async () => {
      let next: DaemonClassification;
      try {
        next = await options.probe();
      } catch {
        next = "offline";
      }
      if (next !== previous) {
        previous = next;
        options.publish();
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const loop = () => {
    timer = null;
    if (!running) return;
    void tick().finally(() => {
      if (running) timer = schedule(loop, intervalMs);
    });
  };

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      loop();
    },
    stop() {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    current: () => previous,
  };
}

/** The production watcher: the real health probe and the event-plane bridge. */
export function startDaemonEventWatcher(): DaemonEventWatcher {
  const watcher = createDaemonEventWatcher({
    probe: async () => classifyDaemonHealthResponse(await callDaemon(daemonHealthRequest())),
    publish: () => {
      markResourceChanged("daemon");
    },
  });
  watcher.start();
  return watcher;
}
