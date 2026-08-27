// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(source, /showProject\?: boolean;/, "callers can suppress a redundant project chip");
assert.match(
  source,
  /const showProject = props\.showProject \?\? true;/,
  "existing chat composers keep the project chip by default",
);
assert.match(
  source,
  /\{showProject \? \([\s\S]*aria-label=\{`Project:/,
  "the project trigger is omitted only when explicitly disabled",
);
assert.match(
  source,
  /\{showProject \? \([\s\S]*<ProjectPickerPopover/,
  "the project popover is omitted with its trigger",
);
assert.match(
  chat,
  /<ComposerContextChips[\s\S]*?showProject=\{false\}/,
  "Chat does not repeat shell-owned project selection in its composer or header",
);
assert.doesNotMatch(
  chat,
  /<ChatSessionContextRow[\s\S]{0,800}?onProjectChange=/,
  "the session project reads as execution context rather than a second visible selector",
);

console.log("composer-context-pill.test.ts: ok");
