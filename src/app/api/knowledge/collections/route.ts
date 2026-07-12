import { NextResponse } from "next/server";
import { listCollections } from "@/lib/server/knowledge-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, collections: await listCollections() });
}
