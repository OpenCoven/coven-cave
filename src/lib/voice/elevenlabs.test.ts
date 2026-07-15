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

const { elevenLabsProvider, probeElevenLabs } = await import("./elevenlabs.ts");
const {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  isValidElevenLabsModelId,
  isValidElevenLabsVoiceId,
} = await import("./elevenlabs-shared.ts");

beforeEach(() => {
  nextFetchResponse = null;
  lastFetchCall = null;
});

test("voice/model id validators are strict path-injection barriers", () => {
  assert.ok(isValidElevenLabsVoiceId(DEFAULT_ELEVENLABS_VOICE_ID));
  assert.ok(isValidElevenLabsVoiceId("AbC123xyZ9"));
  assert.equal(isValidElevenLabsVoiceId("../../evil"), false);
  assert.equal(isValidElevenLabsVoiceId("has space"), false);
  assert.equal(isValidElevenLabsVoiceId("short"), false);
  assert.equal(isValidElevenLabsVoiceId(""), false);
  assert.equal(isValidElevenLabsVoiceId(42), false);

  assert.ok(isValidElevenLabsModelId(DEFAULT_ELEVENLABS_MODEL_ID));
  assert.equal(isValidElevenLabsModelId("Turbo"), false);
  assert.equal(isValidElevenLabsModelId("a/b"), false);
  assert.equal(isValidElevenLabsModelId(""), false);
});

test("probeElevenLabs distinguishes bad key from unreachable service", async () => {
  nextFetchResponse = new Response("{}", { status: 401 });
  const invalid = await probeElevenLabs("xi-bad");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "elevenlabs_key_invalid");
  assert.match(lastFetchCall.url, /api\.elevenlabs\.io\/v1\/models/);
  assert.equal(lastFetchCall.init.headers["xi-api-key"], "xi-bad");

  const down = await probeElevenLabs("xi-x", async () => { throw new Error("no route"); });
  assert.equal(down.ok, false);
  assert.equal(down.code, "elevenlabs_unreachable");
  assert.match(down.detail, /no route/);

  nextFetchResponse = new Response("[]", { status: 200 });
  const good = await probeElevenLabs("xi-good");
  assert.equal(good.ok, true);
});

test("mintSession grants a proxied session bound to the chat session", async () => {
  nextFetchResponse = new Response("[]", { status: 200 });
  const grant = await elevenLabsProvider.mintSession("xi-good", {
    familiarId: "milo",
    model: "eleven_flash_v2_5",
    voice: "AbCdEf123456",
    instructions: "unused",
    sessionId: "sess-7",
  });
  assert.equal(grant.provider, "elevenlabs");
  // The vault key must never ride the grant to the client.
  assert.equal(grant.clientSecret, "elevenlabs");
  assert.equal(JSON.stringify(grant).includes("xi-good"), false);
  assert.equal(grant.connection.kind, "elevenlabs-familiar");
  assert.equal(grant.connection.familiarId, "milo");
  assert.equal(grant.connection.sessionId, "sess-7");
  assert.equal(grant.connection.voiceId, "AbCdEf123456");
  assert.equal(grant.connection.modelId, "eleven_flash_v2_5");
});

test("mintSession applies default voice and model when unset", async () => {
  nextFetchResponse = new Response("[]", { status: 200 });
  const grant = await elevenLabsProvider.mintSession("xi-good", {
    familiarId: "milo",
    model: "",
    voice: "",
    instructions: "",
    sessionId: "sess-7",
  });
  assert.equal(grant.connection.voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
  assert.equal(grant.connection.modelId, DEFAULT_ELEVENLABS_MODEL_ID);
});

test("mintSession rejects without a session and on an invalid key", async () => {
  await assert.rejects(
    () => elevenLabsProvider.mintSession("xi-x", {
      familiarId: "milo", model: "", voice: "", instructions: "",
    }),
    /elevenlabs_missing_session/,
  );
  nextFetchResponse = new Response("{}", { status: 401 });
  await assert.rejects(
    () => elevenLabsProvider.mintSession("xi-bad", {
      familiarId: "milo", model: "", voice: "", instructions: "", sessionId: "s1",
    }),
    /elevenlabs_key_invalid/,
  );
});

test("the provider persists its own transcripts (real chat turns)", () => {
  assert.equal(elevenLabsProvider.persistsTranscripts, true);
  assert.equal(elevenLabsProvider.id, "elevenlabs");
  assert.equal(typeof elevenLabsProvider.clientAdapter.connect, "function");
});
