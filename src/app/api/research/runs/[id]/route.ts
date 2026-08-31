import { NextResponse } from "next/server";

import {
  ResearchRunGatewayError,
  loadResearchRunGateway,
} from "@/lib/server/research-run-gateway";
import {
  authorizeResearchRunRequest,
  researchRunGatewayErrorResponse,
} from "@/lib/server/research-run-gateway-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeResearchRunRequest(req, id);
  if (!authorized.ok) return authorized.response;
  try {
    const result = await loadResearchRunGateway(
      authorized.value.missionId,
      authorized.value.requestedRunId ?? undefined,
    );
    if (!result) {
      return NextResponse.json({ ok: false, error: "research run not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      run: result.run,
      lastEventSequence: result.lastEventSequence,
      nextEventSequence: result.nextEventSequence,
    });
  } catch (error) {
    if (error instanceof ResearchRunGatewayError) return researchRunGatewayErrorResponse(error);
    return researchRunGatewayErrorResponse(error);
  }
}
