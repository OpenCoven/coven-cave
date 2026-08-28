import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  parseResourceIngestJobV1,
  parseResourceManifestV1,
  parseResourceSnapshotV1,
  parseResourceTombstoneV1,
  type ResourceIngestJobV1,
  type ResourceManifestV1,
  type ResourceSnapshotV1,
  type ResourceTombstoneV1,
} from "../research-resource-contracts.ts";
import { canonicalJson, sha256Digest } from "../research-protocol/digest.ts";
import { caveHome } from "../coven-paths.ts";
import { assertExclusivePathOwnership } from "./client-v1/path-ownership.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

export const MAX_RESEARCH_RESOURCE_BLOB_BYTES = 512 * 1024 * 1024;
const MAX_SNAPSHOT_RECORD_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_RECORDS = 100_000;
const MAX_MANIFEST_RECORD_BYTES = 1024 * 1024;
const MAX_MANIFEST_RECORDS = 100_000;
const MAX_OPERATIONAL_RECORD_BYTES = 1024 * 1024;
const MAX_OPERATIONAL_RECORDS = 100_000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_STORE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_DEVICE_IDS = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type PublishResourceSnapshotInput = {
  snapshot: ResourceSnapshotV1;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
};

export type VerifiedResourceSnapshot = {
  snapshot: ResourceSnapshotV1;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
};

export type ManifestCatalogCompatibilityOperation =
  | { kind: "create"; manifest: ResourceManifestV1 }
  | {
      kind: "update";
      id: string;
      expectedRevision: number;
      manifest: ResourceManifestV1;
    }
  | {
      kind: "replace";
      expectedManifest: ResourceManifestV1;
      manifest: ResourceManifestV1;
    }
  | { kind: "delete"; expectedManifest: ResourceManifestV1 };

export type ManifestCatalogTransaction = {
  listManifests(): ResourceManifestV1[];
  preflightCompatibilityMutation(
    operations: readonly ManifestCatalogCompatibilityOperation[],
  ): Promise<void>;
  createManifest(
    manifest: ResourceManifestV1,
  ): Promise<{ created: boolean; manifest: ResourceManifestV1 }>;
  updateManifest(input: {
    id: string;
    expectedRevision: number;
    manifest: ResourceManifestV1;
  }): Promise<ResourceManifestV1>;
  replaceCompatibilityManifest(input: {
    expectedManifest: ResourceManifestV1;
    manifest: ResourceManifestV1;
  }): Promise<ResourceManifestV1>;
  deleteCompatibilityManifest(
    expectedManifest: ResourceManifestV1,
  ): Promise<{ deleted: true; manifest: ResourceManifestV1 }>;
};

export type ResourceIngestFailureV1 = {
  version: 1;
  jobId: string;
  resourceId: string;
  resourceRevision: number;
  deletionRevision: number;
  stage: ResourceIngestJobV1["stage"];
  code: string;
  retryable: boolean;
  occurredAt: string;
};

export const RESOURCE_DELETION_PHASES = [
  "fenced",
  "manifest_deleting",
  "jobs_cancelled",
  "tombstoned",
  "derivatives_removed",
  "snapshots_removed",
  "manifest_removed",
  "projection_verified",
] as const;

export type ResourceDeletionPhaseV1 = (typeof RESOURCE_DELETION_PHASES)[number];

export type ResourceDeletionFenceV1 = {
  version: 1;
  resourceId: string;
  deletionRevision: number;
  updatedAt: string;
};

export type ResourceDeletionJournalV1 = {
  version: 1;
  resourceId: string;
  deletionRevision: number;
  expectedManifestRevision: number;
  phase: ResourceDeletionPhaseV1;
  deletedAt: string;
  snapshotIds: string[];
  updatedAt: string;
};

export type ResourceOperationalTransaction = ManifestCatalogTransaction & {
  listSnapshots(resourceId?: string): ResourceSnapshotV1[];
  readSnapshot(snapshotId: string): Promise<VerifiedResourceSnapshot>;
  publishSnapshot(input: PublishResourceSnapshotInput): Promise<{ created: boolean; snapshot: ResourceSnapshotV1 }>;
  deleteSnapshot(snapshotId: string): Promise<{ deleted: boolean; removedBlobDigests: string[] }>;
  listJobs(): ResourceIngestJobV1[];
  readJob(jobId: string): ResourceIngestJobV1 | null;
  createJob(job: ResourceIngestJobV1): Promise<{ created: boolean; job: ResourceIngestJobV1 }>;
  replaceJob(expected: ResourceIngestJobV1, job: ResourceIngestJobV1): Promise<ResourceIngestJobV1>;
  listFailures(): ResourceIngestFailureV1[];
  readFailure(jobId: string): ResourceIngestFailureV1 | null;
  writeFailure(failure: ResourceIngestFailureV1): Promise<ResourceIngestFailureV1>;
  deleteFailure(jobId: string): Promise<boolean>;
  listDeletionFences(): ResourceDeletionFenceV1[];
  readDeletionFence(resourceId: string): ResourceDeletionFenceV1 | null;
  repairDeletionFenceFromTombstone(resourceId: string): Promise<boolean>;
  resetRestoreOperationalState(): Promise<{ jobs: number; failures: number; deletions: number }>;
  repairTombstonedDeletionJournal(expectedManifest: ResourceManifestV1): Promise<boolean>;
  beginDeletion(input: {
    expectedManifest: ResourceManifestV1;
    deletedAt: string;
    snapshotIds: string[];
  }): Promise<ResourceDeletionJournalV1>;
  listDeletionJournals(): ResourceDeletionJournalV1[];
  readDeletionJournal(resourceId: string): ResourceDeletionJournalV1 | null;
  advanceDeletionJournal(
    expected: ResourceDeletionJournalV1,
    journal: ResourceDeletionJournalV1,
  ): Promise<ResourceDeletionJournalV1>;
  removeDeletionJournal(expected: ResourceDeletionJournalV1): Promise<void>;
  listTombstones(): ResourceTombstoneV1[];
  readTombstone(resourceId: string): ResourceTombstoneV1 | null;
  publishTombstone(tombstone: ResourceTombstoneV1): Promise<{ created: boolean; tombstone: ResourceTombstoneV1 }>;
  assertPublicationFence(input: {
    expectedJob: ResourceIngestJobV1;
    leaseToken: string;
    resourceId: string;
    resourceRevision: number;
    deletionRevision: number;
    now: string;
  }): void;
  commitReadyManifest(input: {
    expectedJob: ResourceIngestJobV1;
    leaseToken: string;
    now: string;
    id: string;
    expectedRevision: number;
    manifest: ResourceManifestV1;
  }): Promise<ResourceManifestV1>;
  deleteDeletingManifest(expectedManifest: ResourceManifestV1): Promise<ResourceManifestV1>;
};

export type ResearchResourceStore = {
  withManifestCatalogTransaction<T>(
    operation: (transaction: ManifestCatalogTransaction) => Promise<T>,
  ): Promise<T>;
  withOperationalTransaction<T>(
    operation: (transaction: ResourceOperationalTransaction) => Promise<T>,
  ): Promise<T>;
  createManifest(
    manifest: ResourceManifestV1,
  ): Promise<{ created: boolean; manifest: ResourceManifestV1 }>;
  readManifest(resourceId: string): Promise<ResourceManifestV1 | null>;
  listManifests(): Promise<ResourceManifestV1[]>;
  updateManifest(input: {
    id: string;
    expectedRevision: number;
    manifest: ResourceManifestV1;
  }): Promise<ResourceManifestV1>;
  publishSnapshot(
    input: PublishResourceSnapshotInput,
  ): Promise<{ created: boolean; snapshot: ResourceSnapshotV1 }>;
  readSnapshot(snapshotId: string): Promise<VerifiedResourceSnapshot>;
  deleteSnapshot(
    snapshotId: string,
  ): Promise<{ deleted: boolean; removedBlobDigests: string[] }>;
};

export class ResearchResourceStoreError extends Error {
  readonly code:
    | "invalid-id"
    | "invalid-manifest"
    | "invalid-snapshot"
    | "invalid-operational-record"
    | "digest-mismatch"
    | "immutable-conflict"
    | "revision-conflict"
    | "identity-conflict"
    | "snapshot-conflict"
    | "missing"
    | "too-large"
    | "symlink"
    | "unsafe-path"
    | "corrupt";

  constructor(
    code: ResearchResourceStoreError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResearchResourceStoreError";
    this.code = code;
  }
}

async function assertSafeOwnership(
  candidate: string,
  metadata: Parameters<typeof assertExclusivePathOwnership>[1],
  label: string,
): Promise<void> {
  try {
    await assertExclusivePathOwnership(candidate, metadata, label);
  } catch (error) {
    if (error instanceof ResearchResourceStoreError) throw error;
    throw new ResearchResourceStoreError(
      "unsafe-path",
      `${label} ownership is unsafe`,
      { cause: error },
    );
  }
}

type PathIdentity = {
  path: string;
  dev: number | bigint;
  ino: number | bigint;
};

type StoreLayout = {
  root: PathIdentity;
  rootRealPath: string;
  manifests: PathIdentity;
  snapshots: PathIdentity;
  blobs: PathIdentity;
  sha256: PathIdentity;
  locks: PathIdentity;
  intents: PathIdentity;
  jobs: PathIdentity;
  failures: PathIdentity;
  fences: PathIdentity;
  deletions: PathIdentity;
  tombstones: PathIdentity;
};

function pathIdentity(
  candidate: string,
  metadata: { dev: number | bigint; ino: number | bigint },
): PathIdentity {
  return { path: candidate, dev: metadata.dev, ino: metadata.ino };
}

function sameIdentity(
  left: Pick<PathIdentity, "dev" | "ino">,
  right: Pick<PathIdentity, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertStoreId(value: string, label: string): void {
  if (!SAFE_STORE_ID.test(value) || WINDOWS_DEVICE_IDS.test(value)) {
    throw new ResearchResourceStoreError(
      "invalid-id",
      `${label} id is not a safe cross-platform store path segment`,
    );
  }
}

function assertSnapshotId(value: string): void {
  assertStoreId(value, "snapshot");
}

function assertResourceId(value: string): void {
  assertStoreId(value, "resource");
}

function assertBlobSize(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength > MAX_RESEARCH_RESOURCE_BLOB_BYTES) {
    throw new ResearchResourceStoreError(
      "too-large",
      `${label} exceeds the 512 MiB Research Resource blob limit`,
    );
  }
}

function assertPrivateMode(mode: number, expected: number, label: string): void {
  if (process.platform === "win32") return;
  if ((mode & 0o777) !== expected) {
    throw new ResearchResourceStoreError(
      "unsafe-path",
      `${label} permissions must be ${expected.toString(8)}`,
    );
  }
}

async function pathMetadata(candidate: string, missingMessage: string) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResearchResourceStoreError("missing", missingMessage);
    }
    throw error;
  }
}

