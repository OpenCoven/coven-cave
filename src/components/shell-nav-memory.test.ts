// @ts-nocheck
// Sidebar open-state memory belongs only to remembered navigation routes.
// Chat uses a separate contextual sidebar group that opens on entry without
// reading or overwriting the global cave:shell:nav-open preference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as shellLayout from "./shell-layout.ts";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const compactWhitespace = (input: string) => input.replace(/\s+/g, " ").trim();
const {
  resolveShellDestinationLayout,
  resolveShellNavWidth,
  SHELL_NAV_DEFAULT_PX,
} = shellLayout;
const isShellNavCollapsedLayout =
  shellLayout.isShellNavCollapsedLayout ??
  (() => false);
const resolveShellLayoutPersistence =
  shellLayout.resolveShellLayoutPersistence ??
  (() => undefined);
const resolveShellNavOpenPreference =
  shellLayout.resolveShellNavOpenPreference ??
  (() => ({ open: true, shouldPersist: false }));
const resolveShellNavPolicyHandoff =
  shellLayout.resolveShellNavPolicyHandoff ?? (() => null);

assert.equal(resolveShellNavWidth("300"), 300, "a valid persisted nav width is retained");
assert.equal(resolveShellNavWidth("999"), 420, "nav width is clamped to the desktop maximum");
assert.equal(resolveShellNavWidth("not-a-width"), 240, "invalid nav widths use the desktop default");
assert.equal(resolveShellNavWidth(null), 240, "missing nav widths use the desktop default");
assert.equal(resolveShellNavWidth("Infinity"), 240, "infinite nav widths use the desktop default");
assert.equal(resolveShellNavWidth("0"), 220, "zero nav widths are clamped to the desktop minimum");
const storedNavWidth = resolveShellNavWidth("300");

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

// Leaving Chat for a remembered destination (Home, Tasks, Rituals, …) must not
// collapse the sidebar the user is looking at. Chat never maintains
// cave:shell:nav-open, and first-run minimization seeds it false, so the
// remembered path would otherwise read a `false` nobody chose.
const chatToHome = {
  fromPolicy: "chat-contextual",
  toPolicy: "remembered",
  visibleNavOpen: true,
  persistedOpen: false,
  persistedFromUser: false,
};

assert.deepEqual(
  resolveShellNavPolicyHandoff(chatToHome),
  { open: true, persist: true },
  "leaving Chat carries the visible sidebar forward over a seeded collapse",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, persistedFromUser: true }),
  null,
  "a sidebar the user collapsed themselves stays collapsed when leaving Chat",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, visibleNavOpen: false }),
  null,
  "leaving Chat with the nav already closed has nothing to carry",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, persistedOpen: true }),
  null,
  "an already-open preference needs no handoff",
);

assert.deepEqual(
  resolveShellNavPolicyHandoff({ ...chatToHome, persistedOpen: null }),
  { open: true, persist: true },
  "an unwritten preference is carried like a seeded one",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, fromPolicy: "remembered" }),
  null,
  "remembered-to-remembered navigation keeps using the stored preference",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, toPolicy: "visit-collapsed" }),
  null,
  "policies that collapse on purpose are never overridden by the handoff",
);

assert.equal(
  resolveShellNavPolicyHandoff({ ...chatToHome, fromPolicy: null }),
  null,
  "the first settled render is not a policy transition",
);

// The handoff has to run BEFORE the destination-layout effect reads the
// preference, and useLayoutEffect order is declaration order.
assert.ok(
  shell.indexOf("resolveShellNavPolicyHandoff") <
    shell.indexOf("const navPrefArmedGroupRef"),
  "the policy handoff effect is declared above the destination-layout restore",
);

// Only the user-driven resize may claim authorship of the preference.
assert.ok(
  compactWhitespace(shell).includes('writeNavOpenPref(open, "user")'),
  "the user-driven resize records itself as the authoritative preference",
);

assert.equal(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: { nav: 30, list: 25, detail: 45 },
    groupSize: 375,
    defaultPanelPixels: { nav: 240, list: 260 },
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
    collapsedNavPixels: 0,
    isMobile: false,
  }),
  { nav: 24, detail: 76 },
  "Chat projects the shared nav width without inheriting a normal group's detail layout",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 24, detail: 76 },
    groupSize: 1_000,
    defaultPanelPixels: {},
    preferredNavPixels: storedNavWidth,
    collapsedNavPixels: 0,
    isMobile: false,
  }),
  { nav: 30, detail: 70 },
  "Chat applies the stored 300px nav width in its contextual two-panel group",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: { nav: 24, list: 26, detail: 50 },
    groupSize: 1_000,
    defaultPanelPixels: { list: 260 },
    preferredNavPixels: storedNavWidth,
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 30, list: 26, detail: 44 },
  "Home applies the stored 300px nav width while retaining its saved list allocation",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: { nav: 24, list: 60, detail: 16 },
    groupSize: 700,
    defaultPanelPixels: { nav: 240, list: 260 },
    preferredNavPixels: 420,
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 60, list: 37.143, detail: 2.857 },
  "an infeasible saved list allocation falls back to its default while preserving the requested nav width",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "detail"],
    savedLayout: { nav: 0, detail: 100 },
    groupSize: 1_000,
    defaultPanelPixels: { nav: 260 },
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
    collapsedNavPixels: 0,
    isMobile: false,
  }),
  { nav: 24, detail: 76 },
  "Chat falls back to the shared default when no nonzero saved Chat width exists",
);

