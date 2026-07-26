import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const section = readFileSync(new URL("./settings-github.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const codeView = readFileSync(new URL("./code-view.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");

test("GitHub is removed from the Settings catalog, search, and shell", () => {
  assert.doesNotMatch(sections, /\|\s*"github"/);
  assert.doesNotMatch(sections, /id: "github", label: "GitHub"/);
  assert.doesNotMatch(sections, /^\s*github: \[/m);
  assert.doesNotMatch(sections, /section: "github"/);
  assert.doesNotMatch(shell, /import \{ GithubSection \} from "\.\/settings-github"/);
  assert.doesNotMatch(shell, /section === "github"/);
});

test("Code owns the organization settings trigger and popover", () => {
  assert.match(codeView, /import \{ GithubOrganizationSettings \} from "@\/components\/settings-github"/);
  assert.match(codeView, /<GithubOrganizationSettings \/>/);
  assert.match(section, /export function GithubOrganizationSettings\(\)/);
  assert.match(section, /<IconButton[\s\S]*aria-label="GitHub organization settings"/);
  assert.match(section, /<Popover[\s\S]*ariaLabel="GitHub organization settings"/);
  assert.match(
    section,
    /<Popover[\s\S]*className="w-\[min\(20rem,calc\(100vw-1rem\)\)\]"[\s\S]*?<PopoverBody className="w-full">/,
  );
  assert.doesNotMatch(section, /SettingsOverview|SettingsGroup/);
});

test("the Code popover reads and writes the org scope preference", () => {
  assert.match(section, /useAppPreferences\(\)\.github\.orgScope/);
  assert.match(section, /updateAppPreferences\(\{ github: \{ orgScope: \[\] \} \}\)/); // reset to all
  assert.match(section, /updateAppPreferences\(\{ github: \{ orgScope: next \} \}\)/); // toggle
  assert.match(
    section,
    /if \(scoped\) return;[\s\S]*?load\.status === "loading"[\s\S]*?announce\("GitHub organizations are still loading", "polite"\);[\s\S]*?return;/,
    "Selected is a no-op for an existing scope and announces while memberships are still loading",
  );
  assert.match(
    section,
    /if \(memberships\.length === 0\) \{[\s\S]*?announce\([\s\S]*?,\s*"polite",?\s*\);[\s\S]*?return;/,
    "Selected never writes an empty scope when memberships are unavailable",
  );
  assert.match(section, /<Segmented/);
});

test("the Code popover reads memberships from the activity API and stays accessible", () => {
  assert.match(section, /\/api\/github\/activity/);
  assert.match(section, /type="checkbox"/);
  assert.match(section, /role="alert"/);
  assert.match(section, /usePopoverInitialFocus\(open, GITHUB_ORG_POPOVER_SELECTOR\)/);
  assert.match(section, /focusScopeControl/);
  assert.match(codeView, /role="tab"[\s\S]*?className=\{`focus-ring-inset[\s\S]*?CODE_GITHUB_TABS\.map/);
  assert.match(codeView, /CODE_GITHUB_TABS\.map[\s\S]*?role="tab"[\s\S]*?className=\{`focus-ring-inset/);
});

test("the Code popover preserves compact pointer rhythm and coarse-pointer targets", () => {
  for (const className of [
    "github-org-settings__trigger",
    "github-org-settings__segments",
    "github-org-settings__row",
    "github-org-settings__action",
  ]) {
    assert.match(section, new RegExp(className));
  }
  assert.match(
    primitives,
    /@media \(hover: none\) and \(pointer: coarse\) \{[\s\S]*?\.github-org-settings__trigger[\s\S]*?min-height: var\(--touch-target\)/,
  );
  assert.match(
    primitives,
    /\.github-org-settings__segments button,[\s\S]*?\.github-org-settings__row,[\s\S]*?\.github-org-settings__action/,
  );
});

test("the GitHub surface applies the configured org scope", () => {
  assert.match(view, /const orgScope = useAppPreferences\(\)\.github\.orgScope;/);
  // filtered items are constrained to the scope when non-empty
  assert.match(view, /orgScope\.length === 0 \? byKind : byKind\.filter\(\(i\) => orgScope\.includes\(orgOf\(i\.repo\)\)\)/);
  // the org dropdown derives from the (already scope-constrained) filtered rows,
  // so it only lists orgs that actually have items in the current table
  assert.match(view, /\.\.\.filtered\.map\(\(i\) => orgOf\(i\.repo\)\)/);
});
