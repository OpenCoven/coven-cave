// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const mobileTabs = await readFile(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const notificationBell = await readFile(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const bottomTerminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const browserPane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const comuxView = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const automationsView = await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  bottomTerminal,
  /Running outside Tauri|Only mounts inside the Tauri webview/,
  "Terminal should keep a browser-safe path for mobile web access",
);

assert.match(
  browserPane,
  /outside Tauri|fallback iframe|window\.open/,
  "Browser view should keep a browser fallback path outside the desktop webview",
);

assert.match(
  globals,
  /Those tabs live in normal shell flow[\s\S]{0,220}\.shell-detail\s*\{[\s\S]{0,80}padding-bottom:\s*0;/,
  "Mobile shell detail should not reserve extra space above bottom tabs",
);

assert.match(
  mobileTabs,
  /{ id: "inbox", label: "Auto", ariaLabel: "Automations", iconName: "ph:lightning-bold" }/,
  "Mobile bottom tabs should keep the Automations label short while preserving the full accessible name",
);

assert.match(
  mobileTabs,
  /aria-label=\{showBadge \? `\$\{tab\.ariaLabel\}, \$\{inboxBadgeCount\} unread` : tab\.ariaLabel\}/,
  "Mobile bottom tabs should expose per-tab accessible labels instead of relying on cramped visual text",
);

assert.match(
  mobileTabs,
  /<span className="mobile-bottom-tab__indicator" aria-hidden \/>/,
  "Mobile bottom tabs should include an explicit active indicator hook",
);

assert.match(
  topBar,
  /navDrawerOpen\?: boolean;[\s\S]*listDrawerOpen\?: boolean;[\s\S]*familiarDrawerOpen\?: boolean;/,
  "TopBar should receive mobile drawer state so controls can announce open/closed state",
);

assert.match(
  topBar,
  /aria-expanded=\{Boolean\(navDrawerOpen\)\}/,
  "Mobile nav toggle should announce whether the navigation drawer is open",
);

// Selecting a destination dismisses the mobile OVERLAY drawer, but must use
// the mobile-only `dismissNavMobile`/`dismissListMobile` — NOT `closeNav`/
// `closeList`, which also collapse the persistent DESKTOP side panel. On
// desktop the left panel must stay open when an option is selected.
assert.match(
  workspace,
  /onModeChange=\{\(m\) => \{[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*setMode\(m as WorkspaceMode\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Mobile sidebar destination taps should dismiss the nav drawer (mobile-only) without collapsing the desktop nav",
);
assert.match(
  workspace,
  /onOpenSession=\{\(id\) => \{[\s\S]*openFamiliarSession\(id\);[\s\S]*shellRef\.current\?\.dismissListMobile\(\);[\s\S]*\}\}/,
  "Mobile list drawer session taps should dismiss the list drawer (mobile-only) without collapsing the desktop list",
);

// The mobile-only dismissers must be gated on isMobile and must NOT call the
// panel collapse() that closeNav/closeList use — that's what keeps the desktop
// side panel open when an option is selected. (`shell` is read above.)
assert.match(
  shell,
  /dismissNavMobile:\s*\(\)\s*=>\s*\{\s*if \(isMobile\) setMobileDrawer\(\(c\) => \(c === "nav" \? null : c\)\);\s*\}/,
  "dismissNavMobile must only dismiss the mobile drawer (no desktop collapse)",
);
assert.match(
  shell,
  /dismissListMobile:\s*\(\)\s*=>\s*\{\s*if \(isMobile\) setMobileDrawer\(\(c\) => \(c === "list" \? null : c\)\);\s*\}/,
  "dismissListMobile must only dismiss the mobile drawer (no desktop collapse)",
);

assert.match(
  topBar,
  /aria-pressed=\{Boolean\(listDrawerOpen\)\}/,
  "Mobile list toggle should expose pressed state while the list drawer is open",
);

assert.match(
  topBar,
  /aria-pressed=\{Boolean\(familiarDrawerOpen\)\}/,
  "Mobile familiar toggle should expose pressed state while the familiar drawer is open",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar\s*\{[\s\S]*height:\s*calc\(52px \+ var\(--sai-top\)\)/,
  "Mobile top bar should provide enough vertical room for 44px controls",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar__search\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile search button should meet the 44px touch target",
);

assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.ui-search-input-field\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Shared mobile search input fields should fill their touch-sized wrappers",
);

assert.match(
  notificationBell,
  /notification-bell__trigger/,
  "Notification bell should expose a stable hook for mobile hit-area sizing",
);

assert.match(
  notificationBell,
  /notification-bell__popover[\s\S]*notification-bell__settings-btn[\s\S]*notification-bell__open-inbox[\s\S]*notification-bell__list/,
  "Notification bell should expose stable hooks for mobile popover layout and actions",
);
assert.match(
  notificationBell,
  /notification-bell__mute[\s\S]*notification-bell__action/,
  "Notification bell item controls should expose stable mobile hit-area hooks",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar__actions \.notification-bell__trigger,[\s\S]*\.top-bar__account\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile top-bar notification and account buttons should meet the 44px touch target",
);

assert.match(
  shell,
  /shell-banner__cta[\s\S]*shell-banner__dismiss/,
  "Shell banners should expose stable CTA and dismiss hooks",
);

assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.shell-banner__cta\s*\{[\s\S]*min-height:\s*var\(--touch-target\)[\s\S]*\.shell-banner__dismiss\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile shell banner CTA and dismiss controls should meet the shared touch target",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.notification-bell__popover\s*\{[\s\S]*position:\s*fixed;[\s\S]*left:\s*calc\(8px \+ var\(--sai-left\)\);[\s\S]*right:\s*calc\(8px \+ var\(--sai-right\)\);[\s\S]*width:\s*auto;/,
  "Mobile notification popover should be fixed to the safe viewport instead of overflowing from the trigger",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.notification-bell__settings-btn,[\s\S]*\.notification-bell__open-inbox\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile notification popover header actions should meet the 44px touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.notification-bell__action,[\s\S]*min-height:\s*var\(--touch-target\)[\s\S]*\.notification-bell__mute\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile notification item actions and mute controls should meet the shared touch target",
);

assert.match(
  globals,
  /\.shell-nav-panel,[\s\S]{0,120}\.shell-list-panel,[\s\S]{0,120}\.shell-familiar-panel\s*\{[\s\S]{0,260}height:\s*100dvh/,
  "Mobile drawers should use dynamic viewport height so iOS browser chrome does not create hidden overflow",
);

assert.match(
  globals,
  /\.mobile-bottom-tab__indicator\s*\{[\s\S]{0,200}transform:\s*scaleX\(0\)/,
  "Mobile bottom tabs should render an active indicator that can animate without shifting layout",
);

// The bottom tabs are the primary mobile destination switcher — each tap target
// must meet the shared 44px hit-area, and its keyboard focus ring must use the
// shared inset offset token (not an ad-hoc value) so it doesn't clip or drift.
assert.match(
  globals,
  /\.mobile-bottom-tab\s*\{[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "Primary mobile bottom tabs should meet the shared touch target",
);
assert.match(
  globals,
  /\.mobile-bottom-tab:focus-visible\s*\{[\s\S]*?outline-offset:\s*var\(--ring-offset-inset\)/,
  "Mobile bottom tab focus ring should use the shared inset offset token",
);

// The right companion rail was removed in favour of drag-to-split, so the
// workspace no longer computes companion-pane visibility (showCompanionRail).
assert.match(
  workspace,
  /const openUrlInAppBrowser = useCallback\(\(url: string\) => \{/,
  "Workspace should provide an in-app browser opener for chat/feed/board links",
);
assert.match(
  workspace,
  /browserPaneRef\.current\?\.navigateTo\(url\)/,
  "Link opens should navigate the embedded Browser pane",
);
assert.match(
  workspace,
  /setMode\("browser"\)/,
  "Link opens should switch the main detail surface to Browser mode",
);
assert.match(
  workspace,
  /onOpenUrl=\{openUrlInAppBrowser\}/,
  "Workspace should thread the in-app browser opener into ChatSurface",
);
// The right companion (Browser/Salem) panel was removed in favour of
// drag-to-split, so there is no companion toggle to assert here anymore.

assert.match(
  automationsView,
  /automation-create-chat-btn/,
  "Schedules create-via-chat CTA should expose a stable mobile hit-area hook",
);

assert.match(
  automationsView,
  /automation-list-row/g,
  "Schedule rows should expose stable mobile row hooks",
);

assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.automation-create-chat-btn\s*\{[\s\S]*min-height:\s*var\(--touch-target\)[\s\S]*\.automation-list-row\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Schedules mobile CTA and list rows should meet the shared touch target",
);

assert.match(
  workspace,
  /mode === "terminal"[\s\S]*\? "relative"[\s\S]*: "pointer-events-none invisible absolute inset-0 opacity-0"/,
  "Inactive persistent terminal detail should be invisible, not just transparent, on mobile surfaces",
);

assert.match(
  comuxView,
  /comux-terminal-toolbar-button[\s\S]*Split right[\s\S]*comux-terminal-toolbar-button[\s\S]*Split down[\s\S]*comux-terminal-add-button/,
  "Terminal toolbar actions should expose stable mobile hit-area hooks",
);

assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.comux-terminal-toolbar-button,[\s\S]*\.comux-terminal-empty-add\s*\{[\s\S]*min-height:\s*var\(--touch-target\)[\s\S]*\.comux-terminal-add-button,[\s\S]*\.comux-terminal-tab-close,[\s\S]*\.comux-terminal-pane-action\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Terminal mobile toolbar and close controls should meet the shared touch target",
);
