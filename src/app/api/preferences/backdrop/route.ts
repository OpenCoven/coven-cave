export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import {
  BackdropValidationError,
  deleteBackdropFile,
  MAX_BACKDROP_BYTES,
  readBackdropFile,
  SAFE_BACKDROP_MIME_TYPES,
  writeBackdropFile,
} from "../../../../lib/server/backdrop-store.ts";
import { patchPreferences } from "../../../../lib/server/preferences-store.ts";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

async function readBoundedBody(req: Request): Promise<Uint8Array> {
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BACKDROP_BYTES) {
    throw new BackdropValidationError("backdrop image is too large", 413);
  }

  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BACKDROP_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BackdropValidationError("backdrop image is too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * The global API proxy still performs normal sidecar authentication. This
 * additional guard keeps the personal backdrop unavailable through tailnet or
 * forwarded hosts even to otherwise authenticated mobile clients.
 */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  try {
    const image = await readBackdropFile();
    if (!image) {
      return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
    }
    const headers = {
      ...NO_STORE_HEADERS,
      "Content-Type": image.mime,
      "X-Content-Type-Options": "nosniff",
      ETag: image.etag,
    };
    if (req.headers.get("if-none-match") === image.etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(new Uint8Array(image.bytes), { status: 200, headers });
  } catch {
    return jsonError("failed to read backdrop image", 500);
  }
}

export async function PUT(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const mime = mediaType(req);
  if (!(SAFE_BACKDROP_MIME_TYPES as readonly string[]).includes(mime)) {
    return jsonError("unsupported backdrop image type", 415);
  }

  try {
    const bytes = await readBoundedBody(req);
    const image = await writeBackdropFile(bytes, mime);
    const updatedAt = new Date().toISOString();
    await patchPreferences({
      appearance: {
        backdrop: {
          image: { present: true, mime: image.mime, updatedAt },
        },
      },
    });
    return NextResponse.json(
      {
        ok: true,
        backdrop: { mime: image.mime, bytes: image.bytes.byteLength, etag: image.etag },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof BackdropValidationError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("failed to save backdrop image", 500);
  }
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  try {
    await deleteBackdropFile();
    await patchPreferences({
      appearance: {
        backdrop: {
          image: { present: false, mime: null, updatedAt: new Date().toISOString() },
        },
      },
    });
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch {
    return jsonError("failed to delete backdrop image", 500);
  }
}
