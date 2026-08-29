// Hardened Context Pack store (Unit 1, cave-6sles.10).
//
// Mirrors the Research Resource CAS store's discipline with its OWN root:
// <caveHome>/research-context-packs/ is physically separate from the
// resource CAS, so refreshing or GC-ing a source resource can never mutate a
// sealed pack (program §3.2/§3.4). Publication is blob-first, manifest-last
// under a cross-process intent lock; reads re-verify every invariant.

import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  parseContextPackV1,
  type ContextPackV1,
} from "../research-protocol/context-pack.ts";
import { sha256Digest } from "../research-protocol/digest.ts";
import {
  parseContextPackBuildReceiptV1,
  parseContextPackRedactionMapV1,
  type ContextPackBuildReceiptV1,
} from "../research-context-pack.ts";
import { assertExclusivePathOwnershipSync } from "./client-v1/path-ownership.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

export const MAX_CONTEXT_PACK_BLOB_BYTES = 512 * 1024 * 1024;
export const MAX_CONTEXT_PACK_RECORDS = 100_000;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const PACK_ID_GRAMMAR = /^ctx_[A-Za-z0-9_-]{1,127}$/;
const WINDOWS_DEVICE_IDS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const REDACTION_MAP_BYTES = 1024 * 1024;

export type PublishContextPackInput = {
  pack: ContextPackV1;
  blobs: ReadonlyMap<string, Uint8Array>;
  receipt: ContextPackBuildReceiptV1;
  redactionMap?: Uint8Array;
};

export type VerifiedContextPack = {
  pack: ContextPackV1;
  blobs: ReadonlyMap<string, Uint8Array>;
  receipt: ContextPackBuildReceiptV1;
  redactionMap?: Uint8Array;
};

export type ContextPackStore = {
  publishPack(input: PublishContextPackInput): Promise<{ created: boolean; pack: ContextPackV1 }>;
  readPack(packId: string): Promise<VerifiedContextPack>;
  listPacks(): Promise<ContextPackV1[]>;
  deletePack(packId: string): Promise<{ deleted: boolean; removedBlobDigests: string[] }>;
  validatePack(packId: string): Promise<{ packId: string; valid: boolean }>;
};

export class ContextPackStoreError extends Error {
  readonly code:
    | "invalid-id"
    | "invalid-pack"
    | "invalid-receipt"
    | "invalid-redaction-map"
    | "digest-mismatch"
    | "immutable-conflict"
    | "missing"
    | "too-large"
    | "symlink"
    | "unsafe-path"
    | "corrupt";

  constructor(code: ContextPackStoreError["code"], message: string) {
    super(message);
    this.name = "ContextPackStoreError";
    this.code = code;
  }
}

type PathIdentity = { dev: bigint; ino: bigint; isDirectory: boolean; mode: number; nlink: number; size: number; isSymbolicLink: boolean };

async function pathMetadata(target: string, label: string): Promise<PathIdentity> {
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new ContextPackStoreError("missing", `${label} is missing`);
  }
  const isSymbolicLink = info.isSymbolicLink();
  const isDirectory = info.isDirectory();
  if (!isDirectory && !info.isFile()) {
    throw new ContextPackStoreError("unsafe-path", `${label} is neither a file nor a directory`);
  }
  return {
    dev: BigInt(info.dev),
    ino: BigInt(info.ino),
    isDirectory,
    mode: info.mode,
    nlink: info.nlink,
    size: info.size,
    isSymbolicLink,
  };
}

function sameIdentity(a: PathIdentity, b: PathIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.isDirectory === b.isDirectory;
}

function assertPrivateMode(mode: number, expected: number, label: string): void {
  if ((mode & 0o777) !== expected) {
    throw new ContextPackStoreError("unsafe-path", `${label} mode ${(mode & 0o777).toString(8)} is not ${expected.toString(8)}`);
  }
}

function assertSafeOwnership(target: string, metadata: PathIdentity, label: string): void {
  try {
    assertExclusivePathOwnershipSync(target, {
      uid: process.getuid?.() ?? -1,
      mode: metadata.mode,
      isSymbolicLink: metadata.isSymbolicLink,
    }, label);
  } catch (error) {
    throw new ContextPackStoreError("unsafe-path", `${label}: ${(error as Error).message}`);
  }
}

