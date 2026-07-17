import { NextResponse } from "next/server.js";
import { listSpeechModelDownloadJobs, startSpeechModelDownload } from "../../../../../lib/voice/speech-models.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, jobs: listSpeechModelDownloadJobs() });
}

export async function POST(req: Request) {
  let body: { modelId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!modelId) return NextResponse.json({ ok: false, error: "missing_modelId" }, { status: 400 });
  const result = await startSpeechModelDownload(modelId);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, ...result }, { status: result.started ? 202 : 200 });
}
