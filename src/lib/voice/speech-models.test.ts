import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  isPathInsideRoot,
  removeSpeechModel,
  runSpeechModelDownload,
  type SpeechModelRegistryEntry,
  speechEnginesReadiness,
  speechModelPath,
  speechModelReadiness,
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
