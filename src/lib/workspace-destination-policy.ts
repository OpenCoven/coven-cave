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

// One ordered list, in registry order (cave-fh9so). The sidebar used to split
// these into a Home room and a Code room behind a titlebar toggle, which meant
// half the destinations were unreachable at any moment and Home was rendered
// twice — once as a tab, once as the first row. The registry order already
// reads correctly top to bottom (Home, Chat, Tasks, Rituals, …), so removing
// the partition is all it took to put Chat directly under Home.
const SIDEBAR_DESTINATIONS: readonly WorkspaceDestinationDefinition[] = Object.freeze(
  WORKSPACE_NAVIGATION_PAGE_DEFINITIONS.map(attachDestinationMetadata),
);

export function paletteDestinations(): readonly WorkspaceDestinationDefinition[] {
  return PALETTE_DESTINATIONS;
}

export function sidebarDestinations(): readonly WorkspaceDestinationDefinition[] {
  return SIDEBAR_DESTINATIONS;
}

export function statusContextPolicy(pageId: string): WorkspaceStatusContext {
  return workspacePageDefinition(pageId)?.statusContext ?? "hidden";
}
