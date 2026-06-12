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
  runtime: undefined,
});

const toml = buildFamiliarsToml(draft);
assert.match(toml, /id = "riley-research"/);
assert.match(toml, /display_name = "Riley Research"/);
assert.match(toml, /harness = "openclaw"/);
assert.match(toml, /model = "riley"/);
assert.match(toml, /openclaw_agent = "riley"/);

assert.equal(
  normalizeFamiliarDraft({ displayName: "Cody", openclawAgentId: "cody" }).id,
  "cody",
);

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
  runtime: undefined,
});

assert.equal(normalizeFamiliarDraft({ displayName: "Solo" }).harness, "codex");

const hermesDraft = normalizeFamiliarDraft({
  displayName: "Hermes Local",
  role: "Planning",
  harness: "hermes",
  model: "hermes-local",
});

assert.deepEqual(hermesDraft, {
  id: "hermes-local",
  displayName: "Hermes Local",
  role: "Planning",
  description: "",
  glyph: "ph:sparkle-fill",
  harness: "hermes",
  model: "hermes-local",
  openclawAgentId: undefined,
  runtime: undefined,
});

assert.match(buildFamiliarsToml(hermesDraft), /harness = "hermes"/);


assert.throws(
  () =>
    normalizeFamiliarDraft({
      displayName: "Evil",
      harness: "attacker-adapter",
      model: "evil-local",
    }),
  /Unsupported harness: attacker-adapter\./,
);

// ── SSH runtime on the draft ─────────────────────────────────────────────────

const sshDraft = normalizeFamiliarDraft({
  displayName: "Remote Codex",
  harness: "codex",
  model: "codex-remote",
  runtime: { kind: "ssh", host: "build-box", cwd: "/srv/work", command: "" },
});
assert.deepEqual(sshDraft.runtime, {
  kind: "ssh",
  host: "build-box",
  cwd: "/srv/work",
  command: "coven",
});

// familiars.toml stays runtime-free — the binding (cave-config.json) owns it.
assert.doesNotMatch(buildFamiliarsToml(sshDraft), /runtime|ssh|build-box/);

// Partial SSH input fails loudly instead of silently creating a local familiar.
assert.throws(
  () =>
    normalizeFamiliarDraft({
      displayName: "Half Remote",
      runtime: { kind: "ssh", host: "build-box", cwd: "" },
    }),
  /SSH runtime needs a host/,
);

// Hosts that fail familiar-runtime's pattern are rejected, not normalized away.
assert.throws(
  () =>
    normalizeFamiliarDraft({
      displayName: "Bad Host",
      runtime: { kind: "ssh", host: "host name!", cwd: "/srv" },
    }),
  /SSH runtime needs a host/,
);

// Non-ssh runtime input is ignored entirely.
assert.equal(
  normalizeFamiliarDraft({
    displayName: "Local",
    runtime: { kind: "local" },
  }).runtime,
  undefined,
);

// ReDoS guard: slugify must not hang on a long string of dashes (polynomial-redos fix).
// This would time out in <1s if the old /^-+|-+$/g alternation were used on a 100k-dash string.
{
  const manyDashes = "-".repeat(100_000);
  const start = Date.now();
  normalizeFamiliarDraft({ displayName: manyDashes + "x" });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `slugify ReDoS guard: took ${elapsed}ms on long dash string (expected <500ms)`);
}

console.log("onboarding-familiars ssh runtime: ok");
