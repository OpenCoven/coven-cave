/** Offline persistence repair. This module must not load ingestion fetchers or extractors. */
import path from "node:path";
import { caveResearchLocalIngestion } from "../feature-flags.ts";
import type { ResourceIngestJobV1 } from "../research-resource-contracts.ts";
import {
  openResearchResourceLexicalIndex,
  rebuildResearchResourceLexicalIndex,
  ResearchResourceLexicalIndexError,
  type ResearchResourceLexicalIndex,
} from "./research-resource-lexical-index.ts";
import { removeResearchResourceSemanticPublication } from "./research-resource-semantic-index.ts";
import { listCompatibleResearchLinks } from "./research-links-compatibility.ts";
import {
  createResearchResourceStore,
  type ResourceDeletionJournalV1,
  type ResourceOperationalTransaction,
  type ResearchResourceStore,
} from "./research-resource-store.ts";
import { laterTimestamp, jobId, deletionRevision, active, manifestById, nextManifest, authority } from "./research-resource-state.ts";

export type ResearchResourceMaintenanceOptions = {
  root?: string;
  store?: ResearchResourceStore;
  index?: ResearchResourceLexicalIndex;
  /** @internal Recovery already owns the maintenance lease and must not recurse. */
  recoveryAlreadyHeld?: boolean;
  enabled?: () => boolean;
  now?: () => Date;
  repairCompatibilityProjection?: () => Promise<unknown>;
  removeSemanticDerivatives?: (resourceId: string) => Promise<void>;
};

