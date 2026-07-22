// @ts-nocheck
// Chat revamp 1a + cards-only pass (2026-07-22) — the home hearth card. Pins:
//   (1) one centered card: kicker → heading → live-context subtitle →
//       composer → Continue cards. The Continue / Open work / Prompt
//       snippets sections and the Ask Salem doorway were pulled OFF home,
//       then Continue came back as the sole section (reference parity);
//   (2) the cold-start suggestion pills are REMOVED (cards-only home): the
//       hearth is the composer plus the centered Continue cards. Cards are
//       centered and follow the Appearance corner-radius token;
//   (3) the From-task row is prop-driven and explicitly unwired (no task→home
//       handoff exists yet).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const fromTask = await readFile(new URL("./home/home-from-task.tsx", import.meta.url), "utf8");
const disclosure = await readFile(new URL("./home/use-home-disclosure.ts", import.meta.url), "utf8");
const boardHook = await readFile(new URL("./home/use-board-cards.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// ── (1) One hearth card, in order ────────────────────────────────────────
assert.match(
  composer,
  /home-hearth-card[\s\S]*?home-composer-eyebrow[\s\S]*?What are we casting today\?[\s\S]*?home-composer-card-wrap[\s\S]*?<HomeContinue/,
  "the hearth card stacks kicker → heading → composer → Continue cards",
);
assert.match(
  css,
  /\.home-hearth-card \{[\s\S]{0,600}?max-width: min\(900px, 100%\)/,
  "the card is capped at 900px wide (minimal pass — borderless, transparent wrapper)",
);
assert.match(
  css,
  /\.home-composer-root \{[\s\S]{0,900}?radial-gradient\([\s\S]{0,200}?var\(--accent-presence\)/,
  "the base behind the card carries the radial presence wash",
);
// The subtitle derives from live state — no invented user-profile name.
assert.doesNotMatch(composer, /casting today, /, "no invented user name in the heading");

// ── Ultra-minimal pass: the stacked sections + Ask Salem are OFF home ───────
// Note: HomeContinue was re-added in the reference parity pass (2026-07-22).
// assert.doesNotMatch(composer, /<HomeContinue/, "Continue no longer renders on the minimal home");
assert.match(composer, /<HomeContinue/, "Continue cards render (reference parity pass 2026-07-22)");
assert.doesNotMatch(composer, /<HomeOpenWork/, "Open work no longer renders on the minimal home");
assert.doesNotMatch(composer, /<HomeSnippets/, "Prompt snippets no longer renders on the minimal home");
assert.doesNotMatch(composer, /home-ask-salem/, "the Ask Salem doorway no longer renders on the minimal home");
assert.doesNotMatch(composer, /<HomeDigestCarousel/, "the digest carousel no longer renders on home");

// ── (2) Cards-only home: pills removed; Continue cards centered ─────────────
assert.doesNotMatch(composer, /HomeSuggestionPills|useBoardCards\(\)/, "the cold-start pills (and their board snapshot) are gone from home");
assert.doesNotMatch(css, /home-suggest-pill/, "the pill CSS is removed with the component");
assert.match(
  css,
  /\.home-continue__label \{[\s\S]{0,300}?text-align: center/,
  "the Continue label centers under the centered composer",
);
assert.match(
  css,
  /\.home-continue__cards \{[\s\S]{0,300}?justify-content: center/,
  "the card grid centers its tracks",
);
assert.match(
  css,
  /\.home-continue__cards\[data-count="1"\] \{ grid-template-columns: minmax\(0, 30rem\); \}/,
  "a lone card stays content-width and centered instead of stretching",
);
assert.match(
  css,
  /\.home-continue__card \{[\s\S]{0,700}?border-radius: var\(--radius-card\);/,
  "cards use --radius-card so the Appearance corner-radius setting applies",
);

// ── (3) From-task row — built, conditional, explicitly unwired ────────────
assert.match(fromTask, /if \(!origin\) return null/, "the row renders only with a task origin");
assert.match(fromTask, /\.slice\(0, 3\)/, "chips cap at three (uniform-row rule)");
assert.match(fromTask, /From task/, "the accent 'From task' label renders");
assert.match(composer, /const taskOrigin: HomeTaskOrigin \| null = null;/, "home passes null — no task→home handoff exists yet (see the NOTE)");
assert.match(
  composer,
  /taskOrigin \? \(\s*<HomeFromTaskRow origin=\{taskOrigin\} onPickSuggestion=\{insertPrompt\} \/>\s*\) : null\}/,
  "the From-task row is the only chip strip left under the composer",
);

// ── Shared plumbing ───────────────────────────────────────────────────
// Disclosure prefs read AFTER mount (SSR-deterministic, like the greeting).
assert.match(disclosure, /useState\(defaultOpen\);\s*useEffect\(\(\) => \{\s*setOpen\(readDisclosurePref\(key, defaultOpen\)\);/s, "stored prefs land post-mount so hydration can't drift");
// The board-snapshot hook remains shared plumbing (home-open-work helper).
assert.match(boardHook, /fetch\("\/api\/board", \{ cache: "no-store" \}\)/, "the board snapshot is fetched once");
const boardFetches = composer.match(/fetch\("\/api\/board"/g) ?? [];
assert.equal(boardFetches.length, 1, "home-composer keeps exactly one /api/board call site (the Task-create POST)");

console.log("home-hearth.test.ts: ok");
