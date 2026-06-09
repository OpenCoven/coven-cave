// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");

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

assert.match(
  source,
  /activeFamiliarId\?: string \| null/,
  "Sidebar receives the current familiar scope id",
);

assert.match(
  source,
  /onFamiliarScopeChange: \(id: string \| null\) => void/,
  "Sidebar exposes a nullable familiar scope change callback for the generic Familiars option",
);

assert.match(
  source,
  /<FamiliarScopeSelect[\s\S]*activeFamiliarId=\{activeFamiliarId\}[\s\S]*onFamiliarScopeChange=\{onFamiliarScopeChange\}/,
  "Sidebar top slot renders the familiar scope selector",
);

assert.doesNotMatch(
  source,
  /onOpenSearch|FamiliarSwitcher|sidebar-familiar-switcher|SelectedFamiliarInfo|sidebar-selected-familiar/,
  "Sidebar no longer surfaces the old search, familiar switcher, or selected-familiar card",
);

assert.match(
  source,
  /\{ id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘2" \}/,
  "Chat should move to the ⌘2 Work shortcut after removing Familiars",
);

assert.match(
  source,
  /\{ id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3" \}/,
  "Board should move to the ⌘3 Work shortcut after removing Familiars",
);

assert.match(
  source,
  /\{ id: "library", label: "Library"/,
  "Library remains the sole Knowledge surface",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7" \}/,
  "Browser remains a Tools surface and moves to ⌘7",
);

assert.match(
  source,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8" \}/,
  "Terminal remains a Tools surface and takes ⌘8",
);

assert.match(
  source,
  /\{ id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools" \}/,
  "Roles should appear as a Tools surface",
);

assert.match(
  source,
  /\{ id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools" \}/,
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
  "Schedules row removed — folded into Inbox as a tab",
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

// Tools-group entries include browser, terminal, roles, and capabilities.
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
  /id:\s*"capabilities"[^}]*group:\s*"tools"/,
  "capabilities stays in Tools",
);

// PR #322 wrapped the New Chat ActionRow in .sidebar-new-chat-row so desktop
// CSS could hide it (the FamiliarSwitcher had its own + button to dedupe
// against). PR #304 replaced the switcher with a plain dropdown that has no
// + button, so the New Chat ActionRow is the sole new-chat affordance now —
// no wrapper, no responsive hide.

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