export function createResearchResourceMaintenance(options: ResearchResourceMaintenanceOptions = {}) {
  const store = options.store ?? createResearchResourceStore({ root: options.root });
  const indexFile = options.root
    ? path.join(options.root, "index", "research-resources.sqlite")
    : undefined;
  let lexicalPromise: Promise<ResearchResourceLexicalIndex> | null = options.index
    ? Promise.resolve(options.index)
    : null;
  const enabled = options.enabled ?? caveResearchLocalIngestion;
  const clock = options.now ?? (() => new Date());
  const repairProjection = options.repairCompatibilityProjection
    ?? (() => listCompatibleResearchLinks({
      resourceRoot: options.root,
      recoveryAlreadyHeld: options.recoveryAlreadyHeld,
    }));
  const removeSemanticDerivatives = options.removeSemanticDerivatives
    ?? ((resourceId: string) => removeResearchResourceSemanticPublication({
      root: options.root,
      resourceId,
    }));

  async function ensureStartupRecovery(): Promise<void> {
    if (options.recoveryAlreadyHeld) return;
    const { recoverInterruptedResearchResourceRestore } = await import(
      "./research-resource-recovery.ts"
    );
    await recoverInterruptedResearchResourceRestore({
      root: options.root,
      reconcileProjection: options.repairCompatibilityProjection
        ?? (() => listCompatibleResearchLinks({
          resourceRoot: options.root,
          recoveryAlreadyHeld: true,
        })),
    });
  }

  function getLexical(): Promise<ResearchResourceLexicalIndex> {
    if (!lexicalPromise) {
      lexicalPromise = openResearchResourceLexicalIndex(
        indexFile ? { file: indexFile } : undefined,
      );
      // A corrupt database can reject before reconciliation reaches its
      // rebuild path. Observe it immediately; withLexical repairs the same
      // rejected promise on first use.
      void lexicalPromise.catch(() => {});
    }
    return lexicalPromise;
  }

  async function populateLexical(
    transaction: ResourceOperationalTransaction,
    candidate: ResearchResourceLexicalIndex,
  ): Promise<void> {
    for (const manifest of transaction.listManifests()) {
      if (manifest.ingest.state !== "ready" || !manifest.currentSnapshotId) continue;
      if (transaction.readDeletionJournal(manifest.id)) continue;
      const fence = deletionRevision(transaction, manifest.id);
      const tombstone = transaction.readTombstone(manifest.id);
      if (tombstone && tombstone.deletionRevision > fence) continue;
      const verified = await transaction.readSnapshot(manifest.currentSnapshotId);
      if (
        verified.snapshot.resourceId !== manifest.id
        || verified.snapshot.resourceRevision !== manifest.revision
      ) continue;
      candidate.replace({
        ...authority(verified.snapshot, fence),
        normalizedBytes: verified.normalizedBlob,
      });
    }
  }

  async function rebuildLexical(
    transaction?: ResourceOperationalTransaction,
  ): Promise<ResearchResourceLexicalIndex> {
    const rebuild = async (locked: ResourceOperationalTransaction) => {
      const rebuilt = await rebuildResearchResourceLexicalIndex(
        indexFile ? { file: indexFile } : {},
        (candidate) => populateLexical(locked, candidate),
      );
      return rebuilt.index;
    };
    return transaction ? rebuild(transaction) : store.withOperationalTransaction(rebuild);
  }

  async function withLexical<T>(
    operation: (index: ResearchResourceLexicalIndex) => T | Promise<T>,
    transaction?: ResourceOperationalTransaction,
  ): Promise<T> {
    let lexical: ResearchResourceLexicalIndex;
    try {
      lexical = await getLexical();
      return await operation(lexical);
    } catch (error) {
      if (!(error instanceof ResearchResourceLexicalIndexError) || error.code !== "corrupt") {
        throw error;
      }
      try { (await getLexical()).close(); } catch { /* corruption error wins */ }
      lexicalPromise = rebuildLexical(transaction);
      lexical = await lexicalPromise;
      return operation(lexical);
    }
  }

  async function enqueue(resourceId: string, enqueueOptions: { refresh?: boolean } = {}) {
    if (!enabled()) return null;
    await ensureStartupRecovery();
    const now = clock();
    return store.withOperationalTransaction(async (transaction) => {
      const existing = manifestById(transaction, resourceId);
      if (!existing || existing.ingest.state === "deleting") return null;
      const fence = deletionRevision(transaction, resourceId);
      const current = transaction.listJobs().find((job) =>
        job.resourceId === resourceId
        && job.resourceRevision === existing.revision
        && job.deletionRevision === fence
        && active(job));
      if (current) return current;
      if (existing.ingest.state === "ready" && existing.currentSnapshotId && !enqueueOptions.refresh) {
        return null;
      }
      const queuedManifest = nextManifest(existing, now, { desired: true, state: "queued" });
      await transaction.updateManifest({
        id: existing.id,
        expectedRevision: existing.revision,
        manifest: queuedManifest,
      });
      const createdAt = now.toISOString();
      const job: ResourceIngestJobV1 = {
        version: 1,
        id: jobId(resourceId, queuedManifest.revision, fence),
        resourceId,
        resourceRevision: queuedManifest.revision,
        deletionRevision: fence,
        status: "queued",
        stage: "fetch",
        attempt: 0,
        availableAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      };
      return (await transaction.createJob(job)).job;
    });
  }

  async function resumeDeletion(resourceId: string): Promise<boolean> {
    let existed = false;
    for (;;) {
      const journal = await store.withOperationalTransaction(async (transaction) => {
        const existing = transaction.readDeletionJournal(resourceId);
        if (existing) return existing;
        const manifest = manifestById(transaction, resourceId);
        if (!manifest) return null;
        existed = true;
        return transaction.beginDeletion({
          expectedManifest: manifest,
          deletedAt: clock().toISOString(),
          snapshotIds: transaction.listSnapshots(resourceId).map((snapshot) => snapshot.id).sort(),
        });
      });
      if (!journal) return existed;
      existed = true;
      if (journal.phase === "fenced") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          const manifest = manifestById(transaction, resourceId);
          if (manifest && manifest.ingest.state !== "deleting") {
            await transaction.updateManifest({
              id: manifest.id,
              expectedRevision: manifest.revision,
              manifest: nextManifest(manifest, clock(), { desired: false, state: "deleting" }),
            });
          }
          await advance(transaction, expected, "manifest_deleting", clock());
        });
        continue;
      }
      if (journal.phase === "manifest_deleting") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          for (const job of transaction.listJobs().filter((item) => item.resourceId === resourceId && active(item))) {
            const { lease: _lease, ...unleased } = job;
            await transaction.replaceJob(job, {
              ...unleased,
              status: "cancelled",
              updatedAt: laterTimestamp(clock(), job.updatedAt),
            });
          }
          const embeddingTask = transaction.readEmbeddingTask(resourceId);
          if (embeddingTask) await transaction.removeEmbeddingTask(resourceId, embeddingTask);
          await advance(transaction, expected, "jobs_cancelled", clock());
        });
        continue;
      }
      if (journal.phase === "jobs_cancelled") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          await transaction.publishTombstone({
            version: 1,
            resourceId,
            deletionRevision: expected.deletionRevision,
            deletedAt: expected.deletedAt,
          });
          await advance(transaction, expected, "tombstoned", clock());
        });
        continue;
      }
      if (journal.phase === "tombstoned") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          await withLexical((lexical) => {
            const published = lexical.publication(resourceId);
            if (published) lexical.remove(published);
            lexical.purgeResidualFiles();
          }, transaction);
          await removeSemanticDerivatives(resourceId);
          await advance(transaction, expected, "derivatives_removed", clock());
        });
        continue;
      }
      if (journal.phase === "derivatives_removed") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          for (const id of expected.snapshotIds) await transaction.deleteSnapshot(id);
          await advance(transaction, expected, "snapshots_removed", clock());
        });
        continue;
      }
      if (journal.phase === "snapshots_removed") {
        await store.withOperationalTransaction(async (transaction) => {
          const expected = transaction.readDeletionJournal(resourceId)!;
          const manifest = manifestById(transaction, resourceId);
          if (manifest) await transaction.deleteDeletingManifest(manifest);
          await advance(transaction, expected, "manifest_removed", clock());
        });
        continue;
      }
      if (journal.phase === "manifest_removed") {
        await repairProjection();
        await store.withOperationalTransaction(async (transaction) => {
          await advance(transaction, transaction.readDeletionJournal(resourceId)!, "projection_verified", clock());
        });
        continue;
      }
      await store.withOperationalTransaction(async (transaction) => {
        const expected = transaction.readDeletionJournal(resourceId)!;
        await transaction.removeDeletionJournal(expected);
      });
      return true;
    }
  }

  async function deleteResource(resourceId: string): Promise<boolean> {
    await ensureStartupRecovery();
    return resumeDeletion(resourceId);
  }

  async function reconcileStartup(): Promise<void> {
    await ensureStartupRecovery();
    const journalIds = await store.withOperationalTransaction(async (transaction) =>
      transaction.listDeletionJournals().map((journal) => journal.resourceId).sort());
    for (const resourceId of journalIds) await resumeDeletion(resourceId);

    const now = clock();
    await store.withOperationalTransaction(async (transaction) => {
      for (const failure of transaction.listFailures().filter((item) => !item.retryable)) {
        const job = transaction.readJob(failure.jobId);
        if (!job || job.status === "completed" || job.status === "cancelled" ||
            transaction.readDeletionJournal(job.resourceId) ||
            deletionRevision(transaction, job.resourceId) !== job.deletionRevision) continue;
        let manifest = manifestById(transaction, job.resourceId);
        if (!manifest) continue;
        if (manifest.revision === job.resourceRevision) {
          manifest = await transaction.updateManifest({
            id: manifest.id,
            expectedRevision: manifest.revision,
            manifest: nextManifest(manifest, now, {
              desired: manifest.ingest.desired,
              state: "failed",
              lastFailureCode: failure.code,
              retryable: false,
            }),
          });
        }
        if (manifest.revision !== job.resourceRevision + 1 ||
            manifest.ingest.state !== "failed" || manifest.ingest.retryable !== false ||
            manifest.ingest.lastFailureCode !== failure.code || job.status === "failed") continue;
        if (job.status !== "claimed") continue;
        const { lease: _lease, ...unleased } = job;
        await transaction.replaceJob(job, {
          ...unleased,
          status: "failed",
          attempt: job.attempt + 1,
          availableAt: failure.occurredAt,
          updatedAt: laterTimestamp(now, job.updatedAt),
        });
      }
      for (const job of transaction.listJobs().filter((item) => item.status === "claimed")) {
        if (Date.parse(job.lease!.expiresAt) > now.getTime()) continue;
        const manifest = manifestById(transaction, job.resourceId);
        const current = manifest?.revision === job.resourceRevision
          && deletionRevision(transaction, job.resourceId) === job.deletionRevision
          && !transaction.readDeletionJournal(job.resourceId);
        const { lease: _lease, ...unleased } = job;
        await transaction.replaceJob(job, {
          ...unleased,
          status: current ? "queued" : "cancelled",
          stage: current ? "fetch" : job.stage,
          availableAt: now.toISOString(),
          updatedAt: laterTimestamp(now, job.updatedAt),
        });
      }
    });

    if (!enabled()) return;
    const startupState = await store.withOperationalTransaction(async (transaction) => ({
      manifests: transaction.listManifests(),
      jobs: transaction.listJobs(),
    }));
    const manifests = startupState.manifests;
    for (const manifest of manifests) {
      if (!manifest.ingest.desired || manifest.ingest.state === "deleting") continue;
      if (manifest.ingest.state === "failed" && manifest.ingest.retryable === false) continue;
      if (startupState.jobs.some((job) => job.resourceId === manifest.id && job.status === "failed" &&
          (job.resourceRevision === manifest.revision || job.resourceRevision + 1 === manifest.revision))) continue;
      if (manifest.ingest.state === "ready" && manifest.currentSnapshotId) {
        let verified;
        try {
          verified = await store.readSnapshot(manifest.currentSnapshotId);
        } catch {
          await enqueue(manifest.id, { refresh: true });
          continue;
        }
        await store.withOperationalTransaction(async (transaction) => {
          const current = manifestById(transaction, manifest.id);
          const fence = deletionRevision(transaction, manifest.id);
          if (
            !current
            || current.revision !== manifest.revision
            || current.currentSnapshotId !== verified.snapshot.id
            || current.ingest.state !== "ready"
            || transaction.readDeletionJournal(manifest.id)
            || (transaction.readTombstone(manifest.id)?.deletionRevision ?? 0) > fence
          ) return;
          await withLexical((lexical) => lexical.replace({
            ...authority(verified.snapshot, fence),
            normalizedBytes: verified.normalizedBlob,
          }), transaction);
        });
        continue;
      }
      await enqueue(manifest.id, { refresh: true });
    }
  }

  return {
    store, clock, enabled, ensureStartupRecovery, withLexical,
    enqueue, deleteResource, reconcileStartup,
    close: async () => {
      if (lexicalPromise) (await lexicalPromise).close();
    },
  };
}

async function advance(
  transaction: ResourceOperationalTransaction,
  expected: ResourceDeletionJournalV1,
  phase: ResourceDeletionJournalV1["phase"],
  now: Date,
): Promise<ResourceDeletionJournalV1> {
  const phases: ResourceDeletionJournalV1["phase"][] = [
    "fenced", "manifest_deleting", "jobs_cancelled", "tombstoned",
    "derivatives_removed", "snapshots_removed", "manifest_removed",
    "projection_verified",
  ];
  if (phases.indexOf(expected.phase) >= phases.indexOf(phase)) return expected;
  return transaction.advanceDeletionJournal(expected, {
    ...expected,
    phase,
    updatedAt: laterTimestamp(now, expected.updatedAt),
  });
}
