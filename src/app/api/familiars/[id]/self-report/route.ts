import { NextResponse } from "next/server";
import { redactSecretsDeep, redactSecretText } from "@/lib/secret-redaction";
import {
  appendSelfReport,
  listSelfReports,
  SELF_REPORT_SESSION_ID_RE,
} from "@/lib/server/familiar-self-reports";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { parseSelfReportJsonObject } from "@/lib/server/self-report-json";
import type {
  BlockerCategory,
  BlockerImpact,
  CapabilityImportance,
  CapabilityState,
  ContextPressure,
  ThreadSelfReport,
} from "@/lib/thread-self-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SelfReportBody = {
  sessionId?: unknown;
  trigger?: unknown;
  threadTitle?: unknown;
  /** Raw JSON text the familiar produced for the reflection (generated client-side
   *  via the chat bridge; the daemon has no LLM endpoint). The route validates and
   *  persists it. */
  payload?: unknown;
};

const TRIGGERS = new Set(["auto", "manual", "periodic"]);
const CONTEXTS = new Set<ContextPressure>(["adequate", "tight", "excess", "critical"]);
const CAPABILITY_STATES = new Set<CapabilityState>(["available", "degraded", "missing"]);
const BLOCKER_CATEGORIES = new Set<BlockerCategory>(["auth", "tooling", "permission", "infra", "context", "skill", "other"]);
const BLOCKER_IMPACTS = new Set<BlockerImpact>(["low", "medium", "high", "blocking"]);
const IMPORTANCE = new Set<CapabilityImportance>(["nice-to-have", "important", "blocking"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${field} must be 0-100`);
  }
  return Math.round(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string): T {
  if (typeof value === "string" && allowed.has(value as T)) return value as T;
  throw new Error(`${field} invalid`);
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizePayload(payload: Record<string, unknown>, meta: {
  familiarId: string;
  sessionId: string;
  threadTitle?: string;
}): ThreadSelfReport {
  const toolReliability = isRecord(payload.toolReliability) ? payload.toolReliability : {};

  return {
    id: crypto.randomUUID(),
    familiarId: meta.familiarId,
    sessionId: meta.sessionId,
    ...(meta.threadTitle ? { threadTitle: meta.threadTitle } : {}),
    reportedAt: new Date().toISOString(),
    overallConfidence: score(payload.overallConfidence, "overallConfidence"),
    overallConfidenceReason: optionalText(payload.overallConfidenceReason),
    toolReliability: {
      score: score(toolReliability.score, "toolReliability.score"),
      failedTools: stringArray(toolReliability.failedTools),
      unreliableTools: stringArray(toolReliability.unreliableTools),
      notes: optionalText(toolReliability.notes),
    },
    contextPressure: enumValue(payload.contextPressure, CONTEXTS, "contextPressure"),
    contextNotes: optionalText(payload.contextNotes),
    skillsUsed: stringArray(payload.skillsUsed),
    skillsNeedingClarity: objectArray(payload.skillsNeedingClarity).map((item) => ({
      skillId: text(item.skillId),
      reason: text(item.reason),
    })).filter((item) => item.skillId && item.reason),
    skillsNeedingAccess: objectArray(payload.skillsNeedingAccess).map((item) => ({
      skillId: text(item.skillId),
      reason: text(item.reason),
    })).filter((item) => item.skillId && item.reason),
    capabilitiesLacking: objectArray(payload.capabilitiesLacking).map((item) => ({
      name: text(item.name),
      importance: enumValue(item.importance, IMPORTANCE, "capabilitiesLacking.importance"),
      detail: text(item.detail),
    })).filter((item) => item.name && item.detail),
    capabilitiesVital: objectArray(payload.capabilitiesVital).map((item) => ({
      name: text(item.name),
      currentState: enumValue(item.currentState, CAPABILITY_STATES, "capabilitiesVital.currentState"),
      notes: optionalText(item.notes),
    })).filter((item) => item.name),
    memoryRecallScore: score(payload.memoryRecallScore, "memoryRecallScore"),
    memoryRecallNotes: optionalText(payload.memoryRecallNotes),
    fileLocatabilityScore: score(payload.fileLocatabilityScore, "fileLocatabilityScore"),
    fileLocatabilityNotes: optionalText(payload.fileLocatabilityNotes),
    persistentBlockers: objectArray(payload.persistentBlockers).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      category: enumValue(item.category, BLOCKER_CATEGORIES, "persistentBlockers.category"),
      impact: enumValue(item.impact, BLOCKER_IMPACTS, "persistentBlockers.impact"),
      detail: text(item.detail),
      suggestedResolution: optionalText(item.suggestedResolution),
    })).filter((item) => item.id && item.title && item.detail),
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  let body: SelfReportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!SELF_REPORT_SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  if (typeof body.trigger !== "string" || !TRIGGERS.has(body.trigger)) {
    return NextResponse.json({ ok: false, error: "invalid trigger" }, { status: 400 });
  }

  // The familiar's reflection is generated client-side through the chat bridge
  // (the daemon has no LLM endpoint) and posted here as raw JSON text. This route
  // validates the shape and persists it.
  const raw = typeof body.payload === "string" ? body.payload : "";
  if (!raw.trim()) {
    return NextResponse.json({ ok: false, error: "missing reflection payload" }, { status: 400 });
  }

  try {
    const report = redactSecretsDeep(normalizePayload(parseSelfReportJsonObject(raw), {
      familiarId: id,
      sessionId,
      threadTitle: optionalText(body.threadTitle),
    }));
    await appendSelfReport(id, report);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "self-report failed";
    return NextResponse.json({ ok: false, error: redactSecretText(message) });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const before = url.searchParams.get("before") ?? undefined;
  const result = await listSelfReports(id, { limit, before });
  return NextResponse.json({ ok: true, reports: redactSecretsDeep(result.reports), total: result.total });
}