async function ensureRealDirectory(
  candidate: string,
  rootRealPath: string | null,
  label: string,
): Promise<PathIdentity> {
  let created = false;
  try {
    await mkdir(candidate, { mode: DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const before = await pathMetadata(candidate, `${label} directory is missing`);
  if (before.isSymbolicLink()) {
    throw new ResearchResourceStoreError("symlink", `${label} directory is a symlink`);
  }
  if (!before.isDirectory()) {
    throw new ResearchResourceStoreError("unsafe-path", `${label} path is not a directory`);
  }
  await assertSafeOwnership(candidate, before, `Research Resource ${label} directory`);
  const resolved = await realpath(candidate);
  if (rootRealPath !== null && !isContained(rootRealPath, resolved)) {
    throw new ResearchResourceStoreError("symlink", `${label} directory escapes the store root`);
  }
  const after = await lstat(candidate);
  if (!sameIdentity(before, after)) {
    throw new ResearchResourceStoreError("symlink", `${label} directory identity changed`);
  }
  assertPrivateMode(after.mode, DIRECTORY_MODE, `${label} directory`);
  if (created) await syncDirectory(path.dirname(candidate));
  return pathIdentity(candidate, after);
}

async function assertStableDirectory(entry: PathIdentity, label: string): Promise<void> {
  const current = await pathMetadata(entry.path, `${label} directory is missing`);
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(entry, current)) {
    throw new ResearchResourceStoreError("symlink", `${label} directory identity changed`);
  }
  await assertSafeOwnership(entry.path, current, `Research Resource ${label} directory`);
  assertPrivateMode(current.mode, DIRECTORY_MODE, `${label} directory`);
}

function noFollowFlag(): number {
  return process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
}

function readFlags(): number {
  return constants.O_RDONLY | noFollowFlag();
}

function exclusiveWriteFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag();
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

async function readSafeFileWithIdentity(input: {
  target: string;
  rootRealPath: string;
  label: string;
  maxBytes: number;
}): Promise<{ bytes: Uint8Array; identity: PathIdentity }> {
  const before = await pathMetadata(input.target, `${input.label} is missing`);
  if (before.isSymbolicLink()) {
    throw new ResearchResourceStoreError("symlink", `${input.label} is a symlink`);
  }
  if (!before.isFile()) {
    throw new ResearchResourceStoreError("unsafe-path", `${input.label} is not a regular file`);
  }
  if (before.nlink !== 1) {
    throw new ResearchResourceStoreError("unsafe-path", `${input.label} must have exactly one link`);
  }
  if (before.size > input.maxBytes) {
    throw new ResearchResourceStoreError("too-large", `${input.label} exceeds its size limit`);
  }
  await assertSafeOwnership(input.target, before, `Research Resource ${input.label}`);
  assertPrivateMode(before.mode, FILE_MODE, input.label);
  let handle: FileHandle;
  try {
    handle = await open(input.target, readFlags());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new ResearchResourceStoreError("symlink", `${input.label} is a symlink`);
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResearchResourceStoreError("missing", `${input.label} is missing`);
    }
    throw error;
  }
  try {
    const opened = await handle.stat();
    const after = await pathMetadata(input.target, `${input.label} is missing`);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > input.maxBytes ||
      after.isSymbolicLink() ||
      !after.isFile() ||
      !sameIdentity(before, opened) ||
      !sameIdentity(opened, after)
    ) {
      throw new ResearchResourceStoreError(
        "symlink",
        `${input.label} identity changed while opening`,
      );
    }
    const resolved = await realpath(input.target);
    if (!isContained(input.rootRealPath, resolved)) {
      throw new ResearchResourceStoreError("symlink", `${input.label} escapes the store root`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, input.maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > input.maxBytes) {
        throw new ResearchResourceStoreError(
          "too-large",
          `${input.label} exceeds its size limit`,
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return {
      bytes: new Uint8Array(Buffer.concat(chunks, total)),
      identity: pathIdentity(input.target, opened),
    };
  } finally {
    await handle.close();
  }
}

async function readSafeFile(input: {
  target: string;
  rootRealPath: string;
  label: string;
  maxBytes: number;
}): Promise<Uint8Array> {
  return (await readSafeFileWithIdentity(input)).bytes;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("Research Resource write made no progress");
    offset += bytesWritten;
  }
}

async function publishNoReplace(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  target: string;
  bytes: Uint8Array;
  label: string;
  maxBytes: number;
  existingMismatchCode: "corrupt" | "immutable-conflict";
}): Promise<"created" | "existing"> {
  await assertStableLayout(input.layout);
  await assertStableDirectory(input.directory, input.label);
  const temporary = path.join(
    input.directory.path,
    `.tmp-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  let handle: FileHandle | null = null;
  let result: "created" | "existing" = "created";
  let openedIdentity: Awaited<ReturnType<FileHandle["stat"]>> | null = null;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    openedIdentity = await handle.stat();
    const temporaryInfo = await lstat(temporary);
    if (!openedIdentity.isFile() || !sameIdentity(openedIdentity, temporaryInfo)) {
      throw new ResearchResourceStoreError("symlink", `${input.label} temporary identity changed`);
    }
    await writeAll(handle, input.bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertStableLayout(input.layout);
    const closedTemporary = await lstat(temporary);
    if (!sameIdentity(openedIdentity, closedTemporary)) {
      throw new ResearchResourceStoreError("symlink", `${input.label} temporary identity changed`);
    }
    try {
      await link(temporary, input.target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readSafeFile({
        target: input.target,
        rootRealPath: input.layout.rootRealPath,
        label: input.label,
        maxBytes: input.maxBytes,
      });
      if (!Buffer.from(existing).equals(Buffer.from(input.bytes))) {
        throw new ResearchResourceStoreError(
          input.existingMismatchCode,
          `${input.label} already exists with different bytes`,
        );
      }
      result = "existing";
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
  if (result === "created") {
    const published = await pathMetadata(input.target, `${input.label} is missing`);
    if (!openedIdentity || !sameIdentity(openedIdentity, published) || published.nlink !== 1) {
      throw new ResearchResourceStoreError("unsafe-path", `${input.label} publication is unsafe`);
    }
    await assertSafeOwnership(input.target, published, `Research Resource ${input.label}`);
    assertPrivateMode(published.mode, FILE_MODE, input.label);
    await syncDirectory(input.directory.path);
  }
  return result;
}

async function publishReplace(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  target: string;
  bytes: Uint8Array;
  expectedBytes: Uint8Array;
  label: string;
  maxBytes: number;
  expectedIdentity: PathIdentity;
}): Promise<PathIdentity> {
  await assertStableLayout(input.layout);
  await assertStableDirectory(input.directory, input.label);
  const temporary = path.join(
    input.directory.path,
    `.tmp-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  let handle: FileHandle | null = null;
  let openedIdentity: Awaited<ReturnType<FileHandle["stat"]>> | null = null;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    openedIdentity = await handle.stat();
    const temporaryInfo = await lstat(temporary);
    if (!openedIdentity.isFile() || !sameIdentity(openedIdentity, temporaryInfo)) {
      throw new ResearchResourceStoreError("symlink", `${input.label} temporary identity changed`);
    }
    await writeAll(handle, input.bytes);
    await handle.sync();
    await handle.close();
    handle = null;

    const current = await readSafeFileWithIdentity({
      target: input.target,
      rootRealPath: input.layout.rootRealPath,
      label: input.label,
      maxBytes: input.maxBytes,
    });
    if (
      !sameIdentity(current.identity, input.expectedIdentity) ||
      !Buffer.from(current.bytes).equals(Buffer.from(input.expectedBytes))
    ) {
      throw new ResearchResourceStoreError(
        "revision-conflict",
        `${input.label} changed before replacement`,
      );
    }
    await assertStableLayout(input.layout);
    const closedTemporary = await lstat(temporary);
    if (!sameIdentity(openedIdentity, closedTemporary)) {
      throw new ResearchResourceStoreError("symlink", `${input.label} temporary identity changed`);
    }
    await rename(temporary, input.target);
    const published = await pathMetadata(input.target, `${input.label} is missing`);
    if (!sameIdentity(openedIdentity, published) || published.nlink !== 1) {
      throw new ResearchResourceStoreError("unsafe-path", `${input.label} replacement is unsafe`);
    }
    await assertSafeOwnership(input.target, published, `Research Resource ${input.label}`);
    assertPrivateMode(published.mode, FILE_MODE, input.label);
    await syncDirectory(input.directory.path);
    return pathIdentity(input.target, published);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

function parseManifest(value: unknown): ResourceManifestV1 {
  const parsed = parseResourceManifestV1(value);
  if (!parsed.ok) {
    throw new ResearchResourceStoreError(
      "invalid-manifest",
      `${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  assertResourceId(parsed.value.id);
  if (parsed.value.canonicalIdentity.trim() !== parsed.value.canonicalIdentity) {
    throw new ResearchResourceStoreError(
      "invalid-manifest",
      "canonicalIdentity must not have leading or trailing whitespace",
    );
  }
  return parsed.value;
}

function parseSnapshot(value: unknown): ResourceSnapshotV1 {
  const parsed = parseResourceSnapshotV1(value);
  if (!parsed.ok) {
    throw new ResearchResourceStoreError(
      "invalid-snapshot",
      `${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  assertSnapshotId(parsed.value.id);
  return parsed.value;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ResearchResourceStoreError("corrupt", `${label} is not valid UTF-8 JSON`);
  }
}

function snapshotFile(layout: StoreLayout, snapshotId: string): string {
  assertSnapshotId(snapshotId);
  return path.join(layout.snapshots.path, `${snapshotId}.json`);
}

function manifestFile(layout: StoreLayout, resourceId: string): string {
  assertResourceId(resourceId);
  return path.join(layout.manifests.path, `${resourceId}.json`);
}

async function assertStableLayout(layout: StoreLayout): Promise<void> {
  await assertStableDirectory(layout.root, "store root");
  await assertStableDirectory(layout.manifests, "manifests");
  await assertStableDirectory(layout.snapshots, "snapshots");
  await assertStableDirectory(layout.blobs, "blobs");
  await assertStableDirectory(layout.sha256, "sha256 blobs");
  await assertStableDirectory(layout.locks, "locks");
  await assertStableDirectory(layout.intents, "lock intents");
  await assertStableDirectory(layout.jobs, "jobs");
  await assertStableDirectory(layout.failures, "failures");
  await assertStableDirectory(layout.fences, "fences");
  await assertStableDirectory(layout.deletions, "deletions");
  await assertStableDirectory(layout.tombstones, "tombstones");
  if ((await realpath(layout.root.path)) !== layout.rootRealPath) {
    throw new ResearchResourceStoreError("symlink", "store root identity changed");
  }
}

async function ensureLayout(root: string): Promise<StoreLayout> {
  await mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
  const rootIdentity = await ensureRealDirectory(root, null, "store root");
  const rootRealPath = await realpath(root);
  const manifests = await ensureRealDirectory(path.join(root, "manifests"), rootRealPath, "manifests");
  const snapshots = await ensureRealDirectory(path.join(root, "snapshots"), rootRealPath, "snapshots");
  const blobs = await ensureRealDirectory(path.join(root, "blobs"), rootRealPath, "blobs");
  const sha256 = await ensureRealDirectory(path.join(root, "blobs", "sha256"), rootRealPath, "sha256 blobs");
  const locks = await ensureRealDirectory(path.join(root, "locks"), rootRealPath, "locks");
  const intents = await ensureRealDirectory(path.join(root, "locks", "intents"), rootRealPath, "lock intents");
  const jobs = await ensureRealDirectory(path.join(root, "jobs"), rootRealPath, "jobs");
  const failures = await ensureRealDirectory(path.join(root, "failures"), rootRealPath, "failures");
  const fences = await ensureRealDirectory(path.join(root, "fences"), rootRealPath, "fences");
  const deletions = await ensureRealDirectory(path.join(root, "deletions"), rootRealPath, "deletions");
  const tombstones = await ensureRealDirectory(path.join(root, "tombstones"), rootRealPath, "tombstones");
  return {
    root: rootIdentity,
    rootRealPath,
    manifests,
    snapshots,
    blobs,
    sha256,
    locks,
    intents,
    jobs,
    failures,
    fences,
    deletions,
    tombstones,
  };
}

async function ensureShard(layout: StoreLayout, digest: string): Promise<PathIdentity> {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new ResearchResourceStoreError("invalid-snapshot", "blob digest is not lowercase SHA-256");
  }
  await assertStableLayout(layout);
  return ensureRealDirectory(
    path.join(layout.sha256.path, digest.slice(0, 2)),
    layout.rootRealPath,
    `blob shard ${digest.slice(0, 2)}`,
  );
}

async function existingShard(layout: StoreLayout, digest: string): Promise<PathIdentity> {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new ResearchResourceStoreError("invalid-snapshot", "blob digest is not lowercase SHA-256");
  }
  await assertStableLayout(layout);
  const shardPath = path.join(layout.sha256.path, digest.slice(0, 2));
  const metadata = await pathMetadata(shardPath, `blob shard ${digest.slice(0, 2)} is missing`);
  if (metadata.isSymbolicLink()) {
    throw new ResearchResourceStoreError("symlink", `blob shard ${digest.slice(0, 2)} is a symlink`);
  }
  if (!metadata.isDirectory()) {
    throw new ResearchResourceStoreError("unsafe-path", `blob shard ${digest.slice(0, 2)} is not a directory`);
  }
  await assertSafeOwnership(
    shardPath,
    metadata,
    `Research Resource blob shard ${digest.slice(0, 2)} directory`,
  );
  const resolved = await realpath(shardPath);
  if (!isContained(layout.rootRealPath, resolved)) {
    throw new ResearchResourceStoreError("symlink", `blob shard ${digest.slice(0, 2)} escapes the store root`);
  }
  const after = await lstat(shardPath);
  if (!sameIdentity(metadata, after)) {
    throw new ResearchResourceStoreError("symlink", `blob shard ${digest.slice(0, 2)} identity changed`);
  }
  assertPrivateMode(after.mode, DIRECTORY_MODE, `blob shard ${digest.slice(0, 2)} directory`);
  return pathIdentity(shardPath, after);
}

async function publishBlob(layout: StoreLayout, digest: string, bytes: Uint8Array): Promise<void> {
  assertBlobSize(bytes, "blob");
  if (sha256Digest(bytes) !== digest) {
    throw new ResearchResourceStoreError("digest-mismatch", "blob bytes do not match their digest");
  }
  const shard = await ensureShard(layout, digest);
  await publishNoReplace({
    layout,
    directory: shard,
    target: path.join(shard.path, digest),
    bytes,
    label: `blob ${digest}`,
    maxBytes: MAX_RESEARCH_RESOURCE_BLOB_BYTES,
    existingMismatchCode: "corrupt",
  });
}

async function readBlob(layout: StoreLayout, digest: string): Promise<Uint8Array> {
  const shard = await existingShard(layout, digest);
  const bytes = await readSafeFile({
    target: path.join(shard.path, digest),
    rootRealPath: layout.rootRealPath,
    label: `blob ${digest}`,
    maxBytes: MAX_RESEARCH_RESOURCE_BLOB_BYTES,
  });
  if (sha256Digest(bytes) !== digest) {
    throw new ResearchResourceStoreError("digest-mismatch", `blob ${digest} is corrupt`);
  }
  await assertStableDirectory(shard, `blob shard ${digest.slice(0, 2)}`);
  return bytes;
}

async function readManifestRecord(
  layout: StoreLayout,
  resourceId: string,
  missingAsNull: boolean,
): Promise<ResourceManifestV1 | null> {
  return (await readManifestRecordWithIdentity(layout, resourceId, missingAsNull))?.manifest ?? null;
}

async function readManifestRecordWithIdentity(
  layout: StoreLayout,
  resourceId: string,
  missingAsNull: boolean,
): Promise<{ manifest: ResourceManifestV1; identity: PathIdentity } | null> {
  try {
    const record = await readSafeFileWithIdentity({
      target: manifestFile(layout, resourceId),
      rootRealPath: layout.rootRealPath,
      label: `manifest ${resourceId}`,
      maxBytes: MAX_MANIFEST_RECORD_BYTES,
    });
    const { bytes } = record;
    const manifest = parseManifest(parseJson(bytes, `manifest ${resourceId}`));
    if (manifest.id !== resourceId) {
      throw new ResearchResourceStoreError("corrupt", "manifest filename and id do not match");
    }
    const canonicalBytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
    if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes))) {
      throw new ResearchResourceStoreError(
        "corrupt",
        `manifest ${resourceId} is not canonical JSON`,
      );
    }
    return { manifest, identity: record.identity };
  } catch (error) {
    if (
      missingAsNull &&
      error instanceof ResearchResourceStoreError &&
      error.code === "missing"
    ) {
      return null;
    }
    throw error;
  }
}

