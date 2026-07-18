import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { GET as getEngines } from "./route.ts";
import { POST as postDownload, GET as listDownloads } from "./downloads/route.ts";
import { GET as getDownload } from "./downloads/[jobId]/route.ts";
import { DELETE as deleteModel } from "./models/route.ts";

const cacheRoot = path.join(process.cwd(), "node_modules", ".cache", "coven-cave-tests", "voice-engines-route");

async function withCovenHome<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prior = process.env.COVEN_HOME;
  const home = path.join(cacheRoot, `${Date.now()}-${name}`);
  process.env.COVEN_HOME = home;
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
}

async function json(res: Response): Promise<any> {
  return res.json();
}

test("GET /api/voice/engines advertises readonly readiness and management endpoints", async () => {
  await withCovenHome("engines", async () => {
    const res = await getEngines();
    assert.equal(res.status, 200);
    const body = await json(res as Response);
    assert.equal(body.ok, true);
    assert.equal(body.management.surface, "settings");
    assert.equal(body.management.downloadEndpoint, "/api/voice/engines/downloads");
    assert.ok(body.root.endsWith("voice-models"));
    assert.ok(body.stt.some((model: any) => model.engine === "whisper" && model.ready === false));
    assert.ok(body.tts.some((model: any) => model.engine === "piper" && model.verified === false));
  });
});

test("download endpoints start only registered model jobs and expose polling state", async () => {
  await withCovenHome("downloads", async () => {
    const missingRes = await postDownload(new Request("http://test/api/voice/engines/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "not-in-registry" }),
    }));
    assert.equal(missingRes.status, 404);
    const missingBody = await json(missingRes as Response);
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.error, "unknown_model");

    const list = await json(await listDownloads() as Response);
    assert.equal(list.ok, true);
    assert.equal(Array.isArray(list.jobs), true);

    const noJob = await getDownload(new Request("http://test/api/voice/engines/downloads/nope"), {
      params: Promise.resolve({ jobId: "nope" }),
    });
    assert.equal(noJob.status, 404);
  });
});

test("model removal endpoint rejects malformed and unknown model requests", async () => {
  await withCovenHome("delete", async () => {
    const invalid = await deleteModel(new Request("http://test/api/voice/engines/models", {
      method: "DELETE",
      body: "{",
    }));
    assert.equal(invalid.status, 400);

    const unknown = await deleteModel(new Request("http://test/api/voice/engines/models", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "not-in-registry" }),
    }));
    assert.equal(unknown.status, 404);
  });
});
