/**
 * nav-section — the global two-section split of the left siderail (cave-24d2r).
 *
 * The Cave's destinations divide into two rooms rather than one flat list:
 *
 *   - "code" — the working room: Chat, the Code Workshop, the browser, and the
 *     session list. Everything that is a live conversation with a familiar or a
 *     view of the repository it is working in.
 *   - "home" — everything else: the overview, Tasks, Rituals, Memories, and
 *     Marketplace.
 *
 * The section is DERIVED from the active workspace mode, so deep links, the ⌘K
 * palette and restored last-surface strings all land in the right room without
 * carrying a section of their own. The sidebar may hold a section the user has
 * browsed to that differs from the active surface; navigation reconciles it.
 *
 * Pure module (no React) so the split is unit-testable.
 */

import type { IconName } from "./icon";
import { isRoleSurfaceMode } from "./role-surfaces.ts";
import { isWorkspaceMode, resolveWorkspaceModeAlias, type WorkspaceMode } from "./workspace-mode.ts";
import { VISIBLE_WORKSPACE_NAV_ITEMS, type WorkspaceNavItem } from "./workspace-navigation.ts";

export type NavSection = "home" | "code";

export type NavSectionDescriptor = {
    id: NavSection;
    label: string;
    iconName: IconName;
    description: string;
    kbd: string;
};

/** Tab order, left to right. Home leads — it is the default landing room. */
export const NAV_SECTIONS: readonly NavSectionDescriptor[] = [
    {
        id: "home",
        label: "Home",
        iconName: "ph:house-bold",
        description: "Overview, tasks, rituals, memories, and marketplace",
        kbd: "⌃1",
    },
    {
        id: "code",
        label: "Chat",
        iconName: "ph:code-bold",
        description: "Chat, coding sessions, and the code workshop",
        kbd: "⌃2",
    },
];

export const DEFAULT_NAV_SECTION: NavSection = "home";

/** Canonical modes that belong to the Code room. Aliases resolve first, so
 *  `groupchat`, `code` and `github` arrive here as `chat` / `surface:code`. */
const CODE_SECTION_MODES: ReadonlySet<string> = new Set(["chat", "browser"]);

/** The Role Surface room ids that live in Code rather than Home. Rooms are
 *  registry-driven, so this names the coding workbench only — every other
 *  vocation room stays in Home. */
const CODE_SECTION_SURFACE_IDS: ReadonlySet<string> = new Set(["code"]);

export function isNavSection(value: string): value is NavSection {
    return value === "home" || value === "code";
}

/** Which room a mode belongs to. Unknown strings fall back to Home so a stale
 *  persisted mode can never strand the rail in an empty section. */
export function navSectionForMode(mode: string): NavSection {
    const resolved = isWorkspaceMode(mode) ? resolveWorkspaceModeAlias(mode as WorkspaceMode) : mode;
    if (isRoleSurfaceMode(resolved)) {
        return CODE_SECTION_SURFACE_IDS.has(resolved.slice("surface:".length)) ? "code" : "home";
    }
    return CODE_SECTION_MODES.has(resolved) ? "code" : "home";
}

/** The visible nav rows for a section, in registry order. */
export function navItemsForSection(section: NavSection): readonly WorkspaceNavItem[] {
    return VISIBLE_WORKSPACE_NAV_ITEMS.filter((item) => navSectionForMode(item.id) === section);
}

/** Does a Role Surface room (`surface:<id>`) belong in this section? */
export function roomBelongsToSection(roomMode: string, section: NavSection): boolean {
    return navSectionForMode(roomMode) === section;
}
