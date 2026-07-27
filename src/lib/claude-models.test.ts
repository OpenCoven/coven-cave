import assert from "node:assert/strict";
import {
  CLAUDE_OPUS_5_CAVE_ID,
  CLAUDE_OPUS_5_NATIVE_MODEL,
  claudeOpus5Available,
  parseClaudeCodeVersion,
  withClaudeOpus5,
} from "./claude-models.ts";

assert.equal(CLAUDE_OPUS_5_CAVE_ID, "anthropic/claude-opus-5");
assert.equal(CLAUDE_OPUS_5_NATIVE_MODEL, "anthropic/opus");

assert.equal(parseClaudeCodeVersion("2.1.219 (Claude Code)\n"), "2.1.219");
assert.equal(parseClaudeCodeVersion("Claude Code v2.2.0"), "2.2.0");
assert.equal(parseClaudeCodeVersion("2.1.219-beta.1 (Claude Code)"), null);
assert.equal(parseClaudeCodeVersion("warning\n2.1.219 (Claude Code)"), null);
assert.equal(parseClaudeCodeVersion("2.1.219.1"), null);

const available = (
  version: string,
  env: Record<string, string | undefined> = {},
) =>
  claudeOpus5Available({ versionOutput: version, env });

assert.equal(available("2.1.218 (Claude Code)"), false, "the release before Opus 5 fails closed");
assert.equal(available("2.1.219 (Claude Code)"), true, "the Opus 5 Claude Code release is accepted");
assert.equal(available("2.2.0 (Claude Code)"), true, "later compatible releases are accepted");
assert.equal(available("invalid"), false, "an unverified version never advertises Opus 5");

assert.equal(
  available("2.1.219 (Claude Code)", { CLAUDE_CODE_USE_BEDROCK: "1" }),
  true,
  "Claude Code 2.1.219 knows the published Bedrock Opus 5 mapping",
);
assert.equal(
  available("2.1.219 (Claude Code)", { CLAUDE_CODE_USE_VERTEX: "true" }),
  true,
  "Claude Code 2.1.219 knows the published Vertex Opus 5 mapping",
);
assert.equal(
  available("2.1.219 (Claude Code)", { CLAUDE_CODE_USE_FOUNDRY: "1" }),
  false,
  "Foundry deployment names are not guessed",
);
assert.equal(
  available("2.1.219 (Claude Code)", {
    CLAUDE_CODE_USE_FOUNDRY: "1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "prod-claude-opus-5",
  }),
  true,
  "an explicit Foundry Opus 5 deployment enables the canonical choice",
);
assert.equal(
  available("2.1.219 (Claude Code)", {
    CLAUDE_CODE_USE_FOUNDRY: "1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "prod-opus",
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "Claude Opus 5",
  }),
  true,
  "a user-named Foundry deployment can declare its model family",
);
assert.equal(
  available("2.1.219 (Claude Code)", { ANTHROPIC_BASE_URL: "https://gateway.example.test" }),
  false,
  "a custom gateway must identify the model it maps",
);
assert.equal(
  available("2.1.219 (Claude Code)", {
    ANTHROPIC_BASE_URL: "https://gateway.example.test",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic.claude-opus-5[1m]",
  }),
  true,
  "an explicit gateway mapping accepts provider-specific Opus 5 ids and suffixes",
);
assert.equal(
  available("2.1.219 (Claude Code)", {
    ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
  }),
  false,
  "an explicit older Opus pin overrides the release default",
);
assert.equal(
  available("2.1.219 (Claude Code)", {
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
  }),
  false,
  "ambiguous provider modes fail closed",
);

const seed = [
  { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
];
assert.deepEqual(
  withClaudeOpus5(seed, { versionOutput: "2.1.219 (Claude Code)", env: {} }),
  [
    { id: CLAUDE_OPUS_5_CAVE_ID, label: "Claude Opus 5" },
    ...seed,
  ],
  "a verified runtime puts Opus 5 first without mutating the seed",
);
assert.deepEqual(
  withClaudeOpus5(seed, { versionOutput: "2.1.218 (Claude Code)", env: {} }),
  seed,
  "an unsupported runtime receives the unchanged fallback seed",
);
assert.deepEqual(
  withClaudeOpus5(
    [{ id: CLAUDE_OPUS_5_CAVE_ID, label: "Already present" }, ...seed],
    { versionOutput: "2.1.219 (Claude Code)", env: {} },
  ).filter((model) => model.id === CLAUDE_OPUS_5_CAVE_ID),
  [{ id: CLAUDE_OPUS_5_CAVE_ID, label: "Claude Opus 5" }],
  "dynamic augmentation replaces a duplicate with the canonical label",
);
assert.deepEqual(seed, [
  { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
]);

console.log("claude-models.test.ts: ok");
