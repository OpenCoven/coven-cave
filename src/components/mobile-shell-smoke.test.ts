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
const automationsView = [
  await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./automations/automation-lists.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./automations/inbox-feed-list.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./automations/schedule-list.tsx", import.meta.url), "utf8"),
].join("\n");
const globals = (
  await Promise.all(
    [
      "../app/globals.css",
      "../styles/sidebar-minimal.css",
      "../styles/status-bar.css",
      "../styles/globals/foundations.css",
      "../styles/globals/shell-navigation.css",
      "../styles/globals/primitives.css",
      "../styles/globals/themes.css",
      "../styles/globals/desktop-chrome.css",
      "../styles/globals/shell-responsive.css",
      "../styles/globals/calendar-agenda.css",
      "../styles/globals/surface-compact-calendar.css",
      "../styles/globals/surface-reporting.css",
      "../styles/globals/surface-chat-overlays.css",
      "../styles/globals/surface-marketplace.css",
      "../styles/globals/surface-role-workspaces.css",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  )
).join("\n");

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
  /FOLDER_MODES\.filter\(\(fm\) => !fm\.quiet && !fm\.navHidden\)/,
  "Mobile bottom tabs should derive from the desktop sidebar's primary cluster, inheriting canonical names (Rituals included) by construction",
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
  /navDrawerOpen\?: boolean;[\s\S]*listDrawerOpen\?: boolean;/,
  "TopBar should receive mobile drawer state so controls can announce open/closed state",
);

assert.match(
  topBar,
  /aria-expanded=\{Boolean\(navDrawerOpen\)\}/,
  "Mobile nav toggle should announce whether the navigation drawer is open",
);

// Selecting a destination dismisses the active mobile OVERLAY drawer, but must
// use the mobile-only `dismissNavMobile`/`dismissListMobile` helpers — NOT
// `closeNav`/`closeList`, which alter desktop panels. Chat uses only the nav
// drawer, where WorkspaceSidebar replaces the normal navigation.
assert.match(
  workspace,
  /onModeChange=\{\(m\) => \{[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*setMode\(m as CaveMode\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Mobile sidebar destination taps should dismiss the nav drawer (mobile-only) without collapsing the desktop nav",
);
const normalSidebarBlock = workspace.match(/const sidebar =[\s\S]*?const chatSidebar =/)?.[0] ?? "";
assert.ok(normalSidebarBlock, "Workspace should keep the normal SidebarMinimal wiring together");
assert.match(
  normalSidebarBlock,
  /onOpenSession=\{\(id\) => \{[\s\S]*openFamiliarSession\(id\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Normal mobile session taps should dismiss the nav drawer that becomes Chat's contextual sidebar",
);
assert.doesNotMatch(
  normalSidebarBlock,
  /onOpenSession=\{\(id\) => \{[\s\S]*openFamiliarSession\(id\);[\s\S]*shellRef\.current\?\.dismissListMobile\(\);[\s\S]*\}\}/,
  "Normal mobile session taps should not target the absent Chat list drawer",
);
const chatSidebarBlock = workspace.match(/const chatSidebar =[\s\S]*?const contextualNav =/)?.[0] ?? "";
assert.ok(chatSidebarBlock, "Workspace should keep the contextual Chat nav wiring together");
assert.doesNotMatch(
  chatSidebarBlock,
  /dismissListMobile/,
  "Chat contextual-nav actions should never target the unused list drawer",
);
assert.match(
  chatSidebarBlock,
  /onOpenSession=\{\(session\) => \{[\s\S]*openFamiliarSession\(session\.id, session\.familiarId\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Chat session opens should dismiss the mobile contextual nav without changing desktop layout",
);
assert.match(
  chatSidebarBlock,
  /onNewChat=\{\(projectRoot\) => \{[\s\S]*startFamiliarChat\(activeId, projectRoot\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Chat new-chat actions should dismiss the mobile contextual nav without changing desktop layout",
);
assert.match(
  chatSidebarBlock,
  /onNavigate=\{\(nextMode\) => \{[\s\S]*setMode\(nextMode\);[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*\}\}/,
  "Chat Home, Scheduled, and Plugins actions should dismiss the mobile contextual nav without changing desktop layout",
);
assert.match(
  chatSidebarBlock,
  /onOpenUrl=\{\(url\) => \{[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*openUrlInApp\(url\);[\s\S]*\}\}/,
  "Chat PR links should dismiss only the mobile contextual nav before opening",
);
assert.match(
  chatSidebarBlock,
  /onOpenSettings=\{\(\) => \{[\s\S]*shellRef\.current\?\.dismissNavMobile\(\);[\s\S]*nextRouter\.push\("\/settings"\);[\s\S]*\}\}/,
  "Chat settings should dismiss only the mobile contextual nav before routing",
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
  workspace,
  /onToggleNav=\{\(\) => shellRef\.current\?\.toggleNav\(\)\}[\s\S]*onToggleList=\{undefined\}/,
  "Mobile Chat should expose the contextual nav toggle and no list toggle",
);
assert.match(
  workspace,
  /navDrawerOpen=\{navDrawerOpen\}\s*listDrawerOpen=\{false\}/,
  "Mobile Chat should expose nav drawer state while reporting the absent list drawer as closed",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar\s*\{[\s\S]*height:\s*calc\(52px \+ var\(--sai-top\)\)/,
  "Mobile top bar should provide enough vertical room for 44px controls",
);

assert.match(
  globals,
  /\.top-bar\s*\{(?=[^}]*display:\s*none;)[^}]*width:\s*100%;/,
  "Adaptive top bar should fill its flex host so search can expand and actions stay pinned to the trailing edge",
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
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar__actions \.top-bar__tasks > \.ui-icon-btn\s*\{[^}]*width:\s*var\(--touch-target\);[^}]*height:\s*var\(--touch-target\);/,
  "Mobile top-bar task overflow should meet the same 44px touch target as adjacent actions",
);

assert.match(
  globals,
  /@media \(max-width: 455px\) \{[\s\S]*\.top-bar__actions \[data-quick-chat-trigger\],[\s\S]*\.top-bar__actions \.top-bar__tasks\s*\{[^}]*display:\s*none;/,
  "Compact phones should demote Quick Chat and task shortcuts so primary header controls preserve a usable search field",
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
  /\.shell-nav-panel,[\s\S]{0,120}\.shell-list-panel\s*\{[\s\S]{0,260}height:\s*100dvh/,
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
  /setBrowserNavigationQueue\(\(queue\) => enqueueBrowserNavigation\(queue, request\)\)/,
  "Link opens should survive lazy Browser mounting in the durable navigation queue",
);
assert.match(
  workspace,
  /navigationRequest=\{browserNavigationQueue\[0\] \?\? null\}[\s\S]{0,120}onNavigationConsumed=\{acknowledgeBrowserNavigation\}/,
  "BrowserPane should acknowledge queued links only after accepting the navigation",
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

assert.doesNotMatch(
  workspace,
  /mode === "terminal"[\s\S]*\? "relative"[\s\S]*: "pointer-events-none invisible absolute inset-0 opacity-0"/,
  "The old persistent standalone terminal detail should not render on mobile surfaces",
);

// (ComuxView terminal-toolbar touch pins left with the component, cave-c3yt.)
