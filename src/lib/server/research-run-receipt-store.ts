import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  serializeResearchRunCompletionReceipt,
  validateResearchRunCompletionReceipt,
  verifyResearchRunCompletionReceipt,
  type ResearchRunCompletionReceiptV1,
} from "../research-run-authority-receipt.ts";
import { assertExclusivePathOwnership } from "./client-v1/path-ownership.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";
import { researchMissionsRoot } from "./research-mission-store.ts";

const RUN_ID_RE = /^run_[A-Za-z0-9_-]+$/;
const RECEIPT_FILE_RE = /^run_[A-Za-z0-9_-]+\.json$/;
const TEMPORARY_FILE_RE = /^\.tmp-\d+-[a-f0-9]{24}$/;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
export const MAX_RESEARCH_RUN_RECEIPT_BYTES = 2 * 1024 * 1024;

export class ResearchRunReceiptStoreError extends Error {
  readonly code:
    | "immutable-conflict"
    | "missing"
    | "symlink"
    | "too-large"
    | "unsupported-platform"
    | "unsafe-path";

  constructor(
    code: ResearchRunReceiptStoreError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResearchRunReceiptStoreError";
    this.code = code;
  }
}

export type ResearchRunReceiptStoreCapability =
  | { supported: true; durability: "file-and-directory-sync" }
  | { supported: false; reason: "durable-no-replace-unavailable" };

export function researchRunCompletionReceiptStoreCapability(
  platform: NodeJS.Platform = process.platform,
): ResearchRunReceiptStoreCapability {
  if (platform === "win32") {
    return {
      supported: false,
      reason: "durable-no-replace-unavailable",
    };
  }
  return {
    supported: true,
    durability: "file-and-directory-sync",
  };
}

function assertReceiptStoreSupported(platform: NodeJS.Platform): void {
  const capability = researchRunCompletionReceiptStoreCapability(platform);
  if (capability.supported) return;
  throw new ResearchRunReceiptStoreError(
    "unsupported-platform",
    "Research run receipt persistence is unavailable on Windows: "
      + "Node cannot durably publish a no-replace directory entry there.",
  );
}

type PathIdentity = {
  path: string;
  dev: number | bigint;
  ino: number | bigint;
};

type StoreLayout = {
  root: PathIdentity;
  rootRealPath: string;
  locksDir: string;
};

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    )
  );
}

function receiptRoot(override?: string): string {
  const explicit = override?.trim();
  const configured = explicit || process.env.COVEN_RESEARCH_RUN_RECEIPTS_DIR?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("Research run receipt directory must be absolute");
  }
  const root = path.resolve(
    configured || path.join(/* turbopackIgnore: true */ caveHome(), "research-run-receipts"),
  );
  const missionRoot = path.resolve(researchMissionsRoot());
  if (isWithin(root, missionRoot) || isWithin(missionRoot, root)) {
    throw new Error("Research run receipt directory must be outside mission workspaces");
  }
  return root;
}

async function resolvedPathWithoutSymlinks(
  candidate: string,
  label: string,
): Promise<string> {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  let existingCount = 0;
  for (const component of components) {
    const next = path.join(current, component);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        `${label} has a symlink ancestor`,
      );
    }
    if (!metadata.isDirectory()) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        `${label} ancestor is not a directory`,
      );
    }
    current = next;
    existingCount += 1;
  }
  const resolvedExisting = await realpath(current);
  return path.join(resolvedExisting, ...components.slice(existingCount));
}

async function createDirectoryTreeWithoutSymlinks(
  candidate: string,
  label: string,
): Promise<void> {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    let created = false;
    try {
      await mkdir(current, { mode: DIRECTORY_MODE });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await pathMetadata(current, `${label} ancestor is missing`);
    if (metadata.isSymbolicLink()) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        `${label} has a symlink ancestor`,
      );
    }
    if (!metadata.isDirectory()) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        `${label} ancestor is not a directory`,
      );
    }
    if (created) await syncDirectory(path.dirname(current));
  }
}

function receiptPath(runId: string, root?: string): string {
  if (!RUN_ID_RE.test(runId)) throw new TypeError("runId must be a canonical ResearchRun id");
  return path.join(receiptRoot(root), `${runId}.json`);
}

