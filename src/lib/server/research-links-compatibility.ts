import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  savedLinkDedupeKey,
  type SavedLink,
} from "../link-organizer.ts";
import {
  parseResearchLinksMigrationJournalV1,
  parseResearchLinksProjectionV1,
  type ResourceManifestV1,
} from "../research-resource-contracts.ts";
import { resourceManifestToSavedLinkSummary } from "../research-resource-read-model.ts";
import { canonicalJson } from "../research-protocol/digest.ts";
import { caveHome } from "../coven-paths.ts";
import {
  createResearchResourceStore,
  type ManifestCatalogCompatibilityOperation,
  type ManifestCatalogTransaction,
} from "./research-resource-store.ts";
import {
  MAX_RESEARCH_LINKS_FILE_BYTES,
  MAX_SAVED_LINKS,
  parseResearchLinksBytes,
  readResearchLinksStrictWithDigest,
  researchLinksDigest,
  serializeResearchLinks,
  validateAndDetachSavedLink,
  writeResearchLinksVerified,
} from "./research-links-legacy-store.ts";

const MIGRATION_DIRECTORY = "migration";
const PROJECTION_FILE = "research-links-projection.json";
const JOURNAL_FILE = "research-links-journal.json";
const MAX_METADATA_BYTES = MAX_RESEARCH_LINKS_FILE_BYTES + 4 * 1024 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

type ProjectedRowFingerprint = {
  id: string;
  canonicalIdentity: string;
  digest: string;
};

type ProjectionMetadata = {
  version: 1;
  catalogRevision: number;
  projectedDigest: string;
  generatedAt: string;
  rows: ProjectedRowFingerprint[];
};

type MigrationJournal = {
  version: 1;
  catalogRevision: number;
  intendedProjectionDigest: string;
  startedAt: string;
  phase: "prepared" | "committed";
  mutationTimestamp: string;
  desiredLinks: SavedLink[];
};

export type ResearchLinksCompatibilityOptions = {
  legacyPath?: string;
  resourceRoot?: string;
  now?: () => Date;
  /** Test-only durable-boundary fault injection; production callers omit it. */
  testFailpoint?: (point: ResearchLinksCompatibilityFailpoint) => void | Promise<void>;
};

export type ResearchLinksCompatibilityFailpoint =
  | { kind: "prepared-published" }
  | { kind: "manifest-mutated"; index: number; operation: ManifestCatalogCompatibilityOperation["kind"] }
  | { kind: "committed-published" }
  | { kind: "before-legacy-projection" }
  | { kind: "legacy-projection-verified" }
  | { kind: "metadata-published" }
  | { kind: "journal-removed" };

export type ResearchLinksMutationResult<T> = {
  links: SavedLink[];
  result: T;
};

export class ResearchLinksCompatibilityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchLinksCompatibilityError";
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function resourceRoot(options: ResearchLinksCompatibilityOptions): string {
  if (options.resourceRoot) return path.resolve(options.resourceRoot);
  const override = process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE?.trim();
  if (override) return path.resolve(override);
  const legacyOverride = options.legacyPath ?? process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE?.trim();
  if (legacyOverride) return path.join(path.dirname(path.resolve(legacyOverride)), "research-resources");
  return path.join(/* turbopackIgnore: true */ caveHome(), "research-resources");
}

function legacyPath(options: ResearchLinksCompatibilityOptions): string | undefined {
  return options.legacyPath ?? (process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE?.trim() || undefined);
}

function migrationPaths(root: string) {
  const directory = path.join(root, MIGRATION_DIRECTORY);
  return {
    directory,
    projection: path.join(directory, PROJECTION_FILE),
    journal: path.join(directory, JOURNAL_FILE),
  };
}

