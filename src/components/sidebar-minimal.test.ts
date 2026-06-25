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
  source,
  /<div className="sidebar-nav-scroll"/,
  "Sidebar should keep the main navigation in one continuous scrollable rail",
);

assert.match(
  source,
  /fm\.group === "work"/,
  'Sidebar Work section must filter on group === "work"',
);

// The standalone Knowledge section is gone — Library folded into Tools, so the
// sidebar renders just Work and Tools (no group === "knowledge" filter remains).
assert.doesNotMatch(
  source,
  /"knowledge"/,
  "Knowledge section removed — Library now lives in Tools",
);

assert.match(
  source,
  /fm\.group === "tools"/,
  'Sidebar Tools section must filter on group === "tools"',
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
  /\{ id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘2", description:/,
  "The Chat surface should live at the ⌘2 Work shortcut",
);

assert.match(
  source,
  /\{ id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3", description:/,
  "Board should move to the ⌘3 Work shortcut after removing Familiars",
);

assert.match(
  source,
  /\{ id: "inbox", label: "Automations", iconName: "ph:lightning-bold", group: "work", kbd: "⌘5", description:/,
  "Automations should stay on the inbox route as the ⌘5 Work surface",
);

assert.match(
  source,
  /\{ id: "library", label: "Library", iconName: "ph:books", group: "tools", kbd: "⌘0", description:/,
  "Library is the last shortcut Tools surface, on ⌘0 (shortcuts ascend with sidebar order)",
);

assert.match(
  source,
  /\{ id: "docs", label: "Coven", iconName: "ph:book-bookmark", group: "tools", description:/,
  "Coven is a Tools surface embedding OpenCoven docs, feedback, and social tabs",
);

// Library is a gated add-on (default off): the nav filter hides it until the
// add-on is enabled, mirroring GitHub. Tools always has non-gated surfaces
// (Browser/Terminal/Code/Roles/Flow), so it never renders an empty header.
assert.match(
  source,
  /if \(fm\.id === "library"\) return addons\?\.library === true;/,
  "Library nav entry is gated on the library add-on",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘6", description:/,
  "Browser is the first Tools surface, on ⌘6",
);

assert.match(
  source,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘7", description:/,
  "Terminal follows Browser on ⌘7",
);

assert.match(
  source,
  /\{ id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools", description:/,
  "Roles should appear as a Tools surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "workflows", label: "Workflows"/,
  "Workflows should not appear as a top-level Tools surface",
);

assert.match(
  source,
  /\{ id: "flow", label: "Flow", iconName: "ph:flow-arrow", group: "tools", description:/,
  "Flow should replace the old Workflows page as the top-level automation surface",
);

assert.doesNotMatch(
  source,
  /\{ id: "capabilities",/,
  "Capabilities is no longer a standalone nav entry — it moved to the rightmost tab of the Roles page",
);

assert.doesNotMatch(
  source,
  /\{ id: "sessions"/,
  "Sessions row removed — folded into Chat surface as History sub-view",
);

assert.doesNotMatch(
  source,
  /\{ id: "schedules"/,
  "Schedules row removed — folded into Automations as a tab",
);

assert.doesNotMatch(
  source,
  /\{ id: "plugins"/,
  "Plugins row removed — moved into Settings · Plugins",
);

assert.match(
  styles,
  /\.sidebar-foot-bell,\n\.sidebar-foot-btn/,
  "Notifications and settings should share the same footer row treatment",
);

assert.match(
  source,
  /sidebar-foot-icon-cell/,
  "Settings should use the same fixed footer icon cell as notifications",
);

assert.match(
  styles,
  /\.sidebar-foot-bell > \.relative,\n\.sidebar-foot-icon-cell/,
  "Footer rows should align labels from matching icon cells",
);

// Notifications footer row: a dedicated bell + unread count that opens the
// inbox, sitting above Settings.
assert.match(
  source,
  /onClick=\{onOpenInbox\}[\s\S]{0,700}sidebar-foot-label">Notifications/,
  "footer renders a Notifications row wired to onOpenInbox",
);
assert.match(
  source,
  /unreadCount > 0 \? "ph:bell-fill" : "ph:bell"/,
  "the notifications icon fills when there are unread items",
);
assert.match(
  source,
  /sidebar-foot-badge[\s\S]{0,80}unreadCount > 99 \? "99\+" : unreadCount/,
  "the notifications row shows the unread count badge (capped at 99+)",
);
assert.match(
  source,
  /aria-label=\{unreadCount > 0 \? `Notifications, \$\{unreadCount\} unread` : "Notifications"\}/,
  "the notifications row exposes the unread count to assistive tech",
);
assert.match(
  styles,
  /\.sidebar-foot-badge \{[^}]*background: var\(--color-danger\)/,
  "the unread count badge uses the danger treatment",
);

// Tools-group entries include browser, terminal, roles, and flow.
// (Capabilities moved to a tab on the Roles page — no standalone entry.)
assert.match(
  source,
  /id:\s*"browser"[^}]*group:\s*"tools"/,
  "browser stays in Tools",
);
assert.match(
  source,
  /id:\s*"terminal"[^}]*group:\s*"tools"/,
  "terminal stays in Tools",
);
assert.match(
  source,
  /id:\s*"roles"[^}]*group:\s*"tools"/,
  "roles stays in Tools",
);
assert.match(
  source,
  /id:\s*"flow"[^}]*group:\s*"tools"/,
  "flow stays in Tools",
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
// title (hover tooltip / touch long-press hint / AT description) — so the
// look-alike surfaces (Roles vs Flow) are differentiated.
assert.match(
  source,
  /id: "roles"[\s\S]*?description: "Agent personas/,
  "Roles is described as personas, distinct from Flow",
);
assert.match(
  source,
  /id: "flow"[\s\S]*?description: "Freeform/,
  "Flow is described as the automation editor, distinct from Roles",
);
assert.match(
  source,
  /title=\{title\}/,
  "FolderRow renders the description as a native title (hover/long-press/AT)",
);
assert.match(
  source,
  /`\$\{label\} — \$\{description\}( \(\$\{kbd\}\))?`/,
  "title combines label + description (+ shortcut when present)",
);

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
