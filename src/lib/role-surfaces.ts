/**
 * role-surfaces — the Cave's Role Surface registry.
 *
 * The Cave is role-aware, not role-hardcoded: familiars carry one or more
 * roles (their `role` label plus any active ROLE.md manifests), and each role
 * may expose specialized Role Surfaces — rooms within the Cave built for that
 * vocation. The shell never branches on specific roles; it loads this
 * registry, filters by the active familiar's roles, applies each surface's
 * `shouldDisplay` predicate, sorts by priority, and renders the winners as
 * first-class workspaces. Adding a new role surface means registering another
 * module here — the Cave shell is never edited for it.
 *
 * Kept free of JSX so the registry and its matching rules are unit-testable
 * under plain `node --experimental-strip-types`.
 */

import type { ReactNode } from "react";
import type { Familiar, SessionRow } from "./types";
import type { IconName } from "./icon";

export type RoleSurfaceId = string;

/** A role identifier, e.g. "researcher". Matched against the familiar's
 *  normalized role label tokens and active role-manifest ids/names. */
export type FamiliarRole = string;

// ── Context ──────────────────────────────────────────────────────────────────

/** A person the familiar is currently working with/for. The Cave has no
 *  person model yet; the field exists so surfaces bind to the real shape when
 *  one lands instead of inventing their own. */
export type SurfacePerson = { id: string; name: string };

/** Live Cave session state shared with every surface. */
export type RoleSurfaceRuntimeState = {
  daemonRunning: boolean;
  sessions: SessionRow[];
  activeSessionId: string | null;
};

export type SurfaceMemoryEntry = {
  relPath: string;
  fullPath: string;
  rootLabel: string;
  sourceKindLabel: string;
  size: number;
  modified: string;
  excerpt?: string;
  familiarId?: string;
};

/** Read access to the familiar's memory inventory. Backed by `/api/memory`;
 *  adapters resolve to empty results (never fakes) when the backing API is
 *  unavailable. */
export type MemoryAccess = {
  listEntries(): Promise<SurfaceMemoryEntry[]>;
  readFile(path: string): Promise<{ content: string; mtimeMs: number | null } | null>;
};

export type SurfaceTool = { id: string; name: string; source: string };
export type SurfacePlugin = { id: string; name: string; source: string };

/** Tools granted to the familiar via its active role manifests. */
export type ToolRegistry = { listTools(): Promise<SurfaceTool[]> };
/** Plugins granted to the familiar via its active role manifests. */
export type PluginRegistry = { listPlugins(): Promise<SurfacePlugin[]> };

/** Everything a Role Surface can see. Built once per active familiar by the
 *  RoleSurfaceHost from the live Cave session — surfaces never import shell
 *  internals. */
export interface RoleSurfaceContext {
  activeFamiliar: Familiar;
  activePerson: SurfacePerson | null;
  currentThread: SessionRow | null;
  runtimeState: RoleSurfaceRuntimeState;
  memory: MemoryAccess;
  tools: ToolRegistry;
  plugins: PluginRegistry;
  /** Open a URL in the Cave's in-app browser. */
  openUrl(url: string): void;
  /** Jump to a session in the chat surface. */
  openSession(sessionId: string, familiarId?: string): void;
}

// ── Contributions ────────────────────────────────────────────────────────────

export type CommandDefinition = {
  id: string;
  title: string;
  hint?: string;
  run(context: RoleSurfaceContext): void;
};

export type ToolbarAction = {
  id: string;
  title: string;
  iconName?: IconName;
  run(context: RoleSurfaceContext): void;
};

export type KeyboardShortcut = {
  id: string;
  /** "mod+shift+e" style combo; "mod" is ⌘ on macOS, Ctrl elsewhere. */
  combo: string;
  description: string;
  run(context: RoleSurfaceContext): void;
};

export type ContextMenuContribution = {
  id: string;
  /** Selector-ish label for what the menu attaches to (surface-internal). */
  target: string;
  items: Array<{ id: string; title: string; run(context: RoleSurfaceContext): void }>;
};

export type SurfaceNotification = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type StatusIndicator = {
  id: string;
  label: string;
  tone: "ok" | "busy" | "warn" | "muted";
  detail?: string;
};

/** What a surface contributes to the Cave chrome while it is active. The host
 *  applies these generically — the shell never special-cases a surface. */
export type RoleSurfaceContribution = {
  commands?: CommandDefinition[];
  toolbarActions?: ToolbarAction[];
  keyboardShortcuts?: KeyboardShortcut[];
  contextMenus?: ContextMenuContribution[];
  notifications?: SurfaceNotification[];
  statusIndicators?: StatusIndicator[];
};

// ── Surface ──────────────────────────────────────────────────────────────────

