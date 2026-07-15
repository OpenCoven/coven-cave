// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVadGate,
  parseNativeSttError,
  pickRecorderMime,
  RECORDER_MIME_CANDIDATES,
  nativeMacSttCandidate,
  VAD_DEFAULTS,
} from "./native-mac-ears.ts";

// ── VAD gate ────────────────────────────────────────────────────────────────

const QUIET = 0.001;
const LOUD = 0.05;

test("vad gate stays idle below the speech threshold", () => {
  const gate = createVadGate();
  assert.equal(gate.push(QUIET, 0), "idle");
  assert.equal(gate.push(VAD_DEFAULTS.speechRms - 0.001, 100), "idle");
});

test("vad gate ends an utterance after the hangover and keeps real speech", () => {
  const gate = createVadGate({ hangoverMs: 900, minSpeechMs: 250 });
  assert.equal(gate.push(LOUD, 0), "speaking");
  assert.equal(gate.push(LOUD, 300), "speaking");
  // Silence begins; the gate waits out the hangover…
  assert.equal(gate.push(QUIET, 600), "speaking");
  assert.equal(gate.push(QUIET, 1100), "speaking");
  // …and ends the utterance once 900ms of silence has passed. 300ms of
  // voiced span ≥ minSpeechMs, so the segment is kept.
  assert.equal(gate.push(QUIET, 1300), "end");
  // The gate is reset — quiet is idle again.
  assert.equal(gate.push(QUIET, 1400), "idle");
});

test("vad gate discards blips shorter than minSpeechMs", () => {
  const gate = createVadGate({ hangoverMs: 900, minSpeechMs: 250 });
  assert.equal(gate.push(LOUD, 0), "speaking");
  // Instant silence: the only voiced sample was at t=0 (span 0 < 250).
  assert.equal(gate.push(QUIET, 100), "speaking");
  assert.equal(gate.push(QUIET, 950), "end-discard");
});

test("vad gate hysteresis: mid-band energy keeps an utterance alive", () => {
  const gate = createVadGate({ speechRms: 0.02, silenceRms: 0.012, hangoverMs: 500, minSpeechMs: 100 });
  assert.equal(gate.push(0.03, 0), "speaking");
  // 0.015 is below the enter threshold but above the stay threshold —
  // it refreshes lastVoice, so no hangover accumulates.
  assert.equal(gate.push(0.015, 400), "speaking");
  assert.equal(gate.push(0.015, 800), "speaking");
  assert.equal(gate.push(0.001, 1250), "speaking");
  assert.equal(gate.push(0.001, 1350), "end");
});

test("vad gate hard-cuts utterances at maxUtteranceMs", () => {
  const gate = createVadGate({ maxUtteranceMs: 45_000 });
  assert.equal(gate.push(LOUD, 0), "speaking");
  assert.equal(gate.push(LOUD, 44_900), "speaking");
  assert.equal(gate.push(LOUD, 45_000), "end");
});

test("vad gate reset abandons an in-flight utterance", () => {
  const gate = createVadGate();
  assert.equal(gate.push(LOUD, 0), "speaking");
  gate.reset();
  assert.equal(gate.push(QUIET, 100), "idle");
});

// ── Recorder mime selection ─────────────────────────────────────────────────

test("pickRecorderMime returns the first container the recorder supports", () => {
  assert.equal(
    pickRecorderMime((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    pickRecorderMime(() => true),
    RECORDER_MIME_CANDIDATES[0],
  );
  assert.equal(pickRecorderMime(() => false), null);
  // A throwing probe counts as unsupported, not a crash.
  assert.equal(
    pickRecorderMime((t) => {
      if (t !== "audio/wav") throw new Error("nope");
      return true;
    }),
    "audio/wav",
  );
});

test("webm is never a candidate — AVFoundation cannot open it", () => {
  assert.ok(RECORDER_MIME_CANDIDATES.every((t) => !t.includes("webm")));
});

// ── Native error parsing ────────────────────────────────────────────────────

test("parseNativeSttError splits machine code from human hint", () => {
  const err = parseNativeSttError(
    "stt_on_device_unsupported: this Mac cannot transcribe this language on-device",
  );
  assert.equal(err.message, "stt_on_device_unsupported");
  assert.equal(err.hint, "this Mac cannot transcribe this language on-device");
});

test("parseNativeSttError wraps shapeless messages as stt_native_failed", () => {
  const err = parseNativeSttError("Something exploded in the WebView");
  assert.equal(err.message, "stt_native_failed");
  assert.equal(err.hint, "Something exploded in the WebView");
  assert.equal(parseNativeSttError("").hint, undefined);
});

// ── Candidate detection ─────────────────────────────────────────────────────

test("nativeMacSttCandidate is false outside a window (SSR / node)", () => {
  assert.equal(nativeMacSttCandidate(), false);
});
