import { loadConfig, type CaveConfig } from "../cave-config.ts";
import {
  callDaemonTarget,
  daemonTargetForConfig,
  extractDaemonError,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonTarget,
} from "../coven-daemon.ts";
import {
  classifyDaemonFailureAvailability,
  type DaemonAvailability,
} from "../daemon-status-classification.ts";
import { classifyHubFailure } from "./daemon-probe.ts";

const CACHE_TTL_MS = 1_000;
const HEALTH_REQUEST = {
  path: "/api/v1/health",
  timeoutMs: 750,
  retryTransportFailure: false,
} satisfies Pick<DaemonRequest, "path" | "timeoutMs" | "retryTransportFailure">;

export type DaemonConnectionTargetSummary =
  | { mode: "local"; label: "Local daemon"; socket: string }
  | { mode: "hub"; label: "Server hub"; url: string }
  | { mode: "unconfigured-hub"; label: "Server hub"; error: string };

export type DaemonConnectionSnapshot = {
  running: boolean;
  availability: DaemonAvailability;
  checkedAt: string;
  target: DaemonConnectionTargetSummary;
  reason?: string;
};

export type DaemonConnectionSnapshotReadOptions = { fresh?: boolean };

export type DaemonConnectionSnapshotBroker = {
  read(options?: DaemonConnectionSnapshotReadOptions): Promise<DaemonConnectionSnapshot>;
  clear(): void;
};

export type CreateDaemonConnectionSnapshotBrokerDependencies = {
  loadConfig: () => Promise<Pick<CaveConfig, "multiHost">>;
  callTarget: (
    target: DaemonTarget,
    request: Pick<DaemonRequest, "path" | "timeoutMs" | "retryTransportFailure">,
  ) => Promise<DaemonResponse<unknown>>;
  now?: () => number;
};

type CacheEntry = {
  generation: number;
  pending: Promise<DaemonConnectionSnapshot> | null;
  value: DaemonConnectionSnapshot | null;
  expiresAt: number | null;
};

type ProbedSnapshot = {
  snapshot: DaemonConnectionSnapshot;
  completedAt: number;
};

export function daemonConnectionTargetSummary(target: DaemonTarget): DaemonConnectionTargetSummary {
  if (target.mode === "local") {
    return { mode: target.mode, label: target.label, socket: target.socketPath };
  }
  if (target.mode === "hub") {
    return { mode: target.mode, label: target.label, url: target.url };
  }
  return { mode: target.mode, label: target.label, error: target.error };
}

export function daemonConnectionTargetKey(target: DaemonTarget): string {
  if (target.mode === "local") return `local:${target.socketPath}`;
  if (target.mode === "hub") return `hub:${target.url}`;
  return `unconfigured-hub:${target.error}`;
}

function failureReason(target: DaemonTarget, response: DaemonResponse<unknown>): string {
  const detail = extractDaemonError(response) ?? `http ${response.status}`;
  if (target.mode === "hub") return classifyHubFailure(response);
  return detail;
}

function failureAvailability(target: DaemonTarget, response: DaemonResponse<unknown>) {
  return classifyDaemonFailureAvailability({
    targetMode: target.mode,
    responseStatus: response.status,
    reason: extractDaemonError(response),
  });
}

function buildSnapshot(
  target: DaemonTarget,
  checkedAtMs: number,
  fields: Pick<DaemonConnectionSnapshot, "running" | "availability"> & { reason?: string },
): DaemonConnectionSnapshot {
  return {
    running: fields.running,
    availability: fields.availability,
    checkedAt: new Date(checkedAtMs).toISOString(),
    target: daemonConnectionTargetSummary(target),
    ...(fields.reason ? { reason: fields.reason } : {}),
  };
}

export function createDaemonConnectionSnapshotBroker(
  dependencies: CreateDaemonConnectionSnapshotBrokerDependencies,
): DaemonConnectionSnapshotBroker {
  const entries = new Map<string, CacheEntry>();
  const now = dependencies.now ?? Date.now;

  function entryFor(key: string): CacheEntry {
    const existing = entries.get(key);
    if (existing) return existing;
    const created: CacheEntry = {
      generation: 0,
      pending: null,
      value: null,
      expiresAt: null,
    };
    entries.set(key, created);
    return created;
  }

  async function probe(target: DaemonTarget): Promise<ProbedSnapshot> {
    if (target.mode === "unconfigured-hub") {
      const completedAt = now();
      return {
        completedAt,
        snapshot: buildSnapshot(target, completedAt, {
          running: false,
          availability: "misconfigured",
          reason: target.error,
        }),
      };
    }

    const response = await dependencies.callTarget(target, HEALTH_REQUEST);
    const completedAt = now();
    if (response.ok && response.data) {
      return {
        completedAt,
        snapshot: buildSnapshot(target, completedAt, {
          running: true,
          availability: "online",
        }),
      };
    }
    return {
      completedAt,
      snapshot: buildSnapshot(target, completedAt, {
        running: false,
        availability: failureAvailability(target, response),
        reason: failureReason(target, response),
      }),
    };
  }

  function isCurrentGeneration(key: string, entry: CacheEntry, generation: number): boolean {
    return entries.get(key) === entry && entry.generation === generation;
  }

  function startProbe(key: string, target: DaemonTarget): Promise<DaemonConnectionSnapshot> {
    const entry = entryFor(key);
    const generation = entry.generation + 1;
    entry.generation = generation;
    const pending = (async () => {
      try {
        const { snapshot, completedAt } = await probe(target);
        if (isCurrentGeneration(key, entry, generation)) {
          entry.value = snapshot;
          entry.expiresAt = completedAt + CACHE_TTL_MS;
          entry.pending = null;
        }
        return snapshot;
      } catch (error) {
        if (isCurrentGeneration(key, entry, generation)) {
          entries.delete(key);
        }
        throw error;
      }
    })();
    entry.pending = pending;
    entry.value = null;
    entry.expiresAt = null;
    return pending;
  }

  return {
    async read(options = {}) {
      const config = await dependencies.loadConfig();
      const target = daemonTargetForConfig(config);
      const key = daemonConnectionTargetKey(target);
      const entry = entries.get(key);
      const fresh = options.fresh === true;
      const currentTime = now();

      if (!fresh && entry?.value && entry.expiresAt !== null && currentTime < entry.expiresAt) {
        return entry.value;
      }
      if (!fresh && entry?.pending) {
        return entry.pending;
      }
      return startProbe(key, target);
    },
    clear() {
      entries.clear();
    },
  };
}

const daemonConnectionSnapshotBroker = createDaemonConnectionSnapshotBroker({
  loadConfig,
  callTarget: callDaemonTarget,
});

export function loadDaemonConnectionSnapshot(
  options?: DaemonConnectionSnapshotReadOptions,
): Promise<DaemonConnectionSnapshot> {
  return daemonConnectionSnapshotBroker.read(options);
}
