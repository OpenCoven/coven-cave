import path from "node:path";
import { existsSync } from "node:fs";

import { caveResearchSemantic } from "../feature-flags.ts";
import type {
  ResourceManifestV1,
  ResourceSnapshotV1,
} from "../research-resource-contracts.ts";
import { canonicalJson } from "../research-protocol/digest.ts";
import {
  configuredResearchEmbeddingProvider,
  embedResearchResourceInputs,
  MAX_RESEARCH_EMBEDDING_INPUTS,
  ResearchEmbeddingProviderError,
  type ResearchEmbeddingAvailability,
  type ValidatedResearchEmbeddingProviderConfig,
} from "./research-resource-embedding-provider.ts";
import {
  chunkResearchResourceUtf8,
  openResearchResourceLexicalIndex,
  type ResearchLexicalAuthority,
  type ResearchResourceLexicalIndex,
} from "./research-resource-lexical-index.ts";
import {
  openResearchResourceSemanticIndex,
  rebuildResearchResourceSemanticIndex,
  researchResourceSemanticIndexPath,
  ResearchResourceSemanticIndexError,
  type ResearchResourceSemanticIndex,
  type ResearchSemanticAuthority,
  type ResearchSemanticProbe,
} from "./research-resource-semantic-index.ts";
import {
  createResearchResourceStore,
  type ResourceEmbeddingTaskRecordV1,
  type ResourceOperationalTransaction,
  type ResearchResourceStore,
} from "./research-resource-store.ts";

export type ResearchSemanticAvailability =
  | { state: "disabled" }
  | ResearchEmbeddingAvailability;

export type ResearchResourceSemanticState =
  | { state: "disabled" }
  | { state: "unavailable"; code: "not_configured" | "invalid_configuration" | "provider_offline" | "not_ready" }
  | ({ state: "ready" } & ValidatedResearchEmbeddingProviderConfig);

export type ResearchSemanticRunOutcome =
  | { kind: "disabled" }
  | { kind: "unavailable"; code: string }
  | { kind: "idle" }
  | { kind: "stale"; resourceId: string }
  | { kind: "ready"; task: ResourceEmbeddingTaskRecordV1 }
  | { kind: "failed"; task: ResourceEmbeddingTaskRecordV1 }
  | { kind: "task_unavailable"; task: ResourceEmbeddingTaskRecordV1 };

export type ResearchResourceSemanticOptions = {
  root?: string;
  store?: ResearchResourceStore;
  lexicalIndex?: ResearchResourceLexicalIndex;
  semanticIndex?: ResearchResourceSemanticIndex;
  enabled?: () => boolean;
  provider?: () => ResearchEmbeddingAvailability;
  embed?: typeof embedResearchResourceInputs;
  now?: () => Date;
  failpoint?: (point: "vectors_committed_before_task_ready") => void | Promise<void>;
};

export type ResearchResourceSemantic = {
  availability(): ResearchSemanticAvailability;
  resourceState(resourceId: string): Promise<ResearchResourceSemanticState>;
  reconcileStartup(): Promise<void>;
  runNext(): Promise<ResearchSemanticRunOutcome>;
  probe(resourceId: string, queryVector: readonly number[], limit?: number): Promise<ResearchSemanticProbe>;
  removeResource(resourceId: string): Promise<void>;
  close(): Promise<void>;
};

function laterTimestamp(now: Date, previous: string): string {
  return new Date(Math.max(now.getTime(), Date.parse(previous) + 1)).toISOString();
}

function deletionRevision(transaction: ResourceOperationalTransaction, resourceId: string): number {
  return transaction.readDeletionFence(resourceId)?.deletionRevision
    ?? transaction.readTombstone(resourceId)?.deletionRevision
    ?? 0;
}

function manifestById(
  transaction: ResourceOperationalTransaction,
  resourceId: string,
): ResourceManifestV1 | null {
  return transaction.listManifests().find((manifest) => manifest.id === resourceId) ?? null;
}

