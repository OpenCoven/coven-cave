// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(
  new URL("../styles/cave-chat/transcript.css", import.meta.url),
  "utf8",
);
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const nextPaths = readFileSync(new URL("../lib/next-paths.ts", import.meta.url), "utf8");

assert.match(
  styles,
  /\.cave-chat-followups \{[\s\S]*?flex: 0 0 100%;[\s\S]*?width: 100%;[\s\S]*?border-top: 1px solid var\(--border-hairline\);/,
  "composer follow-ups span the attached footer below its context row",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
  "composer follow-ups render four equal columns across the prompt width",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?border-radius: var\(--radius-control\);/,
  "composer follow-ups use control radii",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?padding: var\(--space-1\) var\(--space-2\);/,
  "desktop composer follow-ups use compact token spacing",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__summary \{[\s\S]*?flex-wrap: nowrap;/,
  "composer follow-up summaries stay on one line in the compact footer",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__title \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  "composer follow-up titles truncate cleanly in the compact footer",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__title \{[\s\S]*?flex: 1 1 auto;/,
  "composer follow-up titles keep flex room for ellipsis",
);
assert.match(
  styles,
  /\.cave-followup-card__summary \{[\s\S]*?flex-wrap: wrap;/,
  "historical follow-up cards keep the fuller wrapped presentation",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__outcome \{[\s\S]*?display: none;/,
  "composer follow-ups hide outcomes in the compact footer",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__recommended \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0 0 0 0\);/,
  "composer follow-ups keep recommended text in the DOM while visually hiding it",
);
assert.match(
  styles,
  /\.cave-followup-card--recommended \{[\s\S]*?var\(--color-success\)[\s\S]*?var\(--border-hairline\)/,
  "recommended follow-ups use a success-tinted border",
);
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.cave-chat-followups \.cave-followup-card \{[\s\S]*?min-height: var\(--touch-target\);/,
  "narrow composer follow-ups preserve touch-safe targets",
);
assert.doesNotMatch(
  chatView,
  /extractNextPaths\([^;]+\.suggestions\.slice\(0,\s*4\)/,
  "the parser owns the suggestion cap without a stale view-level limit",
);
assert.doesNotMatch(
  nextPaths,
  /At most 4 pills/,
  "the parser comment stays aligned with the default cap",
);

console.log("chat-follow-up-layout.test.ts: ok");
