import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

/**
 * Resolves a familiar's avatar image from its workspace:
 *   ~/.coven/workspaces/familiars/<id>/avatars/<image>.<ext>
 *
 * The convention is `<id>.<ext>` (e.g. `cody/avatars/cody.png`), but any image
 * in the `avatars/` dir is accepted — the `<id>.<ext>` match wins, otherwise the
 * first image by sorted name. The chosen filename is picked from the directory
 * listing (never from client input), and the `id` is slug-guarded, so this
 * can't read outside the avatars dir.
 */

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

// Preference order when several images exist and none matches `<id>.<ext>` —
// also the tiebreak order for the exact-id match (png first, vector last).
const EXT_PRIORITY = [".png", ".webp", ".jpg", ".jpeg", ".avif", ".gif", ".svg"];

export function isImageFile(name: string): boolean {
  return path.extname(name).toLowerCase() in CONTENT_TYPE_BY_EXT;
}

export function contentTypeForFile(name: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Choose the avatar file from a directory listing. Pure (no I/O) so the
 * precedence rules are unit-testable.
 *
 * 1. `<id>.<ext>` (case-insensitive), best extension by EXT_PRIORITY.
 * 2. Otherwise the first image file by case-insensitive name, EXT_PRIORITY as
 *    the tiebreak when stems are equal.
 * Returns the original filename, or null when no image is present.
 */
export function pickAvatarFile(filenames: string[], id: string): string | null {
  const images = filenames.filter(isImageFile);
  if (images.length === 0) return null;

  const extRank = (name: string) => {
    const idx = EXT_PRIORITY.indexOf(path.extname(name).toLowerCase());
    return idx === -1 ? EXT_PRIORITY.length : idx;
  };

  const lowerId = id.toLowerCase();
  const idMatches = images.filter((name) => path.parse(name).name.toLowerCase() === lowerId);
  if (idMatches.length > 0) {
    return idMatches.sort((a, b) => extRank(a) - extRank(b))[0];
  }

  return images.sort((a, b) => {
    const an = a.toLowerCase();
    const bn = b.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return extRank(a) - extRank(b);
  })[0];
}

export type ResolvedAvatar = {
  absPath: string;
  fileName: string;
  contentType: string;
  mtimeMs: number;
};

/** Locate the avatar file for a familiar, or null when there is none. */
export async function resolveFamiliarAvatar(id: string): Promise<ResolvedAvatar | null> {
  if (!isValidFamiliarId(id)) return null;
  const avatarsDir = path.join(await familiarWorkspace(id), "avatars");

  let entries: string[];
  try {
    entries = await readdir(avatarsDir);
  } catch {
    return null; // no avatars dir
  }

  const fileName = pickAvatarFile(entries, id);
  if (!fileName) return null;

  const absPath = path.join(avatarsDir, fileName);
  try {
    const st = await stat(absPath);
    if (!st.isFile()) return null;
    return { absPath, fileName, contentType: contentTypeForFile(fileName), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}
