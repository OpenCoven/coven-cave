// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(url: URL): Promise<string> {
  return readFile(url, "utf8").catch(() => "");
}

const chrome = await readSource(new URL("./sidebar-chrome.tsx", import.meta.url));
const quickSwitch = await readSource(new URL("./familiar-quick-switch.tsx", import.meta.url));
const familiarSwitcher = await readSource(new URL("./familiar-switcher.tsx", import.meta.url));

for (const exportName of [
  "SidebarBrand",
  "SidebarPrimaryActions",
  "SidebarSectionLabel",
  "SidebarUtilityNav",
  "SidebarIdentityFooter",
  "openSidebarSearch",
]) {
  assert.match(chrome, new RegExp(`export function ${exportName}`), `${exportName} is shared chrome`);
}
assert.match(chrome, /src="\/icons\/favicon-32\.png"/, "brand uses the local Cave icon");
assert.match(chrome, />Coven Cave</, "brand names Coven Cave");
assert.match(chrome, />OpenCoven</, "brand attribution names OpenCoven");
assert.match(
  chrome,
  /new KeyboardEvent\("keydown", \{[\s\S]*?key: "k"[\s\S]*?metaKey: true/,
  "search uses the Command-K path",
);
assert.match(chrome, /className="sidebar-primary-actions"[\s\S]*?>New chat</, "primary row contains New chat");
assert.match(chrome, /aria-label="Search"/, "icon search has an accessible name");
assert.match(chrome, /href="\/dashboard"/, "utility navigation keeps Dashboard as a link");
assert.match(
  chrome,
  /<FamiliarQuickSwitch[\s\S]*?placement="top-start"[\s\S]*?popoverClassName="sidebar-identity-popover"[\s\S]*?labeled/,
  "identity footer reuses the familiar switcher and opens upward",
);
assert.match(quickSwitch, /popoverClassName=\{popoverClassName\}/, "quick switch forwards sidepanel popover chrome");
assert.match(
  familiarSwitcher,
  /className=\{\["familiar-switcher__popover", popoverClassName\]\.filter\(Boolean\)\.join\(" "\)\}/,
  "familiar switcher composes instance chrome onto the shared Popover class",
);
assert.doesNotMatch(chrome, /OpenTrust|E53935|openclaw\.ai/, "Cave chrome does not copy OpenTrust product identity");

const standard = await readSource(new URL("./sidebar-minimal.tsx", import.meta.url));
assert.match(standard, /<SidebarBrand\s*\/>/, "standard host begins with the shared brand");
assert.match(
  standard,
  /<SidebarPrimaryActions onNewChat=\{onNewChat\}\s*\/>/,
  "standard host uses the shared action row",
);
assert.match(
  standard,
  /const PRIMARY_MODES = VISIBLE_MODES\.filter\(\(mode\) => mode\.section === "primary"\)/,
  "daily destinations are a primary group",
);
assert.match(
  standard,
  /const TOOL_MODES = VISIBLE_MODES\.filter\(\(mode\) => mode\.section === "tools"\)/,
  "secondary destinations are a labeled tools group",
);
assert.match(standard, /<SidebarSectionLabel>Cave tools<\/SidebarSectionLabel>/, "tools group is named");
assert.match(
  standard,
  /<SidebarUtilityNav onOpenSettings=\{onOpenSettings\}\s*\/>/,
  "utilities sit below contextual content",
);
assert.match(
  standard,
  /<SidebarIdentityFooter[\s\S]*?selectedFamiliarIds=\{selectedFamiliarIds\}/,
  "familiar scope moved to the shared identity footer",
);
assert.doesNotMatch(standard, /className="sidebar-familiar-switch"/, "legacy top familiar switcher is retired");
assert.match(standard, /<RecentActivityRollup/, "Recent Activity remains available");
assert.match(standard, /draggable=\{draggable \|\| undefined\}/, "page drag-to-split remains wired");

const chat = await readSource(new URL("./workspace-sidebar.tsx", import.meta.url));
const workspace = await readSource(new URL("./workspace.tsx", import.meta.url));
assert.match(chat, /<SidebarBrand\s*\/>/, "Chat host uses the shared product header");
assert.match(
  chat,
  /<SidebarPrimaryActions onNewChat=\{\(\) => onNewChat\(null\)\}\s*\/>/,
  "Chat host uses the shared primary row",
);
assert.match(
  chat,
  /<SidebarUtilityNav onOpenSettings=\{onOpenSettings\}\s*\/>/,
  "Chat host keeps lower utilities",
);
assert.match(
  chat,
  /<SidebarIdentityFooter[\s\S]*?selectedFamiliarIds=\{selectedFamiliarIds\}/,
  "Chat host keeps multi-familiar scope in the footer",
);
assert.doesNotMatch(chat, /workspace-sidebar__rail chat-sidebar__rail/, "legacy vertical Chats rail is retired");
assert.match(chat, /<nav aria-label="Chat threads" className="cnav__scroll">/, "project/thread navigator remains");
assert.match(chat, /aria-label="Sidebar options"/, "organizer remains accessible");
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]*?selectedFamiliarIds=\{scopeIds\}/,
  "Workspace supplies multi-familiar scope to Chat",
);

