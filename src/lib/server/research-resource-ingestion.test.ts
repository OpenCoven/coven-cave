import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import type {
  ResearchLexicalAuthority,
  ResearchResourceLexicalIndex,
} from "./research-resource-lexical-index.ts";
import { openResearchResourceLexicalIndex } from "./research-resource-lexical-index.ts";
import { createResearchResourceIngestion } from "./research-resource-ingestion.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";

function manifest(id: string): ResourceManifestV1 {
  return {
    version: 1,
    id,
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: `https://example.com/${id}`,
    title: `Resource ${id}`,
    sourceUri: `https://example.com/${id}`,
    sourceType: "saved-link",
    category: "article",
    legacySavedLink: {
      id: `legacy-${id}`,
      url: `https://example.com/${id}`,
      addedAt: "2026-08-27T12:00:00.000Z",
      source: "desk",
    },
    subject: {},
    sensitivity: "public",
    ingest: { desired: false, state: "metadata_only" },
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };
}

function memoryIndex() {
  const publications = new Map<string, ResearchLexicalAuthority>();
  let residuePurges = 0;
  const index: ResearchResourceLexicalIndex = {
    file: "/memory/research.sqlite",
    replace(input) {
      const { normalizedBytes: _bytes, ...authority } = input;
      publications.set(input.resourceId, authority);
      return [];
    },
    remove(authority) {
      const current = publications.get(authority.resourceId);
      if (!current || JSON.stringify(current) !== JSON.stringify(authority)) return false;
      publications.delete(authority.resourceId);
      return true;
    },
    publication(resourceId) {
      return publications.get(resourceId) ?? null;
    },
    probe(authority) {
      return {
        usable: JSON.stringify(publications.get(authority.resourceId)) === JSON.stringify(authority),
        chunkCount: 0,
        hits: [],
      };
    },
    purgeResidualFiles() { residuePurges += 1; },
    close() {},
  };
  return { index, publications, residuePurges: () => residuePurges };
}

async function fixture(
  operation: (input: { root: string; store: ReturnType<typeof createResearchResourceStore> }) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cave-research-ingestion-"));
  const root = path.join(parent, "resources");
  try {
    await operation({ root, store: createResearchResourceStore({ root }) });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("enqueue and run publish one fenced verified snapshot, lexical authority, and ready manifest", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("resource-1"));
    const { index, publications } = memoryIndex();
    const ingestion = createResearchResourceIngestion({
      root,
      store,
      index,
      enabled: () => true,
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      token: () => "a".repeat(32),
      fetch: async () => ({
        ok: true,
        status: 200,
        finalUrl: "https://example.com/resource-1",
        contentType: "text/plain; charset=utf-8",
        contentEncoding: null,
        bytes: new TextEncoder().encode("alpha research evidence\n"),
        fetchedAt: "2026-08-27T13:00:00.000Z",
      }),
    });

    const queued = await ingestion.enqueue("resource-1");
    assert.equal(queued?.status, "queued");
    assert.equal((await ingestion.enqueue("resource-1"))?.id, queued?.id, "enqueue is idempotent");

    const outcome = await ingestion.runNext("worker-1");
    assert.equal(outcome.kind, "completed");
    if (outcome.kind !== "completed") return;
    const ready = await store.readManifest("resource-1");
    assert.equal(ready?.ingest.state, "ready");
    assert.equal(ready?.revision, 3);
    assert.equal(ready?.currentSnapshotId, outcome.snapshot.id);
    assert.equal(outcome.snapshot.resourceRevision, ready?.revision);
    assert.deepEqual(await store.readSnapshot(outcome.snapshot.id).then((row) => row.normalizedBlob),
      new TextEncoder().encode("alpha research evidence\n"));
    assert.deepEqual(publications.get("resource-1"), {
      resourceId: "resource-1",
      resourceRevision: 3,
      deletionRevision: 0,
      snapshotId: outcome.snapshot.id,
      snapshotDigest: outcome.snapshot.normalizedBlobDigest,
    });
    await ingestion.close();
  });
});

