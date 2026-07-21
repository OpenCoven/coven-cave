// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const foundations = await readFile(new URL("../styles/globals/foundations.css", import.meta.url), "utf8");

// The left panels are PIXEL-sized so they stop scaling with monitor width —
// a 24%-wide nav is 826px on a 3440px ultrawide for a ~240px rail of labels.
// The detail panel has no size props and absorbs everything the left releases.
// Normal navigation keeps its 240px default, while Chat's contextual sidebar
// gets the wider list-like sizing it needs for workspace/session content.
assert.match(
  shell,
  /id="nav"[\s\S]{0,700}?defaultSize=\{chatContextual \? "260px" : "240px"\}[\s\S]{0,120}?minSize=\{chatContextual \? "220px" : "200px"\}[\s\S]{0,60}?maxSize="420px"/,
  "Chat's contextual nav defaults to 260px within a 220–420px band while normal nav keeps 240/200 sizing",
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
  /const cur = group\.getLayout\(\);[\s\S]{0,220}?const railPct = nav \* \(NAV_RAIL_PX \/ NAV_OPEN_PX\);[\s\S]{0,240}?group\.setLayout\(\{ \.\.\.cur, nav: railPct, detail: cur\.detail \+ \(nav - railPct\) \}\)/,
  "on settle, a fresh group is minimized by setting the whole layout (nav→rail, freed width→detail)",
);
assert.match(
  shell,
  /if \(minimizedGroupsRef\.current\.has\(groupId\) \|\| shellMinimizeApplied\(groupId\)\) return;[\s\S]{0,500}?markShellMinimizeApplied\(groupId\);/,
  "minimize applies once per browser per group; subsequent loads defer to the library's saved layout",
);
assert.match(
  shell,
  /if \(!settled \|\| isMobile \|\| chatContextual\) return;/,
  "Chat's contextual sidebar skips the startup icon-rail minimization",
);
assert.match(
  shell,
  /\}, \[settled, isMobile, groupId, chatContextual\]\);/,
  "startup minimization reacts to the contextual policy",
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
assert.match(
  shell,
  /export type ShellListPolicy = "collapsible" \| "persistent"/,
  "Shell exports a list policy that distinguishes collapsible from persistent list panes",
);
assert.match(
  shell,
  /const chatContextual = navPolicy === "chat-contextual";\s*const groupId = chatContextual\s*\? `\$\{SHELL_GROUP_ID\}\.chat-contextual`\s*: twoPane\s*\? `\$\{SHELL_GROUP_ID\}\.two-pane`\s*: listPolicy === "persistent"\s*\? `\$\{SHELL_GROUP_ID\}\.persistent-list`\s*: SHELL_GROUP_ID;/,
  "Chat contextual layouts have a separate group while existing two-pane and list policies retain their groups",
);

// Collapse-to-rail must survive the px conversion.
assert.match(
  shell,
  /collapsedSize=\{isMobile \|\| chatContextual \? 0 : NAV_RAIL_PX\}/,
  "Chat and mobile nav collapse fully while normal desktop nav keeps the icon rail",
);
assert.match(
  shell,
  /collapsible=\{isMobile \|\| listPolicy === "collapsible"\}/,
  "List panel is drawer-capable on mobile but non-collapsible on desktop under the persistent policy",
);
assert.match(
  shell,
  /if \(meta && key === "\\\\" && !twoPane\) \{[\s\S]{0,140}?if \(isMobile\) toggleDrawerSlot\("list"\);[\s\S]{0,140}?else if \(listPolicy === "collapsible"\) togglePanel\(listRef\.current\);/,
  "Cmd/Ctrl+\\ toggles the mobile list drawer, and only toggles the desktop list when policy is collapsible",
);
assert.match(
  shell,
  /closeList: \(\) => \{\s*if \(isMobile\) \{ setMobileDrawer\(\(c\) => \(c === "list" \? null : c\)\); return; \}\s*if \(listPolicy === "persistent"\) return;\s*listRef\.current\?\.collapse\(\);/,
  "closeList dismisses the mobile list drawer but no-ops on a persistent desktop list",
);
assert.match(
  shell,
  /toggleList: \(\) => \{\s*if \(isMobile\) \{ toggleDrawer\("list"\); return; \}\s*if \(listPolicy === "persistent"\) return;\s*togglePanel\(listRef\.current\);/,
  "toggleList toggles the mobile list drawer but no-ops on a persistent desktop list",
);

// The CSS vars mirror the panel props (React props can't read CSS vars) —
// if one side changes, this keeps the other honest.
assert.match(foundations, /--shell-nav-width:\s*240px/, "--shell-nav-width mirrors the nav's expanded width (rail is NAV_RAIL_PX)");
assert.match(foundations, /--shell-list-width:\s*260px/, "--shell-list-width should match the list panel default");

console.log("shell-left-panels-fit.test.ts OK");
