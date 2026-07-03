// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The left panels are PIXEL-sized so they stop scaling with monitor width —
// a 24%-wide nav is 826px on a 3440px ultrawide for a ~240px rail of labels.
// The detail panel has no size props and absorbs everything the left releases.
assert.match(
  shell,
  /id="nav"[\s\S]{0,200}?defaultSize="240px"[\s\S]{0,60}?minSize="200px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell nav panel should default to 240px, drag-resizable within a 200–420px band",
);

assert.match(
  shell,
  /id="list"[\s\S]{0,200}?defaultSize="260px"[\s\S]{0,60}?minSize="220px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell list panel should default to 260px, drag-resizable within a 220–420px band",
);

// Percent layouts saved under v1 predate the px constraints; the key bump
// resets everyone to the new compact defaults exactly once.
assert.match(
  shell,
  /const SHELL_GROUP_ID = "cave\.shell\.widths\.v2"/,
  "Shell layout persistence should use the v2 key (v1 holds stale percent layouts)",
);

// Collapse-to-rail must survive the px conversion.
assert.match(
  shell,
  /collapsedSize=\{isMobile \? 0 : NAV_RAIL_PX\}/,
  "Nav should still collapse to the icons-only rail on desktop (0 on mobile)",
);

// The CSS vars mirror the panel props (React props can't read CSS vars) —
// if one side changes, this keeps the other honest.
assert.match(globals, /--shell-nav-width:\s*240px/, "--shell-nav-width should match the nav panel default");
assert.match(globals, /--shell-list-width:\s*260px/, "--shell-list-width should match the list panel default");

console.log("shell-left-panels-fit.test.ts OK");
