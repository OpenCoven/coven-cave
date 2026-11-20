// @ts-nocheck
import assert from "node:assert/strict";
import {
  applyChatPromptEnhancement,
  prepareChatPromptEnhancement,
} from "./chat-prompt-enhance.ts";
import { canonicalize, splitSlashCommandPrompt } from "./slash-commands.ts";

// The familiar rewrites only the prepared brief; applying its rewrite must
// reattach the user's exact command so the enhanced value still dispatches.
function applyRewrite(input: string, rewrite: (brief: string) => string, hasProject = false) {
  const prepared = prepareChatPromptEnhancement(input, hasProject);
  const enhanced = rewrite(prepared.draft);
  return {
    prepared,
    enhanced,
    output: applyChatPromptEnhancement(prepared, enhanced),
  };
}

{
  const { prepared, enhanced, output } = applyRewrite(
    "/research compare local LLM runtimes",
    (brief) => `Compare ${brief.replace(/^compare /, "")} on setup effort and offline support.`,
    true,
  );
  const submitted = splitSlashCommandPrompt(output);

  assert.equal(prepared.mode, "research", "research commands override project-backed code mode");
  assert.equal(prepared.draft, "compare local LLM runtimes", "only the research brief is enhanced");
  assert.equal(submitted.token, "/research", "the enhanced composer value remains a research command");
  assert.equal(canonicalize(submitted.token), "/research");
  assert.equal(submitted.args, enhanced, "the familiar's rewrite reaches the command unchanged");
}

{
  const { prepared, enhanced, output } = applyRewrite(
    "/img wizard tower at sunset",
    (brief) => `A ${brief}, seen from below against a warm sky.`,
  );
  const submitted = splitSlashCommandPrompt(output);

  assert.equal(prepared.mode, "image", "image aliases select image enhancement mode");
  assert.equal(prepared.commandPrefix, "/img ", "the user's exact alias is retained");
  assert.equal(submitted.token, "/img", "the enhanced composer value remains an image command");
  assert.equal(canonicalize(submitted.token), "/image");
  assert.equal(submitted.args, enhanced, "the familiar's rewrite reaches the command unchanged");
}

assert.deepEqual(
  prepareChatPromptEnhancement("/research", false),
  { draft: "", commandPrefix: "/research ", mode: "research" },
  "a bare prompt command has no enhancable argument",
);
assert.deepEqual(
  prepareChatPromptEnhancement("fix the login regression", true),
  { draft: "fix the login regression", commandPrefix: "", mode: "code" },
  "ordinary project chat keeps code enhancement behavior",
);
assert.deepEqual(
  prepareChatPromptEnhancement("explain Docker networking", false),
  { draft: "explain Docker networking", commandPrefix: "", mode: "chat" },
  "ordinary chat keeps general enhancement behavior",
);
assert.deepEqual(
  prepareChatPromptEnhancement("/save https://example.com", false),
  { draft: "/save https://example.com", commandPrefix: "", mode: "chat" },
  "non-prompt slash commands retain their existing enhancement behavior",
);

console.log("chat-prompt-enhance.test.ts: ok");
