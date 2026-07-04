// @ts-nocheck
// Source-text guards for the code-rail entrance + tab-switch motion (PR 3, Task 2).
// Pins the animation className / keyed remount in the component and the CSS
// @keyframes + reduced-motion override, without which the polish silently rots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tsx = readFileSync(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/cave-chat.css", import.meta.url),
  "utf8",
);

// --- component wiring -------------------------------------------------------
// The non-terminal panel body carries the animation hook class so it eases in.
assert.match(
  tsx,
  /workspace-rail__panel/,
  "panel-body wrapper has the animation className",
);
// Tab-switch replay: the non-terminal body is keyed by activeTab so React
// remounts it and the CSS entrance animation re-fires. The terminal wrapper is
// deliberately NOT keyed (keepalive — remounting would respawn the pty).
assert.match(
  tsx,
  /key=\{activeTab\}/,
  "non-terminal panel body is keyed by activeTab to replay the entrance",
);
// Keepalive must survive: the keyed wrapper must not enclose the terminal host.
// Guard by asserting the terminal wrapper class is still present and gated.
assert.match(
  tsx,
  /workspace-rail__terminal/,
  "terminal wrapper class still present (keepalive)",
);
assert.match(
  tsx,
  /terminalEverOpened/,
  "terminal keepalive gate still present",
);

// --- CSS: entrance keyframes + rail-scoped rules ----------------------------
assert.match(
  css,
  /@keyframes\s+workspace-rail-content-in\b/,
  "defines the rail content entrance @keyframes",
);
assert.match(
  css,
  /\.workspace-rail__panel\s*\{[^}]*animation:\s*workspace-rail-content-in/s,
  "panel body runs the entrance animation",
);
assert.match(
  css,
  /\.workspace-rail__body\s*\{[^}]*animation:\s*workspace-rail-content-in/s,
  "rail body content eases in on mount",
);

// --- CSS: reduced-motion override zeroes the rail animations -----------------
// Find a prefers-reduced-motion block that disables the rail animation classes.
const rmBlocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)];
assert.ok(rmBlocks.length > 0, "has at least one reduced-motion media block");
// A rail-specific reduced-motion rule must set animation: none for the hooks.
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.workspace-rail__panel[^}]*\{[^}]*animation:\s*none/s,
  "reduced-motion sets animation:none for .workspace-rail__panel",
);
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.workspace-rail__body[^}]*\{[^}]*animation:\s*none/s,
  "reduced-motion sets animation:none for .workspace-rail__body",
);

console.log("workspace-rail-motion.test.ts OK");
