// @ts-nocheck
// Sidebar open-state memory belongs only to remembered navigation routes.
// Chat uses a separate contextual sidebar group that opens on entry without
// reading or overwriting the global cave:shell:nav-open preference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as shellLayout from "./shell-layout.ts";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const compactWhitespace = (input: string) => input.replace(/\s+/g, " ").trim();
const { resolveShellDestinationLayout } = shellLayout;
const isShellNavCollapsedLayout =
  shellLayout.isShellNavCollapsedLayout ??
  (() => false);
const resolveShellLayoutPersistence =
  shellLayout.resolveShellLayoutPersistence ??
  (() => undefined);
const resolveShellNavOpenPreference =
  shellLayout.resolveShellNavOpenPreference ??
  (() => ({ open: true, shouldPersist: false }));

assert.deepEqual(
  resolveShellNavOpenPreference(null, false),
  { open: false, shouldPersist: true },
  "first-run minimization seeds the separate normal-nav preference as collapsed",
);

assert.deepEqual(
  resolveShellNavOpenPreference(true, false),
  { open: true, shouldPersist: false },
  "first-run minimization never overwrites an existing user preference",
);

assert.equal(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: { nav: 30, list: 25, detail: 45 },
    groupSize: 375,
    defaultPanelPixels: { nav: 240, list: 260 },
    collapsedNavPixels: 56,
    isMobile: true,
  }),
  undefined,
  "mobile drawers never restore desktop resizable-panel layouts",
);

assert.equal(
  resolveShellLayoutPersistence({
    isMobile: true,
    navCollapsed: false,
    layout: { nav: 30, list: 25, detail: 45 },
    savedExpandedLayout: { nav: 30, list: 25, detail: 45 },
  }),
  undefined,
  "mobile drawer layouts never overwrite desktop persistence",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 35, detail: 65 },
    groupSize: 1_000,
    defaultPanelPixels: { nav: 260 },
    collapsedNavPixels: 0,
    isMobile: false,
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
    collapsedNavPixels: 0,
    isMobile: false,
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
    collapsedNavPixels: 56,
    isMobile: false,
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
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 24, detail: 76 },
  "a legacy collapsed rail layout restores an expanded default before applying the remembered open preference",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 4.667, detail: 95.333 },
    groupSize: 1_200,
    defaultPanelPixels: { nav: 240 },
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 20, detail: 80 },
  "rounded persisted rail percentages are still recognized as collapsed layouts",
);

const legacyCollapsedNormal = { nav: 5.6, list: 27, detail: 67.4 };
assert.equal(
  isShellNavCollapsedLayout({
    layout: legacyCollapsedNormal,
    panelIds: ["nav", "list", "detail"],
    groupSize: 1_000,
    collapsedNavPixels: 56,
  }),
  true,
  "legacy normal rail layouts are identified for collapsed-preference migration",
);
assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: legacyCollapsedNormal,
    groupSize: 1_000,
    defaultPanelPixels: { nav: 240, list: 260 },
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 24, list: 26, detail: 50 },
  "legacy collapsed layouts reconstruct a safe complete expanded fallback",
);

