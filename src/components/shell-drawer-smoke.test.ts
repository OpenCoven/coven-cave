// @ts-nocheck
//
// Smoke test for the phase 2 mobile shell drawer wiring. Asserts the
// CSS + the shell component still agree on the drawer contract:
//   - globals.css gates drawer behaviour on `[data-mobile-drawer]`
//   - shell.tsx exposes toggleNav / toggleList / toggleAgent and
//     projects mobileDrawer state onto data-mobile-drawer
//   - top-bar.tsx renders the three mobile-only toggle buttons
//
// Run via `pnpm test:mobile`. Pure file-read assertions — no DOM,
// no browser, no daemon.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const mobileDrawer = readFileSync(
  new URL("./mobile-drawer.tsx", import.meta.url),
  "utf8",
);

// CSS drives the slide via data-mobile-drawer="nav|list|agent" on the
// shell-root container — verify all three slots are wired.
assert.match(
  globals,
  /\.shell-root\[data-mobile-drawer="nav"\]\s+\.shell-nav-panel/,
  "globals.css drives the nav panel transform from [data-mobile-drawer=\"nav\"]",
);
assert.match(
  globals,
  /\.shell-root\[data-mobile-drawer="list"\]\s+\.shell-list-panel/,
  "globals.css drives the list panel transform from [data-mobile-drawer=\"list\"]",
);
assert.match(
  globals,
  /\.shell-root\[data-mobile-drawer="agent"\]\s+\.shell-agent-panel/,
  "globals.css drives the agent panel transform from [data-mobile-drawer=\"agent\"]",
);

// Mobile/tablet-width media query owns the drawer transforms. The
// shipped breakpoint is 1023px (tablet-and-below); earlier iterations
// of this branch used 767px (phone-only). Accept either so a future
// breakpoint move doesn't break the smoke for the wrong reason.
assert.match(
  globals,
  /@media\s*\(max-width:\s*(?:767|1023)px\)/,
  "globals.css declares the mobile breakpoint @media (max-width: 767px|1023px)",
);
assert.match(
  globals,
  /\.shell-nav-panel,[\s\S]{0,80}\.shell-list-panel,[\s\S]{0,80}\.shell-agent-panel\s*\{[\s\S]{0,200}position:\s*fixed/,
  "globals.css positions the three shell panels as fixed drawers",
);

// shell.tsx projects mobileDrawer state onto data-mobile-drawer.
assert.match(
  shell,
  /data-mobile-drawer=\{isMobile && mobileDrawer \? mobileDrawer : undefined\}/,
  "shell.tsx wires data-mobile-drawer from mobileDrawer state",
);
// The MobileDrawer overlay mounts at shell-body level.
assert.match(
  shell,
  /<MobileDrawer\s+open=\{isMobile \? mobileDrawer : null\}/,
  "shell.tsx mounts MobileDrawer overlay with isMobile-gated open prop",
);
// ShellHandle exposes the toggle API the top-bar uses.
assert.match(
  shell,
  /toggleNav: \(\) =>/,
  "ShellHandle exposes toggleNav",
);
assert.match(
  shell,
  /toggleList: \(\) =>/,
  "ShellHandle exposes toggleList",
);
assert.match(
  shell,
  /toggleAgent: \(\) =>/,
  "ShellHandle exposes toggleAgent",
);

// top-bar.tsx renders the three drawer toggles behind their callbacks.
assert.match(
  topBar,
  /onToggleNav\?\s*:\s*\(\)\s*=>\s*void/,
  "TopBar accepts onToggleNav prop",
);
assert.match(
  topBar,
  /onToggleList\?\s*:\s*\(\)\s*=>\s*void/,
  "TopBar accepts onToggleList prop",
);
assert.match(
  topBar,
  /onToggleAgent\?\s*:\s*\(\)\s*=>\s*void/,
  "TopBar accepts onToggleAgent prop",
);
assert.match(
  topBar,
  /className="top-bar__mobile-toggle"/,
  "TopBar uses .top-bar__mobile-toggle for the drawer buttons",
);

// mobile-drawer.tsx must own escape + body-scroll-lock so two paths
// don't fight.
assert.match(
  mobileDrawer,
  /e\.key === "Escape"/,
  "MobileDrawer closes on Escape",
);
assert.match(
  mobileDrawer,
  /document\.body\.style\.overflow = "hidden"/,
  "MobileDrawer locks body scroll while open",
);

console.log("shell-drawer-smoke.test.ts OK");