function sameIdentity(
  left: Pick<PathIdentity, "dev" | "ino">,
  right: Pick<PathIdentity, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathIdentity(
  candidate: string,
  metadata: { dev: number | bigint; ino: number | bigint },
): PathIdentity {
  return { path: candidate, dev: metadata.dev, ino: metadata.ino };
}

function assertPrivateMode(mode: number, expected: number, label: string): void {
  if (process.platform === "win32") return;
  if ((mode & 0o777) !== expected) {
    throw new ResearchRunReceiptStoreError(
      "unsafe-path",
      `${label} permissions must be ${expected.toString(8)}`,
    );
  }
}

async function assertSafeOwnership(
  candidate: string,
  metadata: Awaited<ReturnType<typeof lstat>>,
  label: string,
): Promise<void> {
  try {
    await assertExclusivePathOwnership(candidate, metadata, label, {
      windowsAclCache: "fresh",
    });
  } catch (error) {
    throw new ResearchRunReceiptStoreError(
      "unsafe-path",
      `${label} ownership is unsafe`,
      { cause: error },
    );
  }
}

async function pathMetadata(candidate: string, missingMessage: string) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResearchRunReceiptStoreError("missing", missingMessage);
    }
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
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
  if (before.isSymbolicLink()) {
    throw new ResearchRunReceiptStoreError("symlink", `${label} is a symlink`);
  }
  if (!before.isDirectory()) {
    throw new ResearchRunReceiptStoreError("unsafe-path", `${label} is not a directory`);
  }
  await assertSafeOwnership(candidate, before, `Research run receipt ${label}`);
  assertPrivateMode(before.mode, DIRECTORY_MODE, label);
  const resolved = await realpath(candidate);
  if (rootRealPath !== null && !isWithin(rootRealPath, resolved)) {
    throw new ResearchRunReceiptStoreError("symlink", `${label} escapes the store root`);
  }
  const after = await pathMetadata(candidate, `${label} directory is missing`);
  if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) {
    throw new ResearchRunReceiptStoreError("symlink", `${label} identity changed`);
  }
  await assertSafeOwnership(candidate, after, `Research run receipt ${label}`);
  assertPrivateMode(after.mode, DIRECTORY_MODE, label);
  if (created) await syncDirectory(path.dirname(candidate));
  return pathIdentity(candidate, after);
}

async function assertStableDirectory(entry: PathIdentity, label: string): Promise<void> {
  const current = await pathMetadata(entry.path, `${label} directory is missing`);
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(entry, current)) {
    throw new ResearchRunReceiptStoreError("symlink", `${label} identity changed`);
  }
  await assertSafeOwnership(entry.path, current, `Research run receipt ${label}`);
  assertPrivateMode(current.mode, DIRECTORY_MODE, label);
}

async function openLayout(rootInput: string): Promise<StoreLayout> {
  const rootPath = receiptRoot(rootInput);
  const missionRootPath = path.resolve(researchMissionsRoot());
  const [resolvedRootCandidate, resolvedMissionCandidate] = await Promise.all([
    resolvedPathWithoutSymlinks(rootPath, "store root"),
    resolvedPathWithoutSymlinks(missionRootPath, "mission root"),
  ]);
  if (
    isWithin(resolvedRootCandidate, resolvedMissionCandidate)
    || isWithin(resolvedMissionCandidate, resolvedRootCandidate)
  ) {
    throw new Error("Research run receipt directory must be outside mission workspaces");
  }
  await createDirectoryTreeWithoutSymlinks(rootPath, "store root");
  const root = await ensureRealDirectory(rootPath, null, "store root");
  const rootRealPath = await realpath(rootPath);
  const resolvedMissionAfterCreation = await resolvedPathWithoutSymlinks(
    missionRootPath,
    "mission root",
  );
  if (
    isWithin(rootRealPath, resolvedMissionAfterCreation)
    || isWithin(resolvedMissionAfterCreation, rootRealPath)
  ) {
    throw new Error("Research run receipt directory must be outside mission workspaces");
  }
  const locksParent = path.join(rootPath, ".locks");
  const locksDir = path.join(locksParent, "intents");
  await ensureRealDirectory(locksParent, rootRealPath, "lock root");
  await ensureRealDirectory(locksDir, rootRealPath, "lock intents");
  return { root, rootRealPath, locksDir };
}

