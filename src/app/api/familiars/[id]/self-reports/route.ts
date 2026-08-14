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
  const limit = limitRaw === "all"
    ? "all" as const
    : limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const before = url.searchParams.get("before") ?? undefined;
  const result = await listSelfReports(id, { limit, before });
  // Redact per report, never the whole collection. redactSecretsDeep carries a
  // traversal budget (MAX_REDACTION_ENTRIES) and returns the *scalar* string
  // "[redacted]" for the entire value once it is exceeded — so redacting the
  // array wholesale turned `reports` into a string as self-report history grew
  // past the ceiling, which `?limit=all` reaches first. The client then spread
  // that string into characters and crashed on `b.id.localeCompare` inside
  // aggregateThreadSignals (cave-p9dsb). Per-report redaction keeps the array
  // an array: an oversized report degrades on its own and its siblings survive.
  const reports = result.reports.map((report) => redactSecretsDeep(report));
  return NextResponse.json({ ok: true, reports, total: result.total });
}
