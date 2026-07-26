// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Workspace mode-transition crossfade + no-terminal-subtree pins. Formerly
// part of comux-view-terminal.test.ts; the ComuxView host was deleted
// (cave-c3yt) and these live workspace pins moved here — this behavior has
// silently regressed TWICE, keep it pinned.

const workspace = readFileSync(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(workspace, /const terminalDetail|view="terminal"|mode === "terminal"/, "Workspace should not create a standalone terminal subtree");
assert.doesNotMatch(
  workspace,
  /<div key=\{mode\} className="cave-mode-fade/,
  "Workspace detail must not force a full remount on every surface switch",
);
// ...but the mode-transition crossfade must STILL fire on every switch. The
// `.cave-mode-fade` CSS animation only plays on the wrapper's initial mount, so
// a mode change replays an opacity-only fade via WAAPI on the *persistent*
// wrapper (no remount, no transform → no containing-block trap; cave-cco).
// This has silently regressed twice (UX-004 added it via key={mode}; the
// terminal-keepalive PR removed the key and killed the switch fade) — pin it.
assert.match(
  workspace,
  /ref=\{detailFadeRef\}/,
  "detail wrapper wires the mode-fade ref so switches can re-fire the fade",
);
assert.match(
  workspace,
  /el\.animate\(\s*\[\{ opacity: 0 \}, \{ opacity: 1 \}\],\s*\{ duration: 120, easing: "ease-out" \}/,
  "a mode switch replays a 120ms opacity-only fade on the detail wrapper",
);
assert.match(
  workspace,
  /prefers-reduced-motion: reduce/,
  "the mode-fade retrigger honors prefers-reduced-motion",
);

console.log("workspace-mode-fade.test.ts: ok");
