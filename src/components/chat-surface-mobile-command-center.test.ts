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

console.log("chat-surface-mobile-command-center.test.ts: ok");
