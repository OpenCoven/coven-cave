import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import {
  type FamiliarRuntime,
  isSshRuntime,
  normalizeFamiliarRuntime,
} from "@/lib/familiar-runtime";

const CONFIG_PATH = path.join(homedir(), ".coven", "cave-config.json");
const STATE_PATH = path.join(homedir(), ".coven", "cave-state.json");

const DEFAULT_CONFIG: CaveConfig = {
  version: 1,
  defaults: { harness: "codex", model: "openai/gpt-5.5" },
  familiars: {},
  roles: [],
  addons: {
    github: false,
    code: false,
    browser: false,
    flow: false,
    roles: false,
    journal: false,
    docs: false,
  },
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  remoteHosts: [],
};

const DEFAULT_STATE: CaveState = {
  sessionFamiliar: {},
  sessionTitles: {},
  sessionArchived: {},
  sessionSacrificed: {},
  sessionOwned: {},
  travel: {
    manualOffline: false,
    hubUnreachableSince: null,
    lastHubReachableAt: null,
    staleCache: false,
    localSubdaemonWakeRequestedAt: null,
    localBindHost: "127.0.0.1",
    offlineQueue: [],
  },
};

function defaultConfig(): CaveConfig {
  return {
    version: DEFAULT_CONFIG.version,
    defaults: { ...DEFAULT_CONFIG.defaults },
    familiars: {},
    roles: [],
    addons: { ...DEFAULT_CONFIG.addons },
    marketplace: { installed: {} },
    multiHost: { ...DEFAULT_CONFIG.multiHost, executorUrls: [] },
    remoteHosts: [],
  };
}

function defaultState(): CaveState {
  return {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionArchived: {},
    sessionSacrificed: {},
    sessionOwned: {},
    travel: defaultTravelState(),
  };
}

export type FamiliarBinding = {
  harness: string;
  model: string;
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  color?: string;
  note?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
  autoSelfReport?: boolean;
  runtime?: FamiliarRuntime;
};

type FamiliarBindingPatch = {
  [K in keyof FamiliarBinding]?: FamiliarBinding[K] | null;
};

type CaveConfigPatch = Omit<Partial<CaveConfig>, "defaults" | "familiars"> & {
  defaults?: Partial<FamiliarBinding>;
  familiars?: Record<string, FamiliarBindingPatch | null>;
  multiHost?: Partial<CaveMultiHostConfig>;
  remoteHosts?: CaveRemoteHost[];
};

export type RoleConfigEntry = {
  id: string;
  familiar: string;
  active: boolean;
  activatedAt?: string;
};

export type MarketplaceInstallEntry = {
  version: string;
  source: string;
  installedAt: string;
};

export type CaveMultiHostConfig = {
  mode: "local" | "hub";
  hubUrl: string;
  executorUrls: string[];
};

/** A registered remote execution host chats can run on (over SSH). Cave never
 *  stores key material — `host` is an ssh alias/hostname the user's own ssh
 *  config can reach non-interactively. */
export type CaveRemoteHost = {
  host: string;
  /** Remote working directory harness sessions start in. */
  cwd: string;
  /** Remote Coven executable. Defaults to "coven". */
  command?: string;
};

export type CaveTravelQueueItem = {
  id: string;
  kind: "chat" | "workflow" | "job";
  summary: string;
  createdAt: string;
  status: "pending" | "syncing" | "failed" | "synced";
  payload?: unknown;
  lastError?: string;
};

export type CaveTravelState = {
  manualOffline: boolean;
  hubUnreachableSince: string | null;
  lastHubReachableAt: string | null;
  staleCache: boolean;
  localSubdaemonWakeRequestedAt: string | null;
  localBindHost: "127.0.0.1";
  offlineQueue: CaveTravelQueueItem[];
};

export type CaveConfig = {
  version: number;
  defaults: FamiliarBinding;
  familiars: Record<string, Partial<FamiliarBinding>>;
  roles: RoleConfigEntry[];
  addons?: {
    github?: boolean;
    code?: boolean;
    browser?: boolean;
    flow?: boolean;
    roles?: boolean;
    journal?: boolean;
    docs?: boolean;
  };
  marketplace: {
    installed: Record<string, MarketplaceInstallEntry>;
  };
  multiHost: CaveMultiHostConfig;
  /** Chat-selectable remote hosts (beyond per-familiar runtime bindings). */
  remoteHosts: CaveRemoteHost[];
};

