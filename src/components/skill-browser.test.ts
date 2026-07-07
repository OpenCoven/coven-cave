// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./skill-browser.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("./marketplace-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Merged discovery panel (header + filters + list) · detail pane ──────────
assert.match(src, /export function SkillBrowser\(/, "exports the SkillBrowser component");
assert.match(src, /className="skill-browser__rail"/, "renders the filter strip");
assert.match(src, /className="skill-browser__list"/, "renders the merged discovery panel");
assert.match(src, /className="skill-browser__detail"/, "renders the detail pane");
// Merged panel: the leaderboard header and the filter strip both live INSIDE
// the list panel (panel opens, then header, then filters) — not beside it.
assert.ok(
  src.indexOf('className="skill-browser__list"') < src.indexOf('className="skill-browser__leaderboard"') &&
    src.indexOf('className="skill-browser__leaderboard"') < src.indexOf('className="skill-browser__rail"'),
  "leaderboard header and filter strip are nested inside the merged list panel, header first",
);

// Category rail: All / Installed / Claude Code / Generic with derived counts.
assert.match(src, /label: "All Skills"/, "rail has an All Skills entry");
assert.match(src, /label: "Installed"/, "rail has an Installed entry");
assert.match(src, /label: "Claude Code"[\s\S]*?icon: "ph:terminal-window"/, "rail has a Claude Code entry");
assert.match(src, /label: "Generic"[\s\S]*?icon: "ph:puzzle-piece"/, "rail has a Generic entry");
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
assert.match(src, /className="skill-browser__cat-count"/, "each category shows a count");

// Directory discovery: skills.sh-style ranking modes, agent compatibility, and
// install commands sit above the local SKILL.md detail workflow.
assert.match(src, /type LeaderboardMode = "all-time" \| "trending" \| "hot"/, "supports leaderboard modes");
assert.match(src, /label: "All Time"/, "leaderboard includes All Time mode");
assert.match(src, /label: "Trending"/, "leaderboard includes Trending mode");
assert.match(src, /label: "Hot"/, "leaderboard includes Hot mode");
assert.match(src, /type BrowseFilter = "all" \| "official" \| "audited" \| "installed"/, "supports skills.sh-style browse filters");
assert.match(src, /label: "All skills"[\s\S]*?icon: "ph:magnifying-glass"/, "browse filter includes All skills");
assert.match(src, /label: "Official"[\s\S]*?icon: "ph:seal-check"/, "browse filter includes Official");
assert.match(src, /label: "Security audits"[\s\S]*?icon: "ph:shield-warning"/, "browse filter includes Security audits");
assert.match(src, /const SKILLS_DIRECTORY_LINKS = \[/, "defines skills.sh top navigation links");
assert.match(src, /label: "Topics"[\s\S]*?href: "https:\/\/www\.skills\.sh\/topic"/, "directory nav links to skills.sh Topics");
assert.match(src, /label: "Official"[\s\S]*?href: "https:\/\/www\.skills\.sh\/official"/, "directory nav links to skills.sh Official");
assert.match(src, /label: "Security audits"[\s\S]*?href: "https:\/\/www\.skills\.sh\/audits"/, "directory nav links to skills.sh Audits");
assert.match(src, /label: "Docs"[\s\S]*?href: "https:\/\/www\.skills\.sh\/docs"/, "directory nav links to skills.sh Docs");
assert.match(src, /const FEATURED_AGENT_LABELS = \[/, "defines the skills.sh supported agent strip");
assert.match(src, /"Claude Code"[\s\S]*?"Cursor"[\s\S]*?"Codex"[\s\S]*?"GitHub Copilot"/, "supported agent strip starts with skills.sh's first-party agents");
assert.match(src, /className="skill-browser__ecosystem"/, "leaderboard renders the skills.sh ecosystem panel");
assert.match(src, /Try it now/, "ecosystem panel shows the skills.sh Try it now command");
assert.match(src, /className="skill-browser__ecosystem-command"/, "ecosystem panel renders a global install command");
assert.match(src, /className="skill-browser__agent-strip"/, "ecosystem panel renders supported agents");
assert.match(src, /className="skill-browser__directory-links"/, "ecosystem panel renders directory navigation links");
assert.match(src, /const TOPIC_FILTERS = \[/, "defines skills.sh-style topic filters");
assert.match(src, /label: "React"[\s\S]*?keywords: \["react"\]/, "topic filters include React");
assert.match(src, /label: "Next\.js"/, "topic filters include Next.js");
assert.match(src, /label: "Design & UI"/, "topic filters include Design & UI");
assert.match(src, /label: "Agent workflows"/, "topic filters include Agent workflows");
assert.match(src, /function matchesBrowseFilter\(skill: SkillBrowserEntry, filter: BrowseFilter\)/, "browse filters are applied by helper");
assert.match(src, /function matchesTopic\(skill: SkillBrowserEntry, topicId: string\)/, "topic filters are applied by helper");
assert.match(src, /matchesBrowseFilter\(s, browse\)/, "visible skills are filtered by browse state");
assert.match(src, /matchesTopic\(s, topic\)/, "visible skills are filtered by topic state");
assert.match(src, /className="skill-browser__browse"/, "renders the Browse chip row");
assert.match(src, /className="skill-browser__topics"/, "renders the Topics chip row");
assert.match(src, /className="skill-browser__agents"/, "renders the agent compatibility filter row");
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
assert.match(css, /\.skill-browser__decision-card \{[\s\S]*?min-height:/, "detail decision cards reserve stable height");
assert.match(src, /copyText\(installCommand\(selected\)\)/, "detail pane can copy the install command");
assert.match(src, /function handleInstall\(\)/, "detail pane can install a selected directory skill");
assert.match(src, /fetch\("\/api\/skills\/directory\/install"/, "install action calls the guarded install route");
assert.match(src, /body: JSON\.stringify\(\{ id: selected\.id, source: sourceTarget\(selected\), agents: \["claude-code", "codex"\] \}\)/, "install action requests Claude Code and Codex installation");
assert.match(src, /onChanged\?\.\(\)/, "successful install asks the parent to rescan installed state");
assert.match(src, /function handleUseSkill\(\)/, "detail pane can use a selected skill without installing it");
assert.match(src, /fetch\("\/api\/skills\/directory\/use"/, "use action calls the guarded skills use route");
assert.match(src, /function requestSkillPrompt\(selectedSkill: SkillBrowserEntry\)/, "use and copy prompt share the guarded prompt request");
assert.match(src, /new CustomEvent\("cave:agents-new-chat"/, "use action opens a Cave chat with the generated skill prompt");
assert.match(src, /initialPrompt: prompt/, "use action sends the generated prompt into chat");
assert.match(src, /function handleCopyPrompt\(\)/, "detail pane can copy the generated skill prompt without opening chat");
assert.match(src, /copyText\(prompt\)/, "copy prompt writes the generated prompt to the clipboard");
assert.match(src, /className="skill-browser__prompt-button"/, "detail pane renders a copy-prompt action");
assert.match(src, /leadingIcon="ph:clipboard-text"/, "copy-prompt action uses a clipboard icon");
assert.match(src, /import \{ Button \}/, "SkillBrowser labelled actions use the shared Button primitive");
assert.match(src, /import \{ IconButton \}/, "SkillBrowser icon actions use the shared IconButton primitive");
assert.doesNotMatch(src, /<button\b/, "SkillBrowser should not hand-roll button controls");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "SkillBrowser should not hard-code rectangular radius classes",
);
assert.match(src, /selected\.sourceUrl/, "detail pane links to skill source when available");
assert.match(src, /selected\.registryUrl/, "detail pane links to the registry when available");
assert.match(src, /const selectedSourceSummary = useMemo/, "detail pane derives a source summary for the selected skill");
assert.match(src, /const relatedSourceSkills = useMemo/, "detail pane derives related skills from the selected source");
assert.match(src, /More from \{selectedSource\}/, "detail pane labels the related source group");
assert.match(src, /selectedSourceSummary\.count\} skills · \{formatCount\(selectedSourceSummary\.installs\)\} installs/, "source group shows count and total installs");
assert.match(src, /className="skill-browser__source-skill"/, "source group renders clickable related skill rows");
assert.match(src, /onClick=\{\(\) => setSelectedKey\(skillKey\(skill\)\)\}/, "related source rows select that skill in the detail pane");
assert.match(src, /rankedVisible\.map\(\(skill, index\)/, "renders ranked leaderboard rows");
assert.match(src, /className="skill-browser__rank"/, "leaderboard rows expose rank");
assert.match(src, /className="skill-browser__metric"/, "leaderboard rows expose the active score metric");
assert.match(src, /weeklyInstalls\?: number\[\]/, "browser entries carry skills.sh 8-week activity data");
assert.match(src, /function weeklyActivity\(skill: SkillBrowserEntry\)/, "leaderboard rows derive weekly activity bars");
assert.match(src, /aria-label=\{`8 week activity: \$\{activity\.label\}`\}/, "activity bars expose an accessible 8-week summary");
assert.match(src, /className="skill-browser__row-stats"/, "leaderboard rows keep activity and metric in a stable stats column");
assert.match(src, /className="skill-browser__activity"/, "leaderboard rows render skills.sh-style activity bars");
assert.match(src, /className="skill-browser__activity-bar"/, "leaderboard activity renders individual weekly bars");

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
assert.match(css, /\.skill-browser__leaderboard \{/, "CSS includes the leaderboard header");
assert.match(css, /\.skill-browser__ecosystem \{/, "CSS includes the skills.sh ecosystem panel");
assert.match(css, /\.skill-browser__ecosystem-command \{/, "CSS includes the Try it now command treatment");
assert.match(css, /\.skill-browser__agent-strip \{/, "CSS includes the supported agent strip");
assert.match(css, /\.skill-browser__directory-links \{/, "CSS includes directory navigation links");
assert.match(css, /\.skill-browser__browse,\s*\n\.skill-browser__topics,/, "CSS includes browse/topic filter rows");
assert.match(css, /\.skill-browser__browse-btn,\s*\n\.skill-browser__topic,/, "CSS includes browse/topic buttons");
assert.match(css, /\.skill-browser__topic-count/, "CSS includes topic count styling");
assert.match(css, /\.skill-browser__mode\.is-active/, "CSS includes selected leaderboard mode state");
assert.match(css, /\.skill-browser__install-button,\s*\n\.skill-browser__use-button,\s*\n\.skill-browser__prompt-button \{/, "CSS includes the install/use/prompt buttons");
assert.match(css, /\.skill-browser__use-button \{/, "CSS includes the use button");
assert.match(css, /\.skill-browser__prompt-button \{/, "CSS includes the prompt button");
assert.match(css, /\.skill-browser__source-group \{/, "CSS includes the source group panel");
assert.match(css, /\.skill-browser__source-list \{/, "CSS includes the related source grid");
assert.match(css, /\.skill-browser__source-skill \{/, "CSS includes related source skill buttons");
assert.match(css, /\.skill-browser__row-stats \{/, "CSS includes a stable stats column for activity and installs");
assert.match(css, /\.skill-browser__activity \{/, "CSS includes the 8-week activity chart");
assert.match(css, /\.skill-browser__activity-bar \{/, "CSS includes individual activity bars");
assert.match(css, /\.skill-browser__card \{[\s\S]*?min-height: 72px;/, "skill cards reserve enough height for activity and install stats");
assert.match(css, /\.skill-browser__card\.is-active \{/, "the selected card is highlighted");
assert.match(
  css,
  /\.skill-browser__rail \{[\s\S]*?flex-direction: row/,
  "the filter strip is a horizontal chip row inside the merged panel at every width",
);
assert.doesNotMatch(
  css,
  /\.skill-browser__rail[^{]*\{[^}]*display:\s*none/,
  "the filter strip is the only category control, so it must never be display:none",
);

console.log("skill-browser.test.ts OK");
