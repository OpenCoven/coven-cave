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
  /const NAV_RAIL_PX = 56;/,
  "the desktop sidebar collapses to an icons-only rail",
);
assert.match(
  shell,
  /collapsedSize=\{isMobile \? 0 : NAV_RAIL_PX\}/,
  "mobile closes fully while desktop keeps the rail",
);
assert.doesNotMatch(shell, /navPeeking|navPeekEnabled|navPeekVisible/, "hover-peek state is removed");
assert.match(shell, /shell-nav--rail/, "the collapsed desktop navigation renders its rail class");
assert.match(
  shell,
  /aria-hidden=\{isMobile \? mobileDrawer !== "nav" : undefined\}[\s\S]*?inert=\{isMobile && mobileDrawer !== "nav"\}/,
  "only the closed mobile drawer leaves keyboard and accessibility interaction",
);
assert.doesNotMatch(shell, /shell-separator--collapsed-nav/, "the desktop rail keeps its separator");
assert.match(css, /\.shell-nav--rail /, "rail-specific chrome is defined in the navigation stylesheet");
assert.doesNotMatch(css, /\.shell-nav-panel:has\(> \.shell-nav--peek\)/, "peek overlay CSS is removed");

console.log("sidepanel-nav-peek.test.ts: ok");