export type CaveState = {
  /** Session to owning familiar id. */
  sessionFamiliar: Record<string, string>;
  /** Session to Cave-side title override. Wins over the daemon's title when present. */
  sessionTitles: Record<string, string>;
  /** Session to ISO timestamp when archived in the Cave. Empty when unarchived. */
  sessionArchived: Record<string, string>;
  /** Session to ISO timestamp when sacrificed (soft-deleted) in the Cave. Hidden from lists. */
  sessionSacrificed: Record<string, string>;
  /** Sessions created through Cave's browser-facing session API. */
  sessionOwned: Record<string, string>;
  /** Travel/offline authority state for laptop Cave when the server hub drops. */
  travel: CaveTravelState;
};

export async function loadConfig(): Promise<CaveConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CaveConfig>;
    return {
      version: parsed.version ?? 1,
      defaults: { ...DEFAULT_CONFIG.defaults, ...(parsed.defaults ?? {}) },
      familiars: parsed.familiars ?? {},
      roles: parsed.roles ?? [],
      addons: {
        github: parsed.addons?.github ?? false,
        code: parsed.addons?.code ?? false,
        browser: parsed.addons?.browser ?? false,
        flow: parsed.addons?.flow ?? false,
        roles: parsed.addons?.roles ?? false,
        journal: parsed.addons?.journal ?? false,
        docs: parsed.addons?.docs ?? false,
      },
      marketplace: {
        installed: parsed.marketplace?.installed ?? {},
      },
      multiHost: normalizeMultiHostConfig(parsed.multiHost),
      remoteHosts: normalizeRemoteHosts(parsed.remoteHosts),
    };
  } catch {
    return defaultConfig();
  }
}

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
    const status =
      entry.status === "syncing" ||
      entry.status === "failed" ||
      entry.status === "synced"
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

function mergeFamiliarConfigs(
  current: CaveConfig["familiars"],
  patch: CaveConfigPatch["familiars"],
): CaveConfig["familiars"] {
  if (patch === undefined) return current;
  const updated: CaveConfig["familiars"] = { ...current };
  for (const [id, entry] of Object.entries(patch)) {
    if (entry === null) {
      delete updated[id];
      continue;
    }
    const next: Partial<FamiliarBinding> = { ...(updated[id] ?? {}) };
    for (const [key, value] of Object.entries(entry)) {
      if (
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === "")
      ) {
        delete next[key as keyof FamiliarBinding];
      } else {
        (next as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(next).length === 0) delete updated[id];
    else updated[id] = next;
  }
  return updated;
}

// In-process serialization of cave-config.json mutations. writeJsonAtomic makes
// each write torn-read-safe, but two concurrent load→merge→write calls both read
// the same snapshot and the second write drops the first patch's field. The
// Settings surface fires overlapping config PATCHes (palette-by-familiar loops,
// daemon + add-on toggles), so every config writer serializes its
// read-modify-write here — same pattern as stateMutex for cave-state.json.
let configMutex: Promise<unknown> = Promise.resolve();
async function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = configMutex;
  let release!: () => void;
  configMutex = new Promise<void>((resolve) => { release = resolve; });
  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
  }
}

export async function saveConfig(patch: CaveConfigPatch): Promise<CaveConfig> {
  return withConfigLock(async () => {
  const current = await loadConfig();
  const updated: CaveConfig = {
    ...current,
    ...patch,
    // Deep-merge addons
    addons: {
      ...current.addons,
      ...(patch.addons ?? {}),
    },
    marketplace: {
      installed: {
        ...current.marketplace.installed,
        ...(patch.marketplace?.installed ?? {}),
      },
    },
    multiHost: normalizeMultiHostConfig({
      ...current.multiHost,
      ...(patch.multiHost ?? {}),
    }),
    // Deep-merge defaults
    defaults: {
      ...current.defaults,
      ...(patch.defaults ?? {}),
    },
    familiars: mergeFamiliarConfigs(current.familiars, patch.familiars),
    // Replace remoteHosts if provided (normalized + deduped, like roles)
    remoteHosts:
      patch.remoteHosts !== undefined ? normalizeRemoteHosts(patch.remoteHosts) : current.remoteHosts,
    // Replace roles if provided
    roles: patch.roles !== undefined ? patch.roles : current.roles,
  };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, updated);
  return updated;
  });
}

export async function installMarketplacePlugin(
  pluginName: string,
  version: string,
  source: string,
): Promise<string> {
  return withConfigLock(async () => {
  const cfg = await loadConfig();
  const installedAt = new Date().toISOString();
  const updated: CaveConfig = {
    ...cfg,
    marketplace: {
      installed: {
        ...cfg.marketplace.installed,
        [pluginName]: { version, source, installedAt },
      },
    },
  };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, updated);
  return installedAt;
  });
}

