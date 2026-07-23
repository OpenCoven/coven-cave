/**
 * Workspace mode vocabulary (issue #3283, cave-m4ih.3).
 *
 * Canonical modes are the surfaces the Workspace detail pane actually renders
 * standalone. Alias modes are compatibility vocabulary: they stay accepted
 * everywhere a mode string travels (`?mode=` deep links, persisted
 * last-surface restore, `cave:navigate-mode` events, the ⌘K palette,
 * drag-to-split payloads) but always land on a canonical surface — usually a
 * specific tab or section of it. Aliases must never appear as peer
 * destinations in nav UI.
 */

export type CanonicalWorkspaceMode =
  | "agents"
  | "home"
  | "chat"
  | "board"
  | "inbox"
  | "browser"
  | "code"
  | "marketplace"
  | "submissions"
  | "grimoire"
  | "salem";

export type AliasWorkspaceMode =
  | "groupchat"
  | "journal"
  | "flow"
  | "calendar"
  | "familiar-work-queue"
  | "roles"
  | "capabilities"
  | "github";

export type WorkspaceMode = CanonicalWorkspaceMode | AliasWorkspaceMode;

export const CANONICAL_WORKSPACE_MODES: readonly CanonicalWorkspaceMode[] = [
  "agents",
  "home",
  "chat",
  "board",
  "inbox",
  "browser",
  // Code — the Codex-style multi-session coding surface (cave-k0ua). Reverses
  // the earlier Code-mode retirement; default-on since phase 2 (cave-m6ys),
  // with GitHub absorbed as its GitHub tab ("github" is now an alias below).
  "code",
  "marketplace",
  "submissions",
  "grimoire",
  // Ask Salem — a full standalone surface, reachable via the ⌘K palette, Home,
  // deep links, and cave:navigate-mode; navHidden in the sidebar (no nav row).
  "salem",
];

/**
 * The single alias → canonical remap table: where every compatibility mode
 * lands. Two alias classes share it:
 *
 * - Rewritten in Workspace.setMode, so `mode` state never holds them:
 *   `groupchat` opens Chat's Group tab, `journal` opens Memories' Journal
 *   tab, `flow` (retired surface) lands on Rituals.
 * - Kept in `mode` state as tab/section selectors: the render branch mounts
 *   the canonical surface on the matching tab, keyed by the alias so deep
 *   links remount onto it — `calendar` (Rituals' Calendar tab),
 *   `familiar-work-queue` (Tasks' Queue tab), `roles` / `capabilities`
 *   (Marketplace hub sections), `github` (Code's GitHub tab — the standalone
 *   surface was absorbed in cave-m6ys; old deep links and persisted
 *   last-surface strings keep landing on the same content).
 *
 * workspace-alias-modes.test.ts pins Workspace's branches to this table;
 * sidebar-nav-state derives row highlighting from it.
 */
export const MODE_ALIASES = {
  groupchat: "chat",
  journal: "grimoire",
  flow: "inbox",
  calendar: "inbox",
  "familiar-work-queue": "board",
  roles: "marketplace",
  capabilities: "marketplace",
  github: "code",
} as const satisfies Record<AliasWorkspaceMode, CanonicalWorkspaceMode>;

export function isAliasWorkspaceMode(mode: string): mode is AliasWorkspaceMode {
  return Object.prototype.hasOwnProperty.call(MODE_ALIASES, mode);
}

export function isWorkspaceMode(mode: string): mode is WorkspaceMode {
  return (
    (CANONICAL_WORKSPACE_MODES as readonly string[]).includes(mode) ||
    isAliasWorkspaceMode(mode)
  );
}

/** The canonical surface a mode renders on: aliases resolve through
 *  MODE_ALIASES, canonical modes return themselves. */
export function resolveWorkspaceModeAlias(mode: WorkspaceMode): CanonicalWorkspaceMode {
  return isAliasWorkspaceMode(mode) ? MODE_ALIASES[mode] : mode;
}
