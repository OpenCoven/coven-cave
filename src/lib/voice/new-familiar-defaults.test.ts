import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs-shared.ts";
import { VOICE_PREFERENCE_ID_MAX_LENGTH } from "../preferences-schema.ts";
import { voiceBindingForNewFamiliar } from "./new-familiar-defaults.ts";

test("empty preferences produce no voice binding", () => {
  assert.deepEqual(voiceBindingForNewFamiliar({}), {});
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "",
      defaultModel: "",
      defaultVoice: "",
    }),
    {},
  );
});

test("each selectable provider copies only its explicit binding", () => {
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "familiar",
      defaultModel: "familiar-model",
      defaultVoice: "system-voice",
    }),
    {
      voiceProvider: "familiar",
      voiceModel: "familiar-model",
      voiceName: "system-voice",
    },
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "elevenlabs",
      defaultModel: DEFAULT_ELEVENLABS_MODEL_ID,
      defaultVoice: DEFAULT_ELEVENLABS_VOICE_ID,
    }),
    {
      voiceProvider: "elevenlabs",
      voiceModel: DEFAULT_ELEVENLABS_MODEL_ID,
      voiceName: DEFAULT_ELEVENLABS_VOICE_ID,
    },
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "openai",
      defaultModel: "gpt-realtime",
      defaultVoice: "marin",
    }),
    {
      voiceProvider: "openai",
      voiceModel: "gpt-realtime",
      voiceName: "marin",
    },
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultModel: "device/runtime-model",
      defaultVoice: "Mac voice name",
    }),
    {
      voiceProvider: "local",
      voiceModel: "device/runtime-model",
      voiceName: "Mac voice name",
    },
  );
});

test("model and voice ids are trimmed and empty ids are omitted", () => {
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: " local ",
      defaultModel: "  local-model  ",
      defaultVoice: " \t ",
    }),
    {},
    "provider ids are canonical and must not be repaired",
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "openai",
      defaultModel: " ",
      defaultVoice: "",
    }),
    { voiceProvider: "openai" },
    "empty explicit ids must not inject catalog defaults",
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultModel: "  local-model  ",
      defaultVoice: " \t ",
    }),
    { voiceProvider: "local", voiceModel: "local-model" },
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "familiar",
      defaultModel: "",
      defaultVoice: "  System Voice  ",
    }),
    { voiceProvider: "familiar", voiceName: "System Voice" },
  );
});

test("Gemini, unknown, and malformed preferences fail closed", () => {
  assert.deepEqual(voiceBindingForNewFamiliar({ defaultProvider: "gemini" }), {});
  assert.deepEqual(voiceBindingForNewFamiliar({ defaultProvider: "unknown" }), {});
  assert.deepEqual(voiceBindingForNewFamiliar({ defaultProvider: 42 }), {});
  assert.deepEqual(voiceBindingForNewFamiliar(null), {});
  assert.deepEqual(voiceBindingForNewFamiliar([]), {});
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultModel: 42,
    }),
    {},
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultVoice: null,
    }),
    {},
  );
});

test("the shared id boundary is accepted exactly and fails closed above it", () => {
  const atLimit = "x".repeat(VOICE_PREFERENCE_ID_MAX_LENGTH);
  const overlong = "x".repeat(VOICE_PREFERENCE_ID_MAX_LENGTH + 1);
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultModel: atLimit,
      defaultVoice: atLimit,
    }),
    {
      voiceProvider: "local",
      voiceModel: atLimit,
      voiceName: atLimit,
    },
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "local",
      defaultModel: overlong,
    }),
    {},
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "familiar",
      defaultVoice: overlong,
    }),
    {},
  );
});

test("invalid ElevenLabs model or voice ids fail closed", () => {
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "elevenlabs",
      defaultModel: "Turbo",
      defaultVoice: DEFAULT_ELEVENLABS_VOICE_ID,
    }),
    {},
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "elevenlabs",
      defaultModel: DEFAULT_ELEVENLABS_MODEL_ID,
      defaultVoice: "not valid",
    }),
    {},
  );
});

test("OpenAI accepts reviewed models and voices and rejects unknown values", () => {
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "openai",
      defaultModel: "gpt-4o-realtime-preview",
      defaultVoice: "alloy",
    }),
    {},
    "an unreviewed OpenAI Realtime model must fail closed",
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "openai",
      defaultModel: "gpt-realtime",
      defaultVoice: "unknown",
    }),
    {},
  );
  assert.deepEqual(
    voiceBindingForNewFamiliar({
      defaultProvider: "openai",
      defaultModel: "gpt-realtime",
      defaultVoice: "  cedar  ",
    }),
    {
      voiceProvider: "openai",
      voiceModel: "gpt-realtime",
      voiceName: "cedar",
    },
  );
});
