import { NextResponse } from "next/server";

import { isValidResearchGenerationFamiliarId } from "@/lib/research-generations";
import {
  RESEARCH_MEDIA_PATH,
  RESEARCH_MEDIA_TICKET_PARAM,
  signResearchMediaTicket,
} from "@/lib/research-media-ticket";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listResearchGenerations } from "@/lib/server/research-generations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hasReadyMedia(generation: Awaited<ReturnType<typeof listResearchGenerations>>[number] | undefined) {
  return Boolean(
    generation?.status === "ready" &&
      ((generation.content?.kind === "podcast" && generation.content.audio) ||
        ((generation.content?.kind === "short-video" || generation.content?.kind === "long-video") &&
          generation.content.video)),
  );
}

/**
 * Mint the restricted URL that native audio/video elements need. This request
 * goes through patched fetch, so packaged Tauri proves the regular sidecar
 * credential before the capability is ever issued.
 */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!isValidResearchGenerationFamiliarId(familiarId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "familiarId and id required" }, { status: 400 });
  }
  try {
    const generation = (await listResearchGenerations(familiarId)).find((entry) => entry.id === id);
    if (!hasReadyMedia(generation)) {
      return NextResponse.json({ ok: false, error: "media not found" }, { status: 404 });
    }
    const secret = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
    const params = new URLSearchParams({ familiarId, id });
    if (secret) {
      params.set(RESEARCH_MEDIA_TICKET_PARAM, await signResearchMediaTicket({
        secret,
        familiarId,
        generationId: id,
      }));
    }
    return NextResponse.json({ ok: true, mediaUrl: `${RESEARCH_MEDIA_PATH}?${params}` });
  } catch {
    return NextResponse.json({ ok: false, error: "failed to prepare media" }, { status: 500 });
  }
}
