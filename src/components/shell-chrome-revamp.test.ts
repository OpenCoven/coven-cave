// @ts-nocheck
// Chat-revamp phase D — app chrome contracts:
//   1. 56px icon rail: primary-surface icon buttons, Dashboard + Settings at
//      the bottom; quiet surfaces remain reachable as icons. (The rail-only
//      brand mark and account avatar that phase D put at either end are gone —
//      see the rail/panel parity assertions below and #4351.)
//   2. 52px-band command bar: "Search or ask <familiar>…" + ⌘K keycap,
//      right cluster = compact running status + notification bell.
//   3. Bottom status bar: session context chips (project/model/branch/cwd) +
//      PR and Tasks chips, mounted under the Home/Chat detail column.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const sidebarCss = readFileSync(new URL("../styles/sidebar-minimal/activity-rail.css", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const statusBar = readFileSync(new URL("./status-bar.tsx", import.meta.url), "utf8");
const statusBarCss = readFileSync(new URL("../styles/status-bar.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const desktopChrome = readFileSync(new URL("../styles/globals/desktop-chrome.css", import.meta.url), "utf8");

// ── 1. Icon rail ─────────────────────────────────────────────────────────────
assert.match(
  sidebar,
  /<nav className="sidebar-minimal" aria-label="Primary">/,
  "the rail/nav is a labelled navigation landmark",
);
// The rail carries no control the expanded panel lacks (#4351): the decorative
// brand mark and the account avatar — whose only action duplicated Settings —
// were rail-only, and between them they displaced the whole rail column against
// its own hover-peek position.
assert.doesNotMatch(sidebar, /sidebar-brand-mark/, "no rail-only brand mark");
assert.doesNotMatch(sidebar, /sidebar-user-avatar/, "no rail-only account avatar");
assert.doesNotMatch(sidebarCss, /^\.shell-nav--rail \.sidebar-brand-mark/m, "no brand-mark rail styling");
assert.doesNotMatch(sidebarCss, /^\.shell-nav--rail \.sidebar-user-avatar/m, "no account-avatar rail styling");
// Control geometry comes from the shared --rail-control constant, so the rail
// square and the panel row are the same box (see shell-navigation.css).
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-folder-row,\n\.shell-nav--rail \.sidebar-action-row,\n\.shell-nav--rail \.sidebar-foot-btn,\n\.shell-nav--rail \.sidebar-foot-icon-btn \{[\s\S]{0,400}?width: var\(--rail-control\);\s*\n\s*height: var\(--rail-control\);/,
  "rail controls are --rail-control squares",
);
// margin-inline, NOT the margin shorthand: the shorthand also zeroed
// margin-top and silently ate the quiet cluster's leading gap in the rail.
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-folder-row,\n[\s\S]{0,400}?margin-inline: auto;/,
  "rail controls centre with margin-inline so the quiet-lead gap survives",
);
// Dashboard stays reachable in the rail and follows the footer's DOM order, so
// its icon sits directly above Settings in the rail's vertical footer stack.
assert.doesNotMatch(
  sidebarCss,
  /\.shell-nav--rail a\.sidebar-foot-btn\[href="\/dashboard"\] \{\s*\n\s*display: none;/,
  "Dashboard remains visible above Settings in the rail footer",
);
assert.doesNotMatch(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-folder-row--quiet[\s\S]{0,100}display: none;/,
  "quiet sidebar destinations retain rail icons, including Memories, Marketplace, and GitHub",
);
// Settings stays reachable from the rail through the shared footer, which is
// the last thing in the nav in both states.
assert.match(
  sidebar,
  /<SidebarFooter onOpenSettings=\{onOpenSettings\} \/>\s*<\/nav>/,
  "the shared footer closes the sidebar in both the rail and the panel",
);

// ── 2. Top command bar ───────────────────────────────────────────────────────
assert.doesNotMatch(
  menuBar,
  /searchTarget|activeFamiliarName/,
  "the fixed Cave search placeholder should not retain an unused familiar-name target",
);
assert.match(
  menuBar,
  /placeholder="Search Cave\.\.\."/,
  'the field reads "Search Cave…" so it does not compete with the Nova composer',
);
assert.match(
  menuBar,
  /<div className="menu-bar__group menu-bar__group--status">\s*\{runningStatus\}\s*\{bell\}\s*<\/div>/,
  "the right cluster hosts the running-processes slot before the bell slot",
);
assert.doesNotMatch(
  menuBar,
  /className="menu-bar__running"/,
  "the right cluster no longer uses the old running pill",
);
assert.doesNotMatch(
  menuBar,
  /menu-bar__running-dot/,
  "the right cluster no longer uses the old running dot",
);
// Detailed waveform trigger, badge, zero-hide, popover, and accessibility
// contracts live in running-sessions-popover.test.ts. This suite keeps only
// the shell-level wiring.
assert.match(
  workspace,
  /const runningSessions = useMemo\(\s*\n\s*\(\) => sessions\.filter\(\(s\) => !s\.archived_at && sessionStatusTone\(s\.status\) === "running"\),\s*\n\s*\[sessions\],\s*\n\s*\);/,
  "runningSessions derives from sessionStatusTone over the live sessions list",
);
assert.match(
  workspace,
  /<FamiliarMenuBar\s*\n\s*activeFamiliarId=\{activeId\}[\s\S]{0,400}?<RunningSessionsPopover\s*\n\s*sessions=\{runningSessions\}/,
  "the menu bar receives the active familiar id and the running-processes popover",
);
assert.match(
  workspace,
  /bell=\{\s*\n\s*<NotificationBell\s*\n\s*items=\{inboxItemsWithEphemeral\}[\s\S]{0,700}?badgeCount=\{notificationUnreadCount\}/,
  "the desktop bell lists the same items and unread count as the mobile bell",
);
// The bell popover must not be clipped by the slim band.
assert.match(
  desktopChrome,
  /\.shell-top \{[^}]*overflow: visible;/,
  "shell-top no longer clips (the bell popover hangs below the band)",
);
assert.match(
  desktopChrome,
  /\.shell-top:has\(\.notification-bell__popover\) \{[^}]*z-index: 140;/,
  "an open notification dropdown lifts its title-bar stacking context above shell content",
);

// ── 3. Bottom status bar ─────────────────────────────────────────────────────
assert.match(
  statusBar,
  /<footer className="status-bar" aria-label="Workspace status">/,
  "the status bar is a labelled footer landmark",
);
// Display-only chips are spans (no chevron, no pointer); actions are buttons.
assert.match(
  statusBar,
  /function InfoChip[\s\S]{0,400}?<span className="status-bar__chip"/,
  "context chips are non-interactive spans",
);
assert.doesNotMatch(
  statusBar,
  /status-bar__chip"[^>]*onClick/,
  "non-interactive chips carry no click handler",
);
assert.match(
  statusBar,
  /className="status-bar__chip status-bar__chip--action status-bar__chip--tasks focus-ring"\s*\n\s*onClick=\{onViewTasks\}/,
  "the Tasks chip is a real button",
);
assert.match(
  statusBar,
  /onClick=\{\(\) => onOpenPr\(pr\.url\)\}/,
  "the PR chip opens the PR when a handler is wired",
);
assert.match(
  statusBarCss,
  /\.status-bar \{[\s\S]{0,400}?border-top: 1px solid var\(--border-hairline\);\s*\n\s*background: var\(--bg-panel\);/,
  "the strip is a hairline-topped panel band (semantic tokens)",
);
assert.doesNotMatch(
  statusBarCss,
  /#[0-9a-fA-F]{3,8}\b/,
  "status-bar.css uses semantic tokens only — no raw hex colors",
);
assert.match(
  statusBarCss,
  /\.status-bar__chip--action \{[\s\S]{0,200}?cursor: pointer;/,
  "only action chips take the pointer cursor",
);
assert.match(
  globals,
  /@import "\.\.\/styles\/status-bar\.css";/,
  "status-bar.css is imported app-wide (shell-level chrome)",
);
// Workspace wiring: session-scoped data on chat, graceful home fallback,
// mounted as a flex sibling under the detail content, hidden behind the gate.
assert.match(
  workspace,
  /const statusSession =\s*\n\s*mode === "chat" && statusSessionId\s*\n\s*\? sessions\.find\(\(s\) => s\.id === statusSessionId\) \?\? null\s*\n\s*: null;/,
  "session chips are scoped to chat mode's active session",
);
assert.match(
  workspace,
  /branch=\{statusSession \? statusSession\.workBranch \?\? statusSession\.git\?\.branch \?\? null : null\}/,
  "the branch chip prefers the per-session workBranch over the poll-time checkout branch",
);
assert.match(
  workspace,
  /const statusPr = sessionPrStatus\(statusSession\?\.pullRequest\);/,
  "the PR chip derives from the shared sessionPrStatus mapping",
);
assert.match(
  workspace,
  /normalizeProjectRoot\(p\.root\) === normalizeProjectRoot\(statusSession\.project_root\)/,
  "the project chip resolves the registered project by normalized root",
);
assert.match(
  workspace,
  /mode === "home" \|\| mode === "chat" \? \(\s*\n\s*<StatusBar/,
  "the strip renders only on Home and Chat",
);
assert.match(
  workspace,
  /taskCount=\{boardTaskCount\}\s*\n\s*onViewTasks=\{\(\) => setMode\("board"\)\}\s*\n\s*onOpenPr=\{\(url\) => openUrlInApp\(url\)\}/,
  "Tasks jumps to the board and the PR chip opens in-app",
);
assert.match(
  workspace,
  /\{detailContent\}\s*<\/div>[\s\S]{0,400}?\{firstProjectGateOpen \? null : statusBar\}/,
  "the strip mounts under the detail content and hides while the first-project gate is up",
);

console.log("shell-chrome-revamp.test.ts: ok");
