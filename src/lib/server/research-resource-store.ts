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
  parseResourceManifestV1,
  parseResourceSnapshotV1,
  type ResourceManifestV1,
  type ResourceSnapshotV1,
} from "../research-resource-contracts.ts";
import { canonicalJson, sha256Digest } from "../research-protocol/digest.ts";
import { caveHome } from "../coven-paths.ts";
import { assertExclusivePathOwnership } from "./client-v1/path-ownership.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";

export const MAX_RESEARCH_RESOURCE_BLOB_BYTES = 512 * 1024 * 1024;
const MAX_SNAPSHOT_RECORD_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_RECORDS = 100_000;
const MAX_MANIFEST_RECORD_BYTES = 1024 * 1024;
const MAX_MANIFEST_RECORDS = 100_000;
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

export type ResearchResourceStore = {
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

async function readSafeFile(input: {
  target: string;
  rootRealPath: string;
  label: string;
  maxBytes: number;
}): Promise<Uint8Array> {
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
    return new Uint8Array(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
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
}): Promise<void> {
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

    const currentBytes = await readSafeFile({
      target: input.target,
      rootRealPath: input.layout.rootRealPath,
      label: input.label,
      maxBytes: input.maxBytes,
    });
    if (!Buffer.from(currentBytes).equals(Buffer.from(input.expectedBytes))) {
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
  return { root: rootIdentity, rootRealPath, manifests, snapshots, blobs, sha256, locks, intents };
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
  try {
    const bytes = await readSafeFile({
      target: manifestFile(layout, resourceId),
      rootRealPath: layout.rootRealPath,
      label: `manifest ${resourceId}`,
      maxBytes: MAX_MANIFEST_RECORD_BYTES,
    });
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
    return manifest;
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

async function scanManifests(layout: StoreLayout): Promise<Map<string, ResourceManifestV1>> {
  await assertStableLayout(layout);
  const records = new Map<string, ResourceManifestV1>();
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
    const manifest = await readManifestRecord(layout, id, false);
    if (!manifest) throw new ResearchResourceStoreError("corrupt", `manifest ${id} vanished`);
    records.set(id, manifest);
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
  return records;
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

function referenceCounts(records: Map<string, ResourceSnapshotV1>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const snapshot of records.values()) {
    const digests = new Set(
      [snapshot.normalizedBlobDigest, snapshot.rawBlobDigest].filter(Boolean) as string[],
    );
    for (const digest of digests) counts.set(digest, (counts.get(digest) ?? 0) + 1);
  }
  return counts;
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
    const release = await acquireProcessIntentLock({
      intentsDirectory: layout.intents.path,
      label: "Research Resource store",
    });
    try {
      await assertStableLayout(layout);
      return await operation(layout);
    } finally {
      await release();
    }
  };

  return {
    async createManifest(inputManifest) {
      const manifest = parseManifest(inputManifest);
      if (manifest.revision !== 1) {
        throw new ResearchResourceStoreError(
          "revision-conflict",
          "new manifests must start at revision 1",
        );
      }
      const recordBytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
      if (recordBytes.byteLength > MAX_MANIFEST_RECORD_BYTES) {
        throw new ResearchResourceStoreError("too-large", "manifest record exceeds 1 MiB");
      }
      return withMutationLock(async (layout) => {
        const records = await scanManifests(layout);
        const existing = records.get(manifest.id);
        if (existing) {
          if (canonicalJson(existing) === canonicalJson(manifest)) {
            assertUniqueManifest(records, manifest);
            await verifyCurrentSnapshot(layout, manifest);
            return { created: false, manifest };
          }
          throw new ResearchResourceStoreError(
            "immutable-conflict",
            `manifest ${manifest.id} already exists with different content`,
          );
        }
        assertUniqueManifest(records, manifest);
        await verifyCurrentSnapshot(layout, manifest);
        const result = await publishNoReplace({
          layout,
          directory: layout.manifests,
          target: manifestFile(layout, manifest.id),
          bytes: recordBytes,
          label: `manifest ${manifest.id}`,
          maxBytes: MAX_MANIFEST_RECORD_BYTES,
          existingMismatchCode: "immutable-conflict",
        });
        return { created: result === "created", manifest };
      });
    },

    async readManifest(resourceId) {
      assertResourceId(resourceId);
      const layout = await ensureLayout(root);
      await assertStableLayout(layout);
      return readManifestRecord(layout, resourceId, true);
    },

    async listManifests() {
      return withMutationLock(async (layout) => {
        const records = await scanManifests(layout);
        return [...records.values()].sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
      });
    },

    async updateManifest(input) {
      assertResourceId(input.id);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new ResearchResourceStoreError(
          "revision-conflict",
          "expectedRevision must be a positive safe integer",
        );
      }
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
      const recordBytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
      if (recordBytes.byteLength > MAX_MANIFEST_RECORD_BYTES) {
        throw new ResearchResourceStoreError("too-large", "manifest record exceeds 1 MiB");
      }
      return withMutationLock(async (layout) => {
        const records = await scanManifests(layout);
        const existing = records.get(input.id);
        if (!existing) {
          throw new ResearchResourceStoreError("missing", `manifest ${input.id} is missing`);
        }
        if (existing.revision !== input.expectedRevision) {
          throw new ResearchResourceStoreError(
            "revision-conflict",
            "manifest revision changed before the update",
          );
        }
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
        if (Date.parse(manifest.updatedAt) <= Date.parse(existing.updatedAt)) {
          throw new ResearchResourceStoreError(
            "revision-conflict",
            "updatedAt must advance on every manifest revision",
          );
        }
        assertUniqueManifest(records, manifest);
        await verifyCurrentSnapshot(layout, manifest);
        await publishReplace({
          layout,
          directory: layout.manifests,
          target: manifestFile(layout, manifest.id),
          bytes: recordBytes,
          expectedBytes: new TextEncoder().encode(`${canonicalJson(existing)}\n`),
          label: `manifest ${manifest.id}`,
          maxBytes: MAX_MANIFEST_RECORD_BYTES,
        });
        return manifest;
      });
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
        const manifests = await scanManifests(layout);
        if ([...manifests.values()].some((manifest) => manifest.currentSnapshotId === snapshotId)) {
          throw new ResearchResourceStoreError(
            "snapshot-conflict",
            `snapshot ${snapshotId} is current for a resource manifest`,
          );
        }
        const records = await scanSnapshots(layout);
        const target = records.get(snapshotId);
        if (!target) return { deleted: false, removedBlobDigests: [] };
        const counts = referenceCounts(records);
        const current = await readSnapshotRecord(layout, snapshotId, false);
        if (!current || canonicalJson(current) !== canonicalJson(target)) {
          throw new ResearchResourceStoreError(
            "corrupt",
            `snapshot ${snapshotId} changed during deletion accounting`,
          );
        }
        const candidates = new Set(
          [target.normalizedBlobDigest, target.rawBlobDigest].filter(Boolean) as string[],
        );
        const deletionCandidates: Array<{ digest: string; shard: PathIdentity }> = [];
        for (const digest of [...candidates].sort()) {
          if ((counts.get(digest) ?? 0) !== 1) continue;
          const shard = await existingShard(layout, digest);
          await readBlob(layout, digest);
          deletionCandidates.push({ digest, shard });
        }
        await assertStableDirectory(layout.snapshots, "snapshots");
        await unlink(snapshotFile(layout, snapshotId));
        await syncDirectory(layout.snapshots.path);

        const removedBlobDigests: string[] = [];
        for (const { digest, shard } of deletionCandidates) {
          await assertStableDirectory(shard, `blob shard ${digest.slice(0, 2)}`);
          const targetPath = path.join(shard.path, digest);
          await unlink(targetPath);
          await syncDirectory(path.dirname(targetPath));
          removedBlobDigests.push(digest);
        }
        return { deleted: true, removedBlobDigests };
      });
    },
  };
}
