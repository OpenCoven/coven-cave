import { inflateRawSync, gunzipSync } from "node:zlib";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, symlink } from "node:fs/promises";
import path from "node:path";

const MAX_EXPANDED_BYTES = 768_000_000;
const MAX_ENTRIES = 20_000;

function archiveError(message: string): Error {
  return new Error(`managed Node archive rejected: ${message}`);
}

function u16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function tarNumber(buffer: Buffer, field: string): number {
  const text = buffer.toString("utf8").replace(/\0/g, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw archiveError(`tar entry has an invalid ${field}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw archiveError(`tar entry has an invalid ${field}`);
  return value;
}

/** Reject absolute paths, parent traversal, NUL bytes, and Windows drive paths. */
export function safeArchiveDestination(root: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw archiveError("entry path is absolute or empty");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw archiveError("entry path escapes its archive root");
  }
  const destination = path.resolve(root, ...parts);
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw archiveError("entry path escapes its archive root");
  }
  return destination;
}

async function ensureArchiveDirectory(root: string, directory: string): Promise<void> {
  const relative = path.relative(root, directory);
  if (!relative) return;
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const details = await lstat(current);
      if (!details.isDirectory() || details.isSymbolicLink()) {
        throw archiveError("entry path crosses a link or non-directory");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await mkdir(current);
    }
  }
}

async function writeArchiveEntry(root: string, name: string, data: Buffer, directory: boolean, mode = 0o644) {
  const destination = safeArchiveDestination(root, name);
  if (directory) {
    await ensureArchiveDirectory(root, destination);
    await chmod(destination, mode & 0o777);
    return;
  }
  await ensureArchiveDirectory(root, path.dirname(destination));
  let handle;
  try {
    handle = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode & 0o777);
    await handle.writeFile(data);
    await handle.chmod(mode & 0o777);
  } catch (error) {
    throw archiveError(error instanceof Error ? `could not create regular file (${error.message})` : "could not create regular file");
  } finally {
    await handle?.close();
  }
}

function safeArchiveLinkTarget(root: string, entryName: string, linkName: string): string {
  if (!linkName || linkName.includes("\0") || linkName.startsWith("/") || /^[A-Za-z]:/.test(linkName)) {
    throw archiveError("link target is absolute or empty");
  }
  const destination = safeArchiveDestination(root, entryName);
  const resolvedTarget = path.resolve(path.dirname(destination), ...linkName.replace(/\\/g, "/").split("/"));
  const relative = path.relative(root, resolvedTarget);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw archiveError("link target escapes its archive root");
  }
  return linkName;
}

async function writeArchiveLink(root: string, name: string, linkName: string): Promise<void> {
  const destination = safeArchiveDestination(root, name);
  const target = safeArchiveLinkTarget(root, name, linkName);
  await ensureArchiveDirectory(root, path.dirname(destination));
  try {
    await symlink(target, destination);
  } catch (error) {
    throw archiveError(error instanceof Error ? `could not create symbolic link (${error.message})` : "could not create symbolic link");
  }
}

/** Extract a gzip tar archive without permitting special files or traversal. */
export async function extractSafeTarGz(archive: Buffer, destination: string): Promise<void> {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch (error) {
    throw archiveError(error instanceof Error ? `could not decompress tar.gz (${error.message})` : "could not decompress tar.gz");
  }
  let offset = 0;
  let entries = 0;
  let expanded = 0;
  const links: Array<{ name: string; target: string }> = [];
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.length !== 512) throw archiveError("tar header is truncated");
    if (header.every((byte) => byte === 0)) break;
    if (++entries > MAX_ENTRIES) throw archiveError("too many archive entries");
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const entryName = prefix ? `${prefix}/${name}` : name;
    const mode = tarNumber(header.subarray(100, 108), "mode");
    const size = tarNumber(header.subarray(124, 136), "size");
    const type = String.fromCharCode(header[156] || 0);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw archiveError("tar entry is truncated");
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw archiveError("expanded archive exceeds the safe limit");
    if (type === "0" || type === "\0") {
      await writeArchiveEntry(destination, entryName, tar.subarray(dataStart, dataEnd), false, mode);
    } else if (type === "5") {
      await writeArchiveEntry(destination, entryName, Buffer.alloc(0), true, mode);
    } else if (type === "2") {
      const target = header.subarray(157, 257).toString("utf8").replace(/\0.*$/, "");
      safeArchiveLinkTarget(destination, entryName, target);
      links.push({ name: entryName, target });
    } else {
      throw archiveError("archive contains an unsupported entry type");
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  for (const link of links) await writeArchiveLink(destination, link.name, link.target);
}

function zipEndOfCentralDirectoryOffset(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw archiveError("zip central directory is missing");
}

/** Extract a conventional (non-encrypted, non-ZIP64) zip archive safely. */
export async function extractSafeZip(archive: Buffer, destination: string): Promise<void> {
  const end = zipEndOfCentralDirectoryOffset(archive);
  const entryCount = u16(archive, end + 10);
  const centralSize = u32(archive, end + 12);
  let offset = u32(archive, end + 16);
  if (entryCount > MAX_ENTRIES || offset + centralSize > archive.length) {
    throw archiveError("zip central directory is outside the archive");
  }
  let expanded = 0;
  for (let index = 0; index < entryCount; index++) {
    if (u32(archive, offset) !== 0x02014b50) throw archiveError("zip central directory entry is invalid");
    const flags = u16(archive, offset + 8);
    const method = u16(archive, offset + 10);
    const compressedSize = u32(archive, offset + 20);
    const uncompressedSize = u32(archive, offset + 24);
    const nameLength = u16(archive, offset + 28);
    const extraLength = u16(archive, offset + 30);
    const commentLength = u16(archive, offset + 32);
    const externalAttributes = u32(archive, offset + 38);
    const localOffset = u32(archive, offset + 42);
    if (flags & 0x1) throw archiveError("zip archive is encrypted");
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > archive.length) throw archiveError("zip entry name is truncated");
    const name = archive.subarray(nameStart, nameEnd).toString(flags & 0x800 ? "utf8" : "binary");
    const directory = name.endsWith("/") || ((externalAttributes >>> 16) & 0o170000) === 0o040000;
    expanded += uncompressedSize;
    if (expanded > MAX_EXPANDED_BYTES) throw archiveError("expanded archive exceeds the safe limit");
    if (u32(archive, localOffset) !== 0x04034b50) throw archiveError("zip local entry is invalid");
    const localNameLength = u16(archive, localOffset + 26);
    const localExtraLength = u16(archive, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw archiveError("zip entry data is truncated");
    const compressed = archive.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) data = compressed;
    else if (method === 8) {
      try { data = inflateRawSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES }); }
      catch { throw archiveError("zip entry could not be decompressed"); }
    } else {
      throw archiveError("zip uses an unsupported compression method");
    }
    if (data.length !== uncompressedSize) throw archiveError("zip entry size does not match its header");
    await writeArchiveEntry(destination, name, data, directory);
    offset = nameEnd + extraLength + commentLength;
  }
}
