// POST /api/voice/elevenlabs/tts under every upstream anomaly (#6359).
//
// The proxy streams ElevenLabs' body straight through under its own
// content-type so playback can start on the first bytes. The matrix proves a
// healthy stream passes through byte for byte with the right headers, that a
// 401 is `elevenlabs_key_invalid`, any other non-2xx is `elevenlabs_tts_failed`
// carrying the provider's `detail` (or the status when there is none), and a
// stalled socket or dead network is `elevenlabs_unreachable`. The key never
// appears in any answer, the upstream call is bounded by the caller's own
// signal plus a 30 s timeout, and the proxy re-asks ElevenLabs the moment it
// is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type DegradedExpectation } from "../../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("elevenlabs-tts-anomalies");
const API_KEY = "xi-testonly-elevenlabs-never-dispatched-0123456789abcdef";
process.env.ELEVENLABS_API_KEY = API_KEY;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const VOICE_ID = "AbCdEf123456";
const MODEL_ID = "eleven_turbo_v2_5";
const CHUNKS = [Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]), Buffer.alloc(32, 0xaa), Buffer.alloc(16, 0x55)];
const AUDIO = Buffer.concat(CHUNKS);

/** The upstream answers as a stream of several chunks, the way a real TTS render arrives. */
function streamedAudio(contentType: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of CHUNKS) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": contentType } });
}

harness.healthy("elevenlabs", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, `/v1/text-to-speech/${VOICE_ID}/stream`);
  assert.equal(request.headers.get("xi-api-key"), API_KEY, "the key travels as xi-api-key and nowhere else");
  const body = (await request.json()) as { text: string; model_id: string };
  assert.equal(body.model_id, MODEL_ID);
  assert.equal(body.text, "The cave hums.");
  const format = url.searchParams.get("output_format");
  assert.ok(format === "mp3_44100_128" || format === "pcm_24000", String(format));
  return streamedAudio(format === "pcm_24000" ? "audio/pcm" : "audio/mpeg");
});

const speak = (format?: "pcm" | "mp3", signal?: AbortSignal) =>
  POST(
    new Request("http://localhost/api/voice/elevenlabs/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "The cave hums.", voiceId: VOICE_ID, modelId: MODEL_ID, ...(format ? { format } : {}) }),
      ...(signal ? { signal } : {}),
    }),
  );

const ttsFailed = (hint: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.deepEqual(outcome.body, { ok: false, error: "elevenlabs_tts_failed", hint });
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; hint: string };
  assert.equal(body.error, "elevenlabs_unreachable");
  assert.match(body.hint, /^Couldn't reach ElevenLabs \(/);
};

// The proxy relays any 2xx body under its own audio content-type without
// looking at what ElevenLabs declared, so JSON on a 200 is streamed as audio.
// Documented here, not endorsed.
const relayedAsAudio: DegradedExpectation = (outcome) => {
  assert.equal(outcome.status, 200);
  assert.equal(outcome.response?.headers.get("content-type"), "audio/mpeg");
};

test("POST /api/voice/elevenlabs/tts across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "elevenlabs",
    secrets: [API_KEY],
    invoke: () => speak(),
    healthy: async (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.equal(outcome.response?.headers.get("content-type"), "audio/mpeg");
      assert.equal(outcome.response?.headers.get("cache-control"), "no-store");
      assert.equal(outcome.response?.headers.get("x-audio-sample-rate"), null, "the sample-rate header is a PCM-only promise");
      const relayed = Buffer.from(await outcome.response!.arrayBuffer());
      assert.ok(relayed.equals(AUDIO), "the stream passes through byte for byte");
      const call = harness.calls("elevenlabs").at(-1);
      assert.ok(call);
      assert.equal(call.hasDeadline, true, "the upstream call is bounded by the caller's signal and a 30 s timeout");
      assert.equal(new URL(call.url).searchParams.get("output_format"), "mp3_44100_128");
    },
    degraded: {
      "http-500": ttsFailed("ElevenLabs returned http 500."),
      "http-502": ttsFailed("ElevenLabs returned http 502."),
      "auth-revoked": (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        const body = outcome.body as { error: string; hint: string };
        assert.equal(body.error, "elevenlabs_key_invalid");
        assert.match(body.hint, /ELEVENLABS_API_KEY/);
      },
      "rate-limit": ttsFailed("ElevenLabs returned http 429."),
      timeout: unreachable,
      network: unreachable,
      "malformed-json": relayedAsAudio,
      "empty-body": relayedAsAudio,
      "schema-drift": relayedAsAudio,
    },
  });
});

test("a PCM render passes through as audio/pcm with its sample rate", async () => {
  harness.heal();
  harness.reset();
  const response = await speak("pcm");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/pcm");
  assert.equal(response.headers.get("x-audio-sample-rate"), "24000");
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(AUDIO));
  assert.equal(new URL(harness.calls("elevenlabs")[0].url).searchParams.get("output_format"), "pcm_24000");
});

test("ElevenLabs' own detail rides through as the hint, in either shape it sends", async () => {
  for (const [detail, hint] of [
    [{ status: "quota_exceeded", message: "This request exceeds your quota of 10000 characters." }, "This request exceeds your quota of 10000 characters."],
    ["Model eleven_turbo_v2_5 is not available on your plan.", "Model eleven_turbo_v2_5 is not available on your plan."],
    [{ status: "invalid_parameters" }, "ElevenLabs returned http 422."],
  ] as const) {
    harness.inject("elevenlabs", { kind: "http", status: 422, body: { detail } });
    try {
      const response = await speak();
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { ok: false, error: "elevenlabs_tts_failed", hint });
    } finally {
      harness.heal("elevenlabs");
    }
  }
});

test("the caller hanging up cancels the upstream render", async () => {
  const controller = new AbortController();
  harness.inject("elevenlabs", { kind: "timeout" });
  try {
    const pending = speak(undefined, controller.signal);
    controller.abort(new DOMException("The listener hung up", "AbortError"));
    const response = await pending;
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, "elevenlabs_unreachable");
    assert.equal(body.hint, "Couldn't reach ElevenLabs (The listener hung up).", "the caller's own abort reason is what ended the wait");
  } finally {
    harness.heal("elevenlabs");
  }
  harness.reset();
  assert.equal((await speak()).status, 200, "the next render after a hang-up reaches ElevenLabs again");
  assert.equal(harness.calls("elevenlabs").length, 1);
});
