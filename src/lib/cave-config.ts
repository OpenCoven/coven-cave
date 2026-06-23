import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import {
  type FamiliarRuntime,
  normalizeFamiliarRuntime,
} from "@/lib/familiar-runtime";

const CONFIG_PATH = path.join(homedir(), ".coven", "cave-config.json");
const STATE_PATH = path.join(homedir(), ".coven", "cave-state.json");

const DEFAULT_CONFIG: CaveConfig = {
  version: 1,
  defaults: { harness: "codex", model: "openai/gpt-5.5" },
  familiars: {},
  roles: [],
  addons: { github: false, library: false },
  marketplace: { installed: {} },
};

const DEFAULT_STATE: CaveState = {
  sessionFamiliar: {},
  sessionTitles: {},
  sessionArchived: {},
  sessionSacrificed: {},
  sessionOwned: {},
};

function defaultConfig(): CaveConfig {
  return {
    version: DEFAULT_CONFIG.version,
    defaults: { ...DEFAULT_CONFIG.defaults },
    familiars: {},
    roles: [],
    addons: { ...DEFAULT_CONFIG.addons },
    marketplace: { installed: {} },
  };
}

function defaultState(): CaveState {
  return {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionArchived: {},
    sessionSacrificed: {},
    sessionOwned: {},
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
  runtime?: FamiliarRuntime;
};

type FamiliarBindingPatch = {
  [K in keyof FamiliarBinding]?: FamiliarBinding[K] | null;
};

type CaveConfigPatch = Omit<Partial<CaveConfig>, "defaults" | "familiars"> & {
  defaults?: Partial<FamiliarBinding>;
  familiars?: Record<string, FamiliarBindingPatch | null>;
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

export type CaveConfig = {
  version: number;
  defaults: FamiliarBinding;
  familiars: Record<string, Partial<FamiliarBinding>>;
  roles: RoleConfigEntry[];
  addons?: {
    github?: boolean;
    library?: boolean;
  };
  marketplace: {
    installed: Record<string, MarketplaceInstallEntry>;
  };
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
        library: parsed.addons?.library ?? false,
      },
      marketplace: {
        installed: parsed.marketplace?.installed ?? {},
      },
    };
  } catch {
    return defaultConfig();
  }
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

export async function saveConfig(patch: CaveConfigPatch): Promise<CaveConfig> {
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
    // Deep-merge defaults
    defaults: {
      ...current.defaults,
      ...(patch.defaults ?? {}),
    },
    familiars: mergeFamiliarConfigs(current.familiars, patch.familiars),
    // Replace roles if provided
    roles: patch.roles !== undefined ? patch.roles : current.roles,
  };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, updated);
  return updated;
}

export async function installMarketplacePlugin(
  pluginName: string,
  version: string,
  source: string,
): Promise<string> {
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
}

export async function uninstallMarketplacePlugin(pluginName: string): Promise<void> {
  const cfg = await loadConfig();
  const installed = { ...cfg.marketplace.installed };
  delete installed[pluginName];
  const updated: CaveConfig = {
    ...cfg,
    marketplace: { installed },
  };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeJsonAtomic(CONFIG_PATH, updated);
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
}
