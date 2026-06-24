import { NextResponse } from "next/server";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { listConversations, loadConversation, type ConversationFile } from "@/lib/cave-conversations";
import { cleanModelId } from "@/lib/chat-model-state";
import {
  aggregateTurnUsage,
  buildChatUsagePlanSnapshot,
  monthlyUsagePeriod,
  type ChatUsagePlanAvailability,
  type TurnUsageLike,
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

function sameModel(a: unknown, b: string): boolean {
  const clean = cleanModelId(a);
  if (!clean) return false;
  if (clean === b) return true;
  const aBare = clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
  const bBare = b.includes("/") ? b.slice(b.lastIndexOf("/") + 1) : b;
  return aBare === bBare;
}

function turnBelongsToModel(turn: ConversationFile["turns"][number], conversation: ConversationFile, model: string): boolean {
  return (
    sameModel(turn.responseMetadata?.confirmedModel, model) ||
    sameModel(turn.responseMetadata?.model, model) ||
    sameModel(conversation.modelIntent?.model, model) ||
    sameModel(conversation.model, model)
  );
}

function inPeriod(value: unknown, startsAt: string, endsAt: string): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(startsAt) && time < Date.parse(endsAt);
}

async function usageTurnsForPlan(args: {
  familiarId: string;
  sessionId?: string | null;
  model: string;
  startsAt: string;
  endsAt: string;
}): Promise<TurnUsageLike[]> {
  const turns: TurnUsageLike[] = [];
  const rows = await listConversations();
  for (const row of rows) {
    if (row.familiarId !== args.familiarId) continue;
    const conversation = await loadConversation(row.sessionId);
    if (!conversation || conversation.familiarId !== args.familiarId) continue;
    for (const turn of conversation.turns) {
      if (turn.role !== "assistant") continue;
      if (!inPeriod(turn.createdAt, args.startsAt, args.endsAt)) continue;
      if (!turnBelongsToModel(turn, conversation, args.model)) continue;
      turns.push({ usage: turn.usage, costUsd: turn.costUsd });
    }
  }

  if (args.sessionId && turns.length === 0) {
    const conversation = await loadConversation(args.sessionId);
    if (conversation?.familiarId === args.familiarId) {
      for (const turn of conversation.turns) {
        if (turn.role !== "assistant") continue;
        if (!inPeriod(turn.createdAt, args.startsAt, args.endsAt)) continue;
        turns.push({ usage: turn.usage, costUsd: turn.costUsd });
      }
    }
  }
  return turns;
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
