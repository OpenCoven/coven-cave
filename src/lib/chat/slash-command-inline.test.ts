import assert from "node:assert/strict";
import {
  inlineSlashCommandPrompt,
  inlineSlashInvocation,
  replaceInlineSlashRange,
} from "./slash-commands.ts";

assert.deepEqual(
  inlineSlashInvocation("please /ima", 11),
  {
    start: 7,
    caret: 11,
    tokenEnd: 11,
    input: "/ima",
    commandToken: "/ima",
  },
  "a command token after prose should own the caret",
);

assert.deepEqual(
  inlineSlashInvocation("first line\nthen /model cla", 26),
  {
    start: 16,
    caret: 26,
    tokenEnd: 22,
    input: "/model cla",
    commandToken: "/model",
  },
  "argument pickers should receive the invocation on later lines",
);

assert.equal(
  inlineSlashInvocation("https://example.com/path", 12),
  null,
  "URL slashes should not open the command menu",
);

assert.deepEqual(
  replaceInlineSlashRange("please /ima after", 7, 11, "/image"),
  { text: "please /image after", caret: 13 },
  "completion should preserve text outside the active slash range",
);

assert.equal(
  inlineSlashCommandPrompt("please /he", 10, "/help"),
  "/help",
  "running an inline suggestion should use the highlighted canonical command",
);

assert.equal(
  inlineSlashCommandPrompt("please /run inspect this", 24, "/run"),
  "/run inspect this",
  "running an inline suggestion should preserve arguments without surrounding prose",
);

console.log("slash-command-inline.test.ts: ok");
