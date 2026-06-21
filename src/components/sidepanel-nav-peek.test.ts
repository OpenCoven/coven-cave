// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Hover-to-peek state + handlers on the collapsed nav rail.
assert.match(shell, /const \[navPeeking, setNavPeeking\] = useState\(false\)/, "shell tracks a nav peek state");
assert.match(shell, /navPeeking \? " shell-nav--peek" : " shell-nav--rail"/, "hovering the rail swaps it to the peek overlay");
assert.match(shell, /onMouseEnter=\{!isMobile && !navOpen \? \(\) => setNavPeeking\(true\)/, "hovering the collapsed rail starts the peek");
assert.match(shell, /onMouseLeave=\{!isMobile && !navOpen \? \(\) => setNavPeeking\(false\)/, "leaving the rail ends the peek");
assert.match(shell, /if \(navOpen \|\| isMobile\) setNavPeeking\(false\)/, "peek resets when the rail goes away");

// The peek overlay escapes the 56px rail box and floats over content.
assert.match(globals, /\.shell-nav-panel:has\(> \.shell-nav--peek\) \{[\s\S]*?overflow: visible/, "peek lets the nav escape its panel box");
assert.match(globals, /\.shell-nav--peek \{[\s\S]*?position: absolute[\s\S]*?box-shadow/, "peek floats as a shadowed overlay");

console.log("sidepanel-nav-peek.test.ts: ok");
