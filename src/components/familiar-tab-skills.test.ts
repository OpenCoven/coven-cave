// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab · Skills section (design-handoff rebuild). Pins the section's
// key decisions: one card with a segmented source filter + search, honest
// provenance pills, the two-column marketplace teach state fed by real
// directory data, and a skill detail modal whose file browser talks to
// /api/skills/files — with zero invented stats.

const src = readFileSync(new URL("./familiar-tab-skills.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab-skills.css", import.meta.url), "utf8");

test("section shell: skills card with segmented source filter, count, note, and search", () => {
  assert.match(src, /<section aria-label="Skills" className="familiar-tab__card familiar-skills">/, "card shell reuses the tab card class");
  assert.match(src, /const SOURCE_TABS = \["all", "role", "familiar", "global"\] as const/, "four provenance filters");
  assert.match(src, /<Segmented[\s\S]{0,200}?options=\{SOURCE_TABS\}/, "Segmented drives the source filter");
  assert.match(src, /getLabel=\{\(o\) => `\$\{TAB_LABEL\[o\]\}\\u00A0\$\{counts\[o\]\}`\}/, "labels carry live counts (non-breaking space)");
  assert.match(src, /ariaLabel="Skill source"/, "segmented control is named for AT");
  assert.match(src, /placeholder="Filter skills…"/, "220px search band");
  assert.match(css, /\.familiar-skills__search \{[^}]*width: 220px/, "search column is 220px");
});

test("search matches name + description + tags; result note is honest", () => {
  assert.match(
    src,
    /return `\$\{row\.name\} \$\{row\.description \?\? ""\} \$\{row\.tags\.join\(" "\)\}`\.toLowerCase\(\)/,
    "haystack is name + description + tags",
  );
  assert.match(src, /rowHaystack\(r\)\.includes\(q\)/, "query filters through the haystack");
  assert.match(src, /\$\{visible\.length\} \$\{visible\.length === 1 \? "match" : "matches"\}/, "query note counts matches");
  assert.match(src, /"granted by active roles"/, "role note");
  assert.match(src, /"shared across the coven"/, "global note");
});

test("no-match query gets the compact EmptyState, not a bare gap", () => {
  assert.match(src, /icon="ph:magnifying-glass"/, "search icon");
  assert.match(src, /headline="No matching skills"/, "headline");
  assert.match(
    src,
    /subtitle="Try a different search — skills match on name, description, and tags\."/,
    "subtitle names the match surface",
  );
});

test("provenance pills: role grants get the accent, familiar/global stay quiet", () => {
  assert.match(src, /familiar-skills__source-pill--\$\{kind\}/, "pill variant keyed by sourceKind");
  // The same on-disk skill can appear as a role grant AND an install in the
  // "all" tab — the path alone is not a unique React key.
  assert.match(src, /key=\{`\$\{row\.sourceKind\}:\$\{row\.key\}`\}/, "row keys are sourceKind-qualified");
  assert.match(css, /\.familiar-skills__source-pill--role \{[^}]*var\(--accent-presence\)/, "role pill is accent");
  assert.match(css, /\.familiar-skills__source-pill--global \{[^}]*color: var\(--text-muted\)/, "global pill is muted");
  assert.match(css, /\.familiar-skills__source-pill \{[^}]*border: 1px solid var\(--border-hairline\)/, "hairline base border");
});

