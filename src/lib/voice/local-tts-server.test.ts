// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  LocalTtsSynthesisError,
  piperExecutable,
  piperSpawnEnv,
  runPiperWithDependencies,
} from "./local-tts-server.ts";

test("Piper runner reports a missing local engine actionably", async () => {
  const missingRunner = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })));
    return child;
  };
  await assert.rejects(
    () => runPiperWithDependencies("voice.onnx", "Hello locally.", undefined, { spawnImpl: missingRunner }),
    (error) =>
      error instanceof LocalTtsSynthesisError &&
      error.code === "local_tts_engine_unavailable",
  );
});

test("Piper runner sends text on stdin and cleans its bounded WAV output", async () => {
  let command = null;
  let argv = null;
  let options = null;
  let stdin = "";
  const fakeRunner = (receivedCommand, receivedArgs, receivedOptions) => {
    command = receivedCommand;
    argv = receivedArgs;
    options = receivedOptions;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk) => {
      stdin += chunk;
    });
    child.stdin.on("end", () => {
      writeFileSync(receivedArgs[receivedArgs.indexOf("-f") + 1], Buffer.from("RIFF"));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };

  const wav = await runPiperWithDependencies(
    "verified-voice.onnx",
    "Hello from Piper.",
    undefined,
    { spawnImpl: fakeRunner },
  );

  assert.equal(command, "piper");
  assert.deepEqual(argv.slice(0, 3), ["-m", "verified-voice.onnx", "-f"]);
  assert.equal(argv.length, 4, "the utterance is not an unsupported positional argument");
  assert.equal(options.stdio[0], "pipe");
  assert.equal(stdin, "Hello from Piper.\n");
  assert.deepEqual([...wav], [82, 73, 70, 70]);
});

test("Piper runner force-kills a process that never closes after timeout", async () => {
  const signals = [];
  const hangingRunner = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      signals.push(signal);
      return true;
    };
    return child;
  };

  await assert.rejects(
    () => runPiperWithDependencies("voice.onnx", "Hello locally.", undefined, {
      spawnImpl: hangingRunner,
      timing: {
        timeoutMs: 5,
        terminationGraceMs: 5,
        forceKillSettleMs: 5,
        fileCheckIntervalMs: 50,
      },
    }),
    (error) => error instanceof LocalTtsSynthesisError && error.code === "local_tts_failed",
  );
  assert.deepEqual(signals, [undefined, "SIGKILL"]);
});

test("Piper inherits only required runtime variables", () => {
  const env = piperSpawnEnv({
    PATH: "safe-path",
    OPENAI_API_KEY: "must-not-leak",
    ANTHROPIC_API_KEY: "must-not-leak",
    COVEN_CAVE_TOKEN: "must-not-leak",
  });
  assert.deepEqual(env, { PATH: "safe-path" });
});

test("packaged builds require the managed Piper resource instead of PATH", () => {
  assert.equal(
    piperExecutable({ COVEN_CAVE_BUNDLE: "1", PATH: "untrusted-path" }),
    null,
  );
  assert.equal(piperExecutable({ PATH: "development-path" }), "piper");
});
