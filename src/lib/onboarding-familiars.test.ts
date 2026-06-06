// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildFamiliarsToml,
  normalizeFamiliarDraft,
  RESERVED_STARTER_FAMILIAR_IDS,
} from "./onboarding-familiars.ts";

const reserved = ["main", "kitty", "cody", "sage", "charm", "astra", "echo", "nova"];

assert.deepEqual(RESERVED_STARTER_FAMILIAR_IDS, reserved);

assert.equal(buildFamiliarsToml(null), "# User familiars for this Coven.\n");

const draft = normalizeFamiliarDraft({
  displayName: "Riley Research",
  role: "Research",
  description: "Finds evidence and summarizes it.",
  glyph: "ph:leaf-fill",
  harness: "codex",
  model: "openai/gpt-5",
});

assert.deepEqual(draft, {
  id: "riley-research",
  displayName: "Riley Research",
  role: "Research",
  description: "Finds evidence and summarizes it.",
  glyph: "ph:leaf-fill",
  harness: "codex",
  model: "openai/gpt-5",
});

const toml = buildFamiliarsToml(draft);
assert.match(toml, /id = "riley-research"/);
assert.match(toml, /display_name = "Riley Research"/);
assert.match(toml, /harness = "codex"/);
assert.match(toml, /model = "openai\/gpt-5"/);

for (const id of reserved) {
  assert.doesNotMatch(toml, new RegExp(`id = "${id}"`));
}

assert.throws(
  () => normalizeFamiliarDraft({ displayName: "Cody", harness: "codex", model: "openai/gpt-5" }),
  /reserved/i,
);
