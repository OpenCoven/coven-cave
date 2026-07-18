// @ts-nocheck
// Sidebar open-state memory: the nav panel's open/collapsed state is one
// GLOBAL user preference (cave:shell:nav-open) applied on boot and on every
// panel-group switch, so a fresh desktop launch restores the sidebar exactly
// as the user left it — regardless of which surface (two-pane Home group vs
// three-pane Chat group) last persisted its own panel-library layout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const compactWhitespace = (input: string) => input.replace(/\s+/g, " ").trim();

assert.match(
  shell,
  /const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";/,
  "the sidebar preference persists under the cave:shell:nav-open key",
);

assert.match(
  shell,
  /export type ShellNavPolicy = "remembered" \| "visit-collapsed";/,
  "Shell exports the route-scoped nav policy contract",
);

assert.match(
  shell,
  /navPolicy = "remembered"/,
  "Shell defaults nav policy to remembered",
);

// Boot/group-switch application: after the group settles, a saved preference
// wins over the group's own stale layout (and over the first-run rail).
const applyEffect =
  shell.match(/const navPrefArmedGroupRef[\s\S]*?\}, \[settled, isMobile, groupId, navPolicy\]\);/)?.[0] ?? "";
assert.ok(applyEffect.length > 0, "the nav preference apply effect exists");
assert.match(
  applyEffect,
  /if \(navPolicy !== "remembered"\) \{\s*navPrefArmedGroupRef\.current = null;\s*return;\s*\}/,
  "visit-collapsed never arms remembered-preference writes",
);
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

const visitCollapseEffect =
  shell.match(/const previousNavPolicyRef = useRef<ShellNavPolicy>\("remembered"\);[\s\S]*?\}, \[mounted, groupId, isMobile, navPolicy\]\);/)?.[0] ?? "";
assert.ok(
  visitCollapseEffect.length > 0,
  "the visit-collapsed layout effect reruns after the real nav panel mounts",
);
assert.equal(
  compactWhitespace(visitCollapseEffect),
  compactWhitespace(`
    const previousNavPolicyRef = useRef<ShellNavPolicy>("remembered");
    useLayoutEffect(() => {
      if (!mounted) return;
      if (navPolicy !== "visit-collapsed") {
        previousNavPolicyRef.current = navPolicy;
        return;
      }
      if (isMobile) {
        previousNavPolicyRef.current = navPolicy;
        return;
      }
      if (
        previousNavPolicyRef.current !== navPolicy ||
        navPrefArmedGroupRef.current !== groupId
      ) {
        navPrefArmedGroupRef.current = null;
        navRef.current?.collapse();
        setNavOpen(false);
      }
      previousNavPolicyRef.current = navPolicy;
    }, [mounted, groupId, isMobile, navPolicy]);
  `),
  "entering visit-collapsed collapses once per desktop visit only after mount, while mobile skips desktop panel mutation and preserves the armed-group reset",
);

// Writes are user-driven only: the group must be armed (group-swap layout
// churn is programmatic) and the code-rail auto-collapse must not be active.
assert.match(
  shell,
  /navPolicy === "remembered" &&\s*\n\s*navPrefArmedGroupRef\.current === groupId &&\s*\n\s*!railAutoCollapsedNavRef\.current\s*\n?\s*\) \{\s*\n\s*writeNavOpenPref\(open\);/,
  "onResize persists the state only for user-driven changes on the armed group",
);

// The code-rail coupling raises its flag BEFORE collapsing, so the resulting
// resize is recognized as programmatic and never overwrites the preference.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current = true;\s*\n\s*userOverrodeNavRef\.current = false;\s*\n\s*navRef\.current\?\.collapse\(\);/,
  "rail auto-collapse marks itself programmatic before the panel collapses",
);

assert.match(
  shell,
  /const navPeekEnabled = navPolicy === "remembered" && !isMobile && !navOpen;/,
  "hover-to-peek is disabled for visit-collapsed routes",
);
assert.match(
  shell,
  /onMouseEnter=\{navPeekEnabled \? \(\) => setNavPeeking\(true\) : undefined\}/,
  "hover enter only peeks when the remembered nav policy allows it",
);
assert.match(
  shell,
  /onMouseLeave=\{navPeekEnabled \? \(\) => setNavPeeking\(false\) : undefined\}/,
  "hover leave only peeks when the remembered nav policy allows it",
);

// Storage access is guarded — strict privacy mode must not crash the shell.
assert.match(
  shell,
  /function readNavOpenPref\(\): boolean \| null \{[\s\S]*?catch \{\s*\n?\s*return null;/,
  "reading the preference tolerates unavailable storage",
);

console.log("shell-nav-memory: all assertions passed");
