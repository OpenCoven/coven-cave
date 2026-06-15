// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const mobileTabs = await readFile(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const notificationBell = await readFile(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const bottomTerminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const browserPane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
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
  /{ id: "inbox", label: "Inbox", ariaLabel: "Inbox and automations", iconName: "ph:tray" }/,
  "Mobile bottom tabs should keep labels short while preserving the full Inbox/Automations accessible name",
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
  notificationBell,
  /notification-bell__trigger/,
  "Notification bell should expose a stable hook for mobile hit-area sizing",
);

assert.match(
  globals,
  /@media \(max-width: 1023px\) \{[\s\S]*\.top-bar__actions \.notification-bell__trigger,[\s\S]*\.top-bar__account\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile top-bar notification and account buttons should meet the 44px touch target",
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

assert.match(
  workspace,
  /railTab === "browser" \|\| railTab === "salem" \|\| \(mode !== "browser" && mode !== "agents"\)/,
  "Browser and Agents modes suppress the default companion pane unless a floating Browser or Salem tab is selected",
);
assert.match(
  workspace,
  /familiarPanelRail=\{showCompanionRail \? \(/,
  "Browser and Agents modes should suppress the desktop companion trigger rail unless a floating rail tab is selected",
);
