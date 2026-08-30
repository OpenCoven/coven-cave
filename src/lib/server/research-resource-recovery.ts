import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import { migrateCaveHomeOnce } from "./cave-home-migration.ts";
import { createResearchResourceIngestion } from "./research-resource-ingestion.ts";
import {
  rebuildResearchResourceLexicalIndex,
  openResearchResourceLexicalIndex,
  RESEARCH_LEXICAL_RESTORE_MARKER,
  type ResearchLexicalAuthority,
} from "./research-resource-lexical-index.ts";
import { listCompatibleResearchLinks } from "./research-links-compatibility.ts";
import {
  unlinkResearchRestoreFileDurably,
  type ResearchRestoreDurabilityObserver,
} from "./research-resource-restore-durability.ts";
import {
  createResearchResourceStore,
  purgeResearchResourceRestoreDisposableState,
  withResearchResourceMaintenanceLock,
  type ResearchResourceStore,
  type ResourceOperationalTransaction,
} from "./research-resource-store.ts";

import { reconcileRestoredContextPacks } from "./research-context-pack-store.ts";

export type ResearchResourceRecoveryPhase =
  | "tombstones-repaired"
  | "projection-reconciled"
  | "jobs-recreated"
  | "lexical-rebuilt"
  | "context-packs-validated";

export type ResearchResourceRecoveryResult = {
  projectionReconciled: boolean;
  tombstoneFencesRepaired: number;
  jobsRecreated: number;
  lexicalRebuilt: boolean;
  contextPacksValidated: number;
  contextPacksInvalid: number;
};

export type ResearchResourceRecoveryOptions = {
  root?: string;
  store?: ResearchResourceStore;
  packRoot?: string;
  reconcileProjection?: () => Promise<unknown>;
  resetOperationalState?: boolean;
  failpoint?: (phase: ResearchResourceRecoveryPhase) => void | Promise<void>;
};

export type ResearchRestoreMarkerPhase = "preparing" | "authority-ready";

type ResearchRestoreMarkerV1 = {
  version: 1;
  phase: ResearchRestoreMarkerPhase;
};

const startupRecovery = new Map<string, Promise<ResearchResourceRecoveryResult | null>>();

export function researchResourceRestoreMarkerPath(rootInput?: string): string {
  return path.join(resourceRoot(rootInput), "index", RESEARCH_LEXICAL_RESTORE_MARKER);
}

async function readRestoreMarker(root: string): Promise<ResearchRestoreMarkerV1 | null> {
  const marker = researchResourceRestoreMarkerPath(root);
  let before;
  try {
    before = await lstat(marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1024) {
    throw new Error("Research restore marker is unsafe");
  }
  if (process.platform !== "win32" && typeof process.getuid === "function") {
    if (before.uid !== process.getuid() || (before.mode & 0o777) !== 0o600) {
      throw new Error("Research restore marker is not private to the current user");
    }
  }
  const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
  const handle = await open(marker, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.size > 1024
      || opened.dev !== before.dev
      || opened.ino !== before.ino
    ) {
      throw new Error("Research restore marker identity changed");
    }
    const parsed = JSON.parse(await handle.readFile("utf8")) as Partial<ResearchRestoreMarkerV1>;
    if (parsed.version !== 1 || (parsed.phase !== "preparing" && parsed.phase !== "authority-ready")) {
      throw new Error("Research restore marker is invalid");
    }
    return { version: 1, phase: parsed.phase };
  } finally {
    await handle.close();
  }
}

function resourceRoot(root: string | undefined): string {
  return path.resolve(root ?? path.join(/* turbopackIgnore: true */ caveHome(), "research-resources"));
}

function fenceRevision(transaction: ResourceOperationalTransaction, resourceId: string): number {
  return transaction.readDeletionFence(resourceId)?.deletionRevision
    ?? transaction.readTombstone(resourceId)?.deletionRevision
    ?? 0;
}

function readyManifest(
  transaction: ResourceOperationalTransaction,
  manifest: ResourceManifestV1,
): boolean {
  return manifest.ingest.state === "ready"
    && typeof manifest.currentSnapshotId === "string"
    && !transaction.readDeletionJournal(manifest.id);
}

