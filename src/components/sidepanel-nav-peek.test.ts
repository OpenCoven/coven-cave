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
  "the desktop sidebar collapses completely",
);
assert.match(
  shell,
  /collapsedSize=\{NAV_COLLAPSED_PX\}/,
  "mobile and desktop navigation close fully",
);
assert.doesNotMatch(shell, /navPeeking|navPeekEnabled|navPeekVisible/, "hover-peek state is removed");
assert.doesNotMatch(shell, /shell-nav--rail/, "closed desktop navigation does not render a rail");
assert.match(
  shell,
  /aria-hidden=\{isMobile \? mobileDrawer !== "nav" : !navOpen\}[\s\S]*?inert=\{isMobile \? mobileDrawer !== "nav" : !navOpen\}/,
  "closed navigation leaves keyboard and accessibility interaction on both mobile and desktop",
);
assert.match(shell, /shell-separator--collapsed-nav/, "closed desktop navigation hides its separator");
assert.match(css, /\.shell-nav--rail /, "rail-specific chrome is defined in the navigation stylesheet");
assert.doesNotMatch(css, /\.shell-nav-panel:has\(> \.shell-nav--peek\)/, "peek overlay CSS is removed");

console.log("sidepanel-nav-peek.test.ts: ok");
