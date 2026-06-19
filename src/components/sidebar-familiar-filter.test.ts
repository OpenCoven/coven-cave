// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const agentPanel = readFileSync(new URL("./familiar-panel.tsx", import.meta.url), "utf8");
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

// The horizontal dock is gone, and the profile switcher is not in the left
// panel: scope selection lives in the top bars (FamiliarMenuBar on desktop, the
// mobile top bar). The sidebar is pure navigation.
assert.doesNotMatch(sidebar, /<FamiliarDock/, "the horizontal familiar dock is replaced");
assert.doesNotMatch(
  sidebar,
  /<FamiliarSwitcher/,
  "the familiar switcher is no longer mounted in the left sidebar",
);

assert.doesNotMatch(
  sidebar,
  /function FamiliarScopeSelect/,
  "the scope dropdown is removed",
);

assert.doesNotMatch(
  sidebar,
  /Coven \(all\)/,
  "Selector should use Familiars, not Coven (all), for the generic no-filter option",
);

assert.doesNotMatch(
  workspace,
  /setActiveId\(\(curr\) => curr \?\? (?:fallback|merged)\[0\]\?\.id \?\? null\)/,
  "Workspace should not auto-select the first familiar; null means the generic Familiars scope",
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
  /onSelectFamiliar=\{selectFamiliarScope\}/,
  "Workspace wires the top-bar familiar switcher into nullable familiar scope state",
);

assert.match(
  chatSurface,
  /familiars,[\s\S]*activeFamiliar,[\s\S]*activeFamiliarId,/,
  "ChatSurface should destructure familiars so the generic scope can show all familiars",
);

assert.match(
  chatSurface,
  /const scopedFamiliars = useMemo\(\(\) => activeFamiliar \? \[activeFamiliar\] : familiars, \[activeFamiliar, familiars\]\)/,
  "ChatSurface should show all familiar memory/list context when Familiars is selected",
);

assert.match(
  styles,
  /\.sidebar-familiar-filter/,
  "Sidebar familiar selector should have dedicated stable styling hooks",
);

console.log("sidebar-familiar-filter.test.ts: ok");
