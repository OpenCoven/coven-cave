// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETTINGS_INDEX } from "./settings-sections.ts";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
const group = readFileSync(new URL("./ui/settings-group.tsx", import.meta.url), "utf8");
const foundations = readFileSync(
  new URL("../styles/globals/foundations.css", import.meta.url),
  "utf8",
);

// SettingsGroup exposes a stable, label-derived id so search can scroll to it.
assert.match(group, /export function settingsGroupId\(label: string\): string/, "settings-group exports settingsGroupId");
assert.match(
  group,
  /id=\{settingsGroupId\(label\)\}\s+data-settings-group/,
  "SettingsGroup renders the derived id",
);

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
assert.match(
  foundations,
  /\.settings-group--found/,
  "global foundations style the search highlight",
);

// Familiar controls moved to Chat → Familiar → Settings. Settings search must
// not keep exposing the retired section or its nested studio tabs.
assert.doesNotMatch(sections, /section: "familiars"/, "Settings search omits the retired Familiars section");
assert.doesNotMatch(sections, /familiarTab/, "Settings search has no retired studio-tab targets");
assert.doesNotMatch(shell, /FamiliarsSection|familiarsTabTarget|familiarTab/, "Settings shell has no retired Familiars routing");

assert.match(
  shell,
  /new URLSearchParams\(window\.location\.search\)/,
  "Settings reads exact group/tab targets passed by the global palette",
);
assert.match(shell, /params\.get\("group"\)/, "Settings accepts a group deep-link target");
assert.doesNotMatch(shell, /params\.get\("familiarTab"\)/, "Settings no longer accepts a retired familiar studio-tab target");

// One index entry per destination. `section` + `group` is the entire address
// `open-setting` can navigate to, and BOTH consumers key their rendered rows off
// exactly that pair — the palette as `setting:${section}:${group ?? "overview"}`
// (command-palette.tsx) and the settings shell as `${section}:${group ?? ""}`
// (settings-shell.tsx). The two differ only in what they substitute for a
// missing group, which is why the check below normalizes to one of them: a pair
// that collides under either spelling collides under both.
//
// A second entry for the same pair is therefore not extra search coverage: it is
// a duplicate React key plus a second row that opens the identical panel.
// Profile › Identity was split across a name/pronouns entry and an avatar entry,
// so any query matching both (e.g. "profile") tripped React's duplicate-key
// error (cave-x7v6b). Put new keywords on the existing entry for that
// destination instead of adding a sibling.
{
  const seen = new Map();
  for (const entry of SETTINGS_INDEX) {
    const address = `${entry.section}:${entry.group ?? "overview"}`;
    assert.equal(
      seen.has(address),
      false,
      `SETTINGS_INDEX has two entries for ${address} — merge their keywords into one entry instead:\n` +
        `  kept:      ${seen.get(address)}\n  duplicate: ${entry.keywords}`,
    );
    seen.set(address, entry.keywords);
  }
}

console.log("settings-search.test.ts OK");
