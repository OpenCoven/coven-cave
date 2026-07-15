export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import {
  BackdropValidationError,
  deleteFamiliarBackdropFile,
  MAX_BACKDROP_BYTES,
  readFamiliarBackdropFile,
  SAFE_BACKDROP_MIME_TYPES,
  writeFamiliarBackdropFile,
} from "../../../../../lib/server/backdrop-store.ts";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

type RouteContext = { params: Promise<{ id: string }> };

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
 * Per-familiar backdrop override. Same local-origin discipline as the
 * app-wide `/api/preferences/backdrop`: the personal image never travels to
 * tailnet or forwarded hosts, even for authenticated mobile clients.
 */
export async function GET(req: Request, { params: rawParams }: RouteContext) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const params = await rawParams;

  try {
    const image = await readFamiliarBackdropFile(params.id);
    if (!image) {
      return new NextResponse(null, { status: 404, headers: NO_STORE_HEADERS });
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
  } catch (error) {
    if (error instanceof BackdropValidationError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("failed to read familiar backdrop image", 500);
  }
}

export async function PUT(req: Request, { params: rawParams }: RouteContext) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const params = await rawParams;

  const mime = mediaType(req);
  if (!(SAFE_BACKDROP_MIME_TYPES as readonly string[]).includes(mime)) {
    return jsonError("unsupported backdrop image type", 415);
  }

  try {
    const bytes = await readBoundedBody(req);
    const image = await writeFamiliarBackdropFile(params.id, bytes, mime);
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
    return jsonError("failed to save familiar backdrop image", 500);
  }
}

export async function DELETE(req: Request, { params: rawParams }: RouteContext) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const params = await rawParams;

  try {
    await deleteFamiliarBackdropFile(params.id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof BackdropValidationError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("failed to delete familiar backdrop image", 500);
  }
}
