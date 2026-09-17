import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic as writeGenericFileAtomic } from "@/lib/server/atomic-write";
import {
  backupRoots,
  createBackupManifest,
  isAllowedBackupEntry,
  listBackupFiles,
  normalizeBackupPath,
  RESEARCH_BACKUP_EXCLUSIONS,
  resolveBackupEntryPath,
  type BackupSourceFile,
  type BackupEntry,
  type BackupManifest,
  type BackupRoot,
} from "@/lib/server/backup-manifest";
import {
  reconcileRestoredResearchResources,
  researchResourceRestoreMarkerPath,
  type ResearchResourceRecoveryResult,
} from "@/lib/server/research-resource-recovery";
import {
  fsyncResearchRestoreDirectory,
  removeResearchRestoreDirectoryDurably,
  unlinkResearchRestoreFileDurably,
  writeResearchRestoreFileDurably,
  type ResearchRestoreDurabilityObserver,
} from "@/lib/server/research-resource-restore-durability";
import {
  createResearchResourceStore,
  withResearchResourceMaintenanceLock,
} from "@/lib/server/research-resource-store";
import {
  closeCanonicalResearchResourceLexicalHandlesForRestore,
  RESEARCH_LEXICAL_RESTORE_MARKER,
} from "@/lib/server/research-resource-lexical-index";


export const BACKUP_ARCHIVE_MAGIC = "COVEN-CAVE-BACKUP";
export const BACKUP_ARCHIVE_VERSION = 1;
const KDF = { name: "scrypt" as const, N: 16384, r: 8, p: 1, keyBytes: 32 };
const CIPHER = "aes-256-gcm" as const;

export type BackupArchiveHeader = {
  magic: typeof BACKUP_ARCHIVE_MAGIC;
  version: typeof BACKUP_ARCHIVE_VERSION;
  createdAt: string;
  kdf: typeof KDF & { salt: string };
  cipher: typeof CIPHER;
  iv: string;
  tag: string;
};

export type ArchiveFile = {
  root: BackupRoot;
  path: string;
  bytes: number;
  sha256: string;
  secret: boolean;
  data: string;
};

export type ArchivePlaintext = {
  manifest: BackupManifest;
  files: ArchiveFile[];
};

export type RestoredBackup = {
  manifest: BackupManifest;
  restored: Array<{ root: BackupRoot; path: string; bytes: number; secret: boolean }>;
  researchRecovery?: ResearchResourceRecoveryResult;
};

export type RestoreBackupOptions = {
  reconcileResearch?: (root: string) => Promise<ResearchResourceRecoveryResult>;
  researchFailpoint?: (phase: "lexical-unavailable") => void | Promise<void>;
  researchDurabilityObserver?: ResearchRestoreDurabilityObserver;
};

export type BuildBackupOptions = {
  /** Test-only seam for deterministic scan/read race coverage. */
  beforeSourceRead?: (file: BackupSourceFile) => void | Promise<void>;
};

function sameBackupSourceIdentity(
  expected: NonNullable<BackupSourceFile["identity"]>,
  actual: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return actual.isFile() && actual.nlink === 1
    && actual.dev === expected.dev && actual.ino === expected.ino
    && actual.size === expected.size && actual.mtimeMs === expected.mtimeMs
    && actual.ctimeMs === expected.ctimeMs;
}

async function assertBackupSourceAncestors(file: BackupSourceFile): Promise<void> {
  for (const expected of file.ancestorIdentities ?? []) {
    const actual = await lstat(expected.path);
    if (
      !actual.isDirectory()
      || actual.isSymbolicLink()
      || actual.dev !== expected.dev
      || actual.ino !== expected.ino
    ) {
      throw new Error("Research backup directory identity changed before the file could be read safely");
    }
  }
}

