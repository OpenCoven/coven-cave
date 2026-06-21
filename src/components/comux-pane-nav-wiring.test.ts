// @ts-nocheck
// Locks the comux multi-pane navigation wiring (directional focus, cycle,
// quick-jump, zoom) so a refactor can't silently drop the tmux-grade shortcuts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./comux-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Imports the pure nav helpers.
assert.match(src, /from "@\/lib\/terminal-nav"/, "comux imports the terminal-nav module");
for (const fn of ["directionalNeighbor", "cycleVisibleSession", "paneNumberMap", "sessionAtPaneNumber"]) {
  assert.match(src, new RegExp(`\\b${fn}\\b`), `comux uses ${fn}`);
}

// Directional focus (⌘⌥Arrow) maps each arrow to a PaneDirection.
assert.match(src, /e\.altKey/, "directional nav gated on altKey (⌘⌥)");
for (const [key, dir] of [["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "up"], ["ArrowDown", "down"]]) {
  assert.match(src, new RegExp(`"${key}"\\s*\\?\\s*"${dir}"`), `${key} → ${dir}`);
}
assert.match(src, /directionalNeighbor\(terminalLayout, activeId, dir\)/, "directional focus calls directionalNeighbor");

// Cycle (⌘[ / ⌘]) and quick-jump (⌘1…9).
assert.match(src, /e\.key === "\]" \? 1 : -1/, "⌘] next / ⌘[ prev cycle");
assert.match(src, /cycleVisibleSession\(terminalLayout, activeId,/, "cycle calls cycleVisibleSession");
assert.match(src, /e\.key >= "1" && e\.key <= "9"/, "quick-jump on ⌘1…9");
assert.match(src, /sessionAtPaneNumber\(terminalLayout, Number\(e\.key\)\)/, "quick-jump resolves pane number");

// Zoom: state, ⌘Enter toggle, and the render branch that shows one pane.
assert.match(src, /const \[zoomedSessionId, setZoomedSessionId\] = useState<string \| null>\(null\)/, "zoom state");
assert.match(src, /e\.key === "Enter"[\s\S]{0,160}setZoomedSessionId\(\(z\) => \(z \? null : activeId\)\)/, "⌘Enter toggles zoom");
assert.match(
  src,
  /zoomedSessionId && visiblePaneSessionIds\.includes\(zoomedSessionId\)[\s\S]{0,120}renderTerminalNode\(\{ kind: "leaf", sessionId: zoomedSessionId \}\)/,
  "zoom render shows only the zoomed pane",
);
// Zoom follows focus while navigating.
assert.match(src, /setZoomedSessionId\(\(z\) => \(z \? id : z\)\)/, "zoom follows the focused pane during navigation");

// Pane number badge + zoom/restore button in the pane bar.
assert.match(src, /comux-terminal-pane-num/, "pane number badge rendered");
assert.match(src, /paneNumbers\.get\(s\.id\)/, "badge shows the pane number");
assert.match(src, /aria-label=\{zoomedSessionId === s\.id \? `Restore \$\{s\.label\}` : `Zoom \$\{s\.label\}`\}/, "zoom/restore button labeled");

// Footer advertises the new shortcuts.
assert.match(src, /⌘\[ ⌘\] cycle · ⌘1–9 jump · ⌘⏎ zoom/, "footer hint lists the new shortcuts");

// CSS for the badge exists.
assert.match(css, /\.comux-terminal-pane-num\s*\{/, "pane number badge has styles");

console.log("comux-pane-nav-wiring.test.ts passed");