async function scanManifests(layout: StoreLayout): Promise<{
  records: Map<string, ResourceManifestV1>;
  identities: Map<string, PathIdentity>;
}> {
  await assertStableLayout(layout);
  const records = new Map<string, ResourceManifestV1>();
  const identities = new Map<string, PathIdentity>();
  const names: string[] = [];
  for await (const entry of await opendir(layout.manifests.path)) {
    if (names.length >= MAX_MANIFEST_RECORDS) {
      throw new ResearchResourceStoreError(
        "too-large",
        `manifest catalog exceeds the ${MAX_MANIFEST_RECORDS} record scan limit`,
      );
    }
    names.push(entry.name);
  }
  for (const name of names.sort()) {
    if (/^\.tmp-[0-9]+-[a-f0-9]{24}$/.test(name)) continue;
    if (!name.endsWith(".json")) {
      throw new ResearchResourceStoreError("corrupt", `unexpected manifest entry ${name}`);
    }
    const id = name.slice(0, -".json".length);
    if (!SAFE_STORE_ID.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
      throw new ResearchResourceStoreError("corrupt", `unsafe manifest entry ${name}`);
    }
    const record = await readManifestRecordWithIdentity(layout, id, false);
    if (!record) throw new ResearchResourceStoreError("corrupt", `manifest ${id} vanished`);
    records.set(id, record.manifest);
    identities.set(id, record.identity);
  }
  const canonicalOwners = new Map<string, string>();
  const legacyOwners = new Map<string, string>();
  for (const manifest of records.values()) {
    const canonicalOwner = canonicalOwners.get(manifest.canonicalIdentity);
    if (canonicalOwner) {
      throw new ResearchResourceStoreError(
        "identity-conflict",
        `canonicalIdentity is owned by both ${canonicalOwner} and ${manifest.id}`,
      );
    }
    canonicalOwners.set(manifest.canonicalIdentity, manifest.id);
    if (manifest.legacySavedLink) {
      const legacyOwner = legacyOwners.get(manifest.legacySavedLink.id);
      if (legacyOwner) {
        throw new ResearchResourceStoreError(
          "identity-conflict",
          `legacy saved-link id is owned by both ${legacyOwner} and ${manifest.id}`,
        );
      }
      legacyOwners.set(manifest.legacySavedLink.id, manifest.id);
    }
  }
  await assertStableDirectory(layout.manifests, "manifests");
  return { records, identities };
}

function assertUniqueManifest(
  records: Map<string, ResourceManifestV1>,
  candidate: ResourceManifestV1,
): void {
  for (const existing of records.values()) {
    if (existing.id === candidate.id) continue;
    if (existing.canonicalIdentity === candidate.canonicalIdentity) {
      throw new ResearchResourceStoreError(
        "identity-conflict",
        "canonicalIdentity already belongs to another resource",
      );
    }
    if (
      candidate.legacySavedLink &&
      existing.legacySavedLink?.id === candidate.legacySavedLink.id
    ) {
      throw new ResearchResourceStoreError(
        "identity-conflict",
        "legacy saved-link id already belongs to another resource",
      );
    }
  }
}

async function readSnapshotRecord(
  layout: StoreLayout,
  snapshotId: string,
  missingAsNull: boolean,
): Promise<ResourceSnapshotV1 | null> {
  try {
    const bytes = await readSafeFile({
      target: snapshotFile(layout, snapshotId),
      rootRealPath: layout.rootRealPath,
      label: `snapshot ${snapshotId}`,
      maxBytes: MAX_SNAPSHOT_RECORD_BYTES,
    });
    const snapshot = parseSnapshot(parseJson(bytes, `snapshot ${snapshotId}`));
    if (snapshot.id !== snapshotId) {
      throw new ResearchResourceStoreError("corrupt", "snapshot filename and id do not match");
    }
    const canonicalBytes = new TextEncoder().encode(`${canonicalJson(snapshot)}\n`);
    if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes))) {
      throw new ResearchResourceStoreError(
        "corrupt",
        `snapshot ${snapshotId} is not canonical immutable JSON`,
      );
    }
    return snapshot;
  } catch (error) {
    if (
      missingAsNull &&
      error instanceof ResearchResourceStoreError &&
      error.code === "missing"
    ) {
      return null;
    }
    throw error;
  }
}

async function scanSnapshots(layout: StoreLayout): Promise<Map<string, ResourceSnapshotV1>> {
  await assertStableLayout(layout);
  const records = new Map<string, ResourceSnapshotV1>();
  const names: string[] = [];
  for await (const entry of await opendir(layout.snapshots.path)) {
    if (names.length >= MAX_SNAPSHOT_RECORDS) {
      throw new ResearchResourceStoreError(
        "too-large",
        `snapshot store exceeds the ${MAX_SNAPSHOT_RECORDS} record scan limit`,
      );
    }
    names.push(entry.name);
  }
  for (const name of names.sort()) {
    if (name.startsWith(".tmp-")) continue;
    if (!name.endsWith(".json")) {
      throw new ResearchResourceStoreError("corrupt", `unexpected snapshot entry ${name}`);
    }
    const id = name.slice(0, -".json".length);
    if (!SAFE_STORE_ID.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
      throw new ResearchResourceStoreError("corrupt", `unsafe snapshot entry ${name}`);
    }
    const snapshot = await readSnapshotRecord(layout, id, false);
    if (!snapshot) throw new ResearchResourceStoreError("corrupt", `snapshot ${id} vanished`);
    records.set(id, snapshot);
  }
  await assertStableDirectory(layout.snapshots, "snapshots");
  return records;
}

async function verifyCurrentSnapshot(
  layout: StoreLayout,
  manifest: ResourceManifestV1,
): Promise<void> {
  if (!manifest.currentSnapshotId) return;
  try {
    const snapshot = await readSnapshotRecord(layout, manifest.currentSnapshotId, false);
    if (
      !snapshot ||
      snapshot.resourceId !== manifest.id ||
      snapshot.resourceRevision !== manifest.revision
    ) {
      throw new ResearchResourceStoreError(
        "snapshot-conflict",
        "current snapshot does not match the manifest resource and revision",
      );
    }
    const normalizedBlob = await readBlob(layout, snapshot.normalizedBlobDigest);
    if (normalizedBlob.byteLength !== snapshot.normalizedBytes) {
      throw new ResearchResourceStoreError(
        "snapshot-conflict",
        "current snapshot normalized byte length is corrupt",
      );
    }
    if (snapshot.rawBlobDigest) await readBlob(layout, snapshot.rawBlobDigest);
  } catch (error) {
    if (error instanceof ResearchResourceStoreError && error.code === "snapshot-conflict") {
      throw error;
    }
    throw new ResearchResourceStoreError(
      "snapshot-conflict",
      "current snapshot could not be verified",
      { cause: error },
    );
  }
}

function manifestBytes(manifest: ResourceManifestV1): Uint8Array {
  const bytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
  if (bytes.byteLength > MAX_MANIFEST_RECORD_BYTES) {
    throw new ResearchResourceStoreError("too-large", "manifest record exceeds 1 MiB");
  }
  return bytes;
}

function detachedManifest(manifest: ResourceManifestV1): ResourceManifestV1 {
  return structuredClone(manifest);
}

function sortedDetachedManifests(
  records: Map<string, ResourceManifestV1>,
): ResourceManifestV1[] {
  return [...records.values()]
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
    .map(detachedManifest);
}

function parseExpectedRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      "expectedRevision must be a positive safe integer",
    );
  }
}

function assertNextRevision(
  existing: ResourceManifestV1,
  manifest: ResourceManifestV1,
  expectedRevision: number,
): void {
  if (existing.revision !== expectedRevision) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      "manifest revision changed before the update",
    );
  }
  if (manifest.revision !== expectedRevision + 1) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      "next manifest revision must increment expectedRevision exactly once",
    );
  }
  if (Date.parse(manifest.updatedAt) <= Date.parse(existing.updatedAt)) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      "updatedAt must advance on every manifest revision",
    );
  }
}

async function createManifestLocked(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  identities: Map<string, PathIdentity>,
  inputManifest: ResourceManifestV1,
): Promise<{ created: boolean; manifest: ResourceManifestV1 }> {
  const prepared = await validateManifestCreate(layout, records, inputManifest);
  if (prepared.existing) {
    return { created: false, manifest: detachedManifest(prepared.manifest) };
  }
  const manifest = prepared.manifest;
  const result = await publishNoReplace({
    layout,
    directory: layout.manifests,
    target: manifestFile(layout, manifest.id),
    bytes: prepared.recordBytes,
    label: `manifest ${manifest.id}`,
    maxBytes: MAX_MANIFEST_RECORD_BYTES,
    existingMismatchCode: "immutable-conflict",
  });
  records.set(manifest.id, detachedManifest(manifest));
  const published = await readManifestRecordWithIdentity(layout, manifest.id, false);
  if (!published) throw new ResearchResourceStoreError("corrupt", `manifest ${manifest.id} vanished`);
  identities.set(manifest.id, published.identity);
  return { created: result === "created", manifest: detachedManifest(manifest) };
}

async function validateManifestCreate(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  inputManifest: ResourceManifestV1,
): Promise<{
  manifest: ResourceManifestV1;
  recordBytes: Uint8Array;
  existing: boolean;
}> {
  const manifest = parseManifest(inputManifest);
  if (manifest.revision !== 1) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      "new manifests must start at revision 1",
    );
  }
  const recordBytes = manifestBytes(manifest);
  const existing = records.get(manifest.id);
  if (existing) {
    if (canonicalJson(existing) === canonicalJson(manifest)) {
      assertUniqueManifest(records, manifest);
      await verifyCurrentSnapshot(layout, manifest);
      return { manifest, recordBytes, existing: true };
    }
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      `manifest ${manifest.id} already exists with different content`,
    );
  }
  assertUniqueManifest(records, manifest);
  await verifyCurrentSnapshot(layout, manifest);
  return { manifest, recordBytes, existing: false };
}

async function updateManifestLocked(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  identities: Map<string, PathIdentity>,
  input: { id: string; expectedRevision: number; manifest: ResourceManifestV1 },
): Promise<ResourceManifestV1> {
  const prepared = await validateManifestUpdate(layout, records, input);
  return publishPreparedManifestUpdate(layout, records, identities, prepared);
}

async function publishPreparedManifestUpdate(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  identities: Map<string, PathIdentity>,
  prepared: {
    existing: ResourceManifestV1;
    manifest: ResourceManifestV1;
    recordBytes: Uint8Array;
  },
): Promise<ResourceManifestV1> {
  const { existing, manifest } = prepared;
  const expectedIdentity = identities.get(manifest.id);
  if (!expectedIdentity) {
    throw new ResearchResourceStoreError("corrupt", `manifest ${manifest.id} identity is missing`);
  }
  const publishedIdentity = await publishReplace({
    layout,
    directory: layout.manifests,
    target: manifestFile(layout, manifest.id),
    bytes: prepared.recordBytes,
    expectedBytes: manifestBytes(existing),
    label: `manifest ${manifest.id}`,
    maxBytes: MAX_MANIFEST_RECORD_BYTES,
    expectedIdentity,
  });
  records.set(manifest.id, detachedManifest(manifest));
  identities.set(manifest.id, publishedIdentity);
  return detachedManifest(manifest);
}

