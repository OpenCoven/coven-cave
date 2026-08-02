// @ts-nocheck
import assert from "node:assert/strict";
import {
  RUNTIME_MODEL_CATALOG,
  catalogForRuntime,
  defaultModelForRuntime,
  isModelInCatalog,
  modelForRuntimeSwitch,
  modelForCaveFromRuntimeEcho,
  modelForRuntimeLaunch,
  runtimeOwnsModelDefault,
  runtimeModelIdForLaunch,
  transformModelIdForRuntime,
} from "./runtime-models.ts";

// Every bundled chat runtime has a catalog entry.
for (const runtime of ["codex", "claude", "copilot", "hermes", "opencode", "openclaw"]) {
  const catalog = catalogForRuntime(runtime);
  assert.ok(catalog, `${runtime} should have a catalog entry`);
  assert.equal(catalog.runtime, runtime);
  assert.equal(typeof catalog.allowCustom, "boolean");
  assert.ok(Array.isArray(catalog.models));
}

for (const [alias, canonical] of [
  ["claude-code", "claude"],
  ["openai-codex", "codex"],
  ["github-copilot", "copilot"],
  ["copilot-cli", "copilot"],
  ["hermes-agent", "hermes"],
  ["opencode-ai", "opencode"],
]) {
  assert.deepEqual(
    catalogForRuntime(alias),
    catalogForRuntime(canonical),
    `${alias} should resolve the canonical ${canonical} model catalog`,
  );
  assert.equal(
    defaultModelForRuntime(alias),
    defaultModelForRuntime(canonical),
    `${alias} should inherit the canonical ${canonical} default model`,
  );
}

// Provider-backed runtimes expose a menu sourced from their provider.
assert.equal(catalogForRuntime("codex").provider, "openai");
assert.equal(catalogForRuntime("claude").provider, "anthropic");
assert.ok(catalogForRuntime("claude").models.length > 0, "claude should seed a menu");
assert.ok(
  catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-opus-4-8"),
  "claude catalog should seed Claude Opus 4.8",
);
assert.ok(
  !catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-opus-5"),
  "the static Claude seed must not advertise Opus 5 without a runtime capability probe",
);
assert.ok(
  catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-sonnet-5"),
  "claude catalog should seed Claude Sonnet 5",
);
assert.ok(
  catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-fable-5"),
  "claude catalog should offer Claude Fable 5 (re-enabled: Coven Code ships full Fable support)",
);
assert.equal(
  catalogForRuntime("claude").models[0].id,
  "anthropic/claude-opus-4-8",
  "Opus 4.8 must stay first so it remains the claude default",
);
assert.ok(catalogForRuntime("codex").models.length > 1, "codex should seed a multi-model menu, not just the default");
assert.deepEqual(
  catalogForRuntime("codex").models.map((model) => model.id),
  [
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.5",
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.3-codex-spark",
  ],
  "codex catalog should match the current Codex model order",
);
assert.ok(
  catalogForRuntime("codex").models.some((m) => m.id === "openai/gpt-5.4"),
  "codex catalog should seed GPT-5.4",
);
assert.ok(
  catalogForRuntime("codex").models.some((m) => m.id === "openai/gpt-5.4-mini"),
  "codex catalog should seed GPT-5.4 Mini",
);
assert.ok(
  catalogForRuntime("codex").models.some((m) => m.id === "openai/gpt-5.3-codex-spark"),
  "codex catalog should seed GPT-5.3 Codex Spark",
);
assert.ok(
  !catalogForRuntime("codex").models.some((m) => m.id.includes("gpt-5.1")),
  "the retired GPT-5.1 generation must not reappear in the codex menu",
);
assert.equal(
  catalogForRuntime("codex").models[0].id,
  "openai/gpt-5.6-sol",
  "GPT-5.6 Sol must stay first so it remains the codex default",
);

