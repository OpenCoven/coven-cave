import { NextResponse } from "next/server";
import { matchPath } from "@/lib/salem/pathfinder-match";
import { buildCard, sanitizeCard } from "@/lib/salem/pathfinder-card";
import { HAPPY_PATHS, REGISTRY_VERSION } from "@/lib/salem/happy-paths";
import type { SalemPathfinderRequest } from "@/lib/salem/pathfinder-types";

export const dynamic = "force-dynamic";

/**
 * Salem pathfinder — deterministic, registry-grounded path recommendation.
 *
 * GET returns the happy-path registry (version + paths) for the client.
 * POST takes a SalemPathfinderRequest and returns a validated, sanitized
 * SalemPathfinderCard. v0 does NOT call a model: the card is assembled from the
 * registry via a pure matcher (design's sanctioned deterministic fallback), so
 * there is no prompt egress and the response is always safe to render.
 */

export async function GET() {
  return NextResponse.json({ ok: true, version: REGISTRY_VERSION, paths: HAPPY_PATHS });
}

export async function POST(req: Request) {
  let body: SalemPathfinderRequest;
  try {
    body = (await req.json()) as SalemPathfinderRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const mode = body?.mode === "setup" ? "setup" : "home";
  const userMessage = typeof body?.userMessage === "string" ? body.userMessage : "";

  const request: SalemPathfinderRequest = { ...body, mode, userMessage };
  const match = matchPath(request);
  // buildCard already sanitizes; sanitize again defensively in case the shape
  // is ever produced by a future model layer behind this same route.
  const card = sanitizeCard(buildCard(request, match));

  return NextResponse.json({ ok: true, card });
}