async function validateManifestUpdate(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  input: { id: string; expectedRevision: number; manifest: ResourceManifestV1 },
): Promise<{
  existing: ResourceManifestV1;
  manifest: ResourceManifestV1;
  recordBytes: Uint8Array;
}> {
  assertResourceId(input.id);
  parseExpectedRevision(input.expectedRevision);
  const manifest = parseManifest(input.manifest);
  if (manifest.id !== input.id) {
    throw new ResearchResourceStoreError("immutable-conflict", "manifest id cannot change");
  }
  const existing = records.get(input.id);
  if (!existing) {
    throw new ResearchResourceStoreError("missing", `manifest ${input.id} is missing`);
  }
  assertNextRevision(existing, manifest, input.expectedRevision);
  if (
    manifest.id !== existing.id ||
    manifest.canonicalIdentity !== existing.canonicalIdentity ||
    manifest.createdAt !== existing.createdAt ||
    canonicalJson(manifest.legacySavedLink ?? null) !==
      canonicalJson(existing.legacySavedLink ?? null)
  ) {
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      "manifest identity, creation time, and legacy origin cannot change",
    );
  }
  assertUniqueManifest(records, manifest);
  await verifyCurrentSnapshot(layout, manifest);
  return { existing, manifest, recordBytes: manifestBytes(manifest) };
}

async function assertCompatibilityDeletion(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  inputExpected: ResourceManifestV1,
): Promise<ResourceManifestV1> {
  const expected = parseManifest(inputExpected);
  const existing = records.get(expected.id);
  if (!existing) {
    throw new ResearchResourceStoreError("missing", `manifest ${expected.id} is missing`);
  }
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      `manifest ${expected.id} changed before compatibility deletion`,
    );
  }
  if (!existing.legacySavedLink) {
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      "compatibility deletion requires a legacy saved-link origin",
    );
  }
  if (existing.currentSnapshotId) {
    throw new ResearchResourceStoreError(
      "snapshot-conflict",
      "compatibility deletion cannot remove a current snapshot owner",
    );
  }
  if (existing.ingest.desired || existing.ingest.state !== "metadata_only") {
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      "compatibility deletion is limited to metadata-only resources not desired for ingest",
    );
  }
  const snapshots = await scanSnapshots(layout);
  if ([...snapshots.values()].some((snapshot) => snapshot.resourceId === existing.id)) {
    throw new ResearchResourceStoreError(
      "snapshot-conflict",
      "compatibility deletion cannot remove a resource referenced by a snapshot",
    );
  }
  return existing;
}

async function deleteCompatibilityManifestLocked(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  identities: Map<string, PathIdentity>,
  expectedManifest: ResourceManifestV1,
): Promise<{ deleted: true; manifest: ResourceManifestV1 }> {
  const existing = await assertCompatibilityDeletion(layout, records, expectedManifest);
  const expectedIdentity = identities.get(existing.id);
  if (!expectedIdentity) {
    throw new ResearchResourceStoreError("corrupt", `manifest ${existing.id} identity is missing`);
  }
  await assertStableDirectory(layout.manifests, "manifests");
  const current = await readSafeFileWithIdentity({
    target: manifestFile(layout, existing.id),
    rootRealPath: layout.rootRealPath,
    label: `manifest ${existing.id}`,
    maxBytes: MAX_MANIFEST_RECORD_BYTES,
  });
  if (
    !sameIdentity(current.identity, expectedIdentity) ||
    !Buffer.from(current.bytes).equals(Buffer.from(manifestBytes(existing)))
  ) {
    throw new ResearchResourceStoreError(
      "revision-conflict",
      `manifest ${existing.id} changed before compatibility deletion`,
    );
  }
  await unlink(manifestFile(layout, existing.id));
  await syncDirectory(layout.manifests.path);
  records.delete(existing.id);
  identities.delete(existing.id);
  return { deleted: true, manifest: detachedManifest(existing) };
}

async function replaceCompatibilityManifestLocked(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  identities: Map<string, PathIdentity>,
  input: { expectedManifest: ResourceManifestV1; manifest: ResourceManifestV1 },
): Promise<ResourceManifestV1> {
  const prepared = await validateCompatibilityReplacement(layout, records, input);
  const { existing, manifest, recordBytes } = prepared;
  const expectedIdentity = identities.get(existing.id);
  if (!expectedIdentity) {
    throw new ResearchResourceStoreError("corrupt", `manifest ${existing.id} identity is missing`);
  }
  const publishedIdentity = await publishReplace({
    layout,
    directory: layout.manifests,
    target: manifestFile(layout, manifest.id),
    bytes: recordBytes,
    expectedBytes: manifestBytes(existing),
    label: `manifest ${manifest.id}`,
    maxBytes: MAX_MANIFEST_RECORD_BYTES,
    expectedIdentity,
  });
  records.set(manifest.id, detachedManifest(manifest));
  identities.set(manifest.id, publishedIdentity);
  return detachedManifest(manifest);
}

async function validateCompatibilityReplacement(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  input: { expectedManifest: ResourceManifestV1; manifest: ResourceManifestV1 },
): Promise<{
  existing: ResourceManifestV1;
  manifest: ResourceManifestV1;
  recordBytes: Uint8Array;
}> {
  const existing = await assertCompatibilityDeletion(layout, records, input.expectedManifest);
  const manifest = parseManifest(input.manifest);
  if (manifest.id !== existing.id) {
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      "compatibility replacement cannot change the manifest id",
    );
  }
  assertNextRevision(existing, manifest, existing.revision);
  if (
    !manifest.legacySavedLink ||
    manifest.currentSnapshotId ||
    manifest.ingest.desired ||
    manifest.ingest.state !== "metadata_only"
  ) {
    throw new ResearchResourceStoreError(
      "immutable-conflict",
      "compatibility replacement must remain an unreferenced metadata-only saved link",
    );
  }
  const replacementRecords = new Map(records);
  replacementRecords.delete(existing.id);
  assertUniqueManifest(replacementRecords, manifest);
  await verifyCurrentSnapshot(layout, manifest);
  const recordBytes = manifestBytes(manifest);
  return { existing, manifest, recordBytes };
}

async function preflightCompatibilityMutation(
  layout: StoreLayout,
  records: Map<string, ResourceManifestV1>,
  operations: readonly ManifestCatalogCompatibilityOperation[],
): Promise<void> {
  if (operations.length > MAX_MANIFEST_RECORDS) {
    throw new ResearchResourceStoreError(
      "too-large",
      `compatibility mutation exceeds the ${MAX_MANIFEST_RECORDS} operation limit`,
    );
  }
  const simulated = new Map(
    [...records].map(([id, manifest]) => [id, detachedManifest(manifest)]),
  );
  for (const operation of operations) {
    switch (operation.kind) {
      case "create": {
        const prepared = await validateManifestCreate(layout, simulated, operation.manifest);
        simulated.set(prepared.manifest.id, detachedManifest(prepared.manifest));
        break;
      }
      case "update": {
        const prepared = await validateManifestUpdate(layout, simulated, operation);
        simulated.set(prepared.manifest.id, detachedManifest(prepared.manifest));
        break;
      }
      case "replace": {
        const prepared = await validateCompatibilityReplacement(layout, simulated, operation);
        simulated.set(prepared.manifest.id, detachedManifest(prepared.manifest));
        break;
      }
      case "delete": {
        const existing = await assertCompatibilityDeletion(
          layout,
          simulated,
          operation.expectedManifest,
        );
        simulated.delete(existing.id);
        break;
      }
    }
  }
}

type OperationalCollection<T> = {
  records: Map<string, T>;
  identities: Map<string, PathIdentity>;
};

function operationalBytes(value: unknown, label: string): Uint8Array {
  const bytes = new TextEncoder().encode(`${canonicalJson(value)}\n`);
  if (bytes.byteLength > MAX_OPERATIONAL_RECORD_BYTES) {
    throw new ResearchResourceStoreError("too-large", `${label} exceeds 1 MiB`);
  }
  return bytes;
}

function assertUtcTimestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new ResearchResourceStoreError("invalid-operational-record", `${label} must be a UTC timestamp`);
  }
}

function parseJob(value: unknown): ResourceIngestJobV1 {
  const parsed = parseResourceIngestJobV1(value);
  if (!parsed.ok) {
    throw new ResearchResourceStoreError(
      "invalid-operational-record",
      `${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  assertStoreId(parsed.value.id, "job");
  assertResourceId(parsed.value.resourceId);
  if (parsed.value.attempt > 5) {
    throw new ResearchResourceStoreError("invalid-operational-record", "job attempt exceeds five");
  }
  return parsed.value;
}

function parseFailure(value: unknown): ResourceIngestFailureV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchResourceStoreError("invalid-operational-record", "failure must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "version", "jobId", "resourceId", "resourceRevision", "deletionRevision", "stage",
    "code", "retryable", "occurredAt",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ResearchResourceStoreError("invalid-operational-record", "failure contains unexpected fields");
  }
  if (
    record.version !== 1 || typeof record.retryable !== "boolean" ||
    !Number.isSafeInteger(record.resourceRevision) || (record.resourceRevision as number) < 1 ||
    !Number.isSafeInteger(record.deletionRevision) || (record.deletionRevision as number) < 0 ||
    typeof record.stage !== "string" ||
    !["fetch", "snapshot", "extract", "publish_lexical"].includes(record.stage)
  ) {
    throw new ResearchResourceStoreError("invalid-operational-record", "failure version or retryable is invalid");
  }
  if (typeof record.jobId !== "string" || typeof record.resourceId !== "string") {
    throw new ResearchResourceStoreError("invalid-operational-record", "failure identifiers are invalid");
  }
  assertStoreId(record.jobId, "job");
  assertResourceId(record.resourceId);
  if (typeof record.code !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(record.code)) {
    throw new ResearchResourceStoreError("invalid-operational-record", "failure code is outside the bounded vocabulary shape");
  }
  assertUtcTimestamp(record.occurredAt, "failure occurredAt");
  return record as ResourceIngestFailureV1;
}

function parseFence(value: unknown): ResourceDeletionFenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion fence must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["version", "resourceId", "deletionRevision", "updatedAt"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion fence contains unexpected fields");
  }
  if (
    record.version !== 1 ||
    typeof record.resourceId !== "string" ||
    !Number.isSafeInteger(record.deletionRevision) ||
    (record.deletionRevision as number) < 1
  ) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion fence is invalid");
  }
  assertResourceId(record.resourceId);
  assertUtcTimestamp(record.updatedAt, "deletion fence updatedAt");
  return record as ResourceDeletionFenceV1;
}

function parseJournal(value: unknown): ResourceDeletionJournalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion journal must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "version", "resourceId", "deletionRevision", "expectedManifestRevision",
    "phase", "deletedAt", "snapshotIds", "updatedAt",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion journal contains unexpected fields");
  }
  if (
    record.version !== 1 || typeof record.resourceId !== "string" ||
    !Number.isSafeInteger(record.deletionRevision) || (record.deletionRevision as number) < 1 ||
    !Number.isSafeInteger(record.expectedManifestRevision) || (record.expectedManifestRevision as number) < 1 ||
    typeof record.phase !== "string" ||
    !RESOURCE_DELETION_PHASES.includes(record.phase as ResourceDeletionPhaseV1) ||
    !Array.isArray(record.snapshotIds) || record.snapshotIds.length > MAX_OPERATIONAL_RECORDS
  ) {
    throw new ResearchResourceStoreError("invalid-operational-record", "deletion journal is invalid");
  }
  assertResourceId(record.resourceId);
  const snapshotIds = record.snapshotIds;
  for (const id of snapshotIds) {
    if (typeof id !== "string") throw new ResearchResourceStoreError("invalid-operational-record", "snapshot id is invalid");
    assertSnapshotId(id);
  }
  if (new Set(snapshotIds).size !== snapshotIds.length ||
      snapshotIds.some((id, index) => index > 0 && snapshotIds[index - 1]! >= id)) {
    throw new ResearchResourceStoreError("invalid-operational-record", "journal snapshot ids must be unique and sorted");
  }
  assertUtcTimestamp(record.deletedAt, "deletion journal deletedAt");
  assertUtcTimestamp(record.updatedAt, "deletion journal updatedAt");
  return record as unknown as ResourceDeletionJournalV1;
}

function parseTombstone(value: unknown): ResourceTombstoneV1 {
  const parsed = parseResourceTombstoneV1(value);
  if (!parsed.ok) {
    throw new ResearchResourceStoreError(
      "invalid-operational-record",
      `${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  assertResourceId(parsed.value.resourceId);
  return parsed.value;
}

async function scanOperationalRecords<T>(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  label: string;
  parse: (value: unknown) => T;
  idOf: (value: T) => string;
}): Promise<OperationalCollection<T>> {
  await assertStableLayout(input.layout);
  const names: string[] = [];
  for await (const entry of await opendir(input.directory.path)) {
    if (names.length >= MAX_OPERATIONAL_RECORDS) {
      throw new ResearchResourceStoreError("too-large", `${input.label} exceeds the record scan limit`);
    }
    names.push(entry.name);
  }
  const records = new Map<string, T>();
  const identities = new Map<string, PathIdentity>();
  for (const name of names.sort()) {
    if (/^\.tmp-[0-9]+-[a-f0-9]{24}$/.test(name)) continue;
    if (!name.endsWith(".json")) {
      throw new ResearchResourceStoreError("corrupt", `unexpected ${input.label} entry ${name}`);
    }
    const id = name.slice(0, -5);
    if (!SAFE_STORE_ID.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
      throw new ResearchResourceStoreError("corrupt", `unsafe ${input.label} entry ${name}`);
    }
    const record = await readSafeFileWithIdentity({
      target: path.join(input.directory.path, name),
      rootRealPath: input.layout.rootRealPath,
      label: `${input.label} ${id}`,
      maxBytes: MAX_OPERATIONAL_RECORD_BYTES,
    });
    const parsed = input.parse(parseJson(record.bytes, `${input.label} ${id}`));
    if (input.idOf(parsed) !== id) {
      throw new ResearchResourceStoreError("corrupt", `${input.label} filename and id do not match`);
    }
    if (!Buffer.from(record.bytes).equals(Buffer.from(operationalBytes(parsed, `${input.label} ${id}`)))) {
      throw new ResearchResourceStoreError("corrupt", `${input.label} ${id} is not canonical JSON`);
    }
    records.set(id, parsed);
    identities.set(id, record.identity);
  }
  await assertStableDirectory(input.directory, input.label);
  return { records, identities };
}

async function createOperationalRecord<T>(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  collection: OperationalCollection<T>;
  id: string;
  value: T;
  label: string;
}): Promise<"created" | "existing"> {
  const bytes = operationalBytes(input.value, `${input.label} ${input.id}`);
  const existing = input.collection.records.get(input.id);
  if (existing !== undefined) {
    if (canonicalJson(existing) !== canonicalJson(input.value)) {
      throw new ResearchResourceStoreError("immutable-conflict", `${input.label} ${input.id} already exists`);
    }
    return "existing";
  }
  const result = await publishNoReplace({
    layout: input.layout,
    directory: input.directory,
    target: path.join(input.directory.path, `${input.id}.json`),
    bytes,
    label: `${input.label} ${input.id}`,
    maxBytes: MAX_OPERATIONAL_RECORD_BYTES,
    existingMismatchCode: "immutable-conflict",
  });
  const published = await readSafeFileWithIdentity({
    target: path.join(input.directory.path, `${input.id}.json`),
    rootRealPath: input.layout.rootRealPath,
    label: `${input.label} ${input.id}`,
    maxBytes: MAX_OPERATIONAL_RECORD_BYTES,
  });
  input.collection.records.set(input.id, structuredClone(input.value));
  input.collection.identities.set(input.id, published.identity);
  return result;
}

async function replaceOperationalRecord<T>(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  collection: OperationalCollection<T>;
  id: string;
  expected: T;
  value: T;
  label: string;
}): Promise<void> {
  const current = input.collection.records.get(input.id);
  const identity = input.collection.identities.get(input.id);
  if (current === undefined || !identity || canonicalJson(current) !== canonicalJson(input.expected)) {
    throw new ResearchResourceStoreError("revision-conflict", `${input.label} ${input.id} changed`);
  }
  const published = await publishReplace({
    layout: input.layout,
    directory: input.directory,
    target: path.join(input.directory.path, `${input.id}.json`),
    bytes: operationalBytes(input.value, `${input.label} ${input.id}`),
    expectedBytes: operationalBytes(input.expected, `${input.label} ${input.id}`),
    label: `${input.label} ${input.id}`,
    maxBytes: MAX_OPERATIONAL_RECORD_BYTES,
    expectedIdentity: identity,
  });
  input.collection.records.set(input.id, structuredClone(input.value));
  input.collection.identities.set(input.id, published);
}

