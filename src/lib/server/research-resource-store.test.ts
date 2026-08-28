import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ResourceIngestJobV1,
  ResourceManifestV1,
  ResourceSnapshotV1,
} from "../research-resource-contracts.ts";
import {
  createResearchResourceStore,
  ResearchResourceStoreError,
  type ResourceDeletionJournalV1,
  type ResourceEmbeddingTaskRecordV1,
  type ResourceIngestFailureV1,
} from "./research-resource-store.ts";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function embeddingTask(
  resourceId: string,
  patch: Partial<ResourceEmbeddingTaskRecordV1> = {},
): ResourceEmbeddingTaskRecordV1 {
  return {
    version: 1,
    resourceId,
    snapshotId: `snapshot-${resourceId}`,
    lexicalRevision: 1,
    providerId: "local-openai",
    modelId: "nomic-embed-text",
    dimensions: 3,
    modelRevision: "a".repeat(64),
    status: "queued",
    updatedAt: "2026-08-27T12:00:01Z",
    ...patch,
  };
}

function snapshot(input: {
  id: string;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
  resourceId?: string;
  resourceRevision?: number;
}): ResourceSnapshotV1 {
  return {
    version: 1,
    id: input.id,
    resourceId: input.resourceId ?? "resource_1",
    resourceRevision: input.resourceRevision ?? 1,
    ...(input.rawBlob === undefined ? {} : { rawBlobDigest: digest(input.rawBlob) }),
    normalizedBlobDigest: digest(input.normalizedBlob),
    normalizedMediaType: "text/plain; charset=utf-8",
    normalizedBytes: input.normalizedBlob.byteLength,
    normalizationReceipt: {
      extractorId: "plain-text",
      extractorVersion: "1.0.0",
    },
    sourceSelector: { type: "whole-resource" },
    createdAt: "2026-08-27T04:00:00Z",
  };
}

function manifest(
  id: string,
  patch: Partial<ResourceManifestV1> = {},
): ResourceManifestV1 {
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
      addedAt: "2026-08-27T12:00:00Z",
      source: "desk",
    },
    subject: {},
    sensitivity: "private",
    ingest: { desired: false, state: "metadata_only" },
    createdAt: "2026-08-27T12:00:00Z",
    updatedAt: "2026-08-27T12:00:00Z",
    ...patch,
  };
}

async function fixture(
  operation: (input: { root: string; outside: string }) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(path.join(tmpdir(), "cave-resource-store-test-"));
  const root = path.join(parent, "store");
  const outside = path.join(parent, "outside");
  await mkdir(outside, { mode: 0o700 });
  try {
    await operation({ root, outside });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function hasStoreCode(code: ResearchResourceStoreError["code"]): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof ResearchResourceStoreError && error.code === code;
}

function blobPath(root: string, sha256: string): string {
  return path.join(root, "blobs", "sha256", sha256.slice(0, 2), sha256);
}

function ingestJob(resourceId: string): ResourceIngestJobV1 {
  return {
    version: 1,
    id: `job-${resourceId}`,
    resourceId,
    resourceRevision: 1,
    deletionRevision: 0,
    status: "queued",
    stage: "fetch",
    attempt: 0,
    availableAt: "2026-08-27T12:00:00Z",
    createdAt: "2026-08-27T12:00:00Z",
    updatedAt: "2026-08-27T12:00:00Z",
  };
}

test("publishes and verifies an immutable snapshot with private storage modes", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("normalized research text\n", "utf8");
    const rawBlob = Buffer.from("RAW research text\r\n", "utf8");
    const record = snapshot({ id: "snapshot_publish", normalizedBlob, rawBlob });
    const store = createResearchResourceStore({ root });

    const published = await store.publishSnapshot({
      snapshot: record,
      normalizedBlob,
      rawBlob,
    });
    assert.equal(published.created, true);
    assert.deepEqual(published.snapshot, record);

    const verified = await store.readSnapshot(record.id);
    assert.deepEqual(verified.snapshot, record);
    assert.deepEqual(verified.normalizedBlob, new Uint8Array(normalizedBlob));
    assert.deepEqual(verified.rawBlob, new Uint8Array(rawBlob));

    if (process.platform !== "win32") {
      for (const directory of [
        root,
        path.join(root, "snapshots"),
        path.join(root, "blobs"),
        path.join(root, "blobs", "sha256"),
        path.dirname(blobPath(root, record.normalizedBlobDigest)),
      ]) {
        assert.equal((await lstat(directory)).mode & 0o777, 0o700, `${directory} is private`);
      }
      for (const file of [
        path.join(root, "snapshots", `${record.id}.json`),
        blobPath(root, record.normalizedBlobDigest),
        blobPath(root, record.rawBlobDigest!),
      ]) {
        assert.equal((await lstat(file)).mode & 0o777, 0o600, `${file} is private`);
      }
    }
  });
});

