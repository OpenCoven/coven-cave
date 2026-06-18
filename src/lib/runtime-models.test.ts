// @ts-nocheck
import assert from "node:assert/strict";
import {
  RUNTIME_MODEL_CATALOG,
  catalogForRuntime,
  defaultModelForRuntime,
  isModelInCatalog,
} from "./runtime-models.ts";

// Every bundled chat runtime has a catalog entry.
for (const runtime of ["codex", "claude", "hermes", "openclaw"]) {
  const catalog = catalogForRuntime(runtime);
  assert.ok(catalog, `${runtime} should have a catalog entry`);
  assert.equal(catalog.runtime, runtime);
  assert.equal(typeof catalog.allowCustom, "boolean");
  assert.ok(Array.isArray(catalog.models));
}

// Provider-backed runtimes expose a menu sourced from their provider.
assert.equal(catalogForRuntime("codex").provider, "openai");
assert.equal(catalogForRuntime("claude").provider, "anthropic");
assert.equal(catalogForRuntime("hermes").provider, "nous");
assert.ok(catalogForRuntime("claude").models.length > 0, "claude should seed a menu");
assert.ok(
  catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-opus-4-8"),
  "claude catalog should seed Claude Opus 4.8",
);
assert.ok(
  catalogForRuntime("claude").models.some((m) => m.id === "anthropic/claude-fable-5"),
  "claude catalog should still offer Claude Fable 5 (both Fable 5 and Opus 4.8 are current)",
);

// Namespaced model id convention (`provider/model`) holds across the seed.
for (const catalog of Object.values(RUNTIME_MODEL_CATALOG)) {
  for (const model of catalog.models) {
    assert.match(model.id, /^[a-z0-9]+\/[A-Za-z0-9._-]+$/, `${model.id} should be provider/model`);
    assert.ok(model.label && typeof model.label === "string", "every option needs a label");
  }
}

// null-provider runtimes are free-text only (no menu).
const openclaw = catalogForRuntime("openclaw");
assert.equal(openclaw.provider, null);
assert.equal(openclaw.models.length, 0, "openclaw renders free-text only");
assert.equal(openclaw.allowCustom, true, "free-text must stay allowed when there is no menu");
assert.equal(defaultModelForRuntime("codex"), "openai/gpt-5.5");
assert.equal(defaultModelForRuntime("hermes"), "nous/hermes-4");
assert.equal(defaultModelForRuntime("openclaw"), "openai/gpt-5.5", "OpenClaw should inherit a real global default, not openclaw-local");

// Unknown runtimes have no catalog.
assert.equal(catalogForRuntime("nonexistent"), null);

// isModelInCatalog only matches curated ids; allowCustom covers the rest.
assert.equal(isModelInCatalog("claude", "anthropic/claude-opus-4-7"), true);
assert.equal(isModelInCatalog("claude", "anthropic/not-listed-yet"), false);
assert.equal(isModelInCatalog("openclaw", "anything"), false);
assert.equal(isModelInCatalog("nonexistent", "openai/gpt-5.5"), false);

console.log("runtime-models.test.ts: ok");