assert.deepEqual(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: undefined,
    groupSize: 1_000,
    defaultPanelPixels: { nav: 240, list: 260 },
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
    collapsedNavPixels: 56,
    isMobile: false,
  }),
  { nav: 24, list: 31, detail: 45 },
  "normal navigation restores its merged list width while projecting the shared nav width",
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
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
    collapsedNavPixels: 0,
    isMobile: false,
  }),
  { nav: 24, detail: 76 },
  "Chat projects the shared nav width across contextual transitions",
);

assert.equal(
  resolveShellDestinationLayout({
    panelIds: ["nav", "list", "detail"],
    savedLayout: undefined,
    groupSize: 400,
    defaultPanelPixels: { nav: 240, list: 260 },
    preferredNavPixels: SHELL_NAV_DEFAULT_PX,
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
  /const NAV_WIDTH_PREF_KEY = "cave:shell:nav-width";/,
  "the shared sidebar width persists under exactly cave:shell:nav-width",
);
assert.match(
  shell,
  /function readNavWidthPref\(\): string \| null \{[\s\S]*?window\.localStorage\.getItem\(NAV_WIDTH_PREF_KEY\)[\s\S]*?catch \{\s*\n?\s*return null;/,
  "reading the shared width tolerates unavailable storage",
);
assert.match(
  shell,
  /function writeNavWidthPref\(width: number\): void \{[\s\S]*?!Number\.isFinite\(width\)[\s\S]*?window\.localStorage\.setItem\(NAV_WIDTH_PREF_KEY, String\(width\)\)/,
  "writing the shared width accepts only finite pixels and safely stringifies them",
);
assert.match(
  shell,
  /const \[preferredNavWidth, setPreferredNavWidth\] = useState\(\(\) =>\s*resolveShellNavWidth\(readNavWidthPref\(\)\),\s*\);/,
  "the active shared width is resolved through the validated Task 2 helper",
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
  /import \{[\s\S]*isShellNavCollapsedLayout,[\s\S]*resolveShellDestinationLayout,[\s\S]*resolveShellLayoutPersistence,[\s\S]*resolveShellNavOpenPreference,[\s\S]*SHELL_NAV_DEFAULT_PX,[\s\S]*SHELL_NAV_MAX_PX,[\s\S]*SHELL_NAV_MIN_PX,[\s\S]*resolveShellNavWidth,[\s\S]*\} from "\.\/shell-layout";/,
  "Shell uses the tested destination, persistence-merge, and preference helpers",
);

const destinationLayoutEffect =
  shell.match(/const navPrefArmedGroupRef = useRef<string \| null>\(null\);[\s\S]*?\}, \[\s*mounted,[\s\S]*?preferredNavWidth,\s*\]\);/)?.[0] ?? "";
assert.ok(destinationLayoutEffect.length > 0, "the destination group restoration effect exists");
assert.match(
  destinationLayoutEffect,
  /if \(!mounted \|\| isMobile\) \{[\s\S]*?layoutPersistenceGroupRef\.current = null;[\s\S]*?restoredGroupRef\.current = null;[\s\S]*?return;/,
  "mobile mode disarms desktop restoration until the viewport returns",
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
  /resolveShellDestinationLayout\(\{[\s\S]*?savedLayout: defaultLayout,[\s\S]*?defaultPanelPixels: \{ \.\.\.\(!twoPane && \{ list: 260 \}\) \},[\s\S]*?preferredNavPixels: preferredNavWidth,[\s\S]*?collapsedNavPixels: isMobile \? 0 : NAV_RAIL_PX,[\s\S]*?isMobile,/,
  "every desktop group transition resolves its own saved/default layout with the active shared nav width",
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
  /\}, \[\s*mounted,\s*isMobile,\s*groupId,\s*chatContextual,\s*defaultLayout,\s*twoPane,\s*navPolicy,\s*preferredNavWidth,\s*\]\);/,
  "destination restoration reruns with the active nav policy and shared width",
);
assert.match(
  shell,
  /onLayoutChanged=\{\(layout, meta\) => \{\s*if \(layoutPersistenceGroupRef\.current !== groupId\) return;[\s\S]*?onLayoutChanged\(persistedLayout, meta\);[\s\S]*?const pixelWidth = navRef\.current\?\.getSize\(\)\.inPixels;[\s\S]*?!isMobile &&\s*meta\.isUserInteraction &&\s*!navCollapsed &&\s*Number\.isFinite\(pixelWidth\) &&\s*!railAutoCollapsedNavRef\.current[\s\S]*?writeNavWidthPref\(normalizedWidth\);[\s\S]*?setPreferredNavWidth\(normalizedWidth\);/,
  "nav width persists only after a completed user separator interaction and retains group, desktop, open, and code-rail guards",
);
const navResizeHandler =
  shell.match(/<Panel\s+id="nav"[\s\S]*?onResize=\{\(size\) => \{[\s\S]*?\n        \}\}/)?.[0] ?? "";
assert.ok(navResizeHandler.length > 0, "the nav panel resize handler exists");
assert.doesNotMatch(
  navResizeHandler,
  /writeNavWidthPref|setPreferredNavWidth/,
  "observer and window-resize Panel.onResize callbacks never persist the shared width",
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
  /onLayoutChanged=\{\(layout, meta\) => \{\s*if \(layoutPersistenceGroupRef\.current !== groupId\) return;[\s\S]*?const navCollapsed = navRef\.current\?\.isCollapsed\(\) \?\? true;[\s\S]*?const persistedLayout = resolveShellLayoutPersistence\(\{[\s\S]*?navCollapsed,[\s\S]*?savedExpandedLayout:\s*expandedLayoutRef\.current\?\.groupId === groupId[\s\S]*?previousCollapsedLayout:\s*collapsedLayoutRef\.current\?\.groupId === groupId[\s\S]*?\}\);[\s\S]*?if \(!persistedLayout\) return;\s*collapsedLayoutRef\.current = navCollapsed \? \{ groupId, layout \} : null;\s*expandedLayoutRef\.current = \{ groupId, layout: persistedLayout \};\s*onLayoutChanged\(persistedLayout, meta\);/,
  "desktop collapsed callbacks merge non-nav changes into each group's expanded layout while mobile and group-swap churn stay disarmed",
);

// Writes are user-driven only: the group must be armed (group-swap layout
// churn is programmatic) and the code-rail auto-collapse must not be active.
assert.match(
  shell,
  /navPolicy === "remembered" &&\s*\n\s*navPrefArmedGroupRef\.current === groupId &&\s*\n\s*!railAutoCollapsedNavRef\.current\s*\n?\s*\) \{[\s\S]*?writeNavOpenPref\(open, "user"\);/,
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
  /const navPeekEnabled = !isMobile && !navOpen;/,
  "hover-to-peek covers every desktop policy now that they all collapse to a rail",
);
assert.match(
  shell,
  /const navPeekVisible = navPeekEnabled && navPeeking;/,
  "peek visibility is synchronously gated so stale state cannot leak onto the first Chat paint",
);
assert.match(
  shell,
  /className=\{`shell-nav\$\{!isMobile && !navOpen \? \(navPeekVisible \? " shell-nav--peek" : " shell-nav--rail"\) : ""\}`\}/,
  "every collapsed desktop sidebar, Chat included, gets rail or peek styling",
);
assert.match(
  shell,
  /onMouseEnter=\{navPeekEnabled \? \(\) => setNavPeeking\(true\) : undefined\}/,
  "hover enter peeks whenever a desktop rail is showing",
);
assert.match(
  shell,
  /onMouseLeave=\{navPeekEnabled \? \(\) => setNavPeeking\(false\) : undefined\}/,
  "hover leave peeks whenever a desktop rail is showing",
);

// The reported bug: collapsing in Chat made the sidebar vanish outright. Only
// mobile — where the nav is an overlay drawer over the content — still closes
// to zero.
assert.match(
  shell,
  /collapsedSize=\{isMobile \? 0 : NAV_RAIL_PX\}/,
  "only mobile drawers close fully; every desktop surface collapses to the icon rail",
);
assert.match(
  shell,
  /collapsedNavPixels: isMobile \? 0 : NAV_RAIL_PX,/,
  "the restored destination layout describes the same collapsed width as the panel",
);
// Chat collapsing to a rail changes what the panel LOOKS like, not who owns the
// remembered preference — the #4404 handoff depends on Chat never writing it.
assert.match(
  shell,
  /!chatContextual &&\s*\n\s*isShellNavCollapsedLayout\(\{/,
  "Chat still never seeds the remembered nav-open preference",
);

// The session list has no rail form, so the collapsed Code room falls back to
// the destination rail rather than rendering a squeezed session list.
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(
  workspace,
  /const contextualNav = navSection === "code" && navOpen \? chatSidebar : sidebar;/,
  "the collapsed Code room renders the destination rail, not the session list",
);
assert.match(
  workspace,
  /onNavOpenChange=\{setNavOpen\}/,
  "workspace tracks the shell's nav open state to drive that fallback",
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
