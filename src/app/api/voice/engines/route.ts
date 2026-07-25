import { NextResponse } from "next/server.js";
import { speechEnginesReadiness } from "../../../../lib/voice/speech-models.ts";
import { whisperRuntimeAvailable } from "../../../../lib/voice/sidecar-whisper.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [engines, whisperAvailable] = await Promise.all([
    speechEnginesReadiness(),
    whisperRuntimeAvailable(),
  ]);
  return NextResponse.json({
    ...engines,
    runtimes: { whisper: { available: whisperAvailable } },
  });
}
