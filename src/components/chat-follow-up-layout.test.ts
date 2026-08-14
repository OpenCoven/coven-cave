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
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-auto-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-columns: none;/,
  "composer follow-ups stretch one to three equal options across the prompt width",
);
assert.doesNotMatch(
  styles,
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(3,/,
  "composer follow-ups do not reserve empty columns for malformed output",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?padding: var\(--space-1\) var\(--space-3\);/,
  "desktop composer follow-ups use compact token spacing",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?gap: var\(--space-2\);/,
  "composer follow-up cards keep the type/separator/title summary on one line",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__type \{[\s\S]*?white-space: nowrap;/,
  "the type label itself never wraps away from the title",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__title \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  "footer titles ellipsize instead of wrapping",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-card__separator \{[\s\S]*?display: inline;/,
  "the footer keeps the type/title separator visible",
);
assert.match(
  styles,
  /\.cave-followup-card__separator \{[\s\S]*?display: none;/,
  "historical cards keep the separator hidden and retain their full detail layout",
);
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-card \{[\s\S]*?min-height: var\(--touch-target\);/,
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