const normalExpanded = { nav: 34, list: 27, detail: 39 };
const initialCollapsedNormal = { nav: 5.6, list: 55.4, detail: 39 };
assert.deepEqual(
  resolveShellLayoutPersistence({
    isMobile: false,
    navCollapsed: true,
    layout: initialCollapsedNormal,
    savedExpandedLayout: normalExpanded,
    previousCollapsedLayout: undefined,
  }),
  normalExpanded,
  "the collapse redistribution itself does not change the saved expanded list/detail layout",
);
const savedNormalLayout = resolveShellLayoutPersistence({
  isMobile: false,
  navCollapsed: true,
  layout: { nav: 5.6, list: 59.4, detail: 35 },
  savedExpandedLayout: normalExpanded,
  previousCollapsedLayout: initialCollapsedNormal,
});
assert.deepEqual(
  savedNormalLayout,
  { nav: 34, list: 31, detail: 35 },
  "list/detail separator changes in the normal nav rail merge into the expanded layout without replacing nav width",
);
assert.deepEqual(
  resolveShellLayoutPersistence({
    isMobile: false,
    navCollapsed: false,
    layout: normalExpanded,
    savedExpandedLayout: undefined,
    previousCollapsedLayout: undefined,
  }),
  normalExpanded,
  "expanded desktop callbacks still persist their complete layout",
);
assert.equal(
  resolveShellLayoutPersistence({
    isMobile: false,
    navCollapsed: true,
    layout: normalExpanded,
    savedExpandedLayout: normalExpanded,
    previousCollapsedLayout: undefined,
  }),
  undefined,
  "a stale collapsed imperative state cannot establish an expanded layout as the collapsed baseline",
);
assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: savedNormalLayout,
    groupSize: 1_000,
    defaultPanelPixels: { nav: 240, list: 260 },
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  savedNormalLayout,
  "normal navigation restores the merged list/detail proportions across collapse -> Chat -> return",
);
assert.equal(
  Object.values(savedNormalLayout ?? {}).reduce((sum, size) => sum + size, 0),
  100,
  "the merged normal layout remains a complete valid group layout",
);

const chatExpanded = { nav: 31, detail: 69 };
const savedChatLayout = resolveShellLayoutPersistence({
  isMobile: false,
  navCollapsed: true,
  layout: { nav: 0, detail: 100 },
  savedExpandedLayout: chatExpanded,
  previousCollapsedLayout: undefined,
});
assert.deepEqual(
  savedChatLayout,
  chatExpanded,
  "Chat zero-collapse callbacks preserve its last expanded contextual width",
);
assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: savedChatLayout,
    groupSize: 1_000,
    defaultPanelPixels: { nav: 260 },
    collapsedNavPixels: 0,
    isMobile: false,
  }),
  chatExpanded,
  "Chat keeps its own last expanded width across contextual transitions",
);

assert.equal(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: undefined,
    groupSize: 400,
    defaultPanelPixels: { nav: 240, list: 260 },
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  undefined,
  "impossible pixel defaults never produce negative detail proportions",
);

assert.match(
  shell,
  /const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";/,
  "the sidebar preference persists under the cave:shell:nav-open key",
);

assert.match(
  shell,
  /minimizedGroupsRef\.current\.add\(groupId\);\s*seedNavOpenPref\(false\);\s*markShellMinimizeApplied\(groupId\);/,
  "first-run minimization seeds the collapsed preference before recording completion",
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
  /import \{[\s\S]*isShellNavCollapsedLayout,[\s\S]*resolveShellDestinationLayout,[\s\S]*resolveShellLayoutPersistence,[\s\S]*resolveShellNavOpenPreference,[\s\S]*\} from "\.\/shell-layout";/,
  "Shell uses the tested destination, persistence-merge, and preference helpers",
);

const destinationLayoutEffect =
  shell.match(/const layoutPersistenceGroupRef = useRef<string \| null>\(null\);[\s\S]*?\}, \[mounted, isMobile, groupId, chatContextual, defaultLayout, twoPane, navPolicy\]\);/)?.[0] ?? "";
