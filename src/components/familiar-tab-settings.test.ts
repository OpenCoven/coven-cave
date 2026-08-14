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
assert.match(surface, /consumeFamiliarSettingsPending/);
assert.match(surface, /setSection\("settings"\)/);
assert.match(surface, /initialTab=\{settingsTab\}/);

assert.match(settings, /export function FamiliarSettingsSection\(/);
assert.match(settings, /FamiliarStudioIdentityTab/);
assert.match(settings, /FamiliarStudioBrainTab/);
assert.match(settings, /FamiliarStudioMemoryTab/);
// Projects moved wholesale to Chat → Projects (cave-2tmly): no grant matrix,
// no access-groups section, and a `projects` target redirects there.
assert.doesNotMatch(settings, /FamiliarStudioProjectsTab/);
assert.doesNotMatch(settings, /AccessGroupsSection/);
assert.match(settings, /CHAT_OPEN_PROJECTS_EVENT/);
assert.match(settings, /ChatSettingsView/);
assert.doesNotMatch(
  settings,
  /from "@\/components\/lazy-surfaces"/,
  "Familiar settings should not pull the all-surfaces lazy registry into Chat's client graph",
);
assert.match(settings, /import type \{ FamiliarSettingsTab \} from "@\/lib\/chat-tab-events"/);
assert.match(settings, /\{ id: "chat", label: "Chat" \}/);
assert.match(settings, /tab === "chat" \? <ChatSettingsView \/>/);
assert.match(settings, /<VaultPanel[\s\S]{0,100}familiarId=\{familiar\.id\}/);
assert.match(settings, /familiar\.id/);
assert.match(settings, /localDaemonReady/);
assert.match(settings, /allFamiliars/);
assert.match(settings, /<Tabs<FamiliarSettingsTab>/);
assert.match(settings, /initialTab\?: FamiliarSettingsTab/);
assert.match(
  settings,
  /useState<FamiliarSettingsTab>\(\s*initialTab && initialTab !== "projects" \? initialTab : "identity",?\s*\)/,
);
assert.match(
  styles,
  /\.familiar-tab__settings\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1;/,
  "the nested settings section fills the Familiar panel",
);
assert.match(
  styles,
  /\.familiar-tab__settings-body\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/,
  "the nested settings body owns the remaining scrollable height",
);
console.log("familiar-tab-settings.test.ts: ok");
