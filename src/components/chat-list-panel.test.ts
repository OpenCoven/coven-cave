// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /agent-panel-dossier/,
  "ChatList should render a compact agent dossier header for the side panel",
);

assert.match(
  source,
  /Agent runtime/,
  "ChatList should label the familiar harness/model metadata as agent runtime",
);

assert.match(
  source,
  /const runningCount = mine\.filter\(\(s\) => s\.status === "running"\)\.length/,
  "ChatList should summarize running chats in the side-panel header",
);

assert.match(
  source,
  /const projectCount = new Set\(mine\.map\(\(s\) => s\.project_root\)\.filter\(Boolean\)\)\.size/,
  "ChatList should summarize active project coverage",
);

assert.match(
  source,
  /Ready for a new thread/,
  "ChatList empty state should frame the agent as ready instead of only saying no chats exist",
);

assert.match(
  source,
  /Start with context/,
  "ChatList empty state should expose a direct contextual chat action",
);

assert.doesNotMatch(
  source,
  /flex h-full flex-col items-center justify-center gap-4 px-8 text-center/,
  "ChatList should not keep the sparse centered empty-state layout from the screenshot",
);
