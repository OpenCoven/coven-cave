// Cave-local "which project does this chat belong to" overrides.
//
// A chat's real project is its daemon-owned `session.project_root` (also the
// agent's working directory). Dragging a chat into another project folder is a
// purely organizational re-bucketing — it must NOT change the agent's cwd — so,
// like pins and manual order, it lives entirely in Cave's localStorage and is
// layered over the sessions before they're grouped.
//
// Map: sessionId -> target project_root. An empty-string value means the
// "no project" (ungrouped) bucket. Absence means "use the daemon's root".
import type { SessionRow } from "./types.ts";

export const CHAT_PROJECT_OVERRIDES_KEY = "cave:chat:project-overrides";
/** Dispatched on window whenever the override map changes (same-tab reactivity). */
export const CHAT_PROJECT_OVERRIDES_EVENT = "cave:chat:project-overrides-changed";

export type ProjectOverrides = Record<string, string>;

export function readProjectOverrides(): ProjectOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHAT_PROJECT_OVERRIDES_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ProjectOverrides = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeProjectOverrides(map: ProjectOverrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_PROJECT_OVERRIDES_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHAT_PROJECT_OVERRIDES_EVENT));
  } catch {
    // storage full / disabled — overrides are a soft preference, drop silently
  }
}

/** Move a chat to `targetRoot` ("" = ungrouped). Pass null to clear (revert to daemon root). */
export function setProjectOverride(sessionId: string, targetRoot: string | null): void {
  const map = readProjectOverrides();
  if (targetRoot === null) {
    if (!(sessionId in map)) return;
    delete map[sessionId];
  } else {
    if (map[sessionId] === targetRoot) return;
    map[sessionId] = targetRoot;
  }
  writeProjectOverrides(map);
}

export function clearProjectOverride(sessionId: string): void {
  setProjectOverride(sessionId, null);
}

/**
 * Return sessions with their `project_root` replaced by any override. Pure;
 * returns the same array reference when there are no overrides so callers'
 * memos don't churn.
 */
export function applyProjectOverrides(
  sessions: SessionRow[],
  overrides: ProjectOverrides,
): SessionRow[] {
  if (!overrides || Object.keys(overrides).length === 0) return sessions;
  let changed = false;
  const next = sessions.map((s) => {
    const override = overrides[s.id];
    if (override === undefined || override === s.project_root) return s;
    changed = true;
    return { ...s, project_root: override };
  });
  return changed ? next : sessions;
}

/**
 * Drop overrides whose session no longer exists so the map can't grow without
 * bound across deletes. Returns the pruned map (and persists it if it shrank).
 */
export function pruneProjectOverrides(
  overrides: ProjectOverrides,
  liveSessionIds: Iterable<string>,
): ProjectOverrides {
  const live = new Set(liveSessionIds);
  const pruned: ProjectOverrides = {};
  let dropped = false;
  for (const [id, root] of Object.entries(overrides)) {
    if (live.has(id)) pruned[id] = root;
    else dropped = true;
  }
  if (dropped) writeProjectOverrides(pruned);
  return dropped ? pruned : overrides;
}
