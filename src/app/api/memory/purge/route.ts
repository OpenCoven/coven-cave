import { NextResponse } from "next/server";
import { purgeMemoryTrash } from "@/lib/server/memory-trash";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { trashId?: string };
  try { body = await req.json(); } catch { body = {}; }
  const result = await purgeMemoryTrash(body.trashId);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
