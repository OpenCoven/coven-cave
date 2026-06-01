import { NextResponse } from "next/server";
import {
  createEscalation,
  reconcileValsInbox,
  sortEscalations,
  type EscalationOrigin,
  type EscalationSeverity,
} from "@/lib/vals-inbox";

export const dynamic = "force-dynamic";

const VALID_ORIGINS: EscalationOrigin[] = [
  "chat",
  "mention",
  "board",
  "cron",
  "heartbeat",
  "call",
  "gateway",
  "task",
];

const VALID_SEVERITIES: EscalationSeverity[] = ["info", "warn", "critical"];

export async function GET() {
  const items = await reconcileValsInbox();
  return NextResponse.json({ ok: true, items: sortEscalations(items) });
}

export async function POST(req: Request) {
  let body: {
    title?: string;
    origin?: string;
    severity?: string;
    severityReason?: string;
    excerpt?: string;
    sourceSessionKey?: string;
    sourceUrl?: string;
    fromFamiliar?: string;
    aboutFamiliar?: string;
    decisionRequired?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  if (!body.origin || !VALID_ORIGINS.includes(body.origin as EscalationOrigin)) {
    return NextResponse.json(
      { ok: false, error: `origin must be one of: ${VALID_ORIGINS.join(", ")}` },
      { status: 400 },
    );
  }
  const severity = (body.severity ?? "info") as EscalationSeverity;
  if (!VALID_SEVERITIES.includes(severity)) {
    return NextResponse.json(
      { ok: false, error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const item = await createEscalation({
      title: body.title,
      origin: body.origin as EscalationOrigin,
      severity,
      severityReason: body.severityReason,
      excerpt: body.excerpt,
      sourceSessionKey: body.sourceSessionKey,
      sourceUrl: body.sourceUrl,
      fromFamiliar: body.fromFamiliar,
      aboutFamiliar: body.aboutFamiliar,
      decisionRequired: body.decisionRequired,
    });
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create failed" },
      { status: 400 },
    );
  }
}
