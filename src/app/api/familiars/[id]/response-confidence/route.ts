import { NextResponse } from "next/server";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  appendResponseConfidenceEvent,
  listResponseConfidenceEvents,
} from "@/lib/server/familiar-self-reports";
import {
  RESPONSE_CONFIDENCE_FACTOR_KEYS,
  normalizeResponseConfidenceEvent,
  type ResponseConfidenceEvent,
  type ResponseConfidenceFactorKey,
} from "@/lib/thread-self-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be numeric`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeFactors(value: unknown): ResponseConfidenceEvent["factors"] {
  if (!isRecord(value)) throw new Error("factors invalid");
  const factors = {} as ResponseConfidenceEvent["factors"];
  for (const key of RESPONSE_CONFIDENCE_FACTOR_KEYS) {
    const raw = value[key];
    if (!isRecord(raw)) throw new Error(`factors.${key} invalid`);
    factors[key as ResponseConfidenceFactorKey] = {
      score: score(raw.score, `factors.${key}.score`),
      weight: typeof raw.weight === "number" && Number.isFinite(raw.weight) ? raw.weight : 1,
      reason: text(raw.reason),
      signals: stringArray(raw.signals),
    };
  }
  return factors;
}

function normalizeBody(payload: unknown, familiarId: string): ResponseConfidenceEvent {
  if (!isRecord(payload)) throw new Error("event invalid");
  const sessionId = text(payload.sessionId);
  const responseId = text(payload.responseId);
  const responseAt = text(payload.responseAt);
  const reportedAt = text(payload.reportedAt, new Date().toISOString());
  if (!sessionId) throw new Error("sessionId required");
  if (!responseId) throw new Error("responseId required");
  if (!responseAt) throw new Error("responseAt required");

  return normalizeResponseConfidenceEvent({
    id: text(payload.id, crypto.randomUUID()),
    familiarId,
    sessionId,
    responseId,
    turnId: optionalText(payload.turnId),
    threadTitle: optionalText(payload.threadTitle),
    responseAt,
    reportedAt,
    overallConfidence: score(payload.overallConfidence, "overallConfidence"),
    factors: normalizeFactors(payload.factors),
    diagnosticTags: stringArray(payload.diagnosticTags),
    calibrationNotes: optionalText(payload.calibrationNotes),
    rubricVersion: text(payload.rubricVersion, "2026-06-28.v1"),
  });
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
  const result = await listResponseConfidenceEvents(id, { limit, before });
  return NextResponse.json({ ok: true, events: redactSecretsDeep(result.events), total: result.total });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    const event = redactSecretsDeep(normalizeBody(body, id));
    await appendResponseConfidenceEvent(id, event);
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "response confidence invalid" },
      { status: 400 },
    );
  }
}
