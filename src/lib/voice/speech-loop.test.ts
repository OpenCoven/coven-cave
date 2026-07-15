// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSpeechLoop,
  createSentenceChunker,
  createWebSpeechEars,
  MIN_SPOKEN_SENTENCE_CHARS,
} from "./speech-loop.ts";
import { VoiceConnectError } from "./types.ts";

test("emits each completed sentence exactly once as text accumulates", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(chunker.push("The moon is full toni"), []);
  assert.deepEqual(chunker.push("The moon is full tonight. The cats are"), [
    "The moon is full tonight.",
  ]);
  // Re-pushing the same accumulation emits nothing new.
  assert.deepEqual(chunker.push("The moon is full tonight. The cats are"), []);
  assert.deepEqual(
    chunker.push("The moon is full tonight. The cats are out! And the o"),
    ["The cats are out!"],
  );
});

test("flush returns the unterminated tail once", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(chunker.push("First part done. And a trailing thought"), [
    "First part done.",
  ]);
  assert.equal(
    chunker.flush("First part done. And a trailing thought"),
    "And a trailing thought",
  );
  assert.equal(chunker.flush("First part done. And a trailing thought"), null);
});

test("short fragments buffer until a later break instead of tiny utterances", () => {
  const chunker = createSentenceChunker();
  // "1. " looks like a sentence break but is far below the minimum — it must
  // ride with the following text, not become its own utterance.
  const text = "1. Feed the familiar something substantial to say aloud. Then rest.";
  const out = chunker.push(text);
  assert.deepEqual(out, [
    "1. Feed the familiar something substantial to say aloud.",
  ]);
  assert.ok(out[0].length >= MIN_SPOKEN_SENTENCE_CHARS);
});

test("question and ellipsis breaks with closing quotes are honored", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(
    chunker.push('"Shall we begin the ritual?" She nodded once… And then'),
    ['"Shall we begin the ritual?"', "She nodded once…"],
  );
});

// ── connectSpeechLoop with injected ears (the seam native-stt plugs into) ──

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeEars() {
  const log = [];
  let handlers = null;
  return {
    log,
    get handlers() {
      return handlers;
    },
    factory: (h) => {
      handlers = h;
      return {
        listen: () => log.push("listen"),
        hush: () => log.push("hush"),
        close: () => log.push("close"),
      };
    },
  };
}

function fakeMic() {
  const stopped = [];
  const track = { enabled: true, stop: () => stopped.push("mic") };
  return { stopped, track, stream: { getAudioTracks: () => [track] } };
}

function fakeMouth() {
  const spoken = [];
  return {
    spoken,
    mouth: {
      async speak(text) {
        spoken.push(text);
      },
      cancel() {
        spoken.push("<cancel>");
      },
    },
  };
}

function loopFixture({ brain } = {}) {
  const ears = fakeEars();
  const mic = fakeMic();
  const mouth = fakeMouth();
  const events = { userFinals: [], assistantFinals: [], errors: [] };
  const session = connectSpeechLoop({
    mic: mic.stream,
    ears: ears.factory,
    mouth: mouth.mouth,
    callbacks: {
      onUserTranscriptFinal: (t) => events.userFinals.push(t),
      onAssistantTranscriptFinal: (t) => events.assistantFinals.push(t),
      onPartialTranscript: () => {},
      onError: (err) => events.errors.push(err),
      onDisconnect: () => {},
    },
    brain: brain ?? (async (userText, speak) => {
      const reply = `heard: ${userText}`;
      speak(reply);
      return reply;
    }),
    brainErrorCode: "test_brain_failed",
    brainErrorHint: "the test brain broke",
  });
  return { ears, mic, mouth, events, session };
}

test("a user final runs the brain, hushes while speaking, listens after the queue drains", async () => {
  const { ears, mouth, events } = loopFixture();
  assert.deepEqual(ears.log, ["listen"]);

  ears.handlers.onFinal("summon the cat");
  await tick();
  await tick();

  assert.deepEqual(events.userFinals, ["summon the cat"]);
  assert.deepEqual(events.assistantFinals, ["heard: summon the cat"]);
  assert.deepEqual(mouth.spoken, ["heard: summon the cat"]);
  // listen (start) → hush (mouth takes over) → listen (queue drained).
  assert.deepEqual(ears.log, ["listen", "hush", "listen"]);
  assert.deepEqual(events.errors, []);
});

