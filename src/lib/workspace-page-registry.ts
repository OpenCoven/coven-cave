import {
  ROLE_SURFACE_MODE_PREFIX,
  isRoleSurfaceMode,
  type RoleSurfaceMode,
} from "./role-surfaces.ts";
import type { WorkspaceMode } from "./workspace-mode.ts";

export type BuiltInWorkspacePageId = WorkspaceMode | "settings" | "dashboard";
export type CompanionPageId = "salem" | "memory" | "terminal";
export type WorkspacePageId = BuiltInWorkspacePageId | CompanionPageId | RoleSurfaceMode;

export type WorkspacePageVariant =
  | "default"
  | "group"
  | "queue"
  | "calendar"
  | "roles"
  | "capabilities"
  | "journal";

export type WorkspacePageDefinition = {
  readonly id: WorkspacePageId;
  readonly title: string;
  readonly canonicalId: WorkspacePageId;
  readonly variant: WorkspacePageVariant;
  readonly nav: "daily" | "quiet" | "hidden" | "footer" | "companion" | "dynamic";
  readonly split: "always" | "contextual";
  readonly landmark: string;
};

const WORKSPACE_MODE_PAGE_DEFINITIONS = {
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
    title: "Group",
    canonicalId: "chat",
    variant: "group",
    nav: "hidden",
    split: "contextual",
    landmark: "Chat / Group",
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
    title: "Calendar",
    canonicalId: "inbox",
    variant: "calendar",
    nav: "hidden",
    split: "always",
    landmark: "Schedules / Calendar",
  },
  inbox: {
    id: "inbox",
    title: "Schedules",
    canonicalId: "inbox",
    variant: "default",
    nav: "daily",
    split: "always",
    landmark: "Schedules",
  },
  browser: {
    id: "browser",
    title: "Browser",
    canonicalId: "browser",
    variant: "default",
    nav: "hidden",
    split: "contextual",
    landmark: "Browser",
  },
  github: {
    id: "github",
    title: "GitHub",
    canonicalId: "github",
    variant: "default",
    nav: "quiet",
    split: "always",
    landmark: "GitHub",
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
    canonicalId: "flow",
    variant: "default",
    nav: "hidden",
    split: "always",
    landmark: "Flow",
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
    title: "Queue",
    canonicalId: "board",
    variant: "queue",
    nav: "hidden",
    split: "contextual",
    landmark: "Tasks / Queue",
  },
  journal: {
    id: "journal",
    title: "Journal",
    canonicalId: "grimoire",
    variant: "journal",
    nav: "quiet",
    split: "contextual",
    landmark: "Grimoire / Journal",
  },
  grimoire: {
    id: "grimoire",
    title: "Grimoire",
    canonicalId: "grimoire",
    variant: "default",
    nav: "quiet",
    split: "contextual",
    landmark: "Grimoire",
  },
} satisfies Record<WorkspaceMode, WorkspacePageDefinition>;

type SupplementalPageId = Exclude<BuiltInWorkspacePageId, WorkspaceMode> | CompanionPageId;

const SUPPLEMENTAL_PAGE_DEFINITIONS = {
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
  salem: {
    id: "salem",
    title: "Salem",
    canonicalId: "salem",
    variant: "default",
    nav: "companion",
    split: "contextual",
    landmark: "Salem",
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
} satisfies Record<SupplementalPageId, WorkspacePageDefinition>;

type StaticWorkspacePageId = BuiltInWorkspacePageId | CompanionPageId;

const STATIC_PAGE_DEFINITIONS = {
  ...WORKSPACE_MODE_PAGE_DEFINITIONS,
  ...SUPPLEMENTAL_PAGE_DEFINITIONS,
} satisfies Record<StaticWorkspacePageId, WorkspacePageDefinition>;

export const BUILT_IN_WORKSPACE_PAGE_IDS = [
  "agents",
  "home",
  "chat",
  "groupchat",
  "board",
  "calendar",
  "inbox",
  "browser",
  "github",
  "roles",
  "marketplace",
  "flow",
  "submissions",
  "capabilities",
  "familiar-work-queue",
  "journal",
  "grimoire",
  "settings",
  "dashboard",
  "salem",
  "memory",
  "terminal",
] as const satisfies readonly StaticWorkspacePageId[];

const BUILT_IN_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_WORKSPACE_PAGE_IDS.map((id) => STATIC_PAGE_DEFINITIONS[id]);

export const WORKSPACE_DAILY_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "daily");

export const WORKSPACE_NAVIGATION_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "daily" || nav === "quiet");

export const WORKSPACE_PALETTE_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "daily" || nav === "quiet" || nav === "hidden");

export const WORKSPACE_FOOTER_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "footer");

export const WORKSPACE_COMPANION_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  BUILT_IN_PAGE_DEFINITIONS.filter(({ nav }) => nav === "companion");

function roleSurfaceTitle(id: RoleSurfaceMode): string {
  return id
    .slice(ROLE_SURFACE_MODE_PREFIX.length)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function workspacePageDefinition(id: string): WorkspacePageDefinition | null {
  if (Object.prototype.hasOwnProperty.call(STATIC_PAGE_DEFINITIONS, id)) {
    return STATIC_PAGE_DEFINITIONS[id as StaticWorkspacePageId];
  }
  if (!isRoleSurfaceMode(id)) return null;

  const title = roleSurfaceTitle(id);
  return {
    id,
    title,
    canonicalId: id,
    variant: "default",
    nav: "dynamic",
    split: "contextual",
    landmark: title,
  };
}

export function workspacePageKey(
  definition: Pick<WorkspacePageDefinition, "canonicalId" | "variant">,
): `${WorkspacePageId}:${WorkspacePageVariant}` {
  return `${definition.canonicalId}:${definition.variant}`;
}

export function isWorkspacePageId(value: string): value is WorkspacePageId {
  return workspacePageDefinition(value) !== null;
}
