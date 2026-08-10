// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = [
  readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/sidebar-minimal/shell-chrome.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/sidebar-minimal/navigation-recents.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/sidebar-minimal/familiars.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/sidebar-minimal/activity-rail.css", import.meta.url), "utf8"),
].join("\n");
const source = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
// The scope switcher + New chat are SHARED with the Chat rail (SidebarRailHeader),
// so their markup and chrome are pinned against the shared files, not this one.
const railHeaderSource = readFileSync(new URL("./sidebar-rail-header.tsx", import.meta.url), "utf8");
const railHeaderCss = readFileSync(new URL("../styles/globals/rail-header.css", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
// The footer (Dashboard + Settings + version) lives in a shared component so it
// stays identical when Chat replaces SidebarMinimal with WorkspaceSidebar.
const footer = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ Icon, CAVE_ICON_SIZE \} from "@\/lib\/icon"/,
  "SidebarMinimal should import the shared icon size constants with the Icon wrapper",
);

assert.doesNotMatch(
  source,
  /<Icon[\s\S]{0,140}width=\{?(?:20|28|36|40)\}?/,
  "Sidebar chrome icons should use CAVE_ICON_SIZE instead of raw oversized pixel widths",
);

assert.match(
  source,
  /<Icon name=\{iconName\} width=\{CAVE_ICON_SIZE\.sidePanelNav\} height=\{CAVE_ICON_SIZE\.sidePanelNav\} className="sidebar-folder-icon" \/>/,
  "Sidebar nav rows should use the shared compact side-panel nav icon size",
);

assert.doesNotMatch(
  styles,
  /\.sidebar-(?:folder|action|foot)-icon\s*\{[^}]*width:\s*(?:14px|20px|28px|36px|40px)/,
  "Sidebar icon CSS must not override the shared compact icon scale with raw pixel sizes",
);

assert.doesNotMatch(
  styles,
  /\.sidebar-folder-row\s*\{[^}]*font-size:\s*18px/,
  "Sidebar nav rows should not use oversized 18px text that makes icons read huge",
);

assert.match(
  styles,
  /\.sidebar-folder-row\s*\{[^}]*font-size:\s*var\(--text-base\)/,
  "Sidebar nav rows should keep compact side-panel text sizing",
);

assert.match(
  styles,
  /\.sidebar-nav-scroll\s*\{[^}]*gap:\s*var\(--space-1\)/,
  "Sidebar nav options should stay visually close together on desktop",
);

assert.match(
  styles,
  /\.sidebar-folder-row,\n\.sidebar-actions--footer \.sidebar-action-row\s*\{[^}]*min-height:\s*30px/,
  "Desktop sidebar option rows should use compact height before mobile touch-target overrides",
);

assert.match(
  source,
  /<div\s+className="sidebar-nav-scroll"/,
  "Sidebar should keep the main navigation in one continuous scrollable rail",
);

