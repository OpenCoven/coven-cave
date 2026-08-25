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
import {
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_SUITE,
  type ClientV1HpkeAuthority,
} from "./authority-contract.ts";
import { CLIENT_V1_DISCOVERY_CONTRACT } from "./contract.ts";
import {
  assertClientV1PathOwnership,
  type ClientV1PathOwnershipOptions,
} from "./path-ownership.ts";

export const CLIENT_V1_DISCOVERY_FILE = CLIENT_V1_DISCOVERY_CONTRACT.fileName;

export interface ClientV1DiscoveryRecordV1 {
  version: 1;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
}

export interface ClientV1DiscoveryRecordV2 {
  version: 2;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
  authority: ClientV1HpkeAuthority;
}

export type ClientV1DiscoveryRecord =
  | ClientV1DiscoveryRecordV1
  | ClientV1DiscoveryRecordV2;

export interface ClientV1DiscoveryOptions {
  isProcessAlive?: (pid: number) => boolean;
  ownership?: ClientV1PathOwnershipOptions;
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

function requireOwned(
  path: string,
  metadata: Awaited<ReturnType<typeof lstat>>,
  label: string,
  ownership: ClientV1PathOwnershipOptions | undefined,
): Promise<void> {
  return assertClientV1PathOwnership(path, metadata, `discovery ${label}`, ownership);
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

function requireDiscoveryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Client v1 discovery record must be an object.");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Client v1 discovery ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length
    || actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(
      `Client v1 discovery ${label} must contain exactly ${required.join(", ")}.`,
    );
  }
}

function requireLivePid(
  value: unknown,
  isProcessAlive: ((pid: number) => boolean) | undefined,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("Client v1 discovery pid must be a positive safe integer.");
  }
  const pid = value as number;
  if (!(isProcessAlive ?? processIsAlive)(pid)) {
    throw new Error("Client v1 discovery pid must identify a live process.");
  }
  return pid;
}

function requireCanonical32ByteBase64Url(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string"
    || value.includes("=")
    || !/^[A-Za-z0-9_-]{43}$/u.test(value)
  ) {
    throw new Error(
      `Client v1 discovery ${label} must be canonical unpadded base64url for exactly 32 bytes.`,
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new Error(
      `Client v1 discovery ${label} must be canonical unpadded base64url for exactly 32 bytes.`,
    );
  }
  return value;
}

function validateClientV1DiscoveryRecordV1(
  input: Record<string, unknown>,
  options: Pick<ClientV1DiscoveryOptions, "isProcessAlive">,
): ClientV1DiscoveryRecordV1 {
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
    pid: requireLivePid(input.pid, options.isProcessAlive),
    nonce: input.nonce,
    startedAt: requireTimestamp(input.startedAt),
  };
}

function validateClientV1DiscoveryRecordV2(
  input: Record<string, unknown>,
  options: Pick<ClientV1DiscoveryOptions, "isProcessAlive">,
): ClientV1DiscoveryRecordV2 {
  assertExactKeys(
    input,
    ["version", "endpoint", "pid", "nonce", "startedAt", "authority"],
    "version-2 record",
  );
  const authority = input.authority;
  assertExactKeys(
    authority,
    ["mechanism", "mode", "keyId", "publicKey", "suite"],
    "version-2 authority",
  );
  const suite = authority.suite;
  assertExactKeys(
    suite,
    ["kemId", "kdfId", "aeadId"],
    "version-2 authority suite",
  );
  if (authority.mechanism !== CLIENT_V1_HPKE_MECHANISM) {
    throw new Error("Client v1 discovery authority mechanism is invalid.");
  }
  if (authority.mode !== "advertise" && authority.mode !== "enforce") {
    throw new Error("Client v1 discovery authority mode must be advertise or enforce.");
  }
  if (
    suite.kemId !== CLIENT_V1_HPKE_SUITE.kemId
    || suite.kdfId !== CLIENT_V1_HPKE_SUITE.kdfId
    || suite.aeadId !== CLIENT_V1_HPKE_SUITE.aeadId
  ) {
    throw new Error("Client v1 discovery authority suite must be 32/1/2.");
  }
  return {
    version: 2,
    endpoint: requireEndpoint(input.endpoint),
    pid: requireLivePid(input.pid, options.isProcessAlive),
    nonce: requireCanonical32ByteBase64Url(input.nonce, "nonce"),
    startedAt: requireTimestamp(input.startedAt),
    authority: {
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      mode: authority.mode,
      keyId: requireCanonical32ByteBase64Url(
        authority.keyId,
        "authority keyId",
      ),
      publicKey: requireCanonical32ByteBase64Url(
        authority.publicKey,
        "authority publicKey",
      ),
      suite: {
        kemId: CLIENT_V1_HPKE_SUITE.kemId,
        kdfId: CLIENT_V1_HPKE_SUITE.kdfId,
        aeadId: CLIENT_V1_HPKE_SUITE.aeadId,
      },
    },
  };
}