export interface RoleSurface {
  id: RoleSurfaceId;
  /** The role this surface serves. Familiars with a matching role see it. */
  role: FamiliarRole;
  /** Synonym roles that also open this room (e.g. the Chart Room serves
   *  "navigator" and the "planner" summoning preset). Matched exactly like
   *  `role`, after the same normalization. */
  aliases?: FamiliarRole[];
  title: string;
  /** Registered Phosphor icon (compile-checked against ICON_NAMES). */
  iconName: IconName;
  /** One-line hover/palette description of the room. */
  description: string;
  /** Accent hue (0–360) for the room's glow. Keeps rooms visually distinct
   *  while staying inside the Cave's obsidian+glass language. */
  accentHue?: number;
  /** Higher priority renders first among visible surfaces. */
  priority: number;
  shouldDisplay(context: RoleSurfaceContext): boolean;
  getContributions?(context: RoleSurfaceContext): RoleSurfaceContribution;
  render(context: RoleSurfaceContext): ReactNode;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<RoleSurfaceId, RoleSurface>();

/** Register (or replace — keeps HMR idempotent) a Role Surface. Returns an
 *  unregister function. */
export function registerRoleSurface(surface: RoleSurface): () => void {
  registry.set(surface.id, surface);
  return () => {
    if (registry.get(surface.id) === surface) registry.delete(surface.id);
  };
}

export function listRoleSurfaces(): RoleSurface[] {
  return [...registry.values()];
}

export function getRoleSurface(id: RoleSurfaceId): RoleSurface | null {
  return registry.get(id) ?? null;
}

/** Test-only: reset the registry between cases. */
export function clearRoleSurfacesForTest(): void {
  registry.clear();
}

// ── Role matching ────────────────────────────────────────────────────────────

/** Minimal shape of an active role manifest (`/api/roles` RoleEntry). */
export type FamiliarRoleManifest = {
  id: string;
  name?: string;
  familiar: string;
  active: boolean;
};

/** "Research Analyst" -> "research-analyst" */
export function normalizeRoleId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The normalized role-id set assigned to a familiar:
 *  - its `role` label (whole normalized string plus individual word tokens,
 *    so "Research Analyst" grants both "research-analyst" and "analyst"), and
 *  - the id + name of every ACTIVE role manifest belonging to it.
 */
export function familiarRoleIds(
  familiar: Pick<Familiar, "id" | "role">,
  manifests: readonly FamiliarRoleManifest[] = [],
): Set<string> {
  const ids = new Set<string>();
  const label = familiar.role ?? "";
  const whole = normalizeRoleId(label);
  if (whole) ids.add(whole);
  for (const token of whole.split("-")) if (token) ids.add(token);
  for (const manifest of manifests) {
    if (!manifest.active || manifest.familiar !== familiar.id) continue;
    const byId = normalizeRoleId(manifest.id);
    if (byId) ids.add(byId);
    const byName = normalizeRoleId(manifest.name ?? "");
    if (byName) ids.add(byName);
  }
  return ids;
}

export function surfaceMatchesRoles(
  surface: Pick<RoleSurface, "role" | "aliases">,
  roleIds: ReadonlySet<string>,
): boolean {
  if (roleIds.has(normalizeRoleId(surface.role))) return true;
  return (surface.aliases ?? []).some((alias) => roleIds.has(normalizeRoleId(alias)));
}

/**
 * The surfaces the active familiar should see, sorted by priority (higher
 * first; ties break on title for stability). A throwing `shouldDisplay` hides
 * that surface instead of breaking the shell.
 */
export function resolveVisibleRoleSurfaces(
  surfaces: readonly RoleSurface[],
  roleIds: ReadonlySet<string>,
  context: RoleSurfaceContext,
): RoleSurface[] {
  return surfaces
    .filter((surface) => {
      if (!surfaceMatchesRoles(surface, roleIds)) return false;
      try {
        return surface.shouldDisplay(context);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

// ── Keyboard shortcut combos ─────────────────────────────────────────────────

export type ComboKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * Does a keydown event match a "mod+shift+e" style combo? "mod" accepts either
 * ⌘ or Ctrl so surface shortcuts read the same across platforms. Modifiers not
 * named in the combo must NOT be held (so "mod+e" doesn't swallow "mod+shift+e").
 */
export function matchesShortcutCombo(event: ComboKeyEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.find((part) => !["mod", "meta", "ctrl", "shift", "alt"].includes(part));
  if (!key || event.key.toLowerCase() !== key) return false;
  const wantMod = parts.includes("mod");
  const wantMeta = parts.includes("meta");
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  if (wantMod) {
    if (!event.metaKey && !event.ctrlKey) return false;
  } else {
    if (event.metaKey !== wantMeta) return false;
    if (event.ctrlKey !== wantCtrl) return false;
  }
  return event.shiftKey === wantShift && event.altKey === wantAlt;
}

// ── Workspace-mode bridge ────────────────────────────────────────────────────
// Role surfaces render as first-class workspaces via one generic mode shape,
// `surface:<id>` — the shell handles the prefix, never individual ids.

export const ROLE_SURFACE_MODE_PREFIX = "surface:";

export type RoleSurfaceMode = `${typeof ROLE_SURFACE_MODE_PREFIX}${string}`;

export function roleSurfaceMode(id: RoleSurfaceId): RoleSurfaceMode {
  return `${ROLE_SURFACE_MODE_PREFIX}${id}`;
}

export function isRoleSurfaceMode(mode: string): mode is RoleSurfaceMode {
  return mode.startsWith(ROLE_SURFACE_MODE_PREFIX) && mode.length > ROLE_SURFACE_MODE_PREFIX.length;
}

/** "surface:researcher-desk" -> "researcher-desk" (null when not a surface mode). */
export function parseRoleSurfaceMode(mode: string): RoleSurfaceId | null {
  return isRoleSurfaceMode(mode) ? mode.slice(ROLE_SURFACE_MODE_PREFIX.length) : null;
}
