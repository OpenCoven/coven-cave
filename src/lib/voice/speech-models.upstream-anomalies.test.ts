// Speech model downloads under every upstream anomaly (#6359).
//
// A model is downloaded into a staging directory, verified by size and
// sha256, and only then published into the model root. The matrix drives
// `runSpeechModelDownload` with a tiny fixture entry hosted on huggingface.co
// and proves that whatever Hugging Face does — a 5xx, a stalled socket, a
// dead network, a 200 that is not the model — the job ends `failed`, nothing
// is marked ready, no staging directory is left behind, and a retry once the
// host heals completes. `startSpeechModelDownload` only accepts registry
// models (tens of MB), so its path is proven for the failure half only: the
// job it starts fails cleanly and leaves nothing.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import {
  getSpeechModelDownloadJob,
  runSpeechModelDownload,
  speechModelReadiness,
  startSpeechModelDownload,
  type SpeechModelDownloadJob,
  type SpeechModelRegistryEntry,
} from "./speech-models.ts";

const CONTENT = "hello voice model";
const COMPANION = '{"sample_rate": 22050}';
const MODEL: SpeechModelRegistryEntry = {
  id: "fixture-model",
  name: "Fixture model",
  engine: "piper",
  kind: "tts",
  url: "https://huggingface.co/fixture/voices/resolve/main/model.onnx",
  sha256: createHash("sha256").update(CONTENT).digest("hex"),
  sizeBytes: Buffer.byteLength(CONTENT),
  license: "test-only",
  fileName: "model.onnx",
  companions: [{
    url: "https://huggingface.co/fixture/voices/resolve/main/model.onnx.json",
    sha256: createHash("sha256").update(COMPANION).digest("hex"),
    sizeBytes: Buffer.byteLength(COMPANION),
    fileName: "model.onnx.json",
  }],
};

const root = await mkdtemp(path.join(tmpdir(), "speech-models-anomalies-"));
const harness = installUpstreamAnomalyFetch({ install: false });
test.after(async () => {
  harness.restore();
  await rm(root, { recursive: true, force: true });
});

harness.healthy("huggingface", (request) => {
  const url = new URL(request.url);
  const body = url.pathname.endsWith(".json") ? COMPANION : CONTENT;
  return new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) } });
});

let sequence = 0;
function newJob(modelId = MODEL.id): SpeechModelDownloadJob {
  const now = new Date().toISOString();
  sequence += 1;
  return { id: `${modelId}-anomaly-${sequence}`, modelId, status: "running", receivedBytes: 0, totalBytes: 0, startedAt: now, updatedAt: now };
}

type Outcome = { job: SpeechModelDownloadJob | null; ready: boolean; missingReason?: string; leftovers: string[] };

/** Anything beside the published model directory under the engine folder is a leftover. */
async function leftovers(): Promise<string[]> {
  const engineDir = path.join(root, MODEL.kind, MODEL.engine);
  try {
    return (await readdir(engineDir)).filter((name) => name !== MODEL.id);
  } catch {
    return [];
  }
}

async function download(): Promise<Outcome> {
  const job = newJob();
  await runSpeechModelDownload(MODEL, job, harness.fetch, root);
  const readiness = await speechModelReadiness(MODEL, root);
  return { job: getSpeechModelDownloadJob(job.id), ready: readiness.ready, missingReason: readiness.missingReason, leftovers: await leftovers() };
}

const clearRoot = () => rm(root, { recursive: true, force: true });

const published = (outcome: MatrixOutcome) => {
  const { job, ready, leftovers: left } = outcome.value as Outcome;
  assert.equal(job?.status, "done");
  assert.equal(job?.ready, true);
  assert.equal(job?.receivedBytes, MODEL.sizeBytes + MODEL.companions![0].sizeBytes);
  assert.equal(ready, true, "both assets verified and published");
  assert.deepEqual(left, [], "no staging directory survives a publish");
};

const failedCleanly = (outcome: MatrixOutcome) => {
  const { job, ready, missingReason, leftovers: left } = outcome.value as Outcome;
  assert.equal(job?.status, "failed");
  assert.equal(job?.ready, false, "a failed download is never marked ready");
  assert.equal(typeof job?.error, "string", "the job says why");
  assert.equal(ready, false);
  assert.equal(missingReason, "missing", "no partial model is published");
  assert.deepEqual(left, [], "the staging directory is removed");
};