export async function uninstallMarketplacePlugin(pluginName: string): Promise<void> {
  return withConfigLock(async () => {
  const cfg = await loadConfig();
  const installed = { ...cfg.marketplace.installed };
  delete installed[pluginName];
  const updated: CaveConfig = {
    ...cfg,
    marketplace: { installed },
  };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, updated);
  });
}

export function bindingFor(config: CaveConfig, familiarId: string): FamiliarBinding {
  const f = config.familiars[familiarId] ?? {};
  return {
    harness: f.harness ?? config.defaults.harness,
    model: f.model ?? config.defaults.model,
    display_name: f.display_name,
    role: f.role,
    pronouns: f.pronouns,
    description: f.description,
    color: f.color,
    note: f.note,
    voiceProvider: f.voiceProvider,
    voiceModel: f.voiceModel,
    voiceName: f.voiceName,
    autoSelfReport: f.autoSelfReport ?? false,
    runtime: normalizeFamiliarRuntime(f.runtime ?? config.defaults.runtime),
  };
}

export async function loadState(): Promise<CaveState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CaveState>;
    return {
      sessionFamiliar: parsed.sessionFamiliar ?? {},
      sessionTitles: parsed.sessionTitles ?? {},
      sessionArchived: parsed.sessionArchived ?? {},
      sessionSacrificed: parsed.sessionSacrificed ?? {},
      sessionOwned: parsed.sessionOwned ?? {},
      travel: normalizeTravelState(parsed.travel),
    };
  } catch {
    return defaultState();
  }
}

async function saveState(state: CaveState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeJsonAtomic(STATE_PATH, state);
}

// In-process serialization of cave-state.json mutations. Without this, two
// concurrent load→mutate→save calls both load the same snapshot, each writes
// a different key, and the second saveState silently clobbers the first.
let stateMutex: Promise<unknown> = Promise.resolve();

async function updateState<T>(
  mutator: (state: CaveState) => T | Promise<T>,
): Promise<T> {
  const previous = stateMutex;
  let release!: () => void;
  stateMutex = new Promise<void>((resolve) => { release = resolve; });
  try {
    await previous.catch(() => {});
    const state = await loadState();
    const result = await mutator(state);
    await saveState(state);
    return result;
  } finally {
    release();
  }
}

export async function recordOwnedSession(sessionId: string): Promise<void> {
  const state = await loadState();
  state.sessionOwned[sessionId] = new Date().toISOString();
  try {
    await saveState(state);
  } catch {
    /* best effort */
  }
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function hasPendingTravelQueue(state: CaveTravelState): boolean {
  return state.offlineQueue.some((item) => item.status === "pending" || item.status === "syncing" || item.status === "failed");
}

export async function setManualTravelMode(enabled: boolean, now = new Date()): Promise<string | null> {
  return updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    if (enabled) {
      const iso = nowIso(now);
      state.travel.manualOffline = true;
      state.travel.staleCache = true;
      state.travel.localSubdaemonWakeRequestedAt = iso;
      state.travel.localBindHost = "127.0.0.1";
      return iso;
    }
    state.travel.manualOffline = false;
    if (!state.travel.hubUnreachableSince && !hasPendingTravelQueue(state.travel)) {
      state.travel.staleCache = false;
      state.travel.localSubdaemonWakeRequestedAt = null;
    }
    return null;
  });
}

export async function recordTravelHubReachability(reachable: boolean, now = new Date()): Promise<CaveTravelState> {
  return updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    const iso = nowIso(now);
    if (reachable) {
      state.travel.lastHubReachableAt = iso;
      state.travel.hubUnreachableSince = null;
      if (!state.travel.manualOffline && !hasPendingTravelQueue(state.travel)) {
        state.travel.staleCache = false;
        state.travel.localSubdaemonWakeRequestedAt = null;
      }
      return state.travel;
    }
    state.travel.hubUnreachableSince ??= iso;
    state.travel.staleCache = true;
    return state.travel;
  });
}

export async function recordLocalSubdaemonWakeRequest(now = new Date()): Promise<CaveTravelState> {
  return updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    state.travel.localSubdaemonWakeRequestedAt = nowIso(now);
    state.travel.localBindHost = "127.0.0.1";
    state.travel.staleCache = true;
    return state.travel;
  });
}

