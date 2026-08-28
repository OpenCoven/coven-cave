import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { caveResearchLocalIngestion } from "../feature-flags.ts";
import type {
  ResourceIngestJobStageV1,
  ResourceIngestJobV1,
  ResourceManifestV1,
  ResourceSnapshotV1,
} from "../research-resource-contracts.ts";
import { sha256Digest } from "../research-protocol/digest.ts";
import { fetchResearchResource, type ResearchFetchResult } from "./research-resource-fetch.ts";
import {
  extractResearchResource,
  ResearchResourceExtractionError,
  type ExtractedResearchResource,
} from "./research-resource-extractors.ts";
import {
  openResearchResourceLexicalIndex,
  rebuildResearchResourceLexicalIndex,
  ResearchResourceLexicalIndexError,
  type ResearchLexicalAuthority,
  type ResearchResourceLexicalIndex,
} from "./research-resource-lexical-index.ts";
import { removeResearchResourceSemanticPublication } from "./research-resource-semantic-index.ts";
import { listCompatibleResearchLinks } from "./research-links-compatibility.ts";
import {
  createResearchResourceStore,
  type ResourceDeletionJournalV1,
  type ResourceIngestFailureV1,
  type ResourceOperationalTransaction,
  type ResearchResourceStore,
} from "./research-resource-store.ts";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const RETRY_WINDOWS_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000] as const;

export type ResearchIngestionOutcome =
  | { kind: "disabled" }
  | { kind: "idle" }
  | { kind: "completed"; job: ResourceIngestJobV1; snapshot: ResourceSnapshotV1 }
  | { kind: "paused_quota"; job: ResourceIngestJobV1 }
  | { kind: "retry_wait"; job: ResourceIngestJobV1 }
  | { kind: "failed"; job: ResourceIngestJobV1 };

export type ResearchResourceIngestionOptions = {
  root?: string;
  store?: ResearchResourceStore;
  index?: ResearchResourceLexicalIndex;
  /** @internal Recovery already owns the maintenance lease and must not recurse. */
  recoveryAlreadyHeld?: boolean;
  enabled?: () => boolean;
  now?: () => Date;
  token?: () => string;
  fetch?: (url: string) => Promise<ResearchFetchResult>;
  extract?: (input: {
    bytes: Uint8Array;
    contentType?: string | null;
    sourceUrl?: string;
  }) => Promise<ExtractedResearchResource>;
  repairCompatibilityProjection?: () => Promise<unknown>;
  removeSemanticDerivatives?: (resourceId: string) => Promise<void>;
  failpoint?: (point: ResearchIngestionFailpoint) => void | Promise<void>;
};

export type ResearchIngestionFailpoint =
  | "terminal_failure_published"
  | "terminal_manifest_published"
  | "ready_before_manifest_commit";

export type ResearchResourceIngestion = {
  enqueue(resourceId: string, options?: { refresh?: boolean }): Promise<ResourceIngestJobV1 | null>;
  runNext(workerId: string): Promise<ResearchIngestionOutcome>;
  deleteResource(resourceId: string): Promise<boolean>;
  reconcileStartup(): Promise<void>;
  close(): Promise<void>;
};

function laterTimestamp(now: Date, previous: string): string {
  const current = now.getTime();
  const prior = Date.parse(previous);
  return new Date(Math.max(current, prior + 1)).toISOString();
}

function addMilliseconds(instant: Date, milliseconds: number): string {
  return new Date(instant.getTime() + milliseconds).toISOString();
}

function safeToken(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error("ingest lease token must be 128-bit lowercase hex");
  return value;
}

function stableId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
}

function jobId(resourceId: string, resourceRevision: number, deletionRevision: number): string {
  return `ingest-${stableId([resourceId, String(resourceRevision), String(deletionRevision)])}`;
}

function snapshotId(input: {
  resourceId: string;
  resourceRevision: number;
  rawDigest: string;
  normalizedDigest: string;
  extractorId: string;
  extractorVersion: string;
}): string {
  return `snapshot-${stableId([
    input.resourceId,
    String(input.resourceRevision),
    input.rawDigest,
    input.normalizedDigest,
    input.extractorId,
    input.extractorVersion,
  ])}`;
}

function deletionRevision(transaction: ResourceOperationalTransaction, resourceId: string): number {
  return transaction.readDeletionFence(resourceId)?.deletionRevision
    ?? transaction.readTombstone(resourceId)?.deletionRevision
    ?? 0;
}

function active(job: ResourceIngestJobV1): boolean {
  return !new Set(["completed", "failed", "cancelled"]).has(job.status);
}