async function reconcileRestoredResearchResourcesLocked(
  options: ResearchResourceRecoveryOptions,
  root: string,
  store: ResearchResourceStore,
): Promise<ResearchResourceRecoveryResult> {
  const failpoint = options.failpoint ?? (() => {});

  if (options.resetOperationalState) {
    // Do not construct an operational transaction first: excluded restore
    // residue is explicitly untrusted and may be malformed or truncated.
    await purgeResearchResourceRestoreDisposableState(root);
  }
  const tombstoneFencesRepaired = await store.withOperationalTransaction(async (transaction) => {
    let repaired = 0;
    for (const tombstone of transaction.listTombstones()) {
      if (await transaction.repairDeletionFenceFromTombstone(tombstone.resourceId)) repaired += 1;
    }
    return repaired;
  });
  await store.withOperationalTransaction(async (transaction) => {
    for (const archived of transaction.listManifests()) {
      const tombstone = transaction.readTombstone(archived.id);
      const fence = transaction.readDeletionFence(archived.id);
      const predatesDeletion = tombstone
        && Date.parse(archived.createdAt) <= Date.parse(tombstone.deletedAt);
      const newerDeletionFence = (fence?.deletionRevision ?? 0)
        > (tombstone?.deletionRevision ?? 0);
      let manifest = archived;
      if ((predatesDeletion || newerDeletionFence) && manifest.ingest.state !== "deleting") {
        const { currentSnapshotId: _snapshot, ...withoutCurrentSnapshot } = manifest;
        manifest = await transaction.updateManifest({
          id: manifest.id,
          expectedRevision: manifest.revision,
          manifest: {
            ...withoutCurrentSnapshot,
            revision: manifest.revision + 1,
            ingest: { desired: false, state: "deleting" },
            updatedAt: new Date(Math.max(
              Date.parse(manifest.updatedAt),
              tombstone ? Date.parse(tombstone.deletedAt) : Number.NEGATIVE_INFINITY,
              fence ? Date.parse(fence.updatedAt) : Number.NEGATIVE_INFINITY,
            ) + 1).toISOString(),
          },
        });
      }
      if (manifest.ingest.state !== "deleting") continue;
      if (tombstone && fence?.deletionRevision === tombstone.deletionRevision) {
        await transaction.repairTombstonedDeletionJournal(manifest);
      } else {
        const deletedAt = new Date(Math.max(
          Date.parse(manifest.updatedAt),
          fence ? Date.parse(fence.updatedAt) + 1 : Number.NEGATIVE_INFINITY,
        )).toISOString();
        await transaction.beginDeletion({
          expectedManifest: manifest,
          deletedAt,
          snapshotIds: transaction.listSnapshots(manifest.id).map((snapshot) => snapshot.id).sort(),
        });
      }
    }
  });
  await failpoint("tombstones-repaired");

  await (options.reconcileProjection ?? (() => listCompatibleResearchLinks({
    resourceRoot: root,
    recoveryAlreadyHeld: true,
  })))();
  await failpoint("projection-reconciled");

  await store.withOperationalTransaction(async (transaction) => {
    const manifests = new Map(transaction.listManifests().map((manifest) => [manifest.id, manifest]));
    for (const job of transaction.listJobs()) {
      if (new Set(["completed", "failed", "cancelled"]).has(job.status)) continue;
      const manifest = manifests.get(job.resourceId);
      const current = manifest?.revision === job.resourceRevision
        && manifest.ingest.state !== "deleting"
        && fenceRevision(transaction, job.resourceId) === job.deletionRevision
        && !transaction.readDeletionJournal(job.resourceId);
      if (current) continue;
      const { lease: _lease, ...unleased } = job;
      await transaction.replaceJob(job, {
        ...unleased,
        status: "cancelled",
        updatedAt: new Date(Date.parse(job.updatedAt) + 1).toISOString(),
      });
    }
  });
  const beforeJobs = await store.withOperationalTransaction(async (transaction) =>
    new Set(transaction.listJobs().map((job) => job.id)));
  const disposableIndexFile = path.join(
    root,
    "index",
    `.restore-recovery-${process.pid}-${randomBytes(8).toString("hex")}.sqlite`,
  );
  const disposableIndex = await openResearchResourceLexicalIndex({ file: disposableIndexFile });
  const ingestion = createResearchResourceIngestion({
    root,
    store,
    index: disposableIndex,
    enabled: () => true,
    repairCompatibilityProjection: options.reconcileProjection
      ?? (() => listCompatibleResearchLinks({
        resourceRoot: root,
        recoveryAlreadyHeld: true,
      })),
    recoveryAlreadyHeld: true,
  });
  try {
    await ingestion.reconcileStartup();
  } finally {
    await ingestion.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      await rm(`${disposableIndexFile}${suffix}`, { force: true });
    }
  }
  const jobsRecreated = await store.withOperationalTransaction(async (transaction) =>
    transaction.listJobs().filter((job) => !beforeJobs.has(job.id)).length);
  await failpoint("jobs-recreated");

  const rebuilt = await rebuildResearchResourceLexicalIndex(
    { file: path.join(root, "index", "research-resources.sqlite") },
    async (index) => store.withOperationalTransaction(async (transaction) => {
      for (const manifest of transaction.listManifests()) {
        if (!readyManifest(transaction, manifest)) continue;
        const verified = await transaction.readSnapshot(manifest.currentSnapshotId!);
        if (
          verified.snapshot.resourceId !== manifest.id
          || verified.snapshot.resourceRevision !== manifest.revision
        ) continue;
        const deletionRevision = fenceRevision(transaction, manifest.id);
        const tombstone = transaction.readTombstone(manifest.id);
        if (tombstone && tombstone.deletionRevision > deletionRevision) continue;
        const authority: ResearchLexicalAuthority = {
          resourceId: manifest.id,
          resourceRevision: manifest.revision,
          deletionRevision,
          snapshotId: verified.snapshot.id,
          snapshotDigest: verified.snapshot.normalizedBlobDigest,
        };
        index.replace({ ...authority, normalizedBytes: verified.normalizedBlob });
      }
    }),
  );
  rebuilt.index.purgeResidualFiles();
  rebuilt.index.close();
  await failpoint("lexical-rebuilt");

  // Pack manifests must be validated against their pack-owned blobs BEFORE
  // exposure. This runs with the feature flag off: it is recovery, not
  // rollout (A8 rule).
  const packCounts = await reconcileRestoredContextPacks(
    options.packRoot ? { root: options.packRoot } : {},
  );
  if (packCounts.invalid > 0) {
    throw new Error(
      `context-packs-validated: restored context packs failed validation (${packCounts.invalid} invalid)`,
    );
  }
  await failpoint("context-packs-validated");

  return {
    projectionReconciled: true,
    tombstoneFencesRepaired,
    jobsRecreated,
    lexicalRebuilt: true,
    contextPacksValidated: packCounts.validated,
    contextPacksInvalid: packCounts.invalid,
  };
}