export async function enqueueOfflineTravelItem(
  item: {
    kind: CaveTravelQueueItem["kind"];
    summary: string;
    payload?: unknown;
  },
  now = new Date(),
): Promise<CaveTravelQueueItem> {
  return updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    const createdAt = nowIso(now);
    const queued: CaveTravelQueueItem = {
      id: `travel-${createdAt.replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`,
      kind: item.kind,
      summary: item.summary.trim() || "Offline work",
      createdAt,
      status: "pending",
      payload: item.payload,
    };
    state.travel.offlineQueue.push(queued);
    state.travel.staleCache = true;
    return queued;
  });
}

export async function offlineTravelItemsNeedingSync(): Promise<CaveTravelQueueItem[]> {
  const state = await loadState();
  return normalizeTravelState(state.travel).offlineQueue.filter((item) => item.status !== "synced");
}

export async function markOfflineTravelItemSyncing(itemId: string): Promise<CaveTravelQueueItem | null> {
  return updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    let marked: CaveTravelQueueItem | null = null;
    state.travel.offlineQueue = state.travel.offlineQueue.map((item) => {
      if (item.id !== itemId || item.status === "synced") return item;
      marked = { ...item, status: "syncing", lastError: undefined };
      return marked;
    });
    return marked;
  });
}

export async function failOfflineTravelItem(itemId: string, error: string): Promise<void> {
  await updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    state.travel.offlineQueue = state.travel.offlineQueue.map((item) =>
      item.id === itemId
        ? { ...item, status: "failed", lastError: error.trim() || "sync failed" }
        : item,
    );
    state.travel.staleCache = true;
  });
}

export async function completeOfflineTravelItem(itemId: string): Promise<void> {
  await updateState((state) => {
    state.travel = normalizeTravelState(state.travel);
    state.travel.offlineQueue = state.travel.offlineQueue.map((item) =>
      item.id === itemId ? { ...item, status: "synced", lastError: undefined } : item,
    );
    if (!state.travel.manualOffline && !state.travel.hubUnreachableSince && !hasPendingTravelQueue(state.travel)) {
      state.travel.staleCache = false;
    }
  });
}

export async function isOwnedSession(sessionId: string): Promise<boolean> {
  const state = await loadState();
  return Boolean(state.sessionOwned[sessionId] || state.sessionFamiliar[sessionId]);
}

export async function recordSessionFamiliar(sessionId: string, familiarId: string): Promise<void> {
  try {
    await updateState((state) => {
      state.sessionFamiliar[sessionId] = familiarId;
    });
  } catch {
    /* best effort */
  }
}

/**
 * Set or clear a Cave-side title override for a session.
 * Pass an empty/whitespace-only title to clear the override.
 */
export async function setSessionTitle(sessionId: string, title: string): Promise<string | null> {
  return updateState((state) => {
    const trimmed = title.trim();
    if (!trimmed) {
      delete state.sessionTitles[sessionId];
    } else {
      state.sessionTitles[sessionId] = trimmed;
    }
    return trimmed || null;
  });
}

/** Mark a session as archived in the Cave (does not touch the daemon row). */
export async function archiveSessionLocal(sessionId: string): Promise<string> {
  const now = new Date().toISOString();
  await updateState((state) => {
    state.sessionArchived[sessionId] = now;
  });
  return now;
}

/** Restore a previously archived session in the Cave. */
export async function summonSessionLocal(sessionId: string): Promise<void> {
  await updateState((state) => {
    delete state.sessionArchived[sessionId];
  });
}

/**
 * Soft-delete a session in the Cave (hides it from all lists).
 * The daemon-side row is left intact; sacrifice is reversible by editing
 * cave-state.json if the user changes their mind.
 */
export async function sacrificeSessionLocal(sessionId: string): Promise<string> {
  const now = new Date().toISOString();
  await updateState((state) => {
    state.sessionSacrificed[sessionId] = now;
  });
  return now;
}

/** Upsert a role's config entry (active state, activatedAt). */
export async function upsertRoleConfig(
  roleId: string,
  familiar: string,
  active: boolean,
): Promise<void> {
  return withConfigLock(async () => {
  const cfg = await loadConfig();
  const now = new Date().toISOString();
  const idx = cfg.roles.findIndex(r => r.id === roleId && r.familiar === familiar);
  if (idx >= 0) {
    cfg.roles[idx] = { ...cfg.roles[idx], active, activatedAt: active ? now : cfg.roles[idx].activatedAt };
  } else {
    cfg.roles.push({ id: roleId, familiar, active, activatedAt: active ? now : undefined });
  }
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, cfg);
  });
}
