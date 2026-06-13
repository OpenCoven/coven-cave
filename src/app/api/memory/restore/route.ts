import { NextResponse } from "next/server";
import { restoreMemoryFile } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { trashId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.trashId) return NextResponse.json({ ok: false, error: "trashId required" }, { status: 400 });
  const result = await restoreMemoryFile(body.trashId);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
