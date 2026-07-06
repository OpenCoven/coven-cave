// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The left panels are PIXEL-sized so they stop scaling with monitor width —
// a 24%-wide nav is 826px on a 3440px ultrawide for a ~240px rail of labels.
// The detail panel has no size props and absorbs everything the left releases.
// The nav panel keeps its 240px default (so the group's layout solver leaves
// the sibling list panel at its own default); "minimized by default" is done by
// collapsing after mount, not by a rail-sized default that squeezed the list.
assert.match(
  shell,
  /id="nav"[\s\S]{0,600}?defaultSize="240px"[\s\S]{0,90}?minSize="200px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell nav panel keeps its 240px default, drag-resizable within a 200–420px band",
);
// Minimized by default via the group's setLayout (sets ALL panels at once) —
// NOT a single-panel collapse(). Applied ONCE per group per browser via a
// self-owned flag; after that the library's own persistence respects the user.
assert.match(
  shell,
  /function shellMinimizeApplied\(id: string\): boolean/,
  "minimize-applied is tracked by a self-owned flag (the library uses its own storage keys)",
);
assert.match(
  shell,
  /const cur = group\.getLayout\(\);[\s\S]{0,220}?const railPct = nav \* \(NAV_RAIL_PX \/ NAV_OPEN_PX\);[\s\S]{0,160}?group\.setLayout\(\{ \.\.\.cur, nav: railPct, detail: cur\.detail \+ \(nav - railPct\) \}\)/,
  "on settle, a fresh group is minimized by setting the whole layout (nav→rail, freed width→detail)",
);
assert.match(
  shell,
  /if \(minimizedGroupsRef\.current\.has\(groupId\) \|\| shellMinimizeApplied\(groupId\)\) return;[\s\S]{0,500}?markShellMinimizeApplied\(groupId\);/,
  "minimize applies once per browser per group; subsequent loads defer to the library's saved layout",
);
assert.match(
  shell,
  /groupRef=\{groupRef\}/,
  "the Group exposes an imperative handle for setLayout",
);
assert.doesNotMatch(
  shell,
  /navRef\.current\?\.collapse\(\)[\s\S]{0,80}?listRef\.current\?\.resize/,
  "no single-panel collapse + list-restore hack",
);

assert.match(
  shell,
  /id="list"[\s\S]{0,200}?defaultSize="260px"[\s\S]{0,60}?minSize="220px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell list panel should default to 260px, drag-resizable within a 220–420px band",
);

// The key bump resets everyone to the new defaults exactly once. v3 retires v2
// widths so the minimized-by-default nav takes effect; v2 retired v1 percents.
assert.match(
  shell,
  /const SHELL_GROUP_ID = "cave\.shell\.widths\.v3"/,
  "Shell layout persistence should use the v3 key (bumped so the minimized nav default applies once)",
);

// Collapse-to-rail must survive the px conversion.
assert.match(
  shell,
  /collapsedSize=\{isMobile \? 0 : NAV_RAIL_PX\}/,
  "Nav should still collapse to the icons-only rail on desktop (0 on mobile)",
);

// The CSS vars mirror the panel props (React props can't read CSS vars) —
// if one side changes, this keeps the other honest.
assert.match(globals, /--shell-nav-width:\s*240px/, "--shell-nav-width mirrors the nav's expanded width (rail is NAV_RAIL_PX)");
assert.match(globals, /--shell-list-width:\s*260px/, "--shell-list-width should match the list panel default");

console.log("shell-left-panels-fit.test.ts OK");
