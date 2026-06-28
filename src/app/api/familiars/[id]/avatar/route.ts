import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Generous read cap: the seeded workspace avatars are full-resolution PNGs
// (~30MB / 4096px). We bound it so a pathological file can't be slurped whole
// into memory before downscaling.
const MAX_AVATAR_BYTES = 48 * 1024 * 1024;

// Avatars render at 16–48px (sm/md/lg/xl); 256px on the longest edge stays
// crisp at 3–4× DPR while turning a ~30MB source into a small PNG that every
// supported desktop WebView can decode.
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
 * Raster avatars are downscaled to <=256px and re-encoded as PNG so a 30MB
 * source doesn't ship for a 48px avatar while still rendering in desktop
 * WebViews that lack WebP codec support; SVGs are served as-is (already small,
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
      const png = await sharp(bytes)
        .rotate() // honor EXIF orientation before resizing
        .resize(AVATAR_MAX_DIM, AVATAR_MAX_DIM, { fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      rendered = { body: new Uint8Array(png), contentType: "image/png" };
    } catch {
      // Not a decodable raster image — treat as missing rather than 500.
      return NextResponse.json({ ok: false, error: "no avatar" }, { status: 404 });
    }
  }

  cacheSet(cacheKey, rendered);
  return imageResponse(rendered);
}

/**
 * Upload (or replace) a familiar's avatar. The request body is the raw image
 * bytes (the client POSTs the File directly). We decode + normalize through
 * sharp and write the canonical `<id>.png` into the familiar's avatars dir, so
 * `resolveFamiliarAvatar` (which prefers an exact `<id>` match, PNG first)
 * always picks the freshly uploaded file. The `id` segment is the only user
 * input and is slug-guarded before it touches the filesystem.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "empty upload" }, { status: 400 });
  }
  if (raw.byteLength > MAX_AVATAR_BYTES) {
    return NextResponse.json({ ok: false, error: "image too large" }, { status: 413 });
  }

  // Decode + normalize. A non-image payload throws here → 400 rather than
  // persisting garbage. Store at 512px (crisp source); GET downscales to 256.
  let png: Buffer;
  try {
    png = await sharp(raw)
      .rotate() // honor EXIF orientation
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ ok: false, error: "not a decodable image" }, { status: 400 });
  }

  const dir = await avatarsDirFor(id);
  await mkdir(dir, { recursive: true });
  // `id` is a validated slug (no separators / `..`); basename is a belt-and-
  // suspenders sanitizer on the filename sink (mirrors familiar-notes.ts).
  await writeFile(path.join(dir, `${path.basename(id)}.png`), png);

  return NextResponse.json({ ok: true });
}

/** Resolve a familiar's avatars dir, re-asserting the slug guard inline so the
 *  id can't reach `familiarWorkspace`/`path.join` unvalidated (the barrier
 *  pattern from familiar-notes.ts). */
async function avatarsDirFor(id: string): Promise<string> {
  if (!isValidFamiliarId(id)) throw new Error("invalid familiar id");
  return path.join(await familiarWorkspace(id), "avatars");
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
