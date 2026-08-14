import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  isPathInsideRoot,
  getSpeechModelDownloadJob,
  removeSpeechModel,
  publishVerifiedModelDirectory,
  runSpeechModelDownload,
  type SpeechModelRegistryEntry,
  speechEnginesReadiness,
  speechModelCompanionPaths,
  speechModelPath,
  speechModelReadiness,
  startSpeechModelDownload,
  withSpeechModelUse,
  KOKORO_NAMED_SPEAKERS,
  resolveLocalTtsVoice,
  selectableLocalTtsVoices,
  SPEECH_MODEL_REGISTRY,
} from "./speech-models.ts";

const cacheRoot = path.join(process.cwd(), "node_modules", ".cache", "coven-cave-tests", "speech-models");

function testRoot(name: string): string {
  return path.join(cacheRoot, `${Date.now()}-${name}`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fixtureModel(content = "hello voice model"): SpeechModelRegistryEntry {
  return {
    id: "fixture-model",
    name: "Fixture model",
    engine: "whisper",
    kind: "stt",
    url: "https://example.invalid/model.bin",
    sha256: sha256(content),
    sizeBytes: Buffer.byteLength(content),
    license: "test-only",
    fileName: "model.bin",
  };
}

test("speech registry is static, reviewed, and grouped for readiness consumers", async () => {
  assert.ok(SPEECH_MODEL_REGISTRY.length >= 3);
  for (const model of SPEECH_MODEL_REGISTRY) {
    assert.match(model.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.match(model.url, /^https:\/\//);
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.ok(model.sizeBytes > 0);
    assert.ok(model.license.length > 0);
    for (const companion of model.companions ?? []) {
      assert.match(companion.url, /^https:\/\//);
      assert.match(companion.sha256, /^[a-f0-9]{64}$/);
      assert.ok(companion.sizeBytes > 0);
    }
  }
  const root = testRoot("empty");
  await rm(root, { recursive: true, force: true });
  const readiness = await speechEnginesReadiness(root);
  assert.equal(readiness.ok, true);
  assert.equal(readiness.management.surface, "settings");
  assert.ok(readiness.stt.some((model) => model.engine === "whisper"));
  assert.ok(readiness.tts.some((model) => model.engine === "piper"));
  assert.equal(readiness.stt.every((model) => model.ready === false), true);
});

test("path guard keeps model files under the configured coven model root", () => {
  const root = path.resolve(testRoot("paths"));
  assert.equal(isPathInsideRoot(root, root), true);
  assert.equal(isPathInsideRoot(path.join(root, "stt", "model.bin"), root), true);
  assert.equal(isPathInsideRoot(`${root}-evil`, root), false);
  assert.equal(isPathInsideRoot(path.dirname(root), root), false);
  assert.throws(() => speechModelPath({ ...fixtureModel(), fileName: "../escape.bin" }, root), /invalid_registry_filename/);
});

test("readiness requires both expected size and verified sha256", async () => {
  const root = testRoot("verify");
  await rm(root, { recursive: true, force: true });
  const model = fixtureModel("correct");
  const modelPath = speechModelPath(model, root);
  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, "wrong!!");
  const bad = await speechModelReadiness(model, root);
  assert.equal(bad.ready, false);
  assert.equal(bad.missingReason, "checksum_mismatch");

  await writeFile(modelPath, "correct");
  const good = await speechModelReadiness(model, root);
  assert.equal(good.ready, true);
  assert.equal(good.verified, true);
  assert.equal(good.diskSizeBytes, model.sizeBytes);
  await rm(root, { recursive: true, force: true });
});

test("failed replacement keeps the previously verified model available", async () => {
  const root = testRoot("replace-rollback");
  const modelDir = path.join(root, "tts", "piper", "fixture-model");
  const stagingDir = path.join(root, "tts", "piper", ".fixture-model-new.download");
  await mkdir(modelDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
  await writeFile(path.join(modelDir, "model.bin"), "verified-old");
  await writeFile(path.join(stagingDir, "model.bin"), "replacement");
  const job = {
    id: "replace-test",
    modelId: "fixture-model",
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await assert.rejects(
    () => publishVerifiedModelDirectory(stagingDir, modelDir, job, {
      renameImpl: async (from, to) => {
        if (from === stagingDir && to === modelDir) throw new Error("rename failed");
        const { rename } = await import("node:fs/promises");
        await rename(from, to);
      },
    }),
    /rename failed/,
  );
  assert.equal(await readFile(path.join(modelDir, "model.bin"), "utf8"), "verified-old");
  await rm(root, { recursive: true, force: true });
});

test("Piper Amy registry metadata matches the reviewed pinned artifact", () => {
  const amy = SPEECH_MODEL_REGISTRY.find(
    (model) => model.id === "piper-amy-medium-en-us",
  );
  assert.deepEqual(
    amy && { url: amy.url, sizeBytes: amy.sizeBytes, sha256: amy.sha256 },
    {
      url: "https://huggingface.co/rhasspy/piper-voices/resolve/0d907f158acc877ddeebcbf827659ee13bea8bcd/en/en_US/amy/medium/en_US-amy-medium.onnx",
      sizeBytes: 63_201_294,
      sha256: "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18",
    },
  );
});

// The signature-voice roster (cave-vony): every entry pins the reviewed
// artifact at the same vetted piper-voices revision as Amy, and only
// redistribution-safe licenses ship (CC BY-NC-SA and custom-licensed voices
// were rejected during vetting).
test("signature voice roster pins reviewed artifacts with vetted licenses", () => {
  const roster = [
    {
      id: "piper-alba-medium-en-gb",
      sha256: "401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b",
      companionSha256: "aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4",
      license: "CC-BY-4.0",
    },
    {
      id: "piper-joe-medium-en-us",
      sha256: "58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06",
      companionSha256: "3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33",
      license: "CC0-1.0",
    },
    {
      id: "piper-kristin-medium-en-us",
      sha256: "5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4",
      companionSha256: "5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c",
      license: "Public domain (LibriVox dataset)",
    },
  ];
  for (const expected of roster) {
    const entry = SPEECH_MODEL_REGISTRY.find((model) => model.id === expected.id);
    assert.ok(entry, `${expected.id} is registered`);
    assert.equal(entry.engine, "piper");
    assert.equal(entry.kind, "tts");
    assert.equal(entry.sha256, expected.sha256);
    assert.equal(entry.license, expected.license);
    // Voice ids double as local TTS voiceNames — they must satisfy the
    // route's validation pattern or the voice can never synthesize.
    assert.match(entry.id, /^(?:piper|kokoro)-[a-z0-9][a-z0-9-]*$/);
    // Piper needs the config beside the weights; an entry without its
    // companion would advertise an unusable voice.
    assert.equal(entry.companions?.[0]?.sha256, expected.companionSha256);
    // Same pinned revision as Amy: artifacts can't drift under re-review.
    assert.match(entry.url, /\/resolve\/0d907f158acc877ddeebcbf827659ee13bea8bcd\//);
    assert.match(entry.companions?.[0]?.url ?? "", /\/resolve\/0d907f158acc877ddeebcbf827659ee13bea8bcd\//);
  }
});

// Kokoro (cave-tr09i): one reviewed model bundle, addressed by voiceName like
// any Piper voice. The companions order [voices.bin, tokens.txt] is a pinned
// contract — the TTS route hands companionPaths[0]/[1] to the runner
// positionally.
test("kokoro registry entry pins reviewed artifacts and companion order", () => {
  const entry = SPEECH_MODEL_REGISTRY.find((model) => model.id === "kokoro-en-v0-19");
  assert.ok(entry, "kokoro-en-v0-19 is registered");
  assert.equal(entry.engine, "kokoro");
  assert.equal(entry.kind, "tts");
  assert.equal(entry.license, "Apache-2.0");
  assert.match(entry.id, /^(?:piper|kokoro)-[a-z0-9][a-z0-9-]*$/);
  assert.equal(entry.sha256, "10ff414106a038ce7e9e0126c6461e4dc8a86efaa89dc91d2009d69fe635e339");
  assert.equal(entry.kokoroSpeakerId, 0);
  // Pinned HF revision: artifacts can't drift under re-review.
  assert.match(entry.url, /\/resolve\/92805c485745946a0d945562d3aba19e7cbb2104\//);
  assert.deepEqual(
    entry.companions?.map((companion) => companion.fileName),
    ["voices.bin", "tokens.txt"],
  );
  for (const companion of entry.companions ?? []) {
    assert.match(companion.url, /\/resolve\/92805c485745946a0d945562d3aba19e7cbb2104\//);
  }
});

test("Piper readiness requires its verified config companion", async () => {
  const root = testRoot("companion");
  await rm(root, { recursive: true, force: true });
  const modelBody = "voice weights";
  const configBody = '{"audio":{"sample_rate":22050}}';
  const model: SpeechModelRegistryEntry = {
    ...fixtureModel(modelBody),
    id: "piper-fixture",
    engine: "piper",
    kind: "tts",
    fileName: "voice.onnx",
    companions: [{
      url: "https://example.invalid/voice.onnx.json",
      sha256: sha256(configBody),
      sizeBytes: Buffer.byteLength(configBody),
      fileName: "voice.onnx.json",
    }],
  };
  const modelPath = speechModelPath(model, root);
  const [companionPath] = speechModelCompanionPaths(model, root);
  assert.ok(companionPath);
  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, modelBody);
  const missingConfig = await speechModelReadiness(model, root);
  assert.equal(missingConfig.ready, false);
  assert.equal(missingConfig.missingReason, "missing");

  await writeFile(companionPath, configBody);
  const ready = await speechModelReadiness(model, root);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.companionPaths, [companionPath]);
  assert.equal(
    ready.diskSizeBytes,
    Buffer.byteLength(modelBody) + Buffer.byteLength(configBody),
  );
  await rm(root, { recursive: true, force: true });
});

test("download writes to a partial file, verifies sha256, then atomically publishes readiness", async () => {
  const root = testRoot("download-ok");
  await rm(root, { recursive: true, force: true });
  const body = "downloaded model";
  const model = fixtureModel(body);
  const now = new Date().toISOString();
  const job = {
    id: "job-ok",
    modelId: model.id,
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: model.sizeBytes,
    startedAt: now,
    updatedAt: now,
  };
  const fetchImpl = async () => new Response(body, { headers: { "content-length": String(model.sizeBytes) } });

  await runSpeechModelDownload(model, job, fetchImpl as typeof fetch, root);

  const modelPath = speechModelPath(model, root);
  assert.equal(await readFile(modelPath, "utf8"), body);
  assert.equal((await stat(modelPath)).size, model.sizeBytes);
  assert.equal((await speechModelReadiness(model, root)).ready, true);
  await rm(root, { recursive: true, force: true });
});

test("failed checksum downloads leave no ready model behind", async () => {
  const root = testRoot("download-bad");
  await rm(root, { recursive: true, force: true });
  const model = fixtureModel("expected");
  const now = new Date().toISOString();
  const job = {
    id: "job-bad",
    modelId: model.id,
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: model.sizeBytes,
    startedAt: now,
    updatedAt: now,
  };
  const fetchImpl = async () => new Response("tampered", { headers: { "content-length": String(model.sizeBytes) } });

  await runSpeechModelDownload(model, job, fetchImpl as typeof fetch, root);

  assert.equal((await speechModelReadiness(model, root)).ready, false);
  await assert.rejects(readFile(speechModelPath(model, root)), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test("download publishes Piper weights and config as one ready directory", async () => {
  const root = testRoot("download-companion");
  await rm(root, { recursive: true, force: true });
  const modelBody = "voice weights";
  const configBody = '{"audio":{"sample_rate":22050}}';
  const model: SpeechModelRegistryEntry = {
    ...fixtureModel(modelBody),
    id: "piper-download-fixture",
    engine: "piper",
    kind: "tts",
    fileName: "voice.onnx",
    companions: [{
      url: "https://example.invalid/voice.onnx.json",
      sha256: sha256(configBody),
      sizeBytes: Buffer.byteLength(configBody),
      fileName: "voice.onnx.json",
    }],
  };
  const now = new Date().toISOString();
  const job = {
    id: "job-companion",
    modelId: model.id,
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: model.sizeBytes + model.companions![0].sizeBytes,
    startedAt: now,
    updatedAt: now,
  };
  const fetchImpl = async (url: string | URL) => {
    const body = String(url).endsWith(".json") ? configBody : modelBody;
    return new Response(body, {
      headers: { "content-length": String(Buffer.byteLength(body)) },
    });
  };

  await runSpeechModelDownload(model, job, fetchImpl as typeof fetch, root);

  assert.equal(await readFile(speechModelPath(model, root), "utf8"), modelBody);
  assert.equal(
    await readFile(speechModelCompanionPaths(model, root)[0], "utf8"),
    configBody,
  );
  assert.equal((await speechModelReadiness(model, root)).ready, true);
  await rm(root, { recursive: true, force: true });
});

test("removeSpeechModel removes only the allow-listed registry model directory", async () => {
  const root = testRoot("remove");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  const modelPath = speechModelPath(model, root);
  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, "placeholder");
  assert.equal(await removeSpeechModel(model.id, root), "removed");
  await assert.rejects(stat(modelPath), /ENOENT/);
  assert.equal(await removeSpeechModel("not-a-model", root), "unknown_model");
  await rm(root, { recursive: true, force: true });
});

test("removal wins a download request still awaiting its readiness probe", async () => {
  const root = testRoot("remove-before-job");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  let fetchCalls = 0;
  const starting = startSpeechModelDownload(model.id, async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  }, root);

  // startSpeechModelDownload yields while checking readiness. Removal during
  // that gap must stop the delayed starter from creating a new publisher.
  assert.equal(await removeSpeechModel(model.id, root), "missing");
  const result = await starting;

  assert.ok("job" in result);
  assert.equal(result.started, false);
  assert.equal(result.cancelled, true);
  assert.equal(getSpeechModelDownloadJob(result.job.id)?.status, "cancelled");
  assert.equal(getSpeechModelDownloadJob(result.job.id)?.ready, false);
  assert.equal(fetchCalls, 0);
  await assert.rejects(stat(speechModelPath(model, root)), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test("removing a running download cancels it before it can publish", async () => {
  const root = testRoot("remove-running");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  let aborted = false;
  let streamCancelled = false;
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    }, { once: true });
    markFetchStarted?.();
    return new Response(
      new ReadableStream({
        start(next) {
          next.enqueue(new TextEncoder().encode("partial"));
        },
        cancel() { streamCancelled = true; },
      }),
      { headers: { "content-length": String(model.sizeBytes) } },
    );
  };

  const started = await startSpeechModelDownload(model.id, fetchImpl as typeof fetch, root);
  assert.ok("job" in started && started.started);
  await fetchStarted;
  assert.equal(await removeSpeechModel(model.id, root), "removed");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getSpeechModelDownloadJob(started.job.id)?.status === "cancelled") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(getSpeechModelDownloadJob(started.job.id)?.status, "cancelled");
  assert.equal(aborted, true, "removal aborts the active download request");
  assert.equal(streamCancelled, true, "removal cancels a body reader that ignores the fetch abort signal");
  const modelDir = path.dirname(speechModelPath(model, root));
  const stagingDir = path.join(path.dirname(modelDir), `.${model.id}.${started.job.id}.download`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await stat(stagingDir);
      await new Promise((resolve) => setTimeout(resolve, 5));
    } catch {
      break;
    }
  }
  await assert.rejects(stat(speechModelPath(model, root)), /ENOENT/);
  await assert.rejects(stat(stagingDir), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test("a replacement waits for removal to reap the cancelled writer", async () => {
  const root = testRoot("remove-replacement-barrier");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  let firstAborted = false;
  let fetchCalls = 0;
  let markFirstFetch: (() => void) | undefined;
  let markFirstAbort: (() => void) | undefined;
  const firstFetch = new Promise<void>((resolve) => { markFirstFetch = resolve; });
  const firstAbort = new Promise<void>((resolve) => { markFirstAbort = resolve; });
  const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
        init?.signal?.addEventListener("abort", () => {
          firstAborted = true;
          markFirstAbort?.();
        }, { once: true });
      markFirstFetch?.();
      return new Response(new ReadableStream({
        start(next) {
          next.enqueue(new TextEncoder().encode("partial"));
        },
      }), { headers: { "content-length": String(model.sizeBytes) } });
    }
    assert.equal(firstAborted, true, "replacement cannot start before removal aborts the old writer");
    throw new Error("second download intentionally stops after the barrier check");
  };

  const first = await startSpeechModelDownload(model.id, fetchImpl as typeof fetch, root);
  assert.ok("job" in first && first.started);
  await firstFetch;
  const removal = removeSpeechModel(model.id, root);
  await firstAbort;
  const replacement = startSpeechModelDownload(model.id, fetchImpl as typeof fetch, root);
  await removal;
  const second = await replacement;
  assert.ok("job" in second && second.started);
  for (let attempt = 0; attempt < 20 && fetchCalls < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(fetchCalls, 2);
  await rm(root, { recursive: true, force: true });
});

test("removing a model after publication cannot leave its download ready", async () => {
  const root = testRoot("remove-after-publish");
  await rm(root, { recursive: true, force: true });
  const body = "downloaded model";
  const registered = SPEECH_MODEL_REGISTRY[0];
  const model: SpeechModelRegistryEntry = {
    ...registered,
    url: "https://example.invalid/model.bin",
    sha256: sha256(body),
    sizeBytes: Buffer.byteLength(body),
  };
  const now = new Date().toISOString();
  const job = {
    id: "job-remove-after-publish",
    modelId: model.id,
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: model.sizeBytes,
    startedAt: now,
    updatedAt: now,
  };
  const fetchImpl = async () => new Response(body, {
    headers: { "content-length": String(model.sizeBytes) },
  });

  await runSpeechModelDownload(model, job, fetchImpl as typeof fetch, root, {
    onPublished: async () => {
      await removeSpeechModel(model.id, root);
    },
  });

  const cancelled = getSpeechModelDownloadJob(job.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.ready, false);
  await assert.rejects(stat(speechModelPath(model, root)), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test("removal waits for an active verified model use", async () => {
  const root = testRoot("remove-active-use");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  const modelDir = path.dirname(speechModelPath(model, root));
  await mkdir(modelDir, { recursive: true });
  await writeFile(path.join(modelDir, "sentinel"), "in use");

  let releaseUse: (() => void) | undefined;
  const useStarted = new Promise<void>((resolve) => {
    void withSpeechModelUse(model.id, async () => {
      resolve();
      await new Promise<void>((finish) => { releaseUse = finish; });
    });
  });
  await useStarted;

  let removalFinished = false;
  const removal = removeSpeechModel(model.id, root).then((result) => {
    removalFinished = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(removalFinished, false, "removal must not unlink a model while Piper may open it");

  releaseUse?.();
  assert.equal(await removal, "removed");
  await assert.rejects(stat(modelDir), { code: "ENOENT" });
  await rm(root, { recursive: true, force: true });
});

// ── Named Kokoro speakers (cave-xopgb) ──────────────────────────────────────

test("Kokoro named speakers pin the sherpa-onnx voices.bin generation order", () => {
  // The sid order is the concatenation order in k2-fsa/sherpa-onnx
  // scripts/kokoro/v0.19/generate_voices_bin.py (id2speaker). Speaker 0
  // ("af", the reviewed default blend) is the base registry entry itself.
  assert.deepEqual(
    KOKORO_NAMED_SPEAKERS.map((speaker) => [speaker.speakerId, speaker.suffix]),
    [
      [1, "bella"], [2, "nicole"], [3, "sarah"], [4, "sky"], [5, "adam"],
      [6, "michael"], [7, "emma"], [8, "isabella"], [9, "george"], [10, "lewis"],
    ],
    "a reordered roster would route synthesis to the wrong embedded speaker",
  );
});

test("resolveLocalTtsVoice resolves base ids, derived speakers, and rejects unknowns", () => {
  const base = resolveLocalTtsVoice("kokoro-en-v0-19");
  assert.equal(base?.model.id, "kokoro-en-v0-19");
  assert.equal(base?.kokoroSpeakerId, 0, "the base entry keeps the reviewed default blend");

  const bella = resolveLocalTtsVoice("kokoro-en-v0-19-bella");
  assert.equal(bella?.model.id, "kokoro-en-v0-19", "derived speakers share the base bundle");
  assert.equal(bella?.kokoroSpeakerId, 1);
  assert.equal(bella?.displayName, "Kokoro Bella (US female)");

  assert.equal(resolveLocalTtsVoice("kokoro-en-v0-19-nonexistent"), null, "unknown speakers fail closed");
  assert.equal(resolveLocalTtsVoice("not-a-voice"), null);

  const piper = SPEECH_MODEL_REGISTRY.find((model) => model.engine === "piper" && model.kind === "tts");
  assert.ok(piper);
  assert.equal(resolveLocalTtsVoice(piper.id)?.kokoroSpeakerId, null, "non-Kokoro voices carry no sid");
});

test("selectableLocalTtsVoices expands one downloaded Kokoro bundle into named voices", () => {
  const kokoroBase = SPEECH_MODEL_REGISTRY.find((model) => model.engine === "kokoro");
  assert.ok(kokoroBase);
  const readiness = (overrides: Record<string, unknown>) => ({
    ...kokoroBase,
    ready: true,
    verified: true,
    diskSizeBytes: 0,
    path: "/x/model.onnx",
    ...overrides,
  });
  const voices = selectableLocalTtsVoices([readiness({})]);
  assert.equal(voices.length, 1 + KOKORO_NAMED_SPEAKERS.length, "base voice plus every named speaker");
  assert.ok(voices.every((voice) => voice.ready && voice.verified), "derived readiness IS the bundle's readiness");
  assert.ok(voices.every((voice) => voice.engine === "kokoro"));
  assert.equal(new Set(voices.map((voice) => voice.id)).size, voices.length, "voice ids stay unique");

  const notReady = selectableLocalTtsVoices([readiness({ ready: false, verified: false })]);
  assert.ok(notReady.every((voice) => !voice.ready), "an undownloaded bundle offers no ready speakers");
});
