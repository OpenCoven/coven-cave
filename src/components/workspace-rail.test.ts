// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./workspace-rail.tsx", import.meta.url), "utf8");

assert.match(src, /export function WorkspaceRail\(/, "exports WorkspaceRail");
assert.match(src, /className=\{`workspace-rail\$\{isFullscreen \? " workspace-rail--fullscreen" : ""\}`\}/, "root class includes fullscreen modifier state");
assert.match(src, /aria-label="Code rail"/, "labels the rail region");
for (const t of ["Changes", "Files", "Terminal"]) {
  assert.match(src, new RegExp(`aria-label="${t}"`), `has a ${t} tab`);
}
assert.match(src, /SessionChangesPanel/, "Changes tab reuses SessionChangesPanel");
// Files tab renders the composed tree + inline-editable file preview panel.
assert.match(src, /RailFilesPanel/, "Files tab renders RailFilesPanel");
assert.match(src, /activeTab === "files"/, "Files tab is branched on explicitly");
assert.match(src, /projectRoot=\{projectRoot\}/, "threads projectRoot into the files panel");
// Terminal tab hosts RailTerminalPanel, mounted lazily (pty must not start early)
// and kept mounted thereafter (keepalive) — gated behind terminalEverOpened.
assert.match(src, /RailTerminalPanel/, "Terminal tab renders RailTerminalPanel");
assert.match(src, /isFullscreen,\s*setIsFullscreen/, "rail tracks fullscreen expansion state");
assert.match(src, /aria-label=\{isFullscreen \? "Exit code rail fullscreen" : "Expand code rail fullscreen"\}/, "rail exposes a fullscreen toggle");
assert.match(src, /isFullscreen && \(\s*<button[\s\S]*?aria-label="Terminal"/, "Terminal tab is only available while the rail is fullscreen");
assert.match(src, /terminalEverOpened && isFullscreen/, "terminal host is gated behind fullscreen expansion");
assert.match(src, /terminalEverOpened/, "lazy gate: terminal not mounted until first opened");
assert.match(src, /setTerminalEverOpened\(true\)/, "flips the lazy gate once the Terminal tab opens");
assert.match(src, /workspace-rail__terminal/, "terminal wrapper class for keepalive hide/show");
assert.match(src, /sessionId=\{sessionId\}/, "threads the session id into the terminal host");
assert.doesNotMatch(src, /workspace-rail__soon/, "Terminal placeholder is gone");
assert.match(src, /onTogglePin/, "pin control wired");
assert.match(src, /onCollapse/, "collapse control wired");
assert.match(src, /changeCount > 0/, "shows a change-count badge");
// Progressive disclosure (§8): pin + fullscreen reveal on header hover /
// focus-within via the shared utility; collapse stays always visible.
assert.match(src, /workspace-rail__head reveal-scope/, "rail header is the reveal scope");
assert.match(
  src,
  /focus-ring reveal-on-hover\$\{pinned \? " is-on" : ""\}/,
  "pin reveals on hover/focus (and stays visible while pinned via aria-pressed)",
);
assert.match(
  src,
  /focus-ring reveal-on-hover\$\{isFullscreen \? " is-on" : ""\}/,
  "fullscreen toggle reveals on hover/focus",
);
assert.doesNotMatch(
  src,
  /aria-label="Collapse code rail"[\s\S]{0,120}reveal-on-hover|reveal-on-hover[^\n]*aria-label="Collapse code rail"/,
  "collapse stays always visible (primary verb)",
);
console.log("workspace-rail.test.ts OK");