async function removeOperationalRecord<T>(input: {
  layout: StoreLayout;
  directory: PathIdentity;
  collection: OperationalCollection<T>;
  id: string;
  expected?: T;
  label: string;
}): Promise<boolean> {
  const current = input.collection.records.get(input.id);
  if (current === undefined) return false;
  const identity = input.collection.identities.get(input.id);
  if (!identity || (input.expected !== undefined && canonicalJson(current) !== canonicalJson(input.expected))) {
    throw new ResearchResourceStoreError("revision-conflict", `${input.label} ${input.id} changed`);
  }
  const disk = await readSafeFileWithIdentity({
    target: path.join(input.directory.path, `${input.id}.json`),
    rootRealPath: input.layout.rootRealPath,
    label: `${input.label} ${input.id}`,
    maxBytes: MAX_OPERATIONAL_RECORD_BYTES,
  });
  if (!sameIdentity(identity, disk.identity) ||
      !Buffer.from(disk.bytes).equals(Buffer.from(operationalBytes(current, `${input.label} ${input.id}`)))) {
    throw new ResearchResourceStoreError("revision-conflict", `${input.label} ${input.id} changed before deletion`);
  }
  await unlink(path.join(input.directory.path, `${input.id}.json`));
  await syncDirectory(input.directory.path);
  input.collection.records.delete(input.id);
  input.collection.identities.delete(input.id);
  return true;
}

const NONTERMINAL_JOB_STATUSES = new Set<ResourceIngestJobV1["status"]>([
  "queued", "claimed", "paused_quota", "retry_wait",
]);

function assertJobTransition(expected: ResourceIngestJobV1, next: ResourceIngestJobV1): void {
  if (
    expected.id !== next.id || expected.resourceId !== next.resourceId ||
    expected.resourceRevision !== next.resourceRevision ||
    expected.deletionRevision !== next.deletionRevision || expected.createdAt !== next.createdAt
  ) {
    throw new ResearchResourceStoreError("immutable-conflict", "job identity and captured revisions cannot change");
  }
  if (Date.parse(next.updatedAt) <= Date.parse(expected.updatedAt)) {
    throw new ResearchResourceStoreError("revision-conflict", "job updatedAt must advance");
  }
  if (!NONTERMINAL_JOB_STATUSES.has(expected.status)) {
    throw new ResearchResourceStoreError("revision-conflict", "terminal jobs cannot transition");
  }
  const allowed: Record<"queued" | "claimed" | "paused_quota" | "retry_wait", Set<ResourceIngestJobV1["status"]>> = {
    queued: new Set(["claimed", "cancelled"]),
    claimed: new Set(["claimed", "queued", "paused_quota", "retry_wait", "completed", "failed", "cancelled"]),
    paused_quota: new Set(["claimed", "cancelled"]),
    retry_wait: new Set(["claimed", "cancelled"]),
  };
  if (!allowed[expected.status as keyof typeof allowed].has(next.status)) {
    throw new ResearchResourceStoreError("revision-conflict", "job status transition is invalid");
  }
  if (next.attempt < expected.attempt || next.attempt > expected.attempt + 1) {
    throw new ResearchResourceStoreError("revision-conflict", "job attempt transition is invalid");
  }
  const stageIndex = RESOURCE_DELETION_PHASES.length + ["fetch", "snapshot", "extract", "publish_lexical"].indexOf(next.stage);
  const expectedStageIndex = RESOURCE_DELETION_PHASES.length + ["fetch", "snapshot", "extract", "publish_lexical"].indexOf(expected.stage);
  if (stageIndex < expectedStageIndex || stageIndex > expectedStageIndex + 1) {
    throw new ResearchResourceStoreError("revision-conflict", "job stage transition is invalid");
  }
  if (next.stage !== expected.stage && !(expected.status === "claimed" && next.status === "claimed")) {
    throw new ResearchResourceStoreError("revision-conflict", "only a claimed job may advance its stage");
  }
  if (next.status === "retry_wait" && next.attempt !== expected.attempt + 1) {
    throw new ResearchResourceStoreError("revision-conflict", "retry_wait must consume exactly one attempt");
  }
  if (next.status === "paused_quota" && next.attempt !== expected.attempt) {
    throw new ResearchResourceStoreError("revision-conflict", "paused_quota cannot consume an attempt");
  }
  if (next.status !== "retry_wait" && next.attempt !== expected.attempt && next.status !== "failed") {
    throw new ResearchResourceStoreError("revision-conflict", "only retry failure may consume an attempt");
  }
  if (next.status === "failed" && next.attempt !== expected.attempt + 1) {
    throw new ResearchResourceStoreError("revision-conflict", "a terminal failure must consume exactly one attempt");
  }
  if (next.status === "completed" && next.stage !== "publish_lexical") {
    throw new ResearchResourceStoreError("revision-conflict", "only lexical publication may complete a job");
  }
  if (next.status === "claimed") {
    if (Date.parse(next.availableAt) > Date.parse(next.updatedAt) ||
        Date.parse(next.lease!.expiresAt) <= Date.parse(next.updatedAt)) {
      throw new ResearchResourceStoreError("revision-conflict", "claimed job must be due with a future lease");
    }
  }
  if (expected.status === "claimed" && next.status === "queued" &&
      Date.parse(expected.lease!.expiresAt) > Date.parse(next.updatedAt)) {
    throw new ResearchResourceStoreError("revision-conflict", "an unexpired lease cannot be requeued");
  }
  if (expected.status === "claimed" && next.status === "claimed" &&
      expected.lease!.token !== next.lease!.token && Date.parse(expected.lease!.expiresAt) > Date.parse(next.updatedAt)) {
    throw new ResearchResourceStoreError("revision-conflict", "an unexpired claimed lease cannot be superseded");
  }
}

function validateSnapshotInput(input: PublishResourceSnapshotInput): {
  snapshot: ResourceSnapshotV1;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
  recordBytes: Uint8Array;
} {
  const normalizedBlob = new Uint8Array(input.normalizedBlob);
  const rawBlob = input.rawBlob === undefined ? undefined : new Uint8Array(input.rawBlob);
  assertBlobSize(normalizedBlob, "normalized blob");
  if (rawBlob !== undefined) assertBlobSize(rawBlob, "raw blob");
  const snapshot = parseSnapshot(input.snapshot);
  if (normalizedBlob.byteLength !== snapshot.normalizedBytes ||
      sha256Digest(normalizedBlob) !== snapshot.normalizedBlobDigest) {
    throw new ResearchResourceStoreError("digest-mismatch", "normalized bytes do not match the snapshot");
  }
  if ((snapshot.rawBlobDigest === undefined) !== (rawBlob === undefined)) {
    throw new ResearchResourceStoreError("invalid-snapshot", "raw blob must be present exactly when rawBlobDigest is present");
  }
  if (snapshot.rawBlobDigest && rawBlob && sha256Digest(rawBlob) !== snapshot.rawBlobDigest) {
    throw new ResearchResourceStoreError("digest-mismatch", "raw bytes do not match the snapshot digest");
  }
  const recordBytes = new TextEncoder().encode(`${canonicalJson(snapshot)}\n`);
  if (recordBytes.byteLength > MAX_SNAPSHOT_RECORD_BYTES) {
    throw new ResearchResourceStoreError("too-large", "snapshot record exceeds 1 MiB");
  }
  return { snapshot, normalizedBlob, ...(rawBlob ? { rawBlob } : {}), recordBytes };
}

async function publishSnapshotLocked(
  layout: StoreLayout,
  snapshots: Map<string, ResourceSnapshotV1>,
  input: PublishResourceSnapshotInput,
): Promise<{ created: boolean; snapshot: ResourceSnapshotV1 }> {
  const prepared = validateSnapshotInput(input);
  const existing = snapshots.get(prepared.snapshot.id);
  if (existing && canonicalJson(existing) !== canonicalJson(prepared.snapshot)) {
    throw new ResearchResourceStoreError("immutable-conflict", `snapshot ${prepared.snapshot.id} already exists with different content`);
  }
  await publishBlob(layout, prepared.snapshot.normalizedBlobDigest, prepared.normalizedBlob);
  if (prepared.snapshot.rawBlobDigest && prepared.rawBlob) {
    await publishBlob(layout, prepared.snapshot.rawBlobDigest, prepared.rawBlob);
  }
  const result = await publishNoReplace({
    layout,
    directory: layout.snapshots,
    target: snapshotFile(layout, prepared.snapshot.id),
    bytes: prepared.recordBytes,
    label: `snapshot ${prepared.snapshot.id}`,
    maxBytes: MAX_SNAPSHOT_RECORD_BYTES,
    existingMismatchCode: "immutable-conflict",
  });
  snapshots.set(prepared.snapshot.id, structuredClone(prepared.snapshot));
  return { created: result === "created", snapshot: structuredClone(prepared.snapshot) };
}