function isContained(rootRealPath: string, candidate: string): boolean {
  const relative = path.relative(rootRealPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
    if (!["EINVAL", "EISDIR", "ENOTSUP"].includes(code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
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
  if (before.isSymbolicLink) {
    throw new ContextPackStoreError("symlink", `${label} directory is a symlink`);
  }
  if (!before.isDirectory) {
    throw new ContextPackStoreError("unsafe-path", `${label} path is not a directory`);
  }
  await assertSafeOwnership(candidate, before, `Context Pack ${label} directory`);
  const resolved = await realpath(candidate);
  if (rootRealPath !== null && !isContained(rootRealPath, resolved)) {
    throw new ContextPackStoreError("symlink", `${label} directory escapes the store root`);
  }
  const after = await pathMetadata(candidate, label);
  if (!sameIdentity(before, after)) {
    throw new ContextPackStoreError("symlink", `${label} directory identity changed`);
  }
  assertPrivateMode(after.mode, DIRECTORY_MODE, `${label} directory`);
  if (created) await syncDirectory(path.dirname(candidate));
  return after;
}

async function publishNoReplace(target: string, bytes: Uint8Array): Promise<boolean> {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      // Hard-link publication is the atomic no-clobber primitive: link(2)
      // fails with EEXIST when the target already exists, and the temporary
      // inode becomes the durable file in one step.
      await link(temporary, target);
      await unlink(temporary);
      await syncDirectory(directory);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        await rm(temporary, { force: true });
        return false;
      }
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset);
    offset += written.bytesWritten;
  }
}

