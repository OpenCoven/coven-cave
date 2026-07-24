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
import { encodePcmWav, resampleMonoPcm, sidecarWhisperAvailable } from "./sidecar-whisper-ears.ts";

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
    ok: true, stt: [{ engine: "whisper", ready: true }],
  }))), true);
  assert.equal(await sidecarWhisperAvailable(async () => new Response(JSON.stringify({
    ok: true, stt: [{ engine: "whisper", ready: false }],
  }))), false);
  assert.equal(await sidecarWhisperAvailable(async () => new Response("nope", { status: 503 })), false);
});
