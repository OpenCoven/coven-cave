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
  /\.cave-chat-followups \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--cave-chat-measure\);/,
  "composer follow-ups align to the prompt input measure",
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
