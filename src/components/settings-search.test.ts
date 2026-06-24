// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const group = readFileSync(new URL("./ui/settings-group.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// SettingsGroup exposes a stable, label-derived id so search can scroll to it.
assert.match(group, /export function settingsGroupId\(label: string\): string/, "settings-group exports settingsGroupId");
assert.match(group, /id=\{settingsGroupId\(label\)\} data-settings-group/, "SettingsGroup renders the derived id");

// The shell builds a search index and a SearchInput over it.
assert.match(shell, /import \{ SearchInput \}/, "settings-shell imports SearchInput");
assert.match(shell, /const SETTINGS_INDEX: SettingsIndexEntry\[\]/, "settings-shell defines a search index");
assert.match(shell, /placeholder="Search settings…"/, "settings-shell renders the search box");
// Results filter the index by section label + group + keywords.
assert.match(shell, /\$\{sectionLabel\(e\.section\)\} \$\{e\.group \?\? ""\} \$\{e\.keywords\}/, "search matches section/group/keywords");
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

console.log("settings-search.test.ts OK");
