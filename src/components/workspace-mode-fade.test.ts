// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Workspace detail stability + no-terminal-subtree pins. Formerly part of
// comux-view-terminal.test.ts; the ComuxView host was deleted (cave-c3yt) and
// these live workspace pins moved here.

const workspace = readFileSync(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);
const primitives = readFileSync(
  new URL("../styles/globals/primitives.css", import.meta.url),
  "utf8",
);

assert.doesNotMatch(workspace, /const terminalDetail|view="terminal"|mode === "terminal"/, "Workspace should not create a standalone terminal subtree");
assert.doesNotMatch(
  workspace,
  /<div key=\{mode\} className="cave-mode-fade/,
  "Workspace detail must not force a full remount on every surface switch",
);
assert.match(
  workspace,
  /className="cave-mode-fade relative h-full min-h-0 flex flex-col overflow-hidden"/,
  "Workspace keeps the stable detail wrapper required by shell layout selectors",
);
assert.match(
  workspace,
  /const detailContent = renderSurface\(mode\);[\s\S]*?\{detailContent\}/,
  "surface content swaps inside the persistent detail wrapper",
);
assert.doesNotMatch(
  workspace,
  /detailFadeRef|modeFadeAnimRef|modeFadeReadyRef/,
  "surface switches must not drive the whole detail pane through opacity zero",
);
assert.doesNotMatch(
  workspace,
  /\.animate\(\s*\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/,
  "Workspace must not replay a blank-to-visible full-pane animation",
);
assert.doesNotMatch(
  primitives,
  /@keyframes\s+cave-mode-in|\.cave-mode-fade\s*\{[\s\S]*?(?:animation|opacity|transform)\s*:/,
  ".cave-mode-fade must stay continuously visible and must not become a containing block",
);

console.log("workspace-mode-fade.test.ts: ok");
