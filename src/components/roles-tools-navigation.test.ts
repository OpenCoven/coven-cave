// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const palette = await readFile(new URL("./command-palette.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const marketplaceView = await readFile(new URL("./marketplace-view.tsx", import.meta.url), "utf8");
const marketplaceCard = await readFile(new URL("./marketplace/marketplace-card.tsx", import.meta.url), "utf8");
const marketplaceDetail = await readFile(new URL("./marketplace/marketplace-detail.tsx", import.meta.url), "utf8");
const marketplaceConfigure = await readFile(new URL("./marketplace/marketplace-configure.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const rolesRoute = [
  await readFile(new URL("../app/api/roles/route.ts", import.meta.url), "utf8"),
  await readFile(new URL("../lib/server/role-entries.ts", import.meta.url), "utf8"),
].join("\n");
const workspaceMode = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const shortcutsCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
const shortcutsSheet = await readFile(new URL("./shortcuts-sheet.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

// ── Roles + Marketplace are ONE merged hub surface ──────────────────────────
// The store (Browse) and the familiars' setup (Skills / Build) live on a
// single Marketplace page with a section tablist. The old modes stay in the
// WorkspaceMode union so deep links and navigate-mode events keep working —
// roles/capabilities land on Browse while those sections are hidden.

assert.match(workspaceMode, /\|\s*"marketplace"/, "Marketplace should be a first-class workspace mode");
assert.match(workspaceMode, /\|\s*"roles"/, "roles mode survives as a deep link into the hub");
assert.match(workspaceMode, /\|\s*"capabilities"/, "capabilities mode survives as a deep link into the hub");

assert.match(
  workspace,
  /mode === "marketplace" \|\| mode === "roles" \|\| mode === "capabilities"[\s\S]*?<MarketplaceView\s*\n\s*key=\{mode\}/,
  "Workspace should render the merged Marketplace hub for the marketplace, roles, and capabilities modes (keyed so deep links remount onto their section)",
);
assert.match(
  workspace,
  /initialSection=\{mode === "roles" \? "roles" : mode === "capabilities" \? "capabilities" : "browse"\}/,
  "Deep-link modes should map onto the hub's sections",
);
assert.doesNotMatch(
  workspace,
  /PluginsView/,
  "The standalone Roles page (PluginsView) is retired — the hub owns roles, skills, and capabilities",
);

assert.doesNotMatch(
  workspace,
  /setMode\("workflows"\)|mode === "workflows"|<WorkflowsView\b/,
  "Workspace should not expose a top-level Workflows page",
);

// ── Sidebar: one Tools entry for the merged hub ──────────────────────────────
assert.match(
  sidebar,
  /\{ id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description: "Browse the store and manage your familiars' crafts and skills", quiet: true \},/,
  "Sidebar navigation should expose the merged Marketplace hub with a description covering both halves",
);
assert.doesNotMatch(
  sidebar,
  /\{ id: "roles", label: "Roles"/,
  "The separate Roles sidebar entry is retired — roles live inside the Marketplace hub",
);
assert.doesNotMatch(sidebar, /addons\?\.roles/, "The roles add-on gate is retired from the sidebar");
assert.doesNotMatch(palette, /addons\?\.roles/, "The roles add-on gate is retired from the command palette");
// The roles/capabilities → marketplace aliasing moved into the pure row-state
// helper (lib/sidebar-nav-state) that the sidebar derives every row from.
const sidebarNavState = await readFile(new URL("../lib/sidebar-nav-state.ts", import.meta.url), "utf8");
assert.match(
  sidebarNavState,
  /roles: "marketplace",\s*\n\s*capabilities: "marketplace",/,
  "The Marketplace entry stays lit while a deep-linked roles/capabilities mode is active",
);
assert.match(
  sidebar,
  /state=\{sidebarRowState\(fm\.id, mode, props\.splitPageModes\)\}/,
  "Sidebar rows derive their highlight (marketplace + journal aliasing, cave-s9p6) from sidebarRowState",
);

// Settings: no separate plugins section, and the roles add-on toggle is gone
// (the hub is always visible, like the old Marketplace page was).
assert.doesNotMatch(settings, /PluginsView/, "Settings must not render PluginsView");
assert.doesNotMatch(settings, /"plugins"/, "Settings must not declare a plugins section");
assert.doesNotMatch(settings, /key: "roles"/, "Settings must not offer a roles add-on toggle — the merged hub is not gated");

// ── The hub composes the store and the setup views ───────────────────────────
// Roles and Capabilities are hidden from the hub. The RolesSection component +
// its CSS + the addons.roles config flag were DELETED as dead code (cave-vp4h);
// the CapabilitiesViewSurface, capabilities-normalize, and their CSS followed
// (cave-4n7j — git history keeps them). /api/roles and /api/capabilities stay:
// they serve live role definitions and the Brain tab / inspector capability
// chips. "roles" and "capabilities" deep links land on Browse.
{
  const { existsSync } = await import("node:fs");
  assert.equal(
    existsSync(new URL("./marketplace/roles-section.tsx", import.meta.url)),
    false,
    "roles-section.tsx stays deleted (was dead code — nothing rendered it)",
  );
  assert.equal(
    existsSync(new URL("./capabilities-view.tsx", import.meta.url)),
    false,
    "capabilities-view.tsx stays deleted with the retired Capabilities section (cave-4n7j)",
  );
  assert.equal(
    existsSync(new URL("./capabilities-normalize.ts", import.meta.url)),
    false,
    "capabilities-normalize.ts stays deleted with the retired Capabilities section",
  );
  assert.equal(
    existsSync(new URL("./capability-card.tsx", import.meta.url)),
    true,
    "capability-card.tsx stays — the familiar-studio Brain tab still renders it",
  );
}
assert.doesNotMatch(marketplaceView, /import \{ RolesSection/, "the Roles section is not imported");
assert.doesNotMatch(marketplaceView, /<RolesSection/, "the Roles section does not render");
assert.doesNotMatch(css, /plugins-role-|marketplace-roles-summary/, "roles-section-only CSS stays deleted");
assert.doesNotMatch(css, /\.capabilities-view |\.capabilities-decision|\.capability-meta-/, "capabilities-surface CSS stays deleted");
assert.doesNotMatch(marketplaceView, /\{ id: "roles", label: "Roles"/, "no Roles tab while hidden");
assert.doesNotMatch(marketplaceView, /\{ id: "capabilities", label: "Capabilities"/, "no Capabilities tab — the section is retired from the hub");
assert.match(
  marketplaceView,
  /initialSection === "roles" \|\| initialSection === "capabilities" \? "browse" : initialSection/,
  "'roles' and 'capabilities' deep links land on Browse",
);
assert.match(marketplaceView, /import \{ SkillBrowser, type SkillBrowserEntry \} from "@\/components\/skill-browser"/, "hub renders the Skills browser");
assert.match(marketplaceView, /SkillDetailDrawer,/, "hub mounts the skill detail drawer for role-card skill chips");
assert.doesNotMatch(marketplaceView, /CapabilitiesViewSurface|capabilities-view/, "the hub no longer imports or renders the Capabilities surface");
assert.match(
  marketplaceView,
  /initialSection\?: MarketplaceSection/,
  "hub accepts an initial section for workspace deep links",
);

// Section tablist — the header is a single slim row. The shared Tabs
// primitive (underline variant) supplies role=tablist/tab, aria-selected,
// the roving tabindex + arrow keys, and the marketplace-tab-* /
// marketplace-panel-* aria wiring via idPrefix; the hub only feeds it items.
assert.match(marketplaceView, /<Tabs\s*\n\s*items=\{sectionTabs\}/, "the section bar delegates to the shared Tabs primitive");
assert.match(marketplaceView, /ariaLabel="Marketplace sections"/, "the section tablist keeps its accessible name");
assert.match(marketplaceView, /idPrefix="marketplace"/, "idPrefix wires marketplace-tab-* ids + aria-controls to the panels");
assert.match(marketplaceView, /const sectionTabs = useMemo/, "the header derives live per-section counts for the tab badges");
assert.match(marketplaceView, /title: SECTION_HINT\[s\.id\]/, "the old hero subtitle survives as the tab tooltip");
assert.doesNotMatch(marketplaceView, /marketplace-section-card/, "the stat-card hero tablist is retired — the header stays ultraminimal");
assert.doesNotMatch(marketplaceView, /SECTION_COPY|StatPill/, "the hero title/subtitle block and stat pills are retired with it");
for (const id of ["browse", "crafts", "skills", "build"]) {
  assert.match(
    marketplaceView,
    new RegExp(`role="tabpanel"\\s*\\n\\s*id="marketplace-panel-${id}"\\s*\\n\\s*aria-labelledby="marketplace-tab-${id}"`),
    `the ${id} panel is a tabpanel labelled by its tab`,
  );
}
assert.doesNotMatch(marketplaceView, /marketplace-panel-roles/, "no roles tabpanel while the section is hidden");
assert.doesNotMatch(marketplaceView, /marketplace-panel-capabilities/, "no capabilities tabpanel — the section is retired");

// One search field, scoped per section; the self-contained Build surface owns
// its flow so the hub hides the shared search there ("capabilities" stays in
// the guard only for type-safety — the section is unreachable).
assert.match(marketplaceView, /aria-label=\{SEARCH_LABEL\[section\]\}/, "the search input names the active section");
assert.match(
  marketplaceView,
  /\{section !== "capabilities" && section !== "build" \? \(\s*\n\s*<SearchInput/,
  "the shared search hides on the Build section",
);

// The store rail cross-links into the setup sections, so Browse stays aware of
// what your familiars already have.
assert.match(marketplaceView, /Your setup/, "the Browse rail carries a Your-setup group");
assert.doesNotMatch(marketplaceView, /selectSection\("roles"\)/, "no rail jump to Roles while the section is hidden");
assert.match(marketplaceView, /onClick=\{\(\) => selectSection\("crafts"\)\}/, "the rail jumps to Crafts");
assert.match(marketplaceView, /onClick=\{\(\) => selectSection\("skills"\)\}/, "the rail jumps to Skills");
assert.doesNotMatch(marketplaceView, /selectSection\("capabilities"\)/, "no rail jump to the retired Capabilities section");
assert.match(marketplaceView, /groupPluginsByCategory/, "Browse derives standardized category groups from the visible plugin set");
assert.match(marketplaceView, /className="marketplace-category-stack"/, "Browse renders a grouped category stack instead of one flat card grid");
assert.match(marketplaceView, /className="marketplace-category-group"/, "each Marketplace category has a stable grouped section hook");
assert.match(marketplaceView, /className="marketplace-category-grid"/, "each category group uses the same responsive card grid");
assert.match(css, /\.marketplace-category-stack \{[\s\S]*?flex-direction: column/, "Marketplace category stack has stable vertical rhythm");
assert.match(css, /\.marketplace-category-group__head \{[\s\S]*?border-bottom/, "Marketplace category groups use quiet structural dividers");
assert.match(css, /\.marketplace-category-grid \{[\s\S]*?grid-template-columns/, "Marketplace category groups use a stable responsive grid");
// The kind filter + sort moved out of the header into the Browse toolbar so
// the header stays one row; the toolbar also carries the result context line.
assert.match(marketplaceView, /className="marketplace-browse-summary mb-4"/, "Browse keeps a toolbar row above the grid");
assert.match(marketplaceView, /ariaLabel="Filter plugins by type"/, "the kind filter lives in the Browse toolbar");
assert.match(marketplaceView, /label="Sort plugins"/, "the sort select lives in the Browse toolbar");
assert.match(css, /\.marketplace-browse-summary \{[\s\S]*?justify-content: space-between/, "the Browse toolbar keeps context and controls apart");
assert.match(css, /\.marketplace-card \{[\s\S]*?min-height:/, "Marketplace cards reserve stable height across categories");

// Browse cards are decision cards: they expose setup effort, capability fit,
// and role fit before someone opens the detail drawer.
assert.match(marketplaceCard, /function setupEffortLabel\(plugin: MarketplacePlugin\)/, "Browse cards derive setup effort copy");
assert.match(marketplaceCard, /function capabilityPreview\(plugin: MarketplacePlugin\)/, "Browse cards derive a capability preview");
assert.match(marketplaceCard, /function roleFitLabel\(plugin: MarketplacePlugin\)/, "Browse cards summarize role affinity");
assert.match(marketplaceCard, /className="marketplace-card__decision"/, "Browse cards render a compact decision metadata line");
assert.match(marketplaceCard, /className="marketplace-card__decision-chip"/, "decision metadata uses stable chip hooks");
assert.match(css, /\.marketplace-card__decision \{[\s\S]*?display: flex;/, "Browse card decision metadata has a stable flex layout");
assert.match(css, /\.marketplace-card__decision-chip \{[\s\S]*?max-width:/, "Browse card decision chips clamp long copy");

// The detail drawer repeats those decision facts at a larger, readable scale
// so opening a card clarifies the install decision instead of hiding it.
assert.match(marketplaceDetail, /function detailDecisionItems\(plugin: MarketplacePlugin\)/, "detail drawer derives install decision items");
assert.match(marketplaceDetail, /className="marketplace-detail__decision-grid"/, "detail drawer renders a stable decision summary grid");
assert.match(marketplaceDetail, /className="marketplace-detail__decision-card"/, "detail drawer renders decision facts as compact cards");
assert.match(marketplaceDetail, /Setup effort/, "detail drawer labels setup effort explicitly");
assert.match(marketplaceDetail, /Capability fit/, "detail drawer labels capability fit explicitly");
assert.match(marketplaceDetail, /Role fit/, "detail drawer labels role fit explicitly");
assert.match(css, /\.marketplace-detail__decision-grid \{[\s\S]*?grid-template-columns/, "detail decision summary uses a stable grid");
assert.match(css, /\.marketplace-detail__decision-card \{[\s\S]*?min-height:/, "detail decision cards reserve stable height");

// ── Role cards keep their capability map (MCP servers first-class) ──────────
assert.match(rolesRoute, /mcpServers:\s*string\[\]/, "Roles API should expose mcpServers as a first-class role capability list");
assert.match(rolesRoute, /mcpServers:\s*parseRoleMcpServers\(text\)/, "Roles API should read mcpServers plus supported MCP aliases from ROLE.md");

// --- Keyboard shortcuts sheet (CHAT-D11-03) ---

assert.match(
  shortcutsCatalog,
  /export const SHORTCUT_GROUPS/,
  "Keyboard shortcut catalog should live in src/lib/keyboard-shortcuts.ts",
);

assert.match(
  shortcutsCatalog,
  /Panels & navigation[\s\S]*Composer[\s\S]*Slash menu[\s\S]*Other/,
  "Catalog should group shortcuts: Panels & navigation / Composer / Slash menu / Other",
);

assert.match(
  shortcutsSheet,
  /from "@\/components\/ui\/modal"/,
  "Shortcuts sheet should use the shared a11y Modal (focus trap + Esc come free)",
);

assert.match(
  shortcutsSheet,
  /useKeySymbols[\s\S]*SHORTCUT_GROUPS\.map[\s\S]*platformizeHint/,
  "Sheet should render the catalog with platform-aware key glyphs, never hardcoded ⌘/Ctrl",
);

assert.match(
  workspace,
  /e\.key === "\/"[\s\S]{0,200}setShortcutsOpen/,
  "⌘/ (Ctrl+/ off-Mac) should toggle the shortcuts sheet from anywhere",
);

assert.match(
  workspace,
  /e\.key === "\?" && !isEditableTarget\(e\.target\)/,
  "Bare ? should open the sheet only when focus is outside an editable control",
);

assert.match(
  workspace,
  /case "\/shortcuts":[\s\S]{0,80}setShortcutsOpen\(true\)/,
  "/shortcuts slash command should open the sheet via handleSlashIntent",
);

assert.match(
  workspace,
  /\{shortcutsOpen && <ShortcutsSheet open/,
  "Workspace should mount the lazy ShortcutsSheet only after its open intent",
);

assert.match(
  slashCommands,
  /name: "\/shortcuts", aliases: \["\/keys"\]/,
  "/shortcuts (alias /keys) should be a first-class slash command",
);

assert.match(
  slashCommands,
  /lines\.push\("Keyboard"\)[\s\S]*SHORTCUT_GROUPS[\s\S]*neutralizeKeys/,
  "formatHelp should append a Keyboard section sourced from the shared catalog",
);

assert.match(
  slashCommands,
  /keyboard shortcuts sheet/,
  "/help footer should mention the shortcuts sheet so it stays discoverable",
);

// ── CHAT-D13-05: landmark hygiene (live axe findings) ───────────────────────
// page-has-heading-one: the shell renders no visible page title, so the
// workspace detail pane carries a visually-hidden h1 naming the active
// surface. landmark-unique: the shell's complementary panels need distinct
// accessible names.
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /<h1 className="sr-only">\s*\{\(isRoleSurfaceMode\(mode\)[\s\S]{0,220}?WORKSPACE_MODE_TITLES\[mode\]\) \?\? "CovenCave"\}\s*<\/h1>/,
  "Workspace detail must render a visually-hidden h1 naming the active surface (axe page-has-heading-one) — including Role Surface rooms",
);
assert.match(
  workspace,
  /const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = \{/,
  "The h1 title map must cover every WorkspaceMode (Record enforces exhaustiveness)",
);

assert.match(
  shell,
  /className=\{`shell-nav\$\{[^}]*\}`\}[\s\S]*?aria-label="Sidebar"/,
  "Shell nav panel must carry a distinct accessible name (axe landmark-unique)",
);
assert.match(
  shell,
  /<aside className="shell-list" aria-label="List pane">/,
  "Shell list panel must carry a distinct accessible name (axe landmark-unique)",
);
// The right companion (agent) panel was removed with the drag-to-split change.

// ── Marketplace hub actions announce to the shared live region ───────────────
// Install / remove / role-toggle surface their outcome as visual-only <p>
// banners (not toasts), so they mirror to the assertive/polite live region —
// otherwise these core actions are silent to screen-reader users.
assert.match(
  marketplaceView,
  /import \{ useAnnouncer \} from "@\/components\/ui\/live-region"/,
  "the marketplace hub wires the shared announcer",
);
assert.match(marketplaceView, /announce\("Added to your setup", "polite"\)/, "installing a plugin is announced");
assert.match(marketplaceView, /announce\("Removed from your setup", "polite"\)/, "removing a plugin is announced");
// (The role-toggle announcement lives in the hidden Roles plumbing — restored
// with the section.)
assert.match(marketplaceView, /announce\(msg, "assertive"\)/, "a failed hub action is announced assertively");

// cave-owvm: install/uninstall clear any prior error banner on a fresh attempt —
// `error` was only ever set on failure and otherwise never cleared without a
// reload, so a stale "install failed" alert used to persist across Browse.
assert.match(
  marketplaceView,
  /const add = useCallback\(async[\s\S]*?markBusy\(id, true\);[\s\S]*?setError\(null\);/,
  "add() clears the error banner on a fresh install attempt",
);
assert.match(
  marketplaceView,
  /const remove = useCallback\(async[\s\S]*?markBusy\(id, true\);[\s\S]*?setError\(null\);/,
  "remove() clears the error banner on a fresh uninstall attempt",
);

// cave-4kl7: the configure modal aborts a superseded config load (the dialog
// stays mounted between opens, so a late load must not clobber freshly-seeded
// fields), and tracks in-flight saves as a Set so concurrent field saves keep
// their own spinner rather than one clearing the other.
assert.match(marketplaceConfigure, /const loadCtlRef = useRef<AbortController \| null>\(null\)/, "config load has an abort controller");
assert.match(marketplaceConfigure, /loadCtlRef\.current\?\.abort\(\);[\s\S]*?new AbortController\(\)/, "each load aborts the prior one");
assert.match(marketplaceConfigure, /if \(ctl\.signal\.aborted\) return/, "a superseded load response is dropped");
assert.match(marketplaceConfigure, /useEffect\(\(\) => \(\) => loadCtlRef\.current\?\.abort\(\), \[\]\)/, "the in-flight load aborts on unmount");
assert.match(marketplaceConfigure, /const \[busyKeys, setBusyKeys\] = useState<Set<string>>/, "saving fields are tracked as a Set, not a scalar");
assert.match(marketplaceConfigure, /loading=\{busyKeys\.has\(f\.key\)\}/, "each field's spinner keys off its own membership in the busy Set");

console.log("roles-tools-navigation.test.ts OK");
