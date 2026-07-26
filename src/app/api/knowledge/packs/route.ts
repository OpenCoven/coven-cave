import { NextResponse } from "next/server";
import { listKnowledgePacks } from "@/lib/server/knowledge-packs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, packs: await listKnowledgePacks() });
}
