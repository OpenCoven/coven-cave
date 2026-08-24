import { navSectionForMode, type NavSection } from "./nav-section.ts";
import {
  WORKSPACE_NAV_ITEMS,
  type WorkspaceNavItem,
  type WorkspaceNavMode,
} from "./workspace-navigation.ts";
import {
  WORKSPACE_NAVIGATION_PAGE_DEFINITIONS,
  WORKSPACE_PALETTE_PAGE_DEFINITIONS,
  workspacePageDefinition,
  type WorkspacePageDefinition,
  type WorkspaceStatusContext,
} from "./workspace-page-registry.ts";

const PALETTE_RANK = {
  primary: 0,
  secondary: 1,
  hidden: 2,
} as const;

const WORKSPACE_NAV_ITEMS_BY_ID = new Map<string, WorkspaceNavItem>(
  WORKSPACE_NAV_ITEMS.map((item) => [item.id, item] as const),
);

export type WorkspaceDestinationDefinition = Omit<WorkspacePageDefinition, "id" | "canonicalId"> & {
  readonly id: WorkspaceNavMode;
  readonly canonicalId: WorkspaceNavMode;
  readonly iconName: WorkspaceNavItem["iconName"];
  readonly description: string;
  readonly kbd?: string;
};

function attachDestinationMetadata(
  definition: WorkspacePageDefinition,
): WorkspaceDestinationDefinition {
  const navItem = WORKSPACE_NAV_ITEMS_BY_ID.get(definition.id);
  if (!navItem) {
    throw new Error(`Missing workspace destination metadata for ${definition.id}`);
  }
  return Object.freeze({
    ...definition,
    id: navItem.id,
    canonicalId: navItem.id,
    iconName: navItem.iconName,
    description: navItem.description,
    kbd: navItem.kbd,
  });
}

const PALETTE_DESTINATIONS = Object.freeze(
  [...WORKSPACE_PALETTE_PAGE_DEFINITIONS]
    .sort(
      (left, right) =>
        PALETTE_RANK[left.palette] - PALETTE_RANK[right.palette] ||
        left.title.localeCompare(right.title),
    )
    .map(attachDestinationMetadata),
);

const SIDEBAR_DESTINATIONS = Object.freeze({
  home: Object.freeze(
    WORKSPACE_NAVIGATION_PAGE_DEFINITIONS
      .filter((definition) => navSectionForMode(definition.id) === "home")
      .map(attachDestinationMetadata),
  ),
  code: Object.freeze(
    WORKSPACE_NAVIGATION_PAGE_DEFINITIONS
      .filter((definition) => navSectionForMode(definition.id) === "code")
      .map(attachDestinationMetadata),
  ),
} satisfies Record<NavSection, readonly WorkspaceDestinationDefinition[]>);

export function paletteDestinations(): readonly WorkspaceDestinationDefinition[] {
  return PALETTE_DESTINATIONS;
}

export function sidebarDestinations(section: NavSection): readonly WorkspaceDestinationDefinition[] {
  return SIDEBAR_DESTINATIONS[section];
}

export function statusContextPolicy(pageId: string): WorkspaceStatusContext {
  return workspacePageDefinition(pageId)?.statusContext ?? "hidden";
}
