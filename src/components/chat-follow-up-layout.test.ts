// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(
  new URL("../styles/cave-chat/transcript.css", import.meta.url),
  "utf8",
);
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const nextPaths = readFileSync(new URL("../lib/next-paths.ts", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing CSS block for ${selector}`);
  return match[1];
}

const compactGridBlock = cssBlock(".cave-chat-followups .cave-followup-cards__grid");
const compactCardBlock = cssBlock(".cave-chat-followups .cave-followup-card");
const compactRecommendedIndicatorBlock = cssBlock(".cave-chat-followups .cave-followup-card__recommended-indicator");
const compactRecommendedBlock = styles.match(
  /\.cave-chat-followups \.cave-followup-card--recommended,\s*\n\.cave-chat-followups \.cave-followup-card--recommended:hover \{([\s\S]*?)\n\}/m,
)?.[1];

assert.ok(compactRecommendedBlock, "missing recommended footer card override");

assert.match(
  styles,
  /\.cave-chat-followups \{[\s\S]*?flex: 0 0 100%;[\s\S]*?width: 100%;[\s\S]*?border-top: 1px solid var\(--border-hairline\);/,
  "composer follow-ups span the attached footer below its context row",
);
assert.match(compactGridBlock, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, "composer follow-ups render four equal footer columns");
assert.match(compactCardBlock, /display: flex;/, "footer cards stay inline controls");
assert.match(compactCardBlock, /align-items: center;/, "footer cards keep their summary row aligned");
assert.match(compactCardBlock, /gap: var\(--space-1\);/, "footer cards use the compact token gap");
assert.match(compactCardBlock, /padding: var\(--space-1\) var\(--space-2\);/, "footer cards use compact token padding");
assert.match(compactCardBlock, /border-radius: var\(--radius-control\);/, "footer cards use the control radius token");
assert.match(
  compactRecommendedBlock,
  /border-color: color-mix\(in oklch, var\(--color-success\) 42%, var\(--border-hairline\)\);/,
  "recommended footer cards derive their border from the semantic success token",
);
assert.doesNotMatch(compactRecommendedBlock, /animation:|transition:/, "recommended footer cards keep a static border treatment");
assert.match(compactRecommendedIndicatorBlock, /display: inline-flex;/, "recommended footer cards keep a visible non-color cue");
assert.match(compactRecommendedIndicatorBlock, /color: var\(--color-success\);/, "the recommendation cue uses the semantic success token");
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-card \{[\s\S]*?min-height: var\(--touch-target\);/,
  "narrow composer follow-ups preserve touch-safe targets",
);
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  "narrow composer follow-ups switch to two equal columns",
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
