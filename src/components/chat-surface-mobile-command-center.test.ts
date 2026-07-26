// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  source,
  /<section ref=\{surfaceRef\} className="chat-surface /,
  "ChatSurface should expose a mobile-targetable root class (and the ref that measures pane width)",
);

assert.match(
  source,
  /<div className="chat-scope-tabs /,
  "ChatSurface tabs should expose a mobile-targetable class",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-scope-tabs\s*\{[\s\S]*position\s*:\s*sticky[\s\S]*top\s*:\s*0[\s\S]*z-index\s*:\s*55/,
  "Mobile chat tabs should stay pinned under app chrome instead of sliding beneath iOS status UI",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-scope-tabs\s*\{[\s\S]*background\s*:\s*color-mix\(in oklch, var\(--bg-raised\) 92%, transparent\)/,
  "Mobile chat tabs should keep an opaque blurred surface while sticky",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-scope-tabs\s*\{[\s\S]*min-height\s*:\s*calc\(var\(--touch-target\) \+ 4px\)/,
  "Mobile chat tab strip should leave room for touch-sized tabs",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-scope-tabs \[role="tab"\]\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Mobile chat scope tabs should meet the shared touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.shell-detail:has\(> \.cave-mode-fade > \.workspace-detail-content > \.chat-surface\)\s*\{[\s\S]*overflow\s*:\s*hidden/,
  "Mobile chat should prevent the shell detail from becoming a second scroll owner through the inertable detail wrapper",
);

// The Inspector/Debug/Changes right sidebar is retired — the code rail is the
// only right sidepanel, and mobile-code-rail.test.ts owns its narrow-layout
// sheet pins. What remains here: the pane-width heuristic that decides the
// inline-vs-sheet presentation for the code rail. The heuristic itself lives
// in the shared rail controller (extracted for the task cockpit); ChatSurface
// must still consume it rather than growing its own copy.
assert.doesNotMatch(
  source,
  /chat-right-sheet|rightPanel/,
  "the retired session-panel sheet must not come back",
);
const railController = readFileSync(
  new URL("../lib/use-workspace-rail-controller.ts", import.meta.url),
  "utf8",
);
assert.match(
  railController,
  /const paneNarrow = paneWidth === null \? isMobile : paneWidth < 680/,
  "paneNarrow falls back to the viewport heuristic until the first ResizeObserver measurement",
);
assert.match(
  source,
  /useWorkspaceRailController\(/,
  "ChatSurface consumes the shared rail controller instead of forking the pane-width heuristic",
);

console.log("chat-surface-mobile-command-center.test.ts: ok");
