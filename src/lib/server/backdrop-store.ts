/**
 * App-owned backdrop image storage.
 *
 * The browser used to keep these bytes in origin-scoped IndexedDB, so a
 * packaged desktop launch on a different loopback port could no longer see
 * them. The canonical image now lives beside Cave's other local state. The
 * path is resolved for every operation so tests and isolated launches can set
 * COVEN_BACKDROP_PATH after this module has loaded.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import { writeFileAtomic } from "./atomic-write.ts";

export const MAX_BACKDROP_BYTES = 8 * 1024 * 1024;
export const SAFE_BACKDROP_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SafeBackdropMime = (typeof SAFE_BACKDROP_MIME_TYPES)[number];

export type BackdropFile = {
  bytes: Buffer;
  mime: SafeBackdropMime;
  etag: string;
};

export class BackdropValidationError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(message: string, status: 400 | 413 | 415) {
    super(message);
    this.name = "BackdropValidationError";
    this.status = status;
  }
}

/** Resolve at call-time; an empty override is treated as unset. */
export function backdropPath(): string {
  const override = process.env.COVEN_BACKDROP_PATH?.trim();
  return override || path.join(caveHome(), "backdrop.jpg");
}

/** Directory holding per-familiar backdrop overrides, one image per familiar. */
export function familiarBackdropDir(): string {
  const override = process.env.COVEN_FAMILIAR_BACKDROP_DIR?.trim();
  return override || path.join(caveHome(), "backdrops");
}

// Familiar ids come from cave-config; the store still refuses anything that
// could escape its directory. Extension-less storage is fine — reads identify
// the format from magic bytes, exactly like the app-wide image.
const FAMILIAR_BACKDROP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Resolve the image path for one familiar, refusing traversal-shaped ids. */
export function familiarBackdropPath(familiarId: string): string {
  if (!FAMILIAR_BACKDROP_ID_RE.test(familiarId) || familiarId.includes("..")) {
    throw new BackdropValidationError("invalid familiar id", 400);
  }
  // Resolve the base too: a trailing separator on the env override would
  // otherwise double up in the prefix check and reject valid paths.
  const dir = path.resolve(familiarBackdropDir());
  const target = path.resolve(dir, `familiar-${familiarId}.img`);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new BackdropValidationError("invalid familiar id", 400);
  }
  return target;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Identify only the raster formats the app serves. Extension and caller MIME
 * are deliberately ignored here: both must agree with these magic bytes before
 * a write is accepted. SVG/XML and ambiguous data therefore never land.
 */
export function detectBackdropMime(bytes: Uint8Array): SafeBackdropMime | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function normalizedMime(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function etagFor(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("base64url");
  return `"sha256-${digest}"`;
}

function validatedFile(bytes: Uint8Array, declaredMime: string): BackdropFile {
  if (bytes.byteLength === 0) {
    throw new BackdropValidationError("backdrop image is empty", 400);
  }
  if (bytes.byteLength > MAX_BACKDROP_BYTES) {
    throw new BackdropValidationError("backdrop image is too large", 413);
  }

  const mime = normalizedMime(declaredMime);
  if (!(SAFE_BACKDROP_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new BackdropValidationError("unsupported backdrop image type", 415);
  }

  const detected = detectBackdropMime(bytes);
  if (!detected) {
    throw new BackdropValidationError("invalid backdrop image signature", 400);
  }
  if (detected !== mime) {
    throw new BackdropValidationError("backdrop image type does not match its bytes", 400);
  }

  const buffer = Buffer.from(bytes);
  return { bytes: buffer, mime: detected, etag: etagFor(buffer) };
}

/** Return null for missing, malformed, or oversized on-disk data. */
async function readImageAt(target: string): Promise<BackdropFile | null> {
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BACKDROP_BYTES) return null;
    const bytes = await readFile(target);
    if (bytes.byteLength > MAX_BACKDROP_BYTES) return null;
    const mime = detectBackdropMime(bytes);
    if (!mime) return null;
    return { bytes, mime, etag: etagFor(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Validate, then atomically replace the image at `target`. */
async function writeImageAt(
  target: string,
  bytes: Uint8Array,
  declaredMime: string,
): Promise<BackdropFile> {
  const image = validatedFile(bytes, declaredMime);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, image.bytes);
  return image;
}

/** Return null for missing, malformed, or oversized on-disk data. */
export async function readBackdropFile(): Promise<BackdropFile | null> {
  return readImageAt(backdropPath());
}

/** Validate, then atomically replace the canonical image. */
export async function writeBackdropFile(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<BackdropFile> {
  return writeImageAt(backdropPath(), bytes, declaredMime);
}

export async function deleteBackdropFile(): Promise<void> {
  await rm(backdropPath(), { force: true });
}

export async function readFamiliarBackdropFile(familiarId: string): Promise<BackdropFile | null> {
  return readImageAt(familiarBackdropPath(familiarId));
}

export async function writeFamiliarBackdropFile(
  familiarId: string,
  bytes: Uint8Array,
  declaredMime: string,
): Promise<BackdropFile> {
  return writeImageAt(familiarBackdropPath(familiarId), bytes, declaredMime);
}

export async function deleteFamiliarBackdropFile(familiarId: string): Promise<void> {
  await rm(familiarBackdropPath(familiarId), { force: true });
}