async function ensureMigrationDirectory(root: string): Promise<ReturnType<typeof migrationPaths>> {
  const paths = migrationPaths(root);
  await mkdir(paths.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(paths.directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ResearchLinksCompatibilityError("saved-link migration directory is unsafe");
  }
  if (process.platform !== "win32" && (info.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    throw new ResearchLinksCompatibilityError("saved-link migration directory permissions are unsafe");
  }
  return paths;
}

async function readJsonOptional(target: string): Promise<unknown | null> {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new ResearchLinksCompatibilityError("saved-link migration record is unsafe");
  }
  if (info.size > MAX_METADATA_BYTES) {
    throw new ResearchLinksCompatibilityError("saved-link migration record is too large");
  }
  if (process.platform !== "win32" && (info.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new ResearchLinksCompatibilityError("saved-link migration record permissions are unsafe");
  }
  let handle: FileHandle | null = null;
  try {
    const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
      ? 0
      : constants.O_NOFOLLOW;
    handle = await open(target, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new ResearchLinksCompatibilityError("saved-link migration record identity changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new ResearchLinksCompatibilityError("saved-link migration record changed while reading");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof ResearchLinksCompatibilityError) throw error;
    throw new ResearchLinksCompatibilityError("saved-link migration record is invalid", {
      cause: error,
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!new Set(["EINVAL", "EISDIR", "ENOTSUP"]).has(code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writePrivateJson(target: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  if (bytes.byteLength > MAX_METADATA_BYTES) {
    throw new ResearchLinksCompatibilityError("saved-link migration record is too large");
  }
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  let handle: FileHandle | null = null;
  try {
    const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
      ? 0
      : constants.O_NOFOLLOW;
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      PRIVATE_FILE_MODE,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new ResearchLinksCompatibilityError("saved-link migration record publication is unsafe");
  }
  if (process.platform !== "win32" && (info.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new ResearchLinksCompatibilityError("saved-link migration record permissions are unsafe");
  }
}

async function removePrivateRecord(target: string): Promise<void> {
  await rm(target, { force: true });
  await syncDirectory(path.dirname(target));
}

function fingerprint(link: SavedLink): ProjectedRowFingerprint {
  return {
    id: link.id,
    canonicalIdentity: savedLinkDedupeKey(link.url),
    digest: sha256(canonicalJson(link)),
  };
}

function fingerprints(links: readonly SavedLink[]): ProjectedRowFingerprint[] {
  return links.map(fingerprint).sort((left, right) => left.id.localeCompare(right.id));
}

function sortLinks(links: readonly SavedLink[]): SavedLink[] {
  return [...links].sort(
    (left, right) => right.addedAt.localeCompare(left.addedAt) || left.id.localeCompare(right.id),
  );
}

function parseRows(value: unknown): ProjectedRowFingerprint[] {
  if (!Array.isArray(value) || value.length > MAX_SAVED_LINKS) {
    throw new ResearchLinksCompatibilityError("saved-link projection fingerprints are invalid");
  }
  const ids = new Set<string>();
  const identities = new Set<string>();
  const rows = value.map((candidate) => {
    if (
      typeof candidate !== "object" || candidate === null || Array.isArray(candidate)
      || Object.keys(candidate).sort().join(",") !== "canonicalIdentity,digest,id"
    ) {
      throw new ResearchLinksCompatibilityError("saved-link projection fingerprint is invalid");
    }
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string" || row.id.length < 1 || row.id.length > 128
      || typeof row.canonicalIdentity !== "string" || row.canonicalIdentity.length < 1
      || row.canonicalIdentity.length > 8_192
      || typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)
      || ids.has(row.id) || identities.has(row.canonicalIdentity)
    ) {
      throw new ResearchLinksCompatibilityError("saved-link projection fingerprint is invalid");
    }
    ids.add(row.id);
    identities.add(row.canonicalIdentity);
    return {
      id: row.id,
      canonicalIdentity: row.canonicalIdentity,
      digest: row.digest,
    };
  });
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function parseProjection(value: unknown): ProjectionMetadata {
  const parsed = parseResearchLinksProjectionV1(value);
  if (!parsed.ok || typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResearchLinksCompatibilityError("saved-link projection metadata is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",") !== "catalogRevision,generatedAt,projectedDigest,rows,version") {
    throw new ResearchLinksCompatibilityError("saved-link projection metadata is invalid");
  }
  return { ...parsed.value, rows: parseRows(raw.rows) };
}

function parseJournal(value: unknown): MigrationJournal {
  const parsed = parseResearchLinksMigrationJournalV1(value);
  if (!parsed.ok || typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResearchLinksCompatibilityError("saved-link migration journal is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).sort().join(",") !==
      "catalogRevision,desiredLinks,intendedProjectionDigest,mutationTimestamp,phase,startedAt,version"
    || (raw.phase !== "prepared" && raw.phase !== "committed")
    || typeof raw.mutationTimestamp !== "string" || !canonicalTimestamp(raw.mutationTimestamp)
  ) {
    throw new ResearchLinksCompatibilityError("saved-link migration journal is invalid");
  }
  const desired = parseResearchLinksBytes(
    Buffer.from(JSON.stringify({ version: 1, links: raw.desiredLinks }), "utf8"),
  );
  const intended = researchLinksDigest(serializeResearchLinks(desired));
  if (intended !== parsed.value.intendedProjectionDigest) {
    throw new ResearchLinksCompatibilityError("saved-link migration journal digest is invalid");
  }
  return {
    ...parsed.value,
    phase: raw.phase,
    mutationTimestamp: raw.mutationTimestamp,
    desiredLinks: desired.links,
  };
}

function sameRows(left: readonly ProjectedRowFingerprint[], right: readonly ProjectedRowFingerprint[]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function xArticleFromManifest(manifest: ResourceManifestV1): SavedLink["xArticle"] {
  const legacy = manifest.legacySavedLink as Record<string, unknown> | undefined;
  if (!legacy || legacy.caveXArticleV1 === undefined) return undefined;
  const summary = resourceManifestToSavedLinkSummary(manifest);
  if (!summary) return undefined;
  return validateAndDetachSavedLink({ ...summary, xArticle: legacy.caveXArticleV1 }).xArticle;
}

function manifestToLink(manifest: ResourceManifestV1): SavedLink | null {
  const summary = resourceManifestToSavedLinkSummary(manifest);
  if (!summary) return null;
  const xArticle = xArticleFromManifest(manifest);
  return validateAndDetachSavedLink({
    ...summary,
    ...(xArticle ? { xArticle } : {}),
  });
}

function catalogLinks(manifests: readonly ResourceManifestV1[]): SavedLink[] {
  const links = manifests
    .map(manifestToLink)
    .filter((link): link is SavedLink => link !== null)
    .sort((left, right) => right.addedAt.localeCompare(left.addedAt) || left.id.localeCompare(right.id));
  return sortLinks(parseResearchLinksBytes(serializeResearchLinks({ version: 1, links })).links);
}

function resourceId(legacyId: string): string {
  return `saved-link-${sha256(legacyId).slice(0, 32)}`;
}

function laterTimestamp(existing: string, mutationTimestamp: string): string {
  return new Date(Math.max(Date.parse(mutationTimestamp), Date.parse(existing) + 1)).toISOString();
}

function manifestForLink(
  link: SavedLink,
  existing: ResourceManifestV1 | undefined,
  mutationTimestamp: string,
): ResourceManifestV1 {
  const immutableChanged = existing !== undefined && canonicalJson(existing.legacySavedLink) !== canonicalJson({
    id: link.id,
    url: link.url,
    addedAt: link.addedAt,
    source: link.source,
    ...(link.xArticle ? { caveXArticleV1: link.xArticle } : {}),
  });
  const revision = existing ? existing.revision + 1 : 1;
  const createdAt = immutableChanged ? link.addedAt : existing?.createdAt ?? link.addedAt;
  const updatedAt = existing ? laterTimestamp(existing.updatedAt, mutationTimestamp) : link.addedAt;
  const retained = existing ? structuredClone(existing) as Record<string, unknown> : {};
  delete retained.publishedAt;
  delete retained.paper;
  return {
    ...retained,
    version: 1,
    id: resourceId(link.id),
    revision,
    kind: link.paper ? "paper" : "saved-resource",
    canonicalIdentity: savedLinkDedupeKey(link.url),
    title: link.title,
    sourceUri: link.url,
    sourceType: "saved-link",
    category: link.category,
    ...(link.paper ? { publishedAt: link.paper.publishedAt } : {}),
    legacySavedLink: {
      id: link.id,
      url: link.url,
      addedAt: link.addedAt,
      source: link.source,
      ...(link.xArticle ? { caveXArticleV1: link.xArticle } : {}),
    },
    ...(link.paper
      ? {
          paper: {
            arxivId: link.paper.arxivId,
            authors: [...link.paper.authors],
            abstract: link.paper.abstract,
            publishedAt: link.paper.publishedAt,
          },
        }
      : {}),
    subject: existing?.subject ?? {},
    sensitivity: existing?.sensitivity ?? "public",
    ingest: existing?.ingest ?? { desired: false, state: "metadata_only" },
    createdAt,
    updatedAt,
  };
}

function compatibleContent(manifest: ResourceManifestV1, link: SavedLink): boolean {
  const projected = manifestToLink(manifest);
  return projected !== null && canonicalJson(projected) === canonicalJson(link);
}

function operationsForDesired(
  manifests: readonly ResourceManifestV1[],
  desiredLinks: readonly SavedLink[],
  mutationTimestamp: string,
): ManifestCatalogCompatibilityOperation[] {
  const compatible = manifests.filter((manifest) => manifest.legacySavedLink);
  const byLegacyId = new Map(compatible.map((manifest) => [manifest.legacySavedLink!.id, manifest]));
  const desiredIds = new Set(desiredLinks.map((link) => link.id));
  const operations: ManifestCatalogCompatibilityOperation[] = [];

  for (const existing of compatible) {
    if (existing.id !== resourceId(existing.legacySavedLink!.id)) {
      throw new ResearchLinksCompatibilityError(
        `saved-link ${existing.legacySavedLink!.id} is owned by a non-deterministic resource manifest`,
      );
    }
    if (!desiredIds.has(existing.legacySavedLink!.id)) {
      operations.push({ kind: "delete", expectedManifest: existing });
    }
  }

  for (const link of desiredLinks) {
    const existing = byLegacyId.get(link.id);
    if (!existing) {
      operations.push({ kind: "create", manifest: manifestForLink(link, undefined, mutationTimestamp) });
      continue;
    }
    if (existing.id !== resourceId(link.id)) {
      throw new ResearchLinksCompatibilityError(
        `saved-link ${link.id} is owned by a non-deterministic resource manifest`,
      );
    }
    if (compatibleContent(existing, link)) continue;
    if (!isCompatibilityMutable(existing)) {
      throw new ResearchLinksCompatibilityError(
        `saved-link ${link.id} changed after its resource entered ingestion`,
      );
    }
    const next = manifestForLink(link, existing, mutationTimestamp);
    const immutableChanged = canonicalJson(existing.legacySavedLink) !== canonicalJson(next.legacySavedLink)
      || existing.canonicalIdentity !== next.canonicalIdentity
      || existing.createdAt !== next.createdAt;
    operations.push(immutableChanged
      ? { kind: "replace", expectedManifest: existing, manifest: next }
      : { kind: "update", id: existing.id, expectedRevision: existing.revision, manifest: next });
  }
  return operations;
}

function isCompatibilityMutable(manifest: ResourceManifestV1 | undefined): boolean {
  return Boolean(
    manifest?.legacySavedLink
    && !manifest.currentSnapshotId
    && !manifest.ingest.desired
    && manifest.ingest.state === "metadata_only",
  );
}

async function applyOperations(
  transaction: ManifestCatalogTransaction,
  operations: readonly ManifestCatalogCompatibilityOperation[],
  options: ResearchLinksCompatibilityOptions,
): Promise<void> {
  for (const [index, operation] of operations.entries()) {
    switch (operation.kind) {
      case "create":
        await transaction.createManifest(operation.manifest);
        break;
      case "update":
        await transaction.updateManifest(operation);
        break;
      case "replace":
        await transaction.replaceCompatibilityManifest(operation);
        break;
      case "delete":
        await transaction.deleteCompatibilityManifest(operation.expectedManifest);
        break;
    }
    await options.testFailpoint?.({ kind: "manifest-mutated", index, operation: operation.kind });
  }
}

function mergeDiverged(
  baseRows: readonly ProjectedRowFingerprint[],
  legacyLinks: readonly SavedLink[],
  currentCatalogLinks: readonly SavedLink[],
  currentManifests: readonly ResourceManifestV1[],
): SavedLink[] {
  const base = new Map(baseRows.map((row) => [row.id, row]));
  const legacy = new Map(legacyLinks.map((link) => [link.id, link]));
  const catalog = new Map(currentCatalogLinks.map((link) => [link.id, link]));
  const catalogManifests = new Map(
    currentManifests
      .filter((manifest) => manifest.legacySavedLink)
      .map((manifest) => [manifest.legacySavedLink!.id, manifest]),
  );
  const ids = new Set([...base.keys(), ...legacy.keys(), ...catalog.keys()]);
  const merged: SavedLink[] = [];

  for (const id of [...ids].sort()) {
    const baseRow = base.get(id);
    const legacyLink = legacy.get(id);
    const catalogLink = catalog.get(id);
    if (!baseRow) {
      if (legacyLink && catalogLink && fingerprint(legacyLink).digest !== fingerprint(catalogLink).digest) {
        throw new ResearchLinksCompatibilityError("concurrent saved-link additions conflict");
      }
      const selected = legacyLink ?? catalogLink;
      if (selected) merged.push(selected);
      continue;
    }
    const legacyChanged = legacyLink ? fingerprint(legacyLink).digest !== baseRow.digest : true;
    const catalogChanged = catalogLink ? fingerprint(catalogLink).digest !== baseRow.digest : true;
    if (legacyChanged && !catalogChanged) {
      if (legacyLink) merged.push(legacyLink);
    } else if (catalogChanged && !legacyChanged) {
      if (catalogLink) merged.push(catalogLink);
    } else if (!legacyChanged && !catalogChanged) {
      if (catalogLink ?? legacyLink) merged.push((catalogLink ?? legacyLink)!);
    } else if (!catalogLink) {
      // A catalog-side deletion is authoritative. Recreating the row here
      // would resurrect data that a newer client deliberately removed.
      continue;
    } else if (!legacyLink) {
      // A downgrade deletion may remove only the same metadata-only resources
      // that the compatibility layer itself is allowed to mutate.
      if (!isCompatibilityMutable(catalogManifests.get(id)!)) merged.push(catalogLink);
    } else if (fingerprint(legacyLink).digest === fingerprint(catalogLink).digest) {
      merged.push(legacyLink);
    } else if (isCompatibilityMutable(catalogManifests.get(id)!)) {
      merged.push(legacyLink);
    } else {
      throw new ResearchLinksCompatibilityError(
        `saved-link ${id} changed concurrently after its resource entered ingestion`,
      );
    }
  }
  return parseResearchLinksBytes(
    Buffer.from(JSON.stringify({ version: 1, links: merged }), "utf8"),
  ).links.sort((left, right) => right.addedAt.localeCompare(left.addedAt) || left.id.localeCompare(right.id));
}

async function finalizeDesired(
  transaction: ManifestCatalogTransaction,
  paths: ReturnType<typeof migrationPaths>,
  options: ResearchLinksCompatibilityOptions,
  desiredLinks: SavedLink[],
  catalogRevision: number,
  mutationTimestamp: string,
  startedAt: string,
): Promise<SavedLink[]> {
  const desired = parseResearchLinksBytes(
    Buffer.from(JSON.stringify({ version: 1, links: desiredLinks }), "utf8"),
  );
  desired.links = sortLinks(desired.links);
  const projectionBytes = serializeResearchLinks(desired);
  const intendedProjectionDigest = researchLinksDigest(projectionBytes);
  const operations = operationsForDesired(transaction.listManifests(), desired.links, mutationTimestamp);
  await transaction.preflightCompatibilityMutation(operations);

  const journalBase = {
    version: 1 as const,
    catalogRevision,
    intendedProjectionDigest,
    startedAt,
    mutationTimestamp,
    desiredLinks: desired.links,
  };
  await writePrivateJson(paths.journal, { ...journalBase, phase: "prepared" });
  await options.testFailpoint?.({ kind: "prepared-published" });
  await applyOperations(transaction, operations, options);

  const projected = catalogLinks(transaction.listManifests());
  if (canonicalJson(projected) !== canonicalJson(desired.links)) {
    throw new ResearchLinksCompatibilityError("saved-link catalog mutation did not converge");
  }
  await writePrivateJson(paths.journal, { ...journalBase, phase: "committed" });
  await options.testFailpoint?.({ kind: "committed-published" });
  await options.testFailpoint?.({ kind: "before-legacy-projection" });
  const written = await writeResearchLinksVerified(
    { version: 1, links: projected },
    { path: legacyPath(options) },
  );
  if (written.digest !== intendedProjectionDigest) {
    throw new ResearchLinksCompatibilityError("saved-link projection verification failed");
  }
  await options.testFailpoint?.({ kind: "legacy-projection-verified" });
  const metadata: ProjectionMetadata = {
    version: 1,
    catalogRevision,
    projectedDigest: written.digest,
    generatedAt: mutationTimestamp,
    rows: fingerprints(projected),
  };
  await writePrivateJson(paths.projection, metadata);
  await options.testFailpoint?.({ kind: "metadata-published" });
  await removePrivateRecord(paths.journal);
  await options.testFailpoint?.({ kind: "journal-removed" });
  return projected;
}

async function runCompatibility<T>(
  options: ResearchLinksCompatibilityOptions,
  mutate?: (links: SavedLink[]) => Promise<ResearchLinksMutationResult<T>> | ResearchLinksMutationResult<T>,
): Promise<{ links: SavedLink[]; result?: T }> {
  const root = resourceRoot(options);
  const store = createResearchResourceStore({ root });
  return store.withManifestCatalogTransaction(async (transaction) => {
    const paths = await ensureMigrationDirectory(root);
    const rawProjection = await readJsonOptional(paths.projection);
    const metadata = rawProjection === null ? null : parseProjection(rawProjection);
    const rawJournal = await readJsonOptional(paths.journal);
    const journal = rawJournal === null ? null : parseJournal(rawJournal);
    if (
      journal && metadata
      && (
        journal.catalogRevision < metadata.catalogRevision
        || (
          journal.catalogRevision === metadata.catalogRevision
          && !sameRows(fingerprints(journal.desiredLinks), metadata.rows)
        )
      )
    ) {
      throw new ResearchLinksCompatibilityError("saved-link migration journal revision is stale");
    }
    const legacyRead = await readResearchLinksStrictWithDigest({ path: legacyPath(options) });
    const legacy = legacyRead.file;
    const currentCatalog = catalogLinks(transaction.listManifests());

    let desired: SavedLink[];
    let mutationTimestamp: string;
    let catalogRevision: number;
    let startedAt: string;
    let baselineRows = metadata?.rows ?? null;
    if (journal) {
      desired = journal.desiredLinks;
      mutationTimestamp = journal.mutationTimestamp;
      catalogRevision = journal.catalogRevision;
      startedAt = journal.startedAt;
    } else if (!metadata) {
      desired = legacy.links;
      mutationTimestamp = (options.now ?? (() => new Date()))().toISOString();
      catalogRevision = 0;
      startedAt = mutationTimestamp;
    } else {
      const legacyDigest = legacyRead.rawDigest;
      const currentRows = fingerprints(currentCatalog);
      if (legacyDigest === metadata.projectedDigest && sameRows(currentRows, metadata.rows)) {
        desired = currentCatalog;
      } else if (legacyDigest === metadata.projectedDigest) {
        desired = currentCatalog;
      } else if (sameRows(currentRows, metadata.rows)) {
        desired = legacy.links;
      } else {
        desired = mergeDiverged(
          metadata.rows,
          legacy.links,
          currentCatalog,
          transaction.listManifests(),
        );
      }
      mutationTimestamp = (options.now ?? (() => new Date()))().toISOString();
      catalogRevision = metadata.catalogRevision;
      startedAt = mutationTimestamp;
    }

    let recoveredJournal = false;
    if (journal) {
      desired = await finalizeDesired(
        transaction,
        paths,
        options,
        desired,
        catalogRevision,
        mutationTimestamp,
        startedAt,
      );
      baselineRows = fingerprints(desired);
      recoveredJournal = true;
      if (!mutate) return { links: desired };
      mutationTimestamp = (options.now ?? (() => new Date()))().toISOString();
      startedAt = mutationTimestamp;
    }

    let result: T | undefined;
    if (mutate) {
      const changed = await mutate(structuredClone(desired));
      desired = sortLinks(parseResearchLinksBytes(
        Buffer.from(JSON.stringify({ version: 1, links: changed.links }), "utf8"),
      ).links);
      result = changed.result;
    }

    const operations = operationsForDesired(transaction.listManifests(), desired, mutationTimestamp);
    const desiredDigest = researchLinksDigest(serializeResearchLinks({ version: 1, links: desired }));
    const desiredRows = fingerprints(desired);
    const stable = !recoveredJournal && metadata !== null && operations.length === 0
      && metadata.projectedDigest === desiredDigest
      && legacyRead.rawDigest === desiredDigest
      && sameRows(metadata.rows, desiredRows);
    if (stable) return { links: desired, ...(result === undefined ? {} : { result }) };
    if (recoveredJournal && operations.length === 0) {
      return { links: desired, ...(result === undefined ? {} : { result }) };
    }

    const epochChanged = baselineRows === null
      ? operations.length > 0
      : !sameRows(baselineRows, desiredRows);
    if (epochChanged) {
      if (catalogRevision >= Number.MAX_SAFE_INTEGER) {
        throw new ResearchLinksCompatibilityError("saved-link catalog revision is exhausted");
      }
      catalogRevision += 1;
    }
    const links = await finalizeDesired(
      transaction,
      paths,
      options,
      desired,
      catalogRevision,
      mutationTimestamp,
      startedAt,
    );
    return { links, ...(result === undefined ? {} : { result }) };
  });
}

export async function listCompatibleResearchLinks(
  options: ResearchLinksCompatibilityOptions = {},
): Promise<SavedLink[]> {
  return (await runCompatibility(options)).links;
}

export async function mutateCompatibleResearchLinks<T>(
  mutate: (links: SavedLink[]) => Promise<ResearchLinksMutationResult<T>> | ResearchLinksMutationResult<T>,
  options: ResearchLinksCompatibilityOptions = {},
): Promise<T> {
  const completed = await runCompatibility(options, mutate);
  return completed.result as T;
}
