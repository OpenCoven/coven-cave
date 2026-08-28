import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseResearchLinksMigrationJournalV1,
  parseResearchLinksProjectionV1,
  parseResourceEmbeddingTaskV1,
  parseResourceIngestJobV1,
  parseResourceManifestV1,
  parseResourceQueryResponseV1,
  parseResourceQueryV1,
  parseResourceSnapshotV1,
  parseResourceTombstoneV1,
} from "./research-resource-contracts.ts";
import { sha256Digest } from "./research-protocol/digest.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const CREATED_AT = "2026-08-26T12:00:00Z";
const UPDATED_AT = "2026-08-26T12:01:00.100Z";

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: { path: string; message: string } }): T {
  if (!result.ok) assert.fail(`${result.error.path}: ${result.error.message}`);
  return result.value;
}

function expectError(
  result: { ok: true; value: unknown } | { ok: false; error: { path: string; code: string; message: string } },
  path: string,
  code?: string,
): void {
  if (result.ok) assert.fail("expected parse failure");
  assert.equal(result.error.path, path);
  if (code) assert.equal(result.error.code, code);
}

function manifest() {
  return {
    version: 1,
    id: "resource_1",
    revision: 3,
    kind: "paper",
    canonicalIdentity: "arxiv:2608.00001",
    title: "A local-first research system",
    sourceUri: "https://arxiv.org/abs/2608.00001",
    sourceType: "arxiv",
    category: "paper",
    publishedAt: "2026-08-25T10:00:00Z",
    legacySavedLink: {
      id: "saved_1",
      url: "https://arxiv.org/abs/2608.00001",
      addedAt: "2026-08-26T10:00:00Z",
      source: "desk",
      futureLegacyField: true,
    },
    paper: {
      arxivId: "2608.00001",
      authors: ["Ada Lovelace"],
      abstract: "Local evidence.",
      publishedAt: "2026-08-25T10:00:00Z",
      futurePaperField: "kept",
    },
    subject: { familiarId: "familiar_1", projectId: "project_1", futureSubjectField: 1 },
    sensitivity: "private",
    ingest: { desired: true, state: "ready", futureIngestField: [1, 2] },
    currentSnapshotId: "snapshot_1",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    futureManifestField: { preserved: true },
  } as const;
}

test("manifest parses the approved compatibility fields and preserves safe additive data", () => {
  const input = structuredClone(manifest());
  const parsed = expectOk(parseResourceManifestV1(input));
  assert.equal((parsed.futureManifestField as { preserved: boolean }).preserved, true);
  assert.equal(parsed.legacySavedLink?.futureLegacyField, true);
  assert.equal(parsed.paper?.futurePaperField, "kept");
  assert.notStrictEqual(parsed, input);
  assert.notStrictEqual(parsed.subject, input.subject);
});

test("manifest rejects invalid versions, unsafe revisions, and inconsistent ingest state", () => {
  expectError(parseResourceManifestV1({ ...manifest(), version: 2 }), "$.version", "invalid_value");
  expectError(parseResourceManifestV1({ ...manifest(), revision: 0 }), "$.revision", "invalid_value");
  expectError(
    parseResourceManifestV1({ ...manifest(), ingest: { desired: false, state: "queued" } }),
    "$.ingest",
    "semantic_conflict",
  );
  const { currentSnapshotId: _snapshot, ...withoutSnapshot } = manifest();
  expectError(parseResourceManifestV1(withoutSnapshot), "$.currentSnapshotId", "semantic_conflict");
  assert.equal(
    expectOk(parseResourceManifestV1({ ...manifest(), ingest: { desired: true, state: "failed", lastFailureCode: "timeout" } })).ingest.lastFailureCode,
    "timeout",
    "lastFailureCode is independently optional",
  );
  assert.equal(
    expectOk(parseResourceManifestV1({ ...manifest(), ingest: { desired: true, state: "failed", retryable: false } })).ingest.retryable,
    false,
    "retryable is independently optional",
  );
  expectError(
    parseResourceManifestV1({ ...manifest(), updatedAt: "2026-08-26T11:59:59Z" }),
    "$.updatedAt",
    "semantic_conflict",
  );
});

