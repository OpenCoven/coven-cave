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
  /@media \(max-width: 767px\) \{[\s\S]*\.shell-detail:has\(> \.cave-mode-fade > \.chat-surface\)\s*\{[\s\S]*overflow\s*:\s*hidden/,
  "Mobile chat should prevent the shell detail from becoming a second scroll owner",
);

// The Inspector/Debug/Changes panels live in a 230px right sidebar that is
// hidden when there's no room beside the chat thread — a phone viewport OR a
// narrow drag-to-split pane on a wide screen. In both cases they must remain
// reachable — rendered in a right-edge sheet over a dismissible scrim —
// instead of silently vanishing.
assert.match(
  source,
  /scope === "conversation" && rightPanel !== null && \(isMobile \|\| paneNarrow\) && \(/,
  "ChatSurface should render the session panels as a sheet when the inline sidebar is hidden",
);

// The sheet's visibility is JS-gated (isMobile || paneNarrow) — a viewport
// lg:hidden here would wrongly hide it inside a narrow split pane on desktop.
assert.match(
  source,
  /className="chat-right-sheet fixed inset-0 z-\[200\] flex justify-end"/,
  "Session-panel sheet should be a fixed right-edge overlay without a viewport-gated lg:hidden",
);

assert.match(
  source,
  /aria-label="Close session panels"[\s\S]*?onClick=\{\(\) => setRightPanel\(null\)\}/,
  "Mobile session-panel sheet should close on scrim tap",
);

// Gate the inline desktop sidebar as the exact complement of the sheet so only
// one RightPanel mounts at a time — otherwise InspectorPane double-fetches and
// duplicates DOM ids. paneNarrow tracks the surface's own measured width so a
// narrow drag-to-split pane on a wide viewport also swaps to the sheet.
assert.match(
  source,
  /const showRightSidebar = rightPanel !== null && !isMobile && !paneNarrow/,
  "Inline desktop right sidebar should not mount when the pane or viewport is narrow (avoids duplicate RightPanel)",
);
assert.match(
  source,
  /const paneNarrow = paneWidth === null \? isMobile : paneWidth < 680/,
  "paneNarrow falls back to the viewport heuristic until the first ResizeObserver measurement",
);

console.log("chat-surface-mobile-command-center.test.ts: ok");
