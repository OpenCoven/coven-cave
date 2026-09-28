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

/** A mouth that parks mid-utterance until interrupted or released — the shape
 *  barge-in actually has to work against. */
function deferredMouth() {
  const spoken = [];
  let release = null;
  return {
    spoken,
    release: () => { const r = release; release = null; r?.(); },
    mouth: {
      speak(text) {
        spoken.push(text);
        return new Promise((resolve) => { release = resolve; });
      },
      cancel() {
        spoken.push("<cancel>");
        const r = release;
        release = null;
        r?.();
      },
      interrupt() {
        spoken.push("<interrupt>");
        const r = release;
        release = null;
        r?.();
      },
    },
  };
}

function loopFixture({ brain, earsEngine, mouthEngine, mouth: injected, onError } = {}) {
  const ears = fakeEars();
  const mic = fakeMic();
  const mouth = injected ?? fakeMouth();
  const events = { userFinals: [], assistantFinals: [], errors: [], speaking: [] };
  const session = connectSpeechLoop({
    mic: mic.stream,
    ears: ears.factory,
    earsEngine,
    mouth: mouth.mouth,
    mouthEngine,
    callbacks: {
      onUserTranscriptFinal: (t) => events.userFinals.push(t),
      onAssistantTranscriptFinal: (t) => events.assistantFinals.push(t),
      onPartialTranscript: () => {},
      onSpeaking: (utterance) => events.speaking.push(utterance),
      onError: (err) => { events.errors.push(err); onError?.(err); },
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

function preparableMouth() {
  const mouth = deferredMouth();
  const prepared = [];
  mouth.mouth.prepare = (text) => {
    const entry = { text, played: false, cancelled: false };
    prepared.push(entry);
    return {
      speak() { entry.played = true; return mouth.mouth.speak(text); },
      cancel() { entry.cancelled = true; },
    };
  };
  return { ...mouth, prepared };
}

test("prepares only the next utterance while speaking and plays prepared speech in order", async () => {
  const mouth = preparableMouth();
  const { ears, session } = loopFixture({ mouth, brain: async (_text, speak) => {
    for (const sentence of ["One.", "Two.", "Three.", "Four."]) speak(sentence);
    return "One. Two. Three. Four.";
  } });
  try {
    ears.handlers.onFinal("count");
    await tick();
    assert.deepEqual(mouth.spoken, ["One."]);
    assert.deepEqual(mouth.prepared.map(entry => entry.text), ["Two."]);
    assert.equal(mouth.prepared[0].played, false, "lookahead does not play overlapping audio");
    mouth.release();
    await tick();
    assert.deepEqual(mouth.spoken, ["One.", "Two."]);
    assert.equal(mouth.prepared[0].played, true, "consume the existing preparation");
    assert.deepEqual(mouth.prepared.map(entry => entry.text), ["Two.", "Three."]);
    mouth.release();
    await tick();
    assert.deepEqual(mouth.spoken, ["One.", "Two.", "Three."]);
    assert.deepEqual(mouth.prepared.map(entry => entry.text), ["Two.", "Three.", "Four."]);
    mouth.release();
    await tick();
    mouth.release();
    await tick();
    assert.deepEqual(mouth.spoken, ["One.", "Two.", "Three.", "Four."]);
  } finally { await session.close(); }
});

for (const action of ["interrupt", "close"]) {
  test(`${action} cancels prepared speech and drops queued utterances`, async () => {
    const mouth = preparableMouth();
    const { ears, session } = loopFixture({ mouth, brain: async (_text, speak) => {
      speak("One."); speak("Two."); speak("Three.");
      return "One. Two. Three.";
    } });
    ears.handlers.onFinal("count");
    await tick();
    assert.equal(mouth.prepared.length, 1);
    await session[action]();
    await tick();
    assert.equal(mouth.prepared[0].cancelled, true);
    assert.deepEqual(mouth.spoken.filter(text => !text.startsWith("<")), ["One."]);
    await session.close();
  });
}

test("a playback failure cancels the speculative request before continuing the queue", async () => {
  const mouth = preparableMouth();
  let rejectFirst;
  const speak = mouth.mouth.speak;
  mouth.mouth.speak = text => text === "One."
    ? new Promise((_resolve, reject) => { rejectFirst = reject; })
    : speak(text);
  const { ears, events, session } = loopFixture({ mouth, brain: async (_text, emit) => {
    emit("One."); emit("Two."); return "One. Two.";
  } });
  try {
    ears.handlers.onFinal("count");
    await tick();
    rejectFirst(new VoiceConnectError("audio_playback_failed"));
    await tick();
    assert.equal(mouth.prepared[0]?.cancelled, true);
    assert.equal(mouth.prepared[0].played, false, "a cancelled preparation cannot be consumed");
    assert.deepEqual(events.errors.map(error => error.message), ["audio_playback_failed"]);
    assert.deepEqual(mouth.spoken, ["Two."]);
  } finally { await session.close(); }
});

test("late failure from interrupted playback does not report against the new turn", async () => {
  let rejectFirst;
  const { ears, events, session } = loopFixture({ mouth: { mouth: {
    speak: text => text === "first" ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve(),
    cancel() {}, interrupt() {},
  } }, brain: async (text, speak) => { speak(text); return text; } });
  ears.handlers.onFinal("first");
  await tick();
  session.sendText("second");
  rejectFirst(new VoiceConnectError("old_audio_failure"));
  await tick();
  assert.deepEqual(events.errors, []);
  assert.deepEqual(events.assistantFinals, ["first", "second"]);
  await session.close();
});

for (const error of [new VoiceConnectError("old_brain_failure"), new Error("late runtime failure")]) {
  test(`an interrupted brain's ${error.name} cannot fail the call or block the newer reply`, async () => {
    let rejectFirst;
    const calls = [];
    const { events, session } = loopFixture({ brain: async (text, speak) => {
      calls.push(text);
      if (text === "first") await new Promise((_resolve, reject) => { rejectFirst = reject; });
      speak(`heard: ${text}`);
      return `heard: ${text}`;
    } });
    try {
      session.sendText("first");
      session.sendText("second");
      assert.deepEqual(calls, ["first"], "the newer reply waits for the active brain turn");
      rejectFirst(error);
      await tick();
      assert.deepEqual(events.errors, [], "a superseded turn must not send PROVIDER_ERROR to the overlay");
      assert.deepEqual(calls, ["first", "second"]);
      assert.deepEqual(events.assistantFinals, ["heard: second"]);
    } finally { await session.close(); }
  });
}

for (const error of [new VoiceConnectError("current_brain_failure"), new Error("runtime failure")]) {
  test(`a current brain's ${error.name} still reports and releases its queued user turn`, async () => {
    let rejectFirst;
    const { ears, events, session } = loopFixture({ brain: async (text, speak) => {
      if (text === "first") await new Promise((_resolve, reject) => { rejectFirst = reject; });
      speak(`heard: ${text}`);
      return `heard: ${text}`;
    } });
    try {
      ears.handlers.onFinal("first");
      // Recognition finals queue without barge-in, so this is a current error.
      ears.handlers.onFinal("second");
      rejectFirst(error);
      await tick();
      assert.deepEqual(events.errors.map(value => value.message), [
        error instanceof VoiceConnectError ? "current_brain_failure" : "test_brain_failed",
      ]);
      assert.deepEqual(events.assistantFinals, ["heard: second"]);
    } finally { await session.close(); }
  });
}

test("closing on a current brain error stops active speech and discards prepared and queued speech", async () => {
  const mouth = preparableMouth();
  let rejectBrain;
  const { ears, events, session } = loopFixture({ mouth,
    onError: () => { void session.close(); },
    brain: async (_text, speak) => {
      speak("Active."); speak("Prepared."); speak("Queued.");
      await new Promise((_resolve, reject) => { rejectBrain = reject; });
      return "";
    },
  });
  ears.handlers.onFinal("start");
  await tick();
  rejectBrain(new VoiceConnectError("familiar_brain_failed"));
  await tick();
  assert.deepEqual(events.errors.map(error => error.message), ["familiar_brain_failed"]);
  assert.equal(mouth.prepared[0].cancelled, true);
  assert.deepEqual(mouth.spoken, ["Active.", "<cancel>"]);
  assert.equal(ears.log.at(-1), "close");
});

test("loop transcript keys reconcile a typed interruption with the earlier streamed reply", async () => {
  const { applyPartial, applyFinal, emptyTranscript } = await import("./call-transcript.ts");
  let transcript = emptyTranscript;
  const ears = fakeEars();
  let finish;
  const callbacks = {
    onUserTranscriptFinal(text, key) { transcript = applyFinal(transcript, "user", text, key); },
    onAssistantTranscriptFinal(text, key) { transcript = applyFinal(transcript, "assistant", text, key); },
    onPartialTranscript(role, text, key) { transcript = applyPartial(transcript, role, text, key); },
    onError() {}, onDisconnect() {},
  };
  const session = connectSpeechLoop({
    mic: fakeMic().stream, ears: ears.factory, callbacks,
    mouth: { speak: async () => {}, cancel() {}, interrupt() {} },
    brain: async (text, _speak, key) => {
      callbacks.onPartialTranscript("assistant", `Answer ${text}`, key);
      if (text === "first") await new Promise(resolve => { finish = resolve; });
      return `Answer ${text}.`;
    },
    brainErrorCode: "test", brainErrorHint: "test",
  });
  ears.handlers.onPartial("first");
  ears.handlers.onFinal("first");
  session.sendText("second");
  finish();
  await tick();
  assert.deepEqual(transcript.turns.map(t => [t.role, t.text, t.final]), [
    ["user", "first", true], ["assistant", "Answer first.", true],
    ["user", "second", true], ["assistant", "Answer second.", true],
  ]);
  await session.close();
});

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

test("the session reports how it hears from the supplied ears' label (cave-vpe1)", () => {
  // Injected ears (the native engine) surface the resolver's engine label…
  const native = loopFixture({ earsEngine: "native-on-device" });
  assert.equal(native.session.earsEngine, "native-on-device");
  const dictation = loopFixture({ earsEngine: "native-dictation" });
  assert.equal(dictation.session.earsEngine, "native-dictation");
  // …and injected ears without a label stay unlabeled rather than lying.
  const unlabeled = loopFixture();
  assert.equal(unlabeled.session.earsEngine, undefined);
});

test("the session reports how it speaks from the supplied mouth's label (cave-vony)", () => {
  // Injected mouths surface the provider's engine label…
  const piper = loopFixture({ mouthEngine: "sidecar-piper" });
  assert.equal(piper.session.mouthEngine, "sidecar-piper");
  const eleven = loopFixture({ mouthEngine: "elevenlabs" });
  assert.equal(eleven.session.mouthEngine, "elevenlabs");
  // …and injected mouths without a label stay unlabeled rather than lying.
  const unlabeled = loopFixture();
  assert.equal(unlabeled.session.mouthEngine, undefined);
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

// ── Live transcript, highlight, and typed replies (cave-zr9dx) ─────────────

test("each queued utterance is announced as it starts and silence on drain", async () => {
  const { ears, events } = loopFixture({
    brain: async (userText, speak) => {
      speak("First sentence out loud.");
      speak("Second sentence out loud.");
      return "First sentence out loud. Second sentence out loud.";
    },
  });
  ears.handlers.onFinal("say two things");
  await tick();
  await tick();
  await tick();

  // The highlight follows the QUEUE, one sentence at a time, then clears —
  // that is what lets the overlay mark only the words being heard.
  assert.deepEqual(events.speaking, [
    "First sentence out loud.",
    "Second sentence out loud.",
    null,
  ]);
});

test("a typed reply becomes a real turn and barges in on the synthesizer", async () => {
  const mouth = deferredMouth();
  const { ears, events, session } = loopFixture({
    mouth,
    brain: async (userText, speak) => {
      const reply = `heard: ${userText}`;
      speak(reply);
      return reply;
    },
  });

  ears.handlers.onFinal("tell me a long story");
  await tick();
  await tick();
  assert.deepEqual(mouth.spoken, ["heard: tell me a long story"]);
  assert.equal(events.speaking[events.speaking.length - 1], "heard: tell me a long story");

  session.sendText("  actually, stop  ");
  await tick();
  await tick();
  await tick();

  // The utterance in flight is cut off, the highlight clears immediately, and
  // the typed text lands in the transcript exactly like a spoken final.
  assert.ok(mouth.spoken.includes("<interrupt>"), "the mouth was interrupted");
  assert.deepEqual(events.userFinals, ["tell me a long story", "actually, stop"]);
  assert.ok(events.speaking.includes(null), "the highlight cleared on barge-in");
  assert.ok(
    events.assistantFinals.includes("heard: actually, stop"),
    "the typed turn reached the brain",
  );
  assert.deepEqual(events.errors, []);
});

test("a blank typed reply is not a turn", async () => {
  let brainCalls = 0;
  const { events, session } = loopFixture({
    brain: async () => { brainCalls += 1; return ""; },
  });
  session.sendText("   ");
  await tick();
  assert.equal(brainCalls, 0);
  assert.deepEqual(events.userFinals, []);
});

test("interrupt drops the queue behind the current utterance and hands the floor back", async () => {
  const mouth = deferredMouth();
  const { ears, events, session } = loopFixture({
    mouth,
    brain: async (userText, speak) => {
      speak("One.");
      speak("Two.");
      speak("Three.");
      return "One. Two. Three.";
    },
  });
  ears.handlers.onFinal("count");
  await tick();
  await tick();
  assert.deepEqual(mouth.spoken, ["One."]);

  session.interrupt();
  await tick();
  await tick();

  // Only the sentence already in flight was ever voiced; the rest is dropped
  // and the ears are listening again.
  assert.deepEqual(mouth.spoken.filter((s) => !s.startsWith("<")), ["One."]);
  assert.equal(events.speaking[events.speaking.length - 1], null);
  assert.equal(ears.log[ears.log.length - 1], "listen");
});

test("a typed reply still works while the mic is muted", async () => {
  const { events, session } = loopFixture();
  session.setMuted(true);
  session.sendText("typing instead");
  await tick();
  await tick();
  assert.deepEqual(events.userFinals, ["typing instead"]);
  assert.deepEqual(events.assistantFinals, ["heard: typing instead"]);
});

test("a closed session ignores typed replies", async () => {
  const { events, session } = loopFixture();
  await session.close();
  session.sendText("too late");
  await tick();
  assert.deepEqual(events.userFinals, []);
});

test("a barged-in brain cannot refill the queue it was cut off from", async () => {
  const mouth = deferredMouth();
  let emit = null;
  const { ears, session } = loopFixture({
    mouth,
    // A streaming brain: it keeps producing sentences after the barge-in.
    brain: async (userText, speak) => {
      speak("Once upon a time.");
      await new Promise((resolve) => { emit = () => { speak("And then more."); resolve(); }; });
      return "Once upon a time. And then more.";
    },
  });
  ears.handlers.onFinal("tell me a story");
  await tick();
  await tick();
  assert.deepEqual(mouth.spoken, ["Once upon a time."]);

  session.interrupt();
  await tick();
  emit();
  await tick();
  await tick();

  // The sentence the muzzled turn emitted after the interrupt is dropped —
  // otherwise the familiar talks over the person who just stopped it.
  assert.deepEqual(
    mouth.spoken.filter((s) => !s.startsWith("<")),
    ["Once upon a time."],
  );
});