async function readBackupSource(file: BackupSourceFile): Promise<Buffer> {
  if (!file.identity) return readFile(file.fullPath);
  await assertBackupSourceAncestors(file);
  const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
  const handle = await open(file.fullPath, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!sameBackupSourceIdentity(file.identity, before)) {
      throw new Error("Research backup entry changed before it could be read safely");
    }
    const data = await handle.readFile();
    const after = await handle.stat();
    if (!sameBackupSourceIdentity(file.identity, after)) {
      throw new Error("Research backup entry changed while it was being read");
    }
    await assertBackupSourceAncestors(file);
    return data;
  } finally {
    await handle.close();
  }
}

async function hardenResearchRestorePath(target: string, researchRoot: string): Promise<void> {
  let directory = path.dirname(target);
  while (directory === researchRoot || directory.startsWith(`${researchRoot}${path.sep}`)) {
    await chmod(directory, 0o700).catch((error) => {
      if (process.platform !== "win32") throw error;
    });
    if (directory === researchRoot) break;
    directory = path.dirname(directory);
  }
  await chmod(target, 0o600).catch((error) => {
    if (process.platform !== "win32") throw error;
  });
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("Research backup restore target is unsafe");
  }
}

async function prepareResearchRestorePath(
  target: string,
  researchRoot: string,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<void> {
  const createdRoot = await mkdir(researchRoot, { recursive: true, mode: 0o700 });
  if (createdRoot) await fsyncResearchRestoreDirectory(path.dirname(researchRoot), observer);
  const relativeParent = path.relative(researchRoot, path.dirname(target));
  if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
    throw new Error("Research backup restore path escapes its root");
  }
  const directories = [researchRoot];
  let directory = researchRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    directory = path.join(directory, segment);
    let created = false;
    await mkdir(directory, { mode: 0o700 }).then(() => { created = true; }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    if (created) await fsyncResearchRestoreDirectory(path.dirname(directory), observer);
    directories.push(directory);
  }
  for (const current of directories) {
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Research backup restore directory is unsafe");
    }
  }
}

const RESEARCH_AUTHORITATIVE_DIRECTORIES = [
  "manifests", "snapshots", "blobs", "tombstones", "migration",
] as const;

async function pruneResearchAuthority(
  researchRoot: string,
  archivedPaths: ReadonlySet<string>,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<void> {
  const structuralDirectories = new Set([
    path.join(researchRoot, "blobs", "sha256"),
  ]);
  for (const relativeDirectory of RESEARCH_AUTHORITATIVE_DIRECTORIES) {
    const directory = path.join(/* turbopackIgnore: true */ researchRoot, relativeDirectory);
    await prepareResearchRestorePath(
      path.join(directory, ".restore-placeholder"),
      researchRoot,
      observer,
    );
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()) || (metadata.isFile() && metadata.nlink !== 1)) {
          throw new Error("Research backup restore entry is unsafe");
        }
        if (metadata.isDirectory()) {
          await walk(candidate);
          if (!structuralDirectories.has(candidate) && (await readdir(candidate)).length === 0) {
            await removeResearchRestoreDirectoryDurably(candidate, observer);
          }
          continue;
        }
        const archivePath = `research-resources/${path.relative(researchRoot, candidate).split(path.sep).join("/")}`;
        if (!archivedPaths.has(archivePath)) {
          await unlinkResearchRestoreFileDurably(candidate, observer);
        }
      }
    };
    await walk(directory);
  }
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`backup archive ${label} are invalid`);
  }
}

function hasResearchMarker(manifest: BackupManifest): boolean {
  return RESEARCH_BACKUP_EXCLUSIONS.every((entry) => manifest.excluded.includes(entry));
}