test("embedding tasks persist privately and serialize strict replayable transitions", async () => {
  await fixture(async ({ root }) => {
    const resourceId = "semantic_resource";
    const normalizedBlob = Buffer.from("semantic source", "utf8");
    const record = snapshot({
      id: `snapshot-${resourceId}`,
      normalizedBlob,
      resourceId,
      resourceRevision: 1,
    });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });
    await store.createManifest(manifest(resourceId, {
      ingest: { desired: true, state: "ready" },
      currentSnapshotId: record.id,
    }));

    const queued = embeddingTask(resourceId);
    await store.withOperationalTransaction(async (transaction) => {
      await assert.rejects(
        transaction.createEmbeddingTask({ ...queued, modelRevision: "not-a-digest" }),
        hasStoreCode("invalid-operational-record"),
      );
      assert.equal((await transaction.createEmbeddingTask(queued)).created, true);
      assert.equal((await transaction.createEmbeddingTask(queued)).created, false);
      assert.deepEqual(transaction.listEmbeddingTasks(), [queued]);
      assert.deepEqual(transaction.readEmbeddingTask(resourceId), queued);
      const building = await transaction.replaceEmbeddingTask(queued, {
        ...queued,
        status: "building",
        updatedAt: "2026-08-27T12:00:02Z",
      });
      const replayed = await transaction.replaceEmbeddingTask(building, {
        ...building,
        status: "queued",
        updatedAt: "2026-08-27T12:00:03Z",
      });
      assert.equal(replayed.status, "queued");
    });

    if (process.platform !== "win32") {
      assert.equal((await lstat(path.join(root, "embedding-tasks"))).mode & 0o777, 0o700);
      assert.equal((await lstat(path.join(root, "embedding-tasks", `${resourceId}.json`))).mode & 0o777, 0o600);
    }

    await store.withOperationalTransaction(async (transaction) => {
      const current = transaction.readEmbeddingTask(resourceId)!;
      assert.equal(await transaction.removeEmbeddingTask(resourceId, current), true);
      assert.equal(await transaction.removeEmbeddingTask(resourceId), false);
    });
  });
});

test("identical publication is idempotent and changed replay is an immutable conflict", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("stable bytes", "utf8");
    const record = snapshot({ id: "snapshot_replay", normalizedBlob });
    const store = createResearchResourceStore({ root });

    assert.equal((await store.publishSnapshot({ snapshot: record, normalizedBlob })).created, true);
    const reordered: ResourceSnapshotV1 = {
      createdAt: record.createdAt,
      sourceSelector: record.sourceSelector,
      normalizationReceipt: record.normalizationReceipt,
      normalizedBytes: record.normalizedBytes,
      normalizedMediaType: record.normalizedMediaType,
      normalizedBlobDigest: record.normalizedBlobDigest,
      resourceRevision: record.resourceRevision,
      resourceId: record.resourceId,
      id: record.id,
      version: record.version,
    };
    assert.equal((await store.publishSnapshot({ snapshot: reordered, normalizedBlob })).created, false);

    const changed = { ...record, resourceRevision: record.resourceRevision + 1 };
    await assert.rejects(
      () => store.publishSnapshot({ snapshot: changed, normalizedBlob }),
      hasStoreCode("immutable-conflict"),
    );
    assert.equal((await store.readSnapshot(record.id)).snapshot.resourceRevision, 1);
  });
});

test("rejects normalized digest and length mismatches plus inconsistent raw receipts", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("normalized", "utf8");
    const rawBlob = Buffer.from("raw", "utf8");
    const store = createResearchResourceStore({ root });

    const wrongLength = {
      ...snapshot({ id: "wrong_length", normalizedBlob }),
      normalizedBytes: normalizedBlob.byteLength + 1,
    };
    await assert.rejects(
      () => store.publishSnapshot({ snapshot: wrongLength, normalizedBlob }),
      hasStoreCode("digest-mismatch"),
    );

    const wrongDigest = {
      ...snapshot({ id: "wrong_digest", normalizedBlob }),
      normalizedBlobDigest: digest(Buffer.from("different", "utf8")),
    };
    await assert.rejects(
      () => store.publishSnapshot({ snapshot: wrongDigest, normalizedBlob }),
      hasStoreCode("digest-mismatch"),
    );

    const expectsRaw = snapshot({ id: "missing_raw", normalizedBlob, rawBlob });
    await assert.rejects(
      () => store.publishSnapshot({ snapshot: expectsRaw, normalizedBlob }),
      hasStoreCode("invalid-snapshot"),
    );

    const rejectsUnexpectedRaw = snapshot({ id: "unexpected_raw", normalizedBlob });
    await assert.rejects(
      () => store.publishSnapshot({
        snapshot: rejectsUnexpectedRaw,
        normalizedBlob,
        rawBlob,
      }),
      hasStoreCode("invalid-snapshot"),
    );

    await assert.rejects(
      () => store.publishSnapshot({
        snapshot: expectsRaw,
        normalizedBlob,
        rawBlob: Buffer.from("not raw", "utf8"),
      }),
      hasStoreCode("digest-mismatch"),
    );
  });
});

