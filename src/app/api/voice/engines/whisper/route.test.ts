// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";

function request(form: FormData) {
  return new Request("http://test/api/voice/engines/whisper", { method: "POST", body: form });
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
