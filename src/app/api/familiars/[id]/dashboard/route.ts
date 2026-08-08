import { NextResponse } from "next/server";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  serializedDashboardBytes,
} from "@/lib/familiar-dashboard";
import {
  loadFamiliarDashboard,
  type FamiliarDashboardLoadResult,
} from "@/lib/server/familiar-dashboard-data";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DashboardContext = { params: Promise<{ id: string }> };
type DashboardLoader = (id: string) => Promise<FamiliarDashboardLoadResult>;

const NO_STORE = { "cache-control": "no-store" };

function dashboardError(
  status: number,
  error:
    | "invalid_familiar_id"
    | "dashboard_unauthorized"
    | "familiar_not_found"
    | "dashboard_unavailable",
) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: NO_STORE },
  );
}

export async function handleDashboardRequest(
  request: Request,
  context: DashboardContext,
  loader: DashboardLoader = loadFamiliarDashboard,
): Promise<Response> {
  const { id } = await context.params;
  if (!id || !isValidFamiliarId(id)) {
    return dashboardError(403, "invalid_familiar_id");
  }

  const requestedVersion = new URL(request.url).searchParams.get("v");
  if (requestedVersion !== String(FAMILIAR_DASHBOARD_VERSION)) {
    return dashboardError(400, "dashboard_unavailable");
  }

  let result: FamiliarDashboardLoadResult;
  try {
    result = await loader(id);
  } catch {
    return dashboardError(500, "dashboard_unavailable");
  }

  if (result.kind === "not_found") {
    return dashboardError(404, "familiar_not_found");
  }
  if (result.kind === "auth_error") {
    return dashboardError(result.status, "dashboard_unauthorized");
  }
  if (result.kind === "unavailable") {
    return dashboardError(500, "dashboard_unavailable");
  }
  if (
    serializedDashboardBytes(result.response) >
    FAMILIAR_DASHBOARD_LIMITS.responseBytes
  ) {
    return dashboardError(500, "dashboard_unavailable");
  }

  return NextResponse.json(result.response, { headers: NO_STORE });
}

export async function GET(request: Request, context: DashboardContext) {
  return handleDashboardRequest(request, context);
}
