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
  | "github"
  | "marketplace"
  | "submissions"
  | "grimoire";

export type AliasWorkspaceMode =
  | "groupchat"
  | "journal"
  | "flow"
  | "calendar"
  | "familiar-work-queue"
  | "roles"
  | "capabilities";

export type WorkspaceMode = CanonicalWorkspaceMode | AliasWorkspaceMode;

export const CANONICAL_WORKSPACE_MODES: readonly CanonicalWorkspaceMode[] = [
  "agents",
  "home",
  "chat",
  "board",
  "inbox",
  "browser",
  "github",
  "marketplace",
  "submissions",
  "grimoire",
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
 *   (Marketplace hub sections).
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
