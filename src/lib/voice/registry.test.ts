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

test("getVoiceProvider returns null for unknown id", () => {
  assert.equal(getVoiceProvider("bogus"), null);
  assert.equal(getVoiceProvider(""), null);
});

test("listVoiceProviders returns stable order: openai, gemini", () => {
  const list = listVoiceProviders();
  assert.deepEqual(list.map(p => p.id), ["openai", "gemini"]);
});
