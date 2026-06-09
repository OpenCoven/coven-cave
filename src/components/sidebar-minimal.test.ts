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

assert.match(
  source,
  /\{ id: "chat", label: "Chat"/,
  "Agents renamed to Chat",
);

assert.match(
  source,
  /\{ id: "board", label: "Board"/,
  "Tasks renamed to Board",
);

assert.match(
  source,
  /\{ id: "library", label: "Library"/,
  "Library remains the sole Knowledge surface",
);

assert.match(
  source,
  /\{ id: "browser", label: "Browser"/,
  "Browser remains a Tools surface",
);

assert.match(
  source,
  /\{ id: "terminal", label: "Terminal"/,
  "Terminal remains a Tools surface",
);

// NOTE: assertion updated by shell-ia-lastmile S1 — Capabilities removed from sidebar per 2026-06-08 spec.
assert.doesNotMatch(
  source,
  /\{ id: "capabilities", label: "Capabilities"/,
  "Capabilities is no longer a sidebar entry (removed per 2026-06-08 Shell IA spec)",
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

// S1 shell-ia-lastmile: roles + capabilities removed from sidebar entries.
assert.doesNotMatch(
  source,
  /\{[^}]*id:\s*"roles"[^}]*\}/,
  "roles is not a sidebar entry",
);

assert.doesNotMatch(
  source,
  /\{[^}]*id:\s*"capabilities"[^}]*\}/,
  "capabilities is not a sidebar entry",
);

// S1: surviving Tools-group entries still include browser + terminal.
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

console.log("sidebar-minimal.test.ts (shell-ia-lastmile) OK");