async function collectUnreferencedBlobs(
  layout: StoreLayout,
  snapshots: Map<string, ResourceSnapshotV1>,
): Promise<string[]> {
  const referenced = new Set<string>();
  for (const snapshot of snapshots.values()) {
    referenced.add(snapshot.normalizedBlobDigest);
    if (snapshot.rawBlobDigest) referenced.add(snapshot.rawBlobDigest);
  }
  const shardNames: string[] = [];
  for await (const entry of await opendir(layout.sha256.path)) {
    shardNames.push(entry.name);
    if (shardNames.length > 256) {
      throw new ResearchResourceStoreError("too-large", "blob store exceeds the shard scan limit");
    }
  }
  const candidates: Array<{ digest: string; shard: PathIdentity; identity: PathIdentity }> = [];
  let scanned = 0;
  for (const shardName of shardNames.sort()) {
    if (!/^[a-f0-9]{2}$/.test(shardName)) {
      throw new ResearchResourceStoreError("corrupt", `unexpected blob shard ${shardName}`);
    }
    const shard = await ensureRealDirectory(
      path.join(layout.sha256.path, shardName),
      layout.rootRealPath,
      `blob shard ${shardName}`,
    );
    const names: string[] = [];
    for await (const entry of await opendir(shard.path)) {
      if (++scanned > MAX_OPERATIONAL_RECORDS) {
        throw new ResearchResourceStoreError("too-large", "blob store exceeds the record scan limit");
      }
      names.push(entry.name);
    }
    for (const digest of names.sort()) {
      if (/^\.tmp-[0-9]+-[a-f0-9]{24}$/.test(digest)) continue;
      if (!/^[a-f0-9]{64}$/.test(digest) || !digest.startsWith(shardName)) {
        throw new ResearchResourceStoreError("corrupt", `unexpected blob entry ${digest}`);
      }
      const record = await readSafeFileWithIdentity({
        target: path.join(shard.path, digest),
        rootRealPath: layout.rootRealPath,
        label: `blob ${digest}`,
        maxBytes: MAX_RESEARCH_RESOURCE_BLOB_BYTES,
      });
      if (sha256Digest(record.bytes) !== digest) {
        throw new ResearchResourceStoreError("digest-mismatch", `blob ${digest} is corrupt`);
      }
      if (!referenced.has(digest)) candidates.push({ digest, shard, identity: record.identity });
    }
  }
  const removed: string[] = [];
  for (const candidate of candidates) {
    await assertStableDirectory(candidate.shard, `blob shard ${candidate.digest.slice(0, 2)}`);
    const target = path.join(candidate.shard.path, candidate.digest);
    const current = await pathMetadata(target, `blob ${candidate.digest} is missing`);
    if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1 ||
        !sameIdentity(candidate.identity, current)) {
      throw new ResearchResourceStoreError("revision-conflict", `blob ${candidate.digest} changed before collection`);
    }
    await unlink(target);
    await syncDirectory(candidate.shard.path);
    removed.push(candidate.digest);
  }
  return removed;
}

async function deleteSnapshotLocked(
  layout: StoreLayout,
  manifests: Map<string, ResourceManifestV1>,
  snapshots: Map<string, ResourceSnapshotV1>,
  snapshotId: string,
): Promise<{ deleted: boolean; removedBlobDigests: string[] }> {
  assertSnapshotId(snapshotId);
  if ([...manifests.values()].some((manifest) => manifest.currentSnapshotId === snapshotId)) {
    throw new ResearchResourceStoreError("snapshot-conflict", `snapshot ${snapshotId} is current for a resource manifest`);
  }
  const target = snapshots.get(snapshotId);
  if (!target) {
    return { deleted: false, removedBlobDigests: await collectUnreferencedBlobs(layout, snapshots) };
  }
  const current = await readSnapshotRecord(layout, snapshotId, false);
  if (!current || canonicalJson(current) !== canonicalJson(target)) {
    throw new ResearchResourceStoreError("corrupt", `snapshot ${snapshotId} changed during deletion accounting`);
  }
  // Validate the complete blob namespace before removing authoritative
  // snapshot metadata. A failed path/identity check therefore leaves the
  // snapshot readable, while a later crash after unlink is replayable GC.
  await collectUnreferencedBlobs(layout, snapshots);
  await assertStableDirectory(layout.snapshots, "snapshots");
  await unlink(snapshotFile(layout, snapshotId));
  await syncDirectory(layout.snapshots.path);
  snapshots.delete(snapshotId);
  const removedBlobDigests = await collectUnreferencedBlobs(layout, snapshots);
  return { deleted: true, removedBlobDigests };
}

async function readSnapshotLocked(
  layout: StoreLayout,
  snapshotId: string,
): Promise<VerifiedResourceSnapshot> {
  assertSnapshotId(snapshotId);
  const snapshot = await readSnapshotRecord(layout, snapshotId, false);
  if (!snapshot) throw new ResearchResourceStoreError("missing", `snapshot ${snapshotId} is missing`);
  const normalizedBlob = await readBlob(layout, snapshot.normalizedBlobDigest);
  if (normalizedBlob.byteLength !== snapshot.normalizedBytes) {
    throw new ResearchResourceStoreError("digest-mismatch", `snapshot ${snapshotId} normalized byte length is corrupt`);
  }
  const rawBlob = snapshot.rawBlobDigest ? await readBlob(layout, snapshot.rawBlobDigest) : undefined;
  return { snapshot, normalizedBlob, ...(rawBlob === undefined ? {} : { rawBlob }) };
}

export async function withResearchResourceMaintenanceLock<T>(
  rootInput: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!path.isAbsolute(rootInput)) {
    throw new ResearchResourceStoreError("unsafe-path", "Research Resource store root must be absolute");
  }
  const root = path.resolve(rootInput);
  const layout = await ensureLayout(root);
  return withProcessIntentLock({
    intentsDirectory: layout.intents.path,
    label: "Research Resource store",
  }, async () => {
    await assertStableLayout(layout);
    return operation();
  });
}

async function purgeRestoreDisposableDirectory(
  layout: StoreLayout,
  directory: PathIdentity,
  label: string,
): Promise<number> {
  await assertStableLayout(layout);
  await assertStableDirectory(directory, label);
  const names: string[] = [];
  for await (const entry of await opendir(directory.path)) {
    if (names.length >= MAX_OPERATIONAL_RECORDS) {
      throw new ResearchResourceStoreError("too-large", `${label} exceeds the restore purge limit`);
    }
    names.push(entry.name);
  }

  let removed = 0;
  for (const name of names.sort()) {
    await assertStableLayout(layout);
    await assertStableDirectory(directory, label);
    const target = path.join(directory.path, name);
    const before = await pathMetadata(target, `${label} restore residue is missing`);
    if (before.isSymbolicLink()) {
      throw new ResearchResourceStoreError("symlink", `${label} restore residue is a symlink`);
    }
    if (!before.isFile()) {
      throw new ResearchResourceStoreError("unsafe-path", `${label} restore residue is not a regular file`);
    }
    if (before.nlink !== 1) {
      throw new ResearchResourceStoreError("unsafe-path", `${label} restore residue must have exactly one link`);
    }
    await assertSafeOwnership(target, before, `Research Resource ${label} restore residue`);
    let handle: FileHandle;
    try {
      handle = await open(target, readFlags());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new ResearchResourceStoreError("symlink", `${label} restore residue is a symlink`);
      }
      throw error;
    }
    try {
      const opened = await handle.stat();
      const after = await pathMetadata(target, `${label} restore residue is missing`);
      if (
        !opened.isFile()
        || opened.nlink !== 1
        || after.isSymbolicLink()
        || !after.isFile()
        || after.nlink !== 1
        || !sameIdentity(before, opened)
        || !sameIdentity(opened, after)
      ) {
        throw new ResearchResourceStoreError("symlink", `${label} restore residue identity changed`);
      }
      const resolved = await realpath(target);
      if (!isContained(layout.rootRealPath, resolved)) {
        throw new ResearchResourceStoreError("symlink", `${label} restore residue escapes the store root`);
      }
    } finally {
      await handle.close();
    }
    await assertStableDirectory(directory, label);
    const current = await pathMetadata(target, `${label} restore residue is missing`);
    if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1 || !sameIdentity(before, current)) {
      throw new ResearchResourceStoreError("symlink", `${label} restore residue changed before deletion`);
    }
    await unlink(target);
    await syncDirectory(directory.path);
    removed += 1;
  }
  await assertStableLayout(layout);
  return removed;
}

/**
 * Restore owns jobs, failures, and deletion journals as disposable state. This
 * purge deliberately does not parse their bytes, but still refuses links,
 * foreign ownership, directory swaps, and escapes before unlinking anything.
 */
export async function purgeResearchResourceRestoreDisposableState(
  rootInput: string,
): Promise<{ jobs: number; failures: number; deletions: number }> {
  if (!path.isAbsolute(rootInput)) {
    throw new ResearchResourceStoreError("unsafe-path", "Research Resource store root must be absolute");
  }
  const root = path.resolve(rootInput);
  return withResearchResourceMaintenanceLock(root, async () => {
    const layout = await ensureLayout(root);
    await assertStableLayout(layout);
    return {
      jobs: await purgeRestoreDisposableDirectory(layout, layout.jobs, "jobs"),
      failures: await purgeRestoreDisposableDirectory(layout, layout.failures, "failures"),
      deletions: await purgeRestoreDisposableDirectory(layout, layout.deletions, "deletions"),
    };
  });
}

