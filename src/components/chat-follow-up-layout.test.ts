// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(
  new URL("../styles/cave-chat/transcript.css", import.meta.url),
  "utf8",
);

assert.match(
  styles,
  /\.cave-chat-followups \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--cave-chat-measure\);/,
  "composer follow-ups align to the prompt input measure",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  "composer follow-ups fit exactly three equal options across the prompt width",
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

console.log("chat-follow-up-layout.test.ts: ok");
