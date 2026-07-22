import { NextResponse } from "next/server";
import { listOpenCodeModels } from "@/lib/server/opencode-models";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId");
  return NextResponse.json({ ok: true, models: await listOpenCodeModels(familiarId) });
}
