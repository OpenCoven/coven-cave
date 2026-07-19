// @ts-nocheck
// Chat revamp 1a — the home hearth card. Pins:
//   (1) one centered card: kicker → heading → live-context subtitle →
//       composer → demoted suggestions → Continue → Open work → snippets;
//   (2) Continue resumes real sessions through the workspace handler, with a
//       presence dot for running sessions;
//   (3) Open work reuses the EXISTING git/PR data paths (useChangesSummary +
//       useBranchPr — the same sources as the composer git chip) and the
//       shared /api/board snapshot, and persists its disclosure preference;
//   (4) Prompt snippets reuses the /api/prompts-backed picker list and the
//       existing PromptSnippetsModal browser, collapsed by default;
//   (5) suggestion pills obey the uniform-rows rule (data-count-keyed grid,
//       max 4, never 3+1 — #2672);
//   (6) the From-task row is prop-driven and explicitly unwired (no task→home
//       handoff exists yet).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const cont = await readFile(new URL("./home/home-continue.tsx", import.meta.url), "utf8");
const openWork = await readFile(new URL("./home/home-open-work.tsx", import.meta.url), "utf8");
const snippets = await readFile(new URL("./home/home-snippets.tsx", import.meta.url), "utf8");
const fromTask = await readFile(new URL("./home/home-from-task.tsx", import.meta.url), "utf8");
const pills = await readFile(new URL("./home/home-suggestion-pills.tsx", import.meta.url), "utf8");
const disclosure = await readFile(new URL("./home/use-home-disclosure.ts", import.meta.url), "utf8");
const boardHook = await readFile(new URL("./home/use-board-cards.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// ── (1) One hearth card, in order ────────────────────────────────────────────
assert.match(
  composer,
  /home-hearth-card[\s\S]*?home-composer-eyebrow[\s\S]*?What are we casting today\?[\s\S]*?home-composer-sub[\s\S]*?home-composer-card-wrap[\s\S]*?<HomeSuggestionPills[\s\S]*?<HomeContinue[\s\S]*?<HomeOpenWork[\s\S]*?<HomeSnippets/,
  "the hearth card stacks kicker → heading → subtitle → composer → suggestions → Continue → Open work → snippets",
);
assert.match(
  css,
  /\.home-hearth-card \{[\s\S]{0,600}?max-width: min\(930px, 100%\);[\s\S]{0,600}?border-radius: var\(--radius-xl\);[\s\S]{0,600}?color-mix\(in oklch, var\(--bg-panel\) 55%, transparent\)/,
  "the card is ~930px, radius-xl, hairline border, 55% panel fill (tokens only)",
);
assert.match(
  css,
  /\.home-composer-root \{[\s\S]{0,900}?radial-gradient\([\s\S]{0,200}?var\(--accent-presence\)/,
  "the base behind the card carries the radial presence wash",
);
// The subtitle derives from live state — no invented user-profile name (the
// mock addresses "Val" by name; this app has no user-profile store).
assert.doesNotMatch(composer, /casting today, /, "no invented user name in the heading");

// ── (2) Continue ─────────────────────────────────────────────────────────────
assert.match(cont, /!s\.archived_at && !s\.generated && Boolean\(s\.title\?\.trim\(\)\)/, "resumable = unarchived, human-initiated, titled");
assert.match(cont, /\.slice\(0, max\)/, "capped at the two most recent");
assert.match(cont, /onOpenSession\(s\.id, s\.familiarId \?\? null\)/, "a card resumes through the workspace handler");
assert.match(cont, /s\.status === "running"/, "the status dot keys off the session's running state");
assert.match(cont, /home-continue__dot\$\{running \? " is-running" : ""\}/, "running sessions carry the presence dot variant");
assert.match(cont, /relativeAge\(s\.updated_at, nowMs\)/, "the subline reuses the shared relative-age formatter");
assert.match(css, /\.home-continue__dot\.is-running \{\s*background: var\(--accent-presence\);/, "running dot = accent; idle stays muted");
assert.match(css, /\.home-continue__cards \{[\s\S]{0,200}?repeat\(2, minmax\(0, 1fr\)\)/, "two side-by-side cards");

// ── (3) Open work ────────────────────────────────────────────────────────────
assert.match(openWork, /useChangesSummary\(root, Boolean\(root\)\)/, "branch + dirty count ride the shared /api/changes poll");
assert.match(openWork, /useBranchPr\(root, branch\)/, "the PR row reuses the composer git chip's PR lookup");
assert.match(openWork, /import \{ useBranchPr \} from "@\/components\/composer-git-chip"/, "no duplicate PR fetch path");
assert.match(openWork, /HOME_OPEN_WORK_PREF_KEY = "cave:home:open-work-expanded"/, "the disclosure preference persists under a stable key");
assert.match(openWork, /useHomeDisclosure\(HOME_OPEN_WORK_PREF_KEY, true\)/, "Open work is expanded by default");
assert.match(openWork, /aria-expanded=\{open\}/, "the disclosure header is a button with aria-expanded");
assert.match(openWork, /openExternalUrl\(pr\.url\)/, "the PR row opens the pull request");
assert.match(openWork, /onClick=\{onOpenBoard\}/, "the tasks row jumps to the Task board");
assert.match(
  openWork,
  /needsYou\.length === 1 \? onOpenInboxItem\(firstNeed\) : onOpenSchedules\(\)/,
  "the needs-you row opens its one target or Rituals when several wait",
);
assert.match(openWork, /if \(rowCount === 0\) return null/, "an empty ledger renders nothing");
assert.match(openWork, /\{open \? `· \$\{rowCount\}` : `· \$\{summary\}`\}/, "collapsed, the header carries the one-line summary counts");
// Fade-ended divider: gradient ramps in 48px from each end (design 1a).
assert.match(
  css,
  /\.home-disclosure \{[\s\S]{0,400}?transparent,\s*var\(--border-hairline\) 48px,\s*var\(--border-hairline\) calc\(100% - 48px\),\s*transparent/,
  "disclosure headers sit over the fade-ended hairline",
);

// ── (4) Prompt snippets ──────────────────────────────────────────────────────
assert.match(snippets, /useHomeDisclosure\(HOME_SNIPPETS_PREF_KEY, false\)/, "snippets are collapsed by default");
assert.match(snippets, /orderPrompts\(prompts, favorites, recents\)\.slice\(0, PREVIEW_COUNT\)/, "top three use the modal's favorites>recents ordering");
assert.match(snippets, /aria-expanded=\{open\}/, "the snippets disclosure is a button with aria-expanded");
assert.match(snippets, /insert ↵/, "rows carry the insert affordance");
assert.match(snippets, /Show all \{prompts\.length\}…/, "Show all opens the full browser");
assert.match(
  composer,
  /<HomeSnippets\s*\n\s*prompts=\{prompts\}\s*\n\s*onInsert=\{insertPromptTemplate\}\s*\n\s*onShowAll=\{\(\) => setSnippetsBrowserOpen\(true\)\}/,
  "home wires the picker-hook prompt list and template insertion into the section",
);
assert.match(
  composer,
  /<PromptSnippetsModal\s*\n\s*open=\{snippetsBrowserOpen\}/,
  "Show all opens the existing PromptSnippetsModal browser",
);

// ── (5) Suggestion pills — uniform rows (#2672) ──────────────────────────────
assert.match(pills, /data-count=\{suggestions\.length\}/, "the pill grid is keyed off the pill count");
assert.match(pills, /buildHomeSuggestions\(\{ cards, projectName \}\)/, "pills reuse the pure suggestion heuristic (max 4 by default)");
assert.match(
  css,
  /\.home-suggest-pills\[data-count="2"\],\s*\.home-suggest-pills\[data-count="4"\] \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  "2 and 4 pills pair into two columns (4 = 2×2, never 3+1)",
);
assert.match(
  css,
  /\.home-suggest-pills\[data-count="3"\] \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  "3 pills fill one uniform row of three",
);
assert.match(css, /\.home-suggest-pill \{[\s\S]{0,400}?border-radius: var\(--radius-pill\);/, "pills are 999px with a hairline border");

// ── (6) From-task row — built, conditional, explicitly unwired ───────────────
assert.match(fromTask, /if \(!origin\) return null/, "the row renders only with a task origin");
assert.match(fromTask, /\.slice\(0, 3\)/, "chips cap at three (uniform-row rule)");
assert.match(fromTask, /From task/, "the accent 'From task' label renders");
assert.match(composer, /const taskOrigin: HomeTaskOrigin \| null = null;/, "home passes null — no task→home handoff exists yet (see the NOTE)");
assert.match(composer, /taskOrigin \? \(\s*<HomeFromTaskRow origin=\{taskOrigin\} onPickSuggestion=\{insertPrompt\} \/>\s*\) : \(\s*<HomeSuggestionPills/, "the row replaces the pill row when a task origin arrives");

// ── Shared plumbing ──────────────────────────────────────────────────────────
// Disclosure prefs read AFTER mount (SSR-deterministic, like the greeting).
assert.match(disclosure, /useState\(defaultOpen\);\s*useEffect\(\(\) => \{\s*setOpen\(readDisclosurePref\(key, defaultOpen\)\);/s, "stored prefs land post-mount so hydration can't drift");
// One /api/board snapshot serves both the pills and the Open work tasks row.
assert.match(boardHook, /fetch\("\/api\/board", \{ cache: "no-store" \}\)/, "the board snapshot is fetched once");
const boardFetches = composer.match(/fetch\("\/api\/board"/g) ?? [];
assert.equal(boardFetches.length, 1, "home-composer keeps exactly one /api/board call site (the Task-create POST)");
assert.match(composer, /const boardCards = useBoardCards\(\);/, "sections share the hook's snapshot instead of refetching");

console.log("home-hearth.test.ts: ok");
