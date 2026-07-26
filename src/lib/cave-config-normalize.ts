import {
  isSshRuntime,
  normalizeFamiliarRuntime,
} from "./familiar-runtime.ts";
import type {
  CaveMultiHostConfig,
  CaveOmnigentConfig,
  CaveRemoteHost,
  CaveTravelQueueItem,
  CaveTravelState,
  FamiliarOmnigentBinding,
} from "./cave-config.ts";

export function normalizeRemoteHosts(input: CaveRemoteHost[] | undefined): CaveRemoteHost[] {
  const seen = new Set<string>();
  const hosts: CaveRemoteHost[] = [];
  for (const entry of Array.isArray(input) ? input : []) {
    const runtime = normalizeFamiliarRuntime({
      kind: "ssh",
      host: entry?.host,
      cwd: entry?.cwd,
      command: entry?.command,
    });
    if (!isSshRuntime(runtime) || seen.has(runtime.host)) continue;
    seen.add(runtime.host);
    hosts.push({
      host: runtime.host,
      cwd: runtime.cwd,
      ...(runtime.command !== "coven" ? { command: runtime.command } : {}),
    });
  }
  return hosts;
}

export function normalizeMultiHostConfig(input: Partial<CaveMultiHostConfig> | undefined): CaveMultiHostConfig {
  const mode = input?.mode === "hub" ? "hub" : "local";
  const hubUrl = typeof input?.hubUrl === "string" ? input.hubUrl.trim() : "";
  const executorUrls = Array.from(
    new Set(
      (Array.isArray(input?.executorUrls) ? input.executorUrls : [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  return { mode, hubUrl, executorUrls };
}

function normalizeStringRecord(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function normalizeOmnigentConfig(input: Partial<CaveOmnigentConfig> | undefined): CaveOmnigentConfig {
  const rawUrl = typeof input?.baseUrl === "string" ? trimTrailingSlashes(input.baseUrl.trim()) : "";
  let baseUrl = rawUrl;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    } catch {
      baseUrl = rawUrl;
    }
  }
  return {
    enabled: input?.enabled === true,
    baseUrl,
    defaultAgentId: typeof input?.defaultAgentId === "string" ? input.defaultAgentId.trim() : "",
    defaultHostId: typeof input?.defaultHostId === "string" ? input.defaultHostId.trim() : "",
    defaultWorkspace: typeof input?.defaultWorkspace === "string" ? input.defaultWorkspace.trim() : "",
    hostMap: normalizeStringRecord(input?.hostMap),
    hostWorkspaceMap: normalizeStringRecord(input?.hostWorkspaceMap),
    exposeHostsInComposer: input?.exposeHostsInComposer !== false,
  };
}

export function normalizeFamiliarOmnigent(
  input: FamiliarOmnigentBinding | undefined,
): FamiliarOmnigentBinding | undefined {
  if (!input || typeof input !== "object") return undefined;
  const agentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
  const hostId = typeof input.hostId === "string" ? input.hostId.trim() : "";
  const workspace = typeof input.workspace === "string" ? input.workspace.trim() : "";
  if (!agentId && !hostId && !workspace) return undefined;
  return {
    ...(agentId ? { agentId } : {}),
    ...(hostId ? { hostId } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

export function defaultTravelState(): CaveTravelState {
  return {
    manualOffline: false,
    hubUnreachableSince: null,
    lastHubReachableAt: null,
    staleCache: false,
    localSubdaemonWakeRequestedAt: null,
    localBindHost: "127.0.0.1",
    offlineQueue: [],
  };
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function normalizeTravelQueue(input: unknown): CaveTravelQueueItem[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item): CaveTravelQueueItem[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Partial<CaveTravelQueueItem>;
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "";
    const summary = typeof entry.summary === "string" && entry.summary.trim() ? entry.summary.trim() : "";
    const createdAt = isoOrNull(entry.createdAt);
    if (!id || !summary || !createdAt) return [];
    const status = entry.status === "syncing" || entry.status === "failed" || entry.status === "synced"
      ? entry.status
      : "pending";
    return [{
      id,
      kind: entry.kind === "workflow" || entry.kind === "job" ? entry.kind : "chat",
      summary,
      createdAt,
      status,
      payload: entry.payload,
      lastError: typeof entry.lastError === "string" && entry.lastError.trim() ? entry.lastError.trim() : undefined,
    }];
  });
}

export function normalizeTravelState(input: Partial<CaveTravelState> | undefined): CaveTravelState {
  return {
    manualOffline: input?.manualOffline === true,
    hubUnreachableSince: isoOrNull(input?.hubUnreachableSince),
    lastHubReachableAt: isoOrNull(input?.lastHubReachableAt),
    staleCache: input?.staleCache === true,
    localSubdaemonWakeRequestedAt: isoOrNull(input?.localSubdaemonWakeRequestedAt),
    localBindHost: "127.0.0.1",
    offlineQueue: normalizeTravelQueue(input?.offlineQueue),
  };
}
