import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = [
  "../styles/cave-composer.css",
  "../styles/cave-chat.css",
  "../styles/cave-chat/activity.css",
  "../styles/cave-chat/transcript.css",
]
  .map((sheet) => readFileSync(new URL(sheet, import.meta.url), "utf8"))
  .join("\n");

assert.match(source, /<ComposerActionsMenu/, "the grouped composer actions menu should be used");
assert.match(
  css,
  /\.composer-options__choices\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  "response choices should wrap inside the grouped panel",
);
assert.doesNotMatch(source, /<ComposerPlusMenu/, "the plus menu should not own the composer footer");
assert.doesNotMatch(source, /<ComposerContextPill/, "the context pill should not own the composer footer");

console.log("composer-density.test.ts: ok");
