// @ts-nocheck
// Pins for the card-done reward flare — the contracts that keep it dignified:
// gated on the celebrations pref, one-shot with a self-clearing timer, visual
// only (announce stays the AT channel), and collapsed under reduced motion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const kanban = readFileSync(new URL("./board-kanban.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/board.css", import.meta.url), "utf8");

// board-view: trigger fires only for "done" + celebrations on, and self-clears.
assert.match(
  view,
  /status === "done" && readCelebrationsEnabled\(\)/,
  "flare fires only on Done and only when celebrations are enabled",
);
assert.match(
  view,
  /setTimeout\(\(\) => setRewardCardId\(null\), 900\)/,
  "reward state self-clears so re-renders can't replay the flare",
);
assert.match(
  view,
  /announce\(`Moved '\$\{title\}'/,
  "the announcer remains the AT channel — the flare is visual-only on top of it",
);

// board-kanban: the reward class reaches the card element.
assert.match(kanban, /hasReward \? " board-kanban-card--reward" : ""/, "card wears the reward class");
assert.match(kanban, /rewardCardId === card\.id/, "only the completed card flares");

// board.css: one-shot animation + reduced-motion collapse.
assert.match(css, /board-reward-flare 700ms var\(--ease-decelerate\) forwards/, "700ms decelerate one-shot (summoning-flare vocabulary)");
assert.match(css, /--color-success/, "flare derives from the success token, never a hardcoded green");
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.board-kanban-card--reward \{ animation: none; \}/,
  "reduced motion collapses the flare entirely",
);

console.log("board-reward-flare: all pins hold");
