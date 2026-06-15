// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  source,
  /<section className="chat-surface /,
  "ChatSurface should expose a mobile-targetable root class",
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
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-scope-tabs \[role="tab"\],[\s\S]*\.chat-scope-tabs__new\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Mobile chat scope tabs and New action should meet the shared touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.shell-detail:has\(> \.cave-mode-fade > \.chat-surface\)\s*\{[\s\S]*overflow\s*:\s*hidden/,
  "Mobile chat should prevent the shell detail from becoming a second scroll owner",
);

// The Inspector/Debug/Changes panels live in a 230px right sidebar that is
// hidden below the desktop shell breakpoint (no room beside the chat thread).
// On mobile they must remain reachable — rendered in a right-edge sheet over a
// dismissible scrim — instead of silently vanishing.
assert.match(
  source,
  /scope === "conversation" && rightPanel !== null && isMobile && \(/,
  "ChatSurface should render the session panels as a mobile sheet when the inline sidebar is hidden",
);

assert.match(
  source,
  /className="chat-right-sheet fixed inset-0 z-\[200\] flex justify-end lg:hidden"/,
  "Mobile session-panel sheet should be a fixed right-edge overlay, hidden once the desktop sidebar fits (lg)",
);

assert.match(
  source,
  /aria-label="Close session panels"[\s\S]*?onClick=\{\(\) => setRightPanel\(null\)\}/,
  "Mobile session-panel sheet should close on scrim tap",
);

// Gate the inline desktop sidebar on !isMobile so only one RightPanel mounts per
// breakpoint — otherwise InspectorPane double-fetches and duplicates DOM ids.
assert.match(
  source,
  /rightPanel !== null && !isMobile && \(/,
  "Inline desktop right sidebar should not also mount on mobile (avoids duplicate RightPanel)",
);

console.log("chat-surface-mobile-command-center.test.ts: ok");
