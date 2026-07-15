// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSpeechLoop,
  createSentenceChunker,
  MIN_SPOKEN_SENTENCE_CHARS,
} from "./speech-loop.ts";

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

// ── The loop itself, driven by fake ears and a fake mouth ───────────────────

function fakeMic() {
  const track = { enabled: true, stop() { this.stopped = true; } };
  return { getAudioTracks: () => [track], track };
}

function collectCallbacks(events) {
  return {
    onUserTranscriptFinal: (t) => events.push(`user:${t}`),
    onAssistantTranscriptFinal: (t) => events.push(`assistant:${t}`),
    onPartialTranscript: (role, t) => events.push(`partial:${role}:${t}`),
    onError: (e) => events.push(`error:${e.message}`),
    onDisconnect: () => events.push("disconnect"),
  };
}

const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

test("connectSpeechLoop rejects stt_unavailable where no engine exists", async () => {
  // Node has no window: Web Speech resolves null and the native macOS
  // candidate check is false, so the default ears chain comes up empty.
  await assert.rejects(
    connectSpeechLoop({
      mic: fakeMic(),
      callbacks: collectCallbacks([]),
      brain: async () => "",
      brainErrorCode: "brain_failed",
      brainErrorHint: "hint",
    }),
    (err) => err.name === "VoiceConnectError" && err.message === "stt_unavailable",
  );
});

test("loop wires ears finals through the brain and half-duplexes the ears", async () => {
  const events = [];
  const log = [];
  let earsCallbacks = null;
  const mic = fakeMic();

  const session = await connectSpeechLoop({
    mic,
    mouth: {
      speak: async (text) => { log.push(`speak:${text}`); },
      cancel: () => log.push("mouth:cancel"),
    },
    ears: (_mic, cb) => {
      earsCallbacks = cb;
      return {
        start: () => log.push("ears:start"),
        stop: () => log.push("ears:stop"),
        close: () => log.push("ears:close"),
      };
    },
    callbacks: collectCallbacks(events),
    brain: async (userText, speak) => {
      const reply = `echo ${userText}`;
      speak(reply);
      return reply;
    },
    brainErrorCode: "brain_failed",
    brainErrorHint: "hint",
  });

  // Connect started the ears listening.
  assert.deepEqual(log, ["ears:start"]);

  earsCallbacks.onFinal("hello cave");
  await settle();

  assert.deepEqual(events, [
    "user:hello cave",
    "assistant:echo hello cave",
  ]);
  // Half-duplex: the ears hushed before the mouth spoke, and resumed after
  // the utterance queue drained.
  assert.deepEqual(log, [
    "ears:start",
    "ears:stop",
    "speak:echo hello cave",
    "ears:start",
  ]);

  await session.close();
  assert.ok(log.includes("ears:close"));
  assert.ok(log.includes("mouth:cancel"));
  assert.equal(mic.track.stopped, true);
});

test("loop surfaces ears errors without ending the call, and mute hushes", async () => {
  const events = [];
  const log = [];
  let earsCallbacks = null;
  const mic = fakeMic();

  const session = await connectSpeechLoop({
    mic,
    mouth: { speak: async () => {}, cancel: () => {} },
    ears: (_mic, cb) => {
      earsCallbacks = cb;
      return {
        start: () => log.push("start"),
        stop: () => log.push("stop"),
        close: () => log.push("close"),
      };
    },
    callbacks: collectCallbacks(events),
    brain: async (t) => t,
    brainErrorCode: "brain_failed",
    brainErrorHint: "hint",
  });

  const { VoiceConnectError } = await import("./types.ts");
  earsCallbacks.onError(new VoiceConnectError("stt_recognition_failed", "boom"));
  assert.deepEqual(events, ["error:stt_recognition_failed"]);

  session.setMuted(true);
  assert.equal(mic.track.enabled, false);
  assert.equal(log.at(-1), "stop");
  // While muted, listen() refuses to restart the ears.
  session.setMuted(false);
  assert.equal(log.at(-1), "start");

  await session.close();
  // Finals after close are ignored.
  earsCallbacks.onFinal("too late");
  await settle();
  assert.ok(!events.some((e) => e === "user:too late"));
});
