// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// Delegations/calls used to be a standalone page. It is removed from top-level
// navigation and workspace routing.
assert.doesNotMatch(
  source,
  /\{ id: "calls", label: "Delegations", iconName: "ph:graph", group: "tools", description:/,
  "Delegations should not appear as a Tools surface",
);
assert.doesNotMatch(
  workspace,
  /mode === "calls" \?\s*\(\s*<CallsView/,
  "workspace should not render CallsView for a calls mode",
);
assert.doesNotMatch(workspace, /calls: "Delegations"/, "calls mode should not have a Delegations title");
assert.doesNotMatch(workspace, /case "\/delegations":|case "\/calls":|setMode\("calls"\)/, "slash commands should not route to a Delegations page");

assert.match(
  source,
  /<div className="sidebar-nav-scroll">/,
  "Sidebar should keep the main navigation in one continuous scrollable rail",
);

assert.match(
  source,
  /fm\.group === "work"/,
  'Sidebar Work section must filter on group === "work"',
);

assert.match(
  source,
  /fm\.group === "knowledge"/,
  'Sidebar Knowledge section must filter on group === "knowledge"',
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

// The horizontal dock is replaced by a single profile switcher. The sidebar
// header mounts FamiliarSwitcher (the same control also renders in the mobile
// top bar) wired to the nullable familiar scope.
assert.doesNotMatch(source, /<FamiliarDock/, "the old horizontal familiar dock is gone");
assert.match(
  source,
  /<FamiliarSwitcher[\s\S]*activeFamiliarId=\{activeFamiliarId\}[\s\S]*onSelectFamiliar=\{onFamiliarScopeChange\}/,
  "Sidebar header mounts the familiar profile switcher wired to scope",
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
  /\{ id: "chat", label: "Familiars", iconName: "ph:chats", group: "work", kbd: "⌘2", description:/,
  "Familiars should live at the ⌘2 Work shortcut",
);

assert.match(
  source,
  /\{ id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3", description:/,
  "Board should move to the ⌘3 Work shortcut after removing Familiars",
);

assert.match(
  source,
  /\{ id: "inbox", label: "Schedules", iconName: "ph:calendar-bold", group: "work", kbd: "⌘5", description:/,
  "Schedules should stay on the inbox route as the ⌘5 Work surface",
);

assert.match(
  source,
  /\{ id: "library", label: "Library"/,
  "Library remains the sole Knowledge surface",
);

// Library is a gated add-on (default off): the nav filter hides it until the
// add-on is enabled, mirroring GitHub. Without the gate the Knowledge section
// would always render Library.
assert.match(
  source,
  /if \(fm\.id === "library"\) return addons\?\.library === true;/,
  "Library nav entry is gated on the library add-on",
);

// The Knowledge section must not render an empty header when Library is hidden.
assert.match(
  source,
  /knowledgeModes\.length > 0 \? \(/,
  "Knowledge section only renders when it has visible surfaces",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7", description:/,
  "Browser remains a Tools surface and moves to ⌘7",
);

assert.match(
  source,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8", description:/,
  "Terminal remains a Tools surface and takes ⌘8",
);

assert.match(
  source,
  /\{ id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools", description:/,
  "Roles should appear as a Tools surface",
);

assert.match(
  source,
  /\{ id: "workflows", label: "Workflows", iconName: "ph:git-branch-bold", group: "tools", description:/,
  "Workflows should appear as a Tools surface",
);

assert.match(
  source,
  /\{ id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools", description:/,
  "Capabilities should appear as a Tools surface",
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

// Tools-group entries include browser, terminal, roles, workflows, and capabilities.
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
  /id:\s*"workflows"[^}]*group:\s*"tools"/,
  "workflows stays in Tools",
);
assert.match(
  source,
  /id:\s*"capabilities"[^}]*group:\s*"tools"/,
  "capabilities stays in Tools",
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

// PR #322 wrapped the New Chat ActionRow in .sidebar-new-chat-row so desktop
// CSS could hide it (the FamiliarSwitcher had its own + button to dedupe
// against). PR #304 replaced the switcher with a plain dropdown that has no
// + button, so the New Chat ActionRow is the sole new-chat affordance now —
// no wrapper, no responsive hide.

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
// look-alike surfaces (Roles vs Workflows vs Capabilities) are differentiated.
assert.match(
  source,
  /id: "roles"[\s\S]*?description: "Reusable agent personas/,
  "Roles is described as personas, distinct from Workflows/Capabilities",
);
assert.match(
  source,
  /id: "workflows"[\s\S]*?description: "Multi-step pipelines/,
  "Workflows is described as pipelines, distinct from Roles/Capabilities",
);
assert.match(
  source,
  /id: "capabilities"[\s\S]*?description: "Skills and tools/,
  "Capabilities is described as skills/tools, distinct from Roles/Workflows",
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
