// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalTtsSynthesisError } from "../../../../../lib/voice/local-tts-server.ts";
import {
  handleLocalTtsPost,
  LOCAL_TTS_MAX_CHARS,
} from "./route.ts";

const readyVoice = {
  id: "piper-amy-medium-en-us",
  name: "Piper Amy medium en_US",
  engine: "piper",
  kind: "tts",
  url: "https://example.invalid/model.onnx",
  sha256: "a".repeat(64),
  sizeBytes: 10,
  license: "test",
  fileName: "model.onnx",
  ready: true,
  verified: true,
  diskSizeBytes: 10,
  path: "C:\\voice-models\\model.onnx",
};

function request(body, signal) {
  return new Request("http://test/api/voice/local/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

test("POST local TTS validates JSON, text, and local voice ids", async () => {
  assert.equal((await handleLocalTtsPost(request("{"))).status, 400);
  assert.equal(
    (await handleLocalTtsPost(request({ voiceName: readyVoice.id }))).status,
    400,
  );
  assert.equal(
    (
      await handleLocalTtsPost(
        request({
          text: "x".repeat(LOCAL_TTS_MAX_CHARS + 1),
          voiceName: readyVoice.id,
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleLocalTtsPost(
        request({ text: "hello", voiceName: "../../piper-amy" }),
      )
    ).status,
    400,
  );
});

test("POST local TTS selects a verified voice and returns Piper WAV audio", async () => {
  let invocation = null;
  const req = request({
    text: "  Hello locally.  ",
    voiceName: readyVoice.id,
  });
  const res = await handleLocalTtsPost(
    req,
    {
      readiness: async (voiceName) => {
        assert.equal(voiceName, readyVoice.id);
        return readyVoice;
      },
      piper: async (modelPath, text, signal) => {
        invocation = { modelPath, text, signal };
        return new Uint8Array([82, 73, 70, 70]);
      },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(invocation, {
    modelPath: readyVoice.path,
    text: "Hello locally.",
    signal: req.signal,
  });
  assert.deepEqual(
    [...new Uint8Array(await res.arrayBuffer())],
    [82, 73, 70, 70],
  );
});

test("POST local TTS rejects unknown, unready, and unsupported-engine voices", async () => {
  const unknown = await handleLocalTtsPost(
    request({ text: "hello", voiceName: readyVoice.id }),
    { readiness: async () => null },
  );
  assert.equal(unknown.status, 404);

  const unready = await handleLocalTtsPost(
    request({ text: "hello", voiceName: readyVoice.id }),
    {
      readiness: async () => ({
        ...readyVoice,
        ready: false,
        verified: false,
        missingReason: "missing",
      }),
    },
  );
  assert.equal(unready.status, 409);
  assert.equal((await unready.json()).error, "local_voice_not_ready");

  const unsupported = await handleLocalTtsPost(
    request({ text: "hello", voiceName: "kokoro-af-heart" }),
    {
      readiness: async () => ({
        ...readyVoice,
        id: "kokoro-af-heart",
        engine: "kokoro",
      }),
    },
  );
  assert.equal(unsupported.status, 503);
  assert.equal(
    (await unsupported.json()).error,
    "local_tts_engine_unavailable",
  );
});

test("POST local TTS preserves runner machine codes and hints", async () => {
  const res = await handleLocalTtsPost(
    request({ text: "hello", voiceName: readyVoice.id }),
    {
      readiness: async () => readyVoice,
      piper: async () => {
        throw new LocalTtsSynthesisError(
          "local_tts_engine_unavailable",
          "Install piper-tts or set COVEN_PIPER_BIN.",
        );
      },
    },
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: "local_tts_engine_unavailable",
    hint: "Install piper-tts or set COVEN_PIPER_BIN.",
  });
});
