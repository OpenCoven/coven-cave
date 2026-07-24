// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";

function request(form: FormData, host = "localhost") {
  return new Request(`http://${host}/api/voice/engines/whisper`, {
    method: "POST",
    headers: { host },
    body: form,
  });
}

test("Whisper endpoint requires a numbered PCM WAV utterance", async () => {
  const missing = new FormData();
  assert.equal((await POST(request(missing))).status, 400);

  const wrongSession = new FormData();
  wrongSession.set("session", "zero");
  wrongSession.set("audio", new Blob(["wav"], { type: "audio/wav" }), "utterance.wav");
  assert.equal((await POST(request(wrongSession))).status, 400);

  const wrongType = new FormData();
  wrongType.set("session", "1");
  wrongType.set("kind", "final");
  wrongType.set("audio", new Blob(["webm"], { type: "audio/webm" }), "utterance.webm");
  const bad = await POST(request(wrongType));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_audio");
});

test("Whisper endpoint rejects remote and mobile-proxy origins before parsing audio", async () => {
  const form = new FormData();
  form.set("session", "1");
  form.set("kind", "final");
  form.set("audio", new Blob(["wav"], { type: "audio/wav" }), "utterance.wav");
  assert.equal((await POST(request(form, "cave.example.com"))).status, 403);
});