async function makeResearchLexicalUnavailable(
  researchRoot: string,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<string> {
  const indexDirectory = path.join(researchRoot, "index");
  const createdIndex = await mkdir(indexDirectory, { recursive: true, mode: 0o700 });
  if (createdIndex) await fsyncResearchRestoreDirectory(path.dirname(indexDirectory), observer);
  const info = await lstat(indexDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Research lexical restore directory is unsafe");
  }
  const marker = researchResourceRestoreMarkerPath(researchRoot);
  await writeResearchRestoreFileDurably(
    marker,
    `${JSON.stringify({ version: 1, phase: "preparing" })}\n`,
    observer,
  );
  await chmod(marker, 0o600).catch((error) => {
    if (process.platform !== "win32") throw error;
  });
  closeCanonicalResearchResourceLexicalHandlesForRestore(
    path.join(indexDirectory, "research-resources.sqlite"),
  );
  const removeLexicalFile = async (candidate: string): Promise<void> => {
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await rm(candidate, { force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!new Set(["EACCES", "EBUSY", "EPERM"]).has(code) || Date.now() >= deadline) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    }
  };
  for (const entry of await readdir(indexDirectory, { withFileTypes: true })) {
    if (entry.name === RESEARCH_LEXICAL_RESTORE_MARKER) continue;
    if (
      entry.name === "research-resources.sqlite"
      || entry.name.startsWith("research-resources.sqlite-")
      || entry.name.startsWith("research-resources.sqlite.")
      || entry.name.startsWith(".research-lexical-")
      || entry.name.startsWith(".restore-recovery-")
    ) {
      if (!entry.isFile()) throw new Error("Research lexical restore entry is unsafe");
      await removeLexicalFile(path.join(indexDirectory, entry.name));
    }
  }
  await fsyncResearchRestoreDirectory(indexDirectory, observer);
  return marker;
}


function octal(value: number, width: number): string {
  const raw = value.toString(8);
  if (raw.length > width - 1) throw new Error("backup tar field is too large");
  return raw.padStart(width - 1, "0") + "\0";
}

function writeAscii(target: Buffer, offset: number, width: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > width) throw new Error("backup tar path is too long");
  bytes.copy(target, offset, 0, bytes.length);
}

function splitTarName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const leaf = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(leaf) <= 100) return { name: leaf, prefix };
  }
  throw new Error("backup tar path is too long");
}

