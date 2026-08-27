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

import type { ResourceSnapshotV1 } from "../research-resource-contracts.ts";
import {
  createResearchResourceStore,
  ResearchResourceStoreError,
} from "./research-resource-store.ts";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
