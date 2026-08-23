import { NextResponse } from "next/server";
import type {
  FamiliarExecutionAnalyticsErrorResponse,
  FamiliarExecutionAnalyticsSuccessResponse,
} from "@/lib/familiars/familiar-execution-analytics";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { readFamiliarExecutionAnalytics } from "@/lib/server/familiar-execution-analytics-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyticsSource = typeof readFamiliarExecutionAnalytics;
let analyticsSource: AnalyticsSource = readFamiliarExecutionAnalytics;

export function __setFamiliarExecutionAnalyticsSourceForTests(
  source?: AnalyticsSource,
): void {
  analyticsSource = source ?? readFamiliarExecutionAnalytics;
}

function recentLimit(req: Request): number {
  const raw = new URL(req.url).searchParams.get("recent");
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    const response = {
      ok: false,
      error: "path not allowed",
    } satisfies FamiliarExecutionAnalyticsErrorResponse;
    return NextResponse.json(
      response,
      { status: 403 },
    );
  }

  try {
    const analytics = await analyticsSource({
      familiarId: id,
      recentLimit: recentLimit(req),
    });
    const response = {
      ok: true,
      analytics: {
        generatedAt: analytics.generatedAt,
        windows: analytics.windows,
        recentAttempts: analytics.recentAttempts,
        backfill: analytics.backfill,
      },
    } satisfies FamiliarExecutionAnalyticsSuccessResponse;
    return NextResponse.json(
      response,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    const response = {
      ok: false,
      error: "Could not load familiar execution analytics.",
    } satisfies FamiliarExecutionAnalyticsErrorResponse;
    return NextResponse.json(
      response,
      { status: 500 },
    );
  }
}
