// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LocalTtsSynthesisError,
  runPiper,
} from "./local-tts-server.ts";

test("Piper runner reports a missing local engine actionably", async () => {
  await assert.rejects(
    () => runPiper("voice.onnx", "Hello locally."),
    (error) =>
      error instanceof LocalTtsSynthesisError &&
      error.code === "local_tts_engine_unavailable" &&
      /PATH/.test(error.message),
  );
});

test("Piper runner writes bounded temporary WAV output and always cleans it", () => {
  const source = readFileSync(
    new URL("./local-tts-server.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /\["-m", modelPath, "-f", outputPath, "--", text\]/,
    "the Piper CLI receives the verified model path and writes WAV output",
  );
  assert.match(source, /MAX_AUDIO_BYTES/);
  assert.match(source, /await rm\([^)]*outputPath, \{ force: true \}\)/);
  assert.match(source, /signal\?\.addEventListener\("abort", abort/);
  assert.match(source, /!key\.startsWith\("COVEN_CAVE_"\)/);
  assert.match(source, /FORBIDDEN_SPAWN_ENV_KEYS/);
});
