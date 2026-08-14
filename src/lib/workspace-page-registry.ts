import {
  ROLE_SURFACE_MODE_PREFIX,
  isRoleSurfaceMode,
  type RoleSurfaceMode,
} from "./role-surfaces.ts";
import {
  resolveWorkspaceModeAlias,
  type WorkspaceMode,
} from "./workspace-mode.ts";

export type SupplementalWorkspacePageId = "settings" | "dashboard" | "memory" | "terminal";
export type BuiltInWorkspacePageId = WorkspaceMode | SupplementalWorkspacePageId;
export type WorkspacePageId = BuiltInWorkspacePageId | RoleSurfaceMode;

export type WorkspacePageVariant =
  | "default"
  | "group"
  | "queue"
  | "calendar"
  | "roles"
  | "capabilities"
  | "journal"
  | "flow"
  | "code"
  | "activity";

export type WorkspacePageDefinition = {
  readonly id: WorkspacePageId;
  readonly title: string;
  readonly canonicalId: WorkspacePageId;
  readonly variant: WorkspacePageVariant;
  readonly nav: "daily" | "quiet" | "hidden" | "footer" | "companion" | "dynamic";
  readonly split: "always" | "contextual";
  readonly landmark: string;
};

function freezePageMap<const Pages extends Record<string, WorkspacePageDefinition>>(
  pages: Pages,
): Readonly<Pages> {
  for (const definition of Object.values(pages)) Object.freeze(definition);
  return Object.freeze(pages);
}

const CODE_ROLE_SURFACE_MODE: RoleSurfaceMode = "surface:code";

const WORKSPACE_MODE_PAGES = freezePageMap({
  agents: {
    id: "agents",
    title: "Familiars",
    canonicalId: "agents",
    variant: "default",
    nav: "hidden",
    split: "contextual",
    landmark: "Familiars",
  },
  home: {
    id: "home",
    title: "Home",
    canonicalId: "home",
    variant: "default",
    nav: "daily",
    split: "always",
    landmark: "Home",
  },
  chat: {
    id: "chat",
    title: "Chat",
    canonicalId: "chat",
    variant: "default",
    nav: "daily",
    split: "contextual",
    landmark: "Chat",
  },
  groupchat: {
    id: "groupchat",
    title: "Group chat",
    canonicalId: "chat",
    variant: "group",
    nav: "hidden",
    split: "contextual",
    landmark: "Group chat",
  },
  board: {
    id: "board",
    title: "Tasks",
    canonicalId: "board",
    variant: "default",
    nav: "daily",
    split: "always",
    landmark: "Tasks",
  },
  calendar: {
    id: "calendar",
    title: "Rituals",
    canonicalId: "inbox",
    variant: "calendar",
    nav: "hidden",
    split: "always",
    landmark: "Rituals / Calendar",
  },
  inbox: {
    id: "inbox",
    title: "Rituals",
    canonicalId: "inbox",
    variant: "default",
    nav: "daily",
    split: "always",
    landmark: "Rituals",
  },
  browser: {
    id: "browser",
    title: "Browser",
    canonicalId: "browser",
    variant: "default",
    nav: "companion",
    split: "contextual",
    landmark: "Browser",
  },
  github: {
    id: "github",
    title: "GitHub activity",
    canonicalId: CODE_ROLE_SURFACE_MODE,
    variant: "activity",
    nav: "hidden",
    split: "contextual",
    landmark: "Coding Desk / GitHub activity",
  },
  code: {
    id: "code",
    title: "Code",
    canonicalId: CODE_ROLE_SURFACE_MODE,
    variant: "code",
    nav: "hidden",
    split: "contextual",
    landmark: "Coding Desk",
  },
  roles: {
    id: "roles",
    title: "Roles",
    canonicalId: "marketplace",
    variant: "roles",
    nav: "hidden",
    split: "always",
    landmark: "Marketplace / Roles",
  },
  marketplace: {
    id: "marketplace",
    title: "Marketplace",
    canonicalId: "marketplace",
    variant: "default",
    nav: "quiet",
    split: "always",
    landmark: "Marketplace",
  },
  flow: {
    id: "flow",
    title: "Flow",
    canonicalId: "inbox",
    variant: "flow",
    nav: "hidden",
    split: "always",
    landmark: "Rituals / Flow",
  },
  submissions: {
    id: "submissions",
    title: "Submissions",
    canonicalId: "submissions",
    variant: "default",
    nav: "hidden",
    split: "contextual",
    landmark: "Submissions",
  },
  capabilities: {
    id: "capabilities",
    title: "Capabilities",
    canonicalId: "marketplace",
    variant: "capabilities",
    nav: "hidden",
    split: "always",
    landmark: "Marketplace / Capabilities",
  },
  "familiar-work-queue": {
    id: "familiar-work-queue",
    title: "Tasks",
    canonicalId: "board",
    variant: "queue",
    nav: "hidden",
    split: "contextual",
    landmark: "Tasks / Work queue",
  },
  journal: {
    id: "journal",
    title: "Journal",
    canonicalId: "grimoire",
    variant: "journal",
    nav: "quiet",
    split: "contextual",
    landmark: "Memories / Journal",
  },
  grimoire: {
    id: "grimoire",
    title: "Memories",
    canonicalId: "grimoire",
    variant: "default",
    nav: "quiet",
    split: "contextual",
    landmark: "Memories",
  },
  salem: {
    id: "salem",
    title: "Ask Salem",
    canonicalId: "salem",
    variant: "default",
    nav: "hidden",
    split: "contextual",
    landmark: "Ask Salem",
  },
} satisfies Record<WorkspaceMode, WorkspacePageDefinition>);

