// @ts-nocheck
// Sidebar open-state memory: the nav panel's open/collapsed state is one
// GLOBAL user preference (cave:shell:nav-open) applied on boot and on every
// panel-group switch, so a fresh desktop launch restores the sidebar exactly
// as the user left it — regardless of which surface (two-pane Home group vs
// three-pane Chat group) last persisted its own panel-library layout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");

assert.match(
  shell,
  /const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";/,
  "the sidebar preference persists under the cave:shell:nav-open key",
);

// Boot/group-switch application: after the group settles, a saved preference
// wins over the group's own stale layout (and over the first-run rail).
const applyEffect =
  shell.match(/const navPrefArmedGroupRef[\s\S]*?\}, \[settled, isMobile, groupId\]\);/)?.[0] ?? "";
assert.ok(applyEffect.length > 0, "the nav preference apply effect exists");
assert.match(
  applyEffect,
  /const pref = readNavOpenPref\(\);/,
  "boot reads the persisted sidebar preference",
);
assert.match(
  applyEffect,
  /if \(pref && panel\.isCollapsed\(\)\) \{\s*panel\.expand\(\);/,
  "a saved open preference expands a collapsed nav on boot",
);
assert.match(
  applyEffect,
  /\} else if \(!pref && !panel\.isCollapsed\(\)\) \{\s*panel\.collapse\(\);/,
  "a saved collapsed preference collapses an open nav on boot",
);
assert.match(
  applyEffect,
  /navPrefArmedGroupRef\.current = groupId;/,
  "the effect arms preference writes for the settled group",
);

// Writes are user-driven only: the group must be armed (group-swap layout
// churn is programmatic) and the code-rail auto-collapse must not be active.
assert.match(
  shell,
  /navPrefArmedGroupRef\.current === groupId &&\s*\n\s*!railAutoCollapsedNavRef\.current\s*\n?\s*\) \{\s*\n\s*writeNavOpenPref\(open\);/,
  "onResize persists the state only for user-driven changes on the armed group",
);

// The code-rail coupling raises its flag BEFORE collapsing, so the resulting
// resize is recognized as programmatic and never overwrites the preference.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current = true;\s*\n\s*userOverrodeNavRef\.current = false;\s*\n\s*navRef\.current\?\.collapse\(\);/,
  "rail auto-collapse marks itself programmatic before the panel collapses",
);

// Storage access is guarded — strict privacy mode must not crash the shell.
assert.match(
  shell,
  /function readNavOpenPref\(\): boolean \| null \{[\s\S]*?catch \{\s*\n?\s*return null;/,
  "reading the preference tolerates unavailable storage",
);

console.log("shell-nav-memory: all assertions passed");