test("familiar-empty teach state: marketplace CTA + live directory recommendations", () => {
  assert.match(src, /Nothing installed on \{familiarName\} yet/, "serif headline names the familiar");
  assert.match(src, /onClick=\{\(\) => navigateFamiliarSurface\("marketplace"\)\}[\s\S]{0,80}?Browse marketplace/, "Browse marketplace CTA rides the shared navigation event");
  assert.match(src, /fetch\("\/api\/skills\/directory"\)/, "recommendations come from the real directory route");
  assert.match(src, /\.filter\(\(e\) => !e\.installed\)\.slice\(0, 6\)/, "up to 6 uninstalled entries, no padding with fakes");
  assert.match(src, /fetch\("\/api\/skills\/directory\/install"/, "Install wires to the real install route");
  // The install body must send what the route can actually match — owner/repo
  // or the package name. entry.source is a provenance enum ("registry" |
  // "local" | …) the server compares against neither; sending it 404s every
  // install (PR #3655 follow-up).
  assert.match(src, /source: installSource\(entry\)/, "install body goes through installSource");
  assert.match(src, /return `\$\{entry\.owner\}\/\$\{entry\.repo\}`;[\s\S]{0,60}?entry\.packageName \?\? undefined/, "installSource = owner/repo, else packageName");
  assert.doesNotMatch(src, /source: entry\.source/, "provenance enum never rides the install body");
  // A failed install keeps a way forward.
  assert.match(src, /Install failed[\s\S]{0,400}?onClick=\{\(\) => install\(entry\)\}[\s\S]{0,200}?Retry/, "error state offers a Retry that re-runs the install");
  assert.match(src, /entry\.installsAllTime > 0\s*\? `\$\{entry\.installsAllTime\.toLocaleString\(\)\} installs`\s*: ""/, "install counts render only when the API provides them");
  assert.match(css, /\.familiar-skills__rec-card--featured \{[^}]*var\(--accent-presence\)/, "first pick is accent-tinted");
  assert.match(src, /Couldn't reach the marketplace directory/, "directory failure is an honest line, not a spinner");
});

test("skill detail modal: breadcrumb, file rail on /api/skills/files, default SKILL.md", () => {
  assert.match(src, /breadcrumb=\{\[data\.familiar\.display_name, "Skills", row\.name\]\}/, "breadcrumb = familiar › Skills › skill");
  assert.match(src, /fetch\(`\/api\/skills\/files\?dir=\$\{encodeURIComponent\(dir\)\}`\)/, "file list from the skills-files contract");
  assert.match(
    src,
    /fetch\(`\/api\/skills\/files\?dir=\$\{encodeURIComponent\(dir\)\}&file=\$\{encodeURIComponent\(active\.name\)\}`\)/,
    "file text fetched per selection",
  );
  assert.match(src, /e\.kind === "file" && e\.name === "SKILL\.md"/, "SKILL.md default-selected when present");
  assert.match(src, /if \(entry\.kind === "dir"\) return "ph:folder"/, "dir icon");
  assert.match(src, /\.endsWith\("\.md"\)\) return "ph:file-text"/, "markdown icon");
  assert.match(src, /\.endsWith\("\.toml"\)\) return "ph:gear-six"/, "toml icon");
  assert.match(src, /skill body isn't installed on\s+this machine/, "role grants without a local install skip the file pane honestly");
  assert.match(src, /<Button variant="secondary" onClick=\{onClose\}>\s*Close/, "footer action is Close (secondary)");
  assert.match(css, /\.familiar-skills__files \{[^}]*grid-template-columns: 220px minmax\(0, 1fr\)/, "220px rail | content grid");
  assert.match(css, /\.familiar-skills__file-content \{[^}]*white-space: pre-wrap/, "pre-wrap content pane");
  assert.match(css, /\.familiar-skills__file-content \{[^}]*max-height: 280px/, "content pane capped ~280px");
});

test("modal meta is real data only — provenance, tags, path; no invented stats", () => {
  assert.match(src, /grantedByLabel/, "granted-by line derives from sourceKind");
  assert.match(src, /return `\$\{row\.source\} role`/, "role provenance names the role");
  assert.match(src, /"Coven \(global\)"/, "global provenance label");
  assert.match(src, /title=\{row\.path\}/, "on-disk path truncates with a full-path tooltip");
  // The prototype hallucinated version/usage stats from a name hash. None of
  // that ships: FamiliarSkillRow has no such fields, so the UI shows none.
  assert.doesNotMatch(src, /invocation/i, "no invented invocation counts");
  assert.doesNotMatch(src, /lastUsed|Last used/, "no invented last-used times");
  assert.doesNotMatch(src, /hashN|Math\.random/, "no hash/random fabrication");
  assert.doesNotMatch(src, /Version /, "no version line — the row model carries no version");
  assert.doesNotMatch(src, /\d+ covens/, "no fabricated marketplace install copy");
});

test("interactive rows are buttons with the shared focus ring; tokens only in the css", () => {
  assert.match(src, /className="familiar-skills__row focus-ring"/, "skill rows are focusable buttons");
  assert.match(src, /className="familiar-skills__file-row focus-ring"/, "file rows too");
  assert.match(src, /aria-label=\{`Open skill \$\{row\.name\}`\}/, "rows are named for AT");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded hex colors");
  assert.doesNotMatch(css, /font-size:\s*[0-9.]+px/, "font sizes ride the type-scale tokens");
});
