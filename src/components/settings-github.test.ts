import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const section = readFileSync(new URL("./settings-github.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");

test("the GitHub section is registered and rendered by the shell", () => {
  assert.match(sections, /id: "github", label: "GitHub"/);
  assert.match(sections, /github: \[/); // SECTION_HIGHLIGHTS entry
  assert.match(sections, /section: "github", group: "Organizations"/); // search index
  assert.match(shell, /import \{ GithubSection \} from "\.\/settings-github"/);
  assert.match(shell, /section === "github"\s*&&\s*<GithubSection \/>/);
});

test("the section reads and writes the org scope preference", () => {
  assert.match(section, /useAppPreferences\(\)\.github\.orgScope/);
  assert.match(section, /updateAppPreferences\(\{ github: \{ orgScope: \[\] \} \}\)/); // reset to all
  assert.match(section, /updateAppPreferences\(\{ github: \{ orgScope: next \} \}\)/); // toggle
  assert.match(section, /SettingsOverview section="github"/);
});

test("the section reads memberships from the activity API and stays accessible", () => {
  assert.match(section, /\/api\/github\/activity/);
  assert.match(section, /type="checkbox"/);
  assert.match(section, /role="alert"/);
});

test("the GitHub surface applies the configured org scope", () => {
  assert.match(view, /const orgScope = useAppPreferences\(\)\.github\.orgScope;/);
  // filtered items are constrained to the scope when non-empty
  assert.match(view, /orgScope\.length === 0 \? byKind : byKind\.filter\(\(i\) => orgScope\.includes\(orgOf\(i\.repo\)\)\)/);
  // the org dropdown only lists scoped memberships
  assert.match(view, /orgScope\.length === 0 \|\| orgScope\.includes\(o\)/);
});
