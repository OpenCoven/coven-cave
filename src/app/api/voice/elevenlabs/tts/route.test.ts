// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
let nextFetchResponse: Response | null = null;
let lastFetchCall: { url: string; init: RequestInit } | null = null;

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  lastFetchCall = { url: String(url), init: init ?? {} };
  if (nextFetchResponse) return nextFetchResponse;
  return realFetch(url as any, init);
};

const { POST } = await import("./route.ts");
const { ELEVENLABS_TTS_MAX_CHARS } = await import("../../../../../lib/voice/elevenlabs-shared.ts");

const VOICE_ID = "AbCdEf123456";
const MODEL_ID = "eleven_turbo_v2_5";

function req(body: unknown) {
  return new Request("http://test/api/voice/elevenlabs/tts", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
  nextFetchResponse = null;
  lastFetchCall = null;
});

test("400 invalid_json on an unparseable body", async () => {
  const res = await POST(req("{nope"));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_json");
});

test("400 on missing or oversized text", async () => {
  const missing = await POST(req({ voiceId: VOICE_ID, modelId: MODEL_ID, text: "  " }));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "missing_text");

  const oversized = await POST(req({
    voiceId: VOICE_ID,
    modelId: MODEL_ID,
    text: "x".repeat(ELEVENLABS_TTS_MAX_CHARS + 1),
  }));
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error, "text_too_long");
});

test("400 on a path-shaped voice id or malformed model id (injection barrier)", async () => {
  const badVoice = await POST(req({ voiceId: "../../evil", modelId: MODEL_ID, text: "hi there" }));
  assert.equal(badVoice.status, 400);
  assert.equal((await badVoice.json()).error, "invalid_voice_id");

  const badModel = await POST(req({ voiceId: VOICE_ID, modelId: "a/b", text: "hi there" }));
  assert.equal(badModel.status, 400);
  assert.equal((await badModel.json()).error, "invalid_model_id");
});

test("400 vault_key_unresolved when ELEVENLABS_API_KEY is not set", async () => {
  const res = await POST(req({ voiceId: VOICE_ID, modelId: MODEL_ID, text: "hello" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "ELEVENLABS_API_KEY");
});

test("200 proxies MP3 bytes and keeps the key server-side", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-secret";
  nextFetchResponse = new Response(new Uint8Array([1, 2, 3]).buffer, {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
  const res = await POST(req({ voiceId: VOICE_ID, modelId: MODEL_ID, text: "hello" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.equal((await res.arrayBuffer()).byteLength, 3);
  assert.match(lastFetchCall.url, new RegExp(`text-to-speech/${VOICE_ID}`));
  assert.equal(lastFetchCall.init.headers["xi-api-key"], "xi-secret");
  const upstreamBody = JSON.parse(lastFetchCall.init.body);
  assert.equal(upstreamBody.text, "hello");
  assert.equal(upstreamBody.model_id, MODEL_ID);
});

test("502 with a hint when ElevenLabs rejects, 502 key-invalid on 401", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-secret";
  nextFetchResponse = new Response(
    JSON.stringify({ detail: { message: "quota exceeded" } }),
    { status: 429 },
  );
  const rejected = await POST(req({ voiceId: VOICE_ID, modelId: MODEL_ID, text: "hello" }));
  const rejectedJson = await rejected.json();
  assert.equal(rejected.status, 502);
  assert.equal(rejectedJson.error, "elevenlabs_tts_failed");
  assert.match(rejectedJson.hint, /quota exceeded/);

  nextFetchResponse = new Response("{}", { status: 401 });
  const unauthorized = await POST(req({ voiceId: VOICE_ID, modelId: MODEL_ID, text: "hello" }));
  const unauthorizedJson = await unauthorized.json();
  assert.equal(unauthorized.status, 502);
  assert.equal(unauthorizedJson.error, "elevenlabs_key_invalid");
});
