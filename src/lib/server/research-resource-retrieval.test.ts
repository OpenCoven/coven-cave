import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseResourceQueryResponseV1, type ResourceManifestV1 } from "../research-resource-contracts.ts";
import { createResearchResourceIngestion } from "./research-resource-ingestion.ts";
import { openResearchResourceLexicalIndex } from "./research-resource-lexical-index.ts";
import {
  createResearchResourceRetrieval,
  ResearchResourceRetrievalError,
} from "./research-resource-retrieval.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";

function manifest(id: string, title: string, projectId: string): ResourceManifestV1 {
  return {
    version: 1,
    id,
    revision: 1,
    kind: "local-file",
    canonicalIdentity: `https://example.com/${id}`,
    title,
    sourceUri: `https://example.com/${id}`,
    sourceType: "url",
    subject: { projectId },
    sensitivity: "private",
    ingest: { desired: true, state: "metadata_only" },
    createdAt: "2026-08-27T13:00:00.000Z",
    updatedAt: "2026-08-27T13:00:00.000Z",
  };
}

test("exact, lexical, and hybrid queries return verified deterministic evidence", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "research-retrieval-"));
  const root = path.join(parent, "resources");
  const store = createResearchResourceStore({ root });
  try {
    await store.createManifest(manifest("resource_alpha", "Coven Architecture", "project_a"));
    await store.createManifest(manifest("resource_beta", "Field Notes", "project_b"));
    await store.createManifest(manifest("resource-Z", "Istanbul Archive", "project_a"));
    const bodies = new Map([
      ["https://example.com/resource_alpha", `${"a".repeat(479)}😀${"b".repeat(1436)}😀 exact boundary`],
      ["https://example.com/resource_beta", "A different notebook mentions moonlit orchards."],
      ["https://example.com/resource-Z", "Locale-independent exact matching."],
    ]);
    const ingestion = createResearchResourceIngestion({
      root,
      store,
      enabled: () => true,
      now: () => new Date("2026-08-27T13:05:00.000Z"),
      token: () => "a".repeat(32),
      fetch: async (url) => ({
        ok: true,
        status: 200,
        finalUrl: url,
        contentType: "text/plain",
        contentEncoding: null,
        bytes: new TextEncoder().encode(bodies.get(url)!),
        fetchedAt: "2026-08-27T13:05:00.000Z",
      }),
    });
    for (const id of ["resource_alpha", "resource_beta", "resource-Z"]) {
      await ingestion.enqueue(id);
      assert.equal((await ingestion.runNext("worker")).kind, "completed");
    }
    await ingestion.close();

    const inspection = await openResearchResourceLexicalIndex({
      file: path.join(root, "index", "research-resources.sqlite"),
    });
    const inspectedHits = inspection.search("moonlit orchards");
    assert.deepEqual(inspectedHits.map((hit) => hit.resourceId), ["resource_beta"]);
    const beta = await store.readManifest("resource_beta");
    assert.deepEqual(
      [inspectedHits[0]?.resourceRevision, inspectedHits[0]?.snapshotId],
      [beta?.revision, beta?.currentSnapshotId],
    );
    inspection.close();

    const retrieval = createResearchResourceRetrieval({ root, store });
    const exact = await retrieval.query({ version: 1, text: "coven", ranking: "exact", limit: 10 });
    assert.deepEqual(exact.hits.map((hit) => hit.resourceId), ["resource_alpha"]);
    assert.equal(exact.hits[0]?.retrieval.exact, true);
    assert.equal(exact.hits[0]?.retrieval.semantic.state, "disabled");
    assert.equal(Array.from(exact.hits[0]!.excerpt).length, 480);
    assert.equal(exact.hits[0]!.excerpt.endsWith("😀"), true, "clipping retains a whole astral code point");
    const exactSnapshot = await store.readSnapshot(exact.hits[0]!.snapshotId);
    const selector = exact.hits[0]!.selector;
    assert.equal(selector.type, "text-span");
    if (selector.type === "text-span") {
      assert.equal(
        new TextDecoder("utf-8", { fatal: true }).decode(
          exactSnapshot.normalizedBlob.subarray(selector.start, selector.end),
        ),
        exact.hits[0]!.excerpt,
        "selector bytes decode to the exact emitted excerpt",
      );
    }
    const turkishI = await retrieval.query({ version: 1, text: "istanbul", ranking: "exact", limit: 10 });
    assert.deepEqual(turkishI.hits.map((hit) => hit.resourceId), ["resource-Z"]);
    const tied = await retrieval.query({
      version: 1,
      text: "https://example.com/resource",
      ranking: "exact",
      limit: 10,
    });
    assert.deepEqual(
      tied.hits.map((hit) => hit.resourceId),
      ["resource-Z", "resource_alpha", "resource_beta"],
      "equal-score exact candidates use raw ordinal id order",
    );

    const lexical = await retrieval.query({ version: 1, text: "moonlit orchards", ranking: "lexical", limit: 10 });
    assert.deepEqual(lexical.hits.map((hit) => hit.resourceId), ["resource_beta"]);
    assert.match(lexical.hits[0]!.excerpt, /moonlit orchards/);
    assert.equal(lexical.hits[0]?.retrieval.lexical.rank, 1);
    assert.equal(parseResourceQueryResponseV1(lexical).ok, true, "response is contract-valid");

    const tail = await retrieval.query({
      version: 1,
      text: "exact boundary",
      ranking: "lexical",
      limit: 10,
    });
    assert.match(tail.hits[0]!.excerpt, /exact boundary/, "the excerpt contains the actual tail match");
    const tailSnapshot = await store.readSnapshot(tail.hits[0]!.snapshotId);
    const tailSelector = tail.hits[0]!.selector;
    assert.equal(tailSelector.type, "text-span");
    if (tailSelector.type === "text-span") {
      assert.equal(
        new TextDecoder("utf-8", { fatal: true }).decode(
          tailSnapshot.normalizedBlob.subarray(tailSelector.start, tailSelector.end),
        ),
        tail.hits[0]!.excerpt,
        "tail selector remains an exact UTF-8 byte range across astral characters",
      );
    }
    assert.equal(parseResourceQueryResponseV1(tail).ok, true, "tail excerpt digest remains exact");

    const filtered = await retrieval.query({
      version: 1,
      text: "moonlit",
      ranking: "hybrid",
      limit: 10,
      filters: { projectIds: ["project_a"] },
    });
    assert.deepEqual(filtered.hits, [], "filters run before lexical ranking");
    const hybrid = await retrieval.query({ version: 1, text: "moonlit", ranking: "hybrid", limit: 10 });
    assert.equal(hybrid.hits[0]?.retrieval.semantic.state, "unavailable");

    await assert.rejects(
      () => retrieval.query({
        version: 1,
        text: "retrieval",
        ranking: "lexical",
        limit: 10,
        filters: { contextPackId: "pack_a" },
      }),
      (error) => error instanceof ResearchResourceRetrievalError && error.code === "unsupported-filter",
    );

    const deleting = await store.readManifest("resource_alpha");
    assert.ok(deleting?.currentSnapshotId);
    await store.withOperationalTransaction(async (transaction) => {
      await transaction.beginDeletion({
        expectedManifest: deleting!,
        deletedAt: "2026-08-27T13:10:00.000Z",
        snapshotIds: transaction.listSnapshots("resource_alpha").map((snapshot) => snapshot.id).sort(),
      });
    });
    for (const ranking of ["exact", "hybrid"] as const) {
      const duringDeletion = await retrieval.query({ version: 1, text: "coven", ranking, limit: 10 });
      assert.deepEqual(
        duringDeletion.hits,
        [],
        `${ranking} cannot resurrect the ready manifest during the fenced deletion window`,
      );
    }

    const recreation = createResearchResourceIngestion({
      root,
      store,
      enabled: () => true,
      now: () => new Date("2026-08-27T13:15:00.000Z"),
      token: () => "b".repeat(32),
      fetch: async (url) => ({
        ok: true,
        status: 200,
        finalUrl: url,
        contentType: "text/plain",
        contentEncoding: null,
        bytes: new TextEncoder().encode(bodies.get(url)!),
        fetchedAt: "2026-08-27T13:15:00.000Z",
      }),
      repairCompatibilityProjection: async () => {},
    });
    assert.equal(await recreation.deleteResource("resource_alpha"), true);
    await store.createManifest(manifest("resource_alpha", "Coven Architecture", "project_a"));
    await recreation.enqueue("resource_alpha");
    assert.equal((await recreation.runNext("recreation-worker")).kind, "completed");
    await recreation.close();
    const recreated = await retrieval.query({ version: 1, text: "coven", ranking: "exact", limit: 10 });
    assert.deepEqual(recreated.hits.map((hit) => hit.resourceId), ["resource_alpha"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("restored deletion residue fails closed without a current-generation publication proof", async () => {
  const bytes = new TextEncoder().encode("restored evidence");
  const ready = {
    ...manifest("resource_restored", "Restored evidence", "project_a"),
    revision: 2,
    ingest: { desired: true, state: "ready" as const },
    currentSnapshotId: "snapshot_restored",
  };
  const snapshot = {
    version: 1 as const,
    id: "snapshot_restored",
    resourceId: ready.id,
    resourceRevision: ready.revision,
    normalizedBlobDigest: "e".repeat(64),
    normalizedMediaType: "text/plain",
    normalizedBytes: bytes.byteLength,
    normalizationReceipt: { extractorId: "fixture", extractorVersion: "1" },
    sourceSelector: { type: "whole-resource" as const },
    createdAt: "2026-08-27T13:05:00.000Z",
  };
  let snapshotReads = 0;
  const jobs = [{
    resourceId: ready.id,
    resourceRevision: ready.revision - 1,
    deletionRevision: 0,
    status: "completed",
  }];
  const transaction = {
    listManifests: () => [ready],
    listJobs: () => jobs,
    readDeletionJournal: () => null,
    readDeletionFence: () => ({
      version: 1 as const,
      resourceId: ready.id,
      deletionRevision: 1,
      updatedAt: "2026-08-27T13:10:00.000Z",
    }),
    readTombstone: () => ({
      version: 1 as const,
      resourceId: ready.id,
      deletionRevision: 1,
      deletedAt: "2026-08-27T13:10:00.000Z",
    }),
    readSnapshot: async () => {
      snapshotReads += 1;
      return { snapshot, normalizedBlob: bytes };
    },
  };
  const store = {
    withOperationalTransaction: async <T>(operation: (value: typeof transaction) => Promise<T>) =>
      operation(transaction),
  };
  const retrieval = createResearchResourceRetrieval({
    store: store as never,
  });
  const stale = await retrieval.query({ version: 1, text: "restored", ranking: "exact", limit: 10 });
  assert.deepEqual(stale.hits, []);
  assert.equal(snapshotReads, 0, "stale pre-tombstone snapshots are rejected before publication");

  jobs[0]!.deletionRevision = 1;
  const recreated = await retrieval.query({ version: 1, text: "restored", ranking: "exact", limit: 10 });
  assert.equal(recreated.hits.length, 1, "a completed job at the retained fence proves recreation");
});
