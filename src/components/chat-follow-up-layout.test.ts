// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(
  new URL("../styles/cave-chat/transcript.css", import.meta.url),
  "utf8",
);
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const nextPaths = readFileSync(new URL("../lib/next-paths.ts", import.meta.url), "utf8");

assert.doesNotMatch(styles, /\.cave-chat-followups/, "composer-only recommendation layout is removed");
assert.match(
  styles,
  /\.cave-followup-card__separator \{[\s\S]*?display: none;/,
  "historical cards keep the separator hidden and retain their full detail layout",
);
assert.match(styles, /\.cave-followup-cards__grid \{[\s\S]*?grid-auto-flow: column;/, "the shared card component retains its independent layout");
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
