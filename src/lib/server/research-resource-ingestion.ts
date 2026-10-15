import { randomBytes } from "node:crypto";
import type { ResourceIngestJobStageV1, ResourceIngestJobV1, ResourceSnapshotV1 } from "../research-resource-contracts.ts";
import { sha256Digest } from "../research-protocol/digest.ts";
import { fetchResearchResource, type ResearchFetchResult } from "./research-resource-fetch.ts";
import { extractResearchResource, ResearchResourceExtractionError, type ExtractedResearchResource } from "./research-resource-extractors.ts";
import type { ResourceIngestFailureV1 } from "./research-resource-store.ts";
import { createResearchResourceMaintenance, type ResearchResourceMaintenanceOptions } from "./research-resource-maintenance.ts";
import { laterTimestamp, stableId, deletionRevision, manifestById, nextManifest, authority } from "./research-resource-state.ts";

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

export type ResearchResourceIngestionOptions = ResearchResourceMaintenanceOptions & {
  token?: () => string;
  fetch?: (url: string) => Promise<ResearchFetchResult>;
  extract?: (input: {
    bytes: Uint8Array;
    contentType?: string | null;
    sourceUrl?: string;
  }) => Promise<ExtractedResearchResource>;
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

function addMilliseconds(instant: Date, milliseconds: number): string {
  return new Date(instant.getTime() + milliseconds).toISOString();
}

function safeToken(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error("ingest lease token must be 128-bit lowercase hex");
  return value;
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

export function createResearchResourceIngestion(
  options: ResearchResourceIngestionOptions = {},
): ResearchResourceIngestion {
  const maintenance = createResearchResourceMaintenance(options);
  const { store, clock, enabled, ensureStartupRecovery, withLexical } = maintenance;
  const makeToken = options.token ?? (() => randomBytes(16).toString("hex"));
  const fetcher = options.fetch ?? fetchResearchResource;
  const extractor = options.extract ?? extractResearchResource;
  const failpoint = options.failpoint ?? (() => {});

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

  return {
    enqueue: maintenance.enqueue,
    runNext,
    deleteResource: maintenance.deleteResource,
    reconcileStartup: maintenance.reconcileStartup,
    close: maintenance.close,
  };
}
