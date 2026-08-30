import { NextResponse } from "next/server";

import { replayResearchRunGateway } from "@/lib/server/research-run-gateway";
import {
  authorizeResearchRunRequest,
  researchRunGatewayErrorResponse,
} from "@/lib/server/research-run-gateway-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function queryInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeResearchRunRequest(req, id);
  if (!authorized.ok) return authorized.response;
  const url = new URL(req.url);
  const afterSeq = queryInteger(url.searchParams.get("afterSeq"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = queryInteger(url.searchParams.get("limit"), 200, 1, 500);
  if (afterSeq === null || limit === null) {
    return NextResponse.json({ ok: false, error: "invalid event query" }, { status: 400 });
  }
  try {
    const result = await replayResearchRunGateway(authorized.value.missionId, afterSeq, limit);
    if (!result) {
      return NextResponse.json({ ok: false, error: "research run not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      run: result.run,
      events: result.events,
      afterSeq: result.afterSequence,
      lastEventSequence: result.lastEventSequence,
      nextEventSequence: result.nextEventSequence,
      hasMore: result.hasMore,
    });
  } catch (error) {
    return researchRunGatewayErrorResponse(error);
  }
}
