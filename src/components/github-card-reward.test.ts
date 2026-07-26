// @ts-nocheck
// Pins for the PR-merge reward flare (cave-hshy) — same contracts as the
// board's card-done flare: celebrations-pref gated, announce() stays the AT
// channel, one-shot with a self-clearing timer, reduced-motion collapse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  source,
  /if \(pending\.kind === "merge"\) \{\n\s*announce\(`Merged \$\{descriptor\.repo\}#\$\{descriptor\.number\}\.`\);\n\s*onMerged\?\.\(\);/,
  "merge success announces for AT and signals the parent — the flare is visual-only on top",
);
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
