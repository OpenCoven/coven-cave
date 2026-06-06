import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = path.join(homedir(), ".coven", "cave-config.json");
const STATE_PATH = path.join(homedir(), ".coven", "cave-state.json");

const DEFAULT_CONFIG: CaveConfig = {
  version: 1,
  defaults: { harness: "codex", model: "openai/gpt-5.5" },
  familiars: {},
  roles: [],
};

const DEFAULT_STATE: CaveState = {
  sessionFamiliar: {},
  sessionTitles: {},
  sessionArchived: {},
  sessionSacrificed: {},
};

export type FamiliarBinding = {
  harness: string;
  model: string;
  note?: string;
};

export type RoleConfigEntry = {
  id: string;
  familiar: string;
  active: boolean;
  activatedAt?: string;
};

export type CaveConfig = {
  version: number;
  defaults: FamiliarBinding;
  familiars: Record<string, Partial<FamiliarBinding>>;
  roles: RoleConfigEntry[];
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
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function bindingFor(config: CaveConfig, familiarId: string): FamiliarBinding {
  const f = config.familiars[familiarId] ?? {};
  return {
    harness: f.harness ?? config.defaults.harness,
    model: f.model ?? config.defaults.model,
    note: f.note,
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
    };
  } catch {
    return DEFAULT_STATE;
  }
}

async function saveState(state: CaveState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export async function recordSessionFamiliar(sessionId: string, familiarId: string): Promise<void> {
  const state = await loadState();
  state.sessionFamiliar[sessionId] = familiarId;
  try {
    await saveState(state);
  } catch {
    /* best effort */
  }
}

/**
 * Set or clear a Cave-side title override for a session.
 * Pass an empty/whitespace-only title to clear the override.
 */
export async function setSessionTitle(sessionId: string, title: string): Promise<string | null> {
  const state = await loadState();
  const trimmed = title.trim();
  if (!trimmed) {
    delete state.sessionTitles[sessionId];
  } else {
    state.sessionTitles[sessionId] = trimmed;
  }
  await saveState(state);
  return trimmed || null;
}

/** Mark a session as archived in the Cave (does not touch the daemon row). */
export async function archiveSessionLocal(sessionId: string): Promise<string> {
  const state = await loadState();
  const now = new Date().toISOString();
  state.sessionArchived[sessionId] = now;
  await saveState(state);
  return now;
}

/** Restore a previously archived session in the Cave. */
export async function summonSessionLocal(sessionId: string): Promise<void> {
  const state = await loadState();
  delete state.sessionArchived[sessionId];
  await saveState(state);
}

/**
 * Soft-delete a session in the Cave (hides it from all lists).
 * The daemon-side row is left intact; sacrifice is reversible by editing
 * cave-state.json if the user changes their mind.
 */
export async function sacrificeSessionLocal(sessionId: string): Promise<string> {
  const state = await loadState();
  const now = new Date().toISOString();
  state.sessionSacrificed[sessionId] = now;
  await saveState(state);
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
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
