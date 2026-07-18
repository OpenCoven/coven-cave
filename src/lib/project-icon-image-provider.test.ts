import assert from "node:assert/strict";
import {
  ICON_IMAGE_MODELS,
  ICON_IMAGE_VAULT_KEYS,
  preferredIconImageProvider,
  resolveIconImageProvider,
} from "./project-icon-image-provider.ts";

// Namespaced model ids route to their image-capable provider.
assert.equal(preferredIconImageProvider("openai/gpt-5.5"), "openai");
assert.equal(preferredIconImageProvider("openai/gpt-5.3-codex-spark"), "openai");
assert.equal(preferredIconImageProvider("github/gemini-3.1-pro"), "gemini");
assert.equal(preferredIconImageProvider("google/imagen-3"), "gemini");

// Providers without an image API prefer the OpenAI workhorse.
assert.equal(preferredIconImageProvider("anthropic/claude-sonnet-5"), "openai");
assert.equal(preferredIconImageProvider("github/auto"), "openai");
assert.equal(preferredIconImageProvider("hermes-local"), "openai");
assert.equal(preferredIconImageProvider(""), "openai");
assert.equal(preferredIconImageProvider(null), "openai");

// Each provider has a vault key and an image model.
assert.equal(ICON_IMAGE_VAULT_KEYS.openai, "OPENAI_API_KEY");
assert.equal(ICON_IMAGE_VAULT_KEYS.gemini, "GOOGLE_API_KEY");
assert.ok(ICON_IMAGE_MODELS.openai);
assert.ok(ICON_IMAGE_MODELS.gemini);

const keys = (available: Record<string, string>) => (key: string) => available[key];

// The preferred provider wins when its key resolves.
{
  const r = resolveIconImageProvider("github/gemini-3.1-pro", keys({ GOOGLE_API_KEY: "g" }));
  assert.ok(r.ok);
  assert.equal(r.provider, "gemini");
  assert.equal(r.model, ICON_IMAGE_MODELS.gemini);
  assert.equal(r.apiKey, "g");
}

// Fallback: a Gemini-connected Cave without GOOGLE_API_KEY still generates
// through OpenAI, and vice versa — distinct icons beat provider purity.
{
  const r = resolveIconImageProvider("github/gemini-3.1-pro", keys({ OPENAI_API_KEY: "o" }));
  assert.ok(r.ok);
  assert.equal(r.provider, "openai");
}
{
  const r = resolveIconImageProvider("openai/gpt-5.5", keys({ GOOGLE_API_KEY: "g" }));
  assert.ok(r.ok);
  assert.equal(r.provider, "gemini");
}

// Anthropic-connected model + only a Google key → Gemini fallback works too.
{
  const r = resolveIconImageProvider("anthropic/claude-sonnet-5", keys({ GOOGLE_API_KEY: "g" }));
  assert.ok(r.ok);
  assert.equal(r.provider, "gemini");
}

// No image-capable key: report the preferred provider's key so the hint names
// the most natural key to set.
{
  const r = resolveIconImageProvider("openai/gpt-5.5", keys({}));
  assert.ok(!r.ok);
  assert.equal(r.missingKey, "OPENAI_API_KEY");
}
{
  const r = resolveIconImageProvider("github/gemini-3.1-pro", keys({}));
  assert.ok(!r.ok);
  assert.equal(r.missingKey, "GOOGLE_API_KEY");
}

console.log("project-icon-image-provider.test.ts: ok");