async function readSafeFileWithIdentity(
  target: string,
  label: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; identity: PathIdentity }> {
  const before = await pathMetadata(target, `${label} is missing`);
  if (before.isSymbolicLink) {
    throw new ContextPackStoreError("symlink", `${label} is a symlink`);
  }
  if (before.isDirectory) {
    throw new ContextPackStoreError("unsafe-path", `${label} is not a regular file`);
  }
  if (before.nlink !== 1) {
    throw new ContextPackStoreError("unsafe-path", `${label} must have exactly one link`);
  }
  if (before.size > maxBytes) {
    throw new ContextPackStoreError("too-large", `${label} exceeds its size limit`);
  }
  await assertSafeOwnership(target, before, `Context Pack ${label}`);
  let handle: FileHandle | null = null;
  try {
    handle = await open(target, readFlags());
    const handleStat = await handle.stat();
    if (!sameIdentity(before, { ...before, size: handleStat.size })) {
      throw new ContextPackStoreError("symlink", `${label} identity changed during open`);
    }
    const bytes = new Uint8Array(handleStat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    return { bytes: bytes.slice(0, offset), identity: before };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validatePackId(id: unknown, label: string): string {
  if (typeof id !== "string" || !PACK_ID_GRAMMAR.test(id) || WINDOWS_DEVICE_IDS.test(id)) {
    throw new ContextPackStoreError("invalid-id", `${label} must match ctx_[A-Za-z0-9_-]{1,127}`);
  }
  return id;
}

function validateReceiptBijection(
  pack: ContextPackV1,
  receipt: ContextPackBuildReceiptV1,
): void {
  if (receipt.packId !== pack.id) {
    throw new ContextPackStoreError("invalid-receipt", "receipt.packId does not match the pack id");
  }
  const packIds = [...pack.resources.map((resource) => resource.id)].sort();
  const receiptIds = [...receipt.resources.map((resource) => resource.packResourceId)].sort();
  if (packIds.length !== receiptIds.length || packIds.some((id, index) => id !== receiptIds[index])) {
    throw new ContextPackStoreError("invalid-receipt", "receipt resources must biject with pack resources");
  }
  for (const entry of receipt.resources) {
    if (!LOWERCASE_SHA256.test(entry.sourceNormalizedBlobDigest)) {
      throw new ContextPackStoreError("invalid-receipt", `sourceNormalizedBlobDigest for ${entry.packResourceId} is not a lowercase SHA-256`);
    }
  }
}

function validatePackLocalInvariants(pack: ContextPackV1): void {
  for (const resource of pack.resources) {
    if (resource.selector.type !== "whole-resource") {
      throw new ContextPackStoreError(
        "invalid-pack",
        `pack resource ${resource.id} must use a whole-resource selector (Unit 1)`,
      );
    }
    if (resource.digest !== resource.localBlobDigest) {
      throw new ContextPackStoreError("digest-mismatch", `resource ${resource.id} digest/localBlobDigest diverge`);
    }
    if (!LOWERCASE_SHA256.test(resource.digest)) {
      throw new ContextPackStoreError("invalid-pack", `resource ${resource.id} digest is not a lowercase SHA-256`);
    }
  }
}

type StoreLayout = {
  root: string;
  rootRealPath: string;
  manifestsDir: string;
  blobsDir: string;
  redactionsDir: string;
  receiptsDir: string;
  locksDir: string;
};

async function openLayout(rootInput: string): Promise<StoreLayout> {
  const root = path.resolve(rootInput);
  await mkdir(root, { mode: DIRECTORY_MODE, recursive: true });
  const rootIdentity = await ensureRealDirectory(root, null, "root");
  const rootRealPath = await realpath(root);
  void rootIdentity;
  const manifestsDir = path.join(root, "manifests");
  const blobsParentDir = path.join(root, "blobs");
  const blobsDir = path.join(blobsParentDir, "sha256");
  const redactionsDir = path.join(root, "redactions");
  const receiptsDir = path.join(root, "receipts");
  const locksParentDir = path.join(root, "locks");
  const locksDir = path.join(locksParentDir, "intents");
  await ensureRealDirectory(manifestsDir, rootRealPath, "manifests");
  await ensureRealDirectory(blobsParentDir, rootRealPath, "blobs");
  await ensureRealDirectory(blobsDir, rootRealPath, "blobs/sha256");
  await ensureRealDirectory(redactionsDir, rootRealPath, "redactions");
  await ensureRealDirectory(receiptsDir, rootRealPath, "receipts");
  await ensureRealDirectory(locksParentDir, rootRealPath, "locks");
  await ensureRealDirectory(locksDir, rootRealPath, "locks/intents");
  return { root, rootRealPath, manifestsDir, blobsDir, redactionsDir, receiptsDir, locksDir };
}

function manifestPath(layout: StoreLayout, packId: string): string {
  return path.join(layout.manifestsDir, `${packId}.json`);
}

function receiptPath(layout: StoreLayout, packId: string): string {
  return path.join(layout.receiptsDir, `${packId}.json`);
}

function blobPath(layout: StoreLayout, digest: string): string {
  return path.join(layout.blobsDir, digest.slice(0, 2), digest);
}

async function parseManifestFile(layout: StoreLayout, packId: string): Promise<ContextPackV1> {
  const { bytes } = await readSafeFileWithIdentity(
    manifestPath(layout, packId),
    `manifest ${packId}`,
    MAX_CONTEXT_PACK_BLOB_BYTES,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ContextPackStoreError("corrupt", `manifest ${packId} is not valid JSON`);
  }
  const parsed = parseContextPackV1(raw);
  if (!parsed.ok) {
    throw new ContextPackStoreError("invalid-pack", `manifest ${packId}: ${parsed.error.code}`);
  }
  if (parsed.value.id !== packId) {
    throw new ContextPackStoreError("invalid-pack", `manifest ${packId} claims id ${parsed.value.id}`);
  }
  validatePackLocalInvariants(parsed.value);
  return parsed.value;
}

async function verifyBlob(layout: StoreLayout, digest: string): Promise<Uint8Array> {
  const { bytes } = await readSafeFileWithIdentity(blobPath(layout, digest), `blob ${digest}`, MAX_CONTEXT_PACK_BLOB_BYTES);
  const recomputed = sha256Digest(bytes);
  if (recomputed !== digest) {
    throw new ContextPackStoreError("digest-mismatch", `blob ${digest} recomputed as ${recomputed}`);
  }
  return bytes;
}

async function verifyPack(layout: StoreLayout, pack: ContextPackV1): Promise<ReadonlyMap<string, Uint8Array>> {
  const blobs = new Map<string, Uint8Array>();
  for (const resource of pack.resources) {
    const bytes = await verifyBlob(layout, resource.digest);
    blobs.set(resource.digest, bytes);
  }
  return blobs;
}

async function verifyReceipt(layout: StoreLayout, pack: ContextPackV1): Promise<ContextPackBuildReceiptV1> {
  const { bytes } = await readSafeFileWithIdentity(receiptPath(layout, pack.id), `receipt ${pack.id}`, MAX_CONTEXT_PACK_BLOB_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ContextPackStoreError("corrupt", `receipt ${pack.id} is not valid JSON`);
  }
  const parsed = parseContextPackBuildReceiptV1(raw);
  if (!parsed.ok) {
    throw new ContextPackStoreError("invalid-receipt", `receipt ${pack.id}: ${parsed.error.code}`);
  }
  validateReceiptBijection(pack, parsed.value);
  return parsed.value;
}

async function verifyRedactionMap(
  layout: StoreLayout,
  pack: ContextPackV1,
): Promise<Uint8Array | undefined> {
  const expected = pack.transforms.redactionMapDigest;
  if (!expected) return undefined;
  const { bytes } = await readSafeFileWithIdentity(
    path.join(layout.redactionsDir, `${expected}.json`),
    `redaction map ${expected}`,
    REDACTION_MAP_BYTES,
  );
  const recomputed = sha256Digest(bytes);
  if (recomputed !== expected) {
    throw new ContextPackStoreError("digest-mismatch", `redaction map ${expected} recomputed as ${recomputed}`);
  }
  const parsed = parseContextPackRedactionMapV1(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed.ok) {
    throw new ContextPackStoreError("invalid-redaction-map", `redaction map ${expected}: ${parsed.error.code}`);
  }
  return bytes;
}

export function createContextPackStore(options: { root?: string } = {}): ContextPackStore {
  const root = options.root ?? path.join(caveHome(), "research-context-packs");

  return {
    async publishPack(input) {
      const pack = parseContextPackV1(input.pack);
      if (!pack.ok) throw new ContextPackStoreError("invalid-pack", `pack failed validation: ${pack.error.code}`);
      const parsedPack = pack.value;
      validatePackId(parsedPack.id, "pack id");
      validatePackLocalInvariants(parsedPack);
      validateReceiptBijection(parsedPack, input.receipt);

      // Blob bijection: exactly the referenced digests, no extras.
      const referenced = new Set(parsedPack.resources.map((resource) => resource.digest));
      for (const [digest, bytes] of input.blobs) {
        if (!referenced.has(digest)) {
          throw new ContextPackStoreError("invalid-pack", `blob ${digest} is not referenced by the pack`);
        }
        if (bytes.length > MAX_CONTEXT_PACK_BLOB_BYTES) {
          throw new ContextPackStoreError("too-large", `blob ${digest} exceeds the size limit`);
        }
        if (sha256Digest(bytes) !== digest) {
          throw new ContextPackStoreError("digest-mismatch", `blob ${digest} recomputed incorrectly`);
        }
      }
      for (const digest of referenced) {
        if (!input.blobs.has(digest)) {
          throw new ContextPackStoreError("invalid-pack", `blob ${digest} is referenced but not supplied`);
        }
      }

      const hasRedactionMap = input.redactionMap !== undefined;
      const expectsRedactionMap = parsedPack.transforms.redactionMapDigest !== undefined;
      if (hasRedactionMap !== expectsRedactionMap) {
        throw new ContextPackStoreError("invalid-redaction-map", "redactionMap presence must match transforms.redactionMapDigest");
      }
      if (hasRedactionMap && input.redactionMap) {
        const digest = parsedPack.transforms.redactionMapDigest;
        if (sha256Digest(input.redactionMap) !== digest) {
          throw new ContextPackStoreError("digest-mismatch", "redaction map digest does not match the pack transform");
        }
      }

      const layout = await openLayout(root);
      return withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "context-pack-store" }, async () => {
        // Blob-first publication under the intent lock.
        for (const [digest, bytes] of input.blobs) {
          const target = blobPath(layout, digest);
          try {
            await stat(target);
          } catch {
            await mkdir(path.dirname(target), { mode: DIRECTORY_MODE, recursive: true });
            await publishNoReplace(target, bytes);
          }
        }
        if (hasRedactionMap && input.redactionMap) {
          const digest = parsedPack.transforms.redactionMapDigest;
          await publishNoReplace(path.join(layout.redactionsDir, `${digest}.json`), input.redactionMap);
        }
        await publishNoReplace(receiptPath(layout, parsedPack.id), new TextEncoder().encode(`${JSON.stringify(input.receipt)}\n`));

        // Manifest last: the pack is only visible once every byte is durable.
        const manifestBytes = new TextEncoder().encode(`${JSON.stringify(parsedPack)}\n`);
        const created = await publishNoReplace(manifestPath(layout, parsedPack.id), manifestBytes);
        if (!created) {
          // Idempotent replay or immutable conflict.
          const existing = await readSafeFileWithIdentity(manifestPath(layout, parsedPack.id), `manifest ${parsedPack.id}`, MAX_CONTEXT_PACK_BLOB_BYTES);
          const same = Buffer.from(existing.bytes).equals(Buffer.from(manifestBytes));
          if (!same) {
            throw new ContextPackStoreError("immutable-conflict", `pack ${parsedPack.id} already exists with different bytes`);
          }
        }
        return { created, pack: parsedPack };
      });
    },

    async readPack(packId) {
      const id = validatePackId(packId, "pack id");
      const layout = await openLayout(root);
      const pack = await parseManifestFile(layout, id);
      const blobs = await verifyPack(layout, pack);
      const receipt = await verifyReceipt(layout, pack);
      const redactionMap = await verifyRedactionMap(layout, pack);
      return { pack, blobs, receipt, redactionMap };
    },

    async listPacks() {
      const layout = await openLayout(root);
      let entries: string[];
      try {
        entries = await readdir(layout.manifestsDir);
      } catch {
        return [];
      }
      const packs: ContextPackV1[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const id = entry.slice(0, -".json".length);
        packs.push(await parseManifestFile(layout, id));
      }
      if (packs.length > MAX_CONTEXT_PACK_RECORDS) {
        throw new ContextPackStoreError("too-large", "pack store exceeds the record cap");
      }
      packs.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)));
      return packs;
    },

    async deletePack(packId) {
      const id = validatePackId(packId, "pack id");
      const layout = await openLayout(root);
      return withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "context-pack-store" }, async () => {
        let pack: ContextPackV1;
        try {
          pack = await parseManifestFile(layout, id);
        } catch (error) {
          if (error instanceof ContextPackStoreError && error.code === "missing") {
            return { deleted: false, removedBlobDigests: [] };
          }
          throw error;
        }
        const removedBlobDigests = new Set<string>(pack.resources.map((resource) => resource.digest));

        // Manifest-first: unlink the manifest, then sidecars, then GC blobs.
        await unlink(manifestPath(layout, id));
        await syncDirectory(layout.manifestsDir);
        await unlink(receiptPath(layout, id)).catch(() => {});
        if (pack.transforms.redactionMapDigest) {
          await unlink(path.join(layout.redactionsDir, `${pack.transforms.redactionMapDigest}.json`)).catch(() => {});
        }
        await syncDirectory(layout.manifestsDir);

        // GC: keep any digest still referenced by a remaining manifest.
        const remaining = await this.listPacks();
        const stillReferenced = new Set<string>();
        for (const sibling of remaining) {
          for (const resource of sibling.resources) stillReferenced.add(resource.digest);
        }
        const removed: string[] = [];
        for (const digest of removedBlobDigests) {
          if (stillReferenced.has(digest)) continue;
          await unlink(blobPath(layout, digest)).catch(() => {});
          removed.push(digest);
        }
        removed.sort();
        return { deleted: true, removedBlobDigests: removed };
      });
    },

    async validatePack(packId) {
      const id = validatePackId(packId, "pack id");
      try {
        const layout = await openLayout(root);
        const pack = await parseManifestFile(layout, id);
        await verifyPack(layout, pack);
        await verifyReceipt(layout, pack);
        await verifyRedactionMap(layout, pack);
        return { packId: id, valid: true };
      } catch (error) {
        if (error instanceof ContextPackStoreError && error.code === "missing") {
          return { packId: id, valid: false };
        }
        throw error;
      }
    },
  };
}

