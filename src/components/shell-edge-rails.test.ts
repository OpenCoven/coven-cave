// @ts-nocheck
// Closed side panels must stay discoverable and read as pressable:
//   - when the nav is collapsed, a left-edge rail (mirroring the right-edge
//     agent trigger rail) is the floating reopen affordance; while the nav is
//     open the in-panel top toggle owns collapsing, so the rail stays hidden
//   - edge-rail toggles render a visible button chip instead of an
//     invisible-until-hover icon
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const projectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

// Codex-style floating panel toggles: two always-visible rounded buttons
// pinned to the shell's top corners (left = nav sidebar, right = active side
// panel) replace the old collapsed-only left edge rail.
assert.match(
  shell,
  /const panelFloats = !isMobile/,
  "shell builds the floating panel toggles on desktop only",
);
assert.match(
  shell,
  /shell-panel-float shell-panel-float--left/,
  "shell renders a floating left toggle for the nav sidebar",
);
assert.match(
  shell,
  /shell-panel-float--right/,
  "shell renders a floating right toggle for the active side panel",
);
assert.match(
  shell,
  /shell-panel-float--left[\s\S]*?aria-label=\{navOpen \? "Hide navigation" : "Show navigation"\}/,
  "left float label reflects nav state",
);
assert.match(
  shell,
  /shell-panel-float--left[\s\S]*?aria-expanded=\{navOpen\}/,
  "left float exposes nav expanded state",
);
assert.match(
  shell,
  /shell-panel-float--left[\s\S]*?navOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/,
  "left float icon reflects nav state",
);
assert.match(
  shell,
  /const toggleNavPanel = \(\) => \{[\s\S]*?panel\.expand\(\); setNavOpen\(true\)[\s\S]*?panel\.collapse\(\); setNavOpen\(false\)/,
  "left float collapses and expands the nav panel",
);
assert.match(
  shell,
  /shell-panel-float--right[\s\S]*?aria-expanded=\{familiarOpen\}/,
  "right float exposes the active side-panel state",
);
assert.match(
  shell,
  /const toggleRightPanel = \(\) => \{[\s\S]*?familiarRef\.current[\s\S]*?setFamiliarOpen/,
  "right float toggles the active right panel via familiarRef",
);
// Floats are always visible (open or closed) — the old collapsed-only left
// edge rail is gone.
assert.doesNotMatch(
  shell,
  /familiar-trigger-rail--left/,
  "the old collapsed-only left edge rail is removed from the shell",
);

assert.match(
  css,
  /\.familiar-trigger-rail--left \{[^}]*border-right: 1px solid var\(--border-hairline\)/,
  "left rail variant flips the hairline to its right edge",
);
assert.match(
  css,
  /\.familiar-trigger-rail \{[^}]*width: 26px;[^}]*flex: 0 0 26px;/,
  "edge trigger rails should be wide enough to read as intentional controls",
);
assert.match(
  css,
  /\.familiar-trigger-rail::before \{[^}]*width: 1px;[^}]*background: color-mix\(in oklch, var\(--accent\) 52%, transparent\)/,
  "edge trigger rails should carry a subtle accent guide line",
);
assert.match(css, /\.edge-rail-chip \{/, "edge-rail chip class exists");
assert.match(
  css,
  /\.edge-rail-chip \{[^}]*width: 20px;[^}]*box-shadow:/,
  "edge-rail chip should be visibly pressable without feeling bulky",
);
assert.match(
  css,
  /\.familiar-trigger-rail__toggle\[aria-expanded="true"\] > \.edge-rail-chip/,
  "expanded side-panel triggers should have an active chip treatment",
);
assert.doesNotMatch(
  css,
  /\.familiar-trigger-rail__toggle \{[^}]*opacity: 0/,
  "edge-rail toggles must be visible without hovering",
);
assert.match(
  css,
  /button:active > \.edge-rail-chip/,
  "edge-rail chip has a pressed state",
);

assert.match(
  workspace,
  /edge-rail-chip[\s\S]{0,80}ph:cat/,
  "right agent rail toggle renders its icon inside the pressable chip",
);
// The right rail is Salem-only — the browser globe tab was retired; the
// Browser surface is still reachable via the nav (⌘7).
assert.doesNotMatch(
  workspace,
  /familiar-trigger-rail__toggle[\s\S]{0,160}ph:globe/,
  "right agent rail no longer exposes the browser globe tab",
);
assert.match(
  css,
  /\.familiar-trigger-rail--stacked \{[^}]*justify-content: stretch;/,
  "right edge stacked tabs stretch to fill the rail height",
);
assert.match(
  css,
  /\.familiar-trigger-rail--stacked \.familiar-trigger-rail__toggle \{[^}]*flex: 1 1 0;/,
  "stacked rail toggles each fill half the rail (50/50 split)",
);
assert.match(
  projectSidebar,
  /edge-rail-chip[\s\S]{0,120}ph:sidebar-simple/,
  "collapsed projects sidebar reopen tab uses the pressable chip",
);

assert.match(
  shell,
  /import \{[\s\S]*getPanelShortcutBindings[\s\S]*matchesPanelShortcut[\s\S]*\} from "@\/lib\/panel-shortcuts"/,
  "shell uses the shared, overrideable panel shortcut matcher",
);
assert.match(
  shell,
  /panelShortcutOverrides\?: Partial<PanelShortcutBindings>/,
  "Shell accepts shortcut overrides instead of hard-coding panel chords",
);
assert.match(
  shell,
  /matchesPanelShortcut\(e, panelShortcuts\.toggleLeftPanel\)[\s\S]*togglePanel\(navRef\.current\)/,
  "left panel toggles from the resolved left-panel shortcut",
);
assert.match(
  shell,
  /matchesPanelShortcut\(e, panelShortcuts\.toggleRightPanel\)[\s\S]*hasFamiliar[\s\S]*toggleFamiliarPanel\(\)/,
  "right panel toggles from the resolved right-panel shortcut",
);
assert.doesNotMatch(
  shell,
  /key === "b"[\s\S]{0,120}togglePanel\(navRef\.current\)/,
  "Shift+B must not fall through to the left sidebar toggle",
);
assert.match(shortcuts, /keys: "⌘B"[\s\S]*Toggle the left sidebar/, "shortcut sheet documents the default left panel toggle");
assert.match(shortcuts, /keys: "⌘⇧B"[\s\S]*Toggle the right side panel/, "shortcut sheet documents the default right panel toggle");

// The CompanionRail's in-panel Hide button (mirror of the left rail) dispatches
// cave:familiar-panel-toggle; the Shell listens for it and reuses the ⌘⇧B path.
assert.match(
  shell,
  /addEventListener\("cave:familiar-panel-toggle", familiarPanelToggle\)/,
  "Shell listens for the CompanionRail in-panel collapse event",
);
assert.match(
  shell,
  /removeEventListener\("cave:familiar-panel-toggle", familiarPanelToggle\)/,
  "Shell cleans up the familiar-panel-toggle listener",
);
assert.match(css, /\.companion-rail__collapse/, "globals.css styles the in-panel collapse button");

console.log("shell-edge-rails.test.ts OK");
