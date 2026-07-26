import { formatCost, formatTokens, type TurnUsage } from "./usage-format.ts";

export type ChatUsagePlanAvailability =
  | "authoritative"
  | "estimated"
  | "unconfigured"
  | "unavailable";

export type ChatUsagePlanPeriod = {
  id: "monthly";
  label: string;
  startsAt: string;
  endsAt: string;
};

export type ChatUsagePlanTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type ChatUsageUnit = "tokens" | "usd";

export type ChatUsageWindow = {
  id: string;
  title: string;
  used: number;
  limit?: number;
  unit: ChatUsageUnit;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  resetDescription?: string;
  usageKnown: boolean;
  limitKnown: boolean;
};

export type ChatUsagePlanSnapshot = {
  model: string;
  planName?: string;
  availability: ChatUsagePlanAvailability;
  source: "provider" | "local-conversations";
  updatedAt: string;
  period: ChatUsagePlanPeriod;
  totals: ChatUsagePlanTotals;
  windows: {
    tokens?: ChatUsageWindow;
    cost?: ChatUsageWindow;
  };
};

export type TurnUsageLike = {
  usage?: TurnUsage;
  costUsd?: number;
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function roundedPercent(used: number, limit: number): number {
  return Math.round((used / limit) * 100);
}

export function makeUsageWindow(args: {
  id: string;
  title: string;
  used: number;
  limit?: number;
  unit: ChatUsageUnit;
  resetsAt?: string;
  resetDescription?: string;
}): ChatUsageWindow {
  const rawUsed = finiteNonNegative(args.used) ?? 0;
  const limit = finiteNonNegative(args.limit);
  if (!limit || limit <= 0) {
    return {
      id: args.id,
      title: args.title,
      used: rawUsed,
      unit: args.unit,
      ...(args.resetsAt ? { resetsAt: args.resetsAt } : {}),
      ...(args.resetDescription ? { resetDescription: args.resetDescription } : {}),
      usageKnown: rawUsed > 0,
      limitKnown: false,
    };
  }

  const used = Math.min(rawUsed, limit);
  const usedPercent = Math.min(100, Math.max(0, roundedPercent(used, limit)));
  return {
    id: args.id,
    title: args.title,
    used,
    limit,
    unit: args.unit,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    ...(args.resetsAt ? { resetsAt: args.resetsAt } : {}),
    ...(args.resetDescription ? { resetDescription: args.resetDescription } : {}),
    usageKnown: true,
    limitKnown: true,
  };
}

export function aggregateTurnUsage(turns: TurnUsageLike[]): ChatUsagePlanTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUsd = 0;

  for (const turn of turns) {
    const usage = turn.usage;
    if (usage) {
      inputTokens += finiteNonNegative(usage.inputTokens) ?? 0;
      outputTokens += finiteNonNegative(usage.outputTokens) ?? 0;
      cacheReadTokens += finiteNonNegative(usage.cacheReadTokens) ?? 0;
      cacheCreationTokens += finiteNonNegative(usage.cacheCreationTokens) ?? 0;
    }
    costUsd += finiteNonNegative(turn.costUsd) ?? 0;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    costUsd,
  };
}

export function monthlyUsagePeriod(now = new Date()): ChatUsagePlanPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    id: "monthly",
    label: "Monthly",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

export function buildChatUsagePlanSnapshot(args: {
  model: string;
  planName?: string;
  availability: ChatUsagePlanAvailability;
  source: ChatUsagePlanSnapshot["source"];
  updatedAt: string;
  period: ChatUsagePlanPeriod;
  totals: ChatUsagePlanTotals;
  tokenLimit?: number;
  costLimitUsd?: number;
}): ChatUsagePlanSnapshot {
  const tokenWindow = makeUsageWindow({
    id: `${args.period.id}-tokens`,
    title: args.period.label,
    used: args.totals.totalTokens,
    limit: args.tokenLimit,
    unit: "tokens",
    resetsAt: args.period.endsAt,
  });
  const costWindow = makeUsageWindow({
    id: `${args.period.id}-cost`,
    title: args.period.label,
    used: args.totals.costUsd,
    limit: args.costLimitUsd,
    unit: "usd",
    resetsAt: args.period.endsAt,
  });

  return {
    model: args.model,
    ...(args.planName ? { planName: args.planName } : {}),
    availability: args.availability,
    source: args.source,
    updatedAt: args.updatedAt,
    period: args.period,
    totals: args.totals,
    windows: {
      tokens: tokenWindow,
      cost: costWindow,
    },
  };
}

function formatWindowValue(value: number, unit: ChatUsageUnit): string {
  if (unit === "usd") return formatCost(value) ?? "$0.00";
  return `${formatTokens(value) ?? Math.round(value).toLocaleString()} tok`;
}

function formatWindowRatio(window: ChatUsageWindow): string | null {
  if (!window.limitKnown || window.limit === undefined || window.usedPercent === undefined) {
    return window.used > 0 ? `${formatWindowValue(window.used, window.unit)} used` : null;
  }
  const used = window.unit === "usd" ? (formatCost(window.used) ?? "$0.00") : (formatTokens(window.used) ?? String(window.used));
  const limit = window.unit === "usd" ? (formatCost(window.limit) ?? `$${window.limit.toFixed(2)}`) : (formatTokens(window.limit) ?? String(window.limit));
  return window.unit === "usd"
    ? `${window.usedPercent}% · ${used}/${limit}`
    : `${window.usedPercent}% · ${used}/${limit} tok`;
}

export function formatChatUsagePlanSummary(snapshot: ChatUsagePlanSnapshot | null | undefined): string | null {
  if (!snapshot || snapshot.availability === "unavailable") return "Usage unavailable";
  const tokens = snapshot.windows.tokens;
  if (tokens?.limitKnown) {
    const ratio = formatWindowRatio(tokens);
    return ratio ? `${snapshot.planName ?? "Plan"} ${ratio}` : null;
  }
  const cost = snapshot.windows.cost;
  if (cost?.limitKnown) {
    const ratio = formatWindowRatio(cost);
    return ratio ? `${snapshot.planName ?? "Plan"} ${ratio}` : null;
  }
  const fallback = tokens ? formatWindowRatio(tokens) : null;
  if (fallback) return `Usage ${fallback}`;
  return snapshot.availability === "unconfigured" ? "No plan limits" : null;
}

export function chatUsagePlanTooltip(snapshot: ChatUsagePlanSnapshot | null | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.availability === "unavailable") return "Plan usage is unavailable.";
  const pieces = [
    snapshot.planName ? `plan ${snapshot.planName}` : "plan limits not configured",
    `model ${snapshot.model}`,
    `${snapshot.totals.inputTokens.toLocaleString()} input`,
    `${snapshot.totals.outputTokens.toLocaleString()} output`,
  ];
  if (snapshot.totals.cacheReadTokens > 0) pieces.push(`${snapshot.totals.cacheReadTokens.toLocaleString()} cache read`);
  if (snapshot.totals.cacheCreationTokens > 0) pieces.push(`${snapshot.totals.cacheCreationTokens.toLocaleString()} cache write`);
  if (snapshot.totals.costUsd > 0) pieces.push(formatCost(snapshot.totals.costUsd) ?? `$${snapshot.totals.costUsd.toFixed(4)}`);
  pieces.push(`resets ${new Date(snapshot.period.endsAt).toLocaleDateString()}`);
  if (snapshot.availability === "estimated") pieces.push("estimated from local chat transcripts");
  if (snapshot.availability === "unconfigured") pieces.push("add local plan limits to show percent used");
  return pieces.join(" · ");
}