export function createResearchResourceStore(
  options: { root?: string } = {},
): ResearchResourceStore {
  if (options.root !== undefined && !path.isAbsolute(options.root)) {
    throw new ResearchResourceStoreError("unsafe-path", "Research Resource store root must be absolute");
  }
  const root = path.resolve(
    options.root ?? path.join(/* turbopackIgnore: true */ caveHome(), "research-resources"),
  );

  const withMutationLock = async <T>(operation: (layout: StoreLayout) => Promise<T>): Promise<T> => {
    const layout = await ensureLayout(root);
    return withProcessIntentLock({
      intentsDirectory: layout.intents.path,
      label: "Research Resource store",
    }, async () => {
      await assertStableLayout(layout);
      return await operation(layout);
    });
  };

  const createCatalogTransaction = (
    layout: StoreLayout,
    records: Map<string, ResourceManifestV1>,
    identities: Map<string, PathIdentity>,
  ): ManifestCatalogTransaction => ({
      listManifests: () => sortedDetachedManifests(records),
      preflightCompatibilityMutation: (operations) =>
        preflightCompatibilityMutation(layout, records, operations),
      createManifest: (manifest) => createManifestLocked(layout, records, identities, manifest),
      updateManifest: (input) => updateManifestLocked(layout, records, identities, input),
      replaceCompatibilityManifest: (input) =>
        replaceCompatibilityManifestLocked(layout, records, identities, input),
      deleteCompatibilityManifest: (expectedManifest) =>
        deleteCompatibilityManifestLocked(layout, records, identities, expectedManifest),
    });

  const withManifestCatalogTransaction = async <T>(
    operation: (transaction: ManifestCatalogTransaction) => Promise<T>,
  ): Promise<T> => withMutationLock(async (layout) => {
    const { records, identities } = await scanManifests(layout);
    return operation(createCatalogTransaction(layout, records, identities));
  });

  const withOperationalTransaction = async <T>(
    operation: (transaction: ResourceOperationalTransaction) => Promise<T>,
  ): Promise<T> => withMutationLock(async (layout) => {
    const manifests = await scanManifests(layout);
    const snapshots = await scanSnapshots(layout);
    const jobs = await scanOperationalRecords({
      layout, directory: layout.jobs, label: "job", parse: parseJob, idOf: (job) => job.id,
    });
    const failures = await scanOperationalRecords({
      layout, directory: layout.failures, label: "failure", parse: parseFailure,
      idOf: (failure) => failure.jobId,
    });
    const fences = await scanOperationalRecords({
      layout, directory: layout.fences, label: "deletion fence", parse: parseFence,
      idOf: (fence) => fence.resourceId,
    });
    const deletions = await scanOperationalRecords({
      layout, directory: layout.deletions, label: "deletion journal", parse: parseJournal,
      idOf: (journal) => journal.resourceId,
    });
    const tombstones = await scanOperationalRecords({
      layout, directory: layout.tombstones, label: "tombstone", parse: parseTombstone,
      idOf: (tombstone) => tombstone.resourceId,
    });
    // The journal is durably published before its fence while the process lock
    // is held. If the process dies between those two writes, the next locked
    // transaction repairs the monotonic fence before exposing any API.
    for (const journal of deletions.records.values()) {
      const fence = fences.records.get(journal.resourceId);
      if (fence?.deletionRevision === journal.deletionRevision) continue;
      if ((fence?.deletionRevision ?? 0) !== journal.deletionRevision - 1) {
        throw new ResearchResourceStoreError("corrupt", "deletion journal and fence revisions diverge");
      }
      const repaired: ResourceDeletionFenceV1 = {
        version: 1,
        resourceId: journal.resourceId,
        deletionRevision: journal.deletionRevision,
        updatedAt: journal.deletedAt,
      };
      if (fence) {
        await replaceOperationalRecord({
          layout, directory: layout.fences, collection: fences, id: journal.resourceId,
          expected: fence, value: repaired, label: "deletion fence",
        });
      } else {
        await createOperationalRecord({
          layout, directory: layout.fences, collection: fences, id: journal.resourceId,
          value: repaired, label: "deletion fence",
        });
      }
    }
    const catalog = createCatalogTransaction(layout, manifests.records, manifests.identities);
    const sorted = <V>(records: Map<string, V>): V[] =>
      [...records.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([, value]) => structuredClone(value));
    const currentDeletionRevision = (resourceId: string): number =>
      fences.records.get(resourceId)?.deletionRevision ?? 0;
    const assertCurrentJob = (job: ResourceIngestJobV1): ResourceIngestJobV1 => {
      const current = jobs.records.get(job.id);
      if (!current || canonicalJson(current) !== canonicalJson(job)) {
        throw new ResearchResourceStoreError("revision-conflict", `job ${job.id} changed`);
      }
      return current;
    };
    const assertCurrentResource = (job: ResourceIngestJobV1): ResourceManifestV1 => {
      const manifest = manifests.records.get(job.resourceId);
      if (!manifest || manifest.revision !== job.resourceRevision || manifest.ingest.state === "deleting") {
        throw new ResearchResourceStoreError("revision-conflict", "job manifest revision is stale");
      }
      if (currentDeletionRevision(job.resourceId) !== job.deletionRevision) {
        throw new ResearchResourceStoreError("revision-conflict", "job deletion fence is stale");
      }
      return manifest;
    };
    const assertPublicationFenceLocked = (input: {
      expectedJob: ResourceIngestJobV1;
      leaseToken: string;
      resourceId: string;
      resourceRevision: number;
      deletionRevision: number;
      now: string;
    }): ResourceIngestJobV1 => {
      assertResourceId(input.resourceId);
      assertUtcTimestamp(input.now, "publication fence now");
      if (input.expectedJob.resourceId !== input.resourceId ||
          input.expectedJob.resourceRevision !== input.resourceRevision ||
          input.expectedJob.deletionRevision !== input.deletionRevision) {
        throw new ResearchResourceStoreError("revision-conflict", "publication expectation does not match the job");
      }
      const job = assertCurrentJob(parseJob(input.expectedJob));
      if (job.status !== "claimed" || job.lease?.token !== input.leaseToken) {
        throw new ResearchResourceStoreError("revision-conflict", "publication lease is stale");
      }
      if (Date.parse(job.lease.expiresAt) <= Date.parse(input.now)) {
        throw new ResearchResourceStoreError("revision-conflict", "publication lease expired");
      }
      assertCurrentResource(job);
      return job;
    };
    const transaction: ResourceOperationalTransaction = {
      ...catalog,
      listSnapshots(resourceId) {
        if (resourceId !== undefined) assertResourceId(resourceId);
        return [...snapshots.values()]
          .filter((snapshot) => resourceId === undefined || snapshot.resourceId === resourceId)
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((snapshot) => structuredClone(snapshot));
      },
      readSnapshot: (snapshotId) => readSnapshotLocked(layout, snapshotId),
      publishSnapshot: (input) => publishSnapshotLocked(layout, snapshots, input),
      deleteSnapshot: (snapshotId) =>
        deleteSnapshotLocked(layout, manifests.records, snapshots, snapshotId),
      listJobs: () => sorted(jobs.records),
      readJob(jobId) {
        assertStoreId(jobId, "job");
        const job = jobs.records.get(jobId);
        return job ? structuredClone(job) : null;
      },
      async createJob(inputJob) {
        const job = parseJob(inputJob);
        if (job.status !== "queued" || job.attempt !== 0 || job.lease !== undefined) {
          throw new ResearchResourceStoreError("invalid-operational-record", "new jobs must be unleased queued jobs at attempt zero");
        }
        assertCurrentResource(job);
        const duplicate = [...jobs.records.values()].find((candidate) =>
          NONTERMINAL_JOB_STATUSES.has(candidate.status) &&
          candidate.resourceId === job.resourceId &&
          candidate.resourceRevision === job.resourceRevision &&
          candidate.deletionRevision === job.deletionRevision);
        if (duplicate && duplicate.id !== job.id) {
          throw new ResearchResourceStoreError("immutable-conflict", "a nonterminal job already owns this resource revision");
        }
        const result = await createOperationalRecord({
          layout, directory: layout.jobs, collection: jobs, id: job.id, value: job, label: "job",
        });
        return { created: result === "created", job: structuredClone(job) };
      },
      async replaceJob(inputExpected, inputJob) {
        const expected = parseJob(inputExpected);
        const job = parseJob(inputJob);
        assertCurrentJob(expected);
        assertJobTransition(expected, job);
        if (job.status !== "cancelled" && job.status !== "completed" && job.status !== "failed") {
          assertCurrentResource(job);
        } else if (job.status === "completed") {
          const manifest = manifests.records.get(job.resourceId);
          const currentSnapshot = manifest?.currentSnapshotId
            ? snapshots.get(manifest.currentSnapshotId)
            : undefined;
          if (!manifest || manifest.revision !== job.resourceRevision + 1 ||
              manifest.ingest.state !== "ready" || !currentSnapshot ||
              currentSnapshot.resourceId !== job.resourceId ||
              currentSnapshot.resourceRevision !== manifest.revision ||
              currentDeletionRevision(job.resourceId) !== job.deletionRevision) {
            throw new ResearchResourceStoreError("revision-conflict", "completed job does not match the ready publication");
          }
        } else if (job.status === "failed") {
          const manifest = manifests.records.get(job.resourceId);
          const failure = failures.records.get(job.id);
          if (!manifest || manifest.revision !== job.resourceRevision + 1 ||
              manifest.ingest.state !== "failed" || manifest.ingest.retryable !== false ||
              !failure || failure.code !== manifest.ingest.lastFailureCode || failure.retryable ||
              failure.resourceRevision !== job.resourceRevision ||
              failure.deletionRevision !== job.deletionRevision ||
              currentDeletionRevision(job.resourceId) !== job.deletionRevision) {
            throw new ResearchResourceStoreError("revision-conflict", "failed job does not match its durable failure publication");
          }
        }
        await replaceOperationalRecord({
          layout, directory: layout.jobs, collection: jobs, id: job.id,
          expected, value: job, label: "job",
        });
        return structuredClone(job);
      },
      listFailures: () => sorted(failures.records),
      readFailure(jobId) {
        assertStoreId(jobId, "job");
        const failure = failures.records.get(jobId);
        return failure ? structuredClone(failure) : null;
      },
      async writeFailure(inputFailure) {
        const failure = parseFailure(inputFailure);
        const job = jobs.records.get(failure.jobId);
        if (!job || job.resourceId !== failure.resourceId ||
            job.resourceRevision !== failure.resourceRevision ||
            job.deletionRevision !== failure.deletionRevision || job.stage !== failure.stage) {
          throw new ResearchResourceStoreError("revision-conflict", "failure does not identify its exact job stage");
        }
        const existing = failures.records.get(failure.jobId);
        if (existing) {
          await replaceOperationalRecord({
            layout, directory: layout.failures, collection: failures, id: failure.jobId,
            expected: existing, value: failure, label: "failure",
          });
        } else {
          await createOperationalRecord({
            layout, directory: layout.failures, collection: failures, id: failure.jobId,
            value: failure, label: "failure",
          });
        }
        return structuredClone(failure);
      },
      deleteFailure: (jobId) => {
        assertStoreId(jobId, "job");
        return removeOperationalRecord({
          layout, directory: layout.failures, collection: failures, id: jobId, label: "failure",
        });
      },
      listDeletionFences: () => sorted(fences.records),
      readDeletionFence(resourceId) {
        assertResourceId(resourceId);
        const fence = fences.records.get(resourceId);
        return fence ? structuredClone(fence) : null;
      },
      async repairDeletionFenceFromTombstone(resourceId) {
        assertResourceId(resourceId);
        const tombstone = tombstones.records.get(resourceId);
        if (!tombstone) return false;
        const existing = fences.records.get(resourceId);
        if (existing && existing.deletionRevision >= tombstone.deletionRevision) return false;
        const priorTime = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
        const tombstoneTime = Date.parse(tombstone.deletedAt);
        const repaired: ResourceDeletionFenceV1 = parseFence({
          version: 1,
          resourceId,
          deletionRevision: tombstone.deletionRevision,
          updatedAt: new Date(Math.max(tombstoneTime, priorTime + 1)).toISOString(),
        });
        if (existing) {
          await replaceOperationalRecord({
            layout, directory: layout.fences, collection: fences, id: resourceId,
            expected: existing, value: repaired, label: "deletion fence",
          });
        } else {
          await createOperationalRecord({
            layout, directory: layout.fences, collection: fences, id: resourceId,
            value: repaired, label: "deletion fence",
          });
        }
        return true;
      },
      async resetRestoreOperationalState() {
        const removed = { jobs: 0, failures: 0, deletions: 0 };
        for (const [id, value] of [...jobs.records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          if (await removeOperationalRecord({
            layout, directory: layout.jobs, collection: jobs, id,
            expected: value, label: "job",
          })) removed.jobs += 1;
        }
        for (const [id, value] of [...failures.records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          if (await removeOperationalRecord({
            layout, directory: layout.failures, collection: failures, id,
            expected: value, label: "failure",
          })) removed.failures += 1;
        }
        for (const [id, value] of [...deletions.records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          if (await removeOperationalRecord({
            layout, directory: layout.deletions, collection: deletions, id,
            expected: value, label: "deletion journal",
          })) removed.deletions += 1;
        }
        return removed;
      },
      async repairTombstonedDeletionJournal(inputManifest) {
        const manifest = parseManifest(inputManifest);
        if (manifest.ingest.state !== "deleting" || manifest.currentSnapshotId !== undefined) {
          throw new ResearchResourceStoreError(
            "revision-conflict",
            "tombstoned deletion repair requires a deleting manifest without a current snapshot",
          );
        }
        const current = manifests.records.get(manifest.id);
        if (!current || canonicalJson(current) !== canonicalJson(manifest)) {
          throw new ResearchResourceStoreError("revision-conflict", "deleting manifest changed before repair");
        }
        if (deletions.records.has(manifest.id)) return false;
        const tombstone = tombstones.records.get(manifest.id);
        const fence = fences.records.get(manifest.id);
        if (!tombstone || !fence || fence.deletionRevision !== tombstone.deletionRevision) {
          throw new ResearchResourceStoreError("revision-conflict", "tombstoned deletion authority is incomplete");
        }
        const journal: ResourceDeletionJournalV1 = parseJournal({
          version: 1,
          resourceId: manifest.id,
          deletionRevision: tombstone.deletionRevision,
          expectedManifestRevision: Math.max(1, manifest.revision - 1),
          phase: "tombstoned",
          deletedAt: tombstone.deletedAt,
          snapshotIds: [...snapshots.values()]
            .filter((snapshot) => snapshot.resourceId === manifest.id)
            .map((snapshot) => snapshot.id).sort(),
          updatedAt: tombstone.deletedAt,
        });
        await createOperationalRecord({
          layout, directory: layout.deletions, collection: deletions, id: manifest.id,
          value: journal, label: "deletion journal",
        });
        return true;
      },
      async beginDeletion(input) {
        const expected = parseManifest(input.expectedManifest);
        assertUtcTimestamp(input.deletedAt, "deletion deletedAt");
        const current = manifests.records.get(expected.id);
        if (!current || canonicalJson(current) !== canonicalJson(expected)) {
          throw new ResearchResourceStoreError("revision-conflict", "manifest changed before deletion fencing");
        }
        if (deletions.records.has(expected.id)) {
          throw new ResearchResourceStoreError("revision-conflict", "a deletion journal already exists");
        }
        const actualSnapshotIds = [...snapshots.values()]
          .filter((snapshot) => snapshot.resourceId === expected.id)
          .map((snapshot) => snapshot.id).sort();
        const snapshotIds = [...input.snapshotIds];
        for (const id of snapshotIds) assertSnapshotId(id);
        if (canonicalJson(snapshotIds) !== canonicalJson(actualSnapshotIds)) {
          throw new ResearchResourceStoreError("snapshot-conflict", "deletion must capture every resource snapshot in sorted order");
        }
        const existingFence = fences.records.get(expected.id);
        const nextFence: ResourceDeletionFenceV1 = {
          version: 1,
          resourceId: expected.id,
          deletionRevision: (existingFence?.deletionRevision ?? 0) + 1,
          updatedAt: input.deletedAt,
        };
        if (existingFence && Date.parse(nextFence.updatedAt) <= Date.parse(existingFence.updatedAt)) {
          throw new ResearchResourceStoreError("revision-conflict", "deletion fence updatedAt must advance");
        }
        const journal: ResourceDeletionJournalV1 = {
          version: 1,
          resourceId: expected.id,
          deletionRevision: nextFence.deletionRevision,
          expectedManifestRevision: expected.revision,
          phase: "fenced",
          deletedAt: input.deletedAt,
          snapshotIds,
          updatedAt: input.deletedAt,
        };
        parseJournal(journal);
        await createOperationalRecord({
          layout, directory: layout.deletions, collection: deletions, id: expected.id,
          value: journal, label: "deletion journal",
        });
        if (existingFence) {
          await replaceOperationalRecord({
            layout, directory: layout.fences, collection: fences, id: expected.id,
            expected: existingFence, value: nextFence, label: "deletion fence",
          });
        } else {
          await createOperationalRecord({
            layout, directory: layout.fences, collection: fences, id: expected.id,
            value: nextFence, label: "deletion fence",
          });
        }
        return structuredClone(journal);
      },
      listDeletionJournals: () => sorted(deletions.records),
      readDeletionJournal(resourceId) {
        assertResourceId(resourceId);
        const journal = deletions.records.get(resourceId);
        return journal ? structuredClone(journal) : null;
      },
      async advanceDeletionJournal(inputExpected, inputJournal) {
        const expected = parseJournal(inputExpected);
        const journal = parseJournal(inputJournal);
        const expectedPhase = RESOURCE_DELETION_PHASES.indexOf(expected.phase);
        if (
          expected.resourceId !== journal.resourceId ||
          expected.deletionRevision !== journal.deletionRevision ||
          expected.expectedManifestRevision !== journal.expectedManifestRevision ||
          expected.deletedAt !== journal.deletedAt ||
          canonicalJson(expected.snapshotIds) !== canonicalJson(journal.snapshotIds) ||
          RESOURCE_DELETION_PHASES.indexOf(journal.phase) !== expectedPhase + 1 ||
          Date.parse(journal.updatedAt) <= Date.parse(expected.updatedAt)
        ) {
          throw new ResearchResourceStoreError("revision-conflict", "deletion journal must advance exactly one phase");
        }
        const fence = fences.records.get(journal.resourceId);
        if (!fence || fence.deletionRevision !== journal.deletionRevision) {
          throw new ResearchResourceStoreError("revision-conflict", "deletion journal fence is stale");
        }
        await replaceOperationalRecord({
          layout, directory: layout.deletions, collection: deletions, id: journal.resourceId,
          expected, value: journal, label: "deletion journal",
        });
        return structuredClone(journal);
      },
      async removeDeletionJournal(inputExpected) {
        const expected = parseJournal(inputExpected);
        if (expected.phase !== "projection_verified") {
          throw new ResearchResourceStoreError("revision-conflict", "only a projection-verified journal may be removed");
        }
        await removeOperationalRecord({
          layout, directory: layout.deletions, collection: deletions, id: expected.resourceId,
          expected, label: "deletion journal",
        });
      },
      listTombstones: () => sorted(tombstones.records),
      readTombstone(resourceId) {
        assertResourceId(resourceId);
        const tombstone = tombstones.records.get(resourceId);
        return tombstone ? structuredClone(tombstone) : null;
      },
      async publishTombstone(inputTombstone) {
        const tombstone = parseTombstone(inputTombstone);
        const fence = fences.records.get(tombstone.resourceId);
        const journal = deletions.records.get(tombstone.resourceId);
        if (!fence || fence.deletionRevision !== tombstone.deletionRevision ||
            !journal || journal.deletionRevision !== tombstone.deletionRevision) {
          throw new ResearchResourceStoreError("revision-conflict", "tombstone deletion fence is stale");
        }
        const existing = tombstones.records.get(tombstone.resourceId);
        if (existing && canonicalJson(existing) !== canonicalJson(tombstone)) {
          if (tombstone.deletionRevision <= existing.deletionRevision ||
              Date.parse(tombstone.deletedAt) <= Date.parse(existing.deletedAt)) {
            throw new ResearchResourceStoreError("revision-conflict", "tombstone revisions only advance");
          }
          await replaceOperationalRecord({
            layout, directory: layout.tombstones, collection: tombstones,
            id: tombstone.resourceId, expected: existing, value: tombstone, label: "tombstone",
          });
          return { created: false, tombstone: structuredClone(tombstone) };
        }
        const result = await createOperationalRecord({
          layout, directory: layout.tombstones, collection: tombstones,
          id: tombstone.resourceId, value: tombstone, label: "tombstone",
        });
        return { created: result === "created", tombstone: structuredClone(tombstone) };
      },
      assertPublicationFence(input) {
        assertPublicationFenceLocked(input);
      },
      async commitReadyManifest(input) {
        const expectedJob = parseJob(input.expectedJob);
        if (expectedJob.stage !== "publish_lexical" || input.id !== expectedJob.resourceId ||
            input.expectedRevision !== expectedJob.resourceRevision) {
          throw new ResearchResourceStoreError("revision-conflict", "ready commit does not match the lexical job stage");
        }
        const prepared = await validateManifestUpdate(layout, manifests.records, {
          id: input.id,
          expectedRevision: input.expectedRevision,
          manifest: input.manifest,
        });
        if (prepared.manifest.ingest.state !== "ready" ||
            !prepared.manifest.currentSnapshotId) {
          throw new ResearchResourceStoreError("invalid-manifest", "ready commit requires a current snapshot");
        }
        assertPublicationFenceLocked({
          expectedJob,
          leaseToken: input.leaseToken,
          resourceId: expectedJob.resourceId,
          resourceRevision: expectedJob.resourceRevision,
          deletionRevision: expectedJob.deletionRevision,
          now: input.now,
        });
        return publishPreparedManifestUpdate(
          layout,
          manifests.records,
          manifests.identities,
          prepared,
        );
      },
      async deleteDeletingManifest(inputExpected) {
        const expected = parseManifest(inputExpected);
        const current = manifests.records.get(expected.id);
        const identity = manifests.identities.get(expected.id);
        if (!current || !identity || canonicalJson(current) !== canonicalJson(expected)) {
          throw new ResearchResourceStoreError("revision-conflict", "deleting manifest changed");
        }
        if (current.ingest.state !== "deleting" || current.currentSnapshotId) {
          throw new ResearchResourceStoreError("immutable-conflict", "exact manifest deletion requires deleting state without a current snapshot");
        }
        if ([...snapshots.values()].some((snapshot) => snapshot.resourceId === current.id)) {
          throw new ResearchResourceStoreError("snapshot-conflict", "resource snapshots remain");
        }
        const disk = await readSafeFileWithIdentity({
          target: manifestFile(layout, current.id), rootRealPath: layout.rootRealPath,
          label: `manifest ${current.id}`, maxBytes: MAX_MANIFEST_RECORD_BYTES,
        });
        if (!sameIdentity(identity, disk.identity) ||
            !Buffer.from(disk.bytes).equals(Buffer.from(manifestBytes(current)))) {
          throw new ResearchResourceStoreError("revision-conflict", "deleting manifest changed before removal");
        }
        await unlink(manifestFile(layout, current.id));
        await syncDirectory(layout.manifests.path);
        manifests.records.delete(current.id);
        manifests.identities.delete(current.id);
        return structuredClone(current);
      },
    };
    return operation(transaction);
  });

  return {
    withManifestCatalogTransaction,
    withOperationalTransaction,

    async createManifest(inputManifest) {
      const manifest = parseManifest(inputManifest);
      if (manifest.revision !== 1) {
        throw new ResearchResourceStoreError(
          "revision-conflict",
          "new manifests must start at revision 1",
        );
      }
      manifestBytes(manifest);
      return withManifestCatalogTransaction((transaction) =>
        transaction.createManifest(manifest));
    },

    async readManifest(resourceId) {
      assertResourceId(resourceId);
      return withMutationLock((layout) => readManifestRecord(layout, resourceId, true));
    },

    async listManifests() {
      return withManifestCatalogTransaction(async (transaction) => transaction.listManifests());
    },

    async updateManifest(input) {
      assertResourceId(input.id);
      parseExpectedRevision(input.expectedRevision);
      const manifest = parseManifest(input.manifest);
      if (manifest.id !== input.id) {
        throw new ResearchResourceStoreError("immutable-conflict", "manifest id cannot change");
      }
      if (manifest.revision !== input.expectedRevision + 1) {
        throw new ResearchResourceStoreError(
          "revision-conflict",
          "next manifest revision must increment expectedRevision exactly once",
        );
      }
      manifestBytes(manifest);
      return withManifestCatalogTransaction((transaction) =>
        transaction.updateManifest({ ...input, manifest }));
    },

    async publishSnapshot(input) {
      const normalizedBlob = new Uint8Array(input.normalizedBlob);
      const rawBlob = input.rawBlob === undefined ? undefined : new Uint8Array(input.rawBlob);
      assertBlobSize(normalizedBlob, "normalized blob");
      if (rawBlob !== undefined) assertBlobSize(rawBlob, "raw blob");
      const snapshot = parseSnapshot(input.snapshot);
      if (normalizedBlob.byteLength !== snapshot.normalizedBytes) {
        throw new ResearchResourceStoreError(
          "digest-mismatch",
          "normalized byte length does not match the snapshot",
        );
      }
      if (sha256Digest(normalizedBlob) !== snapshot.normalizedBlobDigest) {
        throw new ResearchResourceStoreError(
          "digest-mismatch",
          "normalized bytes do not match the snapshot digest",
        );
      }
      if ((snapshot.rawBlobDigest === undefined) !== (rawBlob === undefined)) {
        throw new ResearchResourceStoreError(
          "invalid-snapshot",
          "raw blob must be present exactly when rawBlobDigest is present",
        );
      }
      if (
        snapshot.rawBlobDigest !== undefined &&
        rawBlob !== undefined &&
        sha256Digest(rawBlob) !== snapshot.rawBlobDigest
      ) {
        throw new ResearchResourceStoreError(
          "digest-mismatch",
          "raw bytes do not match the snapshot digest",
        );
      }
      const recordBytes = new TextEncoder().encode(`${canonicalJson(snapshot)}\n`);
      if (recordBytes.byteLength > MAX_SNAPSHOT_RECORD_BYTES) {
        throw new ResearchResourceStoreError("too-large", "snapshot record exceeds 1 MiB");
      }

      return withMutationLock(async (layout) => {
        const existing = await readSnapshotRecord(layout, snapshot.id, true);
        if (existing && canonicalJson(existing) !== canonicalJson(snapshot)) {
          throw new ResearchResourceStoreError(
            "immutable-conflict",
            `snapshot ${snapshot.id} already exists with different content`,
          );
        }
        await publishBlob(layout, snapshot.normalizedBlobDigest, normalizedBlob);
        if (snapshot.rawBlobDigest !== undefined && rawBlob !== undefined) {
          await publishBlob(layout, snapshot.rawBlobDigest, rawBlob);
        }
        const result = await publishNoReplace({
          layout,
          directory: layout.snapshots,
          target: snapshotFile(layout, snapshot.id),
          bytes: recordBytes,
          label: `snapshot ${snapshot.id}`,
          maxBytes: MAX_SNAPSHOT_RECORD_BYTES,
          existingMismatchCode: "immutable-conflict",
        });
        return { created: result === "created", snapshot };
      });
    },

    async readSnapshot(snapshotId) {
      assertSnapshotId(snapshotId);
      const layout = await ensureLayout(root);
      await assertStableLayout(layout);
      const snapshot = await readSnapshotRecord(layout, snapshotId, false);
      if (!snapshot) throw new ResearchResourceStoreError("missing", `snapshot ${snapshotId} is missing`);
      const normalizedBlob = await readBlob(layout, snapshot.normalizedBlobDigest);
      if (normalizedBlob.byteLength !== snapshot.normalizedBytes) {
        throw new ResearchResourceStoreError(
          "digest-mismatch",
          `snapshot ${snapshotId} normalized byte length is corrupt`,
        );
      }
      const rawBlob = snapshot.rawBlobDigest
        ? await readBlob(layout, snapshot.rawBlobDigest)
        : undefined;
      return {
        snapshot,
        normalizedBlob,
        ...(rawBlob === undefined ? {} : { rawBlob }),
      };
    },

    async deleteSnapshot(snapshotId) {
      assertSnapshotId(snapshotId);
      return withMutationLock(async (layout) => {
        const { records: manifests } = await scanManifests(layout);
        const snapshots = await scanSnapshots(layout);
        return deleteSnapshotLocked(layout, manifests, snapshots, snapshotId);
      });
    },
  };
}
