// @ts-nocheck
// Sidebar open-state memory belongs only to remembered navigation routes.
// Chat uses a separate contextual sidebar group that opens on entry without
// reading or overwriting the global cave:shell:nav-open preference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveShellDestinationLayout } from "./shell-layout.ts";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const compactWhitespace = (input: string) => input.replace(/\s+/g, " ").trim();

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 35, detail: 65 },
    groupSize: 1_000,
    defaultPanelPixels: { nav: 260 },
    requireOpenNav: true,
  }),
  { nav: 35, detail: 65 },
  "Chat restores its own user-resized layout instead of inheriting the normal group's live width",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 0, detail: 100 },
    groupSize: 1_000,
    defaultPanelPixels: { nav: 260 },
    requireOpenNav: true,
  }),
  { nav: 26, detail: 74 },
  "Chat falls back to its 260px default when no nonzero saved Chat width exists",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: undefined,
    groupSize: 1_000,
    defaultPanelPixels: { nav: 240, list: 260 },
    requireOpenNav: false,
  }),
  { nav: 24, list: 26, detail: 50 },
  "a fresh normal group restores both left-panel defaults without borrowing Chat or corrupting detail",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 5.6, detail: 94.4 },
    groupSize: 1_000,
    defaultPanelPixels: { nav: 240 },
    requireOpenNav: false,
  }),
  { nav: 5.6, detail: 94.4 },
  "normal navigation preserves its own saved collapsed rail layout before applying the remembered open preference",
);

assert.match(
  shell,
  /const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";/,
  "the sidebar preference persists under the cave:shell:nav-open key",
);

assert.match(
  shell,
  /export type ShellNavPolicy = "remembered" \| "visit-collapsed" \| "chat-contextual";/,
  "Shell exports the route-scoped nav policy contract",
);

assert.match(
  shell,
  /navPolicy = "remembered"/,
  "Shell defaults nav policy to remembered",
);

assert.match(
  shell,
  /import \{ resolveShellDestinationLayout \} from "\.\/shell-layout";/,
  "Shell uses the tested destination-layout resolver",
);

const destinationLayoutEffect =
  shell.match(/const layoutPersistenceGroupRef = useRef<string \| null>\(null\);[\s\S]*?\}, \[mounted, groupId, chatContextual, defaultLayout, twoPane\]\);/)?.[0] ?? "";
assert.ok(destinationLayoutEffect.length > 0, "the destination group restoration effect exists");
assert.match(
  destinationLayoutEffect,
  /Array\.from\(groupElement\.children\)\.reduce\([\s\S]*?child\.hasAttribute\("data-panel"\)[\s\S]*?child\.offsetWidth/,
  "destination defaults use the panel library's available panel width rather than the group width including separators",
);
assert.match(
  destinationLayoutEffect,
  /resolveShellDestinationLayout\(\{[\s\S]*?savedLayout: defaultLayout,[\s\S]*?defaultPanelPixels: \{ nav: chatContextual \? 260 : NAV_OPEN_PX, \.\.\.\(!twoPane && \{ list: 260 \}\) \},[\s\S]*?requireOpenNav: chatContextual,/,
  "every group transition resolves the destination's saved layout or its own Chat/normal pixel defaults",
);
assert.match(
  destinationLayoutEffect,
  /layoutPersistenceGroupRef\.current = groupId;\s*restoredGroupRef\.current = groupId;\s*group\.setLayout\(destinationLayout\);/,
  "the destination group is armed only when its complete layout is ready to apply",
);

// Boot/group-switch application: after the group settles, a saved preference
// wins over the group's own stale layout (and over the first-run rail).
const applyEffect =
  shell.match(/const navPrefArmedGroupRef[\s\S]*?\}, \[settled, isMobile, groupId, navPolicy\]\);/)?.[0] ?? "";
assert.ok(applyEffect.length > 0, "the nav preference apply effect exists");
assert.match(
  applyEffect,
  /if \(navPolicy !== "remembered"\) \{\s*navPrefArmedGroupRef\.current = null;\s*return;\s*\}/,
  "visit-collapsed and chat-contextual never arm remembered-preference writes",
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

const routePolicyEffect =
  shell.match(/const previousNavPolicyRef = useRef<ShellNavPolicy>\("remembered"\);[\s\S]*?\}, \[mounted, groupId, isMobile, navPolicy\]\);/)?.[0] ?? "";