function snapshot() {
  return {
    version: 1,
    id: "snapshot_1",
    resourceId: "resource_1",
    resourceRevision: 3,
    rawBlobDigest: DIGEST_B,
    normalizedBlobDigest: DIGEST_A,
    normalizedMediaType: "text/plain; charset=utf-8",
    normalizedBytes: 20,
    normalizationReceipt: { extractorId: "pdf-text", extractorVersion: "1.4.0" },
    sourceSelector: { type: "pdf-page-span", page: 1, start: 0, end: 10, futureSelectorField: true },
    pageBoundaries: [
      { page: 1, start: 0, end: 10, extractorReceipt: "v1" },
      { page: 2, start: 10, end: 20 },
    ],
    fetchedAt: UPDATED_AT,
    finalUrl: "https://example.test/paper.pdf",
    etag: "etag-1",
    lastModified: "Wed, 26 Aug 2026 12:01:00 GMT",
    createdAt: UPDATED_AT,
    futureSnapshotField: "kept",
  } as const;
}

test("snapshot delegates exact selectors to A0 and validates deterministic page boundaries", () => {
  const input = structuredClone(snapshot());
  const parsed = expectOk(parseResourceSnapshotV1(input));
  assert.equal(parsed.sourceSelector.type, "pdf-page-span");
  assert.deepEqual(parsed.normalizationReceipt, {
    extractorId: "pdf-text",
    extractorVersion: "1.4.0",
  });
  (input.normalizationReceipt as { extractorVersion: string }).extractorVersion =
    "changed-after-parse";
  assert.equal(parsed.normalizationReceipt.extractorVersion, "1.4.0");
  assert.equal(parsed.sourceSelector.futureSelectorField, true);
  assert.equal(parsed.pageBoundaries?.[0]?.extractorReceipt, "v1");
  assert.equal(parsed.futureSnapshotField, "kept");

  expectError(
    parseResourceSnapshotV1({ ...snapshot(), sourceSelector: { type: "text-span", start: 4, end: 4 } }),
    "$.sourceSelector",
    "semantic_conflict",
  );
  expectError(
    parseResourceSnapshotV1({ ...snapshot(), pageBoundaries: [{ page: 1, start: 0, end: 12 }, { page: 2, start: 11, end: 20 }] }),
    "$.pageBoundaries[1].start",
    "semantic_conflict",
  );
  expectError(
    parseResourceSnapshotV1({ ...snapshot(), pageBoundaries: [{ page: 2, start: 0, end: 10 }] }),
    "$.pageBoundaries[0].page",
    "semantic_conflict",
  );
  expectError(
    parseResourceSnapshotV1({ ...snapshot(), sourceSelector: { type: "text-span", start: 0, end: 21 } }),
    "$.sourceSelector.end",
    "semantic_conflict",
  );
  const { pageBoundaries: _boundaries, ...withoutPageBoundaries } = snapshot();
  expectError(
    parseResourceSnapshotV1(withoutPageBoundaries),
    "$.pageBoundaries",
    "semantic_conflict",
  );
  expectError(
    parseResourceSnapshotV1({ ...snapshot(), sourceSelector: { type: "pdf-page-span", page: 3, start: 0, end: 1 } }),
    "$.sourceSelector.page",
    "semantic_conflict",
  );
  expectError(
    parseResourceSnapshotV1({ ...snapshot(), sourceSelector: { type: "pdf-page-span", page: 2, start: 0, end: 11 } }),
    "$.sourceSelector.end",
    "semantic_conflict",
  );
  const { normalizationReceipt: _receipt, ...withoutReceipt } = snapshot();
  expectError(
    parseResourceSnapshotV1(withoutReceipt),
    "$.normalizationReceipt",
    "missing_field",
  );
  expectError(
    parseResourceSnapshotV1({
      ...snapshot(),
      normalizationReceipt: { extractorId: " pdf-text", extractorVersion: "1.4.0" },
    }),
    "$.normalizationReceipt.extractorId",
    "invalid_value",
  );
  for (const [field, value] of [
    ["extractorId", ""],
    ["extractorId", "pdf-text "],
    ["extractorVersion", ""],
    ["extractorVersion", " 1.4.0"],
  ] as const) {
    expectError(
      parseResourceSnapshotV1({
        ...snapshot(),
        normalizationReceipt: {
          extractorId: field === "extractorId" ? value : "pdf-text",
          extractorVersion: field === "extractorVersion" ? value : "1.4.0",
        },
      }),
      `$.normalizationReceipt.${field}`,
      "invalid_value",
    );
  }
  expectError(
    parseResourceSnapshotV1({
      ...snapshot(),
      normalizationReceipt: {
        extractorId: "pdf-text",
        extractorVersion: "1.4.0",
        localBinaryPath: "/tmp/extractor",
      },
    }),
    "$.normalizationReceipt.localBinaryPath",
    "invalid_value",
  );
});

