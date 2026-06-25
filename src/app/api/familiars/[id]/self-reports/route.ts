import { NextResponse } from "next/server";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import { listSelfReports } from "@/lib/server/familiar-self-reports";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
