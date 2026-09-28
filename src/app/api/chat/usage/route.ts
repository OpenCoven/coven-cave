import { NextResponse } from "next/server";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { cleanModelId } from "@/lib/chat-model-state";
import { usageTurnsForPlan } from "@/lib/server/chat-usage-turns";
import {
  aggregateTurnUsage,
  buildChatUsagePlanSnapshot,
  monthlyUsagePeriod,
  type ChatUsagePlanAvailability,
} from "@/lib/chat-usage-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw.replace(/_/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function envText(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = cleanText(url.searchParams.get("familiarId"));
  const sessionId = cleanText(url.searchParams.get("sessionId"));
  if (!familiarId) return jsonError("familiarId is required", 400);

  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  const model = cleanModelId(url.searchParams.get("model")) ?? cleanModelId(binding.model) ?? "unknown";
  const period = monthlyUsagePeriod();
  const turns = await usageTurnsForPlan({
    familiarId,
    sessionId,
    model,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });
  const totals = aggregateTurnUsage(turns);

  const tokenLimit = envNumber("CAVE_CHAT_PLAN_TOKEN_LIMIT");
  const costLimitUsd = envNumber("CAVE_CHAT_PLAN_COST_LIMIT_USD");
  const hasConfiguredLimits = Boolean(tokenLimit || costLimitUsd);
  const availability: ChatUsagePlanAvailability = hasConfiguredLimits ? "estimated" : "unconfigured";

  const snapshot = buildChatUsagePlanSnapshot({
    model,
    planName: envText("CAVE_CHAT_PLAN_NAME"),
    availability: hasConfiguredLimits ? availability : "unconfigured",
    source: "local-conversations",
    updatedAt: new Date().toISOString(),
    period,
    totals,
    tokenLimit,
    costLimitUsd,
  });

  return NextResponse.json({ ok: true, snapshot });
}
