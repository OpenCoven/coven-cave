// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/globals/shell-navigation.css", import.meta.url),
  "utf8",
);

assert.match(
  shell,
  /const NAV_COLLAPSED_PX = 0;/,
  "the desktop sidebar closes to zero width",
);
assert.match(
  shell,
  /collapsedSize=\{NAV_COLLAPSED_PX\}/,
  "every shell policy uses the zero-width collapsed size",
);
assert.doesNotMatch(shell, /navPeeking|navPeekEnabled|navPeekVisible/, "hover-peek state is removed");
assert.doesNotMatch(shell, /shell-nav--peek|shell-nav--rail/, "the shell never renders an icon rail or overlay class");
assert.match(
  shell,
  /aria-hidden=\{isMobile \? mobileDrawer !== "nav" : !navOpen\}[\s\S]*?inert=\{isMobile \? mobileDrawer !== "nav" : !navOpen\}/,
  "hidden navigation is removed from keyboard and accessibility interaction",
);
assert.match(
  shell,
  /shell-separator--collapsed-nav/,
  "the nav resize handle closes with the panel",
);
assert.match(
  css,
  /\.shell-separator--collapsed-nav \{\s*display: none;/,
  "the collapsed nav leaves no resize-handle sliver",
);
assert.doesNotMatch(css, /\.shell-nav-panel:has\(> \.shell-nav--peek\)/, "peek overlay CSS is removed");

console.log("sidepanel-nav-peek.test.ts: ok");