test("quota pause spends no attempt and becomes due without exposing provider detail", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("quota-resource"));
    const { index } = memoryIndex();
    const ingestion = createResearchResourceIngestion({
      root,
      store,
      index,
      enabled: () => true,
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      token: () => "b".repeat(32),
      fetch: async () => ({
        ok: false,
        disposition: "paused_quota",
        code: "quota_pause",
        retryAfterMs: 60_000,
      }),
    });
    await ingestion.enqueue("quota-resource");
    const outcome = await ingestion.runNext("worker-quota");
    assert.equal(outcome.kind, "paused_quota");
    if (outcome.kind !== "paused_quota") return;
    assert.equal(outcome.job.attempt, 0);
    assert.equal(outcome.job.lease, undefined);
    const failure = await store.withOperationalTransaction(async (transaction) =>
      transaction.readFailure(outcome.job.id));
    assert.deepEqual(failure && Object.keys(failure).sort(), [
      "code", "deletionRevision", "jobId", "occurredAt", "resourceId",
      "resourceRevision", "retryable", "stage", "version",
    ]);
    assert.equal(failure?.code, "fetch_quota_pause");
    await ingestion.close();
  });
});

test("general deletion fences completed work, removes snapshots/index/manifest, and retains tombstone", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("delete-resource"));
    const { index, publications, residuePurges } = memoryIndex();
    let projectionRepairs = 0;
    const ingestion = createResearchResourceIngestion({
      root,
      store,
      index,
      enabled: () => true,
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      token: () => "c".repeat(32),
      fetch: async () => ({
        ok: true,
        status: 200,
        finalUrl: "https://example.com/delete-resource",
        contentType: "text/plain",
        contentEncoding: null,
        bytes: new TextEncoder().encode("delete me\n"),
        fetchedAt: "2026-08-27T13:00:00.000Z",
      }),
      repairCompatibilityProjection: async () => { projectionRepairs += 1; },
    });
    await ingestion.enqueue("delete-resource");
    const completed = await ingestion.runNext("worker-delete");
    assert.equal(completed.kind, "completed");
    if (completed.kind !== "completed") return;

    assert.equal(await ingestion.deleteResource("delete-resource"), true);
    assert.equal(await store.readManifest("delete-resource"), null);
    await assert.rejects(store.readSnapshot(completed.snapshot.id), /missing/);
    assert.equal(publications.has("delete-resource"), false);
    assert.equal(residuePurges(), 1, "deletion scrubs derivative rebuild residue even after row removal");
    assert.equal(projectionRepairs, 1);
    await store.withOperationalTransaction(async (transaction) => {
      assert.deepEqual(transaction.readTombstone("delete-resource"), {
        version: 1,
        resourceId: "delete-resource",
        deletionRevision: 1,
        deletedAt: "2026-08-27T13:00:00.000Z",
      });
      assert.equal(transaction.readDeletionJournal("delete-resource"), null);
    });
    await ingestion.close();
  });
});

test("runNext reclaims an expired claim with a fresh token instead of wedging until restart", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("expired-resource"));
    const { index } = memoryIndex();
    let currentNow = new Date("2026-08-27T13:00:00.000Z");
    const ingestion = createResearchResourceIngestion({
      root, store, index, enabled: () => true,
      now: () => currentNow,
      token: () => "e".repeat(32),
      fetch: async () => ({
        ok: true, status: 200, finalUrl: "https://example.com/expired-resource",
        contentType: "text/plain", contentEncoding: null,
        bytes: new TextEncoder().encode("reclaimed\n"),
        fetchedAt: "2026-08-27T13:00:00.000Z",
      }),
    });
    const queued = await ingestion.enqueue("expired-resource");
    assert.ok(queued);
    await store.withOperationalTransaction(async (transaction) => {
      await transaction.replaceJob(queued, {
        ...queued,
        status: "claimed",
        lease: {
          owner: "dead-worker",
          token: "d".repeat(32),
          expiresAt: "2026-08-27T13:01:00.000Z",
        },
        updatedAt: "2026-08-27T13:00:00.001Z",
      });
    });
    currentNow = new Date("2026-08-27T13:02:00.000Z");
    const outcome = await ingestion.runNext("replacement-worker");
    assert.equal(outcome.kind, "completed");
    await ingestion.close();
  });
});