async function recoverStalePublications(layout: StoreLayout): Promise<void> {
  await assertStableDirectory(layout.root, "store root");
  const names = await readdir(layout.root.path);
  const receiptNames = names.filter((name) => RECEIPT_FILE_RE.test(name));
  let changed = false;
  for (const name of names) {
    if (!TEMPORARY_FILE_RE.test(name)) continue;
    const temporary = path.join(layout.root.path, name);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        "receipt temporary publication is unsafe",
      );
    }
    await assertSafeOwnership(temporary, metadata, "Research run receipt temporary");
    assertPrivateMode(metadata.mode, FILE_MODE, "receipt temporary publication");
    if (metadata.nlink === 1) {
      await rm(temporary);
      changed = true;
      continue;
    }
    if (metadata.nlink !== 2) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        "receipt temporary publication has an unsafe link count",
      );
    }
    const matchingTargets: string[] = [];
    for (const receiptName of receiptNames) {
      const target = path.join(layout.root.path, receiptName);
      const targetMetadata = await lstat(target);
      if (
        !targetMetadata.isSymbolicLink()
        && targetMetadata.isFile()
        && sameIdentity(metadata, targetMetadata)
      ) {
        matchingTargets.push(target);
      }
    }
    if (matchingTargets.length !== 1) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        "receipt temporary publication has no unique target",
      );
    }
    await rm(temporary);
    const published = await pathMetadata(
      matchingTargets[0],
      "receipt publication target is missing",
    );
    if (!published.isFile() || published.nlink !== 1 || !sameIdentity(metadata, published)) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        "receipt publication recovery is unsafe",
      );
    }
    changed = true;
  }
  if (changed) await syncDirectory(layout.root.path);
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

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (bytesWritten <= 0) throw new Error("Research run receipt write made no progress");
    offset += bytesWritten;
  }
}

