// @ts-nocheck
// Pins for the PR-merge reward flare (cave-hshy) — same contracts as the
// board's card-done flare: celebrations-pref gated, announce() stays the AT
// channel, one-shot with a self-clearing timer, reduced-motion collapse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-card.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("./github-card-composer.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// The merge now fires from the composer (cave-076kh), but the division of
// labour is unchanged: announce() is the AT channel, onMerged() is the flare.
assert.match(
  composer,
  /announce\(`Merged \$\{repo\}#\$\{number\}\.`\);/,
  "merge success announces for AT — the flare is visual-only on top of this",
);
assert.match(composer, /onMerged\?\.\(\);/, "merge success signals the parent so it can play the flare");
assert.match(
  source,
  /onMerged=\{\(\) => \{ if \(readCelebrationsEnabled\(\)\) setJustMerged\(true\); \}\}/,
  "the flare fires only when celebrations are enabled",
);
assert.match(
  source,
  /setTimeout\(\(\) => setJustMerged\(false\), 900\)/,
  "reward state self-clears so re-renders can't replay the flare",
);
assert.match(
  source,
  /justMerged \? " cave-gh-card--reward" : ""/,
  "the card root wears the reward class",
);

assert.match(
  css,
  /cave-gh-reward-flare 700ms var\(--ease-decelerate\) forwards/,
  "700ms decelerate one-shot (summoning-flare vocabulary)",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.cave-gh-card--reward \{ animation: none; \}/,
  "reduced motion collapses the flare entirely",
);

console.log("github-card-reward: all pins hold");
