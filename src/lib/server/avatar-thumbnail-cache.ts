import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "@/lib/coven-paths";

/**
 * On-disk cache of rendered familiar avatar thumbnails (#5679).
 *
 * Seeded workspace avatars are ~30 MB, 4096 px PNGs. Decoding one through
 * sharp costs ~200 ms, and the route's in-memory LRU is lost on every server
 * start, so the first Board or chat paint after launch paid that per familiar.
 * The rendered 256 px PNG is small, so it is kept under the Cave home and
 * reused until the source file's path, size or mtime changes.
 *
 * Every failure here degrades to "not cached": the route re-renders.
 */

// Bump when the render pipeline (size, encoder, options) changes so older
// thumbnails are never served for the new pipeline.
export const AVATAR_THUMB_VERSION = 1;

// Stale thumbnails accumulate only when an avatar is replaced; keep the
// directory bounded anyway.
export const AVATAR_THUMB_MAX_FILES = 128;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Every complete PNG ends with an empty IEND chunk: length, type and CRC.
const PNG_IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** Signature at the start and IEND at the end, so a truncated file is a miss
 *  and gets re-rendered rather than served broken until the source changes. */
function isCompletePng(bytes: Buffer): boolean {
  return bytes.length > PNG_MAGIC.length + PNG_IEND.length
    && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
    && bytes.subarray(bytes.length - PNG_IEND.length).equals(PNG_IEND);
}

export type AvatarThumbSource = {
  absPath: string;
  size: number;
  mtimeMs: number;
};

export function avatarThumbKey(source: AvatarThumbSource, maxDim: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        AVATAR_THUMB_VERSION,
        maxDim,
        source.absPath,
        source.size,
        // Full precision: two same-size replacements within one millisecond
        // must not share a key.
        source.mtimeMs,
      ]),
    )
    .digest("hex");
}

/** The cache directory, or null when the Cave home is not an absolute path
 *  (a relative home would write into whatever the process cwd happens to be). */
export function avatarThumbDir(): string | null {
  const home = caveHome();
  if (!path.isAbsolute(home)) return null;
  return path.join(home, "cache", "avatar-thumbs");
}

function thumbPath(dir: string, key: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  return path.join(dir, `${key}.png`);
}

export async function readAvatarThumb(key: string): Promise<Buffer | null> {
  const dir = avatarThumbDir();
  const file = dir ? thumbPath(dir, key) : null;
  if (!file) return null;
  try {
    const bytes = await readFile(file);
    return isCompletePng(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function writeAvatarThumb(key: string, bytes: Uint8Array): Promise<void> {
  const dir = avatarThumbDir();
  const file = dir ? thumbPath(dir, key) : null;
  if (!dir || !file) return;
  const tmp = path.join(dir, `.${key}.${randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, file);
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
    return;
  }
  await pruneAvatarThumbs(dir).catch(() => {});
}

async function pruneAvatarThumbs(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((name) => /^[0-9a-f]{64}\.png$/.test(name));
  if (names.length <= AVATAR_THUMB_MAX_FILES) return;
  const entries = await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      try {
        return { full, mtimeMs: (await stat(full)).mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const live = entries.filter((entry): entry is { full: string; mtimeMs: number } => entry !== null);
  live.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const excess = live.length - AVATAR_THUMB_MAX_FILES;
  await Promise.all(live.slice(0, Math.max(0, excess)).map((entry) => rm(entry.full, { force: true })));
}