test("empty and whitespace finals never reach the brain", async () => {
  let brainCalls = 0;
  const { ears, events } = loopFixture({
    brain: async () => {
      brainCalls += 1;
      return "";
    },
  });
  ears.handlers.onFinal("   ");
  await tick();
  assert.equal(brainCalls, 0);
  assert.deepEqual(events.userFinals, []);
});

test("ears errors surface as VoiceConnectError with the engine's hint", () => {
  const { ears, events } = loopFixture();
  ears.handlers.onError("stt_permission_denied", "allow it in System Settings");
  assert.equal(events.errors.length, 1);
  assert.ok(events.errors[0] instanceof VoiceConnectError);
  assert.equal(events.errors[0].message, "stt_permission_denied");
  assert.equal(events.errors[0].hint, "allow it in System Settings");
});

test("mute hushes the ears and disables the mic; unmute listens again", () => {
  const { ears, mic, session } = loopFixture();
  session.setMuted(true);
  assert.equal(mic.track.enabled, false);
  assert.deepEqual(ears.log, ["listen", "hush"]);
  session.setMuted(false);
  assert.equal(mic.track.enabled, true);
  assert.deepEqual(ears.log, ["listen", "hush", "listen"]);
});

test("close tears down ears, mouth, and mic tracks", async () => {
  const { ears, mic, mouth, session } = loopFixture();
  await session.close();
  assert.ok(ears.log.includes("close"));
  assert.deepEqual(mouth.spoken, ["<cancel>"]);
  assert.deepEqual(mic.stopped, ["mic"]);
});

test("without injected ears and without a window engine the loop refuses with stt_unavailable", () => {
  assert.equal(createWebSpeechEars(), null);
  const mic = fakeMic();
  assert.throws(
    () =>
      connectSpeechLoop({
        mic: mic.stream,
        callbacks: {
          onUserTranscriptFinal: () => {},
          onAssistantTranscriptFinal: () => {},
          onPartialTranscript: () => {},
          onError: () => {},
          onDisconnect: () => {},
        },
        brain: async () => "",
        brainErrorCode: "x",
        brainErrorHint: "y",
      }),
    (err) => err instanceof VoiceConnectError && err.message === "stt_unavailable",
  );
});

// ── createWebSpeechEars over a stubbed window.SpeechRecognition ────────────

class FakeRecognition {
  static instances = [];
  constructor() {
    this.started = 0;
    this.stopped = 0;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
}

function withFakeWindow(fn) {
  globalThis.window = { SpeechRecognition: FakeRecognition };
  try {
    return fn();
  } finally {
    delete globalThis.window;
    FakeRecognition.instances = [];
  }
}

test("web ears restart after a silence self-stop, but never after hush or close", () => {
  withFakeWindow(() => {
    const got = { finals: [], partials: [], errors: [] };
    const ears = createWebSpeechEars()({
      onPartial: (t) => got.partials.push(t),
      onFinal: (t) => got.finals.push(t),
      onError: (code) => got.errors.push(code),
    });
    const recognition = FakeRecognition.instances[0];

    ears.listen();
    assert.equal(recognition.started, 1);
    // The engine stopped itself after silence — ears keep listening.
    recognition.onend();
    assert.equal(recognition.started, 2);

    ears.hush();
    recognition.onend?.();
    assert.equal(recognition.started, 2, "hushed ears must not restart");

    ears.listen();
    assert.equal(recognition.started, 3);
    ears.close();
    assert.equal(recognition.onend, null);
    assert.equal(recognition.stopped >= 2, true);
  });
});

test("web ears route finals, partials, and non-routine errors", () => {
  withFakeWindow(() => {
    const got = { finals: [], partials: [], errors: [] };
    const ears = createWebSpeechEars()({
      onPartial: (t) => got.partials.push(t),
      onFinal: (t) => got.finals.push(t),
      onError: (code) => got.errors.push(code),
    });
    ears.listen();
    const recognition = FakeRecognition.instances[0];

    recognition.onresult({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "light the " } },
        { isFinal: true, 0: { transcript: "light the candles " } },
      ],
    });
    assert.deepEqual(got.partials, ["light the "]);
    assert.deepEqual(got.finals, ["light the candles"]);

    // Routine pauses stay silent; real failures surface with an stt_ code.
    recognition.onerror({ error: "no-speech" });
    recognition.onerror({ error: "aborted" });
    assert.deepEqual(got.errors, []);
    recognition.onerror({ error: "audio-capture" });
    assert.deepEqual(got.errors, ["stt_audio-capture"]);
  });
});
