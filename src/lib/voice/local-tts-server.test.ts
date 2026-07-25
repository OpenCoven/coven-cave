// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm as remove } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  LocalTtsSynthesisError,
  piperExecutable,
  piperSpawnEnv,
  probePiperRuntime,
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
  let outputDirectory = null;
  let cleanupOptions = null;
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
      const outputPath = receivedArgs[receivedArgs.indexOf("-f") + 1];
      outputDirectory = path.dirname(outputPath);
      assert.notEqual(outputDirectory, os.tmpdir());
      assert.match(path.basename(outputDirectory), /^coven-piper-/);
      if (process.platform !== "win32") {
        assert.equal(statSync(outputDirectory).mode & 0o777, 0o700);
      }
      writeFileSync(outputPath, Buffer.from("RIFF"));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };

  const wav = await runPiperWithDependencies(
    "verified-voice.onnx",
    "Hello from Piper.",
    undefined,
    {
      spawnImpl: fakeRunner,
      removeImpl: async (target, options) => {
        cleanupOptions = options;
        return remove(target, options);
      },
    },
  );

  assert.equal(command, "piper");
  assert.deepEqual(argv.slice(0, 3), ["-m", "verified-voice.onnx", "-f"]);
  assert.equal(argv.length, 4, "the utterance is not an unsupported positional argument");
  assert.equal(options.stdio[0], "pipe");
  assert.equal(stdin, "Hello from Piper.\n");
  assert.deepEqual([...wav], [82, 73, 70, 70]);
  assert.ok(outputDirectory);
  assert.equal(existsSync(outputDirectory), false, "the private audio directory is removed");
  assert.deepEqual(cleanupOptions, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});

test("Piper runner sends normalized multiline text as one utterance", async () => {
  let stdin = "";
  const fakeRunner = (_command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk) => { stdin += chunk; });
    child.stdin.on("end", () => {
      writeFileSync(args[args.indexOf("-f") + 1], Buffer.from("RIFF"));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };
  await runPiperWithDependencies("voice.onnx", "  First line\r\nSecond\tline\nThird line  ", undefined, {
    spawnImpl: fakeRunner,
  });
  assert.equal(stdin, "First line Second line Third line\n");
});

test("Piper runner passes the managed runtime's espeak data directory", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "coven-piper-runtime-"));
  await mkdir(path.join(runtimeDir, "espeak-ng-data"));
  let argv = null;
  const fakeRunner = (_command, args) => {
    argv = args;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.resume();
    child.stdin.on("end", () => {
      writeFileSync(args[args.indexOf("-f") + 1], Buffer.from("RIFF"));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };

  try {
    await runPiperWithDependencies("voice.onnx", "Packaged voice.", undefined, {
      executable: path.join(runtimeDir, process.platform === "win32" ? "piper.exe" : "piper"),
      spawnImpl: fakeRunner,
    });
    assert.deepEqual(argv.slice(-2), ["--espeak_data", path.join(runtimeDir, "espeak-ng-data")]);
  } finally {
    await remove(runtimeDir, { recursive: true, force: true });
  }
});

test("Piper runner rejects an empty normalized utterance before spawning", async () => {
  let spawned = false;
  await assert.rejects(
    () => runPiperWithDependencies("voice.onnx", " \n\t ", undefined, {
      spawnImpl: () => { spawned = true; throw new Error("must not spawn"); },
    }),
    (error) => error instanceof LocalTtsSynthesisError && error.code === "local_tts_failed",
  );
  assert.equal(spawned, false);
});

test("Piper runner turns a broken stdin pipe into a synthesis failure", async () => {
  let killed = false;
  const brokenPipeRunner = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      queueMicrotask(() => child.emit("close", null));
      return true;
    };
    child.stdin.on("finish", () => {
      queueMicrotask(() => child.stdin.emit("error", new Error("EPIPE")));
    });
    return child;
  };

  await assert.rejects(
    () => runPiperWithDependencies("voice.onnx", "Hello locally.", undefined, {
      spawnImpl: brokenPipeRunner,
    }),
    (error) =>
      error instanceof LocalTtsSynthesisError &&
      error.code === "local_tts_failed" &&
      error.message.includes("EPIPE"),
  );
  assert.equal(killed, true, "a broken input pipe terminates the Piper child before cleanup");
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

test("Piper availability probe fails closed when a timed-out runtime exits cleanly", async () => {
  const gracefulAfterTimeout = () => {
    const child = new EventEmitter();
    child.kill = () => {
      queueMicrotask(() => child.emit("close", 0));
      return true;
    };
    return child;
  };

  const availability = await probePiperRuntime("piper", {
    spawnImpl: gracefulAfterTimeout,
    timeoutMs: 5,
    terminationGraceMs: 50,
  });

  assert.equal(availability.available, false);
  assert.match(availability.hint, /did not respond/i);
});

test("Piper availability probe force-kills a runtime that ignores its timeout", async () => {
  const signals = [];
  const hangingProbe = () => {
    const child = new EventEmitter();
    child.kill = (signal) => {
      signals.push(signal);
      return true;
    };
    return child;
  };

  const availability = await probePiperRuntime("piper", {
    spawnImpl: hangingProbe,
    timeoutMs: 5,
    terminationGraceMs: 5,
  });

  assert.equal(availability.available, false);
  assert.match(availability.hint, /did not respond/i);
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