test("rejects unsafe snapshot ids on publish, read, and delete", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("safe content", "utf8");
    const store = createResearchResourceStore({ root });

    for (const id of [
      "../escape",
      "nested/name",
      "nested\\name",
      "CON",
      "café",
      `a${"b".repeat(128)}`,
    ]) {
      await assert.rejects(
        () => store.publishSnapshot({ snapshot: snapshot({ id, normalizedBlob }), normalizedBlob }),
        hasStoreCode("invalid-id"),
      );
      await assert.rejects(() => store.readSnapshot(id), hasStoreCode("invalid-id"));
      await assert.rejects(() => store.deleteSnapshot(id), hasStoreCode("invalid-id"));
    }
    for (const id of [" leading", "trailing "]) {
      await assert.rejects(
        () => store.publishSnapshot({ snapshot: snapshot({ id, normalizedBlob }), normalizedBlob }),
        hasStoreCode("invalid-snapshot"),
      );
      await assert.rejects(() => store.readSnapshot(id), hasStoreCode("invalid-id"));
      await assert.rejects(() => store.deleteSnapshot(id), hasStoreCode("invalid-id"));
    }
  });
});

test("refuses broader existing POSIX permissions instead of repairing pathname races", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX mode bits do not apply on Windows");
    return;
  }
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("private bytes", "utf8");
    const record = snapshot({ id: "snapshot_private", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    await chmod(root, 0o755);
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("unsafe-path"));
    assert.equal((await lstat(root)).mode & 0o777, 0o755);
  });
});

test("deletion retains shared blobs until the final immutable reference is removed", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("shared normalized bytes", "utf8");
    const rawOne = Buffer.from("raw one", "utf8");
    const rawTwo = Buffer.from("raw two", "utf8");
    const first = snapshot({ id: "snapshot_first", normalizedBlob, rawBlob: rawOne });
    const second = snapshot({
      id: "snapshot_second",
      normalizedBlob,
      rawBlob: rawTwo,
      resourceRevision: 2,
    });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: first, normalizedBlob, rawBlob: rawOne });
    await store.publishSnapshot({ snapshot: second, normalizedBlob, rawBlob: rawTwo });

    const firstDeletion = await store.deleteSnapshot(first.id);
    assert.equal(firstDeletion.deleted, true);
    assert.deepEqual(firstDeletion.removedBlobDigests, [first.rawBlobDigest]);
    assert.deepEqual((await store.readSnapshot(second.id)).normalizedBlob, new Uint8Array(normalizedBlob));
    await assert.rejects(() => lstat(blobPath(root, first.rawBlobDigest!)), { code: "ENOENT" });
    assert.equal((await lstat(blobPath(root, first.normalizedBlobDigest))).isFile(), true);

    const secondDeletion = await store.deleteSnapshot(second.id);
    assert.equal(secondDeletion.deleted, true);
    assert.deepEqual(
      secondDeletion.removedBlobDigests,
      [second.normalizedBlobDigest, second.rawBlobDigest].sort(),
    );
    assert.deepEqual(await store.deleteSnapshot(second.id), {
      deleted: false,
      removedBlobDigests: [],
    });
  });
});

test("raw and normalized bytes with one digest use and collect one CAS entry", async () => {
  await fixture(async ({ root }) => {
    const bytes = Buffer.from("identical raw and normalized bytes", "utf8");
    const record = snapshot({ id: "snapshot_one_digest", normalizedBlob: bytes, rawBlob: bytes });
    const store = createResearchResourceStore({ root });

    await store.publishSnapshot({ snapshot: record, normalizedBlob: bytes, rawBlob: bytes });
    assert.equal(record.rawBlobDigest, record.normalizedBlobDigest);
    assert.equal((await lstat(blobPath(root, record.normalizedBlobDigest))).isFile(), true);

    assert.deepEqual(await store.deleteSnapshot(record.id), {
      deleted: true,
      removedBlobDigests: [record.normalizedBlobDigest],
    });
    await assert.rejects(() => lstat(blobPath(root, record.normalizedBlobDigest)), {
      code: "ENOENT",
    });
  });
});

test("verified reads reject blob corruption instead of returning untrusted bytes", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("original bytes", "utf8");
    const record = snapshot({ id: "snapshot_corrupt", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    await writeFile(blobPath(root, record.normalizedBlobDigest), Buffer.from("tampered bytes", "utf8"));
    if (process.platform !== "win32") {
      await chmod(blobPath(root, record.normalizedBlobDigest), 0o600);
    }
    await assert.rejects(
      () => store.readSnapshot(record.id),
      hasStoreCode("digest-mismatch"),
    );
  });
});

