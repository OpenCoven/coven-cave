// @ts-nocheck
// Chat revamp 1a + ultra-minimal pass — the home hearth card. Pins:
//   (1) one centered card: kicker → heading → live-context subtitle →
//       composer → cold-start pills. The Continue / Open work / Prompt
//       snippets sections and the Ask Salem doorway were pulled OFF home
//       (ChatGPT/Claude-grade minimal — the home is the composer, full stop);
//   (2) suggestion pills are cold-start help: capped at one quiet row of two,
//       hidden while a draft exists, uniform-rows grid (#2672);
//   (3) the From-task row is prop-driven and explicitly unwired (no task→home
//       handoff exists yet).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const fromTask = await readFile(new URL("./home/home-from-task.tsx", import.meta.url), "utf8");
const pills = await readFile(new URL("./home/home-suggestion-pills.tsx", import.meta.url), "utf8");
const disclosure = await readFile(new URL("./home/use-home-disclosure.ts", import.meta.url), "utf8");
const boardHook = await readFile(new URL("./home/use-board-cards.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// ── (1) One hearth card, in order ────────────────────────────────────────
assert.match(
  composer,
  /home-hearth-card[\s\S]*?home-composer-eyebrow[\s\S]*?What are we casting today\?[\s\S]*?home-composer-card-wrap[\s\S]*?<HomeSuggestionPills/,
  "the hearth card stacks kicker → heading → composer → cold-start pills",
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
// The subtitle derives from live state — no invented user-profile name.
assert.doesNotMatch(composer, /casting today, /, "no invented user name in the heading");

// ── Ultra-minimal pass: the stacked sections + Ask Salem are OFF home ───────
assert.doesNotMatch(composer, /<HomeContinue/, "Continue no longer renders on the minimal home");
assert.doesNotMatch(composer, /<HomeOpenWork/, "Open work no longer renders on the minimal home");
assert.doesNotMatch(composer, /<HomeSnippets/, "Prompt snippets no longer renders on the minimal home");
assert.doesNotMatch(composer, /home-ask-salem/, "the Ask Salem doorway no longer renders on the minimal home");
assert.doesNotMatch(composer, /<HomeDigestCarousel/, "the digest carousel no longer renders on home");

// ── (2) Suggestion pills — cold-start help, uniform rows (#2672) ───────────
assert.match(pills, /data-count=\{suggestions\.length\}/, "the pill grid is keyed off the pill count");
assert.match(pills, /buildHomeSuggestions\(\{ cards, projectName, max: 2 \}\)/, "cold-start pills cap at one quiet row of two (minimal pass)");
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

// ── (3) From-task row — built, conditional, explicitly unwired ────────────
assert.match(fromTask, /if \(!origin\) return null/, "the row renders only with a task origin");
assert.match(fromTask, /\.slice\(0, 3\)/, "chips cap at three (uniform-row rule)");
assert.match(fromTask, /From task/, "the accent 'From task' label renders");
assert.match(composer, /const taskOrigin: HomeTaskOrigin \| null = null;/, "home passes null — no task→home handoff exists yet (see the NOTE)");
assert.match(
  composer,
  /taskOrigin \? \(\s*<HomeFromTaskRow origin=\{taskOrigin\} onPickSuggestion=\{insertPrompt\} \/>\s*\) : !text\.trim\(\) \? \(\s*<HomeSuggestionPills/,
  "the From-task row outranks the pills; the pills render only while the draft is empty (progressive disclosure)",
);

// ── Shared plumbing ───────────────────────────────────────────────────
// Disclosure prefs read AFTER mount (SSR-deterministic, like the greeting).
assert.match(disclosure, /useState\(defaultOpen\);\s*useEffect\(\(\) => \{\s*setOpen\(readDisclosurePref\(key, defaultOpen\)\);/s, "stored prefs land post-mount so hydration can't drift");
// One /api/board snapshot serves the pills (and the Task-create POST).
assert.match(boardHook, /fetch\("\/api\/board", \{ cache: "no-store" \}\)/, "the board snapshot is fetched once");
const boardFetches = composer.match(/fetch\("\/api\/board"/g) ?? [];
assert.equal(boardFetches.length, 1, "home-composer keeps exactly one /api/board call site (the Task-create POST)");
assert.match(composer, /const boardCards = useBoardCards\(\);/, "sections share the hook's snapshot instead of refetching");

console.log("home-hearth.test.ts: ok");
