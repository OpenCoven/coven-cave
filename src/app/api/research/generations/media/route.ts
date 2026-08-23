import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import {
  isValidResearchGenerationFamiliarId,
  type ResearchGenerationMediaFileRef,
} from "@/lib/research-generations";
import { rejectResearchMediaRequest } from "@/lib/server/api-security";
import { listResearchGenerations } from "@/lib/server/research-generations";
import {
  openResearchGenerationMedia,
  parseResearchMediaRange,
  ResearchMediaStoreError,
  type OpenResearchMedia,
} from "@/lib/server/research-media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mediaRefForGeneration(generation: Awaited<ReturnType<typeof listResearchGenerations>>[number]): ResearchGenerationMediaFileRef | null {
  if (generation.content?.kind === "podcast") return generation.content.audio ?? null;
  if (generation.content?.kind === "short-video" || generation.content?.kind === "long-video") {
    return generation.content.video ?? null;
  }
  return null;
}

export async function GET(req: Request) {
  const forbidden = await rejectResearchMediaRequest(req);
  if (forbidden) return forbidden;
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!isValidResearchGenerationFamiliarId(familiarId) || !id) {
    return NextResponse.json({ ok: false, error: "familiarId and id required" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let opened: OpenResearchMedia | null = null;
  try {
    const generation = (await listResearchGenerations(familiarId)).find((entry) => entry.id === id);
    const ref = generation ? mediaRefForGeneration(generation) : null;
    if (!generation || generation.status !== "ready" || !ref) {
      return NextResponse.json({ ok: false, error: "media not found" }, { status: 404 });
    }
    const expectedMimeType =
      generation.content?.kind === "podcast" ? "audio/wav" : "video/mp4";
    if (ref.mimeType !== expectedMimeType) {
      return NextResponse.json({ ok: false, error: "media not found" }, { status: 404 });
    }
    opened = await openResearchGenerationMedia(familiarId, id, ref.key);
    if (opened.mimeType !== expectedMimeType) {
      await opened.handle.close();
      opened = null;
      return NextResponse.json({ ok: false, error: "media not found" }, { status: 404 });
    }
    const storedSize = opened.sizeBytes;
    const contentType = opened.mimeType;
    const range = parseResearchMediaRange(req.headers.get("range"), storedSize);
    if (req.headers.has("range") && !range) {
      await opened.handle.close();
      opened = null;
      return new Response(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${storedSize}`,
        },
      });
    }
    const stream = opened.handle.createReadStream(
      range
        ? { start: range.start, end: range.end, autoClose: true }
        : { autoClose: true },
    );
    const contentLength = range
      ? range.end - range.start + 1
      : storedSize;
    opened = null;
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers: {
        "content-type": contentType,
        "x-content-type-options": "nosniff",
        "content-length": String(contentLength),
        "accept-ranges": "bytes",
        ...(range
          ? {
              "content-range":
                `bytes ${range.start}-${range.end}/${storedSize}`,
            }
          : {}),
        ...(url.searchParams.get("download") === "1"
          ? {
              "content-disposition": `attachment; filename="${ref.key}"`,
            }
          : {}),
      },
    });
  } catch (error) {
    await opened?.handle.close().catch(() => {});
    if (
      error instanceof ResearchMediaStoreError &&
      (error.code === "missing" || error.code === "symlink")
    ) {
      return NextResponse.json({ ok: false, error: "media not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "failed to read media" }, { status: 500 });
  }
}
