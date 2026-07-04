// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const palette = await readFile(new URL("./command-palette.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const marketplaceView = await readFile(new URL("./marketplace-view.tsx", import.meta.url), "utf8");
const rolesSection = await readFile(new URL("./marketplace/roles-section.tsx", import.meta.url), "utf8");
const rolesRoute = await readFile(new URL("../app/api/roles/route.ts", import.meta.url), "utf8");
const workspaceMode = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const shortcutsCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
const shortcutsSheet = await readFile(new URL("./shortcuts-sheet.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

// ── Roles + Marketplace are ONE merged hub surface ──────────────────────────
// The store (Browse) and the familiars' setup (Roles / Skills / Capabilities)
// live on a single Marketplace page with a section tablist. The old modes stay
// in the WorkspaceMode union so deep links and navigate-mode events keep
// working — they open the hub on the matching section.

assert.match(workspaceMode, /\|\s*"marketplace"/, "Marketplace should be a first-class workspace mode");
assert.match(workspaceMode, /\|\s*"roles"/, "roles mode survives as a deep link into the hub's Roles section");
assert.match(workspaceMode, /\|\s*"capabilities"/, "capabilities mode survives as a deep link into the hub's Capabilities section");

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
  /\{ id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", group: "tools", description: "Browse the store and manage your familiars' roles, skills, and capabilities" \},/,
  "Sidebar navigation should expose the merged Marketplace hub with a description covering both halves",
);
assert.doesNotMatch(
  sidebar,
  /\{ id: "roles", label: "Roles"/,
  "The separate Roles sidebar entry is retired — roles live inside the Marketplace hub",
);
assert.doesNotMatch(sidebar, /addons\?\.roles/, "The roles add-on gate is retired from the sidebar");
assert.doesNotMatch(palette, /addons\?\.roles/, "The roles add-on gate is retired from the command palette");
assert.match(
  sidebar,
  /fm\.id === "marketplace" && \(mode === "roles" \|\| mode === "capabilities"\)/,
  "The Marketplace entry stays lit while a deep-linked roles/capabilities mode is active",
);

// Settings: no separate plugins section, and the roles add-on toggle is gone
// (the hub is always visible, like the old Marketplace page was).
assert.doesNotMatch(settings, /PluginsView/, "Settings must not render PluginsView");
assert.doesNotMatch(settings, /"plugins"/, "Settings must not declare a plugins section");
assert.doesNotMatch(settings, /key: "roles"/, "Settings must not offer a roles add-on toggle — the merged hub is not gated");

// ── The hub composes the store and the setup views ───────────────────────────
assert.match(marketplaceView, /import \{ RolesSection, type RoleEntry \} from "@\/components\/marketplace\/roles-section"/, "hub renders the Roles section");
assert.match(marketplaceView, /import \{ SkillBrowser, type SkillBrowserEntry \} from "@\/components\/skill-browser"/, "hub renders the Skills browser");
assert.match(marketplaceView, /SkillDetailDrawer,/, "hub mounts the skill detail drawer for role-card skill chips");
assert.match(marketplaceView, /import \{ CapabilitiesViewSurface \} from "@\/components\/capabilities-view"/, "hub renders the Capabilities surface");
assert.match(
  marketplaceView,
  /initialSection\?: MarketplaceSection/,
  "hub accepts an initial section for workspace deep links",
);

// Section tablist is an accessible tablist (not just styled buttons).
assert.match(marketplaceView, /role="tablist"\s+aria-label="Marketplace sections"/, "the section bar is a labelled tablist");
assert.match(marketplaceView, /role="tab"\s*\n\s*id=\{`marketplace-tab-\$\{s\.id\}`\}/, "each tab carries role=tab + a stable id");
assert.match(marketplaceView, /aria-selected=\{section === s\.id\}/, "the active tab is aria-selected");
assert.match(marketplaceView, /aria-controls=\{`marketplace-panel-\$\{s\.id\}`\}/, "tabs point at their panel via aria-controls");
assert.match(marketplaceView, /tabIndex=\{section === s\.id \? 0 : -1\}/, "the tablist uses a roving tab stop");
assert.match(marketplaceView, /e\.key === "ArrowRight"[\s\S]{0,80}?\(i \+ 1\) % SECTIONS\.length/, "Left/Right arrows move between tabs");
for (const id of ["browse", "roles", "skills", "capabilities"]) {
  assert.match(
    marketplaceView,
    new RegExp(`role="tabpanel"\\s*\\n\\s*id="marketplace-panel-${id}"\\s*\\n\\s*aria-labelledby="marketplace-tab-${id}"`),
    `the ${id} panel is a tabpanel labelled by its tab`,
  );
}

// One search field, scoped per section; the self-contained Capabilities
// surface owns its own search so the hub hides the shared one there.
assert.match(marketplaceView, /aria-label=\{SEARCH_LABEL\[section\]\}/, "the search input names the active section");
assert.match(marketplaceView, /\{section !== "capabilities" \? \(\s*\n\s*<SearchInput/, "the shared search hides on the Capabilities section");

// The store rail cross-links into the setup sections, so Browse stays aware of
// what your familiars already have.
assert.match(marketplaceView, /Your setup/, "the Browse rail carries a Your-setup group");
assert.match(marketplaceView, /onClick=\{\(\) => selectSection\("roles"\)\}/, "the rail jumps to Roles");
assert.match(marketplaceView, /onClick=\{\(\) => selectSection\("skills"\)\}/, "the rail jumps to Skills");
assert.match(marketplaceView, /onClick=\{\(\) => selectSection\("capabilities"\)\}/, "the rail jumps to Capabilities");

// ── Role cards keep their capability map (MCP servers first-class) ──────────
assert.match(rolesRoute, /mcpServers:\s*string\[\]/, "Roles API should expose mcpServers as a first-class role capability list");
assert.match(rolesRoute, /mcpServers:\s*parseRoleMcpServers\(text\)/, "Roles API should read mcpServers plus supported MCP aliases from ROLE.md");
assert.match(rolesSection, /mcpServers:\s*string\[\]/, "Role cards should type MCP servers alongside skills, tools, plugins, and workflows");
assert.match(rolesSection, /\.\.\.role\.mcpServers/, "Roles search should include MCP server names");
assert.match(
  rolesSection,
  /label="MCP Servers"[\s\S]{0,160}items=\{role\.mcpServers\}/,
  "Role cards should render a dedicated MCP Servers row",
);
assert.match(
  rolesSection,
  /No MCP servers/,
  "Role cards should explain roles with no MCP server bindings instead of treating MCP as generic tools",
);
assert.match(
  rolesSection,
  /Browse the marketplace/,
  "The empty Roles section cross-sells the store — that's the point of the merge",
);

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
  /<ShortcutsSheet open=\{shortcutsOpen\}/,
  "Workspace should mount the ShortcutsSheet alongside the command palette",
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
  /<h1 className="sr-only">\{WORKSPACE_MODE_TITLES\[mode\] \?\? "Coven Cave"\}<\/h1>/,
  "Workspace detail must render a visually-hidden h1 naming the active surface (axe page-has-heading-one)",
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
assert.match(
  marketplaceView,
  /announce\(next \? "Role enabled" : "Role disabled", "polite"\)/,
  "toggling a role announces the new state",
);
assert.match(marketplaceView, /announce\(msg, "assertive"\)/, "a failed hub action is announced assertively");

console.log("roles-tools-navigation.test.ts OK");
