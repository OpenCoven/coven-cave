// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
const group = readFileSync(new URL("./ui/settings-group.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// SettingsGroup exposes a stable, label-derived id so search can scroll to it.
assert.match(group, /export function settingsGroupId\(label: string\): string/, "settings-group exports settingsGroupId");
assert.match(group, /id=\{settingsGroupId\(label\)\} data-settings-group/, "SettingsGroup renders the derived id");

// The shell builds a search index and a SearchInput over it.
assert.match(shell, /import \{ SearchInput \}/, "settings-shell imports SearchInput");
assert.match(sections, /export const SETTINGS_INDEX: SettingsIndexEntry\[\]/, "settings-sections defines a search index");
assert.match(shell, /SETTINGS_INDEX/, "settings-shell consumes the search index");
assert.match(shell, /placeholder="Search settings…"/, "settings-shell renders the search box");
assert.doesNotMatch(shell, /role="listbox"/, "settings search results should not pretend command buttons are a listbox");
assert.match(shell, /role="list" aria-label="Settings search results"/, "settings search results render as a labelled list");
assert.match(shell, /role="listitem"/, "each settings search result is wrapped as a list item");
// Results filter the index by section label + group + keywords.
assert.match(shell, /\$\{settingsSectionLabel\(e\.section\)\} \$\{e\.group \?\? ""\} \$\{e\.keywords\}/, "search matches section/group/keywords");
// Picking a result opens the section and scrolls/highlights the group.
assert.match(shell, /function goToSetting\(entry: SettingsIndexEntry\)/, "search results route through goToSetting");
assert.match(shell, /settingsGroupId\(entry\.group\)/, "goToSetting resolves the group scroll target");
assert.match(shell, /el\.scrollIntoView\(\{ block: "start"/, "the matched group scrolls into view");
assert.match(shell, /classList\.add\("settings-group--found"\)/, "the matched group flashes a highlight");
// Reduced-motion-aware scroll.
assert.match(shell, /prefersReducedMotion\(\) \? "auto" : "smooth"/, "scroll honors reduced motion");
// No-match copy.
assert.match(shell, /No settings match/, "search shows a no-match message");

// Highlight style ships.
assert.match(css, /\.settings-group--found/, "globals styles the search highlight");

// ── Search reaches inside the Familiars studio panel (2026-07-06) ────────────
// Each studio tab is indexed with a familiarTab target, so "voice" or
// "archive" lands on the right tab instead of just the section.
assert.match(
  sections,
  /familiarTab\?: FamiliarStudioTab/,
  "index entries can target a Familiars studio tab",
);
for (const tab of ["identity", "look", "brain", "lifecycle", "memory", "projects", "vault", "journal"]) {
  assert.match(
    sections,
    new RegExp(`familiarTab: "${tab}"`),
    `the ${tab} studio tab is indexed for search`,
  );
}
// Picking a familiars entry activates the studio tab below the provider
// instead of scrolling to a SettingsGroup (the panel has none).
assert.match(shell, /if \(entry\.familiarTab\) \{[\s\S]*?setFamiliarsTabTarget\(entry\.familiarTab\)/, "goToSetting branches familiars entries to the tab target");
assert.match(shell, /setActiveTab\(tabTarget\)/, "FamiliarsSection activates the targeted studio tab");
assert.match(shell, /familiar-studio-inline-tab-\$\{tabTarget\}/, "the targeted tab button receives focus");
assert.match(shell, /onTabTargetConsumed\?\.\(\)/, "the one-shot tab target is handed back to the shell");

console.log("settings-search.test.ts OK");
