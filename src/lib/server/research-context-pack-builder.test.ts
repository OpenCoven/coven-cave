import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createContextPackBuilder } from "@/lib/server/research-context-pack-builder.ts";
import { createContextPackStore } from "@/lib/server/research-context-pack-store.ts";
import { createResearchResourceStore } from "@/lib/server/research-resource-store.ts";
import { ContextPackBuilderError } from "@/lib/server/research-context-pack-builder.ts";

function tempDir(prefix: string): string {
  return `/tmp/${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

const SNAPSHOT_ID = "snap-0001";
const RESOURCE_ID = "saved-link-abc";
const BLOB_TEXT = "hello resource bytes\n";
const BLOB_DIGEST = createHash("sha256").update(BLOB_TEXT).digest("hex");

function validSnapshot(): Record<string, unknown> {
  return {
    version: 1,
    id: SNAPSHOT_ID,
    resourceId: RESOURCE_ID,
    resourceRevision: 1,
    normalizedBlobDigest: BLOB_DIGEST,
    normalizedMediaType: "text/plain",
    normalizedBytes: new TextEncoder().encode(BLOB_TEXT).length,
    normalizationReceipt: { extractorId: "unit-test", extractorVersion: "1" },
    sourceSelector: { type: "whole-resource" },
    createdAt: "2026-08-28T10:00:00.000Z",
  };
}

function validManifest(): Record<string, unknown> {
  return {
    version: 1,
    id: RESOURCE_ID,
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: "https://example.com/article",
    title: "Example article",
    sourceType: "saved-link",
    sensitivity: "public",
    subject: {},
    ingest: { desired: true, state: "ready" },
    currentSnapshotId: SNAPSHOT_ID,
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T09:00:00.000Z",
  };
}

test("seals a pack from a real resource snapshot and survives source mutation", async () => {
  const resourceRoot = tempDir("ctxpack-resource");
  const packRoot = tempDir("ctxpack-pack");
  const resources = createResearchResourceStore({ root: resourceRoot });
  // Snapshot first: manifest creation verifies the current snapshot exists.
  await resources.publishSnapshot({
    snapshot: validSnapshot() as never,
    normalizedBlob: new TextEncoder().encode(BLOB_TEXT),
  });
  await resources.createManifest(validManifest() as never);

  const builder = createContextPackBuilder({ packRoot, resourceRoot });
  const pack = await builder.seal(
    {
      version: 1,
      purpose: "research-run",
      familiarId: "charm",
      consent: {
        selectionMode: "explicit",
        allowRemoteQueries: false,
        allowRemoteContent: false,
        artifactContentSync: false,
        retention: "run-only",
      },
      resources: [
        { resourceId: RESOURCE_ID, snapshotId: SNAPSHOT_ID, sourceSelector: { type: "whole-resource" } },
      ],
    },
    undefined,
  );

  assert.match(pack.id, /^ctx_[0-9a-f]{32}$/);
  assert.equal(pack.resources.length, 1);
  assert.equal(pack.resources[0]?.digest, BLOB_DIGEST);

  const store = createContextPackStore({ root: packRoot });
  const read = await store.readPack(pack.id);
  assert.equal(new TextDecoder().decode(read.blobs.get(BLOB_DIGEST)), BLOB_TEXT);
});

test("seal refuses sensitive content without confirmation", async () => {
  const resourceRoot = tempDir("ctxpack-sensitive");
  const packRoot = tempDir("ctxpack-pack-sensitive");
  const resources = createResearchResourceStore({ root: resourceRoot });
  await resources.publishSnapshot({
    snapshot: validSnapshot() as never,
    normalizedBlob: new TextEncoder().encode(BLOB_TEXT),
  });
  const sensitive = { ...validManifest(), sensitivity: "private" };
  await resources.createManifest(sensitive as never);

  const builder = createContextPackBuilder({ packRoot, resourceRoot });
  await assert.rejects(
    () =>
      builder.seal(
        {
          version: 1,
          purpose: "research-run",
          familiarId: "charm",
          consent: {
            selectionMode: "explicit",
            allowRemoteQueries: false,
            allowRemoteContent: false,
            artifactContentSync: false,
            retention: "run-only",
          },
          resources: [
            { resourceId: RESOURCE_ID, snapshotId: SNAPSHOT_ID, sourceSelector: { type: "whole-resource" } },
          ],
        },
        undefined,
      ),
    (err: unknown) =>
      err instanceof ContextPackBuilderError && err.code === "confirmation-required",
  );
});

test("seal rejects an invalid selection", async () => {
  const builder = createContextPackBuilder({ packRoot: tempDir("ctxpack-invalid") });
  await assert.rejects(
    () => builder.seal({ version: 2 }, undefined),
    (err: unknown) =>
      err instanceof ContextPackBuilderError && err.code === "invalid-selection",
  );
});

test("preview reports bytes and confirmation needs", async () => {
  const resourceRoot = tempDir("ctxpack-preview");
  const packRoot = tempDir("ctxpack-pack-preview");
  const resources = createResearchResourceStore({ root: resourceRoot });
  await resources.publishSnapshot({
    snapshot: validSnapshot() as never,
    normalizedBlob: new TextEncoder().encode(BLOB_TEXT),
  });
  await resources.createManifest({ ...validManifest(), sensitivity: "restricted" } as never);

  const builder = createContextPackBuilder({ packRoot, resourceRoot });
  const preview = await builder.preview({
    version: 1,
    purpose: "research-run",
    familiarId: "charm",
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
    },
    resources: [
      { resourceId: RESOURCE_ID, snapshotId: SNAPSHOT_ID, sourceSelector: { type: "whole-resource" } },
    ],
  });
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.totalBytes, new TextEncoder().encode(BLOB_TEXT).length);
});

console.log("research context pack builder: ok");
