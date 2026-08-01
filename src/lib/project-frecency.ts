import { normalizeProjectRoot, type CaveProject } from "./cave-projects-types.ts";

/**
 * Frecency for project pickers (cave-ow9f).
 *
 * Pickers order alphabetically, which is stable but never learns: the project
 * you open twenty times a day sits wherever the alphabet put it. Frecency
 * ranks by how often AND how recently you picked something, so the answer
 * rises without the list becoming unpredictable.
 *
 * The ordering contract deliberately does NOT re-sort the whole list. A list
 * that reorders under the cursor is worse than one that never learns — you
 * reach for the third row and it has moved. Instead a capped Recent section
 * pins on top and the full A-Z list stays exactly where it was underneath.
 * (The bead's own tradeoff note asks for this.)
 *
 * Keyed by normalized project ROOT, not id: a project re-registered under a
 * new id at the same path is the same project to the person picking it.
 */

/** One project's pick history. Kept tiny — this is persisted per browser. */
export type FrecencyEntry = {
  /** How many times it has been picked (all time, decayed at scoring). */
  picks: number;
  /** Epoch ms of the most recent pick. */
  lastPickedAt: number;
};

export type FrecencyStore = Record<string, FrecencyEntry>;

/** Half-life of a pick's recency weight. Two weeks: long enough that a project
 *  you use weekly stays near the top, short enough that last month's crunch
 *  project stops outranking today's. */
export const FRECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
/** How many projects the pinned Recent section may show. */
export const RECENT_SECTION_SIZE = 5;
/** Entries beyond this are dropped oldest-first so the store cannot grow
 *  without bound in a long-lived browser profile. */
export const MAX_TRACKED_PROJECTS = 100;
/** A score below this is treated as no signal, so one stray pick six months
 *  ago does not pin a project you have abandoned. */
const SCORE_FLOOR = 0.05;

function rootKey(root: string): string {
  return normalizeProjectRoot(root);
}

/**
 * Exponential decay on recency, multiplied by a sublinear frequency term.
 *
 * `picks` is damped with a square root: the 20th pick should not outweigh
 * "I used this an hour ago" by 20x. Recency halves every FRECENCY_HALF_LIFE_MS.
 */
export function frecencyScore(entry: FrecencyEntry, now: number): number {
  const age = Math.max(0, now - entry.lastPickedAt);
  const recency = Math.pow(0.5, age / FRECENCY_HALF_LIFE_MS);
  const frequency = Math.sqrt(Math.max(0, entry.picks));
  return frequency * recency;
}

/** Record a pick. Pure: returns the next store, never mutates the input. */
export function recordProjectPick(
  store: FrecencyStore,
  root: string,
  now: number,
): FrecencyStore {
  // Guard the RAW value, not the normalized one: normalizeProjectRoot falls
  // back to "/" for blank input, so checking the key would happily file a
  // missing root under the filesystem root and let it rank.
  if (!root?.trim()) return store;
  const key = rootKey(root);
  if (!key || key === "/") return store;
  const prev = store[key];
  const next: FrecencyStore = {
    ...store,
    [key]: { picks: (prev?.picks ?? 0) + 1, lastPickedAt: now },
  };
  return pruneStore(next);
}

/** Keep the store bounded, dropping the least recently picked entries. */
export function pruneStore(store: FrecencyStore): FrecencyStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_TRACKED_PROJECTS) return store;
  const keep = keys
    .sort((a, b) => store[b].lastPickedAt - store[a].lastPickedAt)
    .slice(0, MAX_TRACKED_PROJECTS);
  const next: FrecencyStore = {};
  for (const key of keep) next[key] = store[key];
  return next;
}

export type RankedProjects = {
  /** Capped, most-frecent-first. Empty until something has actually been picked. */
  recent: CaveProject[];
  /** Every project, in the caller's original order. Never re-sorted, and never
   *  filtered — a project in `recent` still appears here so the list a user has
   *  learned the shape of does not develop holes. */
  all: CaveProject[];
};

/**
 * Split a project list into a pinned Recent section plus the untouched list.
 *
 * `projects` is expected to arrive already A-Z (the cache normalizes it), and
 * is passed through unchanged — this function only *adds* a section.
 */
export function rankProjectsByFrecency(
  projects: readonly CaveProject[],
  store: FrecencyStore,
  now: number,
  limit: number = RECENT_SECTION_SIZE,
): RankedProjects {
  const all = [...projects];
  if (limit <= 0) return { recent: [], all };
  const scored: Array<{ project: CaveProject; score: number }> = [];
  for (const project of projects) {
    const entry = store[rootKey(project.root)];
    if (!entry) continue;
    const score = frecencyScore(entry, now);
    if (score < SCORE_FLOOR) continue;
    scored.push({ project, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tiebreak so equal scores never shuffle between renders.
    return a.project.name.localeCompare(b.project.name);
  });
  return { recent: scored.slice(0, limit).map((s) => s.project), all };
}

// ── persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "cave:project-frecency:v1";

/**
 * Read the store. Never throws: a corrupt or foreign value degrades to "no
 * history", because a broken picker is far worse than an unranked one.
 */
export function loadFrecencyStore(): FrecencyStore {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: FrecencyStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { picks, lastPickedAt } = value as Partial<FrecencyEntry>;
      if (typeof picks !== "number" || !Number.isFinite(picks) || picks <= 0) continue;
      if (typeof lastPickedAt !== "number" || !Number.isFinite(lastPickedAt)) continue;
      out[key] = { picks, lastPickedAt };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveFrecencyStore(store: FrecencyStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A full quota must not break picking a project.
  }
}

/** Record a pick against the persisted store. Returns the updated store. */
export function rememberProjectPick(root: string, now: number = Date.now()): FrecencyStore {
  const next = recordProjectPick(loadFrecencyStore(), root, now);
  saveFrecencyStore(next);
  return next;
}

/** Test-only: drop persisted history between cases. */
export function resetFrecencyStoreForTests(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
