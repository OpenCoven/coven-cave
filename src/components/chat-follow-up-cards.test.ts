import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-follow-up-cards.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");

assert.match(source, /role="group"/, "follow-up cards are exposed as a labelled group");
assert.match(source, /aria-label="Suggested next steps"/, "the group names its purpose");
assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?focus-ring/, "each follow-up is a native focusable button");
assert.match(source, /ph:chat-circle-dots/, "reply uses the chat icon");
assert.match(source, /ph:check-square/, "task uses the task icon");
assert.match(source, /ph:link-simple/, "Save uses the link icon");
assert.match(source, /icon:\s*"ph:list-checks"/, "Tasks navigation uses the exact list icon");
assert.doesNotMatch(source, /ph:list-checks-bold/, "Tasks navigation rejects the bold list icon");
assert.match(source, /Reply/, "reply cards visibly identify their type");
assert.match(source, /Task/, "task cards visibly identify their type");
assert.match(source, /Save/, "save-link cards visibly identify their type");
assert.match(source, /Tasks/, "open-tasks cards visibly identify their type");
assert.match(source, /Drafts a reply below/, "reply cards explain their outcome");
assert.match(source, /Opens a linked task review/, "task cards explain their outcome");
assert.match(source, /Opens link destinations/, "save-link cards explain their destination");
assert.match(source, /Opens Tasks/, "open-tasks cards explain their destination");
assert.match(source, /path\.recommended/, "recommendation comes from typed metadata");
assert.match(source, /cave-followup-card--recommended/, "recommended items receive a semantic class");
assert.doesNotMatch(source, /index === 0/, "array order does not imply recommendation");
assert.doesNotMatch(source, /recommended\?: boolean/, "recommendation is not driven by a component prop");
assert.match(
  source,
  /const accessibleName = `\$\{meta\.label\} · \$\{path\.label\}\. \$\{meta\.outcome\}\$\{/,
  "accessible names include the visible type, suggestion, and outcome",
);
assert.match(source, /Recommended\./, "recommended state is included in the accessible name");
assert.match(source, /cave-followup-card__separator/, "a visible separator sits between type and title");
assert.match(source, /Recommended/, "the top recommendation carries a visible text marker");
assert.match(source, /onActivate\(path\)/, "activation is delegated to the owning chat surface");
assert.doesNotMatch(source, /\bsend\(path\.prompt\)/, "cards never send assistant text directly");
assert.match(source, /saveAvailable\?: boolean/, "the source-owning chat can report whether Save is available");
assert.match(source, /disabled=\{unavailable\}/, "Save is natively disabled when its source has no links");
assert.match(source, /No links available to save/, "the disabled Save name explains why it is unavailable");
assert.match(styles, /border-radius: var\(--radius-control\)/, "the composer strip uses control radii");
assert.match(
  styles,
  /\.cave-followup-card--recommended \{[\s\S]*?var\(--color-success\)[\s\S]*?var\(--border-hairline\)/,
  "recommended cards use a success-derived border mix",
);
assert.match(
  styles,
  /\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
  "the composer footer renders four equal columns on desktop",
);
assert.match(
  styles,
  /@media \(max-width: 40rem\) \{[\s\S]*?\.cave-chat-followups \.cave-followup-cards__grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  "the composer footer becomes a two-column grid on narrow screens",
);
assert.doesNotMatch(
  styles,
  /\.cave-followup-card--recommended[\s\S]{0,180}?animation:/,
  "recommended cards do not animate",
);

console.log("chat-follow-up-cards.test.ts: ok");
