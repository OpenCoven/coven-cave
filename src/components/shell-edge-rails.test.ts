// @ts-nocheck
// Side panel toggles live in the desktop top menu bar:
//   - the nav toggle anchors the bar's left edge
//   - the side-panel + expand toggles its right edge
//   - they share the bar's height/background so they read as one strip
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const projectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

// The panel toggles are hoisted into the top bar (a flex row wrapping the
// rendered top bar), desktop-only — they're built only when !isMobile.
assert.match(
  shell,
  /const navToggle = !isMobile/,
  "shell builds the nav toggle on desktop only",
);
assert.match(
  shell,
  /const rightToggles = !isMobile && hasFamiliar/,
  "shell builds the right side-panel toggles on desktop only, when a familiar is active",
);
assert.match(
  shell,
  /<div className="shell-top">[\s\S]*?\{navToggle\}[\s\S]*?<div className="shell-top__bar">\{renderedTopBar\}<\/div>[\s\S]*?\{rightToggles\}/,
  "the top bar row flanks the rendered top bar with the nav (left) and side-panel (right) toggles",
);
assert.match(
  shell,
  /shell-top-toggle shell-top-toggle--nav/,
  "shell renders a top-bar nav toggle for the sidebar",
);
assert.match(
  shell,
  /shell-top-toggle--right/,
  "shell renders a top-bar right toggle for the active side panel",
);
assert.match(
  shell,
  /shell-top-toggle--nav[\s\S]*?aria-label=\{navOpen \? "Hide navigation" : "Show navigation"\}/,
  "nav toggle label reflects nav state",
);
assert.match(
  shell,
  /shell-top-toggle--nav[\s\S]*?aria-expanded=\{navOpen\}/,
  "nav toggle exposes nav expanded state",
);
assert.match(
  shell,
  /shell-top-toggle--nav[\s\S]*?navOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/,
  "nav toggle icon reflects nav state",
);
assert.match(
  shell,
  /const toggleNavPanel = \(\) => \{[\s\S]*?panel\.expand\(\); setNavOpen\(true\)[\s\S]*?panel\.collapse\(\); setNavOpen\(false\)/,
  "nav toggle collapses and expands the nav panel",
);
assert.match(
  shell,
  /shell-top-toggle--right[\s\S]*?aria-expanded=\{familiarOpen\}/,
  "right toggle exposes the active side-panel state",
);
assert.match(
  shell,
  /const toggleRightPanel = \(\) => \{[\s\S]*?familiarRef\.current[\s\S]*?setFamiliarOpen/,
  "right toggle toggles the active right panel via familiarRef",
);
// The old collapsed-only left edge rail and full-height corner floats are gone.
assert.doesNotMatch(
  shell,
  /familiar-trigger-rail--left/,
  "the old collapsed-only left edge rail is removed from the shell",
);
assert.doesNotMatch(
  shell,
  /shell-panel-float/,
  "the old absolutely-positioned corner floats are removed from the shell",
);

// The toggles share the menu bar's 44px height + panel background so they read
// as one continuous strip, and tint accent in their open state.
assert.match(
  css,
  /\.shell-top\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*stretch;/,
  "the top bar row is a stretch flex container",
);
assert.match(
  css,
  /\.shell-top__bar\s*\{[\s\S]*?flex:\s*1 1 auto;/,
  "the rendered top bar flexes to fill between the toggles",
);
assert.match(
  css,
  /\.shell-top-toggle\s*\{[\s\S]*?height:\s*44px;[\s\S]*?border-bottom:\s*1px solid var\(--border-hairline\);[\s\S]*?background:\s*var\(--bg-panel\);/,
  "top-bar toggles match the menu bar's height, hairline and panel background",
);
assert.match(
  css,
  /\.shell-top-toggle--active\s*\{[\s\S]*?color:\s*var\(--accent-presence\);/,
  "an open panel's toggle tints accent",
);
assert.match(
  css,
  /\.shell-top-toggle--right > svg\s*\{[\s\S]*?transform:\s*scaleX\(-1\);/,
  "the right toggle mirrors the sidebar glyph so it reads as a right-edge panel",
);

// The float is gone — no proximity-glow tracking or --shell-float-top plumbing.
assert.doesNotMatch(
  shell,
  /--float-prox/,
  "shell no longer tracks cursor proximity for the floats",
);
assert.doesNotMatch(
  css,
  /shell-panel-float/,
  "the float CSS is pruned",
);

// The edge-rail chip survives — the collapsed chat-projects strip still uses it
// for its reopen tab.
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

// The right edge-rail tab toggle was retired — the top-bar right toggle now owns
// showing/hiding the companion panel.
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
// cave:familiar-panel-toggle bridge — the top-bar right toggle (and ⌘⇧B) own
// hiding the right panel now.
assert.doesNotMatch(
  shell,
  /cave:familiar-panel-toggle/,
  "Shell no longer wires the retired in-panel collapse event",
);

console.log("shell-edge-rails.test.ts OK");
