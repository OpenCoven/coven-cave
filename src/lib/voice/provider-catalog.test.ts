import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs-shared.ts";
import { DEFAULT_OPENAI_VOICE_ID } from "./openai-voices.ts";
import {
  EDITABLE_VOICE_VAULT_KEYS,
  OPENAI_REALTIME_MODEL_IDS,
  SELECTABLE_VOICE_PROVIDER_IDS,
  VOICE_PROVIDER_CATALOG,
  getVoiceProviderDefinition,
  isReviewedOpenAiRealtimeModelId,
  isSelectableVoiceProviderId,
} from "./provider-catalog.ts";

test("catalog keeps the stable provider order", () => {
  assert.deepEqual(
    VOICE_PROVIDER_CATALOG.map((provider) => provider.id),
    ["familiar", "elevenlabs", "openai", "local", "gemini"],
  );
});

test("selectable provider ids exclude disabled Gemini and unknown values", () => {
  assert.deepEqual(
    SELECTABLE_VOICE_PROVIDER_IDS,
    ["familiar", "elevenlabs", "openai", "local"],
  );
  assert.equal(isSelectableVoiceProviderId("familiar"), true);
  assert.equal(isSelectableVoiceProviderId("gemini"), false);
  assert.equal(isSelectableVoiceProviderId("bogus"), false);
  assert.equal(isSelectableVoiceProviderId(null), false);
});

test("Gemini remains cataloged but unavailable and non-defaultable", () => {
  assert.deepEqual(getVoiceProviderDefinition("gemini"), {
    id: "gemini",
    label: "Gemini Live",
    available: false,
    defaultable: false,
    vaultKey: "GOOGLE_API_KEY",
    defaults: { model: "", voice: "" },
  });
});

test("catalog uses shared OpenAI and ElevenLabs defaults", () => {
  assert.deepEqual(getVoiceProviderDefinition("openai")?.defaults, {
    model: "gpt-realtime",
    voice: DEFAULT_OPENAI_VOICE_ID,
  });
  assert.deepEqual(getVoiceProviderDefinition("elevenlabs")?.defaults, {
    model: DEFAULT_ELEVENLABS_MODEL_ID,
    voice: DEFAULT_ELEVENLABS_VOICE_ID,
  });
  assert.equal(getVoiceProviderDefinition("bogus"), null);
});

test("reviewed OpenAI Realtime model ids are immutable and validated centrally", () => {
  assert.deepEqual(OPENAI_REALTIME_MODEL_IDS, ["gpt-realtime"]);
  assert.equal(Object.isFrozen(OPENAI_REALTIME_MODEL_IDS), true);
  assert.equal(isReviewedOpenAiRealtimeModelId("gpt-realtime"), true);
  assert.equal(isReviewedOpenAiRealtimeModelId("gpt-4o-realtime-preview"), false);
  assert.equal(isReviewedOpenAiRealtimeModelId(42), false);
  assert.throws(
    () => (OPENAI_REALTIME_MODEL_IDS as unknown as string[]).push("unreviewed"),
    TypeError,
  );
});

test("editable credential keys derive from available defaultable providers", () => {
  assert.deepEqual(
    EDITABLE_VOICE_VAULT_KEYS,
    ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"],
  );
});

test("derived provider collections are immutable and cannot alter membership", () => {
  assert.equal(Object.isFrozen(SELECTABLE_VOICE_PROVIDER_IDS), true);
  assert.equal(Object.isFrozen(EDITABLE_VOICE_VAULT_KEYS), true);

  assert.throws(
    () => (SELECTABLE_VOICE_PROVIDER_IDS as unknown as string[]).pop(),
    TypeError,
  );
  assert.throws(
    () => (EDITABLE_VOICE_VAULT_KEYS as unknown as string[]).push("GOOGLE_API_KEY"),
    TypeError,
  );
  assert.equal(isSelectableVoiceProviderId("local"), true);
  assert.equal(isSelectableVoiceProviderId("gemini"), false);
});

test("catalog definitions and nested defaults are deeply immutable", () => {
  const openai = getVoiceProviderDefinition("openai");
  assert.ok(openai);
  assert.equal(Object.isFrozen(VOICE_PROVIDER_CATALOG), true);
  assert.equal(Object.isFrozen(openai), true);
  assert.equal(Object.isFrozen(openai.defaults), true);

  type MutableDefinition = {
    vaultKey: "OPENAI_API_KEY" | null;
    defaults: { model: string; voice: string };
  };
  const mutableView = openai as unknown as MutableDefinition;
  assert.throws(() => { mutableView.vaultKey = null; }, TypeError);
  assert.throws(() => { mutableView.defaults.model = "tampered"; }, TypeError);
  assert.throws(() => { mutableView.defaults.voice = "tampered"; }, TypeError);

  const subsequent = getVoiceProviderDefinition("openai");
  assert.strictEqual(subsequent, openai);
  assert.equal(subsequent?.vaultKey, "OPENAI_API_KEY");
  assert.deepEqual(subsequent?.defaults, {
    model: "gpt-realtime",
    voice: DEFAULT_OPENAI_VOICE_ID,
  });
});
