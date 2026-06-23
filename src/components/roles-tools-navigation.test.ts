// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const pluginsView = await readFile(new URL("./plugins-view.tsx", import.meta.url), "utf8");
const rolesRoute = await readFile(new URL("../app/api/roles/route.ts", import.meta.url), "utf8");
const workspaceMode = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const shortcutsCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
const shortcutsSheet = await readFile(new URL("./shortcuts-sheet.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.match(
  workspaceMode,
  /\|\s*"roles"/,
  "Roles should be a first-class workspace mode",
);

assert.match(
  sidebar,
  /\{ id: "roles", label: "Roles"[\s\S]*group: "tools"/,
  "Roles should appear in the main sidebar Tools group",
);

assert.match(
  sidebar,
  /\{ id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools", description:/,
  "Sidebar navigation should expose Roles as a tools surface",
);

assert.match(
  workspace,
  /mode === "roles"[\s\S]*<PluginsView[\s\S]*tabs=\{\["roles", "workflows", "skills", "capabilities"\]\}/,
  "The Roles surface should expose roles, workflows, skills, and capabilities (capabilities is the rightmost tab)",
);

assert.doesNotMatch(
  settings,
  /PluginsView/,
  "Settings must not render PluginsView — plugins and skills live on the Roles page",
);

assert.doesNotMatch(
  settings,
  /"plugins"/,
  "Settings must not declare a plugins section",
);

assert.match(
  pluginsView,
  /tabs\?: Tab\[\]/,
  "PluginsView should support caller-selected tab sets",
);

assert.match(
  rolesRoute,
  /mcpServers:\s*string\[\]/,
  "Roles API should expose mcpServers as a first-class role capability list",
);

assert.match(
  rolesRoute,
  /mcpServers:\s*parseRoleMcpServers\(text\)/,
  "Roles API should read mcpServers plus supported MCP aliases from ROLE.md",
);

assert.match(
  pluginsView,
  /mcpServers:\s*string\[\]/,
  "Roles view should type MCP servers alongside skills, tools, plugins, and workflows",
);

assert.match(
  pluginsView,
  /\.\.\.role\.mcpServers/,
  "Roles search should include MCP server names",
);

assert.match(
  pluginsView,
  /label="MCP Servers"[\s\S]{0,160}items=\{role\.mcpServers\}/,
  "Role cards should render a dedicated MCP Servers row",
);

assert.match(
  pluginsView,
  /No MCP servers/,
  "Role cards should explain roles with no MCP server bindings instead of treating MCP as generic tools",
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
assert.match(
  shell,
  /<aside\s+className="shell-familiar"[\s\S]*?aria-label="Companion"/,
  "Shell agent panel must carry a distinct accessible name (axe landmark-unique)",
);
