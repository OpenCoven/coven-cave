// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./skill-browser.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("./marketplace-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Browse-style layout: vertical rail · list column · detail pane ──────────
assert.match(src, /export function SkillBrowser\(/, "exports the SkillBrowser component");
assert.match(src, /<aside className="skill-browser__rail" aria-label="Skill filters">/, "renders the vertical filter rail as an aside");
assert.match(src, /className="skill-browser__list"/, "renders the list column");
assert.match(src, /className="skill-browser__detail"/, "renders the detail pane");
// The rail is a sibling BESIDE the list column (Browse's sidepanel grammar) —
// not a strip nested inside it.
assert.ok(
  src.indexOf('className="skill-browser__rail"') < src.indexOf('className="skill-browser__list"'),
  "the rail precedes the list column as its own sidepanel",
);

// Rail rows read like Browse's category rail: plain label + count, no icons.
assert.match(src, /label: "All Skills"/, "rail has an All Skills entry");
assert.match(src, /label: "Installed"/, "rail has an Installed entry");
assert.match(src, /label: "Claude Code"/, "rail has a Claude Code entry");
assert.match(src, /label: "Generic"/, "rail has a Generic entry");
assert.doesNotMatch(src, /skill-browser__cat-icon/, "rail rows drop the per-category icon (Browse's rows are plain text)");
assert.match(
  src,
  /familiar === "user" \? "claude" : "generic"/,
  "maps scan scope (user→Claude Code, global→Generic)",
);
assert.match(
  src,
  /"codex-user" \| "agents-project" \| "agents-user"/,
  "browser type keeps Codex and shared .agents install scopes",
);
assert.match(src, /className="skill-browser__cat-label"/, "rail rows carry a label span");
assert.match(src, /className="skill-browser__cat-count"/, "each rail row shows a count");

// Rail groups: Categories, Trust, and Topics — uppercase labels over rows.
assert.match(src, /aria-label="Filter skills"/, "the Categories group filters skills");
assert.match(src, /<p className="skill-browser__rail-label">Categories<\/p>/, "the rail labels its Categories group");
assert.match(src, /aria-label="Filter by trust signal"/, "the rail has a Trust group");
assert.match(src, /<p className="skill-browser__rail-label">Trust<\/p>/, "the rail labels its Trust group");
assert.match(src, /aria-label="Browse by topic"/, "the rail has a Topics group");
assert.match(src, /<p className="skill-browser__rail-label">Topics<\/p>/, "the rail labels its Topics group");
assert.match(
  src,
  /RAIL\.filter\(\s*\(cat\) => cat\.id === "all" \|\| cat\.id === "installed" \|\| counts\[cat\.id\] > 0,?\s*\)/,
  "zero-count claude/generic categories stay hidden",
);

// Trust toggles compose with the categories and click off back to everything.
assert.match(src, /type BrowseFilter = "all" \| "official" \| "audited" \| "installed"/, "keeps the trust filter states");
assert.match(src, /const TRUST_FILTERS: \{ id: "official" \| "audited"; label: string \}\[\]/, "defines the two trust toggles");
assert.match(src, /label: "Official"/, "trust filters include Official");
assert.match(src, /label: "Security audits"/, "trust filters include Security audits");
assert.match(src, /setBrowse\(active \? "all" : item\.id\)/, "trust toggles deselect back to the full list");
assert.match(src, /function matchesBrowseFilter\(skill: SkillBrowserEntry, filter: BrowseFilter\)/, "trust filters are applied by helper");
assert.match(src, /matchesBrowseFilter\(s, browse\)/, "visible skills are filtered by trust state");

// Topics: skills.sh-style keyword filters with counts, zero-count hidden.
assert.match(src, /const TOPIC_FILTERS = \[/, "defines topic filters");
assert.match(src, /label: "React"[\s\S]*?keywords: \["react"\]/, "topic filters include React");
assert.match(src, /label: "Next\.js"/, "topic filters include Next.js");
assert.match(src, /label: "Design & UI"/, "topic filters include Design & UI");
assert.match(src, /label: "Agent workflows"/, "topic filters include Agent workflows");
assert.match(src, /function matchesTopic\(skill: SkillBrowserEntry, topicId: string\)/, "topic filters are applied by helper");
assert.match(src, /matchesTopic\(s, topic\)/, "visible skills are filtered by topic state");
assert.match(src, /TOPIC_FILTERS\.filter\(\(item\) => \(topics\[item\.id\] \?\? 0\) > 0\)/, "zero-count topics stay hidden");

// ── The leaderboard/ecosystem chrome stays retired (cave simplification):
// ranking survives as a plain sort select in the list toolbar.
assert.doesNotMatch(src, /skill-browser__leaderboard/, "the Skills Leaderboard header is gone");
assert.doesNotMatch(src, /skill-browser__ecosystem/, "the skills.sh ecosystem panel is gone");
assert.doesNotMatch(src, /skill-browser__directory-links/, "the skills.sh directory link strip is gone");
assert.doesNotMatch(src, /skill-browser__agent-strip/, "the supported-agents strip is gone");
assert.doesNotMatch(src, /Try it now/, "the Try-it-now command header is gone (the detail pane's CLI line remains the copy affordance)");
assert.doesNotMatch(src, /skills\.sh/, "no skills.sh outlinks remain in the browser chrome");
assert.match(src, /type LeaderboardMode = "all-time" \| "trending" \| "hot"/, "keeps the ranking modes");
assert.match(src, /const SORT_MODES: \{ id: LeaderboardMode; label: string \}\[\]/, "ranking modes become sort options");
assert.match(src, /label: "Most installed"/, "sort includes Most installed (all-time)");
assert.match(src, /label: "Trending"/, "sort includes Trending");
assert.match(src, /label: "Hot"/, "sort includes Hot");
assert.match(src, /label="Sort skills"/, "the sort select stays labeled for AT");
assert.match(src, /rankedVisible\.map\(\(skill\)/, "the list stays ranked by the selected mode");
assert.doesNotMatch(src, /skill-browser__rank/, "rows drop the leaderboard rank number");
assert.doesNotMatch(src, /skill-browser__activity/, "rows drop the 8-week sparkline");
assert.doesNotMatch(src, /skill-browser__metric/, "rows drop the score meter");
assert.match(src, /className="skill-browser__card-installs"/, "rows keep one quiet installs count");
assert.match(src, /formatCount\(installs\)/, "the installs count is compact-formatted");
assert.match(src, /name="ph:download-simple"/, "the installs count uses the download glyph");

// ── List toolbar — Browse's summary-row grammar: count left, controls right.
assert.match(src, /className="skill-browser__toolbar"/, "the list column has a toolbar");
assert.match(src, /className="skill-browser__toolbar-count"/, "the toolbar shows a result count");
assert.match(
  src,
  /\{rankedVisible\.length\} \{rankedVisible\.length === 1 \? "skill" : "skills"\}/,
  "the count pluralizes",
);
assert.match(src, /<Skeleton variant="text-sm" width=\{72\} \/>/, "the count shimmers while loading (one loading language per surface)");
assert.match(src, /<SkeletonRows count=\{6\} \/>/, "the list shows skeleton rows while loading");
assert.match(src, /label="Filter by agent"/, "the agent filter stays a labeled select");
assert.match(src, /agents\.length > 1 \?/, "the agent select only renders when there are agents to filter");

// ── Narrow panes: the rail folds away and a category chip row stands in.
assert.match(src, /className="skill-browser__chips" role="group" aria-label="Filter skills"/, "the chip row mirrors the category filters");
assert.match(src, /className=\{`skill-browser__chip\$\{active \? " is-active" : ""\}`\}/, "chips mark the active category");
assert.match(src, /className="skill-browser__chip-count"/, "chips carry counts");

// Labelled/icon actions must use the shared Button/IconButton. The sole
// exception is the bespoke CLI copy-chip (a code line with a progressive fill
// overlay the primitive can't express) — accessible via type="button" +
// aria-label. Assert exactly one raw button and that it's that one.
assert.match(src, /import \{ Button \}/, "SkillBrowser labelled actions use the shared Button primitive");
assert.match(src, /import \{ IconButton \}/, "SkillBrowser icon actions use the shared IconButton primitive");
{
  const rawButtons = src.match(/<button\b/g) ?? [];
  assert.equal(rawButtons.length, 1, "the only hand-rolled button is the bespoke CLI copy-chip; everything else uses the shared Button");
  assert.match(src, /<button\s+type="button"\s+className=\{`skill-browser__cli/, "the one raw button is the clickable CLI copy line");
}
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "SkillBrowser should not hard-code rectangular radius classes",
);

// ── Install / use workflow (unchanged by the layout simplification) ─────────
assert.match(src, /function installCommand\(skill: SkillBrowserEntry\)/, "builds a skills CLI install command");
assert.match(src, /function useCommand\(skill: SkillBrowserEntry\)/, "builds a skills CLI use command");
assert.match(src, /function sourceTarget\(skill: SkillBrowserEntry\)/, "derives the skills CLI source from owner/repo or package");
assert.match(src, /function sourceKey\(skill: SkillBrowserEntry\)/, "normalizes source identity for grouping");
assert.match(src, /function sourceSummary\(source: string, skills: SkillBrowserEntry\[\]\)/, "summarizes skills from the same source");
assert.match(src, /function specificSkillName\(skill: SkillBrowserEntry\)/, "derives a specific skill name for directory rows");
assert.match(src, /--skill \$\{quoteCliArg\(specific\)\}/, "install command targets specific skills with --skill");
assert.match(src, /function skillDecisionItems\(skill: SkillBrowserEntry\)/, "detail pane derives install decision items");
assert.match(src, /className="skill-browser__decision"/, "detail pane renders a compact decision summary");
assert.match(src, /className="skill-browser__decision-card"/, "detail decision summary uses stable card hooks");
assert.match(src, /Install state/, "detail decision summary labels install state");
assert.match(src, /Trust signal/, "detail decision summary labels trust signal");
assert.match(src, /Source/, "detail decision summary labels source");
assert.match(css, /\.skill-browser__decision \{[\s\S]*?grid-template-columns/, "detail decision summary uses a responsive grid");
// Minimalist stat cards: just the labelled value, no description paragraph and
// no fixed card height.
assert.doesNotMatch(src, /skill-browser__decision-card"[\s\S]{0,220}<p>/, "decision cards drop the description paragraph");
assert.doesNotMatch(css, /\.skill-browser__decision-card \{[^}]*min-height:/, "minimalist decision cards no longer reserve a fixed height");
// The install command line is itself the copy affordance — click sweeps a green
// progressive fill and flips to "Copied"; the separate Install button/pill and
// standalone copy icon are gone (keep just Use + Copy prompt).
assert.match(src, /copyText\(installCommand\(selected\)\)/, "the CLI line copies the install command");
assert.match(src, /skill-browser__cli\$\{copiedInstall \? " is-copied"/, "the install command is a clickable copy button");
assert.match(src, /className="skill-browser__cli-fill"/, "the CLI copy renders a progressive fill overlay");
assert.match(css, /\.skill-browser__cli\.is-copied \.skill-browser__cli-fill \{[\s\S]*?width: 100%;[\s\S]*?transition: width/, "the fill sweeps to 100% on copy");
assert.doesNotMatch(src, /function handleInstall\(/, "the one-click Install button/pill is removed (copy the CLI or Use instead)");
assert.doesNotMatch(src, /className="skill-browser__install-button"/, "the Install button markup is gone");
assert.match(src, /function handleUseSkill\(\)/, "detail pane can use a selected skill without installing it");
assert.match(src, /fetch\("\/api\/skills\/directory\/use"/, "use action calls the guarded skills use route");
assert.match(src, /function requestSkillPrompt\(selectedSkill: SkillBrowserEntry\)/, "use and copy prompt share the guarded prompt request");
assert.match(src, /new CustomEvent\("cave:agents-new-chat"/, "use action opens a Cave chat with the generated skill prompt");
assert.match(src, /initialPrompt: prompt/, "use action sends the generated prompt into chat");
assert.match(src, /function handleCopyPrompt\(\)/, "detail pane can copy the generated skill prompt without opening chat");
assert.match(src, /copyText\(prompt\)/, "copy prompt writes the generated prompt to the clipboard");
assert.match(src, /className="skill-browser__prompt-button"/, "detail pane renders a copy-prompt action");
assert.match(src, /leadingIcon="ph:clipboard-text"/, "copy-prompt action uses a clipboard icon");
assert.match(src, /selected\.sourceUrl/, "detail pane links to skill source when available");
assert.match(src, /selected\.registryUrl/, "detail pane links to the registry when available");
assert.match(src, /const selectedSourceSummary = useMemo/, "detail pane derives a source summary for the selected skill");
assert.match(src, /const relatedSourceSkills = useMemo/, "detail pane derives related skills from the selected source");
assert.match(src, /More from \{selectedSource\}/, "detail pane labels the related source group");
assert.match(src, /selectedSourceSummary\.count\} skills · \{formatCount\(selectedSourceSummary\.installs\)\} installs/, "source group shows count and total installs");
assert.match(src, /className="skill-browser__source-skill"/, "source group renders clickable related skill rows");
assert.match(src, /onClick=\{\(\) => setSelectedKey\(skillKey\(skill\)\)\}/, "related source rows select that skill in the detail pane");

// Detail pane sources the SKILL.md body from /api/skills/file and renders it.
assert.match(
  src,
  /`\/api\/skills\/file\?path=\$\{encodeURIComponent\(selectedPath\)\}`/,
  "detail fetches the selected skill's SKILL.md via /api/skills/file",
);
assert.match(
  src,
  /`\/api\/skills\/directory\/\$\{encodeURIComponent\(selected\.id\)\}\?source=\$\{encodeURIComponent\(source\)\}`/,
  "detail fetches remote registry previews via /api/skills/directory/[id]?source=",
);
assert.match(src, /json\.text \?\? json\.preview\?\.text/, "detail renders remote preview markdown when no local file exists");
assert.match(src, /stripFrontmatter\(preview\.text\)/, "strips YAML frontmatter before rendering");
assert.match(src, /<MarkdownBlock text=\{body\}/, "renders the SKILL.md body as markdown");
assert.match(src, /selected\.description \|\| "No preview available/, "falls back to the description on error/empty (e.g. 403 outside allow-listed roots)");
assert.match(src, /skill-browser__detail-path/, "detail shows the skill's path");

// Selection is sticky-but-safe: first visible when the pick is filtered out.
assert.match(src, /rankedVisible\.find\(\(s\) => skillKey\(s\) === selectedKey\) \?\? rankedVisible\[0\]/, "auto-selects the first visible skill");

// ── Detail-pane actions: reveal folder + delete ─────────────────────────────
assert.match(src, /selectedHasLocalPath \? \(/, "detail actions are limited to installed/local entries");
assert.match(src, /icon="ph:folder-open"/, "reveal-folder action uses the folder-open icon");
assert.match(src, /leadingIcon="ph:trash"/, "delete action uses the trash icon");
// Reveal shells out via Tauri and copies the path on the web.
assert.match(src, /invoke\("shell_open", \{ url: dir \}\)/, "reveal opens the folder via Tauri shell_open on desktop");
assert.match(src, /copyText\(dir\)/, "reveal copies the path to the clipboard as the web fallback");
// Delete is a two-step confirm hitting the DELETE route, then re-scans.
assert.match(src, /if \(!confirmingDelete\) \{[\s\S]*?setConfirmingDelete\(true\)/, "delete requires an explicit confirm step");
assert.match(
  src,
  /fetch\(`\/api\/skills\/local\?path=\$\{encodeURIComponent\(selectedPath\)\}`,\s*\{\s*method: "DELETE"/,
  "delete calls DELETE /api/skills/local with the selected path",
);
assert.match(src, /onChanged\?\.\(\)/, "a successful delete asks the parent to re-scan");

// ── Marketplace-hub wiring: the Skills section renders the browser ───────────
assert.match(hub, /import \{ SkillBrowser, type SkillBrowserEntry \}/, "the Marketplace hub imports SkillBrowser");
assert.match(hub, /<SkillBrowser\s+skills=\{skills\}/, "the Skills section renders SkillBrowser with the full skill list");
assert.match(hub, /`\/api\/skills\/directory\?q=\$\{encodeURIComponent\(trimmed\)\}`/, "Skills search reloads through the registry search endpoint");
assert.match(hub, /window\.setTimeout\(\(\) => \{[\s\S]*?void loadSkills\(query\);[\s\S]*?\}, query\.trim\(\) \? 250 : 0\)/, "Skills search uses a small debounce before reloading remote results");
assert.match(hub, /onChanged=\{\(\) => void loadSkills\(query\)\}/, "the Skills section re-scans the current query after mutations");
assert.doesNotMatch(hub, /import \{ SkillCard \}/, "the old flat SkillCard list stays retired");
// The Skills section is full-bleed so the browser owns per-column scrolling.
assert.match(
  hub,
  /id="marketplace-panel-skills"[\s\S]{0,120}overflow-hidden/,
  "the Skills tabpanel is full-bleed (browser scrolls its own columns)",
);

// ── CSS present ──────────────────────────────────────────────────────────────
assert.match(css, /\.skill-browser \{[\s\S]*?display: flex;/, "the browser is a flex 3-column layout");
// The rail is a vertical sidepanel like Browse's category rail — never a
// horizontal strip, with the active row raised (not accent-washed chips).
assert.match(
  css,
  /\.skill-browser__rail \{[\s\S]{0,240}?flex-direction: column/,
  "the rail stacks its groups vertically (Browse's sidepanel grammar)",
);
assert.match(css, /\.skill-browser__rail \{[\s\S]{0,240}?border-right: 1px solid var\(--border-hairline\)/, "the rail is set off by a hairline like Browse's");
assert.match(css, /\.skill-browser__cat\.is-active \{[\s\S]{0,120}?background: var\(--bg-raised\)/, "the active rail row raises like Browse's active category");
assert.match(css, /\.skill-browser__cat-count/, "rail rows style their counts");
// Chips are the rail's narrow-pane stand-in: hidden by default, shown when the
// marketplace container narrows (the rail hides in the same query).
assert.match(css, /\.skill-browser__chips \{[\s\S]{0,80}?display: none/, "the chip row is hidden while the rail is visible");
assert.match(
  css,
  /@container marketplace \(max-width: 1023px\) \{[\s\S]{0,400}?\.skill-browser__rail \{ display: none; \}[\s\S]{0,120}?\.skill-browser__chips \{ display: flex; \}/,
  "narrow panes swap the rail for the chip row via the marketplace container query",
);
assert.match(css, /\.skill-browser__chip\.is-active \{[\s\S]{0,120}?background: var\(--text-primary\)/, "the active chip inverts like Browse's chips");
// Toolbar styling: count + selects share Browse's summary-row treatment.
assert.match(css, /\.skill-browser__toolbar \{/, "CSS includes the list toolbar");
assert.match(css, /\.skill-browser__toolbar-count \{/, "CSS includes the toolbar count");
assert.match(css, /\.skill-browser__select \{/, "CSS includes the toolbar select treatment");
// Simplified rows: no reserved stats column, one installs count.
assert.match(css, /\.skill-browser__card-installs \{/, "CSS includes the row installs count");
assert.doesNotMatch(css, /\.skill-browser__row-stats/, "the reserved stats column is gone");
assert.doesNotMatch(css, /\.skill-browser__activity/, "the sparkline CSS is gone");
assert.doesNotMatch(css, /\.skill-browser__leaderboard/, "the leaderboard header CSS is gone");
assert.doesNotMatch(css, /\.skill-browser__ecosystem/, "the ecosystem panel CSS is gone");
assert.match(css, /\.skill-browser__card\.is-active \{/, "the selected card is highlighted");
assert.match(css, /\.skill-browser__use-button \{/, "CSS includes the use button");
assert.match(css, /\.skill-browser__prompt-button \{/, "CSS includes the prompt button");
assert.match(css, /\.skill-browser__source-group \{/, "CSS includes the source group panel");
assert.match(css, /\.skill-browser__source-list \{/, "CSS includes the related source grid");
assert.match(css, /\.skill-browser__source-skill \{/, "CSS includes related source skill buttons");

console.log("skill-browser.test.ts OK");