test("publication refuses a corrupted existing CAS winner and missing blobs fail reads", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("winner bytes", "utf8");
    const record = snapshot({ id: "snapshot_winner", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    await writeFile(blobPath(root, record.normalizedBlobDigest), Buffer.from("corrupt", "utf8"));
    if (process.platform !== "win32") {
      await chmod(blobPath(root, record.normalizedBlobDigest), 0o600);
    }
    await assert.rejects(
      () => store.publishSnapshot({ snapshot: record, normalizedBlob }),
      hasStoreCode("corrupt"),
    );

    await unlink(blobPath(root, record.normalizedBlobDigest));
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("missing"));
  });
});

test("a malformed sibling snapshot blocks deletion reference accounting", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("target bytes", "utf8");
    const siblingBlob = Buffer.from("sibling bytes", "utf8");
    const target = snapshot({ id: "snapshot_target", normalizedBlob });
    const sibling = snapshot({ id: "snapshot_sibling", normalizedBlob: siblingBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: target, normalizedBlob });
    await store.publishSnapshot({ snapshot: sibling, normalizedBlob: siblingBlob });

    const siblingPath = path.join(root, "snapshots", `${sibling.id}.json`);
    await writeFile(siblingPath, "{not-json", { mode: 0o600 });
    await assert.rejects(
      () => store.deleteSnapshot(target.id),
      hasStoreCode("corrupt"),
    );
    assert.deepEqual((await store.readSnapshot(target.id)).normalizedBlob, new Uint8Array(normalizedBlob));
  });
});

test("refuses symlinked snapshot and blob entries", async (t) => {
  if (process.platform === "win32") {
    t.skip("creating symlinks is not reliably available to unprivileged Windows tests");
    return;
  }
  await fixture(async ({ root, outside }) => {
    const normalizedBlob = Buffer.from("symlink target bytes", "utf8");
    const record = snapshot({ id: "snapshot_symlink", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    const externalRecord = path.join(outside, "external-record.json");
    await writeFile(externalRecord, JSON.stringify(record), { mode: 0o600 });
    const recordPath = path.join(root, "snapshots", `${record.id}.json`);
    const canonicalRecord = await readFile(recordPath);
    await unlink(recordPath);
    await symlink(externalRecord, recordPath);
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("symlink"));

    await unlink(recordPath);
    await writeFile(recordPath, canonicalRecord, { mode: 0o600 });
    const externalBlob = path.join(outside, "external-blob");
    await writeFile(externalBlob, normalizedBlob, { mode: 0o600 });
    const storedBlob = blobPath(root, record.normalizedBlobDigest);
    await unlink(storedBlob);
    await symlink(externalBlob, storedBlob);
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("symlink"));
  });
});

test("refuses an in-root symlinked blob shard on reads and deletion", async (t) => {
  if (process.platform === "win32") {
    t.skip("creating symlinks is not reliably available to unprivileged Windows tests");
    return;
  }
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("shard link bytes", "utf8");
    const record = snapshot({ id: "snapshot_shard_link", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    const shard = path.dirname(blobPath(root, record.normalizedBlobDigest));
    const movedShard = `${shard}-moved`;
    await rename(shard, movedShard);
    await symlink(movedShard, shard);

    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("symlink"));
    await assert.rejects(() => store.deleteSnapshot(record.id), hasStoreCode("symlink"));
    assert.equal(
      (await lstat(path.join(root, "snapshots", `${record.id}.json`))).isFile(),
      true,
    );
    assert.equal((await lstat(path.join(movedShard, record.normalizedBlobDigest))).isFile(), true);
  });
});

test("refuses multiply-linked snapshot and blob files", async (t) => {
  if (process.platform === "win32") {
    t.skip("hard-link permission and volume behavior varies on Windows CI");
    return;
  }
  await fixture(async ({ root, outside }) => {
    const normalizedBlob = Buffer.from("hard-linked bytes", "utf8");
    const record = snapshot({ id: "snapshot_hardlink", normalizedBlob });
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });

    const recordPath = path.join(root, "snapshots", `${record.id}.json`);
    const recordLink = path.join(outside, "record-link.json");
    await link(recordPath, recordLink);
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("unsafe-path"));
    await unlink(recordLink);

    const storedBlob = blobPath(root, record.normalizedBlobDigest);
    const blobLink = path.join(outside, "blob-link");
    await link(storedBlob, blobLink);
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("unsafe-path"));
    await assert.rejects(() => store.deleteSnapshot(record.id), hasStoreCode("unsafe-path"));
    assert.equal(
      (await lstat(path.join(root, "snapshots", `${record.id}.json`))).isFile(),
      true,
    );
  });
});

test("copies caller-owned bytes before asynchronous publication", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("caller-owned immutable bytes", "utf8");
    const original = Buffer.from(normalizedBlob);
    const record = snapshot({ id: "snapshot_caller_mutation", normalizedBlob });
    const store = createResearchResourceStore({ root });

    const publication = store.publishSnapshot({ snapshot: record, normalizedBlob });
    normalizedBlob.fill(0x78);
    await publication;

    assert.deepEqual((await store.readSnapshot(record.id)).normalizedBlob, new Uint8Array(original));
  });
});