test("runSpeechModelDownload across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "huggingface",
    beforeEach: clearRoot,
    invoke: download,
    healthy: published,
    degraded: {
      default: failedCleanly,
      "http-500": (outcome) => {
        failedCleanly(outcome);
        assert.equal((outcome.value as Outcome).job?.error, "download_http_500");
      },
      "auth-revoked": (outcome) => {
        failedCleanly(outcome);
        assert.equal((outcome.value as Outcome).job?.error, "download_http_401");
      },
      "rate-limit": (outcome) => {
        failedCleanly(outcome);
        assert.equal((outcome.value as Outcome).job?.error, "download_http_429");
      },
      // A 200 whose bytes are not the model fails the size or digest check.
      "malformed-json": (outcome) => {
        failedCleanly(outcome);
        assert.match((outcome.value as Outcome).job?.error ?? "", /size_mismatch|checksum_mismatch/);
      },
      "empty-body": (outcome) => {
        failedCleanly(outcome);
        assert.equal((outcome.value as Outcome).job?.error, "size_mismatch");
      },
      "schema-drift": (outcome) => {
        failedCleanly(outcome);
        assert.match((outcome.value as Outcome).job?.error ?? "", /size_mismatch|checksum_mismatch/);
      },
    },
  });
});

test("a failed re-download leaves the previously verified model in place", async () => {
  await clearRoot();
  published(await outcomeOf(download()));
  harness.inject("huggingface", { kind: "network" });
  const degraded = (await download());
  assert.equal(degraded.job?.status, "failed");
  assert.equal(degraded.ready, true, "the verified model is untouched by a failed replacement");
  assert.deepEqual(degraded.leftovers, []);
  harness.heal("huggingface");
});

test("a companion that fails after the weights succeeded publishes nothing", async () => {
  await clearRoot();
  harness.healthy("huggingface", (request) => {
    if (new URL(request.url).pathname.endsWith(".json")) return new Response("Service Unavailable", { status: 503 });
    return new Response(CONTENT, { status: 200, headers: { "content-length": String(MODEL.sizeBytes) } });
  });
  try {
    const outcome = await download();
    assert.equal(outcome.job?.status, "failed");
    assert.equal(outcome.job?.error, "download_http_503");
    assert.equal(outcome.ready, false, "the weights are never visible without their config beside them");
    assert.deepEqual(outcome.leftovers, []);
  } finally {
    harness.healthy("huggingface", (request) => {
      const body = new URL(request.url).pathname.endsWith(".json") ? COMPANION : CONTENT;
      return new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) } });
    });
  }
  published(await outcomeOf(download()));
});

test("startSpeechModelDownload on a registry model under a dead network fails the job and leaves nothing", async () => {
  // Registry models are tens of MB with pinned digests, so only the failure
  // half can run hermetically here; the healed retry is proven on the fixture above.
  const registryRoot = await mkdtemp(path.join(tmpdir(), "speech-models-registry-anomaly-"));
  harness.inject("huggingface", { kind: "network" });
  try {
    const started = await startSpeechModelDownload("piper-amy-medium-en-us", harness.fetch, registryRoot);
    assert.ok("job" in started && started.started === true, JSON.stringify(started));
    let job = getSpeechModelDownloadJob(started.job.id);
    for (let attempt = 0; attempt < 200 && job?.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      job = getSpeechModelDownloadJob(started.job.id);
    }
    assert.equal(job?.status, "failed");
    assert.equal(job?.ready, false);
    assert.equal(harness.calls("huggingface").length >= 1, true);
    const entries = await readdir(path.join(registryRoot, "tts", "piper")).catch(() => [] as string[]);
    assert.deepEqual(entries, [], "no staging or model directory is left");
  } finally {
    harness.heal("huggingface");
    await rm(registryRoot, { recursive: true, force: true });
  }
});

test("every download carries an abort signal", () => {
  for (const call of harness.calls("huggingface")) assert.equal(call.hasDeadline, true);
});

async function outcomeOf(pending: Promise<Outcome>): Promise<MatrixOutcome> {
  const value = await pending;
  return { value, response: null, status: null, text: JSON.stringify(value), body: value, threw: undefined };
}
