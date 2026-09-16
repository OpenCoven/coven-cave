// @ts-nocheck
import assert from "node:assert/strict";
import {
  applyChatPromptEnhancement,
  prepareChatPromptEnhancement,
} from "./chat-prompt-enhance.ts";
import { buildPromptEnhancement } from "./prompt-enhancer.ts";
import { canonicalize, splitSlashCommandPrompt } from "./slash-commands.ts";

function enhanceLocally(input: string, hasProject = false) {
  const prepared = prepareChatPromptEnhancement(input, hasProject);
  const result = buildPromptEnhancement({
    draft: prepared.draft,
    mode: prepared.mode,
  });
  assert.equal(result.ok, true);
  return {
    prepared,
    output: applyChatPromptEnhancement(prepared, result.enhanced),
  };
}

{
  const { prepared, output } = enhanceLocally("/research compare local LLM runtimes", true);
  const submitted = splitSlashCommandPrompt(output);

  assert.equal(prepared.mode, "research", "research commands override project-backed code mode");
  assert.equal(prepared.draft, "compare local LLM runtimes", "only the research brief is enhanced");
  assert.equal(submitted.token, "/research", "the enhanced composer value remains a research command");
  assert.equal(canonicalize(submitted.token), "/research");
  assert.match(submitted.args, /Primary questions:/, "research-specific prompt structure reaches the command");
}

{
  const { prepared, output } = enhanceLocally("/img wizard tower at sunset");
  const submitted = splitSlashCommandPrompt(output);

  assert.equal(prepared.mode, "image", "image aliases select image enhancement mode");
  assert.equal(prepared.commandPrefix, "/img ", "the user's exact alias is retained");
  assert.equal(submitted.token, "/img", "the enhanced composer value remains an image command");
  assert.equal(canonicalize(submitted.token), "/image");
  assert.match(submitted.args, /Composition:/, "image-specific prompt structure reaches the command");
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
