// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_REALTIME_VOICES,
  DEFAULT_OPENAI_VOICE_ID,
  findOpenAiVoice,
  isOpenAiVoiceId,
  openAiVoiceDetail,
  openAiVoicePreviewText,
} from "./openai-voices.ts";

test("catalog covers the full Realtime API output-voice enum", () => {
  const ids = OPENAI_REALTIME_VOICES.map((voice) => voice.id).sort();
  assert.deepEqual(ids, [
    "alloy", "ash", "ballad", "cedar", "coral",
    "echo", "marin", "sage", "shimmer", "verse",
  ]);
});

test("every voice carries the traits the picker surfaces", () => {
  for (const voice of OPENAI_REALTIME_VOICES) {
    assert.ok(voice.label.length > 0, `${voice.id} has a label`);
    assert.match(voice.gender, /^(feminine|masculine|androgynous)$/, `${voice.id} has a perceived gender`);
    assert.ok(voice.accent.length > 0, `${voice.id} has an accent`);
    assert.ok(voice.vibe.length > 0, `${voice.id} has a vibe sketch`);
  }
});

test("cedar and marin are flagged realtime-only (TTS preview may reject them)", () => {
  assert.equal(findOpenAiVoice("cedar")?.realtimeOnly, true);
  assert.equal(findOpenAiVoice("marin")?.realtimeOnly, true);
  const others = OPENAI_REALTIME_VOICES.filter((voice) => !["cedar", "marin"].includes(voice.id));
  assert.ok(others.every((voice) => !voice.realtimeOnly));
});

test("detail line reads Gender · Accent · vibe", () => {
  const ballad = findOpenAiVoice("ballad");
  assert.equal(openAiVoiceDetail(ballad), "Masculine · British · gentle, melodic");
  const sage = findOpenAiVoice("sage");
  assert.equal(openAiVoiceDetail(sage), "Feminine · American · calm, soothing");
});

test("ballad is the one British-accented voice; the rest are American", () => {
  for (const voice of OPENAI_REALTIME_VOICES) {
    assert.equal(voice.accent, voice.id === "ballad" ? "British" : "American");
  }
});

test("id lookup helpers agree with the catalog", () => {
  assert.equal(isOpenAiVoiceId("alloy"), true);
  assert.equal(isOpenAiVoiceId("onyx"), false, "onyx is TTS-only, not a realtime voice");
  assert.equal(findOpenAiVoice("nope"), null);
  assert.equal(isOpenAiVoiceId(DEFAULT_OPENAI_VOICE_ID), true, "default voice must stay in the catalog");
});

test("preview text is stable per voice and names the voice", () => {
  const marin = findOpenAiVoice("marin");
  assert.equal(openAiVoicePreviewText(marin), openAiVoicePreviewText(marin));
  assert.match(openAiVoicePreviewText(marin), /Marin/);
});