async function readSafeFile(
  layout: StoreLayout,
  target: string,
  label: string,
): Promise<Uint8Array> {
  await assertStableDirectory(layout.root, "store root");
  const before = await pathMetadata(target, `${label} is missing`);
  if (before.isSymbolicLink()) {
    throw new ResearchRunReceiptStoreError("symlink", `${label} is a symlink`);
  }
  if (!before.isFile()) {
    throw new ResearchRunReceiptStoreError("unsafe-path", `${label} is not a regular file`);
  }
  if (before.nlink !== 1) {
    throw new ResearchRunReceiptStoreError("unsafe-path", `${label} must have exactly one link`);
  }
  if (before.size > MAX_RESEARCH_RUN_RECEIPT_BYTES) {
    throw new ResearchRunReceiptStoreError("too-large", `${label} exceeds its size limit`);
  }
  await assertSafeOwnership(target, before, `Research run ${label}`);
  assertPrivateMode(before.mode, FILE_MODE, label);

  let handle: FileHandle;
  try {
    handle = await open(target, readFlags());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new ResearchRunReceiptStoreError("symlink", `${label} is a symlink`);
    }
    if (code === "ENOENT") {
      throw new ResearchRunReceiptStoreError("missing", `${label} is missing`);
    }
    throw error;
  }
  try {
    const opened = await handle.stat();
    const after = await pathMetadata(target, `${label} is missing`);
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.size > MAX_RESEARCH_RUN_RECEIPT_BYTES
      || after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1
      || !sameIdentity(before, opened)
      || !sameIdentity(opened, after)
    ) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        `${label} identity changed while opening`,
      );
    }
    await assertSafeOwnership(target, after, `Research run ${label}`);
    assertPrivateMode(after.mode, FILE_MODE, label);
    const resolved = await realpath(target);
    if (!isWithin(layout.rootRealPath, resolved)) {
      throw new ResearchRunReceiptStoreError("symlink", `${label} escapes the store root`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_RESEARCH_RUN_RECEIPT_BYTES - total + 1),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_RESEARCH_RUN_RECEIPT_BYTES) {
        throw new ResearchRunReceiptStoreError(
          "too-large",
          `${label} exceeds its size limit`,
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return new Uint8Array(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
}

async function publishNoReplace(
  layout: StoreLayout,
  target: string,
  bytes: Uint8Array,
  label: string,
): Promise<void> {
  if (bytes.byteLength > MAX_RESEARCH_RUN_RECEIPT_BYTES) {
    throw new ResearchRunReceiptStoreError("too-large", `${label} exceeds its size limit`);
  }
  await assertStableDirectory(layout.root, "store root");
  const temporary = path.join(
    layout.root.path,
    `.tmp-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  let handle: FileHandle | null = null;
  let temporaryIdentity: Awaited<ReturnType<FileHandle["stat"]>> | null = null;
  let created = false;
  try {
    handle = await open(temporary, exclusiveWriteFlags(), FILE_MODE);
    temporaryIdentity = await handle.stat();
    const temporaryPathInfo = await lstat(temporary);
    if (
      !temporaryIdentity.isFile()
      || !sameIdentity(temporaryIdentity, temporaryPathInfo)
    ) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        `${label} temporary identity changed`,
      );
    }
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertStableDirectory(layout.root, "store root");
    const closedTemporary = await lstat(temporary);
    if (!sameIdentity(temporaryIdentity, closedTemporary)) {
      throw new ResearchRunReceiptStoreError(
        "symlink",
        `${label} temporary identity changed`,
      );
    }
    try {
      await link(temporary, target);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readSafeFile(layout, target, label);
      if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw new ResearchRunReceiptStoreError(
          "immutable-conflict",
          `${label} already exists with different bytes`,
        );
      }
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
  if (created) {
    const published = await pathMetadata(target, `${label} is missing`);
    if (
      !temporaryIdentity
      || !sameIdentity(temporaryIdentity, published)
      || !published.isFile()
      || published.nlink !== 1
    ) {
      throw new ResearchRunReceiptStoreError(
        "unsafe-path",
        `${label} publication is unsafe`,
      );
    }
    await assertSafeOwnership(target, published, `Research run ${label}`);
    assertPrivateMode(published.mode, FILE_MODE, label);
  }
  await syncDirectory(layout.root.path);
}

export function researchRunCompletionReceiptsRoot(override?: string): string {
  return receiptRoot(override);
}

export function researchRunCompletionReceiptPath(runId: string, root?: string): string {
  return receiptPath(runId, root);
}

export async function saveResearchRunCompletionReceipt(
  receipt: ResearchRunCompletionReceiptV1,
  root?: string,
): Promise<void> {
  assertReceiptStoreSupported(process.platform);
  const validated = validateResearchRunCompletionReceipt(receipt);
  if (!verifyResearchRunCompletionReceipt(validated)) {
    throw new TypeError("completion receipt integrity digest does not match its contents");
  }
  const serialized = serializeResearchRunCompletionReceipt(validated);
  const bytes = new TextEncoder().encode(serialized);
  const layout = await openLayout(receiptRoot(root));
  const target = path.join(layout.root.path, `${validated.runId}.json`);
  await withProcessIntentLock(
    { intentsDirectory: layout.locksDir, label: "research-run-receipt-store" },
    async () => {
      await recoverStalePublications(layout);
      await publishNoReplace(layout, target, bytes, `receipt ${validated.runId}`);
    },
  );
}

export async function loadResearchRunCompletionReceipt(
  runId: string,
  root?: string,
): Promise<ResearchRunCompletionReceiptV1 | null> {
  assertReceiptStoreSupported(process.platform);
  if (!RUN_ID_RE.test(runId)) throw new TypeError("runId must be a canonical ResearchRun id");
  const layout = await openLayout(receiptRoot(root));
  const target = path.join(layout.root.path, `${runId}.json`);
  return withProcessIntentLock(
    { intentsDirectory: layout.locksDir, label: "research-run-receipt-store" },
    async () => {
      await recoverStalePublications(layout);
      let bytes: Uint8Array;
      try {
        bytes = await readSafeFile(layout, target, `receipt ${runId}`);
      } catch (error) {
        if (error instanceof ResearchRunReceiptStoreError && error.code === "missing") {
          return null;
        }
        throw error;
      }

      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error("Research run completion receipt is malformed JSON");
      }
      const receipt = validateResearchRunCompletionReceipt(value);
      if (receipt.runId !== runId || !verifyResearchRunCompletionReceipt(receipt)) {
        throw new Error("Research run completion receipt failed integrity validation");
      }
      return receipt;
    },
  );
}