test("startup leaves a nonretryable failure visible and does not silently create another job", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("terminal-resource"));
    const { index } = memoryIndex();
    const ingestion = createResearchResourceIngestion({
      root, store, index, enabled: () => true,
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      token: () => "f".repeat(32),
      fetch: async () => ({ ok: false, disposition: "nonretryable", code: "invalid_url" }),
    });
    await ingestion.enqueue("terminal-resource");
    assert.equal((await ingestion.runNext("terminal-worker")).kind, "failed");
    await ingestion.reconcileStartup();
    await store.withOperationalTransaction(async (transaction) => {
      const jobs = transaction.listJobs().filter((job) => job.resourceId === "terminal-resource");
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "failed");
    });
    assert.deepEqual((await store.readManifest("terminal-resource"))?.ingest, {
      desired: true,
      state: "failed",
      lastFailureCode: "fetch_invalid_url",
      retryable: false,
    });
    await ingestion.close();
  });
});

for (const boundary of ["terminal_failure_published", "terminal_manifest_published"] as const) {
  test(`startup completes terminal failure intent after crash at ${boundary}`, async () => {
    await fixture(async ({ root, store }) => {
      const resourceId = `terminal-crash-${boundary}`;
      await store.createManifest(manifest(resourceId));
      const { index } = memoryIndex();
      const crashing = createResearchResourceIngestion({
        root, store, index, enabled: () => true,
        now: () => new Date("2026-08-27T13:00:00.000Z"),
        token: () => "9".repeat(32),
        fetch: async () => ({ ok: false, disposition: "nonretryable", code: "invalid_url" }),
        failpoint: (point) => {
          if (point === boundary) throw new Error(`injected crash at ${point}`);
        },
      });
      await crashing.enqueue(resourceId);
      await assert.rejects(() => crashing.runNext("crashing-worker"), /injected crash/);

      const repaired = createResearchResourceIngestion({
        root, store, index, enabled: () => true,
        now: () => new Date("2026-08-27T13:00:01.000Z"),
      });
      await repaired.reconcileStartup();
      await store.withOperationalTransaction(async (transaction) => {
        const jobs = transaction.listJobs().filter((job) => job.resourceId === resourceId);
        assert.equal(jobs.length, 1, "recovery must not enqueue a replacement");
        assert.equal(jobs[0].status, "failed");
        assert.equal(transaction.readFailure(jobs[0].id)?.code, "fetch_invalid_url");
      });
      assert.deepEqual((await store.readManifest(resourceId))?.ingest, {
        desired: true,
        state: "failed",
        lastFailureCode: "fetch_invalid_url",
        retryable: false,
      });
      await repaired.close();
    });
  });
}

test("ready manifest commit rejects a lease that expires at the final durable boundary", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("ready-expired-at-commit"));
    const { index, publications } = memoryIndex();
    let now = new Date("2026-08-27T13:00:00.000Z");
    const ingestion = createResearchResourceIngestion({
      root, store, index, enabled: () => true,
      now: () => now,
      token: () => "8".repeat(32),
      fetch: async () => ({
        ok: true,
        status: 200,
        finalUrl: "https://example.com/ready-expired-at-commit",
        contentType: "text/plain",
        contentEncoding: null,
        bytes: new TextEncoder().encode("must not become ready\n"),
        fetchedAt: "2026-08-27T13:00:00.000Z",
      }),
      failpoint: (point) => {
        if (point === "ready_before_manifest_commit") {
          now = new Date("2026-08-27T13:06:00.000Z");
        }
      },
    });
    await ingestion.enqueue("ready-expired-at-commit");
    await assert.rejects(() => ingestion.runNext("slow-publisher"), /publication lease expired/);
    const current = await store.readManifest("ready-expired-at-commit");
    assert.equal(current?.ingest.state, "queued");
    assert.equal(current?.currentSnapshotId, undefined);
    assert.equal(publications.has("ready-expired-at-commit"), true, "stale derivative may be repaired");
    await ingestion.close();
  });
});

