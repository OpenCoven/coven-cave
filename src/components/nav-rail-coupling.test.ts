// @ts-nocheck
// PR 3 / Task 1: the left nav is coupled to the code rail. When the code rail
// becomes visible, the shell soft-collapses the nav to its icon rail so the
// chat stays centered; it restores the nav when the rail closes UNLESS the user
// explicitly re-expanded the nav while the rail was open (their intent wins).
// The two components talk over a directional cave:code-rail-visibility event.
// Desktop-only — mobile nav is a drawer, so the coupling is a no-op there.
// Source-text guard — asserts the wiring survives refactors.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

// (a) chat-surface dispatches cave:code-rail-visibility with detail:{open:showCodeRail}
//     from an effect keyed on showCodeRail.
assert.match(
  chatSurface,
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?dispatchEvent\([\s\S]*?new CustomEvent\(\s*"cave:code-rail-visibility"\s*,\s*\{\s*detail:\s*\{\s*open:\s*showCodeRail\s*\}\s*\}\s*,?\s*\)[\s\S]*?\},\s*\[showCodeRail\]\)/,
  "chat-surface dispatches cave:code-rail-visibility { open: showCodeRail } from an effect keyed on showCodeRail",
);

// (b) shell.tsx listens for the cave:code-rail-visibility event.
assert.match(
  shell,
  /addEventListener\(\s*"cave:code-rail-visibility"/,
  "shell listens for cave:code-rail-visibility",
);
assert.match(
  shell,
  /"cave:code-rail-visibility"/,
  "shell references the cave:code-rail-visibility event name",
);

// The state-machine bookkeeping refs exist.
assert.match(
  shell,
  /railAutoCollapsedNavRef\s*=\s*useRef/,
  "shell keeps a railAutoCollapsedNavRef",
);
assert.match(
  shell,
  /userOverrodeNavRef\s*=\s*useRef/,
  "shell keeps a userOverrodeNavRef",
);

// (c) shell collapses via navRef.current?.collapse() and restores via
//     navRef.current?.expand() inside the rail-visibility handler.
assert.match(
  shell,
  /navRef\.current\?\.collapse\(\)/,
  "shell collapses the nav via navRef.current?.collapse()",
);
assert.match(
  shell,
  /navRef\.current\?\.expand\(\)/,
  "shell restores the nav via navRef.current?.expand()",
);

// (d) the restore is guarded by the user-override ref and !isMobile.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current\s*&&\s*!userOverrodeNavRef\.current\s*&&\s*!isMobile/,
  "the rail-close restore is guarded by railAutoCollapsed && !userOverrode && !isMobile",
);

// User-override detection: navOpen flipping true while the rail auto-collapsed
// it marks the user's intent so the later restore is suppressed.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current[\s\S]*?userOverrodeNavRef\.current\s*=\s*true/,
  "shell sets userOverrodeNavRef when the user re-opens the nav while rail-collapsed",
);

console.log("nav-rail-coupling.test.ts ok");
