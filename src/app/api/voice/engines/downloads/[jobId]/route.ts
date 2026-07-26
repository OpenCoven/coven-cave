import { NextResponse } from "next/server.js";
import { getSpeechModelDownloadJob } from "../../../../../../lib/voice/speech-models.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getSpeechModelDownloadJob(jobId);
  if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}
