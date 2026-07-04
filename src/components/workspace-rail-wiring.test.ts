// @ts-nocheck
// PR 1 / Task 4: the WorkspaceRail (code rail) is mounted beside the chat
// conversation on the standalone chat surface, driven by useCodeRail, and its
// changeCount is polled from /api/changes + refreshed on the cave:changes-refresh
// edit signal. Source-text guard — asserts the wiring survives refactors.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /import\s+\{\s*WorkspaceRail\s*\}\s+from\s+"@\/components\/workspace-rail"/,
  "chat-surface imports WorkspaceRail",
);

assert.match(
  source,
  /import\s+\{\s*useCodeRail\s*\}\s+from\s+"@\/lib\/use-code-rail"/,
  "chat-surface imports useCodeRail",
);

assert.match(
  source,
  /useCodeRail\(\s*\{[\s\S]*?projectRoot:[\s\S]*?changeCount[\s\S]*?terminalActive:\s*false[\s\S]*?\}\s*\)/,
  "chat-surface calls useCodeRail with projectRoot/changeCount and terminalActive:false",
);

assert.match(
  source,
  /"cave:changes-refresh"/,
  "chat-surface listens for the cave:changes-refresh edit signal",
);

assert.match(
  source,
  /fetch\(`\/api\/changes\?projectRoot=\$\{encodeURIComponent\(/,
  "chat-surface fetches /api/changes for the active session's project root",
);

assert.match(
  source,
  /json\.files\?\.length\s*\?\?\s*0/,
  "changeCount is derived from the /api/changes files length",
);

// The rail is gated on the standalone chat surface (surface !== 'code') and on
// the hook's availability/open state, never in code mode.
assert.match(
  source,
  /showCodeRail\s*=\s*!isCodeSurface\s*&&\s*rail\.available\s*&&\s*rail\.open/,
  "code rail visibility is gated on !isCodeSurface && rail.available && rail.open",
);

assert.match(
  source,
  /\{showCodeRail\s*&&\s*\([\s\S]*?<WorkspaceRail/,
  "the WorkspaceRail is mounted under the showCodeRail guard",
);

assert.match(
  source,
  /<WorkspaceRail[\s\S]*?changeCount=\{changeCount\}[\s\S]*?activeTab=\{rail\.activeTab\}[\s\S]*?pinned=\{rail\.pinned\}[\s\S]*?onSelectTab=\{rail\.setActiveTab\}[\s\S]*?onTogglePin=\{rail\.togglePin\}[\s\S]*?onCollapse=\{rail\.collapse\}/,
  "WorkspaceRail receives changeCount + rail state/handlers",
);

// Collapsed state renders a reopen strip.
assert.match(
  source,
  /rail\.available\s*&&\s*!rail\.open[\s\S]*?aria-label="Show code rail"[\s\S]*?rail\.reopen/,
  "a 'Show code rail' reopen strip is rendered when the rail is available but collapsed",
);

console.log("workspace-rail-wiring.test.ts ok");