assert.ok(destinationLayoutEffect.length > 0, "the destination group restoration effect exists");
assert.match(
  destinationLayoutEffect,
  /if \(!mounted \|\| isMobile\) \{[\s\S]*?layoutPersistenceGroupRef\.current = null;[\s\S]*?restoredGroupRef\.current = null;[\s\S]*?return;/,
  "mobile mode disarms persistence and desktop restoration until the viewport returns",
);
assert.match(
  destinationLayoutEffect,
  /Array\.from\(groupElement\.children\)\.reduce\([\s\S]*?child\.hasAttribute\("data-panel"\)[\s\S]*?child\.offsetWidth/,
  "destination defaults use the panel library's available panel width rather than the group width including separators",
);
assert.match(
  destinationLayoutEffect,
  /if \(\s*!chatContextual &&\s*isShellNavCollapsedLayout\(\{[\s\S]*?layout: defaultLayout,[\s\S]*?collapsedNavPixels: NAV_RAIL_PX,[\s\S]*?\}\)\s*\) \{\s*seedNavOpenPref\(false\);\s*\}[\s\S]*?resolveShellDestinationLayout\(/,
  "legacy collapsed normal layouts migrate the collapsed preference before their expanded fallback is restored",
);
assert.match(
  destinationLayoutEffect,
  /resolveShellDestinationLayout\(\{[\s\S]*?savedLayout: defaultLayout,[\s\S]*?defaultPanelPixels: \{ nav: chatContextual \? 260 : NAV_OPEN_PX, \.\.\.\(!twoPane && \{ list: 260 \}\) \},[\s\S]*?collapsedNavPixels: chatContextual \? 0 : NAV_RAIL_PX,[\s\S]*?isMobile,/,
  "every desktop group transition resolves an expanded destination layout from its own saved width or pixel defaults",
);
assert.match(
  destinationLayoutEffect,
  /expandedLayoutRef\.current = \{ groupId, layout: destinationLayout \};\s*collapsedLayoutRef\.current = null;\s*layoutPersistenceGroupRef\.current = groupId;\s*restoredGroupRef\.current = groupId;\s*group\.setLayout\(destinationLayout\);/,
  "the destination group resets collapsed deltas, remembers, and arms its complete expanded layout before applying it",
);
assert.match(
  destinationLayoutEffect,
  /const rememberedNavOpen =\s*navPolicy === "remembered" \? seedNavOpenPref\(false\) : null;[\s\S]*?expandedLayoutRef\.current = \{ groupId, layout: destinationLayout \};[\s\S]*?group\.setLayout\(destinationLayout\);\s*if \(rememberedNavOpen !== null\) \{\s*railAutoCollapsedNavRef\.current = false;\s*userOverrodeNavRef\.current = false;\s*applyPanelOpenState\(navRef\.current, rememberedNavOpen\);\s*setNavOpen\(rememberedNavOpen\);\s*minimizedGroupsRef\.current\.add\(groupId\);\s*markShellMinimizeApplied\(groupId\);\s*\}/,
  "normal destination restoration applies the remembered state before paint while retaining the expanded layout",
);
assert.match(
  destinationLayoutEffect,
  /\}, \[mounted, isMobile, groupId, chatContextual, defaultLayout, twoPane, navPolicy\]\);/,
  "destination restoration reruns with the active nav policy",
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
  /const pref = seedNavOpenPref\(false\);/,
  "boot backfills a missing collapsed default preference while preserving an existing preference",
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
  /defaultLayout=\{isMobile \? undefined : defaultLayout\}/,
  "mobile rendering does not feed desktop saved layouts into the resizable group",
);
assert.match(
  shell,
  /onLayoutChanged=\{\(layout, detail\) => \{\s*if \(layoutPersistenceGroupRef\.current !== groupId\) return;[\s\S]*?const navCollapsed = navRef\.current\?\.isCollapsed\(\) \?\? true;[\s\S]*?const persistedLayout = resolveShellLayoutPersistence\(\{[\s\S]*?navCollapsed,[\s\S]*?savedExpandedLayout:\s*expandedLayoutRef\.current\?\.groupId === groupId[\s\S]*?previousCollapsedLayout:\s*collapsedLayoutRef\.current\?\.groupId === groupId[\s\S]*?\}\);[\s\S]*?if \(!persistedLayout\) return;\s*collapsedLayoutRef\.current = navCollapsed \? \{ groupId, layout \} : null;\s*expandedLayoutRef\.current = \{ groupId, layout: persistedLayout \};\s*onLayoutChanged\(persistedLayout, detail\);\s*\}\}/,
  "desktop collapsed callbacks merge non-nav changes into each group's expanded layout while mobile and group-swap churn stay disarmed",
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
