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

test("parseElevenLabsVoices keeps valid library entries and drops malformed ids", async () => {
  const { parseElevenLabsVoices } = await import("./elevenlabs-shared.ts");
  assert.deepEqual(
    parseElevenLabsVoices({
      voices: [
        { voice_id: "AbCdEf123456", name: "  Aunt Morgan ", category: "cloned" },
        { voice_id: "../evil", name: "Bad" },
        { voice_id: "GhIjKl789012", name: "" },
        { voice_id: 42, name: "Numeric" },
      ],
    }),
    [
      { id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
      { id: "GhIjKl789012", name: "GhIjKl789012" },
    ],
  );
  assert.deepEqual(parseElevenLabsVoices(null), []);
  assert.deepEqual(parseElevenLabsVoices({ voices: "nope" }), []);
});

test("parseElevenLabsModels keeps only TTS-capable models", async () => {
  const { parseElevenLabsModels } = await import("./elevenlabs-shared.ts");
  assert.deepEqual(
    parseElevenLabsModels([
      { model_id: "eleven_turbo_v2_5", name: "Turbo v2.5", can_do_text_to_speech: true },
      { model_id: "eleven_flash_v2_5", name: "Flash v2.5" },
      { model_id: "scribe_v1", name: "Scribe", can_do_text_to_speech: false },
      { model_id: "Bad/Model", name: "Nope" },
    ]),
    [
      { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
      { id: "eleven_flash_v2_5", name: "Flash v2.5" },
    ],
  );
  assert.deepEqual(parseElevenLabsModels({ not: "an array" }), []);
});

function installAudioContext({ blocked = false } = {}) {
  const sources = [];
  const buffers = [];
  const contexts = [];
  globalThis.AudioContext = class {
    currentTime = 0;
    state = blocked ? "suspended" : "running";
    destination = {};
    constructor() { contexts.push(this); }
    async resume() { if (blocked) throw new Error("NotAllowedError"); }
    async close() { this.state = "closed"; }
    createBuffer(_channels, length, sampleRate) {
      const data = new Float32Array(length);
      const buffer = { duration: length / sampleRate, getChannelData: () => data };
      buffers.push(data); return buffer;
    }
    createBufferSource() {
      const source = { buffer: null, onended: null, stopped: false,
        connect() {}, disconnect() {}, start() { setImmediate(() => source.onended?.()); },
        stop() { source.stopped = true; source.onended?.(); },
      };
      sources.push(source); return source;
    }
  };
  return { sources, buffers, contexts };
}

test("mouth plays PCM before synthesis finishes and preserves split 16-bit samples", async () => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  const audio = installAudioContext();
  let upstream;
  let request;
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: "eleven_v3_conversational",
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(new ReadableStream({ start(controller) {
        upstream = controller;
        controller.enqueue(new Uint8Array([0, 64, 0]));
        controller.enqueue(new Uint8Array([128]));
      } }), { headers: { "content-type": "audio/pcm" } });
    },
  });
  const result = mouth.speak("Hello Val.").then(() => null, error => error);
  await new Promise(setImmediate);
  try {
    assert.equal(request.format, "pcm");
    assert.ok(audio.sources.length > 0, "audio must be scheduled before the response body ends");
    assert.deepEqual(audio.buffers.flatMap(buffer => [...buffer]), [0.5, -1]);
  } finally { upstream.close(); await result; mouth.cancel(); }
});

test("mouth interruption settles pending audio, cancels its reader, and stays reusable", async () => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  const audio = installAudioContext();
  let cancelled = false;
  let upstream;
  let calls = 0;
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: "eleven_v3_conversational",
    fetchImpl: async () => ++calls === 1 ? new Response(new ReadableStream({
      start(controller) { upstream = controller; controller.enqueue(new Uint8Array([0, 64])); },
      cancel() { cancelled = true; },
    })) : new Response(new Uint8Array([0, 64])),
  });
  const pending = mouth.speak("An interrupted utterance.");
  await new Promise(setImmediate);
  mouth.interrupt();
  try { assert.equal(cancelled, true); }
  finally { if (!cancelled) upstream.close(); await pending; }
  await mouth.speak("A fresh utterance.");
  assert.equal(calls, 2);
  mouth.cancel();
  assert.equal(audio.contexts[0].state, "closed");
});

test("blocked audio playback reports a recoverable error instead of silently succeeding", async () => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  installAudioContext({ blocked: true });
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: "eleven_v3_conversational",
    fetchImpl: async () => new Response(new Uint8Array([0, 64])),
  });
  try { await assert.rejects(mouth.speak("Hello."), /audio_playback_blocked/); }
  finally { mouth.cancel(); }
});

test("new live calls default to expressive conversational speech", () => {
  assert.equal(DEFAULT_ELEVENLABS_MODEL_ID, "eleven_v3_conversational");
});

test("interrupt settles a browser that leaves AudioContext.resume pending", async () => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  installAudioContext();
  globalThis.AudioContext.prototype.resume = () => new Promise(() => {});
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: DEFAULT_ELEVENLABS_MODEL_ID,
    fetchImpl: async () => { throw new Error("must not synthesize while suspended"); },
  });
  let settled = false;
  const pending = mouth.speak("Hello.").then(() => { settled = true; });
  await new Promise(setImmediate);
  mouth.interrupt();
  await new Promise(setImmediate);
  try { assert.equal(settled, true, "barge-in must release the speech queue"); }
  finally { mouth.cancel(); if (settled) await pending; }
});

test("a pending resume reports blocked playback after a bounded wait", async (t) => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  installAudioContext();
  globalThis.AudioContext.prototype.resume = () => new Promise(() => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: DEFAULT_ELEVENLABS_MODEL_ID });
  let error;
  const pending = mouth.speak("Hello.").catch(e => { error = e; });
  t.mock.timers.tick(3_000);
  await new Promise(setImmediate);
  try { assert.equal(error?.message, "audio_playback_blocked"); }
  finally { mouth.cancel(); if (error) await pending; }
});

test("interrupt stops scheduled audio that has not finished playing", async () => {
  const { createElevenLabsMouth } = await import("./elevenlabs.ts");
  const audio = installAudioContext();
  const createSource = globalThis.AudioContext.prototype.createBufferSource;
  globalThis.AudioContext.prototype.createBufferSource = function () {
    const source = createSource.call(this); source.start = () => {}; return source;
  };
  const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: DEFAULT_ELEVENLABS_MODEL_ID,
    fetchImpl: async () => new Response(new Uint8Array([0, 64, 0, 32])),
  });
  const playing = mouth.speak("Hello.");
  await new Promise(setImmediate);
  assert.equal(audio.sources.length, 1);
  mouth.interrupt();
  await playing;
  assert.equal(audio.sources[0].stopped, true);
  mouth.cancel();
});

for (const bytes of [new Uint8Array(), new Uint8Array([0, 64, 0])]) {
  test(`invalid PCM (${bytes.length} bytes) reports incomplete playback`, async () => {
    const { createElevenLabsMouth } = await import("./elevenlabs.ts");
    installAudioContext();
    const mouth = createElevenLabsMouth({ voiceId: DEFAULT_ELEVENLABS_VOICE_ID, modelId: DEFAULT_ELEVENLABS_MODEL_ID,
      fetchImpl: async () => new Response(bytes),
    });
    try { await assert.rejects(mouth.speak("Hello."), /audio_playback_failed/); }
    finally { mouth.cancel(); }
  });
}