const shell = await readSource(new URL("./shell.tsx", import.meta.url));
const globals = await readSource(new URL("../app/globals.css", import.meta.url));
assert.match(shell, /const NAV_OPEN_PX = 256/, "expanded sidepanel is 256px");
assert.match(shell, /const NAV_RAIL_PX = 48/, "collapsed sidepanel is a 48px rail");
assert.match(shell, /cave\.shell\.widths\.v4/, "persisted shell generation resets for the new geometry");
assert.match(globals, /width:\s*min\(86vw,\s*288px\)/, "mobile drawer caps at 288px");

const sidebarCss = await readSource(new URL("../styles/sidebar-minimal.css", import.meta.url));
assert.match(sidebarCss, /\.sidebar-brand\s*\{[^}]*min-height:\s*48px/s, "brand row is 48px");
assert.match(sidebarCss, /\.sidebar-primary-action[\s\S]*?height:\s*32px/s, "primary action is 32px");
assert.match(
  sidebarCss,
  /\.sidebar-primary-action\s*\{[^}]*background:\s*var\(--accent-presence\);[^}]*color:\s*var\(--accent-presence-foreground\)/s,
  "the primary action uses the foreground paired with the presence accent",
);
assert.match(
  sidebarCss,
  /\.cnav__mini-count\s*\{[^}]*background:\s*var\(--accent-presence\);[^}]*color:\s*var\(--accent-presence-foreground\)/s,
  "scheduled-count ink uses the foreground paired with the presence accent",
);
assert.match(
  sidebarCss,
  /\.sidebar-folder-row--active\s*\{[^}]*border-left:\s*3px solid var\(--accent-presence\)/s,
  "active destination has the leading accent",
);
assert.match(
  sidebarCss,
  /\.sidebar-folder-row--active\s*\{[^}]*box-shadow:\s*inset 3px 0/s,
  "active destination has the inset glow",
);
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-brand__copy[\s\S]*?display:\s*none/s,
  "rail hides brand copy",
);
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-section-label[\s\S]*?display:\s*none/s,
  "rail hides group headings",
);
assert.match(
  sidebarCss,
  /\.shell-nav--rail \.sidebar-identity-footer[\s\S]*?width:\s*32px/s,
  "rail keeps a centered identity target",
);
assert.match(
  sidebarCss,
  /@media \(max-width: 1023px\)[\s\S]*?\.sidebar-primary-action[\s\S]*?min-height:\s*var\(--touch-target\)/s,
  "drawer controls retain touch targets",
);
assert.match(
  sidebarCss,
  /@media \(max-width: 1023px\)[\s\S]*?\.sidebar-search-action,\s*\.cnav__toolbar \.cnav__back\s*\{[^}]*min-width:\s*var\(--touch-target\)/s,
  "drawer icon controls retain square touch targets",
);
assert.doesNotMatch(sidebarCss, /#E53935|openclaw\.ai/i, "sidebar styling uses Cave tokens only");
assert.match(
  sidebarCss,
  /\.familiar-switcher__popover\.sidebar-identity-popover\s*\{[^}]*background:\s*color-mix\(in oklch, var\(--bg-elevated\) 96%, transparent\)/s,
  "the sidepanel identity menu beats the later generic popover fill and stays legible over dense contextual lists",
);
assert.doesNotMatch(
  sidebarCss,
  /\.sidebar-(?:header|familiar-switch|familiar-filter|foot|version|action-row|action-stack)\b/,
  "retired sidebar generations leave no competing style hooks",
);
assert.doesNotMatch(globals, /\.chat-sidebar__rail\b/, "the retired vertical Chat rail leaves no global CSS");

console.log("sidebar-opentrust-parity.test.ts: shared chrome OK");