/**
 * Restore-time validation coordinator (program §8 step 6): enumerates every
 * manifest under `manifests/` and runs the full digest-verified validation.
 * Returns counts; a pack whose blobs failed verification is never surfaced
 * as valid — the caller fails or quarantines the restore.
 */
export async function reconcileRestoredContextPacks(options: {
  root?: string;
} = {}): Promise<{ validated: number; invalid: number }> {
  const layout = await openLayout(options.root ?? path.join(caveHome(), "research-context-packs"));
  let entries: string[] = [];
  try {
    entries = await readdir(layout.manifestsDir);
  } catch {
    return { validated: 0, invalid: 0 };
  }
  let validated = 0;
  let invalid = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    try {
      const pack = await parseManifestFile(layout, id);
      await verifyPack(layout, pack);
      await verifyReceipt(layout, pack);
      await verifyRedactionMap(layout, pack);
      validated += 1;
    } catch {
      invalid += 1;
    }
  }
  return { validated, invalid };
}

export function withContextPackMaintenanceLock<T>(
  rootInput: string,
  operation: () => Promise<T>,
): Promise<T> {
  return openLayout(rootInput).then((layout) =>
    withProcessIntentLock({ intentsDirectory: layout.locksDir, label: "context-pack-maintenance" }, operation),
  );
}

export { validatePackId };
