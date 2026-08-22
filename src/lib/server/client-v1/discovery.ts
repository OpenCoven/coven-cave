import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { caveHome } from "../../coven-paths.ts";
import { CLIENT_V1_DISCOVERY_CONTRACT } from "./contract.ts";

export const CLIENT_V1_DISCOVERY_FILE = CLIENT_V1_DISCOVERY_CONTRACT.fileName;

export interface ClientV1DiscoveryRecord {
  version: 1;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
}

export interface ClientV1DiscoveryOptions {
  isProcessAlive?: (pid: number) => boolean;
  root?: string;
  temporaryRandomBytes?: (size: number) => Buffer;
}

type DiscoveryLocation = {
  path: string;
  root: string;
};

const operationTails = new Map<string, Promise<void>>();

async function runExclusive<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationTails.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  operationTails.set(path, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (operationTails.get(path) === current) operationTails.delete(path);
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function requireOwned(metadata: Awaited<ReturnType<typeof lstat>>, label: string): void {
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error(`Client v1 discovery ${label} must be owned by the current user.`);
  }
}

function requireEndpoint(value: unknown): string {
  if (
    typeof value !== "string"
    || !value
    || /%(?:2f|5c)/i.test(value)
  ) {
    throw new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error(
      "Client v1 discovery endpoint must be a path-free loopback HTTP URL.",
      { cause },
    );
  }
  const loopback = url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]";
  if (
    url.protocol !== "http:"
    || !loopback
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("Client v1 discovery endpoint must be a path-free loopback HTTP URL.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Client v1 discovery endpoint must contain a valid port.");
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  const timestampPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== "string"
    || !timestampPattern.test(value)
    || !Number.isFinite(parsed)
    || parsed <= 0
  ) {
    throw new Error("Client v1 discovery startedAt must be a valid timestamp.");
  }
  return value;
}

export function validateClientV1DiscoveryRecord(
  value: unknown,
  options: Pick<ClientV1DiscoveryOptions, "isProcessAlive"> = {},
): ClientV1DiscoveryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Client v1 discovery record must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== 1) {
    throw new Error("Client v1 discovery version must be 1.");
  }
  if (!Number.isSafeInteger(input.pid) || (input.pid as number) < 1) {
    throw new Error("Client v1 discovery pid must be a positive safe integer.");
  }
  const pid = input.pid as number;
  if (!(options.isProcessAlive ?? processIsAlive)(pid)) {
    throw new Error("Client v1 discovery pid must identify a live process.");
  }
  if (
    typeof input.nonce !== "string"
    || !input.nonce.trim()
    || input.nonce.length > 256
  ) {
    throw new Error("Client v1 discovery nonce must be a non-empty string.");
  }
  return {
    version: 1,
    endpoint: requireEndpoint(input.endpoint),
    pid,
    nonce: input.nonce,
    startedAt: requireTimestamp(input.startedAt),
  };
}

async function assertRegularTargetOrMissing(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(
        `Client v1 discovery target must be a regular file, not a symlink: ${path}.`,
      );
    }
    requireOwned(metadata, "target");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function initializeLocation(configuredRoot: string): Promise<DiscoveryLocation> {
  const resolvedRoot = resolve(configuredRoot);
  try {
    const configuredMetadata = await lstat(resolvedRoot);
    if (configuredMetadata.isSymbolicLink()) {
      throw new Error("Client v1 discovery root must not be a symlink.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  }

  const physicalRoot = await realpath(resolvedRoot);
  const metadata = await lstat(physicalRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Client v1 discovery root must be a real directory.");
  }
  requireOwned(metadata, "root");
  await chmod(physicalRoot, 0o700);
  const path = join(physicalRoot, CLIENT_V1_DISCOVERY_FILE);
  await assertRegularTargetOrMissing(path);
  return { path, root: physicalRoot };
}

async function existingLocation(configuredRoot: string): Promise<DiscoveryLocation | null> {
  const resolvedRoot = resolve(configuredRoot);
  try {
    const configuredMetadata = await lstat(resolvedRoot);
    if (configuredMetadata.isSymbolicLink()) {
      throw new Error("Client v1 discovery root must not be a symlink.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const physicalRoot = await realpath(resolvedRoot);
  const metadata = await lstat(physicalRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Client v1 discovery root must be a real directory.");
  }
  requireOwned(metadata, "root");
  return {
    path: join(physicalRoot, CLIENT_V1_DISCOVERY_FILE),
    root: physicalRoot,
  };
}

async function assertLocation(location: DiscoveryLocation): Promise<void> {
  const metadata = await lstat(location.root);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(location.root) !== location.root
  ) {
    throw new Error("Client v1 discovery root was replaced.");
  }
  requireOwned(metadata, "root");
  await assertRegularTargetOrMissing(location.path);
}

export function clientV1DiscoveryPath(root = caveHome()): string {
  return join(root, CLIENT_V1_DISCOVERY_FILE);
}

export async function publishClientV1DiscoveryRecord(
  value: unknown,
  options: ClientV1DiscoveryOptions = {},
): Promise<ClientV1DiscoveryRecord> {
  const record = validateClientV1DiscoveryRecord(value, options);
  const location = await initializeLocation(options.root ?? caveHome());
  const random = options.temporaryRandomBytes ?? randomBytes;

  return runExclusive(location.path, async () => {
    await assertLocation(location);
    const temporaryPath =
      `${location.path}.${process.pid}.${random(6).toString("hex")}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let ownsTemporaryPath = false;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      ownsTemporaryPath = true;
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = null;
      await assertLocation(location);
      await rename(temporaryPath, location.path);
      ownsTemporaryPath = false;
      await chmod(location.path, 0o600);
      return { ...record };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (ownsTemporaryPath) {
        await rm(temporaryPath, { force: true }).catch(() => {});
      }
      throw error;
    }
  });
}

export async function removeClientV1DiscoveryRecord({
  nonce,
  root = caveHome(),
}: {
  nonce: string;
  root?: string;
}): Promise<boolean> {
  if (!nonce) return false;
  const location = await existingLocation(root);
  if (!location) return false;

  return runExclusive(location.path, async () => {
    await assertLocation(location);
    let before: Awaited<ReturnType<typeof lstat>>;
    let raw: string;
    try {
      before = await lstat(location.path);
      raw = await readFile(location.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("Client v1 discovery target must be a regular file.");
    }
    requireOwned(before, "target");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    let record: ClientV1DiscoveryRecord;
    try {
      record = validateClientV1DiscoveryRecord(parsed);
    } catch {
      return false;
    }
    if (record.nonce !== nonce) return false;

    const current = await lstat(location.path);
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || current.dev !== before.dev
      || current.ino !== before.ino
    ) {
      return false;
    }
    await rm(location.path);
    return true;
  });
}
