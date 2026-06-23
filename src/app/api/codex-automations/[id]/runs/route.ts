import { NextResponse } from "next/server";
import { listRuns } from "@/lib/automation-runs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const runs = await listRuns(id);
  return NextResponse.json({ ok: true, runs });
}
