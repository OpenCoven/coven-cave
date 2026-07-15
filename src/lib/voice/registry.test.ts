// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { getVoiceProvider, listVoiceProviders } from "./registry.ts";

test("getVoiceProvider returns adapter for known id", () => {
  const openai = getVoiceProvider("openai");
  assert.ok(openai);
  assert.equal(openai.id, "openai");
  assert.equal(typeof openai.mintSession, "function");
  assert.equal(typeof openai.clientAdapter.connect, "function");
});

test("getVoiceProvider returns gemini stub", () => {
  const gemini = getVoiceProvider("gemini");
  assert.ok(gemini);
  assert.equal(gemini.id, "gemini");
});

test("gemini stub mintSession rejects with not_implemented", async () => {
  const gemini = getVoiceProvider("gemini");
  await assert.rejects(
    () => gemini.mintSession("fake-key", {
      familiarId: "x", model: "x", voice: "x", instructions: "x",
    }),
    /not_implemented/,
  );
});

test("getVoiceProvider returns the local loop provider", () => {
  const local = getVoiceProvider("local");
  assert.ok(local);
  assert.equal(local.id, "local");
  assert.equal(typeof local.mintSession, "function");
  assert.equal(typeof local.clientAdapter.connect, "function");
});

test("getVoiceProvider returns the familiar-brain provider", () => {
  const familiar = getVoiceProvider("familiar");
  assert.ok(familiar);
  assert.equal(familiar.id, "familiar");
  assert.equal(typeof familiar.mintSession, "function");
  assert.equal(typeof familiar.clientAdapter.connect, "function");
  // True-voice turns ARE chat turns — the overlay must not double-persist.
  assert.equal(familiar.persistsTranscripts, true);
});

test("getVoiceProvider returns the elevenlabs provider", () => {
  const eleven = getVoiceProvider("elevenlabs");
  assert.ok(eleven);
  assert.equal(eleven.id, "elevenlabs");
  assert.equal(typeof eleven.mintSession, "function");
  assert.equal(typeof eleven.clientAdapter.connect, "function");
  assert.equal(eleven.persistsTranscripts, true);
});

test("getVoiceProvider returns null for unknown id", () => {
  assert.equal(getVoiceProvider("bogus"), null);
  assert.equal(getVoiceProvider(""), null);
});

test("listVoiceProviders returns stable order: openai, gemini, local, familiar, elevenlabs", () => {
  const list = listVoiceProviders();
  assert.deepEqual(list.map(p => p.id), ["openai", "gemini", "local", "familiar", "elevenlabs"]);
});