function tarHeader(name: string, data: Buffer, mode: number, mtime: number): Buffer {
  const header = Buffer.alloc(512);
  const split = splitTarName(name);
  writeAscii(header, 0, 100, split.name);
  writeAscii(header, 100, 8, octal(mode, 8));
  writeAscii(header, 108, 8, octal(0, 8));
  writeAscii(header, 116, 8, octal(0, 8));
  writeAscii(header, 124, 12, octal(data.byteLength, 12));
  writeAscii(header, 136, 12, octal(mtime, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeAscii(header, 257, 6, "ustar");
  writeAscii(header, 263, 2, "00");
  writeAscii(header, 345, 155, split.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, octal(checksum, 8).replace("\0", " "));
  header[155] = 0;
  return header;
}

function tarPadding(size: number): Buffer {
  const remainder = size % 512;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - remainder);
}

function createTar(archive: ArchivePlaintext): Buffer {
  const chunks: Buffer[] = [];
  const mtime = Math.floor(Date.parse(archive.manifest.createdAt) / 1000) || Math.floor(Date.now() / 1000);
  const manifestData = Buffer.from(JSON.stringify(archive.manifest, null, 2), "utf8");
  chunks.push(tarHeader("backup-manifest.json", manifestData, 0o600, mtime), manifestData, tarPadding(manifestData.byteLength));
  for (const file of archive.files) {
    const data = Buffer.from(file.data, "base64");
    const name = `${file.root}/${file.path}`;
    chunks.push(tarHeader(name, data, file.secret ? 0o600 : 0o644, mtime), data, tarPadding(data.byteLength));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function readString(block: Buffer, offset: number, width: number): string {
  const slice = block.subarray(offset, offset + width);
  const end = slice.findIndex((byte) => byte === 0);
  return slice.subarray(0, end >= 0 ? end : undefined).toString("utf8").trim();
}

function readOctal(block: Buffer, offset: number, width: number): number {
  const raw = readString(block, offset, width).replace(/\s+$/g, "");
  return raw ? Number.parseInt(raw, 8) : 0;
}

function parseTar(data: Buffer): ArchivePlaintext {
  let offset = 0;
  let manifest: BackupManifest | null = null;
  const files: ArchiveFile[] = [];
  while (offset + 512 <= data.byteLength) {
    const header = data.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const expected = readOctal(header, 148, 8);
    const checkHeader = Buffer.from(header);
    checkHeader.fill(0x20, 148, 156);
    const actual = checkHeader.reduce((sum, byte) => sum + byte, 0);
    if (expected !== actual) throw new Error("backup tar checksum mismatch");
    const size = readOctal(header, 124, 12);
    if (offset + size > data.byteLength) throw new Error("backup tar entry is partial");
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const body = data.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    if (fullName === "backup-manifest.json") {
      manifest = JSON.parse(body.toString("utf8")) as BackupManifest;
      continue;
    }
    const slash = fullName.indexOf("/");
    const root = fullName.slice(0, slash) as BackupRoot;
    const rel = fullName.slice(slash + 1);
    files.push({ root, path: rel, bytes: body.byteLength, sha256: sha256(body), secret: false, data: body.toString("base64") });
  }
  if (!manifest) throw new Error("backup tar manifest is missing");
  const secretByPath = new Map(manifest.entries.map((entry) => [`${entry.root}:${entry.path}`, entry.secret]));
  return { manifest, files: files.map((file) => ({ ...file, secret: secretByPath.get(`${file.root}:${file.path}`) === true })) };
}

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    throw new Error("backup passphrase must be at least 8 characters");
  }
}

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCb(passphrase, salt, KDF.keyBytes, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function encode(header: BackupArchiveHeader, ciphertext: Buffer): Buffer {
  return Buffer.from(`${JSON.stringify(header)}\n${ciphertext.toString("base64")}\n`, "utf8");
}

function decode(archive: Uint8Array): { header: BackupArchiveHeader; ciphertext: Buffer } {
  const raw = Buffer.from(archive).toString("utf8");
  const newline = raw.indexOf("\n");
  if (newline <= 0) throw new Error("backup archive is missing its header");
  let header: BackupArchiveHeader;
  try {
    header = JSON.parse(raw.slice(0, newline)) as BackupArchiveHeader;
  } catch {
    throw new Error("backup archive header is invalid");
  }
  if (header.magic !== BACKUP_ARCHIVE_MAGIC || header.version !== BACKUP_ARCHIVE_VERSION) {
    throw new Error("backup archive version is unsupported");
  }
  if (header.cipher !== CIPHER || header.kdf?.name !== "scrypt") {
    throw new Error("backup archive crypto is unsupported");
  }
  const body = raw.slice(newline + 1).trim();
  if (!body) throw new Error("backup archive is missing ciphertext");
  return { header, ciphertext: Buffer.from(body, "base64") };
}

function aadFor(header: Omit<BackupArchiveHeader, "tag">): Buffer {
  return Buffer.from(JSON.stringify(header), "utf8");
}

async function encryptArchivePlaintext(archive: ArchivePlaintext, passphrase: string): Promise<Buffer> {
  const plaintext = createTar(archive);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const headerWithoutTag = {
    magic: BACKUP_ARCHIVE_MAGIC,
    version: BACKUP_ARCHIVE_VERSION,
    createdAt: archive.manifest.createdAt,
    kdf: { ...KDF, salt: salt.toString("base64") },
    cipher: CIPHER,
    iv: iv.toString("base64"),
  } satisfies Omit<BackupArchiveHeader, "tag">;
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(aadFor(headerWithoutTag));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = { ...headerWithoutTag, tag: cipher.getAuthTag().toString("base64") } satisfies BackupArchiveHeader;
  return encode(header, ciphertext);
}

/** Test-only helper for proving validation of authenticated malformed payloads. */
export async function encryptBackupPlaintextForTest(
  archive: ArchivePlaintext,
  passphrase: string,
): Promise<Buffer> {
  assertPassphrase(passphrase);
  return encryptArchivePlaintext(archive, passphrase);
}

export async function buildBackupArchive(
  passphrase: string,
  options: BuildBackupOptions = {},
): Promise<{ archive: Buffer; manifest: BackupManifest }> {
  assertPassphrase(passphrase);
  const files = [] as ArchiveFile[];
  const entries = [] as BackupEntry[];
  for (const file of await listBackupFiles()) {
    await options.beforeSourceRead?.(file);
    const data = await readBackupSource(file);
    const digest = sha256(data);
    const entry = { root: file.root, path: file.rel, bytes: data.byteLength, sha256: digest, secret: file.secret, optional: file.optional };
    entries.push(entry);
    files.push({ ...entry, data: data.toString("base64") });
  }

  const manifest = createBackupManifest(entries);
  return { archive: await encryptArchivePlaintext({ manifest, files }, passphrase), manifest };
}

export async function decryptBackupArchive(archive: Uint8Array, passphrase: string): Promise<ArchivePlaintext> {
  assertPassphrase(passphrase);
  const { header, ciphertext } = decode(archive);
  const salt = Buffer.from(header.kdf.salt, "base64");
  const iv = Buffer.from(header.iv, "base64");
  const tag = Buffer.from(header.tag, "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error("backup archive header is invalid");
  const key = await deriveKey(passphrase, salt);
  const { tag: _tag, ...headerWithoutTag } = header;
  const decipher = createDecipheriv(CIPHER, key, iv);
  decipher.setAAD(aadFor(headerWithoutTag));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("backup archive could not be decrypted");
  }
  const parsed = parseTar(plaintext);
  validateArchivePlaintext(parsed);
  return parsed;
}

export function validateArchivePlaintext(archive: ArchivePlaintext): void {
  if (archive?.manifest?.version !== 1 || !Array.isArray(archive.files)) throw new Error("backup archive payload is invalid");
  const manifest = archive.manifest as BackupManifest;
  if (
    typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))
    || typeof manifest.roots !== "object" || manifest.roots === null
    || typeof manifest.roots.cave !== "string" || typeof manifest.roots.coven !== "string"
    || !Array.isArray(manifest.entries)
    || typeof manifest.totals !== "object" || manifest.totals === null
    || !Number.isSafeInteger(manifest.totals.files) || manifest.totals.files < 0
    || !Number.isSafeInteger(manifest.totals.bytes) || manifest.totals.bytes < 0
    || typeof manifest.secretsPolicy !== "object" || manifest.secretsPolicy === null
    || manifest.secretsPolicy.vaultKey !== "include-passphrase-wrapped"
    || manifest.secretsPolicy.plaintextSecrets !== "encrypted-envelope-only"
  ) throw new Error("backup archive manifest is invalid");
  assertStringArray(manifest.excluded, "manifest exclusions");
  assertStringArray(manifest.knownGaps, "manifest known gaps");
  if (new Set(manifest.excluded).size !== manifest.excluded.length) {
    throw new Error("backup archive manifest exclusions are invalid");
  }
  const hasAnyResearchMarker = RESEARCH_BACKUP_EXCLUSIONS.some((entry) => manifest.excluded.includes(entry));
  if (hasAnyResearchMarker && !hasResearchMarker(manifest)) {
    throw new Error("backup archive Research marker is incomplete");
  }
  for (const entry of manifest.entries) {
    if (
      typeof entry !== "object" || entry === null
      || (entry.root !== "cave" && entry.root !== "coven")
      || typeof entry.path !== "string"
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || typeof entry.secret !== "boolean"
      || (entry.optional !== undefined && typeof entry.optional !== "boolean")
    ) throw new Error("backup archive manifest entry is invalid");
  }
  const manifestEntries = new Map(archive.manifest.entries.map((entry) => [`${entry.root}:${entry.path}`, entry]));
  if (manifestEntries.size !== archive.manifest.entries.length || archive.files.length !== archive.manifest.entries.length) {
    throw new Error("backup archive manifest does not match payload");
  }
  let totalBytes = 0;
  for (const file of archive.files) {
    const rel = normalizeBackupPath(file.path);
    if (file.path !== rel || (file.root !== "coven" && file.root !== "cave") || !isAllowedBackupEntry(file.root, rel)) {
      throw new Error("backup archive contains a path not allowed");
    }
    const data = Buffer.from(file.data, "base64");
    const digest = sha256(data);
    if (!timingSafeEqual(Buffer.from(digest), Buffer.from(file.sha256))) {
      throw new Error("backup archive file checksum mismatch");
    }
    const entry = manifestEntries.get(`${file.root}:${rel}`);
    if (!entry || entry.bytes !== data.byteLength || entry.sha256 !== digest || entry.secret !== file.secret) {
      throw new Error("backup archive manifest does not match payload");
    }
    totalBytes += data.byteLength;
  }
  const hasResearchFiles = archive.files.some((file) =>
    file.root === "cave" && file.path.startsWith("research-resources/"));
  if (hasResearchFiles && !hasResearchMarker(manifest)) {
    throw new Error("backup archive Research marker is missing");
  }
  if (archive.manifest.totals.files !== archive.files.length || archive.manifest.totals.bytes !== totalBytes) {
    throw new Error("backup archive totals are invalid");
  }
}

