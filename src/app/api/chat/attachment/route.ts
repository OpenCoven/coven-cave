// The explicit .js extension (matching the sibling conversation route) lets
// route.test.ts import this module directly under plain Node ESM resolution:
// `next` ships no "exports" map, so the extensionless "next/server" specifier
// 404s outside Next's own resolver.
import { NextResponse } from "next/server.js";

import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  ChatAttachmentStoreError,
  isValidChatAttachmentId,
  readChatImageAttachment,
} from "@/lib/server/chat-attachment-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serve a chat image attachment the send route stored durably, so a reopened
 * transcript can render the picture instead of a filename chip.
 *
 * Fetch this through `AuthedImage` / the patched `window.fetch`, never a bare
 * `<img src="/api/...">`: in the packaged app the sidecar gates `/api/*` on a
 * header only the patched fetch carries, and a native image load 401s into
 * WebKit's broken-image glyph (cave-wgc2).
 */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  // An id is a filename inside the store, so anything but the exact shape the
  // store mints is a path-deny — same 403 wording as the other byte-serving
  // routes (see /api/research/generations/media).
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!isValidChatAttachmentId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  try {
    const { data, mimeType } = await readChatImageAttachment(id);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-length": String(data.byteLength),
        // The bytes are user content: forbid sniffing, forbid any subresource
        // an SVG might try to pull if it is ever opened directly, and keep it
        // out of shared caches.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "content-disposition": "inline",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof ChatAttachmentStoreError) {
      if (error.code === "invalid-id") {
        return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
      }
      return NextResponse.json({ ok: false, error: "attachment not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "failed to read attachment" }, { status: 500 });
  }
}
