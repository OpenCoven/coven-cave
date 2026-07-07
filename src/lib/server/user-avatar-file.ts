/**
 * Operator avatar image — a single file under ~/.coven named
 * user-avatar.{png,jpg,webp}. Exactly one exists at a time: writes are atomic
 * (unique temp + rename, same recipe as atomic-write.ts) and remove the other
 * extensions after the rename so a format change can't leave two avatars.
 *
 * SVG is rejected even though the legacy browser-local store allowed it —
 * this image is now served from our origin (stored-XSS vector).
 */
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const ALL_EXTS = ["png", "jpg", "webp"];

function avatarDir(override?: string): string {
  return override ?? path.join(homedir(), ".coven");
}
function avatarPath(dir: string, ext: string): string {
  return path.join(dir, `user-avatar.${ext}`);
}
function extToMime(ext: string): string {
  return ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : "image/webp";
}

export type UserAvatarFile = { bytes: Buffer; mime: string; updatedAt: string };
export type AvatarWriteResult = { ok: true } | { ok: false; reason: string };

export async function readUserAvatarFile(dirOverride?: string): Promise<UserAvatarFile | null> {
  const dir = avatarDir(dirOverride);
  for (const ext of ALL_EXTS) {
    const file = avatarPath(dir, ext);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      return {
        bytes: await readFile(file),
        mime: extToMime(ext),
        updatedAt: info.mtime.toISOString(),
      };
    } catch { /* try next ext */ }
  }
  return null;
}

export async function writeUserAvatarFile(
  image: { dataUrl: string; mime: string }, dirOverride?: string,
): Promise<AvatarWriteResult> {
  const ext = MIME_TO_EXT[image.mime];
  if (!ext) return { ok: false, reason: "Unsupported format. Use PNG, JPEG, or WebP." };
  const match = /^data:([^;,]+);base64,(.*)$/.exec(image.dataUrl);
  if (!match) return { ok: false, reason: "Invalid image data." };
  if (match[1] !== image.mime) return { ok: false, reason: "Image data does not match its declared format." };
  if (image.dataUrl.length > MAX_AVATAR_BYTES * 1.4) return { ok: false, reason: "Image too large (max 2MB)." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return { ok: false, reason: "Invalid image data." };
  }
  if (bytes.byteLength === 0) return { ok: false, reason: "Invalid image data." };
  if (bytes.byteLength > MAX_AVATAR_BYTES) return { ok: false, reason: "Image too large (max 2MB)." };

  const dir = avatarDir(dirOverride);
  await mkdir(dir, { recursive: true });
  const target = avatarPath(dir, ext);
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    return { ok: false, reason: err instanceof Error ? err.message : "Could not save image." };
  }
  // Sweep the other extensions so a format change leaves exactly one avatar.
  for (const other of ALL_EXTS.filter((e) => e !== ext)) {
    await rm(avatarPath(dir, other), { force: true }).catch(() => {});
  }
  return { ok: true };
}

export async function deleteUserAvatarFile(dirOverride?: string): Promise<void> {
  const dir = avatarDir(dirOverride);
  for (const ext of ALL_EXTS) {
    await rm(avatarPath(dir, ext), { force: true }).catch(() => {});
  }
}