// Copilot serves multiple providers' models through one GitHub subscription.
assert.equal(catalogForRuntime("copilot").provider, "github");
assert.ok(catalogForRuntime("copilot").models.length > 1, "copilot should seed a multi-model menu");
assert.equal(
  catalogForRuntime("copilot").models[0].id,
  "github/auto",
  "Auto must stay first so Copilot's own default model selection remains the default",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/gpt-5.6-sol"),
  "copilot catalog should seed GPT-5.6 Sol",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/gpt-5.6-terra"),
  "copilot catalog should seed GPT-5.6 Terra",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/gpt-5.6-luna"),
  "copilot catalog should seed GPT-5.6 Luna",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/gpt-5.5"),
  "copilot catalog should seed GPT-5.5",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/claude-fable-5"),
  "copilot catalog should seed Claude Fable 5 (parity with the claude catalog)",
);
assert.ok(
  catalogForRuntime("copilot").models.some((m) => m.id === "github/claude-sonnet-5"),
  "copilot catalog should seed Claude Sonnet 5",
);
assert.equal(catalogForRuntime("copilot").allowCustom, true, "copilot accepts unlisted model ids");
assert.equal(defaultModelForRuntime("copilot"), "github/auto");
assert.ok(
  !catalogForRuntime("copilot").models.some((m) => m.id === "github/claude-opus-5"),
  "the static Copilot seed must not bypass account rollout or administrator policy",
);

assert.equal(
  modelForRuntimeLaunch("claude", "anthropic/claude-opus-5"),
  "anthropic/opus",
  "Cave keeps a canonical Opus 5 id while Claude Code receives its provider-portable selector",
);
assert.equal(
  modelForRuntimeLaunch("claude-code", "anthropic/claude-opus-5"),
  "anthropic/opus",
  "legacy Claude runtime aliases use the same native selector",
);
assert.equal(
  modelForRuntimeLaunch("copilot", "github/claude-opus-5"),
  "github/claude-opus-5",
  "non-Claude runtimes retain their canonical selected id",
);
assert.equal(
  modelForCaveFromRuntimeEcho(
    "claude",
    "anthropic/claude-opus-5",
    "anthropic/opus",
  ),
  "anthropic/claude-opus-5",
  "Claude Code's portable Opus alias maps back to the stable Cave id",
);
assert.equal(
  modelForCaveFromRuntimeEcho(
    "copilot",
    "github/claude-opus-5",
    "claude-opus-5",
  ),
  "github/claude-opus-5",
  "Copilot's bare native echo maps back to the stable Cave id",
);
assert.equal(
  modelForCaveFromRuntimeEcho(
    "claude",
    "anthropic/claude-opus-5",
    "claude-opus-5-20260701",
  ),
  "claude-opus-5-20260701",
  "an unexpected resolved model remains authoritative instead of being rewritten",
);

// Namespaced model id convention (`provider/model`) holds across the seed.
for (const catalog of Object.values(RUNTIME_MODEL_CATALOG)) {
  for (const model of catalog.models) {
    assert.match(model.id, /^[a-z0-9]+\/[A-Za-z0-9._-]+$/, `${model.id} should be provider/model`);
    assert.ok(model.label && typeof model.label === "string", "every option needs a label");
  }
}

// Hermes forwards authenticated Codex models through its adapter, so it has a
// concrete menu while retaining Custom for an explicitly supplied model id.
const hermes = catalogForRuntime("hermes");
assert.equal(hermes.provider, "openai");
assert.deepEqual(
  hermes.models.map((model) => model.id),
  [
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.5",
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.3-codex-spark",
    "openai/codex-auto-review",
  ],
  "Hermes should expose the authenticated Codex model dropdown",
);
assert.equal(hermes.allowCustom, true, "Hermes still accepts explicit user model ids");

// null-provider runtimes are free-text only (no menu).
const openclaw = catalogForRuntime("openclaw");
assert.equal(openclaw.provider, null);
assert.equal(openclaw.models.length, 0, "openclaw renders free-text only");
assert.equal(openclaw.allowCustom, true, "free-text must stay allowed when there is no menu");
assert.equal(defaultModelForRuntime("codex"), "openai/gpt-5.6-sol");
assert.equal(defaultModelForRuntime("hermes"), "openai/gpt-5.6-sol", "Hermes should default to the first authenticated model");
assert.equal(defaultModelForRuntime("openclaw"), "openai/gpt-5.6-sol", "OpenClaw should inherit a real global default, not openclaw-local");
assert.equal(runtimeOwnsModelDefault("codex"), false);
assert.equal(runtimeOwnsModelDefault("hermes"), true);
assert.equal(runtimeOwnsModelDefault("grok"), true);
assert.equal(runtimeOwnsModelDefault("opencode"), true);
assert.equal(runtimeOwnsModelDefault("opencode-ai"), true, "OpenCode package aliases preserve runtime-owned defaults");
assert.equal(runtimeOwnsModelDefault("openclaw"), true);
assert.equal(modelForRuntimeSwitch("codex"), "", "runtime switches preserve default intent instead of selecting a catalog seed");
assert.equal(modelForRuntimeSwitch("hermes"), "");
assert.equal(modelForRuntimeSwitch("hermes", "nous/hermes-4"), "nous/hermes-4");

