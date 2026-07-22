import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_IMAGE_GEN_MODELS,
  IMAGE_GEN_MODEL_OPTIONS,
  IMAGE_GEN_VAULT_KEYS,
  imageGenModelById,
  imageGenModelsForProvider,
  imageGenQualitiesForModel,
  imageGenSizesForModel,
  preferredImageGenProvider,
  resolveImageGeneration,
} from "./image-generation.ts";

const keys = (present: Record<string, string>) => (vaultKey: string) => present[vaultKey];

test("catalog: every provider default is a listed model of that provider", () => {
  for (const [provider, modelId] of Object.entries(DEFAULT_IMAGE_GEN_MODELS)) {
    const model = imageGenModelById(modelId);
    assert.ok(model, `default model ${modelId} is in the catalog`);
    assert.equal(model.provider, provider);
    assert.ok(model.sizes.length > 0, "every model offers at least one size");
  }
});

test("catalog: model ids are unique and provider filters work", () => {
  const ids = IMAGE_GEN_MODEL_OPTIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate model ids");
  for (const model of imageGenModelsForProvider("openai")) assert.equal(model.provider, "openai");
  for (const model of imageGenModelsForProvider("gemini")) assert.equal(model.provider, "gemini");
});

test("preferredImageGenProvider follows the connected model namespace", () => {
  assert.equal(preferredImageGenProvider("openai/gpt-5.5"), "openai");
  assert.equal(preferredImageGenProvider("gpt-5-codex"), "openai");
  assert.equal(preferredImageGenProvider("google/gemini-3.1-pro"), "gemini");
  assert.equal(preferredImageGenProvider("github/gemini-3.1-pro"), "gemini");
  assert.equal(preferredImageGenProvider("anthropic/claude-sonnet-5"), "openai");
  assert.equal(preferredImageGenProvider(null), "openai");
});

test("resolve: inherit mode follows the chat model and falls back across providers", () => {
  const openaiOnly = keys({ OPENAI_API_KEY: "sk-openai" });
  // Gemini-connected chat, but only an OpenAI key in the vault → OpenAI renders.
  const crossed = resolveImageGeneration({}, "google/gemini-3.1-pro", openaiOnly);
  assert.ok(crossed.ok);
  assert.equal(crossed.provider, "openai");
  assert.equal(crossed.model, "gpt-image-1");
  assert.equal(crossed.apiKey, "sk-openai");

  const geminiFirst = resolveImageGeneration(
    {},
    "google/gemini-3.1-pro",
    keys({ OPENAI_API_KEY: "sk-openai", GOOGLE_API_KEY: "g-key" }),
  );
  assert.ok(geminiFirst.ok);
  assert.equal(geminiFirst.provider, "gemini");
  assert.equal(geminiFirst.model, "imagen-3.0-generate-002");
  assert.equal(geminiFirst.size, "1:1", "imagen sizes are aspect ratios, default 1:1");
});

test("resolve: explicit provider pin does NOT cross-fall-back", () => {
  const result = resolveImageGeneration(
    { imageProvider: "gemini" },
    "openai/gpt-5.5",
    keys({ OPENAI_API_KEY: "sk-openai" }),
  );
  assert.deepEqual(result, { ok: false, reason: "missing_key", missingKey: "GOOGLE_API_KEY" });
});

test("resolve: 'off' disables generation for the familiar", () => {
  const result = resolveImageGeneration(
    { imageProvider: "off" },
    "openai/gpt-5.5",
    keys({ OPENAI_API_KEY: "sk-openai" }),
  );
  assert.deepEqual(result, { ok: false, reason: "disabled" });
});

test("resolve: familiar model/size/quality settings apply and validate", () => {
  const result = resolveImageGeneration(
    { imageModel: "dall-e-3", imageSize: "1792x1024", imageQuality: "hd" },
    "anthropic/claude-sonnet-5",
    keys({ OPENAI_API_KEY: "sk-openai" }),
  );
  assert.ok(result.ok);
  assert.equal(result.model, "dall-e-3");
  assert.equal(result.size, "1792x1024");
  assert.equal(result.quality, "hd");

  // A size that belongs to another model is rejected → model default.
  const badSize = resolveImageGeneration(
    { imageModel: "dall-e-3", imageSize: "1536x1024" },
    null,
    keys({ OPENAI_API_KEY: "sk-openai" }),
  );
  assert.ok(badSize.ok);
  assert.equal(badSize.size, "1024x1024");
});

test("resolve: request overrides beat familiar settings", () => {
  const result = resolveImageGeneration(
    { imageModel: "gpt-image-1", imageQuality: "low" },
    "openai/gpt-5.5",
    keys({ OPENAI_API_KEY: "sk-openai" }),
    { model: "dall-e-3", quality: "hd" },
  );
  assert.ok(result.ok);
  assert.equal(result.model, "dall-e-3");
  assert.equal(result.quality, "hd");
});

test("resolve: a catalog model implies its provider even when the chat model disagrees", () => {
  const result = resolveImageGeneration(
    { imageModel: "imagen-3.0-fast-generate-001" },
    "openai/gpt-5.5",
    keys({ GOOGLE_API_KEY: "g-key", OPENAI_API_KEY: "sk-openai" }),
  );
  assert.ok(result.ok);
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "imagen-3.0-fast-generate-001");
});

test("resolve: custom unlisted model id is trusted on the preferred provider only", () => {
  const custom = resolveImageGeneration(
    { imageModel: "gpt-image-1-mini" },
    "openai/gpt-5.5",
    keys({ OPENAI_API_KEY: "sk-openai" }),
  );
  assert.ok(custom.ok);
  assert.equal(custom.model, "gpt-image-1-mini");

  // Cross-provider fallback with a custom id → the fallback provider's default.
  const crossed = resolveImageGeneration(
    { imageModel: "gpt-image-1-mini" },
    "openai/gpt-5.5",
    keys({ GOOGLE_API_KEY: "g-key" }),
  );
  assert.ok(crossed.ok);
  assert.equal(crossed.provider, "gemini");
  assert.equal(crossed.model, "imagen-3.0-generate-002");
});

test("resolve: no keys at all reports the preferred provider's key", () => {
  const result = resolveImageGeneration({}, "google/gemini-3.1-pro", keys({}));
  assert.deepEqual(result, { ok: false, reason: "missing_key", missingKey: "GOOGLE_API_KEY" });
  assert.equal(IMAGE_GEN_VAULT_KEYS.openai, "OPENAI_API_KEY");
});

test("size/quality helpers fall back to the provider default for unknown models", () => {
  assert.deepEqual(
    [...imageGenSizesForModel("some-custom-model", "openai")],
    [...(imageGenModelById("gpt-image-1")?.sizes ?? [])],
  );
  assert.deepEqual(
    [...imageGenQualitiesForModel("another-custom", "gemini")],
    [...(imageGenModelById("imagen-3.0-generate-002")?.qualities ?? [])],
  );
});