export function validateClientV1DiscoveryRecord(
  value: unknown,
  options: Pick<ClientV1DiscoveryOptions, "isProcessAlive"> = {},
): ClientV1DiscoveryRecord {
  const input = requireDiscoveryObject(value);
  if (input.version === 1) {
    return validateClientV1DiscoveryRecordV1(input, options);
  }
  if (input.version === 2) {
    return validateClientV1DiscoveryRecordV2(input, options);
  }
  throw new Error("Client v1 discovery version must be 1 or 2.");
}

async function assertRegularTargetOrMissing(
  path: string,
  ownership: ClientV1PathOwnershipOptions | undefined,
): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(
        `Client v1 discovery target must be a regular file, not a symlink: ${path}.`,
      );
    }
    await requireOwned(path, metadata, "target", ownership);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function initializeLocation(
  configuredRoot: string,
  ownership: ClientV1PathOwnershipOptions | undefined,
): Promise<DiscoveryLocation> {
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
  // Ownership first: on Windows the assertion is also what restricts the
  // directory, and the chmod below is the no-op it has always been there.
  await requireOwned(physicalRoot, metadata, "root", ownership);
  await chmod(physicalRoot, 0o700);
  const path = join(physicalRoot, CLIENT_V1_DISCOVERY_FILE);
  await assertRegularTargetOrMissing(path, ownership);
  return { path, root: physicalRoot };
}

async function existingLocation(
  configuredRoot: string,
  ownership: ClientV1PathOwnershipOptions | undefined,
): Promise<DiscoveryLocation | null> {
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
  await requireOwned(physicalRoot, metadata, "root", ownership);
  return {
    path: join(physicalRoot, CLIENT_V1_DISCOVERY_FILE),
    root: physicalRoot,
  };
}

async function assertLocation(
  location: DiscoveryLocation,
  ownership: ClientV1PathOwnershipOptions | undefined,
): Promise<void> {
  const metadata = await lstat(location.root);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(location.root) !== location.root
  ) {
    throw new Error("Client v1 discovery root was replaced.");
  }
  await requireOwned(location.root, metadata, "root", ownership);
  await assertRegularTargetOrMissing(location.path, ownership);
}

export function clientV1DiscoveryPath(root = caveHome()): string {
  return join(root, CLIENT_V1_DISCOVERY_FILE);
}

export async function publishClientV1DiscoveryRecord(
  value: unknown,
  options: ClientV1DiscoveryOptions = {},
): Promise<ClientV1DiscoveryRecord> {
  const record = validateClientV1DiscoveryRecord(value, options);
  const location = await initializeLocation(options.root ?? caveHome(), options.ownership);
  const random = options.temporaryRandomBytes ?? randomBytes;

  return runExclusive(location.path, async () => {
    await assertLocation(location, options.ownership);
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
      await assertLocation(location, options.ownership);
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
  ownership,
  root = caveHome(),
}: {
  nonce: string;
  ownership?: ClientV1PathOwnershipOptions;
  root?: string;
}): Promise<boolean> {
  if (!nonce) return false;
  const location = await existingLocation(root, ownership);
  if (!location) return false;

  return runExclusive(location.path, async () => {
    await assertLocation(location, ownership);
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
    await requireOwned(location.path, before, "target", ownership);

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
