// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildFamiliarsToml,
  normalizeFamiliarDraft,
} from "./onboarding-familiars.ts";

assert.equal(buildFamiliarsToml(null), "# User familiars for this Coven.\n");

const draft = normalizeFamiliarDraft({
  displayName: "Riley Research",
  role: "Research",
  description: "Finds evidence and summarizes it.",
  glyph: "ph:leaf-fill",
  openclawAgentId: "riley",
});

assert.deepEqual(draft, {
  id: "riley-research",
  displayName: "Riley Research",
  role: "Research",
  description: "Finds evidence and summarizes it.",
  glyph: "ph:leaf-fill",
  harness: "openclaw",
  model: "riley",
  openclawAgentId: "riley",
});

const toml = buildFamiliarsToml(draft);
assert.match(toml, /id = "riley-research"/);
assert.match(toml, /display_name = "Riley Research"/);
assert.match(toml, /harness = "openclaw"/);
assert.match(toml, /model = "riley"/);
assert.match(toml, /openclaw_agent = "riley"/);

assert.equal(normalizeFamiliarDraft({ displayName: "Cody", openclawAgentId: "cody" }).id, "cody");

const localDraft = normalizeFamiliarDraft({
  displayName: "Codex Local",
  role: "Code",
  harness: "codex",
  model: "local-codex",
});

assert.deepEqual(localDraft, {
  id: "codex-local",
  displayName: "Codex Local",
  role: "Code",
  description: "",
  glyph: "ph:sparkle-fill",
  harness: "codex",
  model: "local-codex",
  openclawAgentId: undefined,
});

assert.equal(normalizeFamiliarDraft({ displayName: "Solo" }).harness, "codex");
