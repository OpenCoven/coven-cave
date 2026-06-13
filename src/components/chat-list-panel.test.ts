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
  /<FamiliarAvatar familiar=\{resolvedFamiliar\} size="md" \/>/,
  "ChatList dossier header should render the familiar avatar (post-FamiliarAvatar migration in 0244b6a)",
);

assert.match(
  source,
  /panelRole[\s\S]*Agent runtime/,
  "ChatList dossier header should keep the familiar role and runtime subtitle together",
);

// NOTE: the running/project-count "Stats" summary that used to live in the
// dossier header was deliberately removed for side-panel optimization
// (chat-list.tsx: "Stats removed for sidepanel optimization"). The former
// `runningCount`/`projectCount` assertions were dropped here to match.

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

assert.match(
  source,
  /\{!familiar && \(\s*<div className="px-4 pb-0 pt-2">/,
  "Dossier identity row (avatar + name + role) renders only in all-familiars mode — the sidebar already names the selected familiar",
);

assert.match(
  source,
  /\{familiar && \(\s*<button[\s\S]*?onNewChat\(undefined, fallbackFamiliarId\)/,
  "With the identity row hidden, the + Chat CTA moves into the search/filter row",
);