function due(job: ResourceIngestJobV1, now: Date): boolean {
  return new Set(["queued", "retry_wait", "paused_quota"]).has(job.status)
    && Date.parse(job.availableAt) <= now.getTime();
}

function jobOrder(left: ResourceIngestJobV1, right: ResourceIngestJobV1): number {
  return left.availableAt.localeCompare(right.availableAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function nextRetryAt(job: ResourceIngestJobV1, attempt: number, now: Date): string {
  const base = RETRY_WINDOWS_MS[Math.min(attempt - 1, RETRY_WINDOWS_MS.length - 1)];
  const jitterRange = Math.max(1, Math.floor(base / 5));
  const jitter = Number.parseInt(stableId([job.id, String(attempt)]).slice(0, 8), 16) % jitterRange;
  return addMilliseconds(now, base + jitter);
}

function failureCode(fetch: Extract<ResearchFetchResult, { ok: false }>): string {
  return `fetch_${fetch.code}`;
}

function manifestById(
  transaction: ResourceOperationalTransaction,
  resourceId: string,
): ResourceManifestV1 | null {
  return transaction.listManifests().find((manifest) => manifest.id === resourceId) ?? null;
}

function nextManifest(
  manifest: ResourceManifestV1,
  now: Date,
  ingest: ResourceManifestV1["ingest"],
  snapshot?: ResourceSnapshotV1,
): ResourceManifestV1 {
  const next = structuredClone(manifest);
  delete next.currentSnapshotId;
  return {
    ...next,
    revision: manifest.revision + 1,
    ingest,
    updatedAt: laterTimestamp(now, manifest.updatedAt),
    ...(snapshot ? { currentSnapshotId: snapshot.id } : {}),
  };
}

function authority(
  snapshot: ResourceSnapshotV1,
  fenceRevision: number,
): ResearchLexicalAuthority {
  return {
    resourceId: snapshot.resourceId,
    resourceRevision: snapshot.resourceRevision,
    deletionRevision: fenceRevision,
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.normalizedBlobDigest,
  };
}

export function createResearchResourceIngestion(
  options: ResearchResourceIngestionOptions = {},
): ResearchResourceIngestion {
  const store = options.store ?? createResearchResourceStore({ root: options.root });
  const indexFile = options.root
    ? path.join(options.root, "index", "research-resources.sqlite")
    : undefined;
  let lexicalPromise: Promise<ResearchResourceLexicalIndex> | null = options.index
    ? Promise.resolve(options.index)
    : null;
  const enabled = options.enabled ?? caveResearchLocalIngestion;
  const clock = options.now ?? (() => new Date());
  const makeToken = options.token ?? (() => randomBytes(16).toString("hex"));
  const fetcher = options.fetch ?? fetchResearchResource;
  const extractor = options.extract ?? extractResearchResource;
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
  const failpoint = options.failpoint ?? (() => {});

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

  async function checkpoint(
    expected: ResourceIngestJobV1,
    token: string,
    stage: ResourceIngestJobStageV1,
  ): Promise<ResourceIngestJobV1> {
    const now = clock();
    return store.withOperationalTransaction(async (transaction) => {
      transaction.assertPublicationFence({
        expectedJob: expected,
        leaseToken: token,
        resourceId: expected.resourceId,
        resourceRevision: expected.resourceRevision,
        deletionRevision: expected.deletionRevision,
        now: now.toISOString(),
      });
      const next = {
        ...expected,
        stage,
        lease: { ...expected.lease!, expiresAt: addMilliseconds(now, LEASE_MS) },
        updatedAt: laterTimestamp(now, expected.updatedAt),
      };
      return transaction.replaceJob(expected, next);
    });
  }

  async function settleFailure(
    expected: ResourceIngestJobV1,
    token: string,
    input: { code: string; disposition: "retryable" | "nonretryable" | "paused_quota"; retryAfterMs?: number },
  ): Promise<ResearchIngestionOutcome> {
    const now = clock();
    return store.withOperationalTransaction(async (transaction) => {
      transaction.assertPublicationFence({
        expectedJob: expected,
        leaseToken: token,
        resourceId: expected.resourceId,
        resourceRevision: expected.resourceRevision,
        deletionRevision: expected.deletionRevision,
        now: now.toISOString(),
      });
      const attempt = input.disposition === "paused_quota" ? expected.attempt : expected.attempt + 1;
      const terminal = input.disposition === "nonretryable" || attempt >= MAX_ATTEMPTS;
      const status = input.disposition === "paused_quota"
        ? "paused_quota"
        : terminal ? "failed" : "retry_wait";
      const availableAt = input.disposition === "paused_quota"
        ? addMilliseconds(now, Math.max(1_000, input.retryAfterMs ?? RETRY_WINDOWS_MS[0]))
        : terminal ? now.toISOString() : nextRetryAt(expected, attempt, now);
      const { lease: _lease, ...unleased } = expected;
      const settled: ResourceIngestJobV1 = {
        ...unleased,
        status,
        attempt,
        availableAt,
        updatedAt: laterTimestamp(now, expected.updatedAt),
      };
      const failure: ResourceIngestFailureV1 = {
        version: 1,
        jobId: settled.id,
        resourceId: settled.resourceId,
        resourceRevision: settled.resourceRevision,
        deletionRevision: settled.deletionRevision,
        stage: settled.stage,
        code: input.code,
        retryable: !terminal || input.disposition === "paused_quota",
        occurredAt: now.toISOString(),
      };
      if (terminal) {
        await transaction.writeFailure(failure);
        await failpoint("terminal_failure_published");
        const manifest = manifestById(transaction, settled.resourceId);
        if (!manifest || manifest.revision !== settled.resourceRevision) {
          throw new Error("resource manifest changed before terminal failure publication");
        }
        await transaction.updateManifest({
          id: manifest.id,
          expectedRevision: manifest.revision,
          manifest: nextManifest(manifest, now, {
            desired: manifest.ingest.desired,
            state: "failed",
            lastFailureCode: input.code,
            retryable: false,
          }),
        });
        await failpoint("terminal_manifest_published");
        const job = await transaction.replaceJob(expected, settled);
        return { kind: status, job } as ResearchIngestionOutcome;
      }
      const job = await transaction.replaceJob(expected, settled);
      await transaction.writeFailure(failure);
      return { kind: status, job } as ResearchIngestionOutcome;
    });
  }

  async function claimNext(workerId: string): Promise<ResourceIngestJobV1 | null> {
    const now = clock();
    const token = safeToken(makeToken());
    return store.withOperationalTransaction(async (transaction) => {
      for (const abandoned of transaction.listJobs().filter((job) =>
        job.status === "claimed" && Date.parse(job.lease!.expiresAt) <= now.getTime())) {
        const manifest = manifestById(transaction, abandoned.resourceId);
        const current = manifest?.revision === abandoned.resourceRevision
          && deletionRevision(transaction, abandoned.resourceId) === abandoned.deletionRevision
          && !transaction.readDeletionJournal(abandoned.resourceId);
        const { lease: _lease, ...unleased } = abandoned;
        await transaction.replaceJob(abandoned, {
          ...unleased,
          status: current ? "queued" : "cancelled",
          stage: current ? "fetch" : abandoned.stage,
          availableAt: now.toISOString(),
          updatedAt: laterTimestamp(now, abandoned.updatedAt),
        });
      }
      for (const candidate of transaction.listJobs().filter((job) => due(job, now)).sort(jobOrder)) {
        const manifest = manifestById(transaction, candidate.resourceId);
        if (
          !manifest
          || manifest.revision !== candidate.resourceRevision
          || deletionRevision(transaction, candidate.resourceId) !== candidate.deletionRevision
          || transaction.readDeletionJournal(candidate.resourceId)
          || (transaction.readTombstone(candidate.resourceId)?.deletionRevision ?? 0) > candidate.deletionRevision
        ) {
          const cancelled: ResourceIngestJobV1 = {
            ...candidate,
            status: "cancelled",
            updatedAt: laterTimestamp(now, candidate.updatedAt),
          };
          await transaction.replaceJob(candidate, cancelled);
          continue;
        }
        const claimed: ResourceIngestJobV1 = {
          ...candidate,
          status: "claimed",
          lease: { owner: workerId, token, expiresAt: addMilliseconds(now, LEASE_MS) },
          updatedAt: laterTimestamp(now, candidate.updatedAt),
        };
        return transaction.replaceJob(candidate, claimed);
      }
      return null;
    });
  }

  async function runNext(workerId: string): Promise<ResearchIngestionOutcome> {
    if (!enabled()) return { kind: "disabled" };
    await ensureStartupRecovery();
    let claimed = await claimNext(workerId);
    if (!claimed) return { kind: "idle" };
    const token = claimed.lease!.token;
    const manifest = await store.withOperationalTransaction(async (transaction) => {
      transaction.assertPublicationFence({
        expectedJob: claimed!, leaseToken: token, resourceId: claimed!.resourceId,
        resourceRevision: claimed!.resourceRevision, deletionRevision: claimed!.deletionRevision,
        now: clock().toISOString(),
      });
      return manifestById(transaction, claimed!.resourceId);
    });
    if (!manifest?.sourceUri) {
      return settleFailure(claimed, token, { code: "missing_source_uri", disposition: "nonretryable" });
    }

    const fetched = await fetcher(manifest.sourceUri);
    if (!fetched.ok) {
      return settleFailure(claimed, token, {
        code: failureCode(fetched),
        disposition: fetched.disposition,
        ...(fetched.retryAfterMs === undefined ? {} : { retryAfterMs: fetched.retryAfterMs }),
      });
    }
    claimed = await checkpoint(claimed, token, "snapshot");

    let extracted: ExtractedResearchResource;
    try {
      extracted = await extractor({
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        sourceUrl: fetched.finalUrl,
      });
    } catch (error) {
      const code = error instanceof ResearchResourceExtractionError
        ? `extract_${error.code}` : "extract_failed";
      return settleFailure(claimed, token, { code, disposition: "nonretryable" });
    }
    claimed = await checkpoint(claimed, token, "extract");

    const now = clock();
    const rawDigest = sha256Digest(fetched.bytes);
    const normalizedDigest = sha256Digest(extracted.normalizedBytes);
    const finalRevision = claimed.resourceRevision + 1;
    const snapshot: ResourceSnapshotV1 = {
      version: 1,
      id: snapshotId({
        resourceId: claimed.resourceId,
        resourceRevision: finalRevision,
        rawDigest,
        normalizedDigest,
        ...extracted.normalizationReceipt,
      }),
      resourceId: claimed.resourceId,
      resourceRevision: finalRevision,
      rawBlobDigest: rawDigest,
      normalizedBlobDigest: normalizedDigest,
      normalizedMediaType: extracted.normalizedMediaType,
      normalizedBytes: extracted.normalizedBytes.byteLength,
      normalizationReceipt: extracted.normalizationReceipt,
      sourceSelector: { type: "whole-resource" },
      ...(extracted.pageBoundaries ? { pageBoundaries: extracted.pageBoundaries } : {}),
      fetchedAt: fetched.fetchedAt,
      finalUrl: fetched.finalUrl,
      ...(fetched.etag ? { etag: fetched.etag } : {}),
      ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      createdAt: now.toISOString(),
    };

    return store.withOperationalTransaction(async (transaction) => {
      transaction.assertPublicationFence({
        expectedJob: claimed!, leaseToken: token, resourceId: claimed!.resourceId,
        resourceRevision: claimed!.resourceRevision, deletionRevision: claimed!.deletionRevision,
        now: now.toISOString(),
      });
      await transaction.publishSnapshot({
        snapshot,
        rawBlob: fetched.bytes,
        normalizedBlob: extracted.normalizedBytes,
      });
      transaction.assertPublicationFence({
        expectedJob: claimed!, leaseToken: token, resourceId: claimed!.resourceId,
        resourceRevision: claimed!.resourceRevision, deletionRevision: claimed!.deletionRevision,
        now: clock().toISOString(),
      });
      const publishing = await transaction.replaceJob(claimed!, {
        ...claimed!,
        stage: "publish_lexical",
        lease: { ...claimed!.lease!, expiresAt: addMilliseconds(clock(), LEASE_MS) },
        updatedAt: laterTimestamp(now, claimed!.updatedAt),
      });
      transaction.assertPublicationFence({
        expectedJob: publishing, leaseToken: token, resourceId: publishing.resourceId,
        resourceRevision: publishing.resourceRevision, deletionRevision: publishing.deletionRevision,
        now: clock().toISOString(),
      });
      await withLexical((lexical) => lexical.replace({
        ...authority(snapshot, publishing.deletionRevision),
        normalizedBytes: extracted.normalizedBytes,
      }), transaction);
      transaction.assertPublicationFence({
        expectedJob: publishing, leaseToken: token, resourceId: publishing.resourceId,
        resourceRevision: publishing.resourceRevision, deletionRevision: publishing.deletionRevision,
        now: clock().toISOString(),
      });
      const current = manifestById(transaction, publishing.resourceId);
      if (!current || current.revision !== publishing.resourceRevision) {
        throw new Error("resource manifest changed before ready publication");
      }
      const ready = nextManifest(current, now, { desired: true, state: "ready" }, snapshot);
      await failpoint("ready_before_manifest_commit");
      await transaction.commitReadyManifest({
        expectedJob: publishing,
        leaseToken: token,
        now: clock().toISOString(),
        id: current.id,
        expectedRevision: current.revision,
        manifest: ready,
      });
      const { lease: _lease, ...unleased } = publishing;
      const completed = await transaction.replaceJob(publishing, {
        ...unleased,
        status: "completed",
        availableAt: now.toISOString(),
        updatedAt: laterTimestamp(now, publishing.updatedAt),
      });
      await transaction.deleteFailure(completed.id);
      return { kind: "completed", job: completed, snapshot };
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
    enqueue,
    runNext,
    deleteResource,
    reconcileStartup,
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