test("concurrent identical publication creates exactly one immutable record", async () => {
  await fixture(async ({ root }) => {
    const normalizedBlob = Buffer.from("concurrent normalized bytes", "utf8");
    const rawBlob = Buffer.from("concurrent raw bytes", "utf8");
    const record = snapshot({ id: "snapshot_concurrent", normalizedBlob, rawBlob });
    const store = createResearchResourceStore({ root });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.publishSnapshot({
          snapshot: structuredClone(record),
          normalizedBlob,
          rawBlob,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(results.filter((result) => !result.created).length, 7);
    assert.deepEqual((await store.readSnapshot(record.id)).snapshot, record);

    const snapshotBytes = await readFile(
      path.join(root, "snapshots", `${record.id}.json`),
      "utf8",
    );
    assert.equal(JSON.parse(snapshotBytes).id, record.id);
    for (const directory of [
      path.join(root, "snapshots"),
      path.dirname(blobPath(root, record.normalizedBlobDigest)),
      path.dirname(blobPath(root, record.rawBlobDigest!)),
    ]) {
      assert.deepEqual(
        (await readdir(directory)).filter((name) => name.startsWith(".tmp-")),
        [],
      );
    }
  });
});

test("concurrent different snapshots for one id produce one winner and one conflict", async () => {
  await fixture(async ({ root }) => {
    const firstBytes = Buffer.from("first contender", "utf8");
    const secondBytes = Buffer.from("second contender", "utf8");
    const first = snapshot({ id: "snapshot_race", normalizedBlob: firstBytes });
    const second = snapshot({
      id: "snapshot_race",
      normalizedBlob: secondBytes,
      resourceRevision: 2,
    });
    const store = createResearchResourceStore({ root });

    const settled = await Promise.allSettled([
      store.publishSnapshot({ snapshot: first, normalizedBlob: firstBytes }),
      store.publishSnapshot({ snapshot: second, normalizedBlob: secondBytes }),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.equal(hasStoreCode("immutable-conflict")(rejected.reason), true);

    const winner = await store.readSnapshot("snapshot_race");
    assert.ok(winner.snapshot.resourceRevision === 1 || winner.snapshot.resourceRevision === 2);
  });
});

test("refuses symlinked roots and intermediate snapshot directories", async (t) => {
  if (process.platform === "win32") {
    t.skip("creating symlinks is not reliably available to unprivileged Windows tests");
    return;
  }
  await fixture(async ({ root, outside }) => {
    await symlink(outside, root);
    const bytes = Buffer.from("root link", "utf8");
    const linkedRootStore = createResearchResourceStore({ root });
    await assert.rejects(
      () => linkedRootStore.publishSnapshot({
        snapshot: snapshot({ id: "snapshot_root_link", normalizedBlob: bytes }),
        normalizedBlob: bytes,
      }),
      hasStoreCode("symlink"),
    );
    await unlink(root);

    const store = createResearchResourceStore({ root });
    const record = snapshot({ id: "snapshot_directory_link", normalizedBlob: bytes });
    await store.publishSnapshot({ snapshot: record, normalizedBlob: bytes });
    await rm(path.join(root, "snapshots"), { recursive: true });
    await symlink(outside, path.join(root, "snapshots"));
    await assert.rejects(() => store.readSnapshot(record.id), hasStoreCode("symlink"));
  });
});

test("manifest catalog transaction keeps the process lock across coordinator I/O", async () => {
  await fixture(async ({ root }) => {
    const firstStore = createResearchResourceStore({ root });
    const secondStore = createResearchResourceStore({ root });
    let releaseIo!: () => void;
    const ioGate = new Promise<void>((resolve) => {
      releaseIo = resolve;
    });
    let entered = false;
    const transaction = firstStore.withManifestCatalogTransaction(async (catalog) => {
      entered = true;
      assert.deepEqual(catalog.listManifests(), []);
      await ioGate;
      return catalog.createManifest(manifest("transaction_owner"));
    });
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 1));

    let readerSettled = false;
    const reader = secondStore.readManifest("transaction_owner").finally(() => {
      readerSettled = true;
    });
    let contenderSettled = false;
    const contender = secondStore.createManifest(manifest("transaction_contender"))
      .finally(() => {
        contenderSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(readerSettled, false, "a detail read waits during callback I/O");
    assert.equal(contenderSettled, false, "a competing writer waits during callback I/O");

    releaseIo();
    await transaction;
    assert.deepEqual(await reader, manifest("transaction_owner"));
    await contender;
    assert.deepEqual(
      (await firstStore.listManifests()).map((item) => item.id).sort(),
      ["transaction_contender", "transaction_owner"],
    );
  });
});

test("manifest catalog transactions return detached snapshots and safely delete compatibility rows", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const original = manifest("compatibility_delete");
    await store.createManifest(original);

    await store.withManifestCatalogTransaction(async (catalog) => {
      const listed = catalog.listManifests();
      listed[0]!.title = "caller mutation";
      assert.equal(catalog.listManifests()[0]?.title, original.title);
      assert.deepEqual(await catalog.deleteCompatibilityManifest(original), {
        deleted: true,
        manifest: original,
      });
      assert.deepEqual(catalog.listManifests(), []);
    });
    assert.equal(await store.readManifest(original.id), null);
    await assert.rejects(
      () => lstat(path.join(root, "manifests", `${original.id}.json`)),
      { code: "ENOENT" },
    );
  });
});

test("compatibility deletion refuses changed, current, ingested, and snapshot-referenced manifests", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const changed = manifest("changed_expected");
    await store.createManifest(changed);
    await assert.rejects(
      () => store.withManifestCatalogTransaction((catalog) =>
        catalog.deleteCompatibilityManifest({ ...changed, title: "Wrong expected bytes" })),
      hasStoreCode("revision-conflict"),
    );

    for (const [id, ingest] of [
      ["desired_resource", { desired: true, state: "queued" as const }],
      ["ingested_resource", { desired: false, state: "partial" as const }],
    ] as const) {
      const record = manifest(id, { ingest });
      await store.createManifest(record);
      await assert.rejects(
        () => store.withManifestCatalogTransaction((catalog) =>
          catalog.deleteCompatibilityManifest(record)),
        hasStoreCode("immutable-conflict"),
      );
    }

    const bytes = Buffer.from("compatibility snapshot", "utf8");
    const referencedSnapshot = snapshot({
      id: "compatibility_reference",
      resourceId: "snapshot_referenced",
      normalizedBlob: bytes,
    });
    await store.publishSnapshot({ snapshot: referencedSnapshot, normalizedBlob: bytes });
    const referenced = manifest("snapshot_referenced");
    await store.createManifest(referenced);
    await assert.rejects(
      () => store.withManifestCatalogTransaction((catalog) =>
        catalog.deleteCompatibilityManifest(referenced)),
      hasStoreCode("snapshot-conflict"),
    );

    const currentBytes = Buffer.from("current compatibility snapshot", "utf8");
    const currentSnapshot = snapshot({
      id: "compatibility_current",
      resourceId: "current_resource",
      normalizedBlob: currentBytes,
    });
    await store.publishSnapshot({ snapshot: currentSnapshot, normalizedBlob: currentBytes });
    const current = manifest("current_resource", {
      currentSnapshotId: currentSnapshot.id,
    });
    await store.createManifest(current);
    await assert.rejects(
      () => store.withManifestCatalogTransaction((catalog) =>
        catalog.deleteCompatibilityManifest(current)),
      hasStoreCode("snapshot-conflict"),
    );

    assert.deepEqual(
      (await store.listManifests()).map((item) => item.id).sort(),
      [
        changed.id,
        "current_resource",
        "desired_resource",
        "ingested_resource",
        "snapshot_referenced",
      ].sort(),
      "every refused delete leaves the catalog intact",
    );
  });
});

