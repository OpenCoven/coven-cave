import { NextResponse } from "next/server";
import { createCodexAutomation, listCodexAutomations, toCodexAutomationPayload } from "@/lib/codex-automations";

export const dynamic = "force-dynamic";

function isLocalOrigin(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  const bare = host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]";
}

export async function GET() {
  try {
    const automations = (await listCodexAutomations()).map(toCodexAutomationPayload);
    return NextResponse.json({ ok: true, automations });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rrule = typeof body.rrule === "string" ? body.rrule : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 422 });
  if (!rrule.startsWith("RRULE:")) {
    return NextResponse.json({ ok: false, error: "rrule must start with RRULE:" }, { status: 422 });
  }
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !x.includes("\n")) : [];
  const asStr = (v: unknown): string => (typeof v === "string" && !v.includes("\n") ? v : "");
  try {
    const created = await createCodexAutomation({
      name,
      rrule,
      prompt,
      cwds: asArray(body.cwds),
      tags: asArray(body.tags),
      familiars: asArray(body.familiars),
      model: asStr(body.model),
      reasoningEffort: asStr(body.reasoning_effort),
      executionEnvironment: asStr(body.execution_environment),
      skillPath: asStr(body.skill_path) || null,
    });
    return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(created) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}
