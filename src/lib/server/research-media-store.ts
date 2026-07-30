import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  rename,
  rm,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  isValidResearchGenerationFamiliarId,
  type ResearchGenerationMediaFileRef,
} from "../research-generations.ts";
import { caveHome } from "../coven-paths.ts";

export const RESEARCH_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const RESEARCH_VIDEO_MAX_BYTES = 500 * 1024 * 1024;

const SAFE_GENERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_MEDIA_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class ResearchMediaStoreError extends Error {
  readonly code: "invalid-path" | "too-large" | "missing" | "symlink";

  constructor(code: ResearchMediaStoreError["code"], message: string) {
    super(message);
    this.name = "ResearchMediaStoreError";
    this.code = code;
  }
}

export function researchMediaRoot(): string {
  return (
    process.env.COVEN_RESEARCH_MEDIA_DIR?.trim() ||
    path.join(/* turbopackIgnore: true */ caveHome(), "research-generations", "media")
  );
}

function assertSafePath(familiarId: string, generationId: string, key?: string): void {
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    throw new ResearchMediaStoreError("invalid-path", "invalid familiar id");
  }
  if (!SAFE_GENERATION_ID.test(generationId)) {
    throw new ResearchMediaStoreError("invalid-path", "invalid generation id");
  }
  if (key !== undefined && !SAFE_MEDIA_KEY.test(key)) {
    throw new ResearchMediaStoreError("invalid-path", "invalid media key");
  }
}

export function researchGenerationMediaDir(familiarId: string, generationId: string): string {
  assertSafePath(familiarId, generationId);
  return path.join(researchMediaRoot(), familiarId, generationId);
}

export function researchGenerationMediaPath(
  familiarId: string,
  generationId: string,
  key: string,
): string {
  assertSafePath(familiarId, generationId, key);
  return path.join(researchGenerationMediaDir(familiarId, generationId), key);
}

export function validateResearchMediaSize(sizeBytes: number, mimeType: string): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new ResearchMediaStoreError("too-large", "invalid media size");
  }
  const max = mimeType.startsWith("audio/")
    ? RESEARCH_AUDIO_MAX_BYTES
    : mimeType.startsWith("video/")
      ? RESEARCH_VIDEO_MAX_BYTES
      : 0;
  if (max === 0 || sizeBytes > max) {
    throw new ResearchMediaStoreError(
      "too-large",
      max === 0 ? "media must be audio or video" : "media file exceeds the size limit",
    );
  }
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

async function pathMetadata(candidate: string, missingMessage: string) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResearchMediaStoreError("missing", missingMessage);
    }
    throw error;
  }
}

