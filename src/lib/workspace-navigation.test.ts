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
const destinationPolicy = read("./workspace-destination-policy.ts");

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
  /import \{ sidebarDestinations \} from "@\/lib\/workspace-destination-policy"/,
  "the desktop sidebar takes its rows from the shared destination policy",
);
assert.match(
  destinationPolicy,
  /home:\s*Object\.freeze\([\s\S]*navSectionForMode\(definition\.id\) === "home"[\s\S]*code:\s*Object\.freeze\([\s\S]*navSectionForMode\(definition\.id\) === "code"/,
  "the section split derives from the canonical page registry rather than a second list",
);
assert.match(
  destinationPolicy,
  /WORKSPACE_NAV_ITEMS\.find\(\(item\) => item\.id === definition\.id\)/,
  "the destination policy reuses shared navigation metadata for every consumer row",
);
assert.match(
  destinationPolicy,
  /throw new Error\(`Missing workspace destination metadata for \$\{definition\.id\}`\);/,
  "missing consumer metadata fails loudly instead of disappearing silently",
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
  /import \{ paletteDestinations \} from "@\/lib\/workspace-destination-policy"/,
  "the command palette derives visible Go to destinations from the shared policy",
);
assert.doesNotMatch(
  palette,
  /import \{ WORKSPACE_NAV_ITEMS, type WorkspaceNavMode \} from "@\/lib\/workspace-navigation"/,
  "the command palette no longer keeps a private metadata view of navigation destinations",
);

console.log("workspace-navigation registry: ok");