assert.match(source, /<NavSectionTabs section=\{section\} onSectionChange=\{onSectionChange\}/, "sidebar destinations use the shared Home and Code tabs");
assert.match(source, /navItemsForSection\(section\)\.map/, "the active tab filters destination rows through the shared registry");
assert.match(source, /sectionRooms\.map\(\(room\) =>/, "dynamic role-surface rooms follow the active section");
assert.match(source, /itemSelector: "\.sidebar-folder-row"/, "visible destinations share one roving keyboard sequence");
assert.match(source, /role="tabpanel"[\s\S]*?aria-labelledby=\{`nav-section-tab-\$\{section\}`\}/, "the destination list is labeled by its active tab");
// Retiring the SidebarSection assertions took this rule's only coverage with
// them. Its section-heading half is dead — nothing emits sidebar-section*
// anymore — but the recent-activity half is live: RecentActivityRollup still
// renders in the Code section, and the 56px rail has no room for it.
// Tolerant of the group's ordering: the dead .sidebar-section-label half should
// eventually be deleted from this rule, and that cleanup must not fail here.
assert.match(
  styles,
  /\.shell-nav--rail \.recent-activity[^{]*\{[^}]*display:\s*none/,
  "the icon rail hides the recent-activity list while retaining destination icons",
);

// The standalone Knowledge section is gone; Library is now isolated on its
// feature branch, so the integrated sidebar renders one flat app list.
assert.doesNotMatch(
  source,
  /"knowledge"/,
  "Knowledge section removed",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "github", label: "GitHub"/,
  "GitHub has no standalone workspace navigation row",
);
assert.doesNotMatch(
  source,
  /hideGithubRow|githubAssignedCount|MODE_BADGES[\s\S]*github:/,
  "the sidebar has no standalone GitHub badge or conditional-row plumbing",
);
assert.match(
  source,
  /const sectionRooms = React\.useMemo\(\s*\(\) => \(props\.roleSurfaces \?\? \[\]\)\.filter\(/,
  "Code Workshop remains registry-driven through the active familiar's rooms",
);
assert.match(
  source,
  /if \(room\.familiarId && room\.familiarId !== activeFamiliarId\) \{[\s\S]*onFamiliarScopeChange\(room\.familiarId, \{ preserveSurface: true \}\)/,
  "aggregate room rows narrow to their owning familiar before entering a room",
);
assert.match(
  source,
  /import \{[\s\S]*navItemsForSection,[\s\S]*\} from "@\/lib\/nav-section"/,
  "the sidebar consumes the shared registry's visible rows through the section split",
);

assert.match(
  navigation,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold",[^}]*group: "work"/,
  "Home starts the Work destination group",
);
assert.match(navigation, /\{ id: "chat", label: "Chat", iconName: "ph:chats",[^}]*group: "work"/, "Chat belongs to Work");
assert.match(navigation, /\{ id: "board", label: "Tasks", iconName: "ph:kanban",[^}]*group: "work"/, "Tasks belongs to Work");
assert.match(navigation, /\{ id: "inbox", label: "Rituals", iconName: "ph:calendar-check",[^}]*group: "work"/, "Rituals belongs to Work");
assert.match(navigation, /\{ id: "grimoire", label: "Memories", iconName: "ph:books",[^}]*group: "explore"/, "Memories belongs to Explore");
assert.match(
  navigation,
  /\{ id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold",[^}]*group: "explore"/,
  "Marketplace belongs to Explore",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "agents", label: "Familiars"/,
  "Familiars subpage should not appear as a workspace navigation row",
);

// The horizontal dock is gone, and the profile switcher no longer lives in the
// left panel either: familiar scope selection moved to the desktop top menu bar
// (FamiliarMenuBar) and the mobile top bar, leaving the sidebar as pure nav.
assert.doesNotMatch(source, /<FamiliarDock/, "the old horizontal familiar dock is gone");
assert.doesNotMatch(
  source,
  /<FamiliarSwitcher/,
  "the familiar switcher is no longer mounted in the left sidebar (it lives in the top bars)",
);
assert.match(
  source,
  /onFamiliarScopeChange: \(id: string \| null, opts\?: \{ multi\?: boolean; preserveSurface\?: boolean \}\) => void/,
  "Sidebar exposes a nullable familiar scope change callback (multi-capable for the header strip)",
);

assert.doesNotMatch(
  source,
  /onOpenSearch|sidebar-familiar-switcher|SelectedFamiliarInfo|sidebar-selected-familiar/,
  "Sidebar does not surface the old search or selected-familiar card",
);

assert.match(
  navigation,
  /\{ id: "chat", label: "Chat", iconName: "ph:chats", kbd: "⌘2", description:/,
  "The Chat surface should keep the ⌘2 shortcut",
);

assert.match(
  navigation,
  /\{ id: "board", label: "Tasks", iconName: "ph:kanban", kbd: "⌘3", description:/,
  "the Tasks surface (mode id 'board') sits on the ⌘3 shortcut",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "calendar", label: "Calendar"/,
  "Calendar should not appear as a standalone sidebar row after merging into Schedules",
);

assert.match(
  navigation,
  /\{ id: "inbox", label: "Rituals", iconName: "ph:calendar-check", kbd: "⌘4", description:/,
  "Rituals should own the old Calendar shortcut as the active schedule surface",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "library", label: "Library"/,
  "Library should not be an integrated sidebar surface while it lives on feature/library",
);

// The "Coven" surface was purged — its docs/feedback/social are now default
// Browser tabs, so no nav entry should remain.
assert.doesNotMatch(
  navigation,
  /id: "docs"|label: "Coven"/,
  "the removed Coven (docs) surface should have no sidebar nav entry",
);

assert.doesNotMatch(
  source,
  /addons\?\.library|fm\.id === "library"/,
  "Library should not be a root add-on gate in the integrated sidebar",
);

// Browser stays in the shared registry (so ⌘5 + the ⌘K "Go to" launcher reach
// it) but is navHidden, so it renders no sidebar row — summoned on demand.
assert.match(
  navigation,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", group: "work", navHidden: true \}/,
  "Browser is kept for ⌘5/palette but hidden from the sidebar rows (navHidden)",
);

assert.doesNotMatch(navigation, /id:\s*"terminal"/, "Terminal is not a standalone sidebar destination");

assert.match(
  navigation,
  /\{ id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description:/,
  "The merged Marketplace hub should appear as a Tools surface",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "roles", label: "Roles"/,
  "Roles is no longer a standalone nav entry — it merged into the Marketplace hub",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "workflows", label: "Workflows"/,
  "Workflows should not appear as a top-level Tools surface",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "flow", label: "Flow", iconName: "ph:flow-arrow", description:/,
  "Flow should not appear as a top-level Tools surface on the active branch",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "capabilities",/,
  "Capabilities is no longer a standalone nav entry — it is a section of the Marketplace hub",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "sessions"/,
  "Sessions row removed — folded into Chat surface as History sub-view",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "schedules"/,
  "Schedules uses the existing inbox mode instead of a second schedules mode",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "plugins"/,
  "Plugins row removed — moved into Settings · Plugins",
);

assert.match(
  styles,
  /\.sidebar-foot-bell,\n\.sidebar-foot-btn/,
  "Legacy bell and footer buttons keep shared footer row treatment",
);

assert.match(
  source,
  /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>/,
  "SidebarMinimal renders the shared footer",
);
assert.match(
  footer,
  /sidebar-foot-icon-cell/,
  "Footer controls should use the fixed footer icon cell",
);

assert.match(
  styles,
  /\.sidebar-foot-bell > \.relative,\n\.sidebar-foot-icon-cell/,
  "Footer rows should align labels from matching icon cells",
);

// The left sidepanel footer stays quiet: reminders/notifications live in the
// Schedules surface and top-level notification affordances, not as a footer row.
assert.doesNotMatch(
  source,
  /onClick=\{onOpenInbox\}[\s\S]{0,700}sidebar-foot-label">Notifications/,
  "footer should not render a Notifications row wired to onOpenInbox",
);
assert.doesNotMatch(
  source,
  /unreadCount > 0 \? "ph:bell-fill" : "ph:bell"/,
  "footer should not render the reminder/notification bell",
);
assert.doesNotMatch(
  source,
  /sidebar-foot-badge[\s\S]{0,80}unreadCount > 99 \? "99\+" : unreadCount/,
  "footer should not render an unread reminders badge",
);

// Marketplace stays a visible entry; Browser is now summoned on demand
// (navHidden), so it must NOT appear among the rendered VISIBLE_MODES rows.
// (Capabilities moved to a tab on the Roles page — no standalone entry.)
assert.match(
  navigation,
  /id:\s*"browser"[^}]*navHidden:\s*true/,
  "browser is navHidden (kept for ⌘5/palette, not a sidebar row)",
);
assert.doesNotMatch(navigation, /id:\s*"terminal"/, "terminal does not stay visible");
assert.match(
  navigation,
  /id:\s*"marketplace"[^}]*label:\s*"Marketplace"/,
  "marketplace stays visible",
);
assert.doesNotMatch(
  navigation,
  /id:\s*"flow"[^}]*label:\s*"Flow"/,
  "flow does not stay in Tools",
);

assert.doesNotMatch(
  source,
  /addons\?\.github|addons\?\.browser|addons\?\.journal|AddonsConfig|addons\?:/,
  "Sidebar should not hide surfaces behind add-on config",
);

assert.doesNotMatch(
  navigation,
  /\{ id: "github", label: "GitHub", iconName: "ph:github-logo"/,
  "GitHub no longer appears as a standalone sidebar destination",
);
assert.doesNotMatch(
  navigation,
  /\{ id: "code", label: "Code"/,
  "Code is no longer a static folder row — the Coding familiar's room row arrives via roleSurfaces (cave-cc5r)",
);

// Recent Activity items must navigate: RecentActivityRollup's onClick calls
// onOpenSession, so the sidebar must forward the prop (and activeSessionId for
// the active-row accent) or clicking a recent session silently does nothing.
assert.match(
  source,
  /<RecentActivityRollup\b[\s\S]{0,220}\bsessions=\{sessions\}[\s\S]{0,180}\bonOpenSession=\{onOpenSession\}/,
  "Recent Activity must receive onOpenSession so selecting an item navigates to it",
);
assert.match(
  source,
  /<RecentActivityRollup\b[\s\S]{0,220}\bactiveSessionId=\{activeSessionId\}/,
  "Recent Activity must receive activeSessionId to highlight the open session",
);
assert.match(
  source,
  /<RecentActivityRollup\b[\s\S]{0,220}\bselectedFamiliarIds=\{selectedFamiliarIds\}/,
  "Recent Activity must receive the persistent familiar selection so multi-scope stays honest",
);

// "New chat" is the left panel's top CTA: it sits directly under the wordmark
// (above the nav scroll) and calls onNewChat. It moved here from the desktop
// menu bar and the mobile top bar, so the sidebar now owns the only new-chat
// affordance on every breakpoint.
assert.match(
  source,
  /<SidebarRailHeader[\s\S]*?onNewChat=\{onNewChat\}/,
  "the sidebar renders a New chat CTA at the top, wired to onNewChat",
);
assert.match(
  railHeaderSource,
  /<Icon[\s\S]{0,240}name="ph:note-pencil"[\s\S]*?<span className="rail-header__new-label">New chat<\/span>/,
  "the New chat CTA is labelled and iconed",
);

// The sidebar header is a static wordmark — collapsing the panel is owned by
// the shell's floating top-left toggle (and ⌘B), so the header is no longer a
// button and the in-panel collapse toggle is gone.
assert.doesNotMatch(
  source,
  /className="sidebar-header sidebar-header--static"/,
  "the static wordmark header is gone — the familiar switcher owns the slot (collapse stays on the shell's floating toggle + ⌘B)",
);
// The header carries the familiar switcher on every page (cave-vtk9) — the
// wordmark gave it the slot; the collapsed rail keeps the avatar-only trigger.
assert.match(
  source,
  /<SidebarRailHeader[\s\S]{0,600}familiars=\{familiars\}/,
  "the sidenav header mounts the familiar switcher",
);
assert.match(
  source,
  /onSelectFamiliar=\{onFamiliarScopeChange\}/,
  "the header switcher drives the shared familiar scope",
);
const sidebarCss = styles;
assert.match(
  railHeaderCss,
  /\.shell-nav--rail \.rail-header__scope \.familiar-switcher__trigger-label,[\s\S]*?display: none/,
  "the rail keeps the avatar-only trigger (label drops)",
);
assert.doesNotMatch(
  source,
  /onToggleSidebar/,
  "the in-panel sidebar collapse toggle is removed",
);
assert.match(
  styles,
  /\.sidebar-action-stack \.sidebar-action-row\s*\{[^}]*border-radius:\s*var\(--radius-control\);/,
  "Sidebar action rows should follow the shared control radius setting",
);
assert.match(
  styles,
  /\.sidebar-folder-row,\n\.sidebar-actions--footer \.sidebar-action-row\s*\{[^}]*border-radius:\s*var\(--radius-control\);/,
  "Sidebar folder/footer rows should follow the shared control radius setting",
);
assert.match(
  styles,
  /@media \(max-width: 1023px\) \{[\s\S]*\.sidebar-header,[\s\S]*\.sidebar-folder-row,[\s\S]*\.sidebar-foot-btn,[\s\S]*\.sidebar-familiar-filter__select[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile sidebar drawer rows and familiar select should meet the shared touch target",
);

// Every surface carries a one-line description, and FolderRow surfaces it as a
// title (hover tooltip / touch long-press hint / AT description).
assert.match(
  navigation,
  /id: "marketplace"[\s\S]*?description: "Manage what you own and preview the curated Skills shelf"/,
  "Marketplace is described as owned inventory plus the curated Skills preview",
);
assert.match(
  source,
  /title=\{title\}/,
  "FolderRow renders the description as a native title (hover/long-press/AT)",
);
assert.match(
  source,
  /`\$\{label\} — \$\{description\}( \(\$\{kbd\}\))?\$\{dragHint\}\$\{splitHint\}`/,
  "title combines label + description (+ shortcut when present) + drag-to-split hint + open-in-split hint",
);

// The app version renders as the bottommost sidebar element — one
// minimal-height muted line under the footer icon row, hidden in the rail.
assert.match(
  footer,
  /import \{ APP_VERSION \} from "@\/lib\/app-version"/,
  "the shared footer reads the version from the shared app-version module",
);
// It became a link to Settings → About (see sidebar-footer.test.ts); still one
// minimal-height muted line, still the bottommost element.
assert.match(
  footer,
  /className="sidebar-version"[\s\S]{0,280}?v\{APP_VERSION\}[\s\S]{0,40}?<\/a>/,
  "the version line is the bottommost element of the shared footer",
);
// Phase D (chat-revamp): the rail-only account avatar circle closes the nav,
// directly under the shared footer — both route to Settings.
assert.match(
  source,
  /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>[\s\S]{0,700}?<button\s+type="button"\s+className="sidebar-user-avatar focus-ring"\s+onClick=\{onOpenSettings\}[\s\S]{0,300}?<\/button>\s*<\/nav>/,
  "the shared footer sits above the rail-only account avatar, which is the bottommost element of the sidebar nav",
);
assert.match(
  styles,
  /\.sidebar-version \{[^}]*line-height: 1;[^}]*color: var\(--text-muted\)/,
  "The version line should be minimal-height muted text",
);
assert.match(
  styles,
  /\.shell-nav--rail \.sidebar-version \{[^}]*display: none/,
  "The 56px rail has no room for text — the version line hides there",
);

// Explore retains quiet row treatment, while its section header now owns the
// separation from the daily Work destinations.
assert.match(
  navigation,
  /\{ id: "journal",[^}]*navHidden: true \}/,
  "Journal keeps no sidebar row — it's a tab inside Memories (palette/deep-link reachability stays via navHidden)",
);
assert.match(
  navigation,
  /\{ id: "grimoire", label: "Memories",[^}]*quiet: true \}/,
  "Memories (grimoire) is in the quiet cluster (cave-xsq.8)",
);
assert.match(
  navigation,
  /id: "inbox",[\s\S]*?\{ id: "grimoire"/,
  "the ⌘-numbered prominent cluster (…Schedules) renders above the quiet cluster",
);
assert.match(
  navigation,
  /\{ id: "marketplace",[^}]*quiet: true \}/,
  "Marketplace is in the quiet cluster",
);
assert.match(
  styles,
  /\.sidebar-folder-row--quiet \{[^}]*color: var\(--text-muted\);/,
  "quiet rows read muted at rest",
);

// ── Split-open marker ────────────────────────────────────────────────────────
// Drag-to-split opens a page beside the primary WITHOUT changing `mode`, so
// active alone would leave the highlight stale. Rows derive a three-way state
// (active / split / idle) from the pure lib/sidebar-nav-state helper (unit
// tests in src/lib/sidebar-nav-state.test.ts), and workspace feeds the open
// split-page modes.
assert.match(
  source,
  /import \{ sidebarRowState, type SidebarRowState \} from "@\/lib\/sidebar-nav-state"/,
  "row highlight derivation lives in the pure, unit-tested sidebar-nav-state helper",
);
assert.match(
  source,
  /state=\{sidebarRowState\(fm\.id, mode, props\.splitPageModes\)\}/,
  "each row derives active/split/idle from mode + open split pages",
);
assert.match(
  source,
  /sidebar-folder-row--split/,
  "rows open in a split carry the --split modifier class",
);
assert.match(
  source,
  /splitPageModes\?: readonly string\[\]/,
  "SidebarMinimal accepts the open split-page modes",
);
assert.match(
  workspace,
  /const splitPageModes = useMemo\([\s\S]{0,220}t\.kind === "page"[\s\S]{0,120}\[splitTargets\],?\s*\n\s*\)/,
  "workspace derives splitPageModes from the live split tiles",
);
assert.match(
  workspace,
  /<SidebarMinimal\s+mode=\{mode\}\s+section=\{navSection\}\s+onSectionChange=\{handleSectionChange\}\s+splitPageModes=\{splitPageModes\}/,
  "workspace threads the section and splitPageModes into the sidebar",
);
assert.match(
  styles,
  /\.sidebar-folder-row--split \{[^}]*color-mix\(in oklch, var\(--accent-presence\)/,
  "the split marker reuses the active accent at a lighter wash",
);

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