async function ensureRealDirectory(
  candidate: string,
  rootRealPath: string,
  create: boolean,
  label: string,
): Promise<{ resolved: string; identity: PathIdentity }> {
  if (create) {
    try {
      await mkdir(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const metadata = await pathMetadata(candidate, "media file not found");
  if (metadata.isSymbolicLink()) {
    throw new ResearchMediaStoreError("symlink", `${label} directory is a symlink`);
  }
  if (!metadata.isDirectory()) {
    throw new ResearchMediaStoreError("invalid-path", `${label} path is not a directory`);
  }
  const resolved = await realpath(candidate);
  if (!isContained(rootRealPath, resolved)) {
    throw new ResearchMediaStoreError("symlink", `${label} directory escapes the media root`);
  }
  return {
    resolved,
    identity: pathIdentity(candidate, metadata),
  };
}

type PathIdentity = {
  path: string;
  dev: number | bigint;
  ino: number | bigint;
};

type SafeGenerationDirectory = {
  rootRealPath: string;
  familiarDir: string;
  generationDir: string;
  rootIdentity: PathIdentity;
  familiarIdentity: PathIdentity;
  generationIdentity: PathIdentity;
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

async function assertStableDirectory(
  identity: PathIdentity,
  label: string,
): Promise<void> {
  const metadata = await pathMetadata(identity.path, "media file not found");
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ResearchMediaStoreError(
      "symlink",
      `${label} directory identity changed`,
    );
  }
  if (!sameIdentity(identity, metadata)) {
    throw new ResearchMediaStoreError(
      "symlink",
      `${label} directory identity changed`,
    );
  }
}

async function assertStableGenerationDirectory(
  safe: SafeGenerationDirectory,
): Promise<void> {
  await assertStableDirectory(safe.rootIdentity, "media root");
  await assertStableDirectory(safe.familiarIdentity, "familiar");
  await assertStableDirectory(safe.generationIdentity, "generation");
  const resolved = await realpath(safe.generationDir);
  if (!isContained(safe.rootRealPath, resolved)) {
    throw new ResearchMediaStoreError(
      "symlink",
      "generation directory escapes the media root",
    );
  }
}

async function safeGenerationDirectory(
  familiarId: string,
  generationId: string,
  create: boolean,
): Promise<SafeGenerationDirectory> {
  assertSafePath(familiarId, generationId);
  const root = path.resolve(researchMediaRoot());
  if (create) await mkdir(root, { recursive: true });
  const rootMetadata = await pathMetadata(root, "media file not found");
  if (rootMetadata.isSymbolicLink()) {
    throw new ResearchMediaStoreError("symlink", "media root is a symlink");
  }
  if (!rootMetadata.isDirectory()) {
    throw new ResearchMediaStoreError("invalid-path", "media root is not a directory");
  }
  const rootRealPath = await realpath(root);
  const familiarDir = path.join(root, familiarId);
  const familiar = await ensureRealDirectory(
    familiarDir,
    rootRealPath,
    create,
    "familiar",
  );
  const generationDir = path.join(familiarDir, generationId);
  const generation = await ensureRealDirectory(
    generationDir,
    rootRealPath,
    create,
    "generation",
  );
  return {
    rootRealPath,
    familiarDir,
    generationDir,
    rootIdentity: pathIdentity(root, rootMetadata),
    familiarIdentity: familiar.identity,
    generationIdentity: generation.identity,
  };
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

export function researchMediaOpenFlags(
  platform: NodeJS.Platform = process.platform,
  noFollow: number = noFollowFlag(),
): number {
  return constants.O_RDONLY | (platform === "win32" ? 0 : noFollow);
}

function exclusiveWriteFlags(): number {
  const noFollow = process.platform === "win32" ? 0 : noFollowFlag();
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;
}

async function assertReplaceableTarget(target: string): Promise<void> {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      throw new ResearchMediaStoreError("symlink", "media target is a symlink");
    }
    if (!metadata.isFile()) {
      throw new ResearchMediaStoreError("invalid-path", "media target is not a regular file");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writeAll(
  handle: FileHandle,
  bytes: Uint8Array,
  length = bytes.byteLength,
): Promise<void> {
  let offset = 0;
  while (offset < length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      length - offset,
      null,
    );
    if (bytesWritten <= 0) throw new Error("media write made no progress");
    offset += bytesWritten;
  }
}

export async function writeResearchGenerationMedia(input: {
  familiarId: string;
  generationId: string;
  key: string;
  mimeType: string;
  bytes: Uint8Array;
  durationMs?: number;
}): Promise<ResearchGenerationMediaFileRef> {
  assertSafePath(input.familiarId, input.generationId, input.key);
  validateResearchMediaSize(input.bytes.byteLength, input.mimeType);
  const safe = await safeGenerationDirectory(
    input.familiarId,
    input.generationId,
    true,
  );
  const { generationDir } = safe;
  const target = path.join(generationDir, input.key);
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle: FileHandle | null = null;
  try {
    await assertStableGenerationDirectory(safe);
    handle = await open(temporary, exclusiveWriteFlags(), 0o600);
    const openedTemporary = await handle.stat();
    const temporaryMetadata = await lstat(temporary);
    await assertStableGenerationDirectory(safe);
    if (
      !openedTemporary.isFile() ||
      !sameIdentity(openedTemporary, temporaryMetadata)
    ) {
      throw new ResearchMediaStoreError(
        "symlink",
        "temporary media file identity changed",
      );
    }
    await writeAll(handle, input.bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertStableGenerationDirectory(safe);
    const closedTemporary = await lstat(temporary);
    if (!sameIdentity(openedTemporary, closedTemporary)) {
      throw new ResearchMediaStoreError(
        "symlink",
        "temporary media file identity changed",
      );
    }
    await assertReplaceableTarget(target);
    await rename(temporary, target);
    const stored = await lstat(target);
    await assertStableGenerationDirectory(safe);
    if (!sameIdentity(openedTemporary, stored)) {
      throw new ResearchMediaStoreError(
        "symlink",
        "published media file identity changed",
      );
    }
    return {
      key: input.key,
      mimeType: input.mimeType,
      sizeBytes: stored.size,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export type OpenResearchMedia = ResearchGenerationMediaFileRef & {
  handle: FileHandle;
};

export type OpenResearchMediaOptions = {
  /** Deterministic race hooks used only by filesystem regression tests. */
  afterDirectoryValidation?: () => void | Promise<void>;
  afterOpen?: () => void | Promise<void>;
};

function mimeTypeForKey(key: string): "audio/wav" | "video/mp4" {
  return key.toLowerCase().endsWith(".mp4") ? "video/mp4" : "audio/wav";
}

export async function openResearchGenerationMedia(
  familiarId: string,
  generationId: string,
  key: string,
  options: OpenResearchMediaOptions = {},
): Promise<OpenResearchMedia> {
  assertSafePath(familiarId, generationId, key);
  const safe = await safeGenerationDirectory(
    familiarId,
    generationId,
    false,
  );
  const { rootRealPath, generationDir } = safe;
  const mediaPath = path.join(generationDir, key);
  const before = await pathMetadata(mediaPath, "media file not found");
  if (before.isSymbolicLink()) {
    throw new ResearchMediaStoreError("symlink", "media path is a symlink");
  }
  if (!before.isFile()) {
    throw new ResearchMediaStoreError("invalid-path", "media path is not a regular file");
  }
  await assertStableGenerationDirectory(safe);
  await options.afterDirectoryValidation?.();

  let handle: FileHandle;
  try {
    handle = await open(mediaPath, researchMediaOpenFlags());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new ResearchMediaStoreError("symlink", "media path is a symlink");
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResearchMediaStoreError("missing", "media file not found");
    }
    throw error;
  }
  try {
    await options.afterOpen?.();
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new ResearchMediaStoreError("invalid-path", "media path is not a regular file");
    }
    await assertStableGenerationDirectory(safe);
    const after = await pathMetadata(mediaPath, "media file not found");
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      !sameIdentity(before, opened) ||
      !sameIdentity(opened, after)
    ) {
      throw new ResearchMediaStoreError(
        "symlink",
        "media file identity changed while opening",
      );
    }
    const resolved = await realpath(mediaPath);
    if (!isContained(rootRealPath, resolved)) {
      throw new ResearchMediaStoreError("symlink", "media file escapes the media root");
    }
    const mimeType = mimeTypeForKey(key);
    validateResearchMediaSize(opened.size, mimeType);
    return {
      handle,
      key,
      mimeType,
      sizeBytes: opened.size,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function readResearchGenerationMediaBytes(
  familiarId: string,
  generationId: string,
  key: string,
): Promise<Uint8Array> {
  const media = await openResearchGenerationMedia(familiarId, generationId, key);
  try {
    return new Uint8Array(await media.handle.readFile());
  } finally {
    await media.handle.close();
  }
}

export type PublishResearchMediaOptions = {
  /** May lower, never raise, the product cap. */
  maxBytes?: number;
  /** Deterministic race hook used by the filesystem regression test. */
  afterSourceStat?: () => void | Promise<void>;
  afterDirectoryValidation?: () => void | Promise<void>;
  afterDestinationOpen?: () => void | Promise<void>;
};

export async function publishResearchGenerationMediaFile(
  input: {
    familiarId: string;
    generationId: string;
    key: string;
    mimeType: "video/mp4";
    sourcePath: string;
    durationMs: number;
  },
  options: PublishResearchMediaOptions = {},
): Promise<ResearchGenerationMediaFileRef> {
  assertSafePath(input.familiarId, input.generationId, input.key);
  if (
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0
  ) {
    throw new ResearchMediaStoreError("invalid-path", "invalid media duration");
  }
  const requestedMax = options.maxBytes ?? RESEARCH_VIDEO_MAX_BYTES;
  if (!Number.isSafeInteger(requestedMax) || requestedMax < 0) {
    throw new ResearchMediaStoreError("too-large", "invalid media size limit");
  }
  const maxBytes = Math.min(requestedMax, RESEARCH_VIDEO_MAX_BYTES);
  const safe = await safeGenerationDirectory(
    input.familiarId,
    input.generationId,
    true,
  );
  const { generationDir } = safe;
  const target = path.join(generationDir, input.key);
  const temporary = `${target}.tmp-${randomUUID()}`;

  const sourceMetadata = await pathMetadata(input.sourcePath, "source media file not found");
  if (sourceMetadata.isSymbolicLink()) {
    throw new ResearchMediaStoreError("symlink", "source media path is a symlink");
  }
  if (!sourceMetadata.isFile()) {
    throw new ResearchMediaStoreError("invalid-path", "source media is not a regular file");
  }
  if (sourceMetadata.size > maxBytes) {
    throw new ResearchMediaStoreError("too-large", "media file exceeds the size limit");
  }

  let source: FileHandle | null = null;
  let destination: FileHandle | null = null;
  try {
    source = await open(input.sourcePath, researchMediaOpenFlags());
    const openedSource = await source.stat();
    if (!openedSource.isFile()) {
      throw new ResearchMediaStoreError("invalid-path", "source media is not a regular file");
    }
    if (openedSource.size > maxBytes) {
      throw new ResearchMediaStoreError("too-large", "media file exceeds the size limit");
    }
    if (!sameIdentity(sourceMetadata, openedSource)) {
      throw new ResearchMediaStoreError(
        "symlink",
        "source media file identity changed",
      );
    }
    await options.afterSourceStat?.();
    await assertStableGenerationDirectory(safe);
    await options.afterDirectoryValidation?.();
    destination = await open(temporary, exclusiveWriteFlags(), 0o600);
    await options.afterDestinationOpen?.();
    const openedDestination = await destination.stat();
    const destinationMetadata = await pathMetadata(
      temporary,
      "temporary media file not found",
    );
    await assertStableGenerationDirectory(safe);
    if (
      !openedDestination.isFile() ||
      !sameIdentity(openedDestination, destinationMetadata)
    ) {
      throw new ResearchMediaStoreError(
        "symlink",
        "temporary media file identity changed",
      );
    }
    const buffer = new Uint8Array(64 * 1024);
    let copied = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      copied += bytesRead;
      if (copied > maxBytes) {
        throw new ResearchMediaStoreError("too-large", "media file exceeds the size limit");
      }
      await writeAll(destination, buffer, bytesRead);
    }
    await destination.sync();
    await destination.close();
    destination = null;
    await source.close();
    source = null;
    await assertStableGenerationDirectory(safe);
    const closedDestination = await pathMetadata(
      temporary,
      "temporary media file not found",
    );
    if (!sameIdentity(openedDestination, closedDestination)) {
      throw new ResearchMediaStoreError(
        "symlink",
        "temporary media file identity changed",
      );
    }
    await assertReplaceableTarget(target);
    await rename(temporary, target);
    const stored = await lstat(target);
    await assertStableGenerationDirectory(safe);
    if (!sameIdentity(openedDestination, stored)) {
      throw new ResearchMediaStoreError(
        "symlink",
        "published media file identity changed",
      );
    }
    return {
      key: input.key,
      mimeType: input.mimeType,
      sizeBytes: stored.size,
      durationMs: input.durationMs,
    };
  } catch (error) {
    await destination?.close().catch(() => {});
    await source?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function removeResearchGenerationMedia(
  familiarId: string,
  generationId: string,
): Promise<void> {
  let safe;
  try {
    safe = await safeGenerationDirectory(familiarId, generationId, false);
  } catch (error) {
    if (error instanceof ResearchMediaStoreError && error.code === "missing") return;
    throw error;
  }
  await rm(safe.generationDir, { recursive: true, force: false });
  try {
    const familiarMetadata = await lstat(safe.familiarDir);
    if (familiarMetadata.isSymbolicLink() || !familiarMetadata.isDirectory()) {
      throw new ResearchMediaStoreError("symlink", "familiar directory is not safe");
    }
    if ((await readdir(safe.familiarDir)).length === 0) {
      await rmdir(safe.familiarDir);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export type ResearchMediaRange = {
  start: number;
  end: number;
};

export function parseResearchMediaRange(
  value: string | null,
  size: number,
): ResearchMediaRange | null {
  if (!value || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}
