import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, chmod } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/server/atomic-write";
import {
  backupRoots,
  createBackupManifest,
  isAllowedBackupEntry,
  listBackupFiles,
  normalizeBackupPath,
  resolveBackupEntryPath,
  type BackupEntry,
  type BackupManifest,
  type BackupRoot,
} from "@/lib/server/backup-manifest";


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
};

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
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

export async function buildBackupArchive(passphrase: string): Promise<{ archive: Buffer; manifest: BackupManifest }> {
  assertPassphrase(passphrase);
  const files = [] as ArchiveFile[];
  const entries = [] as BackupEntry[];
  for (const file of await listBackupFiles()) {
    const data = await readFile(file.fullPath);
    const digest = sha256(data);
    const entry = { root: file.root, path: file.rel, bytes: data.byteLength, sha256: digest, secret: file.secret, optional: file.optional };
    entries.push(entry);
    files.push({ ...entry, data: data.toString("base64") });
  }

  const manifest = createBackupManifest(entries);
  const plaintext = createTar({ manifest, files });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const headerWithoutTag = {
    magic: BACKUP_ARCHIVE_MAGIC,
    version: BACKUP_ARCHIVE_VERSION,
    createdAt: manifest.createdAt,
    kdf: { ...KDF, salt: salt.toString("base64") },
    cipher: CIPHER,
    iv: iv.toString("base64"),
  } satisfies Omit<BackupArchiveHeader, "tag">;
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(aadFor(headerWithoutTag));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = { ...headerWithoutTag, tag: cipher.getAuthTag().toString("base64") } satisfies BackupArchiveHeader;
  return { archive: encode(header, ciphertext), manifest };
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
  if (archive.manifest.totals.files !== archive.files.length || archive.manifest.totals.bytes !== totalBytes) {
    throw new Error("backup archive totals are invalid");
  }
}

export async function restoreBackupArchive(archiveBytes: Uint8Array, passphrase: string): Promise<RestoredBackup> {
  const archive = await decryptBackupArchive(archiveBytes, passphrase);
  const restored: RestoredBackup["restored"] = [];
  const roots = backupRoots();
  for (const file of archive.files) {
    const target = resolveBackupEntryPath(file.root, file.path, roots);
    const data = Buffer.from(file.data, "base64");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFileAtomic(target, data);
    if (file.secret) await chmod(target, 0o600).catch(() => {});
    restored.push({ root: file.root, path: file.path, bytes: data.byteLength, secret: file.secret });
  }
  return { manifest: archive.manifest, restored };
}
