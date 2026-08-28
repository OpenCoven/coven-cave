import assert from "node:assert/strict";
import { link, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import { canonicalJson } from "../research-protocol/digest.ts";
import { reconcileRestoredResearchResources } from "./research-resource-recovery.ts";
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
    ingest: { desired: true, state: "metadata_only" },
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };
}

async function restoredFixture(validRecreation = true): Promise<{ parent: string; root: string }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cave-resource-recovery-"));
  const root = path.join(parent, "research-resources");
  const store = createResearchResourceStore({ root });
  const current = (await store.createManifest(manifest("restored-resource"))).manifest;
  await store.withOperationalTransaction(async (transaction) => {
    const journal = await transaction.beginDeletion({
      expectedManifest: current,
      deletedAt: "2026-08-27T13:00:00.000Z",
      snapshotIds: [],
    });
    await transaction.publishTombstone({
      version: 1,
      resourceId: current.id,
      deletionRevision: journal.deletionRevision,
      deletedAt: journal.deletedAt,
    });
    await transaction.createJob({
      version: 1,
      id: "stale-restored-job",
      resourceId: current.id,
      resourceRevision: current.revision,
      deletionRevision: journal.deletionRevision,
      status: "queued",
      stage: "fetch",
      attempt: 0,
      availableAt: "2026-08-27T13:00:00.000Z",
      createdAt: "2026-08-27T13:00:00.000Z",
      updatedAt: "2026-08-27T13:00:00.000Z",
    });
  });
  if (validRecreation) {
    const recreated = {
      ...manifest("restored-resource"),
      createdAt: "2026-08-27T14:00:00.000Z",
      updatedAt: "2026-08-27T14:00:00.000Z",
    };
    await writeFile(
      path.join(root, "manifests", "restored-resource.json"),
      `${canonicalJson(recreated)}\n`,
      { mode: 0o600 },
    );
  }
  await rm(path.join(root, "fences"), { recursive: true, force: true });
  await rm(path.join(root, "deletions"), { recursive: true, force: true });
  return { parent, root };
}

async function retainedAuthorityFixture(): Promise<{ parent: string; root: string }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cave-resource-restore-purge-"));
  const root = path.join(parent, "research-resources");
  const store = createResearchResourceStore({ root });
  const current = (await store.createManifest(manifest("retained-authority"))).manifest;
  await store.withOperationalTransaction(async (transaction) => {
    const journal = await transaction.beginDeletion({
      expectedManifest: current,
      deletedAt: "2026-08-27T13:00:00.000Z",
      snapshotIds: [],
    });
    await transaction.publishTombstone({
      version: 1,
      resourceId: current.id,
      deletionRevision: journal.deletionRevision,
      deletedAt: journal.deletedAt,
    });
  });
  const recreated: ResourceManifestV1 = {
    ...manifest("retained-authority"),
    ingest: { desired: false, state: "metadata_only" },
    createdAt: "2026-08-27T14:00:00.000Z",
    updatedAt: "2026-08-27T14:00:00.000Z",
  };
  await writeFile(
    path.join(root, "manifests", "retained-authority.json"),
    `${canonicalJson(recreated)}\n`,
    { mode: 0o600 },
  );
  return { parent, root };
}

async function assertRetainedAuthority(root: string): Promise<void> {
  const fence = JSON.parse(await readFile(path.join(root, "fences", "retained-authority.json"), "utf8"));
  const tombstone = JSON.parse(await readFile(path.join(root, "tombstones", "retained-authority.json"), "utf8"));
  assert.equal(fence.deletionRevision, 1);
  assert.equal(tombstone.deletionRevision, 1);
  assert.ok(await readFile(path.join(root, "manifests", "retained-authority.json"), "utf8"));
}