function ingestJob() {
  return {
    version: 1,
    id: "job_1",
    resourceId: "resource_1",
    resourceRevision: 3,
    deletionRevision: 0,
    status: "claimed",
    stage: "extract",
    attempt: 1,
    availableAt: CREATED_AT,
    lease: {
      owner: "worker_1",
      token: "0123456789abcdef0123456789abcdef",
      expiresAt: "2026-08-26T12:05:00Z",
      futureLeaseField: true,
    },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    futureJobField: true,
  } as const;
}

test("ingest jobs preserve operational intent and enforce lease truth", () => {
  const parsed = expectOk(parseResourceIngestJobV1(ingestJob()));
  assert.equal(parsed.lease?.futureLeaseField, true);
  assert.equal(parsed.futureJobField, true);

  const { lease: _lease, ...withoutLease } = ingestJob();
  expectError(parseResourceIngestJobV1(withoutLease), "$.lease", "semantic_conflict");
  expectError(parseResourceIngestJobV1({ ...ingestJob(), status: "queued" }), "$.lease", "semantic_conflict");
  expectError(
    parseResourceIngestJobV1({ ...ingestJob(), lease: { ...ingestJob().lease, token: "short" } }),
    "$.lease.token",
    "invalid_value",
  );
  const { token: _token, ...leaseWithoutToken } = ingestJob().lease;
  expectError(
    parseResourceIngestJobV1({ ...ingestJob(), lease: leaseWithoutToken }),
    "$.lease.token",
    "missing_field",
  );
  expectError(parseResourceIngestJobV1({ ...ingestJob(), deletionRevision: -1 }), "$.deletionRevision", "invalid_value");
});

test("embedding tasks are versioned best-effort state with bounded numeric fields", () => {
  const task = {
    version: 1,
    resourceId: "resource_1",
    snapshotId: "snapshot_1",
    lexicalRevision: 2,
    providerId: "loopback",
    modelId: "embedding-model",
    dimensions: 768,
    status: "unavailable",
    updatedAt: UPDATED_AT,
    providerReceipt: { local: true },
  } as const;
  const parsed = expectOk(parseResourceEmbeddingTaskV1(task));
  assert.deepEqual(parsed.providerReceipt, { local: true });
  expectError(parseResourceEmbeddingTaskV1({ ...task, dimensions: 0 }), "$.dimensions", "invalid_value");
  expectError(parseResourceEmbeddingTaskV1({ ...task, status: "completed" }), "$.status", "invalid_value");
});

test("tombstones are a strict privacy allowlist", () => {
  const tombstone = {
    version: 1,
    resourceId: "resource_1",
    deletionRevision: 4,
    deletedAt: UPDATED_AT,
  } as const;
  assert.deepEqual(expectOk(parseResourceTombstoneV1(tombstone)), tombstone);
  expectError(parseResourceTombstoneV1({ ...tombstone, title: "private title" }), "$.title", "invalid_value");
  expectError(parseResourceTombstoneV1({ ...tombstone, deletionRevision: 0 }), "$.deletionRevision", "invalid_value");
});

test("saved-link migration records carry verified projection revisions and preserve extensions", () => {
  const projection = expectOk(parseResearchLinksProjectionV1({
    version: 1,
    catalogRevision: 8,
    projectedDigest: DIGEST_A,
    generatedAt: CREATED_AT,
    writerVersion: "0.3",
  }));
  assert.equal(projection.writerVersion, "0.3");

  const journal = expectOk(parseResearchLinksMigrationJournalV1({
    version: 1,
    catalogRevision: 9,
    intendedProjectionDigest: DIGEST_B,
    startedAt: UPDATED_AT,
    repairAttempt: 2,
  }));
  assert.equal(journal.repairAttempt, 2);
  expectError(parseResearchLinksProjectionV1({ ...projection, projectedDigest: DIGEST_A.toUpperCase() }), "$.projectedDigest", "invalid_value");
});

