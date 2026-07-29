// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./familiar-tab-settings.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");

assert.match(surface, /import \{ FamiliarSettingsSection \} from "@\/components\/familiar-tab-settings"/);
assert.match(surface, /type FamiliarSectionId = "identity" \| "skills" \| "mcp" \| "analytics" \| "memory" \| "settings"/);
assert.match(surface, /\{ id: "settings", label: "Settings" \}/);
assert.match(surface, /section === "settings" \? \([\s\S]{0,120}?<FamiliarSettingsSection/);
assert.match(surface, /<FamiliarSettingsSection[\s\S]{0,500}?familiar=\{familiar\}/);

assert.match(settings, /export function FamiliarSettingsSection\(/);
assert.match(settings, /FamiliarStudioIdentityTab/);
assert.match(settings, /FamiliarStudioBrainTab/);
assert.match(settings, /FamiliarStudioMemoryTab/);
assert.match(settings, /FamiliarStudioProjectsTab/);
assert.match(settings, /import \{ AccessGroupsSection \} from "@\/components\/access-groups-section"/);
assert.match(settings, /<VaultPanel[\s\S]{0,100}familiarId=\{familiar\.id\}/);
assert.match(settings, /<AccessGroupsSection[\s\S]{0,100}familiars=\{allFamiliars\}/);
assert.match(settings, /familiar\.id/);
assert.match(settings, /localDaemonReady/);
assert.match(settings, /allFamiliars/);
assert.match(settings, /<Tabs[\s\S]{0,240}bordered=\{false\}/);
assert.match(
  styles,
  /\.familiar-tab__settings-tabs\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*1;[^}]*background:\s*var\(--bg-raised\);/,
  "the nested settings tabs stay reachable while the familiar section scrolls",
);

console.log("familiar-tab-settings.test.ts: ok");