function sameTaskIdentity(
  task: ResourceEmbeddingTaskRecordV1,
  snapshot: ResourceSnapshotV1,
  provider: ValidatedResearchEmbeddingProviderConfig,
): boolean {
  return task.resourceId === snapshot.resourceId
    && task.snapshotId === snapshot.id
    && task.lexicalRevision === snapshot.resourceRevision
    && task.providerId === provider.providerId
    && task.modelId === provider.modelId
    && task.dimensions === provider.dimensions
    && task.modelRevision === provider.modelRevision;
}

function sameTaskRecord(
  left: ResourceEmbeddingTaskRecordV1,
  right: ResourceEmbeddingTaskRecordV1,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function lexicalAuthority(
  snapshot: ResourceSnapshotV1,
  fence: number,
): ResearchLexicalAuthority {
  return {
    resourceId: snapshot.resourceId,
    resourceRevision: snapshot.resourceRevision,
    deletionRevision: fence,
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.normalizedBlobDigest,
  };
}

function semanticAuthority(
  snapshot: ResourceSnapshotV1,
  fence: number,
  provider: ValidatedResearchEmbeddingProviderConfig,
): ResearchSemanticAuthority {
  return {
    ...lexicalAuthority(snapshot, fence),
    providerId: provider.providerId,
    modelId: provider.modelId,
    dimensions: provider.dimensions,
    modelRevision: provider.modelRevision,
  };
}

function sameLexicalAuthority(
  left: ResearchLexicalAuthority | null,
  right: ResearchLexicalAuthority,
): boolean {
  return left !== null
    && left.resourceId === right.resourceId
    && left.resourceRevision === right.resourceRevision
    && left.deletionRevision === right.deletionRevision
    && left.snapshotId === right.snapshotId
    && left.snapshotDigest === right.snapshotDigest;
}

function sameSemanticAuthority(
  left: ResearchSemanticAuthority | null,
  right: ResearchSemanticAuthority,
): boolean {
  return left !== null
    && sameLexicalAuthority(left, right)
    && left.providerId === right.providerId
    && left.modelId === right.modelId
    && left.dimensions === right.dimensions
    && left.modelRevision === right.modelRevision;
}

function queuedTask(
  snapshot: ResourceSnapshotV1,
  provider: ValidatedResearchEmbeddingProviderConfig,
  now: Date,
): ResourceEmbeddingTaskRecordV1 {
  return {
    version: 1,
    resourceId: snapshot.resourceId,
    snapshotId: snapshot.id,
    lexicalRevision: snapshot.resourceRevision,
    providerId: provider.providerId,
    modelId: provider.modelId,
    dimensions: provider.dimensions,
    modelRevision: provider.modelRevision,
    status: "queued",
    updatedAt: now.toISOString(),
  };
}

export function createResearchResourceSemantic(
  options: ResearchResourceSemanticOptions = {},
): ResearchResourceSemantic {
  const store = options.store ?? createResearchResourceStore({ root: options.root });
  const ownsLexicalIndex = options.lexicalIndex === undefined;
  const ownsSemanticIndex = options.semanticIndex === undefined;
  const lexicalFile = options.root
    ? path.join(options.root, "index", "research-resources.sqlite")
    : undefined;
  const semanticFile = researchResourceSemanticIndexPath(options.root);
  const lexicalPromise = options.lexicalIndex
    ? Promise.resolve(options.lexicalIndex)
    : openResearchResourceLexicalIndex(lexicalFile ? { file: lexicalFile } : undefined);
  let semanticPromise = options.semanticIndex
    ? Promise.resolve(options.semanticIndex)
    : null;
  void lexicalPromise.catch(() => {});
  const enabled = options.enabled ?? caveResearchSemantic;
  const provider = options.provider ?? configuredResearchEmbeddingProvider;
  const embed = options.embed ?? embedResearchResourceInputs;
  const clock = options.now ?? (() => new Date());
  const failpoint = options.failpoint ?? (() => {});

  function availability(): ResearchSemanticAvailability {
    return enabled() ? provider() : { state: "disabled" };
  }

  function openSemantic(): Promise<ResearchResourceSemanticIndex> {
    if (!semanticPromise) {
      semanticPromise = openResearchResourceSemanticIndex({ file: semanticFile });
      void semanticPromise.catch(() => {});
    }
    return semanticPromise;
  }

  /** Every caller holds the Resource operational transaction lock. Keeping
   * rebuild/quarantine behind that shared cross-process mutation lock makes
   * replacement converge without introducing a second lock order. */
  async function withSemanticLocked<T>(
    operation: (index: ResearchResourceSemanticIndex) => T | Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await openSemantic());
    } catch (error) {
      if (!ownsSemanticIndex || !(error instanceof ResearchResourceSemanticIndexError)) throw error;
      if (error.code === "stale") {
        try { (await semanticPromise)?.close(); } catch { /* stale identity wins */ }
        semanticPromise = openResearchResourceSemanticIndex({ file: semanticFile });
        void semanticPromise.catch(() => {});
        return operation(await semanticPromise);
      }
      if (error.code !== "corrupt") throw error;
      try { (await semanticPromise)?.close(); } catch { /* corruption error wins */ }
      semanticPromise = rebuildResearchResourceSemanticIndex({ file: semanticFile })
        .then((result) => result.index);
      void semanticPromise.catch(() => {});
      return operation(await semanticPromise);
    }
  }

  async function currentAuthority(
    transaction: ResourceOperationalTransaction,
    resourceId: string,
    effective: ValidatedResearchEmbeddingProviderConfig,
  ): Promise<{ snapshot: ResourceSnapshotV1; normalizedBlob: Uint8Array;
    authority: ResearchSemanticAuthority } | null> {
    const manifest = manifestById(transaction, resourceId);
    if (!manifest || manifest.ingest.state !== "ready" || !manifest.currentSnapshotId
        || transaction.readDeletionJournal(resourceId)) return null;
    const verified = await transaction.readSnapshot(manifest.currentSnapshotId);
    if (verified.snapshot.resourceId !== resourceId
        || verified.snapshot.resourceRevision !== manifest.revision) return null;
    const authority = semanticAuthority(
      verified.snapshot,
      deletionRevision(transaction, resourceId),
      effective,
    );
    const lexical = await lexicalPromise;
    if (!sameLexicalAuthority(lexical.publication(resourceId), authority)) return null;
    return { snapshot: verified.snapshot, normalizedBlob: verified.normalizedBlob, authority };
  }

  function currentChunks(current: NonNullable<Awaited<ReturnType<typeof currentAuthority>>>) {
    return chunkResearchResourceUtf8(current.normalizedBlob, current.authority);
  }

  async function reconcileStartup(): Promise<void> {
    if (!enabled()) return;
    const effective = provider();
    if (effective.state !== "ready") {
      await store.withOperationalTransaction(async (transaction) => {
        for (const task of transaction.listEmbeddingTasks()) {
          if (task.status !== "queued" && task.status !== "building") continue;
          await transaction.replaceEmbeddingTask(task, {
            ...task,
            status: "unavailable",
            updatedAt: laterTimestamp(clock(), task.updatedAt),
          });
        }
      });
      return;
    }
    await store.withOperationalTransaction(async (transaction) => {
      for (const task of transaction.listEmbeddingTasks()) {
        const current = await currentAuthority(transaction, task.resourceId, effective);
        const compatible = current
          && sameTaskIdentity(task, current.snapshot, effective)
          && (task.status !== "ready"
            || await withSemanticLocked((index) => sameSemanticAuthority(
              index.publication(task.resourceId), current.authority,
            ) && index.verify(current.authority, currentChunks(current))));
        if (!compatible) {
          await transaction.removeEmbeddingTask(task.resourceId, task);
          continue;
        }
        if (task.status === "building" || task.status === "unavailable") {
          await transaction.replaceEmbeddingTask(task, {
            ...task,
            status: "queued",
            updatedAt: laterTimestamp(clock(), task.updatedAt),
          });
        }
      }
      for (const manifest of transaction.listManifests()) {
        if (transaction.readEmbeddingTask(manifest.id)) continue;
        const current = await currentAuthority(transaction, manifest.id, effective);
        if (!current) continue;
        await transaction.createEmbeddingTask(queuedTask(current.snapshot, effective, clock()));
      }
    });
  }

  async function settle(
    expected: ResourceEmbeddingTaskRecordV1,
    status: "failed" | "unavailable",
  ): Promise<ResourceEmbeddingTaskRecordV1 | null> {
    return store.withOperationalTransaction(async (transaction) => {
      const current = transaction.readEmbeddingTask(expected.resourceId);
      if (!current || !sameTaskRecord(current, expected)) return null;
      return transaction.replaceEmbeddingTask(expected, {
        ...expected,
        status,
        updatedAt: laterTimestamp(clock(), expected.updatedAt),
      });
    });
  }

  async function runNext(): Promise<ResearchSemanticRunOutcome> {
    if (!enabled()) return { kind: "disabled" };
    const effective = provider();
    if (effective.state !== "ready") return { kind: "unavailable", code: effective.code };
    const claimed: ResourceEmbeddingTaskRecordV1 | { stale: string } | null =
      await store.withOperationalTransaction(async (transaction) => {
      const candidate = transaction.listEmbeddingTasks().find((task) => task.status === "queued");
      if (!candidate) return null;
      const current = await currentAuthority(transaction, candidate.resourceId, effective);
      if (!current || !sameTaskIdentity(candidate, current.snapshot, effective)) {
        await transaction.removeEmbeddingTask(candidate.resourceId, candidate);
        return { stale: candidate.resourceId } as const;
      }
      return transaction.replaceEmbeddingTask(candidate, {
        ...candidate,
        status: "building",
        updatedAt: laterTimestamp(clock(), candidate.updatedAt),
      });
      });
    if (!claimed) return { kind: "idle" };
    if (!("resourceId" in claimed)) return { kind: "stale", resourceId: claimed.stale };

    const prepared: {
      snapshot: ResourceSnapshotV1;
      authority: ResearchSemanticAuthority;
      chunks: ReturnType<typeof chunkResearchResourceUtf8>;
    } | null = await store.withOperationalTransaction(async (transaction) => {
      const current = transaction.readEmbeddingTask(claimed.resourceId);
      if (!current || current.status !== "building" || !sameTaskRecord(current, claimed)) return null;
      const resolved = await currentAuthority(transaction, claimed.resourceId, effective);
      if (!resolved || !sameTaskIdentity(claimed, resolved.snapshot, effective)) return null;
      const verified = await transaction.readSnapshot(resolved.snapshot.id);
      return {
        snapshot: resolved.snapshot,
        authority: resolved.authority,
        chunks: chunkResearchResourceUtf8(verified.normalizedBlob, resolved.authority),
      };
    });
    if (!prepared) {
      await store.withOperationalTransaction(async (transaction) => {
        const current = transaction.readEmbeddingTask(claimed.resourceId);
        if (current && sameTaskRecord(current, claimed)) {
          await transaction.removeEmbeddingTask(claimed.resourceId, current);
        }
      });
      return { kind: "stale", resourceId: claimed.resourceId };
    }

    const vectors: number[][] = [];
    try {
      for (let start = 0; start < prepared.chunks.length; start += MAX_RESEARCH_EMBEDDING_INPUTS) {
        const batch = prepared.chunks.slice(start, start + MAX_RESEARCH_EMBEDDING_INPUTS);
        vectors.push(...await embed(effective, batch.map((chunk) => chunk.text)));
      }
    } catch (error) {
      const unavailable = error instanceof ResearchEmbeddingProviderError
        && error.disposition === "unavailable";
      const task = await settle(claimed, unavailable ? "unavailable" : "failed");
      if (!task) return { kind: "stale", resourceId: claimed.resourceId };
      return unavailable ? { kind: "task_unavailable", task } : { kind: "failed", task };
    }
    if (!enabled()) return { kind: "disabled" };
    const stillEffective = provider();
    if (stillEffective.state !== "ready" || stillEffective.modelRevision !== effective.modelRevision) {
      const task = await settle(claimed, "unavailable");
      return task ? { kind: "task_unavailable", task } : { kind: "stale", resourceId: claimed.resourceId };
    }

    return store.withOperationalTransaction(async (transaction) => {
      const current = transaction.readEmbeddingTask(claimed.resourceId);
      if (!current || !sameTaskRecord(current, claimed)) {
        return { kind: "stale", resourceId: claimed.resourceId };
      }
      const resolved = await currentAuthority(transaction, claimed.resourceId, effective);
      if (!resolved || !sameTaskIdentity(claimed, resolved.snapshot, effective)
          || resolved.authority.modelRevision !== prepared!.authority.modelRevision) {
        await transaction.removeEmbeddingTask(claimed.resourceId, current);
        return { kind: "stale", resourceId: claimed.resourceId };
      }
      const publishChunks = currentChunks(resolved);
      if (publishChunks.length !== prepared!.chunks.length) {
        await transaction.removeEmbeddingTask(claimed.resourceId, current);
        return { kind: "stale", resourceId: claimed.resourceId };
      }
      await withSemanticLocked((semantic) => semantic.replace(resolved.authority, publishChunks.map((chunk, index) => ({
        id: chunk.id,
        ordinal: chunk.ordinal,
        byteStart: chunk.byteStart,
        byteEnd: chunk.byteEnd,
        vector: vectors[index]!,
      }))));
      await failpoint("vectors_committed_before_task_ready");
      const ready = await transaction.replaceEmbeddingTask(current, {
        ...current,
        status: "ready",
        updatedAt: laterTimestamp(clock(), current.updatedAt),
      });
      return { kind: "ready", task: ready };
    });
  }

  async function resourceState(resourceId: string): Promise<ResearchResourceSemanticState> {
    if (!enabled()) return { state: "disabled" };
    const effective = provider();
    if (effective.state !== "ready") return effective;
    const ready = await store.withOperationalTransaction(async (transaction) => {
      const task = transaction.readEmbeddingTask(resourceId);
      if (!task || task.status !== "ready") return false;
      const current = await currentAuthority(transaction, resourceId, effective);
      return Boolean(current
        && sameTaskIdentity(task, current.snapshot, effective)
        && await withSemanticLocked((semantic) => sameSemanticAuthority(
          semantic.publication(resourceId), current.authority,
        ) && semantic.verify(current.authority, currentChunks(current))));
    });
    return ready ? effective : { state: "unavailable", code: "not_ready" };
  }

  async function probe(
    resourceId: string,
    queryVector: readonly number[],
    limit?: number,
  ): Promise<ResearchSemanticProbe> {
    if (!enabled()) return { usable: false, vectorCount: 0, hits: [] };
    const effective = provider();
    if (effective.state !== "ready") return { usable: false, vectorCount: 0, hits: [] };
    return store.withOperationalTransaction(async (transaction) => {
      const task = transaction.readEmbeddingTask(resourceId);
      const current = await currentAuthority(transaction, resourceId, effective);
      if (!task || task.status !== "ready" || !current
          || !sameTaskIdentity(task, current.snapshot, effective)) {
        return { usable: false, vectorCount: 0, hits: [] };
      }
      return withSemanticLocked((semantic) => {
        if (!semantic.verify(current.authority, currentChunks(current))) {
          return { usable: false, vectorCount: 0, hits: [] };
        }
        return semantic.probe(current.authority, queryVector, limit);
      });
    });
  }

  async function removeResource(resourceId: string): Promise<void> {
    await store.withOperationalTransaction(async (transaction) => {
      const task = transaction.readEmbeddingTask(resourceId);
      if (task) await transaction.removeEmbeddingTask(resourceId, task);
    });
    if (semanticPromise || existsSync(semanticFile)) await store.withOperationalTransaction(async () => {
      await withSemanticLocked((semantic) => {
        semantic.remove(resourceId);
        semantic.purgeResidualFiles();
      });
    });
  }

  async function close(): Promise<void> {
    if (ownsLexicalIndex) (await lexicalPromise).close();
    if (ownsSemanticIndex && semanticPromise) (await semanticPromise).close();
  }

  return { availability, resourceState, reconcileStartup, runNext, probe, removeResource, close };
}