assert.ok(
  routePolicyEffect.length > 0,
  "the route-policy layout effect reruns after the real nav panel mounts",
);
assert.equal(
  compactWhitespace(routePolicyEffect),
  compactWhitespace(`
    const previousNavPolicyRef = useRef<ShellNavPolicy>("remembered");
    const visitCollapsedGroupRef = useRef<string | null>(null);
    const chatContextualGroupRef = useRef<string | null>(null);
    useLayoutEffect(() => {
      if (!mounted) return;
      if (navPolicy === "chat-contextual") {
        visitCollapsedGroupRef.current = null;
        navPrefArmedGroupRef.current = null;
        if (
          previousNavPolicyRef.current !== navPolicy ||
          chatContextualGroupRef.current !== groupId
        ) {
          chatContextualGroupRef.current = groupId;
          setNavOpen(true);
        }
        previousNavPolicyRef.current = navPolicy;
        return;
      }
      chatContextualGroupRef.current = null;
      if (navPolicy !== "visit-collapsed") {
        visitCollapsedGroupRef.current = null;
        previousNavPolicyRef.current = navPolicy;
        return;
      }
      if (isMobile) {
        previousNavPolicyRef.current = navPolicy;
        return;
      }
      if (
        previousNavPolicyRef.current !== navPolicy ||
        visitCollapsedGroupRef.current !== groupId
      ) {
        navPrefArmedGroupRef.current = null;
        visitCollapsedGroupRef.current = groupId;
        navRef.current?.collapse();
        setNavOpen(false);
      }
      previousNavPolicyRef.current = navPolicy;
    }, [mounted, groupId, isMobile, navPolicy]);
  `),
  "Chat opens after destination restoration without arming memory, while visit-collapsed keeps its desktop-only behavior",
);

assert.match(
  shell,
  /onLayoutChanged=\{\(layout, detail\) => \{\s*if \(layoutPersistenceGroupRef\.current !== groupId\) return;[\s\S]{0,240}?if \(!chatContextual \|\| \(layout\.nav \?\? 0\) > 0\) \{\s*onLayoutChanged\(layout, detail\);\s*\}\s*\}\}/,
  "group-swap churn cannot overwrite the destination layout, and Chat keeps its last expanded width",
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
  "hover-to-peek is disabled for visit-collapsed and chat-contextual routes",
);
assert.match(
  shell,
  /const navPeekVisible = navPeekEnabled && navPeeking;/,
  "peek visibility is synchronously gated so stale state cannot leak onto the first Chat paint",
);
assert.match(
  shell,
  /className=\{`shell-nav\$\{!isMobile && !chatContextual && !navOpen \? \(navPeekVisible \? " shell-nav--peek" : " shell-nav--rail"\) : ""\}`\}/,
  "Chat's zero-width collapsed sidebar never receives remembered navigation rail or peek styling",
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

assert.match(
  shell,
  /aria-label=\{chatContextual\s*\? navOpen\s*\? "Collapse Chat sidebar"\s*: "Expand Chat sidebar"\s*: navOpen\s*\? "Collapse navigation to icons"\s*: "Expand navigation"\}/,
  "the top-left toggle announces Chat sidebar actions in contextual mode",
);
assert.match(
  shell,
  /title=\{chatContextual\s*\? navOpen\s*\? `Collapse Chat sidebar \(\$\{leftPanelShortcutLabel\}\)`\s*: `Expand Chat sidebar \(\$\{leftPanelShortcutLabel\}\)`\s*: navOpen\s*\? `Collapse navigation \(\$\{leftPanelShortcutLabel\}\)`\s*: `Expand navigation \(\$\{leftPanelShortcutLabel\}\)`\}/,
  "the Chat toggle title stays contextual and includes the shortcut",
);

// Storage access is guarded — strict privacy mode must not crash the shell.
assert.match(
  shell,
  /function readNavOpenPref\(\): boolean \| null \{[\s\S]*?catch \{\s*\n?\s*return null;/,
  "reading the preference tolerates unavailable storage",
);

console.log("shell-nav-memory: all assertions passed");
