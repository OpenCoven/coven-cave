import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-follow-up-cards.tsx", import.meta.url), "utf8");
const transcriptStyles = await readFile(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");

assert.match(source, /role="group"/, "follow-up cards are exposed as a labelled group");
assert.match(source, /aria-label="Suggested next steps"/, "the group names its purpose");
assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?focus-ring/, "each follow-up is a native focusable button");
assert.match(source, /icon: "ph:chat-circle-dots"[\s\S]*?label: "Reply"[\s\S]*?outcome: "Drafts a reply below"/, "reply cards resolve exact reply metadata");
assert.match(source, /icon: "ph:check-square"[\s\S]*?label: "Task"[\s\S]*?outcome: "Opens a linked task review"/, "task cards resolve exact task metadata");
assert.match(source, /"save-link": \{[\s\S]*?icon: "ph:link-simple"[\s\S]*?label: "Save"[\s\S]*?outcome: "Opens link destinations"/, "save-link actions resolve exact save metadata");
assert.match(source, /"open-tasks": \{[\s\S]*?icon: "ph:list-checks"[\s\S]*?label: "Tasks"[\s\S]*?outcome: "Opens Tasks"/, "open-tasks actions resolve exact tasks metadata");
assert.doesNotMatch(source, /ph:list-checks-bold/, "the tasks icon should not fall back to the bold variant");
assert.match(source, /Reply/, "reply cards visibly identify their type");
assert.match(source, /Task/, "task cards visibly identify their type");
assert.match(source, /Save/, "save-link actions visibly identify their type");
assert.match(source, /Tasks/, "open-tasks actions visibly identify their type");
assert.match(source, /cave-followup-card__separator/, "follow-up cards keep a visible separator between type and title");
assert.match(source, /Drafts a reply below/, "reply cards explain their outcome");
assert.match(source, /Opens a linked task review/, "task cards explain their outcome");
assert.match(source, /Opens link destinations/, "save-link actions explain their destination");
assert.match(source, /Opens Tasks/, "open-tasks actions explain their destination");
assert.match(source, /path\.recommended/, "recommendation comes from the typed path metadata");
assert.match(source, /cave-followup-card--recommended/, "recommended paths apply the recommended card modifier");
assert.doesNotMatch(source, /index === 0/, "presentation never infers recommendation from first position");
assert.doesNotMatch(source, /recommended &&/, "presentation never mixes a component prop into recommendation state");
assert.match(source, /Recommended/, "recommended cards keep accessible recommendation text");
assert.match(source, /Not recommended/, "accessible names include the non-recommended state too");
assert.match(source, /meta\.label[\s\S]*path\.label[\s\S]*meta\.outcome[\s\S]*path\.recommended/, "accessible names include type, title, outcome, and recommendation state");
assert.match(source, /onActivate\(path\)/, "activation is delegated to the owning chat surface");
assert.doesNotMatch(source, /\bsend\(path\.prompt\)/, "cards never send assistant text directly");
assert.match(
  transcriptStyles,
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
  "composer follow-ups use four equal desktop columns",
);
assert.match(
  transcriptStyles,
  /\.cave-chat-followups \.cave-followup-card \{[\s\S]*?display: flex;[\s\S]*?min-width: 0;[\s\S]*?gap: var\(--space-1\);[\s\S]*?border-radius: var\(--radius-control\);[\s\S]*?padding: var\(--space-1\) var\(--space-2\);/,
  "composer cards use the compact radius-control pill row",
);
assert.match(
  transcriptStyles,
  /\.cave-chat-followups \.cave-followup-card__type \{[\s\S]*?flex: 0 0 auto;/,
  "composer card types stay nonshrinking",
);
assert.match(
  transcriptStyles,
  /\.cave-chat-followups \.cave-followup-card__recommended \{[\s\S]*?position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\);/,
  "composer cards keep recommendation text visually hidden instead of removing it from accessibility",
);
assert.match(
  transcriptStyles,
  /\.cave-followup-card--recommended \{[\s\S]*?border-color: color-mix\(in oklch, var\(--color-success\) 38%, var\(--border-hairline\)\);/,
  "recommended cards derive their border from the success token",
);
assert.doesNotMatch(
  transcriptStyles,
  /\.cave-followup-card--recommended \{[^}]*?(?:animation|transition):/,
  "recommended cards do not animate their recommendation treatment",
);
assert.match(
  transcriptStyles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.cave-chat-followups \.cave-followup-card \{[\s\S]*?min-height: var\(--touch-target\);/,
  "narrow composer follow-ups collapse to two equal columns with touch targets",
);

console.log("chat-follow-up-cards.test.ts: ok");