test("startup rebuilds a corrupt lexical derivative only from the verified current snapshot", async () => {
  await fixture(async ({ root, store }) => {
    await store.createManifest(manifest("rebuild-resource"));
    const first = createResearchResourceIngestion({
      root, store, enabled: () => true,
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      token: () => "1".repeat(32),
      fetch: async () => ({
        ok: true, status: 200, finalUrl: "https://example.com/rebuild-resource",
        contentType: "text/plain", contentEncoding: null,
        bytes: new TextEncoder().encode("verified lexical rebuild evidence\n"),
        fetchedAt: "2026-08-27T13:00:00.000Z",
      }),
    });
    await first.enqueue("rebuild-resource");
    const completed = await first.runNext("rebuild-worker");
    assert.equal(completed.kind, "completed");
    if (completed.kind !== "completed") return;
    await first.close();

    const file = path.join(root, "index", "research-resources.sqlite");
    await writeFile(file, "not sqlite");
    await chmod(file, 0o600);
    const repaired = createResearchResourceIngestion({ root, store, enabled: () => true });
    await repaired.reconcileStartup();
    await repaired.close();

    const reopened = await openResearchResourceLexicalIndex({ file });
    const publication = reopened.publication("rebuild-resource");
    assert.deepEqual(publication, {
      resourceId: "rebuild-resource",
      resourceRevision: 3,
      deletionRevision: 0,
      snapshotId: completed.snapshot.id,
      snapshotDigest: completed.snapshot.normalizedBlobDigest,
    });
    assert.equal(
      reopened.probe(publication!, "evidence").hits.length,
      1,
    );
    reopened.close();
  });
});

test("runtime lexical rebuild preserves a ready same-id recreation at its retained deletion fence", async () => {
  await fixture(async ({ root, store }) => {
    const resourceId = "recreated-resource";
    await store.createManifest(manifest(resourceId));
    const fetchFor = (text: string) => async () => ({
      ok: true as const,
      status: 200,
      finalUrl: `https://example.com/${resourceId}`,
      contentType: "text/plain",
      contentEncoding: null,
      bytes: new TextEncoder().encode(`${text}\n`),
      fetchedAt: "2026-08-27T13:00:00.000Z",
    });
    const first = createResearchResourceIngestion({
      root, store, enabled: () => true, token: () => "2".repeat(32),
      now: () => new Date("2026-08-27T13:00:00.000Z"),
      fetch: fetchFor("first generation"),
      repairCompatibilityProjection: async () => {},
    });
    await first.enqueue(resourceId);
    assert.equal((await first.runNext("first-worker")).kind, "completed");
    assert.equal(await first.deleteResource(resourceId), true);
    await store.createManifest(manifest(resourceId));
    await first.enqueue(resourceId);
    const recreated = await first.runNext("recreated-worker");
    assert.equal(recreated.kind, "completed");
    if (recreated.kind !== "completed") return;
    await first.close();

    const otherId = "rebuild-trigger";
    await store.createManifest(manifest(otherId));
    const file = path.join(root, "index", "research-resources.sqlite");
    await writeFile(file, "not sqlite", { mode: 0o600 });
    const repair = createResearchResourceIngestion({
      root, store, enabled: () => true, token: () => "3".repeat(32),
      now: () => new Date("2026-08-27T14:00:00.000Z"),
      fetch: async () => ({
        ok: true, status: 200, finalUrl: `https://example.com/${otherId}`,
        contentType: "text/plain", contentEncoding: null,
        bytes: new TextEncoder().encode("trigger rebuild\n"),
        fetchedAt: "2026-08-27T14:00:00.000Z",
      }),
    });
    await repair.enqueue(otherId);
    assert.equal((await repair.runNext("repair-worker")).kind, "completed");
    await repair.close();

    const reopened = await openResearchResourceLexicalIndex({ file });
    const publication = reopened.publication(resourceId);
    assert.equal(publication?.deletionRevision, 1);
    assert.equal(publication?.snapshotId, recreated.snapshot.id);
    assert.equal(reopened.probe(publication!, "generation").hits.length, 1);
    reopened.close();
  });
});