test("restore recovery rebuilds a tombstone fence and one deterministic desired job", async () => {
  const fixture = await restoredFixture();
  try {
    const first = await reconcileRestoredResearchResources({
      root: fixture.root,
      reconcileProjection: async () => {},
      resetOperationalState: true,
    });
    assert.equal(first.tombstoneFencesRepaired, 1);
    assert.equal(first.jobsRecreated, 1);
    assert.equal(first.lexicalRebuilt, true);

    const reopened = createResearchResourceStore({ root: fixture.root });
    const firstJobId = await reopened.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.readDeletionFence("restored-resource")?.deletionRevision, 1);
      const jobs = transaction.listJobs().filter((job) => job.resourceId === "restored-resource");
      assert.equal(jobs.length, 1);
      assert.notEqual(jobs[0]?.id, "stale-restored-job", "restore does not trust preexisting operational jobs");
      assert.equal(jobs[0]?.deletionRevision, 1);
      assert.equal(jobs[0]?.status, "queued");
      assert.ok(transaction.listManifests().some((row) => row.id === "restored-resource"));
      return jobs[0]!.id;
    });

    const second = await reconcileRestoredResearchResources({
      root: fixture.root,
      reconcileProjection: async () => {},
    });
    assert.equal(second.tombstoneFencesRepaired, 0);
    assert.equal(second.jobsRecreated, 0);
    await reopened.withOperationalTransaction(async (transaction) => {
      const jobs = transaction.listJobs().filter((job) => job.resourceId === "restored-resource");
      assert.equal(jobs.length, 1, "replay replaces rather than duplicates operational state");
      assert.equal(jobs[0]?.id, firstJobId, "recreated job id is deterministic");
    });
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("a pre-deleting manifest plus retained tombstone completes deletion instead of resurrecting", async () => {
  const fixture = await restoredFixture(false);
  try {
    const repaired = await reconcileRestoredResearchResources({
      root: fixture.root,
      reconcileProjection: async () => {},
      resetOperationalState: true,
    });
    assert.equal(repaired.jobsRecreated, 0);
    const reopened = createResearchResourceStore({ root: fixture.root });
    assert.equal(await reopened.readManifest("restored-resource"), null);
    await reopened.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.listJobs().some((job) => job.resourceId === "restored-resource"), false);
      assert.equal(transaction.readDeletionJournal("restored-resource"), null);
      assert.equal(transaction.readDeletionFence("restored-resource")?.deletionRevision, 1);
      assert.equal(transaction.readTombstone("restored-resource")?.deletionRevision, 1);
    });
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("a crash after job recreation treats a newer retained fence as deletion authority", async () => {
  const fixture = await restoredFixture();
  try {
    const fenceFile = path.join(fixture.root, "fences", "restored-resource.json");
    await reconcileRestoredResearchResources({
      root: fixture.root,
      reconcileProjection: async () => {},
      resetOperationalState: true,
      failpoint: (phase) => {
        if (phase === "jobs-recreated") throw new Error("simulated recovery crash");
      },
    }).then(
      () => assert.fail("failpoint must interrupt recovery"),
      (error: unknown) => assert.match(String(error), /simulated recovery crash/),
    );
    const fence = JSON.parse(await readFile(fenceFile, "utf8"));
    await writeFile(fenceFile, `${JSON.stringify({
      ...fence,
      deletionRevision: 2,
      updatedAt: "2026-08-27T14:00:00.000Z",
    })}\n`, { mode: 0o600 });

    const repaired = await reconcileRestoredResearchResources({
      root: fixture.root,
      reconcileProjection: async () => {},
    });
    assert.equal(repaired.tombstoneFencesRepaired, 0);
    const reopened = createResearchResourceStore({ root: fixture.root });
    assert.equal(await reopened.readManifest("restored-resource"), null);
    await reopened.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.readDeletionFence("restored-resource")?.deletionRevision, 3);
      assert.equal(transaction.readTombstone("restored-resource")?.deletionRevision, 3);
      assert.equal(
        transaction.listJobs().filter((job) =>
          job.resourceId === "restored-resource"
          && !new Set(["completed", "failed", "cancelled"]).has(job.status)).length,
        0,
      );
    });
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("restore reconstructs an excluded journal and completes a tombstoned deletion", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cave-resource-deletion-recovery-"));
  const root = path.join(parent, "research-resources");
  try {
    const store = createResearchResourceStore({ root });
    const current = (await store.createManifest(manifest("deleting-resource"))).manifest;
    await store.withOperationalTransaction(async (transaction) => {
      const journal = await transaction.beginDeletion({
        expectedManifest: current,
        deletedAt: "2026-08-27T13:00:00.000Z",
        snapshotIds: [],
      });
      await transaction.updateManifest({
        id: current.id,
        expectedRevision: current.revision,
        manifest: {
          ...current,
          revision: current.revision + 1,
          ingest: { desired: false, state: "deleting" },
          updatedAt: "2026-08-27T13:00:00.001Z",
        },
      });
      await transaction.publishTombstone({
        version: 1,
        resourceId: current.id,
        deletionRevision: journal.deletionRevision,
        deletedAt: journal.deletedAt,
      });
    });
    await rm(path.join(root, "fences"), { recursive: true, force: true });
    await rm(path.join(root, "deletions"), { recursive: true, force: true });

    await reconcileRestoredResearchResources({
      root,
      reconcileProjection: async () => {},
      resetOperationalState: true,
    });
    const reopened = createResearchResourceStore({ root });
    assert.equal(await reopened.readManifest("deleting-resource"), null);
    await reopened.withOperationalTransaction(async (transaction) => {
      assert.equal(transaction.readDeletionJournal("deleting-resource"), null);
      assert.equal(transaction.readDeletionFence("deleting-resource")?.deletionRevision, 1);
      assert.equal(transaction.readTombstone("deleting-resource")?.deletionRevision, 1);
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("restore purges malformed disposable records before parsing operational state", async (t) => {
  for (const directory of ["jobs", "failures", "deletions"] as const) {
    await t.test(directory, async () => {
      const fixture = await retainedAuthorityFixture();
      try {
        await writeFile(path.join(fixture.root, directory, "truncated.json"), "{\"version\":", { mode: 0o600 });
        await reconcileRestoredResearchResources({
          root: fixture.root,
          reconcileProjection: async () => {},
          resetOperationalState: true,
        });
        assert.deepEqual(await readdir(path.join(fixture.root, directory)), []);
        await assertRetainedAuthority(fixture.root);

        await reconcileRestoredResearchResources({
          root: fixture.root,
          reconcileProjection: async () => {},
          resetOperationalState: true,
        });
        await assertRetainedAuthority(fixture.root);
      } finally {
        await rm(fixture.parent, { recursive: true, force: true });
      }
    });
  }
});

test("restore refuses linked disposable residue without deleting its target or authority", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX link semantics are required");
    return;
  }

  await t.test("symlink", async () => {
    const fixture = await retainedAuthorityFixture();
    const outside = path.join(fixture.parent, "outside-symlink.json");
    const residue = path.join(fixture.root, "jobs", "unsafe.json");
    try {
      await writeFile(outside, "outside-symlink", { mode: 0o600 });
      await symlink(outside, residue);
      await assert.rejects(
        reconcileRestoredResearchResources({
          root: fixture.root,
          reconcileProjection: async () => {},
          resetOperationalState: true,
        }),
        /restore residue is a symlink/,
      );
      assert.equal(await readFile(outside, "utf8"), "outside-symlink");
      await assertRetainedAuthority(fixture.root);

      await unlink(residue);
      await reconcileRestoredResearchResources({
        root: fixture.root,
        reconcileProjection: async () => {},
        resetOperationalState: true,
      });
      await assertRetainedAuthority(fixture.root);
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });

  await t.test("hardlink", async () => {
    const fixture = await retainedAuthorityFixture();
    const outside = path.join(fixture.parent, "outside-hardlink.json");
    const residue = path.join(fixture.root, "failures", "unsafe.json");
    try {
      await writeFile(outside, "outside-hardlink", { mode: 0o600 });
      await link(outside, residue);
      await assert.rejects(
        reconcileRestoredResearchResources({
          root: fixture.root,
          reconcileProjection: async () => {},
          resetOperationalState: true,
        }),
        /restore residue must have exactly one link/,
      );
      assert.equal(await readFile(outside, "utf8"), "outside-hardlink");
      await assertRetainedAuthority(fixture.root);

      await unlink(residue);
      await reconcileRestoredResearchResources({
        root: fixture.root,
        reconcileProjection: async () => {},
        resetOperationalState: true,
      });
      await assertRetainedAuthority(fixture.root);
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });
});
