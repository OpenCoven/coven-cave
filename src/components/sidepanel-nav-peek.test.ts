// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Hover-to-peek state + handlers on the collapsed nav rail.
assert.match(shell, /const \[navPeeking, setNavPeeking\] = useState\(false\)/, "shell tracks a nav peek state");
assert.match(shell, /const navPeekEnabled = navPolicy === "remembered" && !isMobile && !navOpen;/, "shell derives whether peek is allowed from nav policy and breakpoint");
assert.match(shell, /const navPeekVisible = navPeekEnabled && navPeeking;/, "shell derives visible peek state synchronously from the policy-gated flag");
assert.match(shell, /navPeekVisible \? " shell-nav--peek" : " shell-nav--rail"/, "only a policy-allowed peek renders the overlay class");
assert.match(shell, /onMouseEnter=\{navPeekEnabled \? \(\) => setNavPeeking\(true\) : undefined\}/, "hovering starts the peek only when the gated handler is armed");
assert.match(shell, /onMouseLeave=\{navPeekEnabled \? \(\) => setNavPeeking\(false\) : undefined\}/, "leaving ends the peek only when the gated handler is armed");
assert.match(shell, /if \(!navPeekEnabled\) setNavPeeking\(false\)/, "state still resets whenever policy or breakpoint disables peeking");

// The peek overlay escapes the 56px rail box and floats over content.
assert.match(globals, /\.shell-nav-panel:has\(> \.shell-nav--peek\) \{[\s\S]*?overflow: visible/, "peek lets the nav escape its panel box");
assert.match(globals, /\.shell-nav--peek \{[\s\S]*?position: absolute[\s\S]*?box-shadow/, "peek floats as a shadowed overlay");

console.log("sidepanel-nav-peek.test.ts: ok");
