// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

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
  /\.sidebar-folder-row\s*\{[^}]*font-size:\s*13px/,
  "Sidebar nav rows should keep compact side-panel text sizing",
);

assert.match(
  styles,
  /\.sidebar-nav-scroll\s*\{[^}]*gap:\s*4px/,
  "Sidebar nav options should stay visually close together on desktop",
);

assert.match(
  styles,
  /\.sidebar-folder-row,\n\.sidebar-actions--footer \.sidebar-action-row\s*\{[^}]*min-height:\s*30px/,
  "Desktop sidebar option rows should use compact height before mobile touch-target overrides",
);

assert.match(
  source,
  /<div className="sidebar-nav-scroll"/,
  "Sidebar should keep the main navigation in one continuous scrollable rail",
);

assert.doesNotMatch(
  source,
  /function SidebarSection|<SidebarSection|sidebar-section-label|fm\.group === "work"|fm\.group === "tools"/,
  "Left sidepanel should render one flat list without collapsible Work/Tools sections",
);

// The standalone Knowledge section is gone; Library is now isolated on its
// feature branch, so the integrated sidebar renders one flat app list.
assert.doesNotMatch(
  source,
  /"knowledge"/,
  "Knowledge section removed",
);

assert.match(
  source,
  /FOLDER_MODES\.map\(\(fm, i\) =>/,
  "Sidebar should render every folder mode directly",
);

assert.match(
  source,
  /\{ id: "home", label: "Home"/,
  "Home is the first Work surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "agents", label: "Familiars"/,
  "Familiars subpage should not appear as a Work navigation row",
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
  /onFamiliarScopeChange: \(id: string \| null\) => void/,
  "Sidebar exposes a nullable familiar scope change callback",
);

assert.doesNotMatch(
  source,
  /onOpenSearch|sidebar-familiar-switcher|SelectedFamiliarInfo|sidebar-selected-familiar/,
  "Sidebar does not surface the old search or selected-familiar card",
);

assert.match(
  source,
  /\{ id: "chat", label: "Chat", iconName: "ph:chats", kbd: "⌘2", description:/,
  "The Chat surface should keep the ⌘2 shortcut",
);

assert.match(
  source,
  /\{ id: "board", label: "Tasks", iconName: "ph:kanban", kbd: "⌘3", description:/,
  "the Tasks surface (mode id 'board') sits on the ⌘3 shortcut",
);

assert.doesNotMatch(
  source,
  /\{ id: "calendar", label: "Calendar"/,
  "Calendar should not appear as a standalone sidebar row after merging into Schedules",
);

assert.match(
  source,
  /\{ id: "inbox", label: "Schedules", iconName: "ph:calendar-check", kbd: "⌘4", description:/,
  "Schedules should own the old Calendar shortcut as the active schedule surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "library", label: "Library"/,
  "Library should not be an integrated sidebar surface while it lives on feature/library",
);

// The "Coven" surface was purged — its docs/feedback/social are now default
// Browser tabs, so no nav entry should remain.
assert.doesNotMatch(
  source,
  /id: "docs"|label: "Coven"/,
  "the removed Coven (docs) surface should have no sidebar nav entry",
);

assert.doesNotMatch(
  source,
  /addons\?\.library|fm\.id === "library"/,
  "Library should not be a root add-on gate in the integrated sidebar",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description:/,
  "Browser is the first Tools surface after Schedules, on ⌘5",
);

assert.doesNotMatch(source, /id:\s*"terminal"/, "Terminal is not a standalone sidebar destination");

assert.match(
  source,
  /\{ id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description:/,
  "The merged Marketplace hub should appear as a Tools surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "roles", label: "Roles"/,
  "Roles is no longer a standalone nav entry — it merged into the Marketplace hub",
);

assert.doesNotMatch(
  source,
  /\{ id: "workflows", label: "Workflows"/,
  "Workflows should not appear as a top-level Tools surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "flow", label: "Flow", iconName: "ph:flow-arrow", description:/,
  "Flow should not appear as a top-level Tools surface on the active branch",
);

assert.doesNotMatch(
  source,
  /\{ id: "capabilities",/,
  "Capabilities is no longer a standalone nav entry — it is a section of the Marketplace hub",
);

assert.doesNotMatch(
  source,
  /\{ id: "sessions"/,
  "Sessions row removed — folded into Chat surface as History sub-view",
);

assert.doesNotMatch(
  source,
  /\{ id: "schedules"/,
  "Schedules uses the existing inbox mode instead of a second schedules mode",
);

assert.doesNotMatch(
  source,
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

// Default visible entries include browser and marketplace.
// (Capabilities moved to a tab on the Roles page — no standalone entry.)
assert.match(
  source,
  /id:\s*"browser"[^}]*label:\s*"Browser"/,
  "browser stays visible",
);
assert.doesNotMatch(source, /id:\s*"terminal"/, "terminal does not stay visible");
assert.match(
  source,
  /id:\s*"marketplace"[^}]*label:\s*"Marketplace"/,
  "marketplace stays visible",
);
assert.doesNotMatch(
  source,
  /id:\s*"flow"[^}]*label:\s*"Flow"/,
  "flow does not stay in Tools",
);

assert.doesNotMatch(
  source,
  /addons\?\.github|addons\?\.browser|addons\?\.journal|AddonsConfig|addons\?:/,
  "Sidebar should not hide surfaces behind add-on config",
);

assert.match(
  source,
  /\{ id: "github", label: "GitHub", iconName: "ph:github-logo"/,
  "GitHub is visible by default",
);

// Recent Activity items must navigate: RecentActivityRollup's onClick calls
// onOpenSession, so the sidebar must forward the prop (and activeSessionId for
// the active-row accent) or clicking a recent session silently does nothing.
assert.match(
  source,
  /<RecentActivityRollup\b[^/]*\bonOpenSession=\{onOpenSession\}/,
  "Recent Activity must receive onOpenSession so selecting an item navigates to it",
);
assert.match(
  source,
  /<RecentActivityRollup\b[^/]*\bactiveSessionId=\{activeSessionId\}/,
  "Recent Activity must receive activeSessionId to highlight the open session",
);

// "New chat" is the left panel's top CTA: it sits directly under the wordmark
// (above the nav scroll) and calls onNewChat. It moved here from the desktop
// menu bar and the mobile top bar, so the sidebar now owns the only new-chat
// affordance on every breakpoint.
assert.match(
  source,
  /<div className="sidebar-actions">\s*<button type="button" className="sidebar-action-row focus-ring" onClick=\{onNewChat\}[^>]*>/,
  "the sidebar renders a New chat CTA at the top, wired to onNewChat",
);
assert.match(
  source,
  /<Icon[\s\S]{0,180}name="ph:note-pencil"[\s\S]*?<span>New chat<\/span>/,
  "the New chat CTA is labelled and iconed",
);

// The sidebar header is a static wordmark — collapsing the panel is owned by
// the shell's floating top-left toggle (and ⌘B), so the header is no longer a
// button and the in-panel collapse toggle is gone.
assert.match(
  source,
  /className="sidebar-header sidebar-header--static"/,
  "the sidebar header is a static wordmark, not a collapse button",
);
assert.match(
  source,
  /<span className="sidebar-title">Coven Cave<\/span>/,
  "the static header keeps the Coven Cave wordmark",
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
  /@media \(max-width: 1023px\) \{[\s\S]*\.sidebar-header,[\s\S]*\.sidebar-action-row,[\s\S]*\.sidebar-folder-row,[\s\S]*\.sidebar-foot-btn,[\s\S]*\.sidebar-familiar-filter__select[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile sidebar drawer rows and familiar select should meet the shared touch target",
);

// Every surface carries a one-line description, and FolderRow surfaces it as a
// title (hover tooltip / touch long-press hint / AT description).
assert.match(
  source,
  /id: "marketplace"[\s\S]*?description: "Browse the store/,
  "Marketplace is described as the store + setup hub",
);
assert.match(
  source,
  /title=\{title\}/,
  "FolderRow renders the description as a native title (hover/long-press/AT)",
);
assert.match(
  source,
  /`\$\{label\} — \$\{description\}( \(\$\{kbd\}\))?\$\{dragHint\}`/,
  "title combines label + description (+ shortcut when present) + drag-to-split hint",
);

// The app version renders as the bottommost sidebar element — one
// minimal-height muted line under the footer icon row, hidden in the rail.
assert.match(
  source,
  /import \{ APP_VERSION \} from "@\/lib\/app-version"/,
  "SidebarMinimal should read the version from the shared app-version module",
);
assert.match(
  source,
  /className="sidebar-version"[\s\S]{0,120}?v\{APP_VERSION\}[\s\S]{0,40}?<\/div>\s*<\/nav>/,
  "The version line should be the bottommost element of the sidebar nav",
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

// Quiet cluster (§8): occasional destinations (Browser, Marketplace, GitHub)
// stay in the same flat list but render muted-until-hover, with the first
// quiet row opening a spacing gap instead of a divider.
assert.match(
  source,
  /\{ id: "browser",[^}]*quiet: true \}/,
  "Browser is visually demoted to the quiet cluster",
);
assert.match(
  source,
  /quietLead=\{Boolean\(fm\.quiet\) && !FOLDER_MODES\[i - 1\]\?\.quiet\}/,
  "the first quiet row opens the spacing gap",
);
assert.match(
  styles,
  /\.sidebar-folder-row--quiet \{[^}]*color: var\(--text-muted\);/,
  "quiet rows read muted at rest",
);
assert.match(
  styles,
  /\.sidebar-folder-row--quiet-lead \{[^}]*margin-top: var\(--space-3\);/,
  "the quiet cluster opens with spacing, not a hairline divider",
);

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
