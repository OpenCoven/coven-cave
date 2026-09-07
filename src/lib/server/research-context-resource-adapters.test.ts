import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createResourceSnapshotContextAdapter } from "@/lib/server/research-context-resource-adapters.ts";
import { createResearchResourceStore } from "@/lib/server/research-resource-store.ts";

const text = "adapter bytes\n";
const digest = createHash("sha256").update(text).digest("hex");
const ROOT = `/tmp/ctxpack-adapter-${process.pid}-${Math.random().toString(36).slice(2)}`;

function snapshot(): Record<string, unknown> {
  return {
    version: 1,
    id: "snap-1",
    resourceId: "saved-link-abc",
    resourceRevision: 1,
    normalizedBlobDigest: digest,
    normalizedMediaType: "text/plain",
    normalizedBytes: new TextEncoder().encode(text).length,
    normalizationReceipt: { extractorId: "unit-test", extractorVersion: "1" },
    sourceSelector: { type: "whole-resource" },
    createdAt: "2026-08-28T10:00:00.000Z",
  };
}

function manifest(): Record<string, unknown> {
  return {
    version: 1,
    id: "saved-link-abc",
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: "https://example.com/article",
    title: "Example article",
    sourceType: "saved-link",
    sensitivity: "public",
    subject: {},
    ingest: { desired: true, state: "ready" },
    currentSnapshotId: "snap-1",
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T09:00:00.000Z",
  };
}

test("adapter previews and snapshots a ready resource", async () => {
  const resources = createResearchResourceStore({ root: ROOT });
  await resources.publishSnapshot({ snapshot: snapshot() as never, normalizedBlob: new TextEncoder().encode(text) });
  await resources.createManifest(manifest() as never);
  const adapter = createResourceSnapshotContextAdapter({ store: resources });

  const preview = await adapter.preview({
    resourceId: "saved-link-abc",
    snapshotId: "snap-1",
    sourceSelector: { type: "whole-resource" },
  });
  assert.equal(preview.bytes, new TextEncoder().encode(text).length);
  assert.equal(preview.kind, "saved-resource");

  const sealed = await adapter.snapshot(
    {
      resourceId: "saved-link-abc",
      snapshotId: "snap-1",
      sourceSelector: { type: "whole-resource" },
    },
    [],
    "ctx_test",
  );
  assert.equal(sealed.resource.digest, digest);
  assert.equal(sealed.resource.selector.type, "whole-resource");
  assert.equal(sealed.resource.trust, "imported-source");
});

test("adapter refuses a stale snapshot selection", async () => {
  const resources = createResearchResourceStore({ root: `${ROOT}-stale` });
  await resources.publishSnapshot({ snapshot: snapshot() as never, normalizedBlob: new TextEncoder().encode(text) });
  await resources.createManifest(manifest() as never);
  const adapter = createResourceSnapshotContextAdapter({ store: resources });

  await assert.rejects(
    () =>
      adapter.preview({
        resourceId: "saved-link-abc",
        snapshotId: "snap-wrong",
        sourceSelector: { type: "whole-resource" },
      }),
    (err: unknown) => (err as Error).message.includes("moved to snapshot"),
  );
});

console.log("research context resource adapters: ok");
