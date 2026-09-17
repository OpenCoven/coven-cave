import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { rename as renameFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import { RESEARCH_VECTOR_ENCODING_VERSION } from "./research-resource-embedding-provider.ts";
import type { ResearchLexicalAuthority, ResearchLexicalChunk } from "./research-resource-lexical-index.ts";
import { RESEARCH_LEXICAL_CHUNKER_VERSION } from "./research-resource-lexical-index.ts";

export const RESEARCH_SEMANTIC_SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const WINDOWS_DEVICE_IDS = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_TABLES = new Set(["provider_state", "embedding_state", "chunk_embeddings"]);
const REBUILD_MARKER_TOKEN = /^[0-9]+-[a-f0-9]{24}$/;
type CanonicalHandleController = { closeForRebuild(): void };
const canonicalHandleControllers = new Map<string, Set<CanonicalHandleController>>();

export type ResearchSemanticAuthority = ResearchLexicalAuthority & {
  providerId: string;
  modelId: string;
  dimensions: number;
  modelRevision: string;
};

export type ResearchSemanticVector = Pick<
  ResearchLexicalChunk,
  "id" | "ordinal" | "byteStart" | "byteEnd"
> & { vector: readonly number[] };

export type ResearchSemanticProbeHit = Omit<ResearchSemanticVector, "vector"> & {
  rank: number;
  score: number;
};

export type ResearchSemanticProbe = {
  usable: boolean;
  vectorCount: number;
  hits: ResearchSemanticProbeHit[];
};

export type ResearchResourceSemanticIndex = {
  readonly file: string;
  replace(authority: ResearchSemanticAuthority, vectors: readonly ResearchSemanticVector[]): void;
  remove(resourceId: string): boolean;
  publication(resourceId: string): ResearchSemanticAuthority | null;
  verify(authority: ResearchSemanticAuthority, chunks: readonly Pick<ResearchSemanticVector,
    "id" | "ordinal" | "byteStart" | "byteEnd">[]): boolean;
  probe(authority: ResearchSemanticAuthority, queryVector: readonly number[], limit?: number): ResearchSemanticProbe;
  purgeResidualFiles(safetyCheck?: () => void): void;
  close(): void;
};

export class ResearchResourceSemanticIndexError extends Error {
  readonly code: "corrupt" | "invalid-input" | "unsafe-path" | "stale" | "unavailable";

  constructor(code: ResearchResourceSemanticIndexError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchResourceSemanticIndexError";
    this.code = code;
  }
}

type Statement = {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
};

type Database = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

const PROVIDER_STATE_SCHEMA = `CREATE TABLE provider_state (
  model_revision TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_encoding_version TEXT NOT NULL,
  chunker_version TEXT NOT NULL
)`;
const EMBEDDING_STATE_SCHEMA = `CREATE TABLE embedding_state (
  resource_id TEXT PRIMARY KEY,
  resource_revision INTEGER NOT NULL,
  deletion_revision INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL,
  model_revision TEXT NOT NULL REFERENCES provider_state(model_revision)
)`;
const CHUNK_EMBEDDINGS_SCHEMA = `CREATE TABLE chunk_embeddings (
  resource_id TEXT NOT NULL REFERENCES embedding_state(resource_id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  byte_start INTEGER NOT NULL,
  byte_end INTEGER NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY(resource_id, ordinal),
  UNIQUE(resource_id, chunk_id)
)`;
const SCHEMA = `
${PROVIDER_STATE_SCHEMA};
${EMBEDDING_STATE_SCHEMA};
${CHUNK_EMBEDDINGS_SCHEMA};
PRAGMA user_version = ${RESEARCH_SEMANTIC_SCHEMA_VERSION};
`;

const EXPECTED_SCHEMA_OBJECTS = new Map([
  ["provider_state", PROVIDER_STATE_SCHEMA],
  ["embedding_state", EMBEDDING_STATE_SCHEMA],
  ["chunk_embeddings", CHUNK_EMBEDDINGS_SCHEMA],
]);

function failInput(message: string): never {
  throw new ResearchResourceSemanticIndexError("invalid-input", message);
}

function assertId(value: string, label: string): void {
  if (!SAFE_ID.test(value) || WINDOWS_DEVICE_IDS.test(value)) failInput(`${label} is invalid`);
}

function assertModelId(value: string): void {
  if (!SAFE_MODEL_ID.test(value)) failInput("model id is invalid");
}

function assertAuthority(value: ResearchSemanticAuthority): void {
  assertId(value.resourceId, "resource id");
  assertId(value.snapshotId, "snapshot id");
  assertId(value.providerId, "provider id");
  assertModelId(value.modelId);
  if (!Number.isSafeInteger(value.resourceRevision) || value.resourceRevision < 1) failInput("resource revision is invalid");
  if (!Number.isSafeInteger(value.deletionRevision) || value.deletionRevision < 0) failInput("deletion revision is invalid");
  if (!Number.isSafeInteger(value.dimensions) || value.dimensions < 1 || value.dimensions > 65_536) {
    failInput("dimensions are invalid");
  }
  if (!SHA256.test(value.snapshotDigest)) failInput("snapshot digest is invalid");
  if (!SHA256.test(value.modelRevision)) failInput("model revision is invalid");
}

function sameAuthority(left: ResearchSemanticAuthority, right: ResearchSemanticAuthority): boolean {
  return left.resourceId === right.resourceId
    && left.resourceRevision === right.resourceRevision
    && left.deletionRevision === right.deletionRevision
    && left.snapshotId === right.snapshotId
    && left.snapshotDigest === right.snapshotDigest
    && left.providerId === right.providerId
    && left.modelId === right.modelId
    && left.dimensions === right.dimensions
    && left.modelRevision === right.modelRevision;
}

function encodeVector(vector: readonly number[], dimensions: number): Buffer {
  if (vector.length !== dimensions) failInput("vector dimensions do not match");
  if (vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    failInput("vector contains a non-finite value");
  }
  if (!vector.some((value) => value !== 0)) failInput("zero vectors are not usable");
  const encoded = Buffer.alloc(dimensions * 4);
  vector.forEach((value, index) => encoded.writeFloatLE(value, index * 4));
  const roundTripped = Array.from({ length: dimensions }, (_, index) => encoded.readFloatLE(index * 4));
  if (roundTripped.some((value) => !Number.isFinite(value))
      || !roundTripped.some((value) => value !== 0)) {
    failInput("vector is not representable as a finite non-zero float32 vector");
  }
  return encoded;
}

function decodeVector(value: unknown, dimensions: number): number[] {
  if (!(value instanceof Uint8Array) || value.byteLength !== dimensions * 4) {
    throw new ResearchResourceSemanticIndexError("corrupt", "semantic vector encoding is invalid");
  }
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const vector = Array.from({ length: dimensions }, (_, index) => buffer.readFloatLE(index * 4));
  if (vector.some((item) => !Number.isFinite(item)) || !vector.some((item) => item !== 0)) {
    throw new ResearchResourceSemanticIndexError("corrupt", "semantic vector values are invalid");
  }
  return vector;
}

function assertVectors(vectors: readonly ResearchSemanticVector[], dimensions: number): void {
  const ids = new Set<string>();
  let previousEnd = 0;
  vectors.forEach((item, index) => {
    if (!SHA256.test(item.id) || ids.has(item.id)) failInput("chunk id is invalid or duplicated");
    ids.add(item.id);
    if (item.ordinal !== index) failInput("chunk ordinals must be consecutive");
    if (!Number.isSafeInteger(item.byteStart) || !Number.isSafeInteger(item.byteEnd)
        || item.byteStart < previousEnd || item.byteEnd <= item.byteStart) {
      failInput("chunk byte boundaries are invalid");
    }
    previousEnd = item.byteEnd;
    encodeVector(item.vector, dimensions);
  });
}

function semanticIndexPath(): string {
  return path.join(caveHome(), "research-resources", "index", "research-resources-semantic.sqlite");
}

export function researchResourceSemanticIndexPath(root?: string): string {
  return root
    ? path.join(root, "index", "research-resources-semantic.sqlite")
    : semanticIndexPath();
}

function assertOwner(metadata: { uid?: number }, label: string): void {
  if (process.platform === "win32" || typeof process.getuid !== "function") return;
  if (metadata.uid !== process.getuid()) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", `${label} is not owned by the current user`);
  }
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index directory is unsafe");
  }
  assertOwner(metadata, "semantic index directory");
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== DIRECTORY_MODE) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index directory must be private");
  }
}