const SUPPLEMENTAL_PAGES = freezePageMap({
  settings: {
    id: "settings",
    title: "Settings",
    canonicalId: "settings",
    variant: "default",
    nav: "footer",
    split: "always",
    landmark: "Settings",
  },
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    canonicalId: "dashboard",
    variant: "default",
    nav: "footer",
    split: "always",
    landmark: "Dashboard",
  },
  memory: {
    id: "memory",
    title: "Memory",
    canonicalId: "memory",
    variant: "default",
    nav: "companion",
    split: "contextual",
    landmark: "Memory",
  },
  terminal: {
    id: "terminal",
    title: "Terminal",
    canonicalId: "terminal",
    variant: "default",
    nav: "companion",
    split: "contextual",
    landmark: "Terminal",
  },
} satisfies Record<SupplementalWorkspacePageId, WorkspacePageDefinition>);

type StaticWorkspacePageId = WorkspaceMode | SupplementalWorkspacePageId;

const STATIC_PAGE_DEFINITIONS = freezePageMap({
  ...WORKSPACE_MODE_PAGES,
  ...SUPPLEMENTAL_PAGES,
} satisfies Record<StaticWorkspacePageId, WorkspacePageDefinition>);

export const BUILT_IN_WORKSPACE_PAGE_IDS: readonly StaticWorkspacePageId[] = Object.freeze([
  ...(Object.keys(WORKSPACE_MODE_PAGES) as WorkspaceMode[]),
  ...(Object.keys(SUPPLEMENTAL_PAGES) as SupplementalWorkspacePageId[]),
]);

const BUILT_IN_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_WORKSPACE_PAGE_IDS.map((id) => STATIC_PAGE_DEFINITIONS[id]),
);

export const WORKSPACE_DAILY_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "daily"),
);

export const WORKSPACE_NAVIGATION_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "daily" || nav === "quiet"),
);

export const WORKSPACE_PALETTE_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_PAGE_DEFINITIONS.filter(
    ({ nav }) => nav === "daily" || nav === "quiet" || nav === "hidden",
  ),
);

export const WORKSPACE_FOOTER_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "footer"),
);

export const WORKSPACE_COMPANION_PAGE_DEFINITIONS = Object.freeze(
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "companion"),
);

function roleSurfaceTitle(id: RoleSurfaceMode): string {
  const title = id
    .slice(ROLE_SURFACE_MODE_PREFIX.length)
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/(^|\s)\p{L}/gu, (wordStart) => wordStart.toUpperCase());
  return /[\p{L}\p{N}]/u.test(title) ? title : "Role surface";
}

export function workspacePageDefinition(id: string): WorkspacePageDefinition | null {
  if (Object.hasOwn(STATIC_PAGE_DEFINITIONS, id)) {
    return STATIC_PAGE_DEFINITIONS[id as StaticWorkspacePageId];
  }
  if (!isRoleSurfaceMode(id)) return null;

  const title = roleSurfaceTitle(id);
  return Object.freeze({
    id,
    title,
    canonicalId: id,
    variant: "default",
    nav: "dynamic",
    split: "contextual",
    landmark: title,
  });
}

export function workspacePageKey(
  definition: Pick<WorkspacePageDefinition, "canonicalId" | "variant">,
): `${WorkspacePageId}:${WorkspacePageVariant}` {
  return `${definition.canonicalId}:${definition.variant}`;
}

export function isWorkspacePageId(value: string): value is WorkspacePageId {
  return workspacePageDefinition(value) !== null;
}

export function canonicalWorkspacePageId(mode: WorkspaceMode): WorkspacePageId {
  return resolveWorkspaceModeAlias(mode);
}
