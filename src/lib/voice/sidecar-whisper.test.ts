// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_WHISPER_WAV_BYTES,
  SidecarWhisperError,
  transcribeSidecarWav,
  whisperCliArgs,
  whisperCliCommand,
} from "./sidecar-whisper.ts";
import {
  createSidecarWhisperEars,
  encodePcmWav,
  resampleMonoPcm,
  sidecarWhisperAvailable,
} from "./sidecar-whisper-ears.ts";

const cacheRoot = path.join(process.cwd(), "node_modules", ".cache", "coven-cave-tests", "sidecar-whisper");

test("the sidecar selects only an explicit Whisper runtime override", () => {
  assert.equal(whisperCliCommand({}), "whisper-cli");
  assert.equal(whisperCliCommand({ COVEN_WHISPER_CPP_BIN: " /opt/whisper-cli " }), "/opt/whisper-cli");
  assert.deepEqual(
    whisperCliArgs("model.bin", "input.wav", "output", "en-US"),
    ["-m", "model.bin", "-f", "input.wav", "-otxt", "-of", "output", "-l", "en-US"],
  );
});

test("transcription stages a WAV privately, reads whisper.cpp text, and removes it", async () => {
  await mkdir(cacheRoot, { recursive: true });
  let seenArgs = [];
  const text = await transcribeSidecarWav(new Uint8Array([1, 2, 3]), {
    id: "whisper-tiny-en", name: "Whisper tiny.en", path: "model.bin",
  }, {
    tempRoot: cacheRoot,
    run: async (_command, args) => {
      seenArgs = args;
      const wav = await readFile(args[3]);
      assert.deepEqual([...wav], [1, 2, 3]);
      await writeFile(`${args[args.indexOf("-of") + 1]}.txt`, "  hello from Whisper  \n");
    },
  });
  assert.equal(text, "hello from Whisper");
  assert.deepEqual(seenArgs.slice(0, 6), ["-m", "model.bin", "-f", seenArgs[3], "-otxt", "-of"]);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(cacheRoot), []);
  await rm(cacheRoot, { recursive: true, force: true });
});

test("transcription rejects oversized input before creating a subprocess", async () => {
  await assert.rejects(
    () => transcribeSidecarWav(new Uint8Array(MAX_WHISPER_WAV_BYTES + 1), {
      id: "whisper-tiny-en", name: "Whisper tiny.en", path: "model.bin",
    }),
    (error) => error instanceof SidecarWhisperError && error.code === "whisper_failed",
  );
});

test("transcription forwards cancellation to its Whisper runner", async () => {
  const controller = new AbortController();
  let receivedSignal;
  await mkdir(cacheRoot, { recursive: true });
  await assert.rejects(
    () => transcribeSidecarWav(new Uint8Array([1]), {
      id: "whisper-tiny-en", name: "Whisper tiny.en", path: "model.bin",
    }, {
      tempRoot: cacheRoot,
      signal: controller.signal,
      run: async (_command, _args, signal) => {
        receivedSignal = signal;
        throw new SidecarWhisperError("whisper_failed", "cancelled");
      },
    }),
    /whisper_failed/,
  );
  assert.equal(receivedSignal, controller.signal);
  await rm(cacheRoot, { recursive: true, force: true });
});

test("PCM capture serializes as a standard mono 16-bit WAV", () => {
  const wav = encodePcmWav([new Float32Array([-1, 0, 1])], 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44, true), -32_768);
  assert.equal(view.getInt16(48, true), 32_767);
});

test("browser PCM is downsampled to whisper.cpp's 16 kHz input", () => {
  const output = resampleMonoPcm([new Float32Array([0, 0.5, 1, 0.5])], 32_000);
  assert.equal(output.length, 2);
  assert.deepEqual([...output], [0, 1]);
});

test("sidecar availability requires a verified ready Whisper model", async () => {
  assert.equal(await sidecarWhisperAvailable(async () => new Response(JSON.stringify({
    ok: true, runtimes: { whisper: { available: true } }, stt: [{ engine: "whisper", ready: true }],
  }))), true);
  assert.equal(await sidecarWhisperAvailable(async () => new Response(JSON.stringify({
    ok: true, runtimes: { whisper: { available: true } }, stt: [{ engine: "whisper", ready: false }],
  }))), false);
  assert.equal(await sidecarWhisperAvailable(async () => new Response(JSON.stringify({
    ok: true, runtimes: { whisper: { available: false } }, stt: [{ engine: "whisper", ready: true }],
  }))), false);
  assert.equal(await sidecarWhisperAvailable(async () => new Response("nope", { status: 503 })), false);
});

function fakeTimers() {
  let next = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++next; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    pendingIds(ms) {
      return [...pending.entries()].filter(([, value]) => value.ms === ms).map(([id]) => id);
    },
    fire(ms) {
      const entry = [...pending.entries()].find(([, value]) => value.ms === ms);
      assert.ok(entry, `missing timer ${ms}`);
      pending.delete(entry[0]);
      entry[1].fn();
    },
  };
}

test("initial silence is capped, discarded, and restarted without a Whisper request", () => {
  const priorWindow = globalThis.window;
  const timers = fakeTimers();
  const processors = [];
  const filters = [];
  let closes = 0;
  class AudioContext {
    sampleRate = 48_000;
    state = "running";
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBiquadFilter() {
      const filter = {
        connect() {}, disconnect() {}, type: "", frequency: { value: 0 }, Q: { value: 0 },
      };
      filters.push(filter);
      return filter;
    }
    createScriptProcessor() {
      const processor = { connect() {}, disconnect() {}, onaudioprocess: null };
      processors.push(processor);
      return processor;
    }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
    resume() { return Promise.resolve(); }
    close() { closes += 1; this.state = "closed"; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext };
  let requests = 0;
  const ears = createSidecarWhisperEars({
    maxUtteranceMs: 99,
    fetchImpl: async () => { requests += 1; return new Response("{}"); },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })({ onPartial() {}, onFinal() {}, onError() {} }, {});
  try {
    ears.listen();
    assert.equal(filters[0].type, "lowpass");
    assert.equal(filters[0].frequency.value, 7_200, "filter is applied before 16 kHz downsampling");
    processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
    timers.fire(99);
    assert.equal(closes, 1, "silent capture releases its first audio context");
    assert.equal(requests, 0, "silent capture never submits a WAV");
    assert.equal(processors.length, 2, "ears restart listening after the empty cap");
  } finally {
    ears.close();
    globalThis.window = priorWindow;
  }
});

test("voice activity receives a full utterance cap after initial silence", () => {
  const priorWindow = globalThis.window;
  const timers = fakeTimers();
  const processors = [];
  class AudioContext {
    sampleRate = 48_000;
    state = "running";
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBiquadFilter() { return { connect() {}, disconnect() {}, type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createScriptProcessor() { const processor = { connect() {}, disconnect() {}, onaudioprocess: null }; processors.push(processor); return processor; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext };
  const ears = createSidecarWhisperEars({
    maxUtteranceMs: 99,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, session: 1, kind: "final", text: "heard" })),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })({ onPartial() {}, onFinal() {}, onError() {} }, {});
  try {
    ears.listen();
    const initialTimer = timers.pendingIds(99)[0];
    processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.1) } });
    const utteranceTimer = timers.pendingIds(99)[0];
    assert.notEqual(utteranceTimer, initialTimer, "speech replaces the initial-silence timer with a full utterance cap");
  } finally {
    ears.close();
    globalThis.window = priorWindow;
  }
});
