// @ts-nocheck
// Side panels must stay discoverable without visual chrome noise:
//   - desktop shell owns a left and right full-height edge strip
//   - the strips are clickable across their full height
//   - the aligned chip/icon stays invisible until hover or keyboard focus
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const projectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

// Codex-style side panel toggles: two full-height invisible edge strips
// (left = nav sidebar, right = active side panel) replace the old
// collapsed-only left edge rail.
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
  /\.shell-panel-float\s*\{[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?width:\s*44px;[\s\S]*?height:\s*100%;[\s\S]*?background:\s*transparent;/,
  "left/right panel toggles should be full-height invisible edge strips",
);
assert.match(
  css,
  /\.shell-panel-float::before\s*\{[\s\S]*?top:\s*var\(--shell-float-top,\s*50px\);[\s\S]*?opacity:\s*0;/,
  "panel toggle chip should share the measured top and stay hidden by default",
);
assert.match(
  css,
  /\.shell-panel-float > svg\s*\{[\s\S]*?top:\s*calc\(var\(--shell-float-top,\s*50px\) \+ 6\.5px\);[\s\S]*?opacity:\s*0;/,
  "panel toggle icon should share the same measured top and stay hidden by default",
);
assert.match(
  css,
  /\.shell-panel-float:hover::before,[\s\S]*?\.shell-panel-float:focus-visible::before,[\s\S]*?\.shell-panel-float:hover > svg,[\s\S]*?\.shell-panel-float:focus-visible > svg\s*\{[\s\S]*?opacity:\s*1;/,
  "panel toggle chip and icon should reveal on hover or keyboard focus",
);
assert.match(css, /\.shell-panel-float--left\s*\{[\s\S]*?left:\s*0;/, "left strip is pinned to the left edge");
assert.match(css, /\.shell-panel-float--right\s*\{[\s\S]*?right:\s*0;/, "right strip is pinned to the right edge");

// The edge-rail chip survives — the collapsed chat-projects strip still uses it
// for its reopen tab. The familiar trigger-rail CSS that used to share it was
// pruned along with the rails themselves.
assert.match(css, /\.edge-rail-chip \{/, "edge-rail chip class exists");
assert.match(
  css,
  /\.edge-rail-chip \{[^}]*width: 20px;[^}]*box-shadow:/,
  "edge-rail chip should be visibly pressable without feeling bulky",
);
assert.match(
  css,
  /button:active > \.edge-rail-chip/,
  "edge-rail chip has a pressed state",
);
assert.doesNotMatch(
  css,
  /familiar-trigger-rail/,
  "the dead familiar trigger-rail CSS is pruned",
);

// The right edge-rail tab toggle was retired — the shell's floating top-right
// toggle now owns showing/hiding the companion panel.
assert.doesNotMatch(
  workspace,
  /familiarPanelRail=/,
  "workspace no longer passes a right edge-rail tab toggle to the shell",
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

// The CompanionRail's in-panel Hide button was removed along with its
// cave:familiar-panel-toggle bridge — the floating top-right toggle (and ⌘⇧B)
// own hiding the right panel now.
assert.doesNotMatch(
  shell,
  /cave:familiar-panel-toggle/,
  "Shell no longer wires the retired in-panel collapse event",
);

// Proximity glow: floats fade in (and pulse) as the cursor approaches. shell.tsx
// tracks mousemove distance and sets --float-prox per float; the CSS drives the
// chip opacity + the pulse halo from it.
assert.match(shell, /addEventListener\("mousemove"/, "shell listens for mousemove to track cursor proximity");
assert.match(
  shell,
  /setProperty\("--float-prox"/,
  "shell sets a per-float --float-prox from cursor distance",
);
assert.match(
  css,
  /\.shell-panel-float::before \{[\s\S]*?opacity: var\(--float-prox, 0\)/,
  "the float chip fades in by cursor proximity",
);
assert.match(
  css,
  /@keyframes shell-float-pulse \{[\s\S]*?var\(--float-prox, 0\)/,
  "the proximity halo pulses with intensity gated by --float-prox",
);

console.log("shell-edge-rails.test.ts OK");
