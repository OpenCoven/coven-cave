// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const agentPanel = readFileSync(new URL("./agent-panel.tsx", import.meta.url), "utf8");
const companionRail = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

for (const [name, source] of [
  ["sidebar-minimal.tsx", sidebar],
  ["workspace.tsx", workspace],
]) {
  assert.doesNotMatch(source, /<<<<<<<|=======|>>>>>>>/, `${name} must not contain conflict markers`);
}

assert.doesNotMatch(
  sidebar,
  /onOpenSearch|label="Search"|ph:magnifying-glass|sidebar-action-kbd/,
  "Sidebar should no longer render the global search action in the left panel",
);

assert.match(
  sidebar,
  /function FamiliarScopeSelect/,
  "Sidebar should replace search with a familiar scope selector component",
);

assert.match(
  sidebar,
  /aria-label="Active familiar"/,
  "Familiar selector should label the dropdown after the active familiar",
);

assert.doesNotMatch(
  sidebar,
  /Coven \(all\)/,
  "Selector should not offer an all-scope option — downstream surfaces hard-scope to a single familiar",
);

assert.match(
  sidebar,
  /if \(next\) onFamiliarScopeChange\(next\)/,
  "Selector should only fire the callback for a real familiar id, never an empty value",
);

assert.match(
  sidebar,
  /activeFamiliarId\?: string \| null/,
  "Sidebar should receive the current familiar scope id (nullable until first familiar resolves)",
);

assert.match(
  sidebar,
  /onFamiliarScopeChange: \(id: string\) => void/,
  "Sidebar should expose a non-null callback for changing the active familiar",
);

assert.doesNotMatch(
  workspace,
  /import \{ FamiliarAvatarRail \}|<FamiliarAvatarRail|familiarRail=\{|sidebar-trigger-rail/,
  "Workspace should not mount the far-left mini familiar rail",
);

assert.doesNotMatch(
  globals,
  /sidebar-trigger-rail/,
  "Global styles should not keep the discarded far-left mini panel",
);

assert.doesNotMatch(
  `${chatRouter}\n${agentPanel}\n${companionRail}`,
  /from the rail/,
  "Visible empty states should point users to the sidebar selector, not the removed familiar rail",
);

assert.match(
  chatRouter,
  /Choose a familiar from the sidebar selector/,
  "ChatRouter should explain the new familiar selection path",
);

assert.match(
  workspace,
  /onFamiliarScopeChange=\{selectFamiliar\}/,
  "Workspace should wire the sidebar familiar selector into the existing single-familiar select handler",
);

assert.match(
  chatSurface,
  /const scopedFamiliars = useMemo\(\(\) => activeFamiliar \? \[activeFamiliar\] : \[\], \[activeFamiliar\]\)/,
  "ChatSurface stays hard-scoped to the active familiar — no all-familiar fallback",
);

assert.match(
  styles,
  /\.sidebar-familiar-filter/,
  "Sidebar familiar selector should have dedicated stable styling hooks",
);

console.log("sidebar-familiar-filter.test.ts: ok");
