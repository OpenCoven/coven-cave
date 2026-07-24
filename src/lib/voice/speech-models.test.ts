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
  speechModelCompanionPath,
  speechModelPath,
  speechModelReadiness,
  startSpeechModelDownload,
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
    if (model.companion) {
      assert.match(model.companion.url, /^https:\/\//);
      assert.match(model.companion.sha256, /^[a-f0-9]{64}$/);
      assert.ok(model.companion.sizeBytes > 0);
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
    companion: {
      url: "https://example.invalid/voice.onnx.json",
      sha256: sha256(configBody),
      sizeBytes: Buffer.byteLength(configBody),
      fileName: "voice.onnx.json",
    },
  };
  const modelPath = speechModelPath(model, root);
  const companionPath = speechModelCompanionPath(model, root);
  assert.ok(companionPath);
  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, modelBody);
  const missingConfig = await speechModelReadiness(model, root);
  assert.equal(missingConfig.ready, false);
  assert.equal(missingConfig.missingReason, "missing");

  await writeFile(companionPath, configBody);
  const ready = await speechModelReadiness(model, root);
  assert.equal(ready.ready, true);
  assert.equal(ready.companionPath, companionPath);
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
    companion: {
      url: "https://example.invalid/voice.onnx.json",
      sha256: sha256(configBody),
      sizeBytes: Buffer.byteLength(configBody),
      fileName: "voice.onnx.json",
    },
  };
  const now = new Date().toISOString();
  const job = {
    id: "job-companion",
    modelId: model.id,
    status: "running" as const,
    receivedBytes: 0,
    totalBytes: model.sizeBytes + model.companion!.sizeBytes,
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
    await readFile(speechModelCompanionPath(model, root)!, "utf8"),
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

test("removing a running download cancels it before it can publish", async () => {
  const root = testRoot("remove-running");
  await rm(root, { recursive: true, force: true });
  const model = SPEECH_MODEL_REGISTRY[0];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let aborted = false;
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
      controller?.error(new Error("aborted"));
    }, { once: true });
    markFetchStarted?.();
    return new Response(
      new ReadableStream({
        start(next) {
          controller = next;
          next.enqueue(new TextEncoder().encode("partial"));
        },
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