type StableDirectoryIdentity = {
  path: string;
  realPath: string;
  dev: number | bigint;
  ino: number | bigint;
};

function inspectPrivateDirectory(directory: string, label: string): StableDirectoryIdentity | null {
  let metadata;
  try {
    metadata = lstatSync(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", `${label} is unsafe`);
  }
  assertOwner(metadata, label);
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== DIRECTORY_MODE) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", `${label} must be private`);
  }
  const descriptor = openSync(directory, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", `${label} identity changed`);
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    path: directory,
    realPath: realpathSync(directory),
    dev: metadata.dev,
    ino: metadata.ino,
  };
}

function assertStableDirectoryIdentity(identity: StableDirectoryIdentity, label: string): void {
  const current = inspectPrivateDirectory(identity.path, label);
  if (!current || current.dev !== identity.dev || current.ino !== identity.ino
      || current.realPath !== identity.realPath) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", `${label} identity changed`);
  }
}

function semanticDeletionLayout(
  file: string,
  rootInput?: string,
): { root: StableDirectoryIdentity; index: StableDirectoryIdentity } | null {
  const indexPath = path.dirname(file);
  const rootPath = rootInput === undefined ? indexPath : path.resolve(rootInput);
  const relativeIndex = path.relative(rootPath, indexPath);
  if (relativeIndex === ".." || relativeIndex.startsWith(`..${path.sep}`) || path.isAbsolute(relativeIndex)) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index escapes the Resource root");
  }
  const root = inspectPrivateDirectory(rootPath, "Research Resource root");
  if (!root) return null;
  const index = rootPath === indexPath
    ? root
    : inspectPrivateDirectory(indexPath, "semantic index directory");
  if (!index) return null;
  const expectedIndexRealPath = path.resolve(root.realPath, relativeIndex);
  if (index.realPath !== expectedIndexRealPath) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index directory escapes the Resource root");
  }
  return { root, index };
}

