import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import sharp from "sharp";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Generous read cap: the seeded workspace avatars are full-resolution PNGs
// (~30MB / 4096px). We bound it so a pathological file can't be slurped whole
// into memory before downscaling.
const MAX_AVATAR_BYTES = 48 * 1024 * 1024;

// Avatars render at 16–36px (sm/md/lg); 256px on the longest edge stays crisp
// at 3–4× DPR while turning a ~30MB source into a few KB of WebP.
const AVATAR_MAX_DIM = 256;

type RenderedAvatar = { body: Uint8Array<ArrayBuffer>; contentType: string };

// Process-lifetime cache keyed by file path + mtime, so the expensive resize
// runs once per (avatar file version) instead of on every cold request. The
// familiar set is tiny, so a small bound is plenty.
const MAX_CACHE_ENTRIES = 64;
const renderCache = new Map<string, RenderedAvatar>();

function cacheGet(key: string): RenderedAvatar | undefined {
  const hit = renderCache.get(key);
  if (hit) {
    // Refresh LRU recency.
    renderCache.delete(key);
    renderCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: RenderedAvatar): void {
  renderCache.set(key, value);
  while (renderCache.size > MAX_CACHE_ENTRIES) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
}

/**
 * Serve a familiar's avatar image from its workspace:
 *   ~/.coven/workspaces/familiars/<id>/avatars/<image>.<ext>
 *
 * Raster avatars are downscaled to <=256px and re-encoded as WebP so a 30MB
 * source doesn't ship for a 36px glyph; SVGs are served as-is (already small,
 * and vector). The `id` segment (the only user input) is slug-guarded, and the
 * served filename is chosen from the directory listing — never from the request
 * — so this can't read outside the avatars dir. 404 when the familiar has no
 * avatar; the UI then falls back to the glyph.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const avatar = await resolveFamiliarAvatar(id);
  if (!avatar) {
    return NextResponse.json({ ok: false, error: "no avatar" }, { status: 404 });
  }

  const cacheKey = `${avatar.absPath}\0${avatar.mtimeMs}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return imageResponse(cached);
  }

  let bytes: Buffer;
  try {
    // O_NOFOLLOW: refuse to follow a symlink at the final path component, so a
    // symlinked avatar file can't redirect the read outside the avatars dir.
    const file = await open(avatar.absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await file.stat();
      if (!st.isFile() || st.size > MAX_AVATAR_BYTES) {
        return NextResponse.json({ ok: false, error: "no avatar" }, { status: 404 });
      }
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
  } catch {
    return NextResponse.json({ ok: false, error: "no avatar" }, { status: 404 });
  }

  let rendered: RenderedAvatar;
  if (avatar.contentType === "image/svg+xml") {
    // Vector source — already tiny; serve verbatim rather than rasterizing.
    rendered = { body: new Uint8Array(bytes), contentType: "image/svg+xml" };
  } else {
    try {
      const webp = await sharp(bytes)
        .rotate() // honor EXIF orientation before resizing
        .resize(AVATAR_MAX_DIM, AVATAR_MAX_DIM, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      rendered = { body: new Uint8Array(webp), contentType: "image/webp" };
    } catch {
      // Not a decodable raster image — treat as missing rather than 500.
      return NextResponse.json({ ok: false, error: "no avatar" }, { status: 404 });
    }
  }

  cacheSet(cacheKey, rendered);
  return imageResponse(rendered);
}

function imageResponse({ body, contentType }: RenderedAvatar): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // Content is keyed by the `?v=<mtime>` the familiars list appends, so it
      // can be cached hard and busted whenever the file changes on disk.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
