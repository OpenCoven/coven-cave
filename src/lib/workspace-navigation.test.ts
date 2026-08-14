// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

const registry = read("./workspace-navigation.ts");
const sidebar = read("../components/sidebar-minimal.tsx");
const standalone = read("../components/analytics-page-shell.tsx");
const mobile = read("../components/mobile-bottom-tabs.tsx");
const palette = read("../components/command-palette.tsx");

assert.match(
  registry,
  /export const WORKSPACE_NAV_ITEMS/,
  "workspace navigation metadata lives in a lightweight shared registry",
);
assert.match(
  registry,
  /export const VISIBLE_WORKSPACE_NAV_ITEMS = WORKSPACE_NAV_ITEMS\.filter\(\(item\) => !item\.navHidden\)/,
  "the registry owns visible navigation derivation",
);
assert.match(
  registry,
  /export const PRIMARY_WORKSPACE_NAV_ITEMS = VISIBLE_WORKSPACE_NAV_ITEMS\.filter\(\(item\) => !item\.quiet\)/,
  "the registry owns the promoted mobile destinations",
);
assert.match(
  registry,
  /group: "work" \| "explore";/,
  "every workspace destination must declare a sidebar group",
);
assert.match(
  registry,
  /\{ id: "browser",[\s\S]*?group: "(?:work|explore)"/,
  "hidden Browser remains classified for future visible navigation",
);
assert.match(
  registry,
  /\{ id: "salem",[\s\S]*?group: "(?:work|explore)"/,
  "hidden Ask Salem remains classified for future visible navigation",
);

assert.match(
  sidebar,
  /import \{[\s\S]*?navItemsForSection,[\s\S]*?\} from "@\/lib\/nav-section"/,
  "the desktop sidebar takes its rows from the section-filtered registry derivation",
);
assert.match(
  read("./nav-section.ts"),
  /VISIBLE_WORKSPACE_NAV_ITEMS\.filter\(\(item\) => navSectionForMode\(item\.id\) === section\)/,
  "the section split derives from the shared visible registry rather than a second list",
);
assert.doesNotMatch(sidebar, /const FOLDER_MODES/, "the sidebar no longer owns a duplicate route registry");
assert.doesNotMatch(sidebar, /export \{ FOLDER_MODES \}/, "the obsolete component-level registry export is removed");
assert.doesNotMatch(sidebar, /export type FolderMode/, "the obsolete component-level mode alias is removed");

assert.match(
  standalone,
  /import \{ VISIBLE_WORKSPACE_NAV_ITEMS \} from "@\/lib\/workspace-navigation"/,
  "standalone pages consume the lightweight registry without importing SidebarMinimal",
);
assert.match(
  mobile,
  /import \{ PRIMARY_WORKSPACE_NAV_ITEMS \} from "@\/lib\/workspace-navigation"/,
  "mobile tabs consume the promoted registry",
);
assert.match(
  palette,
  /import \{ WORKSPACE_NAV_ITEMS, type WorkspaceNavMode \} from "@\/lib\/workspace-navigation"/,
  "the command palette consumes all canonical and on-demand destinations",
);

console.log("workspace-navigation registry: ok");