// Unknown runtimes have no catalog.
assert.equal(catalogForRuntime("nonexistent"), null);

// OpenCode is a runtime-managed catalog: the browser replaces this empty seed
// with the authenticated `opencode models` inventory.
{
  const opencode = catalogForRuntime("opencode");
  assert.ok(opencode, "OpenCode has a catalog entry for runtime discovery");
  assert.equal(opencode.provider, null);
  assert.equal(opencode.models.length, 0, "OpenCode must not ship a stale static model list");
  assert.equal(opencode.allowCustom, true);
  assert.equal(defaultModelForRuntime("opencode"), "", "OpenCode defers its default to the authenticated CLI");
}

// isModelInCatalog only matches curated ids; allowCustom covers the rest.
assert.equal(isModelInCatalog("claude", "anthropic/claude-opus-4-7"), true);
assert.equal(isModelInCatalog("claude", "anthropic/not-listed-yet"), false);
assert.equal(isModelInCatalog("hermes", "openai/gpt-5.6-terra"), true);
assert.equal(isModelInCatalog("hermes", "nous/hermes-4"), false);
assert.equal(isModelInCatalog("openclaw", "anything"), false);
assert.equal(isModelInCatalog("nonexistent", "openai/gpt-5.5"), false);

// Cave's supported runtime set follows the registry contract. Strip removes
// only the first non-empty provider segment; preserve forwards the stored
// provider-qualified id unchanged.
for (const runtime of ["codex", "claude", "copilot", "grok"]) {
  assert.equal(
    transformModelIdForRuntime(runtime, "provider/team/model"),
    "team/model",
    `${runtime} strips exactly one provider segment`,
  );
}
for (const runtime of ["hermes", "opencode"]) {
  assert.equal(
    transformModelIdForRuntime(runtime, "provider/team/model"),
    "provider/team/model",
    `${runtime} preserves the provider-qualified model id`,
  );
}

for (const unchanged of ["bare-model", "/model", "provider/", "openai//gpt"]) {
  assert.equal(
    transformModelIdForRuntime("copilot", unchanged),
    unchanged,
    `${unchanged} has no two non-empty segments to strip`,
  );
}

// Metadata, not runtime-name conditionals, controls future runtimes. Missing
// and unknown transform values retain the Rust adapter's strip-provider
// default for compatibility with older generated registries.
const futureRuntimes = [
  { id: "future-preserve", modelIdTransform: "preserve" },
  { id: "future-default" },
  { id: "future-unknown", modelIdTransform: "later-transform" },
];
assert.equal(
  transformModelIdForRuntime("future-preserve", "provider/team/model", futureRuntimes),
  "provider/team/model",
);
assert.equal(
  transformModelIdForRuntime("future-default", "provider/team/model", futureRuntimes),
  "team/model",
);
assert.equal(
  transformModelIdForRuntime("future-unknown", "provider/team/model", futureRuntimes),
  "team/model",
);
assert.equal(
  transformModelIdForRuntime("missing-runtime", "provider/team/model", futureRuntimes),
  "team/model",
);

// Revalidate the transformed argv value so stripping cannot expose a CLI flag;
// nested ids remain valid after their first provider segment is removed.
assert.equal(runtimeModelIdForLaunch("copilot", "provider/team/model"), "team/model");
assert.equal(
  runtimeModelIdForLaunch("opencode", "openrouter/~anthropic/claude-opus-latest"),
  "openrouter/~anthropic/claude-opus-latest",
  "OpenCode launch validation should preserve authenticated tilde-prefixed provider aliases",
);
assert.equal(runtimeModelIdForLaunch("copilot", "provider/--allow-all-tools"), null);
assert.equal(runtimeModelIdForLaunch("copilot", "provider/../escape"), null);
assert.equal(runtimeModelIdForLaunch("copilot", null), null);

console.log("runtime-models.test.ts: ok");
