import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-follow-up-cards.tsx", import.meta.url), "utf8");

assert.match(source, /role="group"/, "follow-up cards are exposed as a labelled group");
assert.match(source, /aria-label="Suggested next steps"/, "the group names its purpose");
assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?focus-ring/, "each follow-up is a native focusable button");
assert.match(source, /ph:chat-circle-dots/, "reply cards use the chat icon");
assert.match(source, /ph:check-square/, "task cards use the task icon");
assert.match(source, /ph:list-checks"/, "action cards use the exact tasks icon");
assert.doesNotMatch(source, /ph:list-checks-bold/, "the tasks icon should not fall back to the bold variant");
assert.match(source, /Reply/, "reply cards visibly identify their type");
assert.match(source, /Task/, "task cards visibly identify their type");
assert.match(source, /Action/, "action cards visibly identify their type");
assert.match(source, /cave-followup-card__separator/, "follow-up cards keep a visible separator between type and title");
assert.match(source, /Drafts a reply below/, "reply cards explain their outcome");
assert.match(source, /Opens a linked task review/, "task cards explain their outcome");
assert.match(source, /Opens Tasks/, "action cards explain their destination");
assert.match(source, /Recommended/, "the top recommendation carries a visible text marker");
assert.match(source, /onActivate\(path\)/, "activation is delegated to the owning chat surface");
assert.doesNotMatch(source, /\bsend\(path\.prompt\)/, "cards never send assistant text directly");

console.log("chat-follow-up-cards.test.ts: ok");