function assertStableDeletionLayout(
  layout: { root: StableDirectoryIdentity; index: StableDirectoryIdentity },
): void {
  assertStableDirectoryIdentity(layout.root, "Research Resource root");
  if (layout.index !== layout.root) {
    assertStableDirectoryIdentity(layout.index, "semantic index directory");
  }
  const relativeIndex = path.relative(layout.root.path, layout.index.path);
  if (realpathSync(layout.index.path) !== path.resolve(layout.root.realPath, relativeIndex)) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index directory escapes the Resource root");
  }
}

function ensurePrivateFile(file: string): boolean {
  if (!existsSync(file)) {
    closeSync(openSync(file, "wx", FILE_MODE));
    return true;
  }
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index file is unsafe");
  }
  assertOwner(metadata, "semantic index file");
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== FILE_MODE) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index file must be private");
  }
  return false;
}

function hardenSqliteFiles(file: string, safetyCheck: () => void = () => {}): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    safetyCheck();
    if (!existsSync(/* turbopackIgnore: true */ candidate)) continue;
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic SQLite sidecar is unsafe");
    }
    assertOwner(metadata, "semantic SQLite sidecar");
    if (process.platform !== "win32" && (metadata.mode & 0o777) !== FILE_MODE) {
      safetyCheck();
      chmodSync(candidate, FILE_MODE);
    }
  }
}

function rebuildMarkerPrefix(file: string): string {
  return `.${path.basename(file)}.rebuild-`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function hasActiveRebuildMarker(file: string): boolean {
  const directory = path.dirname(file);
  if (!existsSync(directory)) return false;
  const prefix = rebuildMarkerPrefix(file);
  let active = false;
  let removed = false;
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix)) continue;
    const token = name.slice(prefix.length);
    if (!REBUILD_MARKER_TOKEN.test(token)) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic rebuild marker is invalid");
    }
    const candidate = path.join(directory, name);
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic rebuild marker is unsafe");
    }
    assertOwner(metadata, "semantic rebuild marker");
    const pid = Number(token.split("-", 1)[0]);
    if (processIsAlive(pid)) active = true;
    else {
      rmSync(candidate);
      removed = true;
    }
  }
  if (removed) syncDirectory(directory);
  return active;
}

