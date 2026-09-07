import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { ContextPackResourceV1, ContextPackV1 } from "@/lib/research-protocol/context-pack.ts";
import { digestProtocolObject, sha256Digest } from "@/lib/research-protocol/digest.ts";
import type { ContextPackBuildReceiptV1 } from "@/lib/research-context-pack.ts";
import {
  ContextPackStoreError,
  createContextPackStore,
  reconcileRestoredContextPacks,
  type ContextPackStore,
} from "@/lib/server/research-context-pack-store.ts";

const scratchRoots: string[] = [];

function tempRoot(): string {
  const root = path.join("/tmp", `ctxpack-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  scratchRoots.push(root);
  return root;
}

function buildPackFixture(): {
  pack: Parameters<ContextPackStore["publishPack"]>[0];
  blobBytes: Uint8Array;
  blobDigest: string;
} {
  const blobBytes = new TextEncoder().encode("hello pack bytes\n");
  const blobDigest = sha256Digest(blobBytes);
  const pack: ContextPackV1 = {
    schema: "opencoven.context-pack/v1",
    id: "ctx_test1",
    digest: "",
    createdAt: "2026-08-28T10:00:00.000Z",
    createdBy: { client: "coven-cave" },
    purpose: "research-run",
    subject: { familiarId: "charm" },
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
    },
    resources: [
      {
        id: "resource_0123456789abcdef0123456789abcdef01234567",
        kind: "saved-resource",
        uri: "coven://ctx_test1/resource_0123456789abcdef0123456789abcdef01234567",
        digest: blobDigest,
        localBlobDigest: blobDigest,
        selector: { type: "whole-resource" },
        trust: "imported-source",
        sensitivity: "public",
        capturedAt: "2026-08-28T10:00:00.000Z",
        mediaType: "text/plain",
      },
    ],
    policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: ["research-run"] },
    transforms: { secretScanVersion: "scan-1" },
  };
  const packWithDigest: ContextPackV1 = { ...pack, digest: digestProtocolObject(pack) };
  const receipt: ContextPackBuildReceiptV1 = {
    version: 1,
    packId: "ctx_test1",
    createdAt: "2026-08-28T10:00:00.000Z",
    resources: [
      {
        packResourceId: "resource_0123456789abcdef0123456789abcdef01234567",
        sourceResourceId: "saved-link-abc",
        snapshotId: "snap-1",
        sourceSelector: { type: "whole-resource" },
        sourceRevision: 3,
        sourceNormalizedBlobDigest: blobDigest,
      },
    ],
  };
  return {
    pack: {
      pack: packWithDigest,
      blobs: new Map([[blobDigest, blobBytes]]),
      receipt,
    },
    blobBytes,
    blobDigest,
  };
}

test("publish then read round-trips with verified bytes", async () => {
  const store = createContextPackStore({ root: tempRoot() });
  const fixture = buildPackFixture();
  const published = await store.publishPack(fixture.pack);
  assert.equal(published.created, true);

  const read = await store.readPack("ctx_test1");
  assert.equal(read.pack.id, "ctx_test1");
  assert.deepEqual(read.blobs.get(fixture.blobDigest), fixture.blobBytes);
  assert.equal(read.receipt.resources[0]?.sourceResourceId, "saved-link-abc");

  const listed = await store.listPacks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, "ctx_test1");

  const validated = await store.validatePack("ctx_test1");
  assert.equal(validated.valid, true);
});

test("publishing the same bytes twice is idempotent", async () => {
  const store = createContextPackStore({ root: tempRoot() });
  const fixture = buildPackFixture();
  const first = await store.publishPack(fixture.pack);
  const second = await store.publishPack(fixture.pack);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
});

test("publishing the same id with different bytes is an immutable conflict", async () => {
  const store = createContextPackStore({ root: tempRoot() });
  const fixture = buildPackFixture();
  await store.publishPack(fixture.pack);

  const otherBytes = new TextEncoder().encode("different bytes\n");
  const otherDigest = sha256Digest(otherBytes);
  const pack: ContextPackV1 = { ...fixture.pack.pack, createdAt: "2026-08-29T10:00:00.000Z" };
  const resources = [{ ...pack.resources[0], digest: otherDigest, localBlobDigest: otherDigest }];
  const packWithDigest: ContextPackV1 = { ...pack, resources, digest: digestProtocolObject({ ...pack, resources }) };
  await assert.rejects(
    () => store.publishPack({ pack: packWithDigest, blobs: new Map([[otherDigest, otherBytes]]), receipt: fixture.pack.receipt }),
    (err: unknown) => err instanceof ContextPackStoreError && err.code === "immutable-conflict",
  );
});

test("a tampered blob fails reads with digest-mismatch", async () => {
  const root = tempRoot();
  const store = createContextPackStore({ root });
  const fixture = buildPackFixture();
  await store.publishPack(fixture.pack);

  const blobFile = path.join(root, "blobs", "sha256", fixture.blobDigest.slice(0, 2), fixture.blobDigest);
  await writeFile(blobFile, "tampered\n");
  await assert.rejects(
    () => store.readPack("ctx_test1"),
    (err: unknown) => err instanceof ContextPackStoreError && err.code === "digest-mismatch",
  );
});

test("unreferenced blobs are rejected at publish", async () => {
  const store = createContextPackStore({ root: tempRoot() });
  const fixture = buildPackFixture();
  const extra = new TextEncoder().encode("extra\n");
  const extraDigest = sha256Digest(extra);
  await assert.rejects(
    () => store.publishPack({ ...fixture.pack, blobs: new Map([...fixture.pack.blobs, [extraDigest, extra]]) }),
    (err: unknown) => err instanceof ContextPackStoreError && err.code === "invalid-pack",
  );
});

test("a non-whole-resource selector is refused at publish", async () => {
  const store = createContextPackStore({ root: tempRoot() });
  const fixture = buildPackFixture();
  const resources: ContextPackResourceV1[] = [{ ...fixture.pack.pack.resources[0]!, selector: { type: "turn-range", start: 0, end: 3 } }];
  const pack: ContextPackV1 = { ...fixture.pack.pack, resources, digest: digestProtocolObject({ ...fixture.pack.pack, resources }) };
  await assert.rejects(
    () => store.publishPack({ ...fixture.pack, pack }),
    (err: unknown) => err instanceof ContextPackStoreError && err.code === "invalid-pack",
  );
});

test("deletion removes the manifest first and GCs unreferenced blobs", async () => {
  const root = tempRoot();
  const store = createContextPackStore({ root });
  const fixture = buildPackFixture();
  await store.publishPack(fixture.pack);

  const deleted = await store.deletePack("ctx_test1");
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.removedBlobDigests, [fixture.blobDigest]);

  const manifestFile = path.join(root, "manifests", "ctx_test1.json");
  await assert.rejects(() => readFile(manifestFile));
  const blobFile = path.join(root, "blobs", "sha256", fixture.blobDigest.slice(0, 2), fixture.blobDigest);
  await assert.rejects(() => readFile(blobFile));

  const secondDelete = await store.deletePack("ctx_test1");
  assert.equal(secondDelete.deleted, false);
});

test("store layout refuses a symlinked manifests directory", async () => {
  const root = tempRoot();
  const storeRoot = path.join(root, "research-context-packs");
  const store = createContextPackStore({ root: storeRoot });
  const fixture = buildPackFixture();
  await store.publishPack(fixture.pack);

  // Replace manifests with a symlink to a scratch dir and expect a refusal.
  const real = path.join(root, "scratch-manifests");
  await mkdir(real, { recursive: true });
  await rm(path.join(storeRoot, "manifests"), { recursive: true, force: true });
  await symlink(real, path.join(storeRoot, "manifests"));
  await assert.rejects(
    () => store.listPacks(),
    (err: unknown) => err instanceof ContextPackStoreError && (err.code === "symlink" || err.code === "unsafe-path"),
  );
});

test("restore reconciliation validates every pack before exposure", async () => {
  const root = tempRoot();
  const store = createContextPackStore({ root });
  const fixture = buildPackFixture();
  await store.publishPack(fixture.pack);

  const good = await reconcileRestoredContextPacks({ root });
  assert.deepEqual(good, { validated: 1, invalid: 0 });

  // Tamper with the pack-owned blob: reconciliation must report it invalid.
  const blobFile = path.join(root, "blobs", "sha256", fixture.blobDigest.slice(0, 2), fixture.blobDigest);
  await writeFile(blobFile, "tampered\n");
  const bad = await reconcileRestoredContextPacks({ root });
  assert.deepEqual(bad, { validated: 0, invalid: 1 });
});

test("root directories are private (0700)", async () => {
  const root = tempRoot();
  const store = createContextPackStore({ root });
  await store.publishPack(buildPackFixture().pack);
  const manifests = await lstat(path.join(root, "manifests"));
  assert.equal(manifests.mode & 0o777, 0o700);
});

console.log("research context pack store: ok");
