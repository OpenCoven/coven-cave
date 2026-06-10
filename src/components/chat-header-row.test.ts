// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// After the streamline refactor the header is MetaLine (title + status meta)
// plus an optional LinkedContextRow — no ChatContextStrip, no headline row.
assert.doesNotMatch(
  source,
  /<ChatContextStrip\b/,
  "ChatContextStrip is replaced by MetaLine + LinkedContextRow",
);

assert.doesNotMatch(
  source,
  /<ChatHeadlineTitle\b/,
  "Headline title row is folded into MetaLine (title + meta on one row)",
);

assert.match(
  source,
  /<MetaLine\b/,
  "ChatView renders MetaLine for the title + status banner",
);

assert.match(
  source,
  /<LinkedContextRow\b/,
  "ChatView renders LinkedContextRow for task/GitHub chips",
);

assert.match(
  source,
  /function LinkedContextRow[\s\S]*?if \(!task && github\.length === 0\) return null/,
  "LinkedContextRow only renders when linked context has entries",
);

assert.match(
  styles,
  /\.cave-chat-meta-line\s*\{/,
  "cave-chat-meta-line CSS rule is defined",
);

assert.match(
  styles,
  /\.cave-chat-meta-line--streaming[\s\S]*\.cave-chat-meta-line--failed/,
  "Meta line has streaming/failed state modifiers",
);

assert.match(
  styles,
  /\.cave-chat-meta-line__meta\s*\{[\s\S]*?text-overflow\s*:\s*ellipsis/,
  "Meta string should truncate instead of wrapping the header taller",
);

assert.doesNotMatch(
  styles,
  /\.cave-chat-lifecycle-status/,
  "Standalone lifecycle status bar CSS is removed (folded into meta line)",
);

console.log("chat-header-row.test.ts: ok");
