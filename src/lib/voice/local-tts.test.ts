// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLocalTtsMouth,
  isLocalTtsVoiceName,
  LOCAL_TTS_MAX_CHARS,
} from "./local-tts.ts";

class FakeAudio {
  onended = null;
  onerror = null;
  src = "";
  paused = false;
  playError = false;

  play() {
    if (this.playError) return Promise.reject(new Error("blocked"));
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

test("local voice ids select only registered engine-shaped names", () => {
  assert.equal(isLocalTtsVoiceName("piper-amy-medium-en-us"), true);
  assert.equal(isLocalTtsVoiceName("kokoro-af-heart"), true);
  assert.equal(isLocalTtsVoiceName("Samantha"), false);
  assert.equal(isLocalTtsVoiceName("../piper-amy"), false);
  assert.equal(isLocalTtsVoiceName(""), false);
});

test("local mouth posts a sentence chunk and plays/revokes returned audio", async () => {
  let request = null;
  const audio = new FakeAudio();
  const revoked = [];
  const mouth = createLocalTtsMouth({
    voiceName: "piper-amy-medium-en-us",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { "content-type": "audio/wav" },
      });
    },
    createAudio: () => audio,
    createObjectUrl: () => "blob:local-voice",
    revokeObjectUrl: (url) => revoked.push(url),
  });

  await mouth.speak("A complete sentence for the speech-loop queue.");

  assert.equal(request.url, "/api/voice/local/tts");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    text: "A complete sentence for the speech-loop queue.",
    voiceName: "piper-amy-medium-en-us",
  });
  assert.equal(audio.src, "blob:local-voice");
  assert.deepEqual(revoked, ["blob:local-voice"]);
});

test("local mouth clamps direct callers to the route limit", async () => {
  let sentText = "";
  const mouth = createLocalTtsMouth({
    voiceName: "piper-amy-medium-en-us",
    fetchImpl: async (_url, init) => {
      sentText = JSON.parse(init.body).text;
      return new Response(new Blob(["wav"], { type: "audio/wav" }));
    },
    createAudio: () => new FakeAudio(),
    createObjectUrl: () => "blob:clamped",
    revokeObjectUrl: () => undefined,
  });

  await mouth.speak("x".repeat(LOCAL_TTS_MAX_CHARS + 50));
  assert.equal(sentText.length, LOCAL_TTS_MAX_CHARS);
  assert.ok(sentText.endsWith("…"));
});

test("local mouth surfaces sidecar errors with their actionable hint", async () => {
  const mouth = createLocalTtsMouth({
    voiceName: "piper-amy-medium-en-us",
    fetchImpl: async () =>
      Response.json(
        {
          ok: false,
          error: "local_tts_engine_unavailable",
          hint: "Install piper-tts.",
        },
        { status: 503 },
      ),
  });
  await assert.rejects(
    () => mouth.speak("Hello."),
    (error) =>
      error.message === "local_tts_engine_unavailable" &&
      error.hint === "Install piper-tts.",
  );
});

test("cancel aborts in-flight synthesis without reporting a call error", async () => {
  let aborted = false;
  const mouth = createLocalTtsMouth({
    voiceName: "piper-amy-medium-en-us",
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  });

  const speaking = mouth.speak("This request should be cancelled.");
  await Promise.resolve();
  mouth.cancel();
  await speaking;
  assert.equal(aborted, true);
});

test("playback rejection becomes a stable local TTS error", async () => {
  const audio = new FakeAudio();
  audio.playError = true;
  const mouth = createLocalTtsMouth({
    voiceName: "piper-amy-medium-en-us",
    fetchImpl: async () =>
      new Response(new Blob(["wav"], { type: "audio/wav" })),
    createAudio: () => audio,
    createObjectUrl: () => "blob:bad-audio",
    revokeObjectUrl: () => undefined,
  });

  await assert.rejects(
    () => mouth.speak("Hello."),
    /local_tts_playback_failed/,
  );
});