/**
 * Reconstructs disposable Research state from the authoritative archive-v1
 * files. This is deliberately independent of rollout flags: flags gate new
 * feature work, not repair of data already owned by Cave. The complete phase
 * sequence owns one process-intent lease; nested transactions reuse it.
 */
export async function reconcileRestoredResearchResources(
  options: ResearchResourceRecoveryOptions = {},
): Promise<ResearchResourceRecoveryResult> {
  const root = resourceRoot(options.root);
  const store = options.store ?? createResearchResourceStore({ root });
  return withResearchResourceMaintenanceLock(
    root,
    () => reconcileRestoredResearchResourcesLocked(options, root, store),
  );
}

export type ResearchResourceStartupRecoveryOptions = ResearchResourceRecoveryOptions & {
  durabilityObserver?: ResearchRestoreDurabilityObserver;
};

/**
 * First-use/startup gate for a restore that crashed after authoritative files
 * were durably installed. A preparing marker cannot prove that boundary and
 * therefore remains fail-closed until the original archive is resubmitted.
 */
export function recoverInterruptedResearchResourceRestore(
  options: ResearchResourceStartupRecoveryOptions = {},
): Promise<ResearchResourceRecoveryResult | null> {
  const root = resourceRoot(options.root);
  const existing = startupRecovery.get(root);
  if (existing) return existing;

  let recovery!: Promise<ResearchResourceRecoveryResult | null>;
  recovery = (async () => {
    if (options.root === undefined) await migrateCaveHomeOnce();
    const initialMarker = await readRestoreMarker(root);
    if (!initialMarker) return null;
    return withResearchResourceMaintenanceLock(root, async () => {
      const marker = await readRestoreMarker(root);
      if (!marker) return null;
      if (marker.phase !== "authority-ready") {
        throw new Error("Research restore is incomplete; resubmit the backup archive");
      }
      const result = await reconcileRestoredResearchResources({
        ...options,
        root,
        resetOperationalState: true,
      });
      await unlinkResearchRestoreFileDurably(
        researchResourceRestoreMarkerPath(root),
        options.durabilityObserver,
      );
      return result;
    });
  })().finally(() => {
    if (startupRecovery.get(root) === recovery) startupRecovery.delete(root);
  });
  startupRecovery.set(root, recovery);
  return recovery;
}