test("compatibility replacement permits reviewed immutable changes and keeps ordinary updates strict", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const original = manifest("downgrade_replace");
    await store.createManifest(original);
    const replacement: ResourceManifestV1 = {
      ...original,
      revision: 2,
      canonicalIdentity: "https://example.com/downgrade-rewritten",
      sourceUri: "https://example.com/downgrade-rewritten",
      legacySavedLink: {
        ...original.legacySavedLink!,
        url: "https://example.com/downgrade-rewritten",
      },
      title: "Downgrade rewrite",
      updatedAt: "2026-08-27T12:01:00Z",
    };
    assert.deepEqual(
      await store.withManifestCatalogTransaction(async (catalog) => {
        await catalog.preflightCompatibilityMutation([{
          kind: "replace",
          expectedManifest: original,
          manifest: replacement,
        }]);
        return catalog.replaceCompatibilityManifest({
          expectedManifest: original,
          manifest: replacement,
        });
      }),
      replacement,
    );
    assert.deepEqual(await store.readManifest(original.id), replacement);

    await assert.rejects(
      () => store.updateManifest({
        id: replacement.id,
        expectedRevision: 2,
        manifest: {
          ...replacement,
          revision: 3,
          canonicalIdentity: "https://example.com/not-an-ordinary-update",
          updatedAt: "2026-08-27T12:02:00Z",
        },
      }),
      hasStoreCode("immutable-conflict"),
    );
    assert.deepEqual(await store.readManifest(original.id), replacement);
  });
});

test("compatibility replacement validates identity conflicts before mutating either manifest", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const original = manifest("replace_source");
    const owner = manifest("replace_identity_owner");
    const wouldOtherwiseCreate = manifest("preflight_create");
    await store.createManifest(original);
    await store.createManifest(owner);
    const conflicting: ResourceManifestV1 = {
      ...original,
      revision: 2,
      canonicalIdentity: owner.canonicalIdentity,
      updatedAt: "2026-08-27T12:01:00Z",
    };

    await assert.rejects(
      () => store.withManifestCatalogTransaction((catalog) =>
        catalog.preflightCompatibilityMutation([
          { kind: "create", manifest: wouldOtherwiseCreate },
          {
            kind: "replace",
            expectedManifest: original,
            manifest: conflicting,
          },
        ])),
      hasStoreCode("identity-conflict"),
    );
    assert.deepEqual(await store.readManifest(original.id), original);
    assert.deepEqual(await store.readManifest(owner.id), owner);
    assert.equal(await store.readManifest(wouldOtherwiseCreate.id), null);
  });
});