function query() {
  return {
    version: 1,
    text: "local research",
    filters: {
      projectIds: ["project_1"],
      familiarIds: ["familiar_1"],
      kinds: ["paper", "saved-resource"],
      sensitivities: ["private"],
      ingestStates: ["ready"],
      publishedFrom: "2026-08-01T00:00:00Z",
      publishedBefore: "2026-09-01T00:00:00Z",
      contextPackId: "pack_1",
      futureFilter: true,
    },
    ranking: "hybrid",
    limit: 25,
    futureQueryField: "kept",
  } as const;
}

test("query validates every approved pre-ranking filter and preserves request extensions", () => {
  const parsed = expectOk(parseResourceQueryV1(query()));
  assert.equal(parsed.filters?.futureFilter, true);
  assert.equal(parsed.futureQueryField, "kept");
  expectError(parseResourceQueryV1({ ...query(), text: "   " }), "$.text", "invalid_value");
  expectError(parseResourceQueryV1({ ...query(), limit: 101 }), "$.limit", "invalid_value");
  expectError(parseResourceQueryV1({ ...query(), filters: { ...query().filters, kinds: [] } }), "$.filters.kinds", "invalid_value");
  expectError(
    parseResourceQueryV1({ ...query(), filters: { ...query().filters, publishedFrom: "2026-09-01T00:00:00Z" } }),
    "$.filters",
    "semantic_conflict",
  );
  expectError(parseResourceQueryV1({ ...query(), filters: { ...query().filters, projectIds: ["project_1", "project_1"] } }), "$.filters.projectIds[1]", "invalid_value");
});

function queryResponse() {
  return {
    version: 1,
    ranking: "hybrid",
    hits: [{
      resourceId: "resource_1",
      snapshotId: "snapshot_1",
      resourceRevision: 3,
      normalizedBlobDigest: DIGEST_A,
      selector: { type: "text-span", start: 0, end: 14 },
      excerpt: "local research",
      excerptDigest: sha256Digest("local research"),
      retrieval: {
        exact: true,
        lexical: { matched: true, rank: 1 },
        semantic: { state: "ready", matched: true, rank: 2 },
      },
    }],
  } as const;
}

test("query response carries authoritative snapshot identity and truthful retrieval evidence", () => {
  const parsed = expectOk(parseResourceQueryResponseV1(queryResponse()));
  assert.equal(parsed.hits[0]?.resourceRevision, 3);
  assert.equal(parsed.hits[0]?.retrieval.semantic.state, "ready");
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [{ ...queryResponse().hits[0], retrieval: { ...queryResponse().hits[0].retrieval, semantic: { state: "unavailable", matched: true, rank: 1 } } }] }),
    "$.hits[0].retrieval.semantic",
    "semantic_conflict",
  );
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [{ ...queryResponse().hits[0], retrieval: { ...queryResponse().hits[0].retrieval, lexical: { matched: false, rank: 1 } } }] }),
    "$.hits[0].retrieval.lexical",
    "semantic_conflict",
  );
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [{ ...queryResponse().hits[0], localPath: "/private/research.txt" }] }),
    "$.hits[0].localPath",
    "invalid_value",
  );
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [{ ...queryResponse().hits[0], excerpt: "changed bytes" }] }),
    "$.hits[0].excerptDigest",
    "digest_mismatch",
  );
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [{ ...queryResponse().hits[0], selector: { ...queryResponse().hits[0].selector, sourceUri: "file:///private/research.txt" } }] }),
    "$.hits[0].selector.sourceUri",
    "invalid_value",
  );
  expectError(
    parseResourceQueryResponseV1({ ...queryResponse(), hits: [queryResponse().hits[0], queryResponse().hits[0]] }),
    "$.hits[1]",
    "semantic_conflict",
  );
});

test("all parsers reject non-canonical JSON containers before reading fields", () => {
  const hidden = { ...manifest() };
  Object.defineProperty(hidden, "secret", { value: "not enumerable", enumerable: false });
  expectError(parseResourceManifestV1(hidden), "$", "invalid_value");

  const sparse = { ...query(), filters: { projectIds: ["project_1", , "project_2"] } };
  expectError(parseResourceQueryV1(sparse), "$", "invalid_value");
});
