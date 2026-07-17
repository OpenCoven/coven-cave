import { NextResponse } from "next/server.js";
import { speechEnginesReadiness } from "../../../../lib/voice/speech-models.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await speechEnginesReadiness());
}