test("compatibility replacement is atomic and rejects same-byte target substitution", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const original = manifest("replace_cas", {
      subject: { payload: "x".repeat(256 * 1024) },
    });
    await store.createManifest(original);
    const replacement: ResourceManifestV1 = {
      ...original,
      revision: 2,
      canonicalIdentity: "https://example.com/replace-cas-next",
      sourceUri: "https://example.com/replace-cas-next",
      legacySavedLink: {
        ...original.legacySavedLink!,
        url: "https://example.com/replace-cas-next",
      },
      updatedAt: "2026-08-27T12:01:00Z",
    };
    const target = path.join(root, "manifests", `${original.id}.json`);

    await assert.rejects(
      () => store.withManifestCatalogTransaction(async (catalog) => {
        const replacementPath = `${target}.replacement`;
        await writeFile(replacementPath, await readFile(target), { mode: 0o600 });
        await rename(replacementPath, target);
        return catalog.replaceCompatibilityManifest({
          expectedManifest: original,
          manifest: replacement,
        });
      }),
      hasStoreCode("revision-conflict"),
    );
    assert.deepEqual(await store.readManifest(original.id), original);

    let observing = true;
    let observedMissing = false;
    let observations = 0;
    const observer = (async () => {
      while (observing) {
        try {
          await readFile(target);
          observations += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") observedMissing = true;
          else throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })();
    await store.withManifestCatalogTransaction((catalog) =>
      catalog.replaceCompatibilityManifest({
        expectedManifest: original,
        manifest: replacement,
      }));
    observing = false;
    await observer;

    assert.ok(observations > 0);
    assert.equal(observedMissing, false, "same-id replacement is never externally absent");
    assert.deepEqual(await store.readManifest(original.id), replacement);
  });
});

test("compatibility deletion rejects same-byte target substitution", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const original = manifest("delete_cas");
    await store.createManifest(original);
    const target = path.join(root, "manifests", `${original.id}.json`);

    await assert.rejects(
      () => store.withManifestCatalogTransaction(async (catalog) => {
        const replacementPath = `${target}.replacement`;
        await writeFile(replacementPath, await readFile(target), { mode: 0o600 });
        await rename(replacementPath, target);
        return catalog.deleteCompatibilityManifest(original);
      }),
      hasStoreCode("revision-conflict"),
    );
    assert.deepEqual(await store.readManifest(original.id), original);
  });
});

test("operational transaction persists fenced job transitions and bounded failures privately", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const resource = manifest("operational", {
      ingest: { desired: true, state: "queued" },
    });
    await store.createManifest(resource);
    const queued = ingestJob(resource.id);
    const token = "0123456789abcdef0123456789abcdef";
    const claimed: ResourceIngestJobV1 = {
      ...queued,
      status: "claimed",
      lease: { owner: "worker_1", token, expiresAt: "2099-08-27T12:05:00Z" },
      updatedAt: "2026-08-27T12:01:00Z",
    };
    const failure: ResourceIngestFailureV1 = {
      version: 1,
      jobId: queued.id,
      resourceId: resource.id,
      resourceRevision: 1,
      deletionRevision: 0,
      stage: "fetch",
      code: "transport_timeout",
      retryable: true,
      occurredAt: "2026-08-27T12:02:00Z",
    };

    await store.withOperationalTransaction(async (transaction) => {
      assert.deepEqual(await transaction.createJob(queued), { created: true, job: queued });
      assert.deepEqual((await transaction.createJob(queued)).created, false);
      await transaction.replaceJob(queued, claimed);
      transaction.assertPublicationFence({
        expectedJob: claimed,
        leaseToken: token,
        resourceId: resource.id,
        resourceRevision: 1,
        deletionRevision: 0,
        now: "2026-08-27T12:02:00Z",
      });
      assert.deepEqual(await transaction.writeFailure(failure), failure);
      assert.deepEqual(transaction.readFailure(queued.id), failure);
      await assert.rejects(
        () => transaction.replaceJob(claimed, { ...claimed, updatedAt: "2026-08-27T12:03:00Z", attempt: 1 }),
        hasStoreCode("revision-conflict"),
      );
    });

    await store.withOperationalTransaction(async (transaction) => {
      assert.deepEqual(transaction.listJobs(), [claimed]);
      assert.deepEqual(transaction.listFailures(), [failure]);
    });
    if (process.platform !== "win32") {
      for (const directory of ["jobs", "failures", "fences", "deletions", "tombstones"]) {
        assert.equal((await lstat(path.join(root, directory))).mode & 0o777, 0o700);
      }
      assert.equal((await lstat(path.join(root, "jobs", `${queued.id}.json`))).mode & 0o777, 0o600);
      assert.equal((await lstat(path.join(root, "failures", `${queued.id}.json`))).mode & 0o777, 0o600);
    }
  });
});

