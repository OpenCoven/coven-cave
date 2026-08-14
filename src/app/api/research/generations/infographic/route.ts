import { NextResponse } from "next/server";

import { isValidResearchGenerationFamiliarId } from "@/lib/research-generations";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listResearchGenerations } from "@/lib/server/research-generations";
import {
  infographicToSvg,
  renderInfographicPng,
} from "@/lib/server/research-infographic-renderer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Renders a ready infographic generation's stat sheet as a visual artifact.
 * The poster is built on demand from the stored extracted stats — nothing is
 * persisted and nothing is synthesized beyond layout. `format=svg` returns the
 * vector source; the default `format=png` rasterizes it via Sharp.
 */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  const format = url.searchParams.get("format") ?? "png";
  if (!isValidResearchGenerationFamiliarId(familiarId) || !id) {
    return NextResponse.json({ ok: false, error: "familiarId and id required" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  if (format !== "png" && format !== "svg") {
    return NextResponse.json({ ok: false, error: "format must be png or svg" }, { status: 400 });
  }
  try {
    const generation = (await listResearchGenerations(familiarId)).find(
      (entry) => entry.id === id,
    );
    if (
      !generation ||
      generation.status !== "ready" ||
      generation.content?.kind !== "infographic" ||
      generation.content.stats.length === 0
    ) {
      return NextResponse.json({ ok: false, error: "infographic not found" }, { status: 404 });
    }
    const svg = infographicToSvg({
      title: `Key figures — ${generation.sourceTitle}`,
      sourceTitle: generation.sourceTitle,
      stats: generation.content.stats,
    });
    const download: Record<string, string> =
      url.searchParams.get("download") === "1"
        ? { "content-disposition": `attachment; filename="infographic-${id}.${format}"` }
        : {};
    if (format === "svg") {
      return new Response(svg, {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
          "x-content-type-options": "nosniff",
          ...download,
        },
      });
    }
    const png = await renderInfographicPng(svg);
    return new Response(Buffer.from(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "content-length": String(png.byteLength),
        ...download,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "failed to render infographic" }, { status: 500 });
  }
}
