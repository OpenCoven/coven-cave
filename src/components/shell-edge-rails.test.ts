// @ts-nocheck
// The nav toggle lives in the desktop top menu bar, anchoring the bar's left
// edge and matching the row's compact icon-button controls. (The right
// side-panel + expand toggles were removed with the right companion panel.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const projectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

assert.match(
  shell,
  /import \{ Icon, CAVE_ICON_SIZE, type IconName \} from "@\/lib\/icon"/,
  "Shell should import the shared icon size constants with the Icon wrapper",
);

assert.doesNotMatch(
  shell,
  /<Icon[\s\S]{0,140}width=\{?(?:14|15|20|28|36|40)\}?/,
  "Shell panel chrome icons should use CAVE_ICON_SIZE instead of raw pixel widths",
);

// The panel toggles are hoisted into the top bar (a flex row wrapping the
// rendered top bar), desktop-only — they're built only when !isMobile.
assert.match(
  shell,
  /const navToggle = !isMobile/,
  "shell builds the nav toggle on desktop only",
);
assert.match(
  shell,
  /<div className="shell-top" data-tauri-drag-region="">[\s\S]*?\{navToggle\}[\s\S]*?<div className="shell-top__bar" data-tauri-drag-region="">\{renderedTopBar\}<\/div>/,
  "the top bar row leads with the nav toggle before the rendered top bar",
);
assert.equal(
  shell.match(/<div className="shell-top" data-tauri-drag-region="">/g)?.length,
  2,
  "both shell top bars should expose the Tauri drag region on the titlebar container",
);
assert.equal(
  shell.match(/<div className="shell-top__bar" data-tauri-drag-region="">/g)?.length,
  2,
  "both rendered top-bar wrappers should remain draggable when their empty chrome is clicked",
);
assert.match(
  shell,
  /<div className="shell-titlebar-drag-lane" data-tauri-drag-region="" aria-hidden="true" \/>\s*\{navToggle\}/,
  "the desktop top bar should expose a dedicated non-interactive drag lane before its controls",
);
assert.match(
  shell,
  /shell-top-toggle shell-top-toggle--nav/,
  "shell renders a top-bar nav toggle for the sidebar",
);
assert.match(
  shell,
  /shell-top-toggle--nav[\s\S]*?aria-label=\{navOpen \? "Collapse navigation to icons" : "Expand navigation"\}/,
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

// The shell row owns the band chrome; the toggles render as compact bordered
// icon buttons matching the other controls in the row.
assert.match(
  css,
  /\.shell-top\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?min-height:\s*44px;[\s\S]*?border-bottom:\s*1px solid var\(--border-hairline\);/,
  "the top bar row owns the shared band background and centers its controls",
);
assert.match(
  css,
  /\.shell-top__bar\s*\{[\s\S]*?flex:\s*1 1 auto;/,
  "the rendered top bar flexes to fill between the toggles",
);
assert.match(
  css,
  /\.shell-titlebar-drag-lane\s*\{[\s\S]*?display:\s*none;/,
  "the drag lane should be hidden outside the macOS Tauri titlebar mode",
);
assert.match(
  css,
  /:root\[data-tauri-titlebar\]\s+\.shell-titlebar-drag-lane\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?height:\s*10px;[\s\S]*?-webkit-app-region:\s*drag;[\s\S]*?app-region:\s*drag;/,
  "macOS Tauri titlebar mode should expose a fixed-height draggable lane above the controls",
);
assert.match(
  css,
  /:root\[data-tauri-titlebar\]\s+:is\(\s*\.shell-top,\s*\.shell-top__bar,\s*\.shell-top \.menu-bar,\s*\.shell-top \.top-bar,\s*\.shell-top \.menu-bar__group,\s*\.shell-top \.top-bar__lead,\s*\.shell-top \.top-bar__actions\s*\)\s*\{[\s\S]*?-webkit-app-region:\s*drag;[\s\S]*?app-region:\s*drag;/,
  "macOS Tauri titlebar mode should keep the full rendered top-bar band draggable, including inert layout wrappers",
);
assert.doesNotMatch(
  css,
  /:root\[data-tauri-titlebar\]\s+\.shell-top \*\s*\{[\s\S]*?app-region:\s*no-drag;/,
  "macOS titlebar mode must not carve every header descendant out of the drag region",
);
assert.match(
  css,
  /:root\[data-tauri-titlebar\]\s+\.shell-top :is\(\s*button,\s*a,\s*input,\s*select,\s*textarea,\s*kbd,\s*label,[\s\S]*?\[role="button"\],[\s\S]*?\[role="textbox"\],[\s\S]*?\[contenteditable\],[\s\S]*?\.menu-bar__search\s*\),[\s\S]*?-webkit-app-region:\s*no-drag;[\s\S]*?app-region:\s*no-drag;/,
  "macOS titlebar mode should carve only interactive header controls out of the drag region so controls stay clickable",
);
assert.match(
  css,
  /\.shell-top\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow:\s*hidden;/,
  "the desktop shell header should stay one row and clip/contain crowded content instead of wrapping over controls",
);
assert.match(
  css,
  /\.menu-bar\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?overflow:\s*hidden;/,
  "the rendered desktop menu bar should shrink inside the shell header on macOS/Windows/Linux",
);
assert.match(
  css,
  /\.shell-top-toggle\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;[\s\S]*?border:\s*1px solid var\(--border-hairline\);[\s\S]*?background:\s*var\(--bg-base\);/,
  "top-bar toggles match the row's compact bordered icon buttons",
);
assert.match(
  css,
  /\.shell-top-toggle--active\s*\{[\s\S]*?color:\s*var\(--accent-presence\);[\s\S]*?border-color:\s*color-mix\(in oklch, var\(--accent-presence\) 55%, var\(--border-hairline\)\);/,
  "an open panel's toggle tints accent while staying button-shaped",
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
assert.doesNotMatch(
  shell,
  /key === "b"[\s\S]{0,120}togglePanel\(navRef\.current\)/,
  "Shift+B must not fall through to the left sidebar toggle",
);
assert.match(shortcuts, /keys: "⌘B"[\s\S]*Toggle the left sidebar/, "shortcut sheet documents the default left panel toggle");

// The right companion panel (and its in-panel collapse bridge) was removed.
assert.doesNotMatch(
  shell,
  /cave:familiar-panel-toggle/,
  "Shell no longer wires the retired in-panel collapse event",
);

console.log("shell-edge-rails.test.ts OK");
