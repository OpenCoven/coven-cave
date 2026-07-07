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
  /useCodeRail\(\s*\{[\s\S]*?projectRoot:[\s\S]*?changeCount[\s\S]*?terminalActive:\s*terminalOpened[\s\S]*?\}\s*\)/,
  "chat-surface calls useCodeRail with projectRoot/changeCount and terminalActive:terminalOpened",
);

// Once the Terminal tab is opened the rail stays available (keepalive) — the
// terminalOpened flag flips false→true and feeds back into terminalActive.
assert.match(
  source,
  /rail\.activeTab === "terminal" && rail\.open[\s\S]*?setTerminalOpened\(true\)/,
  "chat-surface flips terminalOpened once the Terminal tab is opened",
);

// The active session id is threaded into the rail so the terminal gets a stable
// per-session pty identity.
assert.match(
  source,
  /<WorkspaceRail[\s\S]*?sessionId=\{snapshot\.sessionId \?\? null\}/,
  "WorkspaceRail receives the active session id",
);

// On session change the previous session's rail shell is stopped (desktop PTYs
// have no idle reaper) and the terminal-held-open latch is reset so the rail is
// not forced open on an unrelated session.
assert.match(
  source,
  /pty_stop"?,\s*\{\s*threadId:\s*`cave\.rail\.\$\{prev\}`/,
  "chat-surface stops the previous session's rail pty on session change",
);
assert.match(
  source,
  /railTermSessionRef[\s\S]*?setTerminalOpened\(false\)/,
  "chat-surface resets the terminal-held-open latch when the session changes",
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
  /const activeSession = snapshot\.session;[\s\S]{0,100}?const railProjectRoot = activeSession\?\.project_root \?\? null;/,
  "standalone files/changes rail is scoped to the active session's project root",
);

assert.doesNotMatch(
  source,
  /const railProjectRoot = (?!activeSession\?\.project_root)/,
  "railProjectRoot itself stays session-pure (the override lives in a separate binding)",
);

// cave-z44: the Projects hub can drill into any project's files. The rail's
// EFFECTIVE root is the browse override when set, else the session root — one
// binding every rail signal (availability, changeCount, WorkspaceRail) reads,
// so a peek stays internally coherent. Cleared on session change + collapse.
assert.match(
  source,
  /const effectiveRailRoot = browseRootOverride \?\? railProjectRoot;/,
  "the rail's effective root is the browse override, falling back to the session root",
);
assert.match(
  source,
  /useCodeRail\(\s*\{\s*projectRoot:\s*effectiveRailRoot/,
  "useCodeRail is keyed on the effective (override-aware) root so a peek makes the rail available",
);
assert.match(
  source,
  /browseActive:\s*browseRootOverride !== null/,
  "useCodeRail is told when a browse peek is active so it suppresses the Changes auto-reveal",
);
assert.match(
  source,
  /setBrowseRootOverride\(null\)[\s\S]{0,200}?\}, \[snapshot\.sessionId, terminalOpened\]\)/,
  "the browse override is cleared when the active session changes",
);

assert.match(
  source,
  /json\.files\?\.length\s*\?\?\s*0/,
  "changeCount is derived from the /api/changes files length",
);

// The rail is gated on the hook's availability/open state. Retired Code mode no
// longer needs a surface switch to suppress it.
assert.match(
  source,
  /showCodeRail\s*=\s*rail\.available\s*&&\s*rail\.open/,
  "code rail visibility is gated on rail.available && rail.open",
);

assert.match(
  source,
  /\{showCodeRail\s*&&\s*\([\s\S]*?<WorkspaceRail/,
  "the WorkspaceRail is mounted under the showCodeRail guard",
);

assert.match(
  source,
  /<WorkspaceRail[\s\S]*?changeCount=\{changeCount\}[\s\S]*?activeTab=\{rail\.activeTab\}[\s\S]*?pinned=\{rail\.pinned\}[\s\S]*?onSelectTab=\{rail\.setActiveTab\}[\s\S]*?onTogglePin=\{rail\.togglePin\}[\s\S]*?onCollapse=\{\(\) => \{[\s\S]*?rail\.collapse\(\)/,
  "WorkspaceRail receives changeCount + rail state/handlers; collapse also ends the browse peek",
);

assert.match(
  source,
  /<WorkspaceRail[\s\S]*?projectRoot=\{effectiveRailRoot\}/,
  "WorkspaceRail Files tab receives the effective (override-aware) project root",
);
// The manual collapse handler ends a browse peek so reopening shows the session.
assert.match(
  source,
  /onCollapse=\{\(\) => \{ setBrowseRootOverride\(null\); rail\.collapse\(\); \}\}/,
  "collapsing the rail clears the browse override",
);

// Collapsed state renders a reopen strip.
assert.match(
  source,
  /rail\.available\s*&&\s*!rail\.open[\s\S]*?aria-label="Show code rail"[\s\S]*?rail\.reopen/,
  "a 'Show code rail' reopen strip is rendered when the rail is available but collapsed",
);

console.log("workspace-rail-wiring.test.ts ok");
