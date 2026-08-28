import { createHash } from "node:crypto";
import path from "node:path";

import {
  parseResourceQueryV1,
  type ResourceManifestV1,
  type ResourceQueryHitV1,
  type ResourceQueryResponseV1,
  type ResourceQueryV1,
} from "../research-resource-contracts.ts";
import {
  openResearchResourceLexicalIndex,
  type ResearchLexicalSearchHit,
  type ResearchResourceLexicalIndex,
} from "./research-resource-lexical-index.ts";
import {
  createResearchResourceStore,
  type ResourceOperationalTransaction,
  type ResearchResourceStore,
  type VerifiedResourceSnapshot,
} from "./research-resource-store.ts";

const EXCERPT_CHARACTERS = 480;
const LEXICAL_CANDIDATE_LIMIT = 100;

export class ResearchResourceRetrievalError extends Error {
  readonly code: "invalid-query" | "unsupported-filter" | "unavailable";

  constructor(code: ResearchResourceRetrievalError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchResourceRetrievalError";
    this.code = code;
  }
}

type Candidate = {
  manifest: ResourceManifestV1;
  lexical?: ResearchLexicalSearchHit;
  exactRank?: number;
  lexicalRank?: number;
  score: number;
};

export type ResearchResourceRetrieval = {
  query(input: unknown): Promise<ResourceQueryResponseV1>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function matchesFilters(manifest: ResourceManifestV1, query: ResourceQueryV1): boolean {
  const filters = query.filters;
  if (!filters) return true;
  if (filters.projectIds && (!manifest.subject.projectId || !filters.projectIds.includes(manifest.subject.projectId))) return false;
  if (filters.familiarIds && (!manifest.subject.familiarId || !filters.familiarIds.includes(manifest.subject.familiarId))) return false;
  if (filters.kinds && !filters.kinds.includes(manifest.kind)) return false;
  if (filters.sensitivities && !filters.sensitivities.includes(manifest.sensitivity)) return false;
  if (filters.ingestStates && !filters.ingestStates.includes(manifest.ingest.state)) return false;
  if (filters.publishedFrom && (!manifest.publishedAt || manifest.publishedAt < filters.publishedFrom)) return false;
  if (filters.publishedBefore && (!manifest.publishedAt || manifest.publishedAt >= filters.publishedBefore)) return false;
  return true;
}

function exactText(manifest: ResourceManifestV1): string {
  return [manifest.title, manifest.canonicalIdentity, manifest.sourceUri]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .normalize("NFKC")
    .toLowerCase();
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type EligibleManifest = {
  manifest: ResourceManifestV1;
};

function eligibleManifest(
  transaction: Pick<
    ResourceOperationalTransaction,
    "listJobs" | "readDeletionFence" | "readDeletionJournal" | "readTombstone"
  >,
  manifest: ResourceManifestV1,
): EligibleManifest | null {
  // beginDeletion publishes the journal and fence before it advances the
  // manifest to `deleting`. Every lane must therefore consult operational
  // deletion authority rather than trusting a briefly-still-ready manifest.
  if (transaction.readDeletionJournal(manifest.id)) return null;

  const fence = transaction.readDeletionFence(manifest.id);
  const tombstone = transaction.readTombstone(manifest.id);
  if (!fence && !tombstone) return { manifest };

  // A lone/mismatched fence or tombstone is an interrupted/restored deletion,
  // not evidence that an old ready manifest is live. A completed deletion
  // retains both records at the same generation. Timestamps and manifest
  // revisions can repeat across same-id recreation, so the only authoritative
  // proof is a completed publication job fenced to that retained generation.
  if (!fence || !tombstone || fence.deletionRevision !== tombstone.deletionRevision) return null;
  const recreated = transaction.listJobs().some((job) =>
    job.resourceId === manifest.id &&
    job.status === "completed" &&
    job.deletionRevision === fence.deletionRevision &&
    job.resourceRevision + 1 === manifest.revision);
  return recreated ? { manifest } : null;
}

function foldedSourceWithOffsets(source: string): { folded: string; sourceOffsets: number[] } {
  let folded = "";
  const sourceOffsets: number[] = [];
  let sourceOffset = 0;
  for (const point of source) {
    const normalized = point.normalize("NFKC").toLowerCase();
    folded += normalized;
    for (let index = 0; index < normalized.length; index += 1) sourceOffsets.push(sourceOffset);
    sourceOffset += point.length;
  }
  return { folded, sourceOffsets };
}

function queryMatchOffset(source: string, query: string): number {
  const mapped = foldedSourceWithOffsets(source);
  const foldedQuery = query.normalize("NFKC").trim().toLowerCase();
  const tokens = foldedQuery.match(/[\p{L}\p{N}]+/gu) ?? [];
  const needles = [foldedQuery, ...tokens.sort((left, right) => right.length - left.length)]
    .filter((needle, index, values) => needle.length > 0 && values.indexOf(needle) === index);
  for (const needle of needles) {
    const match = mapped.folded.indexOf(needle);
    if (match >= 0) return mapped.sourceOffsets[match] ?? 0;
  }
  return 0;
}

function boundedExcerpt(
  verified: VerifiedResourceSnapshot,
  query: string,
  lexical?: ResearchLexicalSearchHit,
): Pick<ResourceQueryHitV1, "selector" | "excerpt" | "excerptDigest"> {
  const bytes = verified.normalizedBlob;
  let sourceStart = lexical?.byteStart ?? 0;
  const sourceEnd = lexical?.byteEnd ?? bytes.byteLength;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(sourceStart, sourceEnd));
  const matchAt = lexical ? queryMatchOffset(source, query) : 0;
  const codePoints = Array.from(source);
  const matchCodePoint = Array.from(source.slice(0, Math.max(0, matchAt))).length;
  const characterStart = Math.max(0, matchCodePoint - Math.floor(EXCERPT_CHARACTERS / 3));
  const prefix = codePoints.slice(0, characterStart).join("");
  const excerpt = codePoints.slice(characterStart, characterStart + EXCERPT_CHARACTERS).join("");
  const prefixBytes = Buffer.byteLength(prefix, "utf8");
  sourceStart += prefixBytes;
  const excerptEnd = sourceStart + Buffer.byteLength(excerpt, "utf8");
  return {
    selector: { type: "text-span", start: sourceStart, end: excerptEnd },
    excerpt,
    excerptDigest: sha256(excerpt),
  };
}

function rrf(rank: number | undefined): number {
  return rank === undefined ? 0 : 1 / (60 + rank);
}

export function createResearchResourceRetrieval(options: {
  root?: string;
  store?: ResearchResourceStore;
  lexicalIndex?: ResearchResourceLexicalIndex;
  openLexicalIndex?: () => Promise<ResearchResourceLexicalIndex>;
} = {}): ResearchResourceRetrieval {
  const store = options.store ?? createResearchResourceStore({ root: options.root });

  return {
    async query(input) {
      const parsed = parseResourceQueryV1(input);
      if (!parsed.ok) {
        throw new ResearchResourceRetrievalError("invalid-query", `${parsed.error.path}: ${parsed.error.message}`);
      }
      const query = parsed.value;
      if (query.filters?.contextPackId) {
        throw new ResearchResourceRetrievalError("unsupported-filter", "context-pack membership is not available");
      }

      let index = options.lexicalIndex;
      let owned = false;
      if (query.ranking !== "exact" && !index) {
        try {
          index = await (options.openLexicalIndex ?? (() => openResearchResourceLexicalIndex(
            options.root ? { file: path.join(options.root, "index", "research-resources.sqlite") } : {},
          )))();
          owned = true;
        } catch (error) {
          throw new ResearchResourceRetrievalError("unavailable", "local lexical search is unavailable", { cause: error });
        }
      }

      try {
        return await store.withOperationalTransaction(async (transaction) => {
          const eligible = transaction.listManifests()
            .filter((manifest) => manifest.ingest.state === "ready" && manifest.currentSnapshotId)
            .filter((manifest) => matchesFilters(manifest, query))
            .map((manifest) => eligibleManifest(transaction, manifest))
            .filter((entry): entry is EligibleManifest => entry !== null)
            .sort((left, right) => compareOrdinal(left.manifest.id, right.manifest.id));
          const byId = new Map(eligible.map((entry) => [entry.manifest.id, entry]));
          const candidates = new Map<string, Candidate>();
          const normalized = query.text.normalize("NFKC").toLowerCase();

          if (query.ranking !== "lexical") {
            let exactRank = 0;
            for (const { manifest } of eligible) {
              if (!exactText(manifest).includes(normalized)) continue;
              exactRank += 1;
              candidates.set(manifest.id, {
                manifest,
                exactRank,
                score: rrf(exactRank),
              });
            }
          }

          if (query.ranking !== "exact") {
            const lexicalHits = index!.search(
              query.text,
              LEXICAL_CANDIDATE_LIMIT,
              eligible.map(({ manifest }) => manifest.id),
            );
            let lexicalRank = 0;
            for (const hit of lexicalHits) {
              const eligibleEntry = byId.get(hit.resourceId);
              const manifest = eligibleEntry?.manifest;
              if (!manifest || manifest.revision !== hit.resourceRevision ||
                  manifest.currentSnapshotId !== hit.snapshotId) continue;
              const fence = transaction.readDeletionFence(hit.resourceId)?.deletionRevision ?? 0;
              if (fence !== hit.deletionRevision) continue;
              lexicalRank += 1;
              const current = candidates.get(hit.resourceId);
              if (current?.lexicalRank !== undefined) continue;
              candidates.set(hit.resourceId, {
                manifest,
                lexical: hit,
                exactRank: current?.exactRank,
                lexicalRank,
                score: rrf(current?.exactRank) + rrf(lexicalRank),
              });
            }
          }

          const ordered = [...candidates.values()].sort((left, right) =>
            right.score - left.score || compareOrdinal(left.manifest.id, right.manifest.id));
          const hits: ResourceQueryHitV1[] = [];
          for (const candidate of ordered) {
            if (hits.length >= query.limit) break;
            const snapshotId = candidate.manifest.currentSnapshotId!;
            const verified = await transaction.readSnapshot(snapshotId);
            if (verified.snapshot.resourceId !== candidate.manifest.id ||
                verified.snapshot.resourceRevision !== candidate.manifest.revision ||
                candidate.lexical?.snapshotDigest !== undefined &&
                  candidate.lexical.snapshotDigest !== verified.snapshot.normalizedBlobDigest) continue;
            const excerpt = boundedExcerpt(verified, query.text, candidate.lexical);
            hits.push({
              resourceId: candidate.manifest.id,
              snapshotId,
              resourceRevision: candidate.manifest.revision,
              normalizedBlobDigest: verified.snapshot.normalizedBlobDigest,
              ...excerpt,
              retrieval: {
                exact: candidate.exactRank !== undefined,
                lexical: candidate.lexicalRank === undefined
                  ? { matched: false }
                  : { matched: true, rank: candidate.lexicalRank },
                semantic: {
                  state: query.ranking === "hybrid" ? "unavailable" : "disabled",
                  matched: false,
                },
              },
            });
          }
          return { version: 1, ranking: query.ranking, hits };
        });
      } catch (error) {
        if (error instanceof ResearchResourceRetrievalError) throw error;
        throw new ResearchResourceRetrievalError("unavailable", "local resource search is unavailable", { cause: error });
      } finally {
        if (owned) index?.close();
      }
    },
  };
}
