// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /familiar-panel-dossier/,
  "ChatList should render a compact agent dossier header for the side panel",
);

assert.match(
  source,
  /Runtime/,
  "ChatList should label the familiar agent source as a runtime",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{resolvedFamiliar\} size="md" \/>/,
  "ChatList dossier header should render the familiar avatar (post-FamiliarAvatar migration in 0244b6a)",
);

assert.match(
  source,
  /panelRole[\s\S]*Runtime/,
  "ChatList dossier header should keep the familiar role and runtime subtitle together",
);

// NOTE: the running/project-count "Stats" summary that used to live in the
// dossier header was deliberately removed for side-panel optimization
// (chat-list.tsx: "Stats removed for sidepanel optimization"). The former
// `runningCount`/`projectCount` assertions were dropped here to match.

assert.match(
  source,
  /import \{ EmptyState \} from "@\/components\/ui\/empty-state"/,
  "ChatList should use the shared EmptyState primitive",
);

assert.match(
  source,
  /<EmptyState[\s\S]*headline="Ready for a new thread"/,
  "ChatList empty state should render through the shared EmptyState primitive",
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

assert.match(
  source,
  /\{!familiar && \(\s*<div className="px-4 pb-0 pt-2">/,
  "Dossier identity row (avatar + name + role) renders only in all-familiars mode — the sidebar already names the selected familiar",
);

// Placement guard, not a familiar-selection one: the CTA moved OUT of the
// `{familiar && …}` branch in cave-n3jg2 — the handoff gives the surface one
// title row (serif heading · session count · one primary action), so a single
// unconditional "New session" button replaces the two conditional CTAs that
// used to live in the identity row and the filter row. The argument is named
// only to anchor the match — it was renamed fallbackFamiliarId →
// scopedFamiliarId when the silent familiars[0] default was retired.
assert.match(
  source,
  /<h1 className="chat-sessions-title[\s\S]{0,400}?onNewChat\(undefined, scopedFamiliarId\)[\s\S]{0,1200}?New session\s*\n\s*<\/button>/,
  "The surface title row carries the one New session CTA",
);
assert.doesNotMatch(
  source,
  /\{familiar && \(\s*<button[\s\S]{0,200}?onNewChat\(undefined, scopedFamiliarId\)/,
  "the old familiar-conditional duplicate CTA is gone — one surface, one primary action",
);
