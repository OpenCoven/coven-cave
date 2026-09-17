import { NextResponse } from "next/server";

import {
  rejectNonLocalRequest,
  rejectResearchRunStreamRequest,
} from "./api-security.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import { requireFamiliar } from "./familiar-reminder-route.ts";
import { loadResearchMission } from "./research-mission-store.ts";
import { missionIdForResearchRunPath } from "./research-run-gateway.ts";
import { ResearchRunGatewayError } from "./research-run-gateway.ts";
import type { ResearchMission } from "../research-missions.ts";

export type AuthorizedResearchRunRequest = {
  familiarId: string;
  missionId: string;
  requestedRunId: string | null;
  mission: ResearchMission;
};

export function researchRunGatewayErrorResponse(error: unknown): NextResponse {
  if (error instanceof ResearchRunGatewayError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.status === 409 ? error.message : "research run unavailable",
        ...(error.status === 409 ? { code: error.code } : {}),
      },
      { status: error.status },
    );
  }
  return NextResponse.json({ ok: false, error: "research run unavailable" }, { status: 500 });
}

function notFound(): NextResponse {
  // Use one response for missing runs and a familiar mismatch. A caller must
  // not be able to enumerate another familiar's mission ids.
  return NextResponse.json({ ok: false, error: "research run not found" }, { status: 404 });
}

export async function authorizeResearchRunRequest(
  req: Request,
  rawId: string,
  options: { allowValidatedSidecarQuery?: boolean } = {},
): Promise<
  | { ok: true; value: AuthorizedResearchRunRequest }
  | { ok: false; response: NextResponse }
> {
  const forbidden = options.allowValidatedSidecarQuery
    ? rejectResearchRunStreamRequest(req)
    : rejectNonLocalRequest(req);
  if (forbidden) return { ok: false, response: forbidden };

  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() ?? "";
  if (!isValidFamiliarId(familiarId)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 }),
    };
  }
  const familiarRefusal = await requireFamiliar(familiarId);
  if (familiarRefusal) return { ok: false, response: familiarRefusal };

  const missionId = missionIdForResearchRunPath(rawId);
  if (!missionId) return { ok: false, response: notFound() };
  const mission = await loadResearchMission(missionId);
  if (!mission || mission.familiarId !== familiarId) {
    return { ok: false, response: notFound() };
  }
  return {
    ok: true,
    value: {
      familiarId,
      missionId,
      requestedRunId: rawId.startsWith("run_") ? rawId : null,
      mission,
    },
  };
}