function beginRebuild(file: string): string {
  const marker = path.join(
    path.dirname(file),
    `${rebuildMarkerPrefix(file)}${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  closeSync(openSync(marker, "wx", FILE_MODE));
  syncDirectory(path.dirname(file));
  for (const controller of [...(canonicalHandleControllers.get(file) ?? [])]) {
    controller.closeForRebuild();
  }
  return marker;
}

function finishRebuild(marker: string): void {
  if (!existsSync(marker)) return;
  const metadata = lstatSync(marker);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic rebuild marker is unsafe");
  }
  assertOwner(metadata, "semantic rebuild marker");
  rmSync(marker);
  syncDirectory(path.dirname(marker));
}

function staleIndex(message = "Research semantic index was replaced"): ResearchResourceSemanticIndexError {
  return new ResearchResourceSemanticIndexError("stale", message);
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (Date.now() >= deadline || (code !== "EACCES" && code !== "EBUSY" && code !== "EPERM")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function purgeResidualFiles(
  file: string,
  safetyCheck: () => void = () => {},
  beforeDelete: (candidate: string) => void = () => {},
): void {
  const directory = path.dirname(file);
  const base = escapeRegExp(path.basename(file));
  const residual = new RegExp(`^(?:${base}\\.corrupt-[0-9]+-[a-f0-9]{8}|\\.research-semantic-[0-9]+-[a-f0-9]{24}\\.sqlite)(?:-wal|-shm)?$`);
  let removed = false;
  safetyCheck();
  for (const name of readdirSync(/* turbopackIgnore: true */ directory).sort()) {
    if (!residual.test(name)) continue;
    safetyCheck();
    const candidate = path.join(directory, name);
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic residual file is unsafe");
    }
    assertOwner(metadata, "semantic residual file");
    beforeDelete(candidate);
    safetyCheck();
    rmSync(candidate);
    removed = true;
  }
  if (removed) {
    safetyCheck();
    syncDirectory(directory);
  }
}

function purgeOrphanedCanonicalSidecars(
  file: string,
  safetyCheck: () => void = () => {},
  beforeDelete: (candidate: string) => void = () => {},
): void {
  let removed = false;
  for (const candidate of [`${file}-wal`, `${file}-shm`]) {
    safetyCheck();
    if (!existsSync(/* turbopackIgnore: true */ candidate)) continue;
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceSemanticIndexError("unsafe-path", "orphaned semantic SQLite sidecar is unsafe");
    }
    assertOwner(metadata, "orphaned semantic SQLite sidecar");
    beforeDelete(candidate);
    safetyCheck();
    rmSync(candidate);
    removed = true;
  }
  if (removed) {
    safetyCheck();
    syncDirectory(path.dirname(file));
  }
}

function publicationFromRow(row: Record<string, unknown> | undefined): ResearchSemanticAuthority | null {
  if (!row) return null;
  if (String(row.vector_encoding_version) !== RESEARCH_VECTOR_ENCODING_VERSION
      || String(row.chunker_version) !== RESEARCH_LEXICAL_CHUNKER_VERSION) {
    throw new ResearchResourceSemanticIndexError(
      "corrupt",
      "semantic provider compatibility metadata is invalid",
    );
  }
  const authority = {
    resourceId: String(row.resource_id),
    resourceRevision: Number(row.resource_revision),
    deletionRevision: Number(row.deletion_revision),
    snapshotId: String(row.snapshot_id),
    snapshotDigest: String(row.snapshot_digest),
    providerId: String(row.provider_id),
    modelId: String(row.model_id),
    dimensions: Number(row.dimensions),
    modelRevision: String(row.model_revision),
  };
  try {
    assertAuthority(authority);
  } catch (error) {
    throw new ResearchResourceSemanticIndexError(
      "corrupt",
      "semantic publication authority is invalid",
      { cause: error },
    );
  }
  return authority;
}

function normalizedSchemaSql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sqliteFailure(message: string, error: unknown): ResearchResourceSemanticIndexError {
  if (error instanceof ResearchResourceSemanticIndexError) return error;
  const errcode = error && typeof error === "object" && "errcode" in error
    ? Number(error.errcode)
    : null;
  if (errcode === 11 || errcode === 24 || errcode === 26) {
    return new ResearchResourceSemanticIndexError("corrupt", message, { cause: error });
  }
  if (errcode !== null && Number.isInteger(errcode)) {
    return new ResearchResourceSemanticIndexError("unavailable", "Research semantic index is temporarily unavailable", {
      cause: error,
    });
  }
  return new ResearchResourceSemanticIndexError("corrupt", message, { cause: error });
}

function checkedSqlite<T>(message: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw sqliteFailure(message, error);
  }
}

function validateDatabase(database: Database, fresh: boolean): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA secure_delete = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (fresh) database.exec(SCHEMA);
  const version = Number(Object.values(database.prepare("PRAGMA user_version").get() ?? {})[0] ?? -1);
  if (version !== RESEARCH_SEMANTIC_SCHEMA_VERSION) throw new Error("unsupported semantic schema");
  const quickCheck = database.prepare("PRAGMA quick_check").all();
  if (quickCheck.length !== 1 || Object.values(quickCheck[0])[0] !== "ok") {
    throw new Error("semantic database failed quick_check");
  }
  const objects = database.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'view', 'trigger')
     ORDER BY type, name`,
  ).all();
  if (objects.length !== REQUIRED_TABLES.size) {
    throw new Error("semantic database has unexpected schema objects");
  }
  const tables = new Set<string>();
  for (const object of objects) {
    const name = String(object.name);
    const expected = EXPECTED_SCHEMA_OBJECTS.get(name);
    if (object.type !== "table" || !expected) {
      throw new Error(`semantic database has unexpected schema object ${name}`);
    }
    if (normalizedSchemaSql(object.sql) !== normalizedSchemaSql(expected)) {
      throw new Error(`semantic database table ${name} has an incompatible definition`);
    }
    tables.add(name);
  }
  for (const required of REQUIRED_TABLES) {
    if (!tables.has(required)) throw new Error(`semantic database is missing ${required}`);
  }
}