test("deletion state captures every snapshot, advances by CAS, and removes only an exact deleting manifest", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const resource = manifest("delete-general");
    await store.createManifest(resource);
    const bytesA = Buffer.from("historical A");
    const bytesB = Buffer.from("historical B");
    const snapshotA = snapshot({ id: "delete-snapshot-a", resourceId: resource.id, normalizedBlob: bytesA });
    const snapshotB = snapshot({ id: "delete-snapshot-b", resourceId: resource.id, normalizedBlob: bytesB });
    await store.publishSnapshot({ snapshot: snapshotA, normalizedBlob: bytesA });
    await store.publishSnapshot({ snapshot: snapshotB, normalizedBlob: bytesB });

    await store.withOperationalTransaction(async (transaction) => {
      assert.deepEqual(transaction.listSnapshots(resource.id).map((entry) => entry.id), [snapshotA.id, snapshotB.id]);
      await assert.rejects(
        () => transaction.beginDeletion({
          expectedManifest: resource,
          deletedAt: "2026-08-27T12:01:00Z",
          snapshotIds: [snapshotA.id],
        }),
        hasStoreCode("snapshot-conflict"),
      );
      const fenced = await transaction.beginDeletion({
        expectedManifest: resource,
        deletedAt: "2026-08-27T12:01:00Z",
        snapshotIds: [snapshotA.id, snapshotB.id],
      });
      assert.equal(fenced.phase, "fenced");
      assert.equal(transaction.readDeletionFence(resource.id)?.deletionRevision, 1);
      const deleting = await transaction.updateManifest({
        id: resource.id,
        expectedRevision: 1,
        manifest: {
          ...resource,
          revision: 2,
          ingest: { desired: false, state: "deleting" },
          updatedAt: "2026-08-27T12:02:00Z",
        },
      });
      const manifestDeleting: ResourceDeletionJournalV1 = {
        ...fenced,
        phase: "manifest_deleting",
        updatedAt: "2026-08-27T12:02:00Z",
      };
      await transaction.advanceDeletionJournal(fenced, manifestDeleting);
      await transaction.publishTombstone({
        version: 1,
        resourceId: resource.id,
        deletionRevision: 1,
        deletedAt: fenced.deletedAt,
      });
      await transaction.deleteSnapshot(snapshotA.id);
      await transaction.deleteSnapshot(snapshotB.id);
      assert.deepEqual((await transaction.deleteDeletingManifest(deleting)).id, resource.id);
    });

    assert.equal(await store.readManifest(resource.id), null);
    await store.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.readTombstone(resource.id)?.deletionRevision, 1);
      assert.equal(transaction.readDeletionJournal(resource.id)?.phase, "manifest_deleting");
    });
  });
});

test("operational scans fail closed on unexpected entries and private tombstone fields", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    await store.listManifests();
    await writeFile(path.join(root, "jobs", "unexpected.txt"), "not a record", { mode: 0o600 });
    await assert.rejects(
      () => store.withOperationalTransaction(async () => undefined),
      hasStoreCode("corrupt"),
    );
  });
});

test("a durable deletion journal repairs a crash before fence publication", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const resource = manifest("deletion-fence-repair");
    await store.createManifest(resource);
    await store.withOperationalTransaction(async (transaction) => {
      await transaction.beginDeletion({
        expectedManifest: resource,
        deletedAt: "2026-08-27T12:01:00Z",
        snapshotIds: [],
      });
    });
    await unlink(path.join(root, "fences", `${resource.id}.json`));

    await store.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.readDeletionJournal(resource.id)?.phase, "fenced");
      assert.equal(transaction.readDeletionFence(resource.id)?.deletionRevision, 1);
    });
    assert.equal((await lstat(path.join(root, "fences", `${resource.id}.json`))).isFile(), true);
  });
});

test("snapshot deletion replay collects CAS blobs left after record removal", async () => {
  await fixture(async ({ root }) => {
    const store = createResearchResourceStore({ root });
    const normalizedBlob = Buffer.from("crash residue");
    const record = snapshot({ id: "snapshot-delete-replay", normalizedBlob });
    await store.publishSnapshot({ snapshot: record, normalizedBlob });
    await unlink(path.join(root, "snapshots", `${record.id}.json`));
    assert.equal((await lstat(blobPath(root, record.normalizedBlobDigest))).isFile(), true);

    const replayed = await store.deleteSnapshot(record.id);
    assert.equal(replayed.deleted, false);
    assert.deepEqual(replayed.removedBlobDigests, [record.normalizedBlobDigest]);
    await assert.rejects(() => lstat(blobPath(root, record.normalizedBlobDigest)), { code: "ENOENT" });
  });
});