export async function restoreBackupArchive(
  archiveBytes: Uint8Array,
  passphrase: string,
  options: RestoreBackupOptions = {},
): Promise<RestoredBackup> {
  const archive = await decryptBackupArchive(archiveBytes, passphrase);
  const restored: RestoredBackup["restored"] = [];
  const roots = backupRoots();
  const researchRoot = path.join(roots.cave, "research-resources");
  const hasResearchResources = archive.files.some((file) =>
    file.root === "cave" && file.path.startsWith("research-resources/"))
    || hasResearchMarker(archive.manifest);
  const writeArchiveFiles = async (): Promise<void> => {
    for (const file of archive.files) {
      const target = resolveBackupEntryPath(file.root, file.path, roots);
      const data = Buffer.from(file.data, "base64");
      const researchFile = file.root === "cave" && file.path.startsWith("research-resources/");
      if (researchFile) {
        await prepareResearchRestorePath(target, researchRoot, options.researchDurabilityObserver);
      }
      else await mkdir(path.dirname(target), { recursive: true });
      if (researchFile) {
        await writeResearchRestoreFileDurably(target, data, options.researchDurabilityObserver);
      } else {
        await writeGenericFileAtomic(target, data);
      }
      if (researchFile) await hardenResearchRestorePath(target, researchRoot);
      else if (file.secret) await chmod(target, 0o600).catch(() => {});
      restored.push({ root: file.root, path: file.path, bytes: data.byteLength, secret: file.secret });
    }
  };
  if (!hasResearchResources) {
    await writeArchiveFiles();
    return { manifest: archive.manifest, restored };
  }

  return withResearchResourceMaintenanceLock(researchRoot, async () => {
    const store = createResearchResourceStore({ root: researchRoot });
    const lexicalMarker = await makeResearchLexicalUnavailable(
      researchRoot,
      options.researchDurabilityObserver,
    );
    await options.researchFailpoint?.("lexical-unavailable");
    await writeArchiveFiles();
    await pruneResearchAuthority(
      researchRoot,
      new Set(archive.files.filter((file) => file.root === "cave").map((file) => file.path)),
      options.researchDurabilityObserver,
    );
    await writeResearchRestoreFileDurably(
      lexicalMarker,
      `${JSON.stringify({ version: 1, phase: "authority-ready" })}\n`,
      options.researchDurabilityObserver,
    );
    const researchRecovery = await (
      options.reconcileResearch
        ?? ((root) => reconcileRestoredResearchResources({ root, store, resetOperationalState: true }))
    )(researchRoot);
    await unlinkResearchRestoreFileDurably(
      lexicalMarker,
      options.researchDurabilityObserver,
      { missingOk: true },
    );
    return { manifest: archive.manifest, restored, researchRecovery };
  });
}