async function loadSqlite(): Promise<{ DatabaseSync: new (file: string) => Database }> {
  return (await import("node:sqlite")) as unknown as { DatabaseSync: new (file: string) => Database };
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) failInput("zero vectors are not usable");
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function openResearchResourceSemanticIndex(
  options: { file?: string; beforeFinalSafetyCheck?: () => void } = {},
): Promise<ResearchResourceSemanticIndex> {
  const file = path.resolve(/* turbopackIgnore: true */ options.file ?? semanticIndexPath());
  if (!path.isAbsolute(file)) {
    throw new ResearchResourceSemanticIndexError("unsafe-path", "semantic index path must be absolute");
  }
  ensureDirectory(path.dirname(file));
  if (hasActiveRebuildMarker(file)) throw staleIndex("Research semantic index is rebuilding");
  const fresh = ensurePrivateFile(file);
  hardenSqliteFiles(file);
  const { DatabaseSync } = await loadSqlite();
  let database: Database | null = null;
  try {
    database = new DatabaseSync(file);
    validateDatabase(database, fresh);
  } catch (error) {
    database?.close();
    throw sqliteFailure("Research semantic index requires rebuild", error);
  }
  // Keep path/link safety outside the SQLite-classification boundary: a
  // sidecar swap is unsafe, never evidence that trusted database bytes are corrupt.
  try {
    options.beforeFinalSafetyCheck?.();
    hardenSqliteFiles(file);
  } catch (error) {
    database.close();
    throw error;
  }
  const openedIdentity = lstatSync(file);
  let closedForRebuild = false;
  let watcher: ReturnType<typeof setInterval> | null = null;
  const controller: CanonicalHandleController = {
    closeForRebuild() {
      if (!database) return;
      closedForRebuild = true;
      try {
        database.close();
      } finally {
        database = null;
        if (watcher) clearInterval(watcher);
        watcher = null;
        const controllers = canonicalHandleControllers.get(file);
        controllers?.delete(controller);
        if (controllers?.size === 0) canonicalHandleControllers.delete(file);
      }
    },
  };
  const controllers = canonicalHandleControllers.get(file) ?? new Set<CanonicalHandleController>();
  controllers.add(controller);
  canonicalHandleControllers.set(file, controllers);
  watcher = setInterval(() => {
    try {
      if (hasActiveRebuildMarker(file)) controller.closeForRebuild();
    } catch {
      controller.closeForRebuild();
    }
  }, 25);
  watcher.unref();
  if (hasActiveRebuildMarker(file)) {
    controller.closeForRebuild();
    throw staleIndex("Research semantic index is rebuilding");
  }
  const assertCurrentFile = (): void => {
    if (!database || closedForRebuild) throw staleIndex("Research semantic index handle was released for rebuild");
    if (hasActiveRebuildMarker(file)) {
      controller.closeForRebuild();
      throw staleIndex("Research semantic index is rebuilding");
    }
    let current;
    try {
      current = lstatSync(file);
    } catch {
      controller.closeForRebuild();
      throw staleIndex("Research semantic index is missing during replacement");
    }
    if (!current.isFile() || current.isSymbolicLink()
        || current.dev !== openedIdentity.dev || current.ino !== openedIdentity.ino) {
      controller.closeForRebuild();
      throw staleIndex();
    }
  };

  const currentPublication = (resourceId: string): ResearchSemanticAuthority | null => {
    assertCurrentFile();
    assertId(resourceId, "resource id");
    const publication = checkedSqlite("semantic publication query failed", () => publicationFromRow(
      database!.prepare(
        `SELECT e.resource_id, e.resource_revision, e.deletion_revision, e.snapshot_id,
                e.snapshot_digest, e.model_revision, p.provider_id, p.model_id,
                p.dimensions, p.vector_encoding_version, p.chunker_version
         FROM embedding_state e JOIN provider_state p USING(model_revision)
         WHERE e.resource_id = ?`,
      ).get(resourceId),
    ));
    assertCurrentFile();
    return publication;
  };

  return {
    file,
    replace(authority, vectors) {
      assertCurrentFile();
      assertAuthority(authority);
      assertVectors(vectors, authority.dimensions);
      checkedSqlite("semantic vector publication failed", () => {
        database!.exec("BEGIN IMMEDIATE");
        try {
          database!.prepare(
          `INSERT INTO provider_state (
             model_revision, provider_id, model_id, dimensions,
             vector_encoding_version, chunker_version
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(model_revision) DO NOTHING`,
        ).run(authority.modelRevision, authority.providerId, authority.modelId, authority.dimensions,
          RESEARCH_VECTOR_ENCODING_VERSION, RESEARCH_LEXICAL_CHUNKER_VERSION);
          const provider = database!.prepare(
            "SELECT * FROM provider_state WHERE model_revision = ?",
          ).get(authority.modelRevision);
          if (!provider || String(provider.provider_id) !== authority.providerId
              || String(provider.model_id) !== authority.modelId
              || Number(provider.dimensions) !== authority.dimensions) {
            failInput("model revision conflicts with provider state");
          }
          if (String(provider.vector_encoding_version) !== RESEARCH_VECTOR_ENCODING_VERSION
              || String(provider.chunker_version) !== RESEARCH_LEXICAL_CHUNKER_VERSION) {
            throw new ResearchResourceSemanticIndexError(
              "corrupt",
              "semantic provider compatibility metadata is invalid",
            );
          }
          database!.prepare("DELETE FROM chunk_embeddings WHERE resource_id = ?").run(authority.resourceId);
          database!.prepare(
          `INSERT INTO embedding_state (
             resource_id, resource_revision, deletion_revision, snapshot_id,
             snapshot_digest, model_revision
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(resource_id) DO UPDATE SET
             resource_revision=excluded.resource_revision,
             deletion_revision=excluded.deletion_revision,
             snapshot_id=excluded.snapshot_id,
             snapshot_digest=excluded.snapshot_digest,
             model_revision=excluded.model_revision`,
        ).run(authority.resourceId, authority.resourceRevision, authority.deletionRevision,
          authority.snapshotId, authority.snapshotDigest, authority.modelRevision);
          const insert = database!.prepare(
            `INSERT INTO chunk_embeddings (
               resource_id, snapshot_id, chunk_id, ordinal, byte_start, byte_end, vector
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const item of vectors) insert.run(authority.resourceId, authority.snapshotId,
            item.id, item.ordinal, item.byteStart, item.byteEnd,
            encodeVector(item.vector, authority.dimensions));
          database!.exec("COMMIT");
        } catch (error) {
          try { database!.exec("ROLLBACK"); } catch { /* original error wins */ }
          throw error;
        }
      });
      hardenSqliteFiles(file);
      assertCurrentFile();
    },

    remove(resourceId) {
      assertCurrentFile();
      assertId(resourceId, "resource id");
      const { hasState, hasVectors } = checkedSqlite("semantic removal query failed", () => ({
        hasState: database!.prepare(
          "SELECT 1 AS present FROM embedding_state WHERE resource_id = ? LIMIT 1",
        ).get(resourceId),
        hasVectors: database!.prepare(
          "SELECT 1 AS present FROM chunk_embeddings WHERE resource_id = ? LIMIT 1",
        ).get(resourceId),
      }));
      if (!hasState && !hasVectors) {
        assertCurrentFile();
        return false;
      }
      if (!currentPublication(resourceId)) {
        throw new ResearchResourceSemanticIndexError(
          "corrupt",
          "semantic resource rows have no valid publication authority",
        );
      }
      checkedSqlite("semantic removal failed", () => {
        database!.exec("BEGIN IMMEDIATE");
        try {
          database!.prepare("DELETE FROM chunk_embeddings WHERE resource_id = ?").run(resourceId);
          database!.prepare("DELETE FROM embedding_state WHERE resource_id = ?").run(resourceId);
          database!.exec("COMMIT");
        } catch (error) {
          try { database!.exec("ROLLBACK"); } catch { /* original error wins */ }
          throw error;
        }
      });
      hardenSqliteFiles(file);
      assertCurrentFile();
      return true;
    },

    publication: currentPublication,

    verify(authority, chunks) {
      assertCurrentFile();
      assertAuthority(authority);
      const current = currentPublication(authority.resourceId);
      if (!current || !sameAuthority(current, authority)) {
        assertCurrentFile();
        return false;
      }
      const rows = checkedSqlite("semantic verification query failed", () => database!.prepare(
        `SELECT snapshot_id, chunk_id, ordinal, byte_start, byte_end, vector
         FROM chunk_embeddings WHERE resource_id = ? ORDER BY ordinal`,
      ).all(authority.resourceId));
      if (rows.length !== chunks.length) {
        throw new ResearchResourceSemanticIndexError("corrupt", "semantic chunk count is inconsistent");
      }
      rows.forEach((row, index) => {
        const expected = chunks[index];
        if (!expected
            || String(row.snapshot_id) !== authority.snapshotId
            || String(row.chunk_id) !== expected.id
            || Number(row.ordinal) !== expected.ordinal
            || Number(row.byte_start) !== expected.byteStart
            || Number(row.byte_end) !== expected.byteEnd) {
          throw new ResearchResourceSemanticIndexError("corrupt", "semantic chunk authority is inconsistent");
        }
        decodeVector(row.vector, authority.dimensions);
      });
      assertCurrentFile();
      return true;
    },

    probe(authority, queryVector, limit = 20) {
      assertCurrentFile();
      assertAuthority(authority);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) failInput("probe limit is invalid");
      encodeVector(queryVector, authority.dimensions);
      const current = currentPublication(authority.resourceId);
      if (!current || !sameAuthority(current, authority)) {
        assertCurrentFile();
        return { usable: false, vectorCount: 0, hits: [] };
      }
      const rows = checkedSqlite("semantic probe query failed", () => database!.prepare(
        `SELECT chunk_id, ordinal, byte_start, byte_end, vector
         FROM chunk_embeddings WHERE resource_id = ? AND snapshot_id = ? ORDER BY ordinal`,
      ).all(authority.resourceId, authority.snapshotId));
      const ranked = rows.map((row) => ({
        id: String(row.chunk_id),
        ordinal: Number(row.ordinal),
        byteStart: Number(row.byte_start),
        byteEnd: Number(row.byte_end),
        score: cosine(queryVector, decodeVector(row.vector, authority.dimensions)),
      })).sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)
        .slice(0, limit)
        .map((row, index) => ({ ...row, rank: index + 1 }));
      const result = { usable: true, vectorCount: rows.length, hits: ranked };
      assertCurrentFile();
      return result;
    },

    purgeResidualFiles(safetyCheck = () => {}) {
      assertCurrentFile();
      checkedSqlite("semantic compaction failed", () => {
        database!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        database!.exec("VACUUM");
        database!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      });
      safetyCheck();
      hardenSqliteFiles(file, safetyCheck);
      purgeResidualFiles(file, safetyCheck);
      assertCurrentFile();
    },

    close() {
      if (!database) return;
      if (watcher) clearInterval(watcher);
      watcher = null;
      const controllers = canonicalHandleControllers.get(file);
      controllers?.delete(controller);
      if (controllers?.size === 0) canonicalHandleControllers.delete(file);
      const closing = database;
      database = null;
      let failure: ResearchResourceSemanticIndexError | null = null;
      try {
        closing.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        failure = sqliteFailure("semantic database close failed", error);
      }
      try {
        closing.close();
      } catch (error) {
        failure ??= sqliteFailure("semantic database close failed", error);
      }
      // Closing the descriptor is safe even after an ancestor replacement;
      // pathname hardening is not. Only touch sidecars when the canonical leaf
      // still names the exact generation opened by this handle.
      let stillCanonical = false;
      try {
        const current = lstatSync(file);
        stillCanonical = current.isFile() && !current.isSymbolicLink()
          && current.dev === openedIdentity.dev && current.ino === openedIdentity.ino;
      } catch { /* a missing or replaced canonical path needs no hardening */ }
      if (stillCanonical && !hasActiveRebuildMarker(file)) hardenSqliteFiles(file);
      if (failure) throw failure;
    },
  };
}

export async function removeResearchResourceSemanticPublication(input: {
  resourceId: string;
  root?: string;
  file?: string;
  beforeMissingCanonicalSafetyCheck?: (
    boundary: "pre-scan" | "wal" | "shm" | "residual-purge",
    candidate?: string,
  ) => void;
  beforeExistingCanonicalSafetyCheck?: (
    boundary: "open" | "remove" | "residual-purge",
  ) => void;
  beforeCorruptCanonicalSafetyCheck?: (
    boundary: "canonical" | "wal" | "shm" | "residual-purge",
  ) => void;
}): Promise<void> {
  assertId(input.resourceId, "resource id");
  const file = path.resolve(input.file ?? researchResourceSemanticIndexPath(input.root));
  const deletionLayout = semanticDeletionLayout(file, input.root);
  if (!deletionLayout) return;
  assertStableDeletionLayout(deletionLayout);
  if (!existsSync(file)) {
    input.beforeMissingCanonicalSafetyCheck?.("pre-scan");
    assertStableDeletionLayout(deletionLayout);
    if (hasActiveRebuildMarker(file)) {
      throw new ResearchResourceSemanticIndexError(
        "unavailable", "Research semantic index is temporarily unavailable during rebuild",
      );
    }
    assertStableDeletionLayout(deletionLayout);
    purgeOrphanedCanonicalSidecars(
      file,
      () => assertStableDeletionLayout(deletionLayout),
      (candidate) => input.beforeMissingCanonicalSafetyCheck?.(
        candidate.endsWith("-wal") ? "wal" : "shm",
        candidate,
      ),
    );
    assertStableDeletionLayout(deletionLayout);
    purgeResidualFiles(
      file,
      () => assertStableDeletionLayout(deletionLayout),
      (candidate) => input.beforeMissingCanonicalSafetyCheck?.("residual-purge", candidate),
    );
    assertStableDeletionLayout(deletionLayout);
    return;
  }
  let index: ResearchResourceSemanticIndex | null = null;
  try {
    input.beforeExistingCanonicalSafetyCheck?.("open");
    assertStableDeletionLayout(deletionLayout);
    index = await openResearchResourceSemanticIndex({ file });
    input.beforeExistingCanonicalSafetyCheck?.("remove");
    assertStableDeletionLayout(deletionLayout);
    index.remove(input.resourceId);
    assertStableDeletionLayout(deletionLayout);
    input.beforeExistingCanonicalSafetyCheck?.("residual-purge");
    assertStableDeletionLayout(deletionLayout);
    // The index method performs SQLite compaction before scanning pathname
    // residuals. Fence the captured root/index identities immediately before
    // entering it and again after it returns.
    index.purgeResidualFiles(() => assertStableDeletionLayout(deletionLayout));
    assertStableDeletionLayout(deletionLayout);
    index.close();
  } catch (error) {
    try { index?.close(); } catch { /* cleanup below owns the result */ }
    if (!(error instanceof ResearchResourceSemanticIndexError) || error.code !== "corrupt") throw error;
    // Semantic rows are wholly derivative. If corruption prevents exact row
    // deletion, discard the complete database rather than retaining recoverable
    // content for a resource whose authoritative deletion is in progress.
    const canonicalCandidates = [
      { file, boundary: "canonical" as const },
      { file: `${file}-wal`, boundary: "wal" as const },
      { file: `${file}-shm`, boundary: "shm" as const },
    ];
    for (const candidate of canonicalCandidates) {
      input.beforeCorruptCanonicalSafetyCheck?.(candidate.boundary);
      assertStableDeletionLayout(deletionLayout);
      if (!existsSync(/* turbopackIgnore: true */ candidate.file)) continue;
      const metadata = lstatSync(candidate.file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new ResearchResourceSemanticIndexError("unsafe-path", "corrupt semantic database path is unsafe");
      }
      assertOwner(metadata, "corrupt semantic database");
      assertStableDeletionLayout(deletionLayout);
      rmSync(candidate.file);
      assertStableDeletionLayout(deletionLayout);
    }
    input.beforeCorruptCanonicalSafetyCheck?.("residual-purge");
    assertStableDeletionLayout(deletionLayout);
    purgeResidualFiles(file, () => assertStableDeletionLayout(deletionLayout));
    assertStableDeletionLayout(deletionLayout);
    syncDirectory(path.dirname(file));
    assertStableDeletionLayout(deletionLayout);
  }
}

export async function rebuildResearchResourceSemanticIndex(
  options: { file?: string } = {},
): Promise<{ index: ResearchResourceSemanticIndex; quarantinePath: string | null }> {
  const file = path.resolve(/* turbopackIgnore: true */ options.file ?? semanticIndexPath());
  ensureDirectory(path.dirname(file));
  if (existsSync(/* turbopackIgnore: true */ file)) hardenSqliteFiles(file);
  const expectedIdentity = existsSync(/* turbopackIgnore: true */ file) ? lstatSync(file) : null;
  const temporary = path.join(
    path.dirname(file),
    `.research-semantic-${process.pid}-${randomBytes(12).toString("hex")}.sqlite`,
  );
  let candidate: ResearchResourceSemanticIndex | null = null;
  try {
    candidate = await openResearchResourceSemanticIndex({ file: temporary });
    candidate.close();
    candidate = await openResearchResourceSemanticIndex({ file: temporary });
    candidate.close();
    candidate = null;
    syncDirectory(path.dirname(file));
  } catch (error) {
    try { candidate?.close(); } catch { /* reconstruction error wins */ }
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${temporary}${suffix}`, { force: true });
    syncDirectory(path.dirname(file));
    throw error;
  }
  const marker = beginRebuild(file);
  let quarantinePath: string | null = null;
  let lostRace = false;
  try {
    // Cross-process handles observe the marker and release their SQLite file
    // descriptors. Rename retries cover Windows handles still unwinding.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const currentIdentity = existsSync(/* turbopackIgnore: true */ file) ? lstatSync(file) : null;
    const sameFile = expectedIdentity === null
      ? currentIdentity === null
      : currentIdentity !== null
        && currentIdentity.dev === expectedIdentity.dev
        && currentIdentity.ino === expectedIdentity.ino;
    if (!sameFile) {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${temporary}${suffix}`, { force: true });
      syncDirectory(path.dirname(file));
      lostRace = true;
    } else {
      quarantinePath = existsSync(/* turbopackIgnore: true */ file)
        ? `${file}.corrupt-${Date.now()}-${randomBytes(4).toString("hex")}`
        : null;
      if (quarantinePath) {
        await renameWithRetry(file, quarantinePath);
        for (const suffix of ["-wal", "-shm"]) {
          if (existsSync(/* turbopackIgnore: true */ `${file}${suffix}`)) {
            await renameWithRetry(`${file}${suffix}`, `${quarantinePath}${suffix}`);
          }
        }
        syncDirectory(path.dirname(file));
      }
      try {
        await renameWithRetry(temporary, file);
        syncDirectory(path.dirname(file));
      } catch (error) {
        if (quarantinePath && !existsSync(/* turbopackIgnore: true */ file)) {
          await renameWithRetry(quarantinePath, file);
          syncDirectory(path.dirname(file));
        }
        throw error;
      }
      hardenSqliteFiles(file);
    }
  } finally {
    finishRebuild(marker);
  }
  return {
    index: await openResearchResourceSemanticIndex({ file }),
    quarantinePath: lostRace ? null : quarantinePath,
  };
}
