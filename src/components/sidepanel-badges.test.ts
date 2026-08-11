// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Nav badges ───────────────────────────────────────────────────────────────
assert.match(sidebar, /function badgeText\(n\?: number\)/, "badge formatter exists");
assert.match(sidebar, /boardOpenCount\?: number/, "sidebar accepts a board count");
assert.match(sidebar, /scheduleNeedsCount\?: number/, "sidebar accepts a schedules count");
assert.doesNotMatch(sidebar, /githubAssignedCount\?: number/, "sidebar no longer accepts a standalone github count");
assert.match(sidebar, /board: \(props\) => badgeText\(props\.boardOpenCount\)/, "Board nav badge wired");
assert.match(sidebar, /inbox: \(props\) => badgeText\(props\.scheduleNeedsCount\)/, "Rituals nav badge wired");
assert.doesNotMatch(sidebar, /github: \(props\) => badgeText\(props\.githubAssignedCount\)/, "GitHub nav badge removed with the standalone row");
assert.match(sidebar, /badge=\{MODE_BADGES\[fm\.id\]\?\.\(props\)\}/, "registry rows receive host-specific badges");

assert.match(workspace, /boardOpenCount=\{boardTaskCount\}/, "board count passed to sidebar");
assert.match(workspace, /scheduleNeedsCount=\{scheduleNeedsCount\}/, "schedules count passed");
assert.doesNotMatch(workspace, /githubAssignedCount=\{githubAssignedCount\}/, "workspace no longer passes a standalone github count");
// cave-925w: the badge and Home's "Needs you" strip read ONE memo — the badge
// is that shared group's length, not a separately computed count.
assert.match(workspace, /const inboxNeedsYou = useMemo\(\s*\(\) => groupInboxFeed\(inboxItemsWithEphemeral\)\.needsYou,/, "schedules badge = needs-you group (shared memo)");
assert.match(workspace, /const scheduleNeedsCount = inboxNeedsYou\.length;/, "badge count derives from the shared group");

// Per-familiar rail-tab persistence was dropped with the right companion rail
// (drag-to-split replaces it) — the workspace no longer stores cave:rail.tab.
// `workspace` is still read above for the nav-badge assertions.
void workspace;

// The companion rail (and its persisted video split) was removed with the
// right panel — drag-to-split replaces it.

console.log("sidepanel-badges.test.ts: ok");
