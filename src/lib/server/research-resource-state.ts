// Shared persistence rules used by offline recovery and optional ingestion workers.
import { createHash } from "node:crypto";
import type { ResourceIngestJobV1, ResourceManifestV1, ResourceSnapshotV1 } from "../research-resource-contracts.ts";
import type { ResourceOperationalTransaction } from "./research-resource-store.ts";
import type { ResearchLexicalAuthority } from "./research-resource-lexical-index.ts";

export function laterTimestamp(now: Date, previous: string): string {
  const current = now.getTime();
  const prior = Date.parse(previous);
  return new Date(Math.max(current, prior + 1)).toISOString();
}

export function stableId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
}

export function jobId(resourceId: string, resourceRevision: number, deletionRevision: number): string {
  return `ingest-${stableId([resourceId, String(resourceRevision), String(deletionRevision)])}`;
}

export function deletionRevision(transaction: ResourceOperationalTransaction, resourceId: string): number {
  return transaction.readDeletionFence(resourceId)?.deletionRevision
    ?? transaction.readTombstone(resourceId)?.deletionRevision
    ?? 0;
}

export function active(job: ResourceIngestJobV1): boolean {
  return !new Set(["completed", "failed", "cancelled"]).has(job.status);
}

export function manifestById(
  transaction: ResourceOperationalTransaction,
  resourceId: string,
): ResourceManifestV1 | null {
  return transaction.listManifests().find((manifest) => manifest.id === resourceId) ?? null;
}

export function nextManifest(
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

export function authority(
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

