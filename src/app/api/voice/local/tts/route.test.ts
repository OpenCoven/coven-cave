// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalTtsSynthesisError } from "../../../../../lib/voice/local-tts-server.ts";
import {
  handleLocalTtsPost,
  LOCAL_TTS_MAX_BODY_BYTES,
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
  assert.equal((await handleLocalTtsPost(request("null"))).status, 400);
  assert.equal((await handleLocalTtsPost(request("[]"))).status, 400);
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
  let runnerCalled = false;
  const unregistered = await handleLocalTtsPost(
    request({ text: "hello", voiceName: "piper-not-in-the-registry" }),
    {
      readiness: async () => readyVoice,
      piper: async () => {
        runnerCalled = true;
        return new Uint8Array([82, 73, 70, 70]);
      },
    },
  );
  assert.equal(unregistered.status, 400);
  assert.equal((await unregistered.json()).error, "invalid_voice_name");
  assert.equal(runnerCalled, false);
  const extraField = await handleLocalTtsPost(
    request({ text: "hello", voiceName: readyVoice.id, modelPath: "C:\\untrusted.onnx" }),
  );
  assert.equal(extraField.status, 400);
  assert.equal((await extraField.json()).error, "invalid_request");
  assert.equal(
    (await handleLocalTtsPost(new Request("http://test/api/voice/local/tts", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ text: "hello", voiceName: readyVoice.id }),
    }))).status,
    415,
  );
  assert.equal(
    (await handleLocalTtsPost(new Request("http://test/api/voice/local/tts", {
      method: "POST",
      headers: { "content-type": "application/jsonp" },
      body: JSON.stringify({ text: "hello", voiceName: readyVoice.id }),
    }))).status,
    415,
  );
});

test("POST local TTS bounds declared and streamed request bodies before JSON parsing", async () => {
  const declaredTooLarge = await handleLocalTtsPost(new Request("http://test/api/voice/local/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(LOCAL_TTS_MAX_BODY_BYTES + 1),
    },
    body: "{}",
  }));
  assert.equal(declaredTooLarge.status, 413);
  assert.equal((await declaredTooLarge.json()).error, "payload_too_large");

  const streamedTooLarge = await handleLocalTtsPost(new Request("http://test/api/voice/local/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(LOCAL_TTS_MAX_BODY_BYTES + 1)));
        controller.close();
      },
    }),
    duplex: "half",
  }));
  assert.equal(streamedTooLarge.status, 413);
  assert.equal((await streamedTooLarge.json()).error, "payload_too_large");
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
  assert.equal(unknown.status, 409);
  assert.equal((await unknown.json()).error, "local_voice_not_ready");

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
    request({ text: "hello", voiceName: readyVoice.id }),
    {
      readiness: async () => ({
        ...readyVoice,
        engine: "espeak",
      }),
    },
  );
  assert.equal(unsupported.status, 503);
  assert.equal(
    (await unsupported.json()).error,
    "local_tts_engine_unavailable",
  );
});

test("POST local TTS dispatches Kokoro voices with their positional companions", async () => {
  let invocation = null;
  const req = request({ text: "  Hello locally.  ", voiceName: "kokoro-en-v0-19" });
  const res = await handleLocalTtsPost(
    req,
    {
      readiness: async (voiceName) => {
        assert.equal(voiceName, "kokoro-en-v0-19");
        return {
          ...readyVoice,
          id: "kokoro-en-v0-19",
          engine: "kokoro",
          // Registry order contract: [voices.bin, tokens.txt].
          companionPaths: ["C:\\voice-models\\voices.bin", "C:\\voice-models\\tokens.txt"],
        };
      },
      kokoro: async (assets, text, signal) => {
        invocation = { assets, text, signal };
        return new Uint8Array([82, 73, 70, 70]);
      },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  assert.deepEqual(invocation, {
    assets: {
      modelPath: readyVoice.path,
      voicesPath: "C:\\voice-models\\voices.bin",
      tokensPath: "C:\\voice-models\\tokens.txt",
      // kokoroSpeakerId comes from the reviewed registry entry, not readiness.
      speakerId: 0,
    },
    text: "Hello locally.",
    signal: req.signal,
  });
});

test("POST local TTS refuses a Kokoro voice whose companions are missing", async () => {
  let ran = false;
  const res = await handleLocalTtsPost(
    request({ text: "hello", voiceName: "kokoro-en-v0-19" }),
    {
      readiness: async () => ({
        ...readyVoice,
        id: "kokoro-en-v0-19",
        engine: "kokoro",
        companionPaths: ["C:\\voice-models\\voices.bin"],
      }),
      kokoro: async () => {
        ran = true;
        return new Uint8Array([82]);
      },
    },
  );
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "local_voice_not_ready");
  assert.equal(ran, false, "an incomplete Kokoro bundle must never reach the runner");
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

test("POST local TTS routes a derived named speaker to the shared bundle with its sid", async () => {
  let invocation = null;
  const req = request({ text: "Hello Emma.", voiceName: "kokoro-en-v0-19-emma" });
  const res = await handleLocalTtsPost(
    req,
    {
      readiness: async (voiceName) => {
        // The dependency still receives the SELECTED name; resolution to the
        // shared base bundle is the route's job (cave-xopgb).
        assert.equal(voiceName, "kokoro-en-v0-19-emma");
        return {
          ...readyVoice,
          id: "kokoro-en-v0-19",
          engine: "kokoro",
          companionPaths: ["C:\\voice-models\\voices.bin", "C:\\voice-models\\tokens.txt"],
        };
      },
      kokoro: async (assets, text, signal) => {
        invocation = { assets, text, signal };
        return new Uint8Array([82, 73, 70, 70]);
      },
    },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(invocation.assets, {
    modelPath: readyVoice.path,
    voicesPath: "C:\\voice-models\\voices.bin",
    tokensPath: "C:\\voice-models\\tokens.txt",
    // sid 7 = bf_emma in the sherpa-onnx voices.bin generation order.
    speakerId: 7,
  });
});

test("POST local TTS rejects an unknown derived Kokoro speaker", async () => {
  const res = await handleLocalTtsPost(
    request({ text: "hello", voiceName: "kokoro-en-v0-19-nonexistent" }),
    {
      readiness: async () => {
        assert.fail("an unregistered speaker must never reach readiness");
      },
    },
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_voice_name");
});
