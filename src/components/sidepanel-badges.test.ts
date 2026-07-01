// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const rail = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

// ── Nav badges ───────────────────────────────────────────────────────────────
assert.match(sidebar, /function badgeText\(n\?: number\)/, "badge formatter exists");
assert.match(sidebar, /boardOpenCount\?: number/, "sidebar accepts a board count");
assert.match(sidebar, /scheduleNeedsCount\?: number/, "sidebar accepts a schedules count");
assert.match(sidebar, /githubAssignedCount\?: number/, "sidebar accepts a github count");
assert.match(sidebar, /badge: \(p\) => badgeText\(p\.boardOpenCount\)/, "Board nav badge wired");
assert.match(sidebar, /badge: \(p\) => badgeText\(p\.scheduleNeedsCount\)/, "Schedules nav badge wired");
assert.match(sidebar, /badge: \(p\) => badgeText\(p\.githubAssignedCount\)/, "GitHub nav badge wired");

assert.match(workspace, /boardOpenCount=\{boardTaskCount\}/, "board count passed to sidebar");
assert.match(workspace, /scheduleNeedsCount=\{scheduleNeedsCount\}/, "schedules count passed");
assert.match(workspace, /githubAssignedCount=\{githubAssignedCount\}/, "github count passed");
assert.match(workspace, /groupInboxFeed\(inboxItemsWithEphemeral\)\.needsYou\.length/, "schedules badge = needs-you group");

// Per-familiar rail-tab persistence was dropped with the right companion rail
// (drag-to-split replaces it) — the workspace no longer stores cave:rail.tab.
// `workspace` is still read above for the nav-badge assertions.
void workspace;

// ── Video split persistence ────────────────────────────────────────────────────
assert.match(rail, /useDefaultLayout/, "rail split uses the layout-persistence hook");
assert.match(rail, /cave:companion-rail-split/, "split layout has a stable storage id");
assert.match(rail, /defaultLayout=\{splitLayout\} onLayoutChanged=\{onSplitLayout\}/, "split layout wired to the Group");

console.log("sidepanel-badges.test.ts: ok");
