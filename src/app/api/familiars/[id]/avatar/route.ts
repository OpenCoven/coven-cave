import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Generous cap: the seeded workspace avatars are full-resolution PNGs (~30MB).
// We still bound it so a pathological file can't be slurped whole into memory.
const MAX_AVATAR_BYTES = 48 * 1024 * 1024;

/**
 * Serve a familiar's avatar image from its workspace:
 *   ~/.coven/workspaces/familiars/<id>/avatars/<image>.<ext>
 *
 * The `id` segment (the only user input) is slug-guarded, and the served
 * filename is chosen from the directory listing — never from the request — so
 * this can't read outside the avatars dir. 404 when the familiar has no avatar;
 * the UI then falls back to the glyph.
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

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": avatar.contentType,
      // Content is keyed by the `?v=<mtime>` the familiars list appends, so it
      // can be cached hard and busted whenever the file changes on disk.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
